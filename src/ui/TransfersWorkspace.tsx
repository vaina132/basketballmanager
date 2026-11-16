import { clubRosterLimit } from '../world/club-roster-policy'
import { clubRetirementsThisSeason, PlayerCareerStatus } from './PlayerLifecycle'
import { getPlayerRetirement } from '../world/lifecycle-policy'
import { getCareerPlayer, getCareerWage } from '../world/player-catalog'
import { contractAskingWage } from '../world/contract-roles'
import type { ContractOfferOptions } from '../domain/employment'
import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { TransferPaymentPlan } from '../domain/transfer-payments'
import type { Position } from '../domain/types'
import { contractForSeason, getAvailablePlayers, getClubContractSummary, MAX_CONTRACT_SEASONS, MIN_CONTRACT_WAGE, MIN_ROSTER_SIZE, quotePlayerContract } from '../world/employment-policy'
import { MAX_SEASON_NUMBER, seasonLabel as supportedSeasonLabel } from '../world/season'
import { getPlayerKnowledge } from '../world/scouting-policy'
import { getLatestNegotiation } from '../world/negotiations'
import { getTransferCandidates, requiredTransferFee } from '../world/transfers-policy'
import { getMarketOffers, getMarketStartReason, offseasonContinueFirst } from '../world/market-policy'
import { getInSeasonCandidates, getInSeasonOffers, getInSeasonTransferCandidates, quoteInSeasonOffer } from '../world/recruitment-policy'
import { InSeasonOfferDialog, InSeasonPlayers, InSeasonRecruitmentPanel } from './InSeasonRecruitment'
import { Avatar } from './Avatar'
import { BuyoutHistory, PlayerBuyout } from './PlayerBuyout'
import { Icon } from './Icon'
import { knowledgeLabel, scoutingDate, ScoutingKnowledge } from './ScoutingKnowledge'
import { negotiationOutcome, PlayerContractOffer } from './PlayerContractOffer'
import { chosenMarketOffer, marketOfferStatus, OffseasonMarketPanel, RivalOfferBadge } from './OffseasonMarketPanel'
import { ReleaseClauseValue, transferEntryQuote } from './ReleaseClause'
import './transfers-workspace.css'
import { formatEuros } from './money-format'

interface TransfersWorkspaceProps {
  season: SeasonState
  disabled: boolean
  onEnable: () => void
  onEnableNegotiations: () => void
  onEnableInSeasonTransfers: () => void
  onInSeasonTransferOffer: (playerId: string, seasonWage: number, seasons: number, fee: number, paymentPlan: TransferPaymentPlan, options?: ContractOfferOptions) => void
  onInSeasonClubDecision: (offerId: string, response: 'accept' | 'reject' | 'counter') => void
  onEnableInSeason: () => void
  onInSeasonOffer: (playerId: string, seasonWage: number, options?: ContractOfferOptions) => void
  onWithdrawInSeasonOffer: (offerId: string) => void
  onOpenMatch: () => void
  onOpenAcademy: () => void
  onEnableMarket: () => void
  onAdvanceMarket: () => void
  onWithdrawOffer: (offerId: string) => void
  onDelegation: (delegated: boolean) => void
  onOffer: (playerId: string, seasonWage: number, seasons: number, transferFee?: number, paymentPlan?: TransferPaymentPlan, options?: ContractOfferOptions) => void
  onClubDecision: (offerId: string, response: 'accept' | 'reject' | 'counter') => void
  onBuyout: (playerId: string) => void
  onStartSeason: () => void
  focusedPlayerId: string | null
  onClearFocusedPlayer: () => void
  onOpenScouting: (playerId: string) => void
  onShortlist: (playerId: string, shortlisted: boolean) => void
}

const formatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const money = (cents: number) => formatEuros(cents)
const seasonLabel = (number: number) => number > MAX_SEASON_NUMBER ? 'Calendar limit' : supportedSeasonLabel(number)
const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C']
type ContractView = 'squad' | 'next' | 'market' | 'transfer' | 'now' | 'now-transfer'

export function TransfersWorkspace({ season, disabled, onEnable, onEnableNegotiations, onEnableInSeason, onEnableInSeasonTransfers, onInSeasonTransferOffer, onInSeasonClubDecision, onInSeasonOffer, onWithdrawInSeasonOffer, onOpenMatch, onOpenAcademy, onEnableMarket, onAdvanceMarket, onWithdrawOffer, onDelegation, onOffer, onClubDecision, onBuyout, onStartSeason, focusedPlayerId, onClearFocusedPlayer, onOpenScouting, onShortlist }: TransfersWorkspaceProps) {
  const [view, setView] = useState<ContractView>('squad')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<Position | 'all'>('all')
  const [offerId, setOfferId] = useState<string | null>(null)
  const [inSeasonPlayerId, setInSeasonPlayerId] = useState<string | null>(null)
  const [historyOnly, setHistoryOnly] = useState(false)
  const [buyoutId, setBuyoutId] = useState<string | null>(null)
  const focusedReport = useRef<HTMLElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const wasDisabled = useRef(disabled)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const enabled = season.employment.enabledSince !== null
  const negotiations = season.negotiations.enabledSince !== null
  const datedMarket = season.market.enabledSince !== null
  const openOffers = getMarketOffers(season, season.managedClubId, true)
  const nextYear = season.seasonNumber + 1
  const hasNextYear = nextYear <= MAX_SEASON_NUMBER
  const summary = getClubContractSummary(season, club.id, nextYear)
  const marketOpen = enabled && hasNextYear && season.status === 'complete' && season.employment.market?.seasonNumber === nextYear
  const selected = offerId ? getCareerPlayer(season, offerId) : null
  const selectedBuyout = buyoutId ? getCareerPlayer(season, buyoutId) : null
  const inSeasonPlayer = inSeasonPlayerId ? getCareerPlayer(season, inSeasonPlayerId) : null
  const inSeasonTransfersEnabled = season.recruitment.transfersEnabledSince !== null
  const inSeasonTransfers = getInSeasonTransferCandidates(season)
  const inSeasonAvailable = getInSeasonCandidates(season)
  const inSeasonOffers = getInSeasonOffers(season, club.id, true)
  const nextSquadOffers = [...openOffers, ...inSeasonOffers.filter(offer => offer.seasonNumber + offer.seasons - 1 >= nextYear)]
  const selectedView = view === 'now-transfer' ? season.status === 'active' && inSeasonTransfersEnabled ? 'now-transfer' : 'squad' : view === 'now' ? season.status === 'active' ? 'now' : 'squad' : !hasNextYear || (view === 'market' || view === 'transfer') && !marketOpen ? 'squad' : view
  const available = marketOpen ? getAvailablePlayers(season) : []
  const transferCandidates = marketOpen && datedMarket ? getTransferCandidates(season) : []
  const nextPlayers = summary.contracts.map(contract => getCareerPlayer(season, contract.playerId))
  const source = selectedView === 'now-transfer' ? inSeasonTransfers : selectedView === 'now' ? inSeasonAvailable : selectedView === 'squad' ? club.players : selectedView === 'next' ? nextPlayers : selectedView === 'transfer' ? transferCandidates : available
  const players = source.filter(player => player.name.toLowerCase().includes(query.trim().toLowerCase()) && (position === 'all' || player.position === position))
  const retirements = club.players.flatMap(player => { const retirement = getPlayerRetirement(season, player.id); return retirement.status === 'announced' && retirement.notice ? [{ player, notice: retirement.notice }] : [] })
  const retired = clubRetirementsThisSeason(season)
  const expiring = enabled ? club.players.filter(player => (getPlayerRetirement(season, player.id).notice?.lastSeason ?? Infinity) > season.seasonNumber && contractForSeason(season.employment, player.id, season.seasonNumber)?.endsSeason === season.seasonNumber && !contractForSeason(season.employment, player.id, nextYear)).length : 0
  const enableReason = !season.finance.enabledSince ? 'Enable club finances in Club before starting player contracts.' : !season.payroll.enabledSince ? 'Enable player payroll in Squad before starting player contracts.' : null
  const startReason = datedMarket ? getMarketStartReason(season) : summary.rosterSize < MIN_ROSTER_SIZE ? `Sign ${MIN_ROSTER_SIZE - summary.rosterSize} more ${MIN_ROSTER_SIZE - summary.rosterSize === 1 ? 'player' : 'players'} for next season.` : summary.rosterSize > clubRosterLimit(season) ? `The squad must contain no more than ${clubRosterLimit(season)} players.` : null
  // Browser play-through (16 November 2026): when offers or other squads hold up the next season, continuing the offseason is the next step.
  const continueFirst = datedMarket && !!startReason && offseasonContinueFirst(season)
  const focused = focusedPlayerId ? getCareerPlayer(season, focusedPlayerId) : null
  const focusedContract = focused ? contractForSeason(season.employment, focused.id, nextYear) : null
  const focusedTransfer = marketOpen && datedMarket && focusedContract && focusedContract.clubId !== club.id
  const focusedCurrentContract = focused ? contractForSeason(season.employment, focused.id, season.seasonNumber) : null
  const focusedInSeason = !!focused && season.status === 'active' && focusedCurrentContract?.clubId !== club.id
  const focusedInSeasonPaid = focusedInSeason && !!focusedCurrentContract
  const focusedQuote = focused ? focusedInSeasonPaid ? transferEntryQuote(season, focused.id, MIN_CONTRACT_WAGE, true) : focusedInSeason ? quoteInSeasonOffer(season, focused.id, MIN_CONTRACT_WAGE) : focusedTransfer ? transferEntryQuote(season, focused.id, MIN_CONTRACT_WAGE) : quotePlayerContract(season, focused.id, negotiations ? MIN_CONTRACT_WAGE : getCareerWage(season, focused.id), 1) : null
  const focusedResponse = focused ? getLatestNegotiation(season, focused.id) : null
  const focusedOffer = focused ? (focusedInSeason ? inSeasonOffers : openOffers).find(offer => offer.playerId === focused.id) : null
  const shortlist = season.scouting.clubs[club.id]!.shortlist
  const scoutingEnabled = season.scouting.enabledSince !== null
  const seenPlayers = new Set<string>()
  const recentConversations = [...season.negotiations.records].reverse().filter(record => {
    if (season.recruitment.offers.some(offer => offer.negotiationId === record.id) || record.clubId !== club.id || seenPlayers.has(record.playerId)) return false
    seenPlayers.add(record.playerId)
    return true
  })

  useEffect(() => {
    if (!focusedPlayerId) return
    const frame = requestAnimationFrame(() => { focusedReport.current?.focus({ preventScroll: true }); focusedReport.current?.scrollIntoView({ block: 'nearest' }) })
    return () => cancelAnimationFrame(frame)
  }, [focusedPlayerId])

  useEffect(() => {
    if (wasDisabled.current && !disabled && document.activeElement === document.body) {
      if (lastFocus.current?.isConnected && !lastFocus.current.matches(':disabled')) lastFocus.current.focus({ preventScroll: true })
      else (focusedReport.current ?? document.getElementById('transfers-heading'))?.focus({ preventScroll: true })
    }
    wasDisabled.current = disabled
  }, [disabled])

  function closeFocusedReview() {
    onClearFocusedPlayer()
    document.getElementById('transfers-heading')?.focus({ preventScroll: true })
  }

  function openOffer(playerId: string, review = false) {
    setHistoryOnly(review)
    setOfferId(playerId)
  }

  return <div className="transfers-workspace" onFocusCapture={event => { if (event.target instanceof HTMLElement) lastFocus.current = event.target }}>
    <section className="transfers-overview panel" aria-labelledby="transfers-heading">
      <header className="transfers-heading"><div><h2 id="transfers-heading" tabIndex={-1}>{club.name} · Contracts</h2><span>{seasonLabel(season.seasonNumber)}{marketOpen ? ' · Offseason recruitment' : ' · Squad planning'}</span></div>{enabled && marketOpen && <div className="transfers-start"><div className="transfers-start-actions">{continueFirst && <button id="advance-offseason-start" className="button primary" onClick={onAdvanceMarket} disabled={disabled} aria-describedby="contract-season-reason">Continue offseason<Icon name="next" size={15} /></button>}<button id="start-contract-season" className={continueFirst ? 'button' : 'button primary'} onClick={onStartSeason} disabled={disabled || !!startReason} aria-describedby={startReason ? 'contract-season-reason' : undefined}>Start {seasonLabel(nextYear)}<Icon name="chevron" size={15} /></button></div>{startReason && <small id="contract-season-reason">{startReason}</small>}</div>}</header>
      {enabled && hasNextYear && <div className="transfers-squad-plan"><div className="transfers-squad-count"><Icon name="people" size={24} /><div><strong data-next-contract-roster={summary.rosterSize}>{summary.rosterSize}<small> / {MIN_ROSTER_SIZE}–{clubRosterLimit(season)}</small></strong><span>Next season's squad</span></div></div><div className="transfers-squad-slots" aria-hidden="true">{Array.from({ length: Math.max(MIN_ROSTER_SIZE, summary.rosterSize + summary.reservedRosterSize) }, (_, index) => {
        const contract = summary.contracts[index]
        const pending = nextSquadOffers[index - summary.contracts.length]
        return contract ? <span className="transfers-filled-slot" key={contract.id} title={getCareerPlayer(season, contract.playerId).name}><Avatar player={getCareerPlayer(season, contract.playerId)} color={club.color} size={34} /></span> : pending ? <span className="transfers-reserved-slot" key={pending.id} title={`Offer pending: ${getCareerPlayer(season, pending.playerId).name}`}><Avatar player={getCareerPlayer(season, pending.playerId)} color={club.color} size={34} /></span> : <span className="transfers-empty-slot" key={index}><Icon name="people" size={19} /></span>
      })}</div><div className="transfers-squad-goal"><strong>{summary.rosterSize < MIN_ROSTER_SIZE ? `${MIN_ROSTER_SIZE - summary.rosterSize} more needed` : 'Squad ready'}</strong><span>{summary.reservedRosterSize ? `${summary.reservedRosterSize} ${summary.reservedRosterSize === 1 ? 'offer holding a place' : 'offers holding places'}` : `${expiring} expiring contracts`}</span></div></div>}
      {retirements.length > 0 && <div className="transfers-retirements" data-contract-retirements={retirements.length}><Icon name="calendar" size={19} /><span><strong>Retirement plans</strong> &middot; {retirements.map(({ player, notice }) => player.name + ': final season ' + seasonLabel(notice.lastSeason)).join('; ')}</span></div>}
      {retired.length > 0 && <details className="transfers-retired-history"><summary>Retired this season &middot; {retired.length}</summary><div>{retired.map(notice => <div key={notice.id}><span><strong>{getCareerPlayer(season, notice.playerId).name}</strong><small>Retired {scoutingDate(notice.retiredOn)}</small></span><button className="button small" onClick={() => onOpenScouting(notice.playerId)} disabled={disabled}>View player<Icon name="chevron" size={13} /></button></div>)}</div></details>}
      {!hasNextYear && <p className="transfers-note">The calendar has reached its final supported season. Existing records remain available; further seasons and contracts cannot be created.</p>}
    </section>

    {enabled && <InSeasonRecruitmentPanel onOpenAcademy={onOpenAcademy} season={season} disabled={disabled} onEnable={onEnableInSeason} onEnableTransfers={onEnableInSeasonTransfers} onClubDecision={onInSeasonClubDecision} onReview={setInSeasonPlayerId} onWithdraw={onWithdrawInSeasonOffer} onOpenMatch={onOpenMatch} onBrowse={() => { setView('now'); setQuery(''); setPosition('all'); requestAnimationFrame(() => document.getElementById('contracts-list-title')?.scrollIntoView({ block: 'nearest' })) }} />}

    {datedMarket && <OffseasonMarketPanel season={season} disabled={disabled} onAdvance={onAdvanceMarket} onWithdraw={onWithdrawOffer} onReview={playerId => openOffer(playerId)} onClubDecision={onClubDecision} />}

    {focused && focusedQuote && <section ref={focusedReport} id="transfer-player-review" className="transfer-player-review panel" tabIndex={-1} aria-labelledby="transfer-player-review-title" data-transfer-focus={focused.id} onKeyDown={event => { if (event.key === 'Escape' && !disabled) { event.preventDefault(); event.stopPropagation(); closeFocusedReview() } }}><header className="transfers-heading"><div><h2 id="transfer-player-review-title">{focused.name}</h2><span>{getPlayerRetirement(season, focused.id).status === 'retired' ? 'Retired player' : season.clubs.find(team => team.players.some(player => player.id === focused.id))?.name ?? 'Free agent'} · {focused.position} · {focused.heightCm} cm</span></div><button className="text-button" aria-label="Close player contract review" onClick={closeFocusedReview} disabled={disabled}><Icon name="close" size={14} />Close</button></header><div className="transfer-player-review-body"><PlayerCareerStatus season={season} playerId={focused.id} /><ScoutingKnowledge knowledge={getPlayerKnowledge(season, focused.id)} position={focused.position} /><div className="transfer-player-review-actions">{getPlayerRetirement(season, focused.id).status !== 'retired' && <p>{negotiations ? 'Opening demand · one season' : 'Requested annual wage'} <strong>{money(contractAskingWage(season, season.managedClubId, focused.id))}</strong></p>}{focusedResponse && (!datedMarket || season.status !== 'complete' || focusedOffer?.status === 'countered') && <p className="transfer-latest-response">Latest reply: <strong>{negotiationOutcome(focusedResponse)}</strong></p>}<button id="transfer-focused-offer" className="button primary" onClick={() => focusedInSeason ? setInSeasonPlayerId(focused.id) : openOffer(focused.id)} disabled={disabled || !focusedQuote.canOffer && !focusedOffer} aria-describedby={focusedQuote.reason ? 'transfer-focused-reason' : undefined}>{getPlayerRetirement(season, focused.id).status === 'retired' ? 'Retired' : focusedOffer ? 'Review offer' : focusedInSeasonPaid ? 'Offer transfer' : focusedInSeason ? 'Sign for this season' : focusedTransfer ? 'Offer transfer' : 'Offer contract'}</button>{focusedQuote.reason && <p id="transfer-focused-reason">{focusedQuote.reason}</p>}<button className="button" aria-pressed={shortlist.includes(focused.id)} onClick={() => onShortlist(focused.id, !shortlist.includes(focused.id))} disabled={disabled || !scoutingEnabled || getPlayerRetirement(season, focused.id).status === 'retired' && !shortlist.includes(focused.id)}>{shortlist.includes(focused.id) ? 'Remove from shortlist' : 'Add to shortlist'}</button><button className="text-button" onClick={() => onOpenScouting(focused.id)} disabled={disabled}>Open scouting report<Icon name="chevron" size={14} /></button></div></div></section>}

    {!enabled ? <section className="transfers-enable panel" aria-labelledby="contracts-enable-title"><header className="transfers-heading"><h2 id="contracts-enable-title">Player contracts</h2><span>Not enabled</span></header><div><p>Give every current player a contract through the end of this season at their existing wage. Renew expiring players, then recruit available players when the season ends. Signed deals take effect on the next opening day.</p>{enableReason && <p id="contracts-enable-reason">{enableReason}</p>}<button id="enable-contracts" className="button primary" onClick={onEnable} disabled={disabled || !!enableReason} aria-describedby={enableReason ? 'contracts-enable-reason' : undefined}>Enable player contracts<Icon name="people" size={15} /></button></div></section> : <>
      {hasNextYear && <section className="transfers-policy panel" aria-labelledby="contracts-control-title"><div className="transfers-policy-body"><h2 id="contracts-control-title"><Icon name="staff" size={20} />Who handles contracts?</h2><div className="transfers-policy-control"><label htmlFor="contracts-control" className="sr-only">Contract and transfer control</label><input id="contracts-control" type="range" min={0} max={1} step={1} value={season.employment.delegated ? 1 : 0} aria-valuetext={season.employment.delegated ? 'Assistant' : 'Manual'} aria-describedby="contracts-control-help" onChange={event => onDelegation(event.target.value === '1')} disabled={disabled} /><div><span>Me</span><span>Assistant</span></div></div><span id="contracts-control-help">{season.employment.delegated ? 'Assistant handles recruitment and sales. Buyouts stay your decision.' : 'Assistant can handle recruitment and sales. Buyouts stay your decision.'}</span></div></section>}

      {!negotiations && hasNextYear && <section className="transfers-negotiations-enable panel" aria-labelledby="negotiations-enable-title"><div><h2 id="negotiations-enable-title">Player responses</h2><p>Enable counteroffers, rejections and a saved conversation history for future offers. Longer contracts can carry higher wage demands. Existing signed terms remain binding.</p></div><button id="enable-negotiations" className="button" onClick={onEnableNegotiations} disabled={disabled}>Enable contract negotiations</button></section>}

      {negotiations && !datedMarket && hasNextYear && <section className="transfers-negotiations-enable panel" aria-labelledby="market-enable-title"><div><h2 id="market-enable-title">Offseason calendar</h2><p>Give offseason offers a reply date, an expiry date and reserved salary budget. Current contracts stay signed.</p></div><button id="enable-market" className="button" onClick={onEnableMarket} disabled={disabled}>Enable dated offseason<Icon name="calendar" size={15} /></button></section>}

      <section className="transfers-players panel" aria-labelledby="contracts-list-title">
        <header className="transfers-heading"><h2 id="contracts-list-title">{selectedView === 'now-transfer' ? 'Approach a club this season' : selectedView === 'now' ? 'Available this season' : selectedView === 'squad' ? 'Current squad contracts' : selectedView === 'next' ? `Squad for ${seasonLabel(nextYear)}` : selectedView === 'transfer' ? 'Approach a club' : 'Available for next season'}</h2><span>{players.length} {players.length === 1 ? 'player' : 'players'}</span></header>
        <div className="transfers-toolbar"><div className="segmented" role="group" aria-label="Contract lists"><button aria-pressed={selectedView === 'squad'} className={selectedView === 'squad' ? 'selected' : ''} onClick={() => setView('squad')} disabled={disabled}>Current squad</button>{hasNextYear && <button aria-pressed={selectedView === 'next'} className={selectedView === 'next' ? 'selected' : ''} onClick={() => setView('next')} disabled={disabled}>Next season ({summary.rosterSize})</button>}{season.status === 'active' && <button id="open-in-season-market" aria-pressed={selectedView === 'now'} className={selectedView === 'now' ? 'selected' : ''} onClick={() => setView('now')} disabled={disabled}>Available players ({inSeasonAvailable.length})</button>}{season.status === 'active' && inSeasonTransfersEnabled && <button id="open-in-season-transfers" aria-pressed={selectedView === 'now-transfer'} className={selectedView === 'now-transfer' ? 'selected' : ''} onClick={() => setView('now-transfer')} disabled={disabled}>Under contract ({inSeasonTransfers.length})</button>}{marketOpen && <button id="open-contract-market" aria-pressed={selectedView === 'market'} className={selectedView === 'market' ? 'selected' : ''} onClick={() => setView('market')} disabled={disabled}>Available players ({available.length})</button>}{marketOpen && datedMarket && <button id="open-paid-transfer-market" aria-pressed={selectedView === 'transfer'} className={selectedView === 'transfer' ? 'selected' : ''} onClick={() => setView('transfer')} disabled={disabled}>Under contract ({transferCandidates.length})</button>}</div><div className="transfers-filters"><label htmlFor="contract-player-search">Player<input id="contract-player-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find player" disabled={disabled} /></label><label htmlFor="contract-position">Position<select id="contract-position" value={position} onChange={event => setPosition(event.target.value as Position | 'all')} disabled={disabled}><option value="all">All</option>{positions.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div></div>
        {selectedView === 'now' || selectedView === 'now-transfer' ? <InSeasonPlayers paid={selectedView === 'now-transfer'} season={season} players={players} filtered={!!query || position !== 'all'} disabled={disabled} onReview={setInSeasonPlayerId} onOpenScouting={onOpenScouting} onShortlist={onShortlist} /> : <div className="transfers-table-scroll" tabIndex={0} role="region" aria-label={selectedView === 'market' ? 'Available players' : selectedView === 'transfer' ? 'Players under contract' : 'Player contracts'}><table className="transfers-table"><thead><tr><th scope="col">Player</th><th scope="col">{selectedView === 'transfer' ? 'Contract club' : selectedView === 'market' ? 'Current club' : 'Contract through'}</th><th scope="col">{selectedView === 'transfer' ? 'Club asking fee' : selectedView === 'market' ? negotiations ? 'One-season opening demand' : 'Requested annual wage' : 'Annual wage'}</th><th scope="col">{selectedView === 'transfer' ? 'Current salary / year' : selectedView === 'next' ? 'Starts' : 'Next season'}</th><th scope="col">Knowledge</th><th scope="col">Action</th></tr></thead><tbody>{players.map(player => {
          const current = contractForSeason(season.employment, player.id, season.seasonNumber)
          const next = contractForSeason(season.employment, player.id, nextYear)
          const displayed = selectedView === 'next' ? next : current
          const owner = season.clubs.find(team => team.players.some(member => member.id === player.id))
          const record = owner?.players.find(member => member.id === player.id) ?? player
          const paidApproach = marketOpen && datedMarket && !!next && next.clubId !== club.id
          const quote = paidApproach ? transferEntryQuote(season, player.id, MIN_CONTRACT_WAGE) : quotePlayerContract(season, player.id, negotiations ? MIN_CONTRACT_WAGE : getCareerWage(season, player.id), 1)
          const secured = next?.clubId === club.id
          const latest = getLatestNegotiation(season, player.id)
          const pendingOffer = openOffers.find(offer => offer.playerId === player.id)
          const retirement = getPlayerRetirement(season, player.id).notice
          const action = pendingOffer ? 'Review offer' : paidApproach ? 'Offer transfer' : latest && latest.outcome !== 'accepted' ? 'Continue talks' : current?.clubId === club.id ? 'Renew' : 'Offer contract'
          return <tr key={player.id} data-contract-player={player.id}>
            <th scope="row"><button className="transfers-player transfers-player-report" aria-label={`Scouting report for ${player.name}`} data-transfer-scouting={player.id} onClick={() => onOpenScouting(player.id)} disabled={disabled}><span aria-hidden="true"><Avatar player={record} color={owner?.color ?? '#687385'} size={30} /></span><span><strong>{player.name}</strong><PlayerCareerStatus season={season} playerId={player.id} compact /><small>{player.position} · {player.heightCm} cm</small></span></button></th>
            <td>{selectedView === 'transfer' ? season.clubs.find(team => team.id === next?.clubId)?.name : selectedView === 'market' ? owner?.name ?? 'Free agent' : displayed ? seasonLabel(displayed.endsSeason) : 'No contract'}{(selectedView === 'transfer' ? next : displayed)?.releaseFee !== undefined && <ReleaseClauseValue fee={(selectedView === 'transfer' ? next : displayed)?.releaseFee} />}</td>
            <td>{money(selectedView === 'transfer' ? requiredTransferFee(season, player.id) : selectedView === 'market' ? contractAskingWage(season, season.managedClubId, player.id) : displayed?.seasonWage ?? 0)}</td>
            <td>{selectedView === 'transfer' ? money(next?.seasonWage ?? 0) : !hasNextYear ? 'Calendar limit' : retirement && retirement.lastSeason < nextYear ? <span className="transfers-expiring">Retiring</span> : selectedView === 'next' && next ? seasonLabel(next.startsSeason) : secured ? <span className="transfers-secured">Signed · {money(next.seasonWage)}</span> : next ? `Joining ${season.clubs.find(team => team.id === next.clubId)!.name}` : pendingOffer ? <span className="transfers-secured">{marketOfferStatus(pendingOffer)}</span> : <span className="transfers-expiring">{selectedView === 'market' ? 'Available' : 'Not renewed'}</span>}{selectedView !== 'next' && secured && next?.releaseFee !== undefined && next.id !== displayed?.id && <ReleaseClauseValue fee={next.releaseFee} />}{marketOpen && <RivalOfferBadge season={season} playerId={player.id} onReview={() => openOffer(player.id)} disabled={disabled} />}</td>
            <td className="transfers-knowledge"><span>{knowledgeLabel(getPlayerKnowledge(season, player.id))}</span><button className="text-button" data-transfer-shortlist={player.id} aria-pressed={shortlist.includes(player.id)} aria-label={`${shortlist.includes(player.id) ? 'Remove' : 'Add'} ${player.name} ${shortlist.includes(player.id) ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(player.id, !shortlist.includes(player.id))} disabled={disabled || !scoutingEnabled}>{shortlist.includes(player.id) ? 'Shortlisted' : 'Add to shortlist'}</button></td>
            <td className="transfers-action">{latest && (!datedMarket || season.status !== 'complete') && <small className="transfer-latest-response">{negotiationOutcome(latest)}</small>}{!hasNextYear ? 'No further contracts' : selectedView === 'next' || secured ? <><span><Icon name="check" size={14} /> {seasonLabel(next!.endsSeason)}</span>{marketOpen && datedMarket && secured && <button className="text-button transfers-buyout-action" data-buyout-player={player.id} aria-label={`Buy out contract for ${player.name}`} onClick={() => setBuyoutId(player.id)} disabled={disabled}>Buy out<Icon name="chevron" size={13} /></button>}</> : <><button id={`transfer-player-${player.id}`} className="button small" aria-label={`${action} ${player.name}`} onClick={() => openOffer(player.id)} disabled={disabled || !quote.canOffer && !pendingOffer} aria-describedby={!quote.canOffer ? `contract-reason-${player.id}` : undefined}>{action}<Icon name="chevron" size={13} /></button>{!quote.canOffer && <details className="transfer-unavailable"><summary>Unavailable</summary><small id={`contract-reason-${player.id}`}>{quote.reason}</small></details>}</>}</td>
          </tr>
        })}{!players.length && <tr><td colSpan={6} className="transfers-empty">{query || position !== 'all' ? 'No players match these filters.' : selectedView === 'next' ? 'No players are signed for next season. Review your current squad to offer renewals.' : selectedView === 'market' ? 'No players are available for next season.' : selectedView === 'transfer' ? 'No contracted players can be approached now.' : 'No players in this squad.'}</td></tr>}</tbody></table></div>}
        {hasNextYear && selectedView !== 'now' && selectedView !== 'now-transfer' && <details className="game-disclosure"><summary><Icon name="calendar" size={15} />Contract rules & budget</summary><p className="transfers-note">{marketOpen ? datedMarket ? 'Send offers before the displayed closing date. Signed players join on opening day.' : 'Recruit until you start next season. Unsigned players then leave.' : 'Renew your players for next season, or use Available players to recruit free agents for this season.'} Contracts last 1–{MAX_CONTRACT_SEASONS} seasons.</p><dl className="transfers-summary"><div><dt>Signed salaries / year</dt><dd data-contract-committed={summary.seasonWages}>{money(summary.seasonWages)}</dd></div><div><dt>Pending offers / year</dt><dd data-contract-reserved={summary.reservedWages}>{money(summary.reservedWages)}</dd></div><div><dt>Total salary budget / year</dt><dd>{money(summary.budget)}</dd></div><div><dt>Available after squad reserve</dt><dd data-contract-spendable={summary.spendableBudget}>{money(summary.spendableBudget)}</dd></div></dl></details>}
      </section>
      <BuyoutHistory season={season} />
      {negotiations && <section className="transfers-conversations panel" aria-labelledby="negotiation-activity-title"><header className="transfers-heading"><h2 id="negotiation-activity-title">Recent negotiations</h2><span>Latest response per player</span></header>{recentConversations.length ? <div className="transfers-table-scroll" role="region" aria-label="Saved player negotiations" tabIndex={0}><table className="transfers-table negotiation-activity-table"><thead><tr><th scope="col">Player</th><th scope="col">Offer</th><th scope="col">Player response</th><th scope="col">Date</th><th scope="col">Conversation</th></tr></thead><tbody>{recentConversations.map(record => {
        const player = getCareerPlayer(season, record.playerId)
        const lastOffer = getMarketOffers(season).filter(offer => offer.playerId === player.id).at(-1) ?? null
        const buyout = record.contractId ? season.employment.buyouts.find(item => item.releasedContractIds.includes(record.contractId!)) : null
        const destination = lastOffer?.status === 'lost' ? season.clubs.find(team => team.id === chosenMarketOffer(season, lastOffer)?.clubId) : null
        return <tr key={record.id} data-negotiation-player={record.playerId}><th scope="row">{player.name}</th><td>{money(record.offeredWage)} / season<small>{record.offeredSeasons} {record.offeredSeasons === 1 ? 'season' : 'seasons'} · from {seasonLabel(record.startsSeason)}</small></td><td><strong>{negotiationOutcome(record)}</strong><small>{destination ? `Talks closed · chose ${destination.name}` : record.counterOffer ? `${money(record.counterOffer.seasonWage)} · ${record.counterOffer.seasons} seasons` : record.outcome === 'accepted' ? buyout ? `Bought out ${scoutingDate(buyout.completedOn)}` : 'Contract signed' : 'Improve the offer'}</small></td><td><time dateTime={record.date}>{scoutingDate(record.date)}</time><small>{record.status === 'complete' ? 'Offseason' : `Matchday ${record.round}`}</small></td><td><button className="button small" data-review-negotiation={player.id} aria-label={`Review negotiations with ${player.name}`} onClick={() => openOffer(player.id, true)} disabled={disabled}>Review<Icon name="chevron" size={13} /></button></td></tr>
      })}</tbody></table></div> : <p className="transfers-empty">No replies recorded yet. Open a player’s contract to start talks.</p>}</section>}
      <p className="transfers-model-note">{season.world?.economy ? 'Wages and fees estimated from published 2025-27 club budgets and salary reports.' : 'Fictional development wages.'} The board allocation limits annual promises; wages are paid through the season payroll. Contract decisions trigger an automatic save. Export keeps a separate file backup.</p>
    </>}
    {inSeasonPlayer && enabled && <InSeasonOfferDialog key={inSeasonPlayer.id} season={season} player={inSeasonPlayer} disabled={disabled} onClose={() => setInSeasonPlayerId(null)} onOffer={onInSeasonOffer} onTransferOffer={onInSeasonTransferOffer} onWithdraw={onWithdrawInSeasonOffer} onOpenScouting={onOpenScouting} onOpenMatch={onOpenMatch} />}
    {selectedBuyout && enabled && <PlayerBuyout key={selectedBuyout.id} season={season} player={selectedBuyout} disabled={disabled} onClose={() => setBuyoutId(null)} onBuyout={onBuyout} onFindReplacement={() => { setBuyoutId(null); setView('market'); setQuery(''); setPosition('all'); requestAnimationFrame(() => document.getElementById('transfers-heading')?.focus({ preventScroll: true })) }} />}
    {selected && enabled && <PlayerContractOffer key={selected.id} season={season} player={selected} disabled={disabled} historyOnly={historyOnly} onContinue={() => setHistoryOnly(false)} onClose={() => setOfferId(null)} onOffer={onOffer} onWithdrawOffer={onWithdrawOffer} onOpenScouting={onOpenScouting} onShortlist={onShortlist} />}
  </div>
}

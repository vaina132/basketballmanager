import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { Position } from '../domain/types'
import { getDevelopmentPlayer } from '../data/development-players'
import { getSeasonWage } from '../data/development-wages'
import { contractForSeason, getAvailablePlayers, getClubContractSummary, MAX_CONTRACT_SEASONS, MAX_ROSTER_SIZE, MIN_CONTRACT_WAGE, MIN_ROSTER_SIZE, quotePlayerContract } from '../world/employment-policy'
import { MAX_SEASON_NUMBER, seasonLabel as supportedSeasonLabel } from '../world/season'
import { getPlayerKnowledge } from '../world/scouting-policy'
import { getLatestNegotiation } from '../world/negotiations'
import { getTransferCandidates, quoteTransferOffer, requiredTransferFee } from '../world/transfers-policy'
import { getMarketOffers, getMarketStartReason } from '../world/market-policy'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { knowledgeLabel, scoutingDate, ScoutingKnowledge } from './ScoutingKnowledge'
import { negotiationOutcome, PlayerContractOffer } from './PlayerContractOffer'
import { chosenMarketOffer, marketOfferStatus, OffseasonMarketPanel, RivalOfferBadge } from './OffseasonMarketPanel'
import './transfers-workspace.css'

interface TransfersWorkspaceProps {
  season: SeasonState
  disabled: boolean
  onEnable: () => void
  onEnableNegotiations: () => void
  onEnableMarket: () => void
  onAdvanceMarket: () => void
  onWithdrawOffer: (offerId: string) => void
  onDelegation: (delegated: boolean) => void
  onOffer: (playerId: string, seasonWage: number, seasons: number, transferFee?: number) => void
  onClubDecision: (offerId: string, response: 'accept' | 'reject' | 'counter') => void
  onStartSeason: () => void
  focusedPlayerId: string | null
  onClearFocusedPlayer: () => void
  onOpenScouting: (playerId: string) => void
  onShortlist: (playerId: string, shortlisted: boolean) => void
}

const formatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const money = (cents: number) => formatter.format(cents / 100)
const seasonLabel = (number: number) => number > MAX_SEASON_NUMBER ? 'Calendar limit' : supportedSeasonLabel(number)
const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C']
type ContractView = 'squad' | 'next' | 'market' | 'transfer'

export function TransfersWorkspace({ season, disabled, onEnable, onEnableNegotiations, onEnableMarket, onAdvanceMarket, onWithdrawOffer, onDelegation, onOffer, onClubDecision, onStartSeason, focusedPlayerId, onClearFocusedPlayer, onOpenScouting, onShortlist }: TransfersWorkspaceProps) {
  const [view, setView] = useState<ContractView>('squad')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<Position | 'all'>('all')
  const [offerId, setOfferId] = useState<string | null>(null)
  const [historyOnly, setHistoryOnly] = useState(false)
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
  const selected = offerId ? getDevelopmentPlayer(offerId) : null
  const selectedView = !hasNextYear || (view === 'market' || view === 'transfer') && !marketOpen ? 'squad' : view
  const available = marketOpen ? getAvailablePlayers(season) : []
  const transferCandidates = marketOpen && datedMarket ? getTransferCandidates(season) : []
  const nextPlayers = summary.contracts.map(contract => getDevelopmentPlayer(contract.playerId))
  const source = selectedView === 'squad' ? club.players : selectedView === 'next' ? nextPlayers : selectedView === 'transfer' ? transferCandidates : available
  const players = source.filter(player => player.name.toLowerCase().includes(query.trim().toLowerCase()) && (position === 'all' || player.position === position))
  const expiring = enabled ? club.players.filter(player => contractForSeason(season.employment, player.id, season.seasonNumber)?.endsSeason === season.seasonNumber && !contractForSeason(season.employment, player.id, nextYear)).length : 0
  const enableReason = !season.finance.enabledSince ? 'Enable club finances in Club before starting player contracts.' : !season.payroll.enabledSince ? 'Enable player payroll in Squad before starting player contracts.' : null
  const startReason = datedMarket ? getMarketStartReason(season) : summary.rosterSize < MIN_ROSTER_SIZE ? `Sign ${MIN_ROSTER_SIZE - summary.rosterSize} more ${MIN_ROSTER_SIZE - summary.rosterSize === 1 ? 'player' : 'players'} for next season.` : summary.rosterSize > MAX_ROSTER_SIZE ? `The squad must contain no more than ${MAX_ROSTER_SIZE} players.` : null
  const focused = focusedPlayerId ? getDevelopmentPlayer(focusedPlayerId) : null
  const focusedContract = focused ? contractForSeason(season.employment, focused.id, nextYear) : null
  const focusedTransfer = marketOpen && datedMarket && focusedContract && focusedContract.clubId !== club.id
  const focusedQuote = focused ? focusedTransfer ? quoteTransferOffer(season, focused.id, MIN_CONTRACT_WAGE, 1, requiredTransferFee(season, focused.id)) : quotePlayerContract(season, focused.id, negotiations ? MIN_CONTRACT_WAGE : getSeasonWage(focused.id), 1) : null
  const focusedResponse = focused ? getLatestNegotiation(season, focused.id) : null
  const focusedOffer = focused ? openOffers.find(offer => offer.playerId === focused.id) : null
  const shortlist = season.scouting.clubs[club.id]!.shortlist
  const scoutingEnabled = season.scouting.enabledSince !== null
  const seenPlayers = new Set<string>()
  const recentConversations = [...season.negotiations.records].reverse().filter(record => {
    if (record.clubId !== club.id || seenPlayers.has(record.playerId)) return false
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
      <header className="transfers-heading"><div><h2 id="transfers-heading" tabIndex={-1}>{club.name} · Contracts</h2><span>{seasonLabel(season.seasonNumber)}{marketOpen ? ' · Offseason recruitment' : ' · Squad planning'}</span></div>{enabled && marketOpen && <div className="transfers-start"><button id="start-contract-season" className="button primary" onClick={onStartSeason} disabled={disabled || !!startReason} aria-describedby={startReason ? 'contract-season-reason' : undefined}>Start {seasonLabel(nextYear)}<Icon name="chevron" size={15} /></button>{startReason && <small id="contract-season-reason">{startReason}</small>}</div>}</header>
      {enabled && hasNextYear && <div className="transfers-squad-plan"><div className="transfers-squad-count"><Icon name="people" size={24} /><div><strong data-next-contract-roster={summary.rosterSize}>{summary.rosterSize}<small> / {MIN_ROSTER_SIZE}–{MAX_ROSTER_SIZE}</small></strong><span>Next season's squad</span></div></div><div className="transfers-squad-slots" aria-hidden="true">{Array.from({ length: Math.max(MIN_ROSTER_SIZE, summary.rosterSize + summary.reservedRosterSize) }, (_, index) => {
        const contract = summary.contracts[index]
        const pending = openOffers[index - summary.contracts.length]
        return contract ? <span className="transfers-filled-slot" key={contract.id} title={getDevelopmentPlayer(contract.playerId).name}><Avatar player={getDevelopmentPlayer(contract.playerId)} color={club.color} size={34} /></span> : pending ? <span className="transfers-reserved-slot" key={pending.id} title={`Offer pending: ${getDevelopmentPlayer(pending.playerId).name}`}><Avatar player={getDevelopmentPlayer(pending.playerId)} color={club.color} size={34} /></span> : <span className="transfers-empty-slot" key={index}><Icon name="people" size={19} /></span>
      })}</div><div className="transfers-squad-goal"><strong>{summary.rosterSize < MIN_ROSTER_SIZE ? `${MIN_ROSTER_SIZE - summary.rosterSize} more needed` : 'Squad ready'}</strong><span>{summary.reservedRosterSize ? `${summary.reservedRosterSize} ${summary.reservedRosterSize === 1 ? 'offer holding a place' : 'offers holding places'}` : `${expiring} expiring contracts`}</span></div></div>}
      {!hasNextYear && <p className="transfers-note">The calendar has reached its final supported season. Existing records remain available; further seasons and contracts cannot be created.</p>}
    </section>

    {datedMarket && <OffseasonMarketPanel season={season} disabled={disabled} onAdvance={onAdvanceMarket} onWithdraw={onWithdrawOffer} onReview={playerId => openOffer(playerId)} onClubDecision={onClubDecision} />}

    {focused && focusedQuote && <section ref={focusedReport} id="transfer-player-review" className="transfer-player-review panel" tabIndex={-1} aria-labelledby="transfer-player-review-title" data-transfer-focus={focused.id} onKeyDown={event => { if (event.key === 'Escape' && !disabled) { event.preventDefault(); event.stopPropagation(); closeFocusedReview() } }}><header className="transfers-heading"><div><h2 id="transfer-player-review-title">{focused.name}</h2><span>{season.clubs.find(team => team.players.some(player => player.id === focused.id))?.name ?? 'Free agent'} · {focused.position} · {focused.heightCm} cm</span></div><button className="text-button" aria-label="Close player contract review" onClick={closeFocusedReview} disabled={disabled}><Icon name="close" size={14} />Close</button></header><div className="transfer-player-review-body"><ScoutingKnowledge knowledge={getPlayerKnowledge(season, focused.id)} /><div className="transfer-player-review-actions"><p>{negotiations ? 'Opening demand · one season' : 'Requested annual wage'} <strong>{money(getSeasonWage(focused.id))}</strong></p>{focusedResponse && (!datedMarket || season.status !== 'complete' || focusedOffer?.status === 'countered') && <p className="transfer-latest-response">Latest reply: <strong>{negotiationOutcome(focusedResponse)}</strong></p>}<button id="transfer-focused-offer" className="button primary" onClick={() => openOffer(focused.id)} disabled={disabled || !focusedQuote.canOffer && !focusedOffer} aria-describedby={focusedQuote.reason ? 'transfer-focused-reason' : undefined}>{focusedOffer ? 'Review offer' : focusedTransfer ? 'Offer transfer' : 'Offer contract'}</button>{focusedQuote.reason && <p id="transfer-focused-reason">{focusedQuote.reason}</p>}<button className="button" aria-pressed={shortlist.includes(focused.id)} onClick={() => onShortlist(focused.id, !shortlist.includes(focused.id))} disabled={disabled || !scoutingEnabled}>{shortlist.includes(focused.id) ? 'Remove from shortlist' : 'Add to shortlist'}</button><button className="text-button" onClick={() => onOpenScouting(focused.id)} disabled={disabled}>Open scouting report<Icon name="chevron" size={14} /></button></div></div></section>}

    {!enabled ? <section className="transfers-enable panel" aria-labelledby="contracts-enable-title"><header className="transfers-heading"><h2 id="contracts-enable-title">Player contracts</h2><span>Not enabled</span></header><div><p>Give every current player a contract through the end of this season at their existing wage. Renew expiring players, then recruit available players when the season ends. Signed deals take effect on the next opening day.</p>{enableReason && <p id="contracts-enable-reason">{enableReason}</p>}<button id="enable-contracts" className="button primary" onClick={onEnable} disabled={disabled || !!enableReason} aria-describedby={enableReason ? 'contracts-enable-reason' : undefined}>Enable player contracts<Icon name="people" size={15} /></button></div></section> : <>
      {hasNextYear && <section className="transfers-policy panel" aria-labelledby="contracts-control-title"><div className="transfers-policy-body"><h2 id="contracts-control-title"><Icon name="staff" size={20} />Who handles contracts?</h2><div className="transfers-policy-control"><label htmlFor="contracts-control" className="sr-only">Contract and transfer control</label><input id="contracts-control" type="range" min={0} max={1} step={1} value={season.employment.delegated ? 1 : 0} aria-valuetext={season.employment.delegated ? 'Assistant' : 'Manual'} aria-describedby="contracts-control-help" onChange={event => onDelegation(event.target.value === '1')} disabled={disabled} /><div><span>Me</span><span>Assistant</span></div></div><span id="contracts-control-help">{season.employment.delegated ? 'Assistant handles contracts and transfer fees. Signed deals stay binding.' : 'Assistant can handle contracts, recruitment and sales.'}</span></div></section>}

      {!negotiations && hasNextYear && <section className="transfers-negotiations-enable panel" aria-labelledby="negotiations-enable-title"><div><h2 id="negotiations-enable-title">Player responses</h2><p>Enable counteroffers, rejections and a saved conversation history for future offers. Longer contracts can carry higher wage demands. Existing signed terms remain binding.</p></div><button id="enable-negotiations" className="button" onClick={onEnableNegotiations} disabled={disabled}>Enable contract negotiations</button></section>}

      {negotiations && !datedMarket && hasNextYear && <section className="transfers-negotiations-enable panel" aria-labelledby="market-enable-title"><div><h2 id="market-enable-title">Offseason calendar</h2><p>Give offseason offers a reply date, an expiry date and reserved salary budget. Current contracts stay signed.</p></div><button id="enable-market" className="button" onClick={onEnableMarket} disabled={disabled}>Enable dated offseason<Icon name="calendar" size={15} /></button></section>}

      <section className="transfers-players panel" aria-labelledby="contracts-list-title">
        <header className="transfers-heading"><h2 id="contracts-list-title">{selectedView === 'squad' ? 'Current squad contracts' : selectedView === 'next' ? `Squad for ${seasonLabel(nextYear)}` : selectedView === 'transfer' ? 'Approach a club' : 'Available for next season'}</h2><span>{players.length} {players.length === 1 ? 'player' : 'players'}</span></header>
        <div className="transfers-toolbar"><div className="segmented" role="group" aria-label="Contract lists"><button aria-pressed={selectedView === 'squad'} className={selectedView === 'squad' ? 'selected' : ''} onClick={() => setView('squad')} disabled={disabled}>Current squad</button>{hasNextYear && <button aria-pressed={selectedView === 'next'} className={selectedView === 'next' ? 'selected' : ''} onClick={() => setView('next')} disabled={disabled}>Next season ({summary.rosterSize})</button>}{marketOpen && <button id="open-contract-market" aria-pressed={selectedView === 'market'} className={selectedView === 'market' ? 'selected' : ''} onClick={() => setView('market')} disabled={disabled}>Available players ({available.length})</button>}{marketOpen && datedMarket && <button id="open-paid-transfer-market" aria-pressed={selectedView === 'transfer'} className={selectedView === 'transfer' ? 'selected' : ''} onClick={() => setView('transfer')} disabled={disabled}>Under contract ({transferCandidates.length})</button>}</div><div className="transfers-filters"><label htmlFor="contract-player-search">Player<input id="contract-player-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find player" disabled={disabled} /></label><label htmlFor="contract-position">Position<select id="contract-position" value={position} onChange={event => setPosition(event.target.value as Position | 'all')} disabled={disabled}><option value="all">All</option>{positions.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div></div>
        <div className="transfers-table-scroll" tabIndex={0} role="region" aria-label={selectedView === 'market' ? 'Available players' : selectedView === 'transfer' ? 'Players under contract' : 'Player contracts'}><table className="transfers-table"><thead><tr><th scope="col">Player</th><th scope="col">{selectedView === 'transfer' ? 'Contract club' : selectedView === 'market' ? 'Current club' : 'Contract through'}</th><th scope="col">{selectedView === 'transfer' ? 'Club asking fee' : selectedView === 'market' ? negotiations ? 'One-season opening demand' : 'Requested annual wage' : 'Annual wage'}</th><th scope="col">{selectedView === 'transfer' ? 'Current salary / year' : selectedView === 'next' ? 'Starts' : 'Next season'}</th><th scope="col">Knowledge</th><th scope="col">Action</th></tr></thead><tbody>{players.map(player => {
          const current = contractForSeason(season.employment, player.id, season.seasonNumber)
          const next = contractForSeason(season.employment, player.id, nextYear)
          const displayed = selectedView === 'next' ? next : current
          const owner = season.clubs.find(team => team.players.some(member => member.id === player.id))
          const record = owner?.players.find(member => member.id === player.id) ?? player
          const paidApproach = marketOpen && datedMarket && !!next && next.clubId !== club.id
          const quote = paidApproach ? quoteTransferOffer(season, player.id, MIN_CONTRACT_WAGE, 1, requiredTransferFee(season, player.id)) : quotePlayerContract(season, player.id, negotiations ? MIN_CONTRACT_WAGE : getSeasonWage(player.id), 1)
          const secured = next?.clubId === club.id
          const latest = getLatestNegotiation(season, player.id)
          const pendingOffer = openOffers.find(offer => offer.playerId === player.id)
          const action = pendingOffer ? 'Review offer' : paidApproach ? 'Offer transfer' : latest && latest.outcome !== 'accepted' ? 'Continue talks' : current?.clubId === club.id ? 'Renew' : 'Offer contract'
          return <tr key={player.id} data-contract-player={player.id}>
            <th scope="row"><button className="transfers-player transfers-player-report" aria-label={`Scouting report for ${player.name}`} data-transfer-scouting={player.id} onClick={() => onOpenScouting(player.id)} disabled={disabled}><span aria-hidden="true"><Avatar player={record} color={owner?.color ?? '#687385'} size={30} /></span><span><strong>{player.name}</strong><small>{player.position} · {player.heightCm} cm</small></span></button></th>
            <td>{selectedView === 'transfer' ? season.clubs.find(team => team.id === next?.clubId)?.name : selectedView === 'market' ? owner?.name ?? 'Free agent' : displayed ? seasonLabel(displayed.endsSeason) : 'No contract'}</td>
            <td>{money(selectedView === 'transfer' ? requiredTransferFee(season, player.id) : selectedView === 'market' ? getSeasonWage(player.id) : displayed?.seasonWage ?? 0)}</td>
            <td>{selectedView === 'transfer' ? money(next?.seasonWage ?? 0) : !hasNextYear ? 'Calendar limit' : selectedView === 'next' && next ? seasonLabel(next.startsSeason) : secured ? <span className="transfers-secured">Signed · {money(next.seasonWage)}</span> : next ? `Joining ${season.clubs.find(team => team.id === next.clubId)!.name}` : pendingOffer ? <span className="transfers-secured">{marketOfferStatus(pendingOffer)}</span> : <span className="transfers-expiring">{selectedView === 'market' ? 'Available' : 'Not renewed'}</span>}{marketOpen && <RivalOfferBadge season={season} playerId={player.id} onReview={() => openOffer(player.id)} disabled={disabled} />}</td>
            <td className="transfers-knowledge"><span>{knowledgeLabel(getPlayerKnowledge(season, player.id))}</span><button className="text-button" data-transfer-shortlist={player.id} aria-pressed={shortlist.includes(player.id)} aria-label={`${shortlist.includes(player.id) ? 'Remove' : 'Add'} ${player.name} ${shortlist.includes(player.id) ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(player.id, !shortlist.includes(player.id))} disabled={disabled || !scoutingEnabled}>{shortlist.includes(player.id) ? 'Shortlisted' : 'Add to shortlist'}</button></td>
            <td className="transfers-action">{latest && (!datedMarket || season.status !== 'complete') && <small className="transfer-latest-response">{negotiationOutcome(latest)}</small>}{!hasNextYear ? 'No further contracts' : selectedView === 'next' || secured ? <span><Icon name="check" size={14} /> {seasonLabel(next!.endsSeason)}</span> : <><button id={`transfer-player-${player.id}`} className="button small" aria-label={`${action} ${player.name}`} onClick={() => openOffer(player.id)} disabled={disabled || !quote.canOffer && !pendingOffer} aria-describedby={!quote.canOffer ? `contract-reason-${player.id}` : undefined}>{action}<Icon name="chevron" size={13} /></button>{!quote.canOffer && <details className="transfer-unavailable"><summary>Unavailable</summary><small id={`contract-reason-${player.id}`}>{quote.reason}</small></details>}</>}</td>
          </tr>
        })}{!players.length && <tr><td colSpan={6} className="transfers-empty">{query || position !== 'all' ? 'No players match these filters.' : selectedView === 'next' ? 'No players are signed for next season. Review your current squad to offer renewals.' : selectedView === 'market' ? 'No players are available for next season.' : selectedView === 'transfer' ? 'No contracted players can be approached now.' : 'No players in this squad.'}</td></tr>}</tbody></table></div>
        {hasNextYear && <details className="game-disclosure"><summary><Icon name="calendar" size={15} />Contract rules & budget</summary><p className="transfers-note">{marketOpen ? datedMarket ? 'Send offers before the displayed closing date. Signed players join on opening day.' : 'Recruit until you start next season. Unsigned players then leave.' : 'Renew your players now. Outside recruitment opens after the final matchday.'} Contracts last 1–{MAX_CONTRACT_SEASONS} seasons.</p><dl className="transfers-summary"><div><dt>Signed salaries / year</dt><dd data-contract-committed={summary.seasonWages}>{money(summary.seasonWages)}</dd></div><div><dt>Pending offers / year</dt><dd data-contract-reserved={summary.reservedWages}>{money(summary.reservedWages)}</dd></div><div><dt>Total salary budget / year</dt><dd>{money(summary.budget)}</dd></div><div><dt>Available after squad reserve</dt><dd data-contract-spendable={summary.spendableBudget}>{money(summary.spendableBudget)}</dd></div></dl></details>}
      </section>
      {negotiations && <section className="transfers-conversations panel" aria-labelledby="negotiation-activity-title"><header className="transfers-heading"><h2 id="negotiation-activity-title">Recent negotiations</h2><span>Latest response per player</span></header>{recentConversations.length ? <div className="transfers-table-scroll" role="region" aria-label="Saved player negotiations" tabIndex={0}><table className="transfers-table negotiation-activity-table"><thead><tr><th scope="col">Player</th><th scope="col">Offer</th><th scope="col">Player response</th><th scope="col">Date</th><th scope="col">Conversation</th></tr></thead><tbody>{recentConversations.map(record => {
        const player = getDevelopmentPlayer(record.playerId)
        const lastOffer = getMarketOffers(season).filter(offer => offer.playerId === player.id).at(-1) ?? null
        const destination = lastOffer?.status === 'lost' ? season.clubs.find(team => team.id === chosenMarketOffer(season, lastOffer)?.clubId) : null
        return <tr key={record.id} data-negotiation-player={record.playerId}><th scope="row">{player.name}</th><td>{money(record.offeredWage)} / season<small>{record.offeredSeasons} {record.offeredSeasons === 1 ? 'season' : 'seasons'} · from {seasonLabel(record.startsSeason)}</small></td><td><strong>{negotiationOutcome(record)}</strong><small>{destination ? `Talks closed · chose ${destination.name}` : record.counterOffer ? `${money(record.counterOffer.seasonWage)} · ${record.counterOffer.seasons} seasons` : record.outcome === 'accepted' ? 'Contract signed' : 'Improve the offer'}</small></td><td><time dateTime={record.date}>{scoutingDate(record.date)}</time><small>{record.status === 'complete' ? 'Offseason' : `Matchday ${record.round}`}</small></td><td><button className="button small" data-review-negotiation={player.id} aria-label={`Review negotiations with ${player.name}`} onClick={() => openOffer(player.id, true)} disabled={disabled}>Review<Icon name="chevron" size={13} /></button></td></tr>
      })}</tbody></table></div> : <p className="transfers-empty">No replies recorded yet. Open a player’s contract to start talks.</p>}</section>}
      <p className="transfers-model-note">Fictional development wages. The board allocation limits annual promises; wages are paid through the season payroll. Contract decisions trigger an automatic save. Export keeps a separate file backup.</p>
    </>}
    {selected && enabled && <PlayerContractOffer key={selected.id} season={season} player={selected} disabled={disabled} historyOnly={historyOnly} onContinue={() => setHistoryOnly(false)} onClose={() => setOfferId(null)} onOffer={onOffer} onWithdrawOffer={onWithdrawOffer} onOpenScouting={onOpenScouting} onShortlist={onShortlist} />}
  </div>
}

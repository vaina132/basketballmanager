import { clubRosterLimit, minRosterSize } from '../world/club-roster-policy'
import { CapSheet } from './CapSheet'
import { clubRetirementsThisSeason, PlayerCareerStatus } from './PlayerLifecycle'
import { getPlayerRetirement } from '../world/lifecycle-policy'
import { getCareerPlayer, getCareerWage } from '../world/player-catalog'
import type { ContractOfferOptions } from '../domain/employment'
import type { ContractRequestReply } from '../domain/relationships'
import { useEffect, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { TransferPaymentPlan } from '../domain/transfer-payments'
import type { Position } from '../domain/types'
import { contractForSeason, getClubContractSummary, MIN_CONTRACT_WAGE, quotePlayerContract } from '../world/employment-policy'
import { MAX_SEASON_NUMBER, seasonLabel as supportedSeasonLabel } from '../world/season'
import { getLatestNegotiation } from '../world/negotiations'
import { getMarketOffers } from '../world/market-policy'
import { getInSeasonOffers } from '../world/recruitment-policy'
import { awaitsContractReply, getClubContractRequests, getContractRequest } from '../world/relationships'
import { Avatar } from './Avatar'
import { BuyoutHistory, PlayerBuyout } from './PlayerBuyout'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { negotiationOutcome, PlayerContractOffer } from './PlayerContractOffer'
import { marketOfferStatus, RivalOfferBadge } from './OffseasonMarketPanel'
import { ReleaseClauseValue, transferEntryQuote } from './ReleaseClause'
import { ContractRequestCard, contractRequestSummary } from './ContractRequestCard'
import { ContractBudgetSummary, ContractDelegation, ContractsEnablePanel } from './contract-panels'
import './transfers-workspace.css'
import { formatMoney } from './money-format'

interface SquadContractsProps {
  season: SeasonState
  disabled: boolean
  onEnable: () => void
  onDelegation: (delegated: boolean) => void
  onOffer: (playerId: string, seasonWage: number, seasons: number, transferFee?: number, paymentPlan?: TransferPaymentPlan, options?: ContractOfferOptions) => void
  onWithdrawOffer: (offerId: string) => void
  onBuyout: (playerId: string) => void
  onContractReply: (playerId: string, reply: ContractRequestReply) => void
  onOpenScouting: (playerId: string) => void
  onShortlist: (playerId: string, shortlisted: boolean) => void
  /** The player search, to find a replacement. */
  onOpenTransfers: () => void
  /** An own player whose contract offer opens straight away (a contract request's talks, or the Inbox). */
  focusedPlayerId: string | null
  onClearFocusedPlayer: () => void
}

const money = (cents: number) => formatMoney(cents)
const seasonLabel = (number: number) => number > MAX_SEASON_NUMBER ? 'Calendar limit' : supportedSeasonLabel(number)
const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C']

/**
 * Squad > Contracts (owner, 16 November 2026): the own squad's renewals, contract ends, contract requests and buyouts,
 * moved out of Transfers so Transfers is the place to find new players.
 */
export function SquadContracts({ season, disabled, onEnable, onDelegation, onOffer, onWithdrawOffer, onBuyout, onContractReply, onOpenScouting, onShortlist, onOpenTransfers, focusedPlayerId, onClearFocusedPlayer }: SquadContractsProps) {
  const [view, setView] = useState<'squad' | 'next'>('squad')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<Position | 'all'>('all')
  const [offerId, setOfferId] = useState<string | null>(null)
  const [historyOnly, setHistoryOnly] = useState(false)
  const [buyoutId, setBuyoutId] = useState<string | null>(null)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const enabled = season.employment.enabledSince !== null
  const negotiations = season.negotiations.enabledSince !== null
  const datedMarket = season.market.enabledSince !== null
  const openOffers = getMarketOffers(season, season.managedClubId, true)
  const nextYear = season.seasonNumber + 1
  const hasNextYear = nextYear <= MAX_SEASON_NUMBER
  const summary = getClubContractSummary(season, club.id, nextYear)
  const minimumRoster = minRosterSize(season, club.id)
  const marketOpen = enabled && hasNextYear && season.status === 'complete' && season.employment.market?.seasonNumber === nextYear
  const inSeasonOffers = getInSeasonOffers(season, club.id, true)
  const nextSquadOffers = [...openOffers, ...inSeasonOffers.filter(offer => offer.seasonNumber + offer.seasons - 1 >= nextYear)]
  const selectedView = hasNextYear ? view : 'squad'
  const nextPlayers = summary.contracts.map(contract => getCareerPlayer(season, contract.playerId))
  const source = selectedView === 'next' ? nextPlayers : club.players
  const players = source.filter(player => player.name.toLowerCase().includes(query.trim().toLowerCase()) && (position === 'all' || player.position === position))
  const retirements = club.players.flatMap(player => { const retirement = getPlayerRetirement(season, player.id); return retirement.status === 'announced' && retirement.notice ? [{ player, notice: retirement.notice }] : [] })
  const retired = clubRetirementsThisSeason(season)
  const expiring = enabled ? club.players.filter(player => (getPlayerRetirement(season, player.id).notice?.lastSeason ?? Infinity) > season.seasonNumber && contractForSeason(season.employment, player.id, season.seasonNumber)?.endsSeason === season.seasonNumber && !contractForSeason(season.employment, player.id, nextYear)).length : 0
  const requests = getClubContractRequests(season, club.id, season.seasonNumber).filter(request => awaitsContractReply(season, request))
  const selected = offerId ? getCareerPlayer(season, offerId) : null
  const selectedBuyout = buyoutId ? getCareerPlayer(season, buyoutId) : null

  // Opening renewal talks (a contract request) or an Inbox link goes straight to the player's contract offer.
  useEffect(() => {
    if (!focusedPlayerId || !enabled) return
    setHistoryOnly(false)
    setOfferId(focusedPlayerId)
    onClearFocusedPlayer()
  }, [focusedPlayerId, enabled, onClearFocusedPlayer])

  function openOffer(playerId: string, review = false) {
    setHistoryOnly(review)
    setOfferId(playerId)
  }

  if (!enabled) return <div className="transfers-workspace squad-contracts"><ContractsEnablePanel season={season} disabled={disabled} onEnable={onEnable} /></div>

  return <div className="transfers-workspace squad-contracts" id="squad-contracts">
    <section className="transfers-overview panel" aria-labelledby="squad-contracts-heading">
      <header className="transfers-heading"><div><h2 id="squad-contracts-heading" tabIndex={-1}>Contracts</h2><span>{seasonLabel(season.seasonNumber)}</span></div><button className="button small" onClick={onOpenTransfers} disabled={disabled}>Find players<Icon name="search" size={14} /></button></header>
      {hasNextYear && <div className="transfers-squad-plan"><div className="transfers-squad-count"><Icon name="people" size={24} /><div><strong data-next-contract-roster={summary.rosterSize}>{summary.rosterSize}<small> / {minimumRoster}–{clubRosterLimit(season, club.id)}</small></strong><span>Next season's squad</span></div></div><div className="transfers-squad-slots" aria-hidden="true">{Array.from({ length: Math.max(minimumRoster, summary.rosterSize + summary.reservedRosterSize) }, (_, index) => {
        const contract = summary.contracts[index]
        const pending = nextSquadOffers[index - summary.contracts.length]
        return contract ? <span className="transfers-filled-slot" key={contract.id} title={getCareerPlayer(season, contract.playerId).name}><Avatar player={getCareerPlayer(season, contract.playerId)} color={club.color} size={34} /></span> : pending ? <span className="transfers-reserved-slot" key={pending.id} title={`Offer pending: ${getCareerPlayer(season, pending.playerId).name}`}><Avatar player={getCareerPlayer(season, pending.playerId)} color={club.color} size={34} /></span> : <span className="transfers-empty-slot" key={index}><Icon name="people" size={19} /></span>
      })}</div><div className="transfers-squad-goal"><strong>{summary.rosterSize < minimumRoster ? `${minimumRoster - summary.rosterSize} more needed` : 'Squad ready'}</strong><span data-expiring-contracts={expiring}>{summary.reservedRosterSize ? `${summary.reservedRosterSize} ${summary.reservedRosterSize === 1 ? 'offer holding a place' : 'offers holding places'}` : `${expiring} expiring contracts`}</span></div></div>}
      <CapSheet season={season} clubId={club.id} />
      {retirements.length > 0 && <div className="transfers-retirements" data-contract-retirements={retirements.length}><Icon name="calendar" size={19} /><span><strong>Retirement plans</strong> &middot; {retirements.map(({ player, notice }) => player.name + ': final season ' + seasonLabel(notice.lastSeason)).join('; ')}</span></div>}
      {retired.length > 0 && <details className="transfers-retired-history"><summary>Retired this season &middot; {retired.length}</summary><div>{retired.map(notice => <div key={notice.id}><span><strong>{getCareerPlayer(season, notice.playerId).name}</strong><small>Retired {scoutingDate(notice.retiredOn)}</small></span><button className="button small" onClick={() => onOpenScouting(notice.playerId)} disabled={disabled}>View player<Icon name="chevron" size={13} /></button></div>)}</div></details>}
      {!hasNextYear && <p className="transfers-note">The calendar has reached its final supported season. Existing records remain available; further seasons and contracts cannot be created.</p>}
    </section>

    {requests.length > 0 && <div className="squad-contract-requests" id="squad-contract-requests">{requests.map(request => <ContractRequestCard key={request.id} season={season} request={request} busy={disabled} onReply={onContractReply} />)}</div>}

    <section className="transfers-players panel" aria-labelledby="contracts-list-title">
      <header className="transfers-heading"><h2 id="contracts-list-title">{selectedView === 'next' ? `Squad for ${seasonLabel(nextYear)}` : 'Current squad contracts'}</h2><span>{players.length} {players.length === 1 ? 'player' : 'players'}</span></header>
      <div className="transfers-toolbar"><div className="segmented" role="group" aria-label="Contract lists"><button aria-pressed={selectedView === 'squad'} className={selectedView === 'squad' ? 'selected' : ''} onClick={() => setView('squad')} disabled={disabled}>Current squad</button>{hasNextYear && <button aria-pressed={selectedView === 'next'} className={selectedView === 'next' ? 'selected' : ''} onClick={() => setView('next')} disabled={disabled}>Next season ({summary.rosterSize})</button>}</div><div className="transfers-filters"><label htmlFor="contract-player-search">Player<input id="contract-player-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find player" disabled={disabled} /></label><label htmlFor="contract-position">Position<select id="contract-position" value={position} onChange={event => setPosition(event.target.value as Position | 'all')} disabled={disabled}><option value="all">All</option>{positions.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div></div>
      <div className="transfers-table-scroll" tabIndex={0} role="region" aria-label="Player contracts"><table className="transfers-table squad-contracts-table"><thead><tr><th scope="col">Player</th><th scope="col">Contract through</th><th scope="col">Annual wage</th><th scope="col">{selectedView === 'next' ? 'Starts' : 'Next season'}</th><th scope="col">Action</th></tr></thead><tbody>{players.map(player => {
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
        const request = getContractRequest(season, player.id)
        const action = pendingOffer ? 'Review offer' : paidApproach ? 'Offer transfer' : latest && latest.outcome !== 'accepted' ? 'Continue talks' : current?.clubId === club.id ? 'Renew' : 'Offer contract'
        return <tr key={player.id} data-contract-player={player.id}>
          <th scope="row"><button className="transfers-player transfers-player-report" aria-label={`Scouting report for ${player.name}`} data-transfer-scouting={player.id} onClick={() => onOpenScouting(player.id)} disabled={disabled}><span aria-hidden="true"><Avatar player={record} color={owner?.color ?? '#687385'} size={30} /></span><span><strong>{player.name}</strong><PlayerCareerStatus season={season} playerId={player.id} compact /><small>{player.position} · {player.heightCm} cm</small></span></button></th>
          <td data-label="Contract through">{displayed ? seasonLabel(displayed.endsSeason) : 'No contract'}{displayed?.releaseFee !== undefined && <ReleaseClauseValue fee={displayed.releaseFee} />}</td>
          <td data-label="Annual wage">{money(displayed?.seasonWage ?? 0)}</td>
          <td data-label={selectedView === 'next' ? 'Starts' : 'Next season'}>{!hasNextYear ? 'Calendar limit' : retirement && retirement.lastSeason < nextYear ? <span className="transfers-expiring">Retiring</span> : selectedView === 'next' && next ? seasonLabel(next.startsSeason) : secured ? <span className="transfers-secured">Signed · {money(next.seasonWage)}</span> : next ? `Joining ${season.clubs.find(team => team.id === next.clubId)!.name}` : pendingOffer ? <span className="transfers-secured">{marketOfferStatus(pendingOffer)}</span> : <span className="transfers-expiring">Not renewed</span>}{selectedView !== 'next' && secured && next?.releaseFee !== undefined && next.id !== displayed?.id && <ReleaseClauseValue fee={next.releaseFee} />}{request && ['talks', 'promised'].includes(request.status) && <small className="squad-contract-request" data-contract-request-row={request.status}>{contractRequestSummary(request)}</small>}{marketOpen && <RivalOfferBadge season={season} playerId={player.id} onReview={() => openOffer(player.id)} disabled={disabled} />}</td>
          <td className="transfers-action">{latest && (!datedMarket || season.status !== 'complete') && <small className="transfer-latest-response">{negotiationOutcome(latest)}</small>}{!hasNextYear ? 'No further contracts' : selectedView === 'next' || secured ? <><span><Icon name="check" size={14} /> {seasonLabel(next!.endsSeason)}</span>{marketOpen && datedMarket && secured && <button className="text-button transfers-buyout-action" data-buyout-player={player.id} aria-label={`Buy out contract for ${player.name}`} onClick={() => setBuyoutId(player.id)} disabled={disabled}>Buy out<Icon name="chevron" size={13} /></button>}</> : <><button id={`transfer-player-${player.id}`} className="button small" aria-label={`${action} ${player.name}`} onClick={() => openOffer(player.id)} disabled={disabled || !quote.canOffer && !pendingOffer} aria-describedby={!quote.canOffer ? `contract-reason-${player.id}` : undefined}>{action}<Icon name="chevron" size={13} /></button>{!quote.canOffer && <details className="transfer-unavailable"><summary>Unavailable</summary><small id={`contract-reason-${player.id}`}>{quote.reason}</small></details>}</>}</td>
        </tr>
      })}{!players.length && <tr><td colSpan={5} className="transfers-empty">{query || position !== 'all' ? 'No players match these filters.' : selectedView === 'next' ? 'No players are signed for next season. Review your current squad to offer renewals.' : 'No players in this squad.'}</td></tr>}</tbody></table></div>
      {hasNextYear && <ContractBudgetSummary season={season} note={marketOpen ? datedMarket ? 'Renew before the displayed closing date. Unsigned players leave when next season starts.' : 'Renew until you start next season. Unsigned players then leave.' : 'Renew your players for next season; renewals take effect on its opening day.'} />}
    </section>
    {hasNextYear && <ContractDelegation season={season} disabled={disabled} onDelegation={onDelegation} />}
    <BuyoutHistory season={season} />
    {selectedBuyout && <PlayerBuyout key={selectedBuyout.id} season={season} player={selectedBuyout} disabled={disabled} onClose={() => setBuyoutId(null)} onBuyout={onBuyout} onFindReplacement={() => { setBuyoutId(null); onOpenTransfers() }} />}
    {selected && <PlayerContractOffer key={selected.id} season={season} player={selected} disabled={disabled} historyOnly={historyOnly} onContinue={() => setHistoryOnly(false)} onClose={() => setOfferId(null)} onOffer={onOffer} onWithdrawOffer={onWithdrawOffer} onOpenScouting={onOpenScouting} onShortlist={onShortlist} />}
  </div>
}

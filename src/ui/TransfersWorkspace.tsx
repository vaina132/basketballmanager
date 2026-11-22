import { clubRosterLimit } from '../world/club-roster-policy'
import { PlayerCareerStatus } from './PlayerLifecycle'
import { getPlayerRetirement } from '../world/lifecycle-policy'
import { getCareerPlayer, getCareerWage } from '../world/player-catalog'
import { contractAskingWage } from '../world/contract-roles'
import type { ContractOfferOptions } from '../domain/employment'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { TransferPaymentPlan } from '../domain/transfer-payments'
import type { Position } from '../domain/types'
import { contractForSeason, getClubContractSummary, MIN_CONTRACT_WAGE, MIN_ROSTER_SIZE, quotePlayerContract } from '../world/employment-policy'
import { MAX_SEASON_NUMBER, seasonLabel as supportedSeasonLabel } from '../world/season'
import { getPlayerKnowledge } from '../world/scouting-policy'
import { getLatestNegotiation } from '../world/negotiations'
import { MIN_TRANSFER_FEE } from '../world/transfers-policy'
import { getLiveMarketOffers, getMarketOffers, getMarketStartReason, offseasonContinueFirst } from '../world/market-policy'
import { getInSeasonOffers, quoteInSeasonOffer, quoteInSeasonTransferOffer } from '../world/recruitment-policy'
import { seasonLeagues } from '../world/divisions'
import { worldOf } from '../world/career-world'
import { InSeasonOfferDialog, InSeasonRecruitmentPanel } from './InSeasonRecruitment'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { Nationality, playerNationality } from './Nationality'
import { knowledgeLabel, scoutingDate, ScoutingKnowledge } from './ScoutingKnowledge'
import { negotiationOutcome, PlayerContractOffer } from './PlayerContractOffer'
import { chosenMarketOffer, OffseasonMarketPanel, RivalOfferBadge } from './OffseasonMarketPanel'
import { ReleaseClauseValue, transferEntryQuote } from './ReleaseClause'
import { PlayerRating } from './PlayerRating'
import { GeneratedTag } from './GeneratedTag'
import { ContractDelegation, ContractsEnablePanel } from './contract-panels'
import type { ReactNode } from 'react'
import { scoutingQuoter, scoutNetworkRange, usesScoutNetwork } from '../world/scouting-policy'
import { getScoutingDiscovery } from '../world/scouting-discovery'
import { getClubScouts } from '../world/scout-policy'
import { getClubListings, usesPlayerListings } from '../world/listings'
import type { ListingChoice } from './PlayerListingControl'
import { DEFAULT_TRANSFER_FILTERS, filterTransferRows, getTransferSearch, sortTransferRows, type TransferRowKind, type TransferSearchFilters, type TransferSort } from './transfer-search'
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
  onWithdrawOffer: (offerId: string) => void
  onDelegation: (delegated: boolean) => void
  onOffer: (playerId: string, seasonWage: number, seasons: number, transferFee?: number, paymentPlan?: TransferPaymentPlan, options?: ContractOfferOptions) => void
  onClubDecision: (offerId: string, response: 'accept' | 'reject' | 'counter') => void
  focusedPlayerId: string | null
  onClearFocusedPlayer: () => void
  onOpenScouting: (playerId: string) => void
  onShortlist: (playerId: string, shortlisted: boolean) => void
  /** Squad > Contracts: renewals, contract ends and requests of the own squad. */
  onOpenContracts: () => void
  /** The Scouting tab, where reports, the shortlist and observations live. */
  onOpenScoutingPage: () => void
  /** Owner feedback (22 November 2026): scouting lives inside Transfers as a tab. */
  tab?: TransfersTab
  onTabChange?: (tab: TransfersTab) => void
  scouting?: ReactNode
  /** One click: queue a scout report on a player. */
  onScout?: (playerId: string) => void
  /** Staff > Scouts, where scouts are hired. */
  onOpenScouts?: () => void
  /** Format 78: change a player's transfer or loan listing. */
  onListing?: (playerId: string, choice: ListingChoice) => void
}

export type TransfersTab = 'search' | 'scouting'

const money = (cents: number) => formatEuros(cents)
const seasonLabel = (number: number) => number > MAX_SEASON_NUMBER ? 'Calendar limit' : supportedSeasonLabel(number)
const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C']
const PAGE_SIZE = 30
const STAR_OPTIONS = [2, 3, 3.5, 4, 4.5]
const WAGE_OPTIONS = [5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000, 200_000_000, 400_000_000]
const FEE_OPTIONS = [5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000, 250_000_000, 500_000_000, 1_000_000_000]
const SORTS: { id: TransferSort; label: string }[] = [{ id: 'rating', label: 'Best rated' }, { id: 'wage', label: 'Lowest wage' }, { id: 'fee', label: 'Lowest fee' }, { id: 'age', label: 'Youngest' }, { id: 'contract', label: 'Contract ending soonest' }, { id: 'name', label: 'Name' }]
const optionalNumber = (value: string) => value === '' ? null : Number(value)

interface RowAction { label: string; disabled: boolean; reason: string | null; open: () => void }

/**
 * Transfers (owner, 16 November 2026): a player search to bring players in, with the shortlist beside it. Offers for
 * your players, your open offers and sales stay below; the own squad's contracts are on Squad > Contracts.
 */
export function TransfersWorkspace({ season, disabled, onEnable, onEnableNegotiations, onEnableInSeason, onEnableInSeasonTransfers, onInSeasonTransferOffer, onInSeasonClubDecision, onInSeasonOffer, onWithdrawInSeasonOffer, onOpenMatch, onOpenAcademy, onEnableMarket, onWithdrawOffer, onDelegation, onOffer, onClubDecision, focusedPlayerId, onClearFocusedPlayer, onOpenScouting, onShortlist, onOpenContracts, onOpenScoutingPage, tab = 'search', onTabChange, scouting, onScout, onOpenScouts, onListing }: TransfersWorkspaceProps) {
  const [filters, setFilters] = useState<TransferSearchFilters>(DEFAULT_TRANSFER_FILTERS)
  const [shown, setShown] = useState(PAGE_SIZE)
  const [offerId, setOfferId] = useState<string | null>(null)
  const [inSeasonPlayerId, setInSeasonPlayerId] = useState<string | null>(null)
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
  const selected = offerId ? getCareerPlayer(season, offerId) : null
  const inSeasonPlayer = inSeasonPlayerId ? getCareerPlayer(season, inSeasonPlayerId) : null
  const inSeasonOffers = getInSeasonOffers(season, club.id, true)
  // Recomputed only when the career changes, not on every filter keystroke.
  const search = useMemo(() => getTransferSearch(season), [season])
  const rows = sortTransferRows(filterTransferRows(search.rows, filters), filters.sort)
  const rowById = new Map(search.rows.map(row => [row.player.id, row]))
  const filtered = JSON.stringify({ ...filters, sort: 'rating' }) !== JSON.stringify(DEFAULT_TRANSFER_FILTERS)
  const leagues = seasonLeagues(worldOf(season), season.divisions)
  const countries = [...new Set(leagues.map(league => league.country))]
  const contractBase = search.phase === 'offseason' ? nextYear : season.seasonNumber
  const expiring = enabled ? club.players.filter(player => (getPlayerRetirement(season, player.id).notice?.lastSeason ?? Infinity) > season.seasonNumber && contractForSeason(season.employment, player.id, season.seasonNumber)?.endsSeason === season.seasonNumber && !contractForSeason(season.employment, player.id, nextYear)).length : 0
  const startReason = datedMarket ? getMarketStartReason(season) : summary.rosterSize < MIN_ROSTER_SIZE ? `Sign ${MIN_ROSTER_SIZE - summary.rosterSize} more ${MIN_ROSTER_SIZE - summary.rosterSize === 1 ? 'player' : 'players'} for next season.` : summary.rosterSize > clubRosterLimit(season) ? `The squad must contain no more than ${clubRosterLimit(season)} players.` : null
  // Browser play-through (16 November 2026): when offers or other squads hold up the next season, continuing the offseason is the next step.
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
  // Owner feedback (22 November 2026): one click queues a scout report; it arrives after the next matchday.
  const network = usesScoutNetwork(season) && season.scouting.enabledSince !== null
  const scoutCount = season.scouts.enabledSince ? getClubScouts(season, club.id).length : 0
  const quoter = useMemo(() => scoutingQuoter(season), [season])
  const queued = new Set(season.scouting.clubs[club.id]!.assignments.map(assignment => assignment.playerId))
  const listings = getClubListings(season)
  function scoutButton(playerId: string) {
    if (!onScout || season.scouting.enabledSince === null) return null
    const name = getCareerPlayer(season, playerId).name
    if (queued.has(playerId)) return <span className="transfer-scout-queued" data-transfer-scouting={playerId}><Icon name="clock" size={13} />Report after next match</span>
    const quote = quoter(playerId)
    return <button className="text-button transfer-scout" data-transfer-scout={playerId} aria-label={`Scout ${name}`} title={quote.reason ?? 'A scout watches his next match; the report sharpens his ratings.'} onClick={() => onScout(playerId)} disabled={disabled || !quote.canAssign}><Icon name="search" size={13} />Scout</button>
  }
  const scoutingEnabled = season.scouting.enabledSince !== null
  // Decisions that must not be missed below the search: offers for your players and counteroffers to your offers.
  const incoming = season.status === 'active' ? getInSeasonOffers(season).filter(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === club.id).length : marketOpen ? getLiveMarketOffers(season).filter(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === club.id).length : 0
  const counters = season.status === 'active' ? inSeasonOffers.filter(offer => offer.status === 'countered').length : openOffers.filter(offer => offer.status === 'countered' || offer.transfer?.clubStatus === 'countered').length
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

  function updateFilters(change: Partial<TransferSearchFilters>) {
    setFilters(current => ({ ...current, ...change }))
    setShown(PAGE_SIZE)
  }

  function showSearch(change: Partial<TransferSearchFilters> = {}) {
    setFilters({ ...DEFAULT_TRANSFER_FILTERS, ...change })
    setShown(PAGE_SIZE)
    requestAnimationFrame(() => document.getElementById('transfer-search-title')?.scrollIntoView({ block: 'nearest' }))
  }

  /** The existing offer flows: this season's dialog in-season, the offseason contract offer otherwise. */
  function actionFor(playerId: string, kind: TransferRowKind | null): RowAction | null {
    const name = getCareerPlayer(season, playerId).name
    const inSeasonOffer = inSeasonOffers.find(offer => offer.playerId === playerId)
    const marketOffer = openOffers.find(offer => offer.playerId === playerId)
    if (inSeasonOffer) return { label: 'Review offer', disabled: false, reason: null, open: () => setInSeasonPlayerId(playerId) }
    if (marketOffer) return { label: 'Review offer', disabled: false, reason: null, open: () => openOffer(playerId) }
    if (kind === 'season-free' || kind === 'season-transfer') {
      const paid = kind === 'season-transfer'
      const quote = paid ? quoteInSeasonTransferOffer(season, playerId, MIN_CONTRACT_WAGE, 1, MIN_TRANSFER_FEE) : quoteInSeasonOffer(season, playerId, MIN_CONTRACT_WAGE)
      return { label: paid ? 'Offer transfer' : 'Sign for this season', disabled: !quote.canOffer, reason: quote.canOffer ? null : quote.reason, open: () => setInSeasonPlayerId(playerId) }
    }
    if (kind === 'offseason-free' || kind === 'offseason-transfer') {
      const paid = kind === 'offseason-transfer'
      const quote = paid ? transferEntryQuote(season, playerId, MIN_CONTRACT_WAGE) : quotePlayerContract(season, playerId, negotiations ? MIN_CONTRACT_WAGE : getCareerWage(season, playerId), 1)
      const latest = getLatestNegotiation(season, playerId)
      return { label: paid ? 'Offer transfer' : latest && latest.outcome !== 'accepted' ? 'Continue talks' : 'Offer contract', disabled: !quote.canOffer, reason: quote.canOffer ? null : quote.reason ?? `${name} cannot be offered a contract now.`, open: () => openOffer(playerId) }
    }
    return null
  }

  function actionButton(playerId: string, kind: TransferRowKind | null, compact = false) {
    const action = actionFor(playerId, kind)
    const name = getCareerPlayer(season, playerId).name
    if (!action) return null
    return <><button id={compact ? undefined : `transfer-player-${playerId}`} className="button small" data-transfer-action={playerId} aria-label={`${action.label}: ${name}`} onClick={action.open} disabled={disabled || action.disabled} aria-describedby={action.reason && !compact ? `transfer-reason-${playerId}` : undefined} title={compact && action.reason ? action.reason : undefined}>{action.label}<Icon name="chevron" size={13} /></button>{action.reason && !compact && <details className="transfer-unavailable"><summary>Unavailable</summary><small id={`transfer-reason-${playerId}`}>{action.reason}</small></details>}</>
  }

  const ownerOf = (playerId: string) => season.clubs.find(team => team.players.some(player => player.id === playerId))
  const clubName = (clubId: string | null) => clubId ? season.clubs.find(team => team.id === clubId)?.name ?? null : null
  const phaseLabel = search.phase === 'season' ? `${seasonLabel(season.seasonNumber)} · free agents and players at other clubs, joining this season` : search.phase === 'offseason' ? `Offseason · signings for ${seasonLabel(nextYear)}` : !hasNextYear ? 'The calendar has reached its final season' : 'No signings possible right now'

  return <div className="transfers-workspace" onFocusCapture={event => { if (event.target instanceof HTMLElement) lastFocus.current = event.target }}>
    <section className="transfers-overview panel" aria-labelledby="transfers-heading">
      <header className="transfers-heading"><div><h2 id="transfers-heading" tabIndex={-1}>Transfer window</h2><span>{seasonLabel(season.seasonNumber)}{marketOpen ? ' · Offseason recruitment' : season.status === 'active' ? ' · Season transfer window' : ''}</span></div>{enabled && marketOpen && <div className="transfers-start"><small id="contract-season-reason">{startReason ?? `Recruitment is complete: Continue starts ${seasonLabel(nextYear)}.`}</small></div>}</header>
      {enabled && hasNextYear && <div className="transfers-squad-line"><span><Icon name="people" size={16} /><strong data-next-contract-roster={summary.rosterSize}>{summary.rosterSize}</strong> / {MIN_ROSTER_SIZE}–{clubRosterLimit(season)} signed for {seasonLabel(nextYear)}{summary.reservedRosterSize ? ` · ${summary.reservedRosterSize} ${summary.reservedRosterSize === 1 ? 'offer holding a place' : 'offers holding places'}` : ''}</span><button id="transfers-open-contracts" className="text-button" onClick={onOpenContracts} disabled={disabled}>{expiring ? `${expiring} expiring ${expiring === 1 ? 'contract' : 'contracts'} · ` : ''}Your contracts<Icon name="chevron" size={13} /></button></div>}
      {(incoming > 0 || counters > 0) && <div className="transfers-alert" role="status" data-transfer-alert><Icon name="mail" size={16} /><span>{[incoming ? `${incoming} ${incoming === 1 ? 'offer' : 'offers'} for your players ${incoming === 1 ? 'needs' : 'need'} your decision` : '', counters ? `${counters} ${counters === 1 ? 'counteroffer' : 'counteroffers'} to review` : ''].filter(Boolean).join(' · ')}</span><button className="button small" onClick={() => document.getElementById('transfer-business')?.scrollIntoView({ block: 'start' })} disabled={disabled}>Review<Icon name="chevron" size={13} /></button></div>}
    </section>

    {focused && focusedQuote && <section ref={focusedReport} id="transfer-player-review" className="transfer-player-review panel" tabIndex={-1} aria-labelledby="transfer-player-review-title" data-transfer-focus={focused.id} onKeyDown={event => { if (event.key === 'Escape' && !disabled) { event.preventDefault(); event.stopPropagation(); closeFocusedReview() } }}><header className="transfers-heading"><div><h2 id="transfer-player-review-title">{focused.name}</h2><span>{getPlayerRetirement(season, focused.id).status === 'retired' ? 'Retired player' : season.clubs.find(team => team.players.some(player => player.id === focused.id))?.name ?? 'Free agent'} · {focused.position} · {focused.heightCm} cm</span></div><button className="text-button" aria-label="Close player contract review" onClick={closeFocusedReview} disabled={disabled}><Icon name="close" size={14} />Close</button></header><div className="transfer-player-review-body"><PlayerCareerStatus season={season} playerId={focused.id} /><ScoutingKnowledge knowledge={getPlayerKnowledge(season, focused.id)} position={focused.position} /><div className="transfer-player-review-actions">{getPlayerRetirement(season, focused.id).status !== 'retired' && <p>{negotiations ? 'Opening demand · one season' : 'Requested annual wage'} <strong>{money(contractAskingWage(season, season.managedClubId, focused.id))}</strong></p>}{focusedResponse && (!datedMarket || season.status !== 'complete' || focusedOffer?.status === 'countered') && <p className="transfer-latest-response">Latest reply: <strong>{negotiationOutcome(focusedResponse)}</strong></p>}<button id="transfer-focused-offer" className="button primary" onClick={() => focusedInSeason ? setInSeasonPlayerId(focused.id) : openOffer(focused.id)} disabled={disabled || !focusedQuote.canOffer && !focusedOffer} aria-describedby={focusedQuote.reason ? 'transfer-focused-reason' : undefined}>{getPlayerRetirement(season, focused.id).status === 'retired' ? 'Retired' : focusedOffer ? 'Review offer' : focusedInSeasonPaid ? 'Offer transfer' : focusedInSeason ? 'Sign for this season' : focusedTransfer ? 'Offer transfer' : 'Offer contract'}</button>{focusedQuote.reason && <p id="transfer-focused-reason">{focusedQuote.reason}</p>}<button className="button" aria-pressed={shortlist.includes(focused.id)} onClick={() => onShortlist(focused.id, !shortlist.includes(focused.id))} disabled={disabled || !scoutingEnabled || getPlayerRetirement(season, focused.id).status === 'retired' && !shortlist.includes(focused.id)}>{shortlist.includes(focused.id) ? 'Remove from shortlist' : 'Add to shortlist'}</button><button className="text-button" onClick={() => onOpenScouting(focused.id)} disabled={disabled}>Open scouting report<Icon name="chevron" size={14} /></button></div></div></section>}

    {!enabled ? <ContractsEnablePanel season={season} disabled={disabled} onEnable={onEnable} /> : <>
      {scouting && onTabChange && <div className="segmented transfers-tabs" role="group" aria-label="Transfers view"><button id="transfers-tab-search" aria-pressed={tab === 'search'} className={tab === 'search' ? 'selected' : ''} onClick={() => onTabChange('search')} disabled={disabled}><Icon name="search" size={14} />Find players</button><button id="transfers-tab-scouting" aria-pressed={tab === 'scouting'} className={tab === 'scouting' ? 'selected' : ''} onClick={() => onTabChange('scouting')} disabled={disabled}><Icon name="star" size={14} />Scouting &amp; shortlist</button></div>}
      {scouting && tab === 'scouting' ? scouting : <div className="transfer-search-layout">
        <section className="transfer-search panel" aria-labelledby="transfer-search-title" data-transfer-phase={search.phase}>
          <header className="transfers-heading"><div><h2 id="transfer-search-title"><Icon name="search" size={16} />Find players</h2><span>{phaseLabel}</span></div><span data-transfer-results={rows.length}>{rows.length} {rows.length === 1 ? 'player' : 'players'}</span></header>
          <div className="transfer-search-filters" role="search" aria-label="Player search filters">
            <label className="transfer-filter-name" htmlFor="transfer-search-name">Name<input id="transfer-search-name" type="search" value={filters.query} onChange={event => updateFilters({ query: event.target.value })} placeholder="Find player" disabled={disabled} /></label>
            <label htmlFor="transfer-search-position">Position<select id="transfer-search-position" value={filters.position} onChange={event => updateFilters({ position: event.target.value as Position | 'all' })} disabled={disabled}><option value="all">All</option>{positions.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
            <fieldset className="transfer-filter-age"><legend>Age</legend><input id="transfer-search-min-age" type="number" inputMode="numeric" min={15} max={45} value={filters.minAge ?? ''} onChange={event => updateFilters({ minAge: optionalNumber(event.target.value) })} placeholder="Min" aria-label="Minimum age" disabled={disabled} /><span aria-hidden="true">–</span><input id="transfer-search-max-age" type="number" inputMode="numeric" min={15} max={45} value={filters.maxAge ?? ''} onChange={event => updateFilters({ maxAge: optionalNumber(event.target.value) })} placeholder="Max" aria-label="Maximum age" disabled={disabled} /></fieldset>
            <label htmlFor="transfer-search-stars">Rating<select id="transfer-search-stars" value={filters.minStars} onChange={event => updateFilters({ minStars: Number(event.target.value) })} disabled={disabled}><option value={0}>Any</option>{STAR_OPTIONS.map(stars => <option key={stars} value={stars}>{stars}★ or more</option>)}</select></label>
            <label htmlFor="transfer-search-wage">Asking wage<select id="transfer-search-wage" value={filters.maxWage ?? ''} onChange={event => updateFilters({ maxWage: optionalNumber(event.target.value) })} disabled={disabled}><option value="">Any</option>{WAGE_OPTIONS.map(value => <option key={value} value={value}>Up to {money(value)}</option>)}</select></label>
            <label htmlFor="transfer-search-fee">Fee<select id="transfer-search-fee" value={filters.maxFee ?? ''} onChange={event => updateFilters({ maxFee: optionalNumber(event.target.value) })} disabled={disabled}><option value="">Any</option>{FEE_OPTIONS.map(value => <option key={value} value={value}>Up to {money(value)}</option>)}</select></label>
            <label htmlFor="transfer-search-contract">Contract ends<select id="transfer-search-contract" value={filters.contractEndsBy ?? ''} onChange={event => updateFilters({ contractEndsBy: optionalNumber(event.target.value) })} disabled={disabled}><option value="">Any time</option>{[0, 1, 2].filter(step => contractBase + step <= MAX_SEASON_NUMBER).map(step => <option key={step} value={contractBase + step}>{step === 0 ? seasonLabel(contractBase) : `By ${seasonLabel(contractBase + step)}`}</option>)}</select></label>
            <label htmlFor="transfer-search-league">League<select id="transfer-search-league" value={filters.league} onChange={event => updateFilters({ league: event.target.value })} disabled={disabled}><option value="all">All leagues</option>{countries.length > 1 && countries.map(country => <option key={country} value={`country:${country}`}>All of {country}</option>)}{leagues.map(league => <option key={league.id} value={`league:${league.id}`}>{league.name}{countries.length > 1 ? ` (${league.country})` : ''}</option>)}<option value="free">Without a club</option></select></label>
            <label className="transfer-filter-check" htmlFor="transfer-search-free"><input id="transfer-search-free" type="checkbox" checked={filters.freeOnly} onChange={event => updateFilters({ freeOnly: event.target.checked })} disabled={disabled} />Free agents only</label>
            <label htmlFor="transfer-search-sort">Sort<select id="transfer-search-sort" value={filters.sort} onChange={event => updateFilters({ sort: event.target.value as TransferSort })} disabled={disabled}>{SORTS.map(sort => <option key={sort.id} value={sort.id}>{sort.label}</option>)}</select></label>
            {filtered && <button className="text-button transfer-filter-clear" onClick={() => updateFilters({ ...DEFAULT_TRANSFER_FILTERS, sort: filters.sort })} disabled={disabled}><Icon name="close" size={13} />Clear filters</button>}
          </div>
          {search.scouted && search.phase !== 'closed' && <p className="transfer-search-range" data-transfer-known={search.knownCount} data-transfer-market={search.marketCount} data-scout-network-range={network ? scoutNetworkRange(season) : undefined}><Icon name="search" size={14} /><span>{network ? <>Your {scoutCount} {scoutCount === 1 ? 'scout knows' : 'scouts know'} <strong>{search.knownCount}</strong> of {search.marketCount} players; their ratings are estimates within ±{scoutNetworkRange(season)}. Better scouts know more players and estimate closer. Press Scout for a sharper report.</> : <>Your scouts know <strong>{search.knownCount}</strong> of the {search.marketCount} players you could sign or approach now. The others are listed without a rating until they are scouted.</>}</span><button className="text-button" onClick={onOpenScouts ?? onOpenScoutingPage} disabled={disabled}>{onOpenScouts ? 'Hire scouts' : 'Scouting'}<Icon name="chevron" size={13} /></button></p>}
          <div className="transfers-table-scroll transfer-search-scroll" tabIndex={0} role="region" aria-label="Player search results"><table className="transfers-table transfer-search-table"><thead><tr><th scope="col">Player</th><th scope="col">Rating</th><th scope="col">Asking wage</th><th scope="col">Fee</th><th scope="col">Contract</th><th scope="col">Action</th></tr></thead><tbody>{rows.slice(0, shown).map(row => {
            const { player } = row
            const owner = ownerOf(player.id)
            const listed = shortlist.includes(player.id)
            return <tr key={player.id} data-search-player={player.id} data-search-kind={row.kind}>
              <th scope="row"><button className="transfers-player transfers-player-report" aria-label={`Scouting report for ${player.name}`} onClick={() => onOpenScouting(player.id)} disabled={disabled}><span aria-hidden="true"><Avatar player={owner?.players.find(member => member.id === player.id) ?? player} color={owner?.color ?? '#687385'} size={30} /></span><span><strong>{player.name}</strong><GeneratedTag season={season} playerId={player.id} /><small><Nationality country={playerNationality(season, player.id)} compact />{player.position} · {row.age === null ? 'Age unknown' : `${row.age} yrs`} · {clubName(row.clubId) ?? (row.currentClubId ? `${clubName(row.currentClubId)} · contract ending` : 'Free agent')}</small></span></button></th>
              <td className="transfer-search-rating" data-label="Rating"><PlayerRating knowledge={getPlayerKnowledge(season, player.id)} position={player.position} compact /><small>{knowledgeLabel(getPlayerKnowledge(season, player.id))}</small></td>
              <td data-label="Asking wage">{money(row.wage)}<small>per year</small></td>
              <td data-label="Fee">{row.fee === null ? <span className="transfers-secured">Free</span> : money(row.fee)}{row.releaseFee !== null && <ReleaseClauseValue fee={row.releaseFee} />}</td>
              <td data-label="Contract">{row.contractEnds === null ? 'None' : `Until ${seasonLabel(row.contractEnds)}`}{search.phase === 'offseason' && <RivalOfferBadge season={season} playerId={player.id} onReview={() => openOffer(player.id)} disabled={disabled} />}</td>
              <td className="transfers-action">{actionButton(player.id, row.kind)}<button className="text-button transfer-shortlist-toggle" data-transfer-shortlist={player.id} aria-pressed={listed} aria-label={`${listed ? 'Remove' : 'Add'} ${player.name} ${listed ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(player.id, !listed)} disabled={disabled || !scoutingEnabled}><Icon name="star" size={13} />{listed ? 'Shortlisted' : 'Shortlist'}</button>{scoutButton(player.id)}</td>
            </tr>
          })}{!rows.length && <tr><td colSpan={6} className="transfers-empty">{search.phase === 'closed' ? !hasNextYear ? 'The calendar has reached its final supported season; no further contracts can be signed.' : 'No signings are possible right now. Recruitment for next season opens with the offseason.' : filtered ? filters.minStars > 0 && rows.length === 0 && search.rows.some(row => row.rating.max === null) ? 'No rated player matches these filters. Only players your scouts have observed have a rating; assign observations in Scouting.' : 'No players match these filters.' : search.scouted ? 'No player your scouts know can be signed or approached now. Widen the range in Scouting.' : 'No players can be signed or approached now.'}</td></tr>}</tbody></table></div>
          {rows.length > shown && <div className="transfer-search-more"><button className="button small" onClick={() => setShown(value => value + PAGE_SIZE)} disabled={disabled}>Show {Math.min(PAGE_SIZE, rows.length - shown)} more<Icon name="chevron" size={13} /></button><span>{shown} of {rows.length} shown</span></div>}
        </section>

        <aside className="transfer-shortlist panel" aria-labelledby="transfer-shortlist-title">
          <header className="transfers-heading"><h2 id="transfer-shortlist-title"><Icon name="star" size={15} />Shortlist</h2><span>{shortlist.length}</span></header>
          {!scoutingEnabled ? <p className="transfers-empty">Enable scouting to keep a shortlist of targets.</p> : shortlist.length ? <ul className="transfer-shortlist-list">{shortlist.map(playerId => {
            const player = getCareerPlayer(season, playerId)
            const owner = ownerOf(playerId)
            const row = rowById.get(playerId)
            const own = owner?.id === club.id
            const retired = getPlayerRetirement(season, playerId).status === 'retired'
            const action = own || retired ? null : actionFor(playerId, row?.kind ?? null)
            return <li key={playerId} data-shortlist-player={playerId}>
              <button className="transfers-player transfers-player-report" onClick={() => onOpenScouting(playerId)} disabled={disabled} aria-label={`Scouting report for ${player.name}`}><span aria-hidden="true"><Avatar player={owner?.players.find(member => member.id === playerId) ?? player} color={owner?.color ?? '#687385'} size={28} /></span><span><strong>{player.name}</strong><small>{player.position} · {own ? 'Your squad' : retired ? 'Retired' : owner?.name ?? 'Free agent'}</small></span></button>
              <PlayerRating knowledge={getPlayerKnowledge(season, playerId)} position={player.position} compact />
              <div className="transfer-shortlist-actions">{action ? actionButton(playerId, row?.kind ?? null, true) : <small>{own ? 'In your squad' : retired ? 'Retired' : 'Not available now'}</small>}<button className="icon-button" aria-label={`Remove ${player.name} from shortlist`} title="Remove from shortlist" onClick={() => onShortlist(playerId, false)} disabled={disabled}><Icon name="close" size={13} /></button></div>
            </li>
          })}</ul> : <p className="transfers-empty">No players saved yet. Use Shortlist in the search to follow a player.</p>}
          <button className="text-button transfer-shortlist-scouting" onClick={onOpenScoutingPage} disabled={disabled}>Reports and observations<Icon name="chevron" size={13} /></button>
        </aside>
      </div>}

      <section id="transfer-business" className="transfer-business" aria-labelledby="transfer-business-title">
        <h2 id="transfer-business-title" className="transfer-business-title"><Icon name="swap" size={16} />Offers and sales</h2>
        {usesPlayerListings(season) && <section className="transfer-listings panel" aria-labelledby="transfer-listings-title" data-transfer-listings={listings.length}><header className="transfers-heading"><h2 id="transfer-listings-title"><Icon name="swap" size={15} />Your transfer and loan list</h2><span>{listings.length}</span></header>
          {listings.length ? <ul className="transfer-listing-list">{listings.map(listing => { const player = getCareerPlayer(season, listing.playerId); return <li key={listing.playerId} data-listed-player={listing.playerId}><strong>{player.name}</strong><span>{[listing.transfer ? `Transfer · asking ${money(listing.askingFee)}` : '', listing.loan ? 'Loan' : ''].filter(Boolean).join(' · ')}</span>{onListing && <button className="text-button" onClick={() => onListing(listing.playerId, { transfer: false, loan: false })} disabled={disabled}><Icon name="close" size={13} />Remove</button>}</li> })}</ul>
            : <p className="transfers-empty">No players listed. Open a player on Squad and choose Transfer list or Loan list. Offers for your players arrive in the Inbox.</p>}
        </section>}
        <InSeasonRecruitmentPanel onOpenAcademy={onOpenAcademy} season={season} disabled={disabled} onEnable={onEnableInSeason} onEnableTransfers={onEnableInSeasonTransfers} onClubDecision={onInSeasonClubDecision} onReview={setInSeasonPlayerId} onWithdraw={onWithdrawInSeasonOffer} onOpenMatch={onOpenMatch} onBrowse={() => showSearch({ freeOnly: true })} />
        {datedMarket && <OffseasonMarketPanel season={season} disabled={disabled} onWithdraw={onWithdrawOffer} onReview={playerId => openOffer(playerId)} onClubDecision={onClubDecision} />}
        {!negotiations && hasNextYear && <section className="transfers-negotiations-enable panel" aria-labelledby="negotiations-enable-title"><div><h2 id="negotiations-enable-title">Player responses</h2><p>Enable counteroffers, rejections and a saved conversation history for future offers. Longer contracts can carry higher wage demands. Existing signed terms remain binding.</p></div><button id="enable-negotiations" className="button" onClick={onEnableNegotiations} disabled={disabled}>Enable contract negotiations</button></section>}
        {negotiations && !datedMarket && hasNextYear && <section className="transfers-negotiations-enable panel" aria-labelledby="market-enable-title"><div><h2 id="market-enable-title">Offseason calendar</h2><p>Give offseason offers a reply date, an expiry date and reserved wages budget. Current contracts stay signed.</p></div><button id="enable-market" className="button" onClick={onEnableMarket} disabled={disabled}>Enable dated offseason<Icon name="calendar" size={15} /></button></section>}
        {hasNextYear && <ContractDelegation season={season} disabled={disabled} onDelegation={onDelegation} />}
        {negotiations && <details className="transfers-conversations panel game-disclosure" id="negotiation-activity"><summary><Icon name="clock" size={15} />Recent negotiations <small>{recentConversations.length}</small></summary>{recentConversations.length ? <div className="transfers-table-scroll" role="region" aria-label="Saved player negotiations" tabIndex={0}><table className="transfers-table negotiation-activity-table"><thead><tr><th scope="col">Player</th><th scope="col">Offer</th><th scope="col">Player response</th><th scope="col">Date</th><th scope="col">Conversation</th></tr></thead><tbody>{recentConversations.map(record => {
          const player = getCareerPlayer(season, record.playerId)
          const lastOffer = getMarketOffers(season).filter(offer => offer.playerId === player.id).at(-1) ?? null
          const buyout = record.contractId ? season.employment.buyouts.find(item => item.releasedContractIds.includes(record.contractId!)) : null
          const destination = lastOffer?.status === 'lost' ? season.clubs.find(team => team.id === chosenMarketOffer(season, lastOffer)?.clubId) : null
          return <tr key={record.id} data-negotiation-player={record.playerId}><th scope="row">{player.name}</th><td>{money(record.offeredWage)} / season<small>{record.offeredSeasons} {record.offeredSeasons === 1 ? 'season' : 'seasons'} · from {seasonLabel(record.startsSeason)}</small></td><td><strong>{negotiationOutcome(record)}</strong><small>{destination ? `Talks closed · chose ${destination.name}` : record.counterOffer ? `${money(record.counterOffer.seasonWage)} · ${record.counterOffer.seasons} seasons` : record.outcome === 'accepted' ? buyout ? `Bought out ${scoutingDate(buyout.completedOn)}` : 'Contract signed' : 'Improve the offer'}</small></td><td><time dateTime={record.date}>{scoutingDate(record.date)}</time><small>{record.status === 'complete' ? 'Offseason' : `Matchday ${record.round}`}</small></td><td><button className="button small" data-review-negotiation={player.id} aria-label={`Review negotiations with ${player.name}`} onClick={() => openOffer(player.id, true)} disabled={disabled}>Review<Icon name="chevron" size={13} /></button></td></tr>
        })}</tbody></table></div> : <p className="transfers-empty">No replies recorded yet. Open a player’s contract to start talks.</p>}</details>}
        <p className="transfers-model-note">{season.world?.economy ? 'Wages and fees estimated from published 2025-27 club budgets and salary reports.' : 'Fictional development wages.'} The board allocation limits annual promises; wages are paid through the season payroll. Press Save to keep your decisions. Export keeps a separate file backup.</p>
      </section>
    </>}
    {inSeasonPlayer && enabled && <InSeasonOfferDialog key={inSeasonPlayer.id} season={season} player={inSeasonPlayer} disabled={disabled} onClose={() => setInSeasonPlayerId(null)} onOffer={onInSeasonOffer} onTransferOffer={onInSeasonTransferOffer} onWithdraw={onWithdrawInSeasonOffer} onOpenScouting={onOpenScouting} onOpenMatch={onOpenMatch} />}
    {selected && enabled && <PlayerContractOffer key={selected.id} season={season} player={selected} disabled={disabled} historyOnly={historyOnly} onContinue={() => setHistoryOnly(false)} onClose={() => setOfferId(null)} onOffer={onOffer} onWithdrawOffer={onWithdrawOffer} onOpenScouting={onOpenScouting} onShortlist={onShortlist} />}
  </div>
}

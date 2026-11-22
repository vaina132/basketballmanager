import { PlayerCareerStatus } from './PlayerLifecycle'
import { GeneratedTag } from './GeneratedTag'
import { getPlayerRetirement } from '../world/lifecycle-policy'
import { getCareerPlayer, getCareerWage, getCareerPlayerAge, getCareerPlayers } from '../world/player-catalog'
import { offeredContractRole } from '../world/contract-roles'
import { ReleaseClauseValue, transferEntryQuote } from './ReleaseClause'
import { useEffect, useRef, useState } from 'react'
import type { ScoutingObserver } from '../domain/scouts'
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts'
import { ScoutPortrait } from './ScoutPortrait'
import type { SeasonState } from '../domain/season'
import type { Position } from '../domain/types'
import { quoteInSeasonOffer } from '../world/recruitment-policy'
import { contractForSeason, quotePlayerContract } from '../world/employment-policy'
import { getNegotiationDemands } from '../world/negotiations-policy'
import { getPlayerKnowledge, getPotentialKnowledge, getScoutingCapacity, getScoutingObservers, getScoutingEvidence, clubScoutingEvidence, MAX_KNOWLEDGE_LEVEL, quoteScoutingAssignment, SCOUTING_CAPACITY } from '../world/scouting-policy'
import { compareScoutingPlayers, getScoutingDiscovery, type ScoutingListSort } from '../world/scouting-discovery'
import { seasonLabel } from '../world/season'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { PlayerRating } from './PlayerRating'
import { knowledgeLabel, scoutingDate, ScoutingKnowledge } from './ScoutingKnowledge'
import './scouting-workspace.css'
import { SCOUT_DIRECTORY } from '../data/staff-directory'
import { formatEuros } from './money-format'

interface ScoutingWorkspaceProps {
  season: SeasonState
  disabled: boolean
  selectedPlayerId: string | null
  onSelectPlayer: (id: string | null) => void
  onEnable: () => void
  onAssign: (playerId: string, scoutContractId?: string | null) => void
  onOpenScouts?: () => void
  onCancel: (playerId: string) => void
  onShortlist: (playerId: string, shortlisted: boolean) => void
  onDelegation: (delegated: boolean) => void
  onOpenTransfers: (playerId: string) => void
  /** Owner feedback (22 November 2026): shown as a tab inside Transfers, whose search is the place to discover players. */
  embedded?: boolean
}

type ScoutingView = 'shortlist' | 'discover' | 'reports'
const money = (cents: number) => formatEuros(cents)
const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C']

const observerName = (observer?: ScoutingObserver) => observer?.scoutId ? SCOUT_DIRECTORY.find(scout => scout.id === observer.scoutId)?.name ?? 'Scout' : 'Club observation'

function ReportSource({ observer, date, evidence }: { observer?: ScoutingObserver; date: string; evidence: number }) {
  const scout = observer?.scoutId ? SCOUT_DIRECTORY.find(item => item.id === observer.scoutId) : undefined
  return <section className="scouting-report-source" aria-label="Recorded report source" data-report-observer={observer?.scoutId ?? 'club'} data-report-evidence={evidence}><div>{scout ? <ScoutPortrait scout={scout} size={34} /> : <Icon name="search" size={25} />}<span><strong>{observerName(observer)}</strong><small>{evidence > 100 ? 'Enhanced report' : 'Club report'} &middot; <time dateTime={date}>{scoutingDate(date)}</time></small></span></div><details><summary>Report source &amp; quality</summary><p>This observation contributes {evidence / 100} times the evidence of a club report. Repeated observations improve knowledge; player skills remain estimates.</p><progress value={evidence} max={200} aria-label={`Report evidence: ${evidence} compared with 100 for a club observation`} /><p>The recorded observer and report quality stay the same after the scout leaves.</p></details></section>
}

export function ScoutingWorkspace({ season, disabled, selectedPlayerId, onSelectPlayer, onEnable, onAssign, onCancel, onShortlist, onDelegation, onOpenTransfers, onOpenScouts, embedded = false }: ScoutingWorkspaceProps) {
  const [observerChoice, setObserverChoice] = useState('auto')
  const [view, setView] = useState<ScoutingView>('shortlist')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<Position | 'all'>('all')
  const [clubFilter, setClubFilter] = useState('all')
  const [minimumAge, setMinimumAge] = useState('')
  const [maximumAge, setMaximumAge] = useState('')
  const [includeUnknownAge, setIncludeUnknownAge] = useState(false)
  const [sort, setSort] = useState<ScoutingListSort>('name-asc')
  const report = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const wasDisabled = useRef(disabled)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const scouting = season.scouting.clubs[club.id]!
  const enabled = season.scouting.enabledSince !== null
  const capacity = getScoutingCapacity(season)
  const discovery = getScoutingDiscovery(season)
  const discoveredIds = new Set(discovery.playerIds)
  const observers = getScoutingObservers(season)
  const observerContractId = observerChoice === 'auto' ? undefined : observerChoice === 'club' ? null : observerChoice
  const chosenObserver = observerChoice === 'auto' ? undefined : observers.find(observer => observer.contractId === observerContractId)
  const observerReason = observerChoice === 'auto' ? observers.some(observer => observer.available) ? null : 'All observation slots are occupied for this matchday.' : !chosenObserver ? 'This scout is no longer available. Choose another observer.' : chosenObserver.available ? null : chosenObserver.reason

  const ownerOf = (playerId: string) => season.clubs.find(team => team.players.some(player => player.id === playerId))
  const selected = selectedPlayerId ? getCareerPlayers(season).find(player => player.id === selectedPlayerId) ?? null : null
  const selectedOwner = selected ? ownerOf(selected.id) : null
  const selectedRetirement = selected ? getPlayerRetirement(season, selected.id) : null
  const selectedAge = selected ? getCareerPlayerAge(season, selected.id, season.date) : null
  const knowledge = selected ? getPlayerKnowledge(season, selected.id) : null
  const quote = selected ? quoteScoutingAssignment(season, selected.id, club.id, observerContractId) : null
  const shortlisted = selected ? scouting.shortlist.includes(selected.id) : false
  const pending = selected ? scouting.assignments.some(assignment => assignment.playerId === selected.id) : false
  const askingWage = selected ? season.negotiations.enabledSince ? getNegotiationDemands(selected.id, undefined, season, offeredContractRole(season, season.managedClubId, selected.id)).terms[0]!.seasonWage : getCareerWage(season, selected.id) : 0
  const selectedContract = selected ? contractForSeason(season.employment, selected.id, season.seasonNumber) : null
  const futureContract = selected ? contractForSeason(season.employment, selected.id, season.seasonNumber + 1) : null
  const offseasonPaid = selected && season.status === 'complete' && futureContract && futureContract.clubId !== club.id
  const inSeasonPaid = selected && season.status === 'active' && selectedContract && selectedContract.clubId !== club.id
  const inSeasonFreeAgent = selected && season.status === 'active' && !contractForSeason(season.employment, selected.id, season.seasonNumber)
  const contractQuote = selected ? inSeasonPaid ? transferEntryQuote(season, selected.id, askingWage, true) : offseasonPaid ? transferEntryQuote(season, selected.id, askingWage) : inSeasonFreeAgent ? quoteInSeasonOffer(season, selected.id, askingWage) : quotePlayerContract(season, selected.id, askingWage, 1) : null
  const selectedAssignment = selected ? scouting.assignments.find(assignment => assignment.playerId === selected.id) : undefined
  const latestReport = selected && knowledge?.source === 'observation' ? scouting.reviews.filter(review => review.playerId === selected.id && review.outcome === 'observed').at(-1) : undefined
  const selectedObservations = selected ? scouting.reviews.filter(review => review.playerId === selected.id && review.outcome === 'observed').length : 0
  // Format 78: network estimates are not reports.
  const isReport = (playerId: string) => { const known = getPlayerKnowledge(season, playerId); return known.kind === 'report' && known.source !== 'network' }
  const reportCount = getCareerPlayers(season).filter(player => isReport(player.id)).length
  const recent = scouting.reviews.slice(-10).reverse()
  const ageFiltered = minimumAge !== '' || maximumAge !== ''
  const ageFloor = minimumAge === '' ? 0 : Number(minimumAge)
  const ageCeiling = maximumAge === '' ? Infinity : Number(maximumAge)
  const ageError = !Number.isInteger(ageFloor) || ageFloor < 0 || maximumAge !== '' && (!Number.isInteger(ageCeiling) || ageCeiling < 0) ? 'Use whole ages of zero or above.' : ageFloor > ageCeiling ? 'Minimum age must not exceed maximum age.' : null
  const filtered = query !== '' || position !== 'all' || clubFilter !== 'all' || ageFiltered
  const candidates = getCareerPlayers(season).filter(player => view === 'shortlist' ? scouting.shortlist.includes(player.id) : view === 'reports' ? isReport(player.id) : discoveredIds.has(player.id))
  const players = candidates.filter(player => {
    const age = getCareerPlayerAge(season, player.id, season.date), owner = ownerOf(player.id)
    const matchesAge = age === null ? !ageFiltered || includeUnknownAge : age >= ageFloor && age <= ageCeiling
    return !ageError && matchesAge && player.name.toLowerCase().includes(query.trim().toLowerCase()) && (position === 'all' || player.position === position) && (clubFilter === 'all' || (owner?.id ?? 'free') === clubFilter)
  }).slice().sort((left, right) => compareScoutingPlayers(
    { id: left.id, name: left.name, position: left.position, age: getCareerPlayerAge(season, left.id, season.date), knowledge: getPlayerKnowledge(season, left.id) },
    { id: right.id, name: right.name, position: right.position, age: getCareerPlayerAge(season, right.id, season.date), knowledge: getPlayerKnowledge(season, right.id) }, sort,
  ))

  useEffect(() => {
    if (!selectedPlayerId) return
    const frame = requestAnimationFrame(() => { report.current?.focus({ preventScroll: true }); report.current?.scrollIntoView({ block: 'nearest' }) })
    return () => cancelAnimationFrame(frame)
  }, [selectedPlayerId])

  useEffect(() => {
    if (wasDisabled.current && !disabled && document.activeElement === document.body) {
      if (lastFocus.current?.isConnected && !lastFocus.current.matches(':disabled')) lastFocus.current.focus({ preventScroll: true })
      else (report.current ?? document.getElementById('scouting-heading'))?.focus({ preventScroll: true })
    }
    wasDisabled.current = disabled
  }, [disabled])

  function selectPlayer(id: string, element: HTMLElement) {
    trigger.current = element
    if (selectedPlayerId === id) { report.current?.focus({ preventScroll: true }); report.current?.scrollIntoView({ block: 'nearest' }) }
    else onSelectPlayer(id)
  }

  function closeReport() {
    onSelectPlayer(null)
    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true })
    else document.getElementById('scouting-search')?.focus({ preventScroll: true })
  }

  function clearFilters() {
    setQuery(''); setPosition('all'); setClubFilter('all'); setMinimumAge(''); setMaximumAge(''); setIncludeUnknownAge(false)
  }

  return <div className="scouting-workspace" onFocusCapture={event => { if (event.target instanceof HTMLElement) lastFocus.current = event.target }}>
    <section className="scouting-command panel" aria-labelledby="scouting-heading">
      <header className="scouting-heading"><div><h2 id="scouting-heading" tabIndex={-1}><Icon name="search" size={17} />Scouting</h2><span>{club.name} &middot; {seasonLabel(season.seasonNumber)} &middot; {season.status === 'complete' ? 'Offseason' : `Matchday ${season.round}`}</span></div><div className="scouting-counts"><span data-scouting-shortlist={scouting.shortlist.length}><strong>{scouting.shortlist.length}</strong> saved targets</span><span data-scouting-report-count={reportCount}><strong>{reportCount}</strong> reports</span></div></header>
      {enabled ? <div className="scouting-assignment-strip"><div className="scouting-queue-label"><strong data-scouting-capacity={scouting.assignments.length} data-scouting-max-capacity={capacity}><Icon name="search" size={15} />{scouting.assignments.length}/{capacity} observations</strong><span>{season.status === 'complete' ? 'Assignments resume next season' : 'Reports arrive after Continue matchday'}</span></div><div className="scouting-queue" aria-label="Pending observations">{scouting.assignments.map(assignment => {
        const player = getCareerPlayer(season, assignment.playerId)
        return <div className="scouting-queue-slot" key={player.id}><span aria-hidden="true"><Avatar player={ownerOf(player.id)?.players.find(member => member.id === player.id) ?? player} color={ownerOf(player.id)?.color ?? '#687385'} size={32} /></span><button className="text-button" data-scouting-queue-player={player.id} onClick={event => selectPlayer(player.id, event.currentTarget)} disabled={disabled}>{player.name}<small>{observerName(assignment.observer)} &middot; Matchday {assignment.round}</small></button><button className="scouting-icon-button" data-cancel-scouting={player.id} aria-label={`Cancel observation of ${player.name}`} title={`Cancel observation of ${player.name}`} onClick={() => onCancel(player.id)} disabled={disabled}><Icon name="close" size={14} /></button></div>
      })}{scouting.assignments.length < capacity && <span className="scouting-queue-free">{season.status === 'complete' ? 'No matchday scheduled yet' : `${capacity - scouting.assignments.length} ${capacity - scouting.assignments.length === 1 ? 'slot' : 'slots'} available`}</span>}</div><div className="scouting-policy-control"><label htmlFor="scouting-control">Assignments <strong>{scouting.delegated ? 'Assistant' : 'Manual'}</strong></label><input id="scouting-control" type="range" min={0} max={1} step={1} value={scouting.delegated ? 1 : 0} aria-valuetext={scouting.delegated ? 'Assistant' : 'Manual'} onChange={event => onDelegation(event.target.value === '1')} disabled={disabled} /></div></div> : <div className="scouting-enable"><div><strong>Build your recruitment shortlist</strong><p>Save targets, observe their matches, then review contract options.</p></div><button id="enable-scouting" className="button primary" onClick={onEnable} disabled={disabled}>Enable scouting<Icon name="search" size={15} /></button></div>}
      {enabled && <div className="scouting-observer-controls"><div><label htmlFor="scouting-observer">Observer for new assignments</label><select id="scouting-observer" value={observerChoice} onChange={event => setObserverChoice(event.target.value)} disabled={disabled || season.status === 'complete'} aria-describedby="scouting-observer-status"><option value="auto">Best available</option>{observers.map(observer => <option key={observer.contractId ?? 'club'} value={observer.contractId ?? 'club'} disabled={!observer.available}>{observer.name}{!observer.available ? ' - assigned' : ''}</option>)}{observerChoice !== 'auto' && !chosenObserver && <option value={observerChoice} disabled>Previous scout - unavailable</option>}</select><small id="scouting-observer-status" role="status">{observerReason ?? (observerChoice === 'auto' ? 'Best available scout first; club observation when scouts are busy.' : chosenObserver?.contractId ? 'This scout will observe the next player you assign.' : 'Uses one of your two club observation slots.')}</small></div><div className="scouting-observer-capacity"><span><strong>{SCOUTING_CAPACITY}</strong> club observations + <strong>{capacity - SCOUTING_CAPACITY}</strong> scouts</span>{onOpenScouts && <button id="scouting-manage-scouts" className="button small" onClick={onOpenScouts} disabled={disabled}>Manage scouts<Icon name="staff" size={14} /></button>}</div></div>}
    </section>

    <div className={`scouting-layout${selected ? ' scouting-layout-selected' : ''}`}>
      <section className="scouting-directory panel" aria-labelledby="scouting-directory-title">
        <header className="scouting-heading scouting-directory-heading"><div className="scouting-tabs" role="group" aria-label="Player list"><button id="scouting-show-shortlist" aria-pressed={view === 'shortlist'} className={view === 'shortlist' ? 'selected' : ''} onClick={() => setView('shortlist')} disabled={disabled}><Icon name="people" size={15} />Shortlist <small>{scouting.shortlist.length}</small></button>{!embedded && <button id="scouting-discover" aria-pressed={view === 'discover'} className={view === 'discover' ? 'selected' : ''} onClick={() => setView('discover')} disabled={disabled}><Icon name="search" size={15} />Discover</button>}<button id="scouting-show-reports" aria-pressed={view === 'reports'} className={view === 'reports' ? 'selected' : ''} onClick={() => setView('reports')} disabled={disabled}>Reports <small>{reportCount}</small></button></div><span>{players.length} / {candidates.length} players</span></header>
        <div className="scouting-list-context"><h2 id="scouting-directory-title">{view === 'shortlist' ? 'Your saved targets' : view === 'discover' ? 'Find a player' : 'Player reports'}</h2><span>{view === 'shortlist' ? 'Saving a player keeps him here. Observe when you want a report.' : view === 'discover' ? 'Browse your scouting range and save players to follow.' : 'Open a player to review skills and contract options.'}</span></div>
        {view === 'discover' && <div className="scouting-discovery-range" data-scouting-network={discovery.networkOutsideCount} data-scouting-network-total={discovery.totalOutsideCount} data-scouting-visible={discovery.playerIds.length}><Icon name="search" size={17} /><div><strong>Scouting range {discovery.networkOutsideCount}/{discovery.totalOutsideCount}</strong><small>{discovery.scoutCount} {discovery.scoutCount === 1 ? 'scout' : 'scouts'} &middot; outside your squad{discovery.retainedOutsideCount > 0 && <> &middot; {discovery.retainedOutsideCount} followed players kept</>}</small></div><progress value={discovery.networkOutsideCount} max={discovery.totalOutsideCount || 1} aria-label={`Scouting range: ${discovery.networkOutsideCount} of ${discovery.totalOutsideCount} outside players`} />{onOpenScouts && <button id="scouting-hire-scouts" className="button small" onClick={onOpenScouts} disabled={disabled}><Icon name="staff" size={14} />Hire scouts</button>}<details><summary>About range</summary><p>More scouts and stronger assessment skills reveal more player identities. Their skills stay unknown until observed. Your squad, reports, shortlist and pending observations remain visible when a scout leaves.</p></details></div>}
        <div className="scouting-filters"><label className="scouting-search" htmlFor="scouting-search"><Icon name="search" size={15} /><input id="scouting-search" aria-label="Find player" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find player" disabled={disabled} /></label><label htmlFor="scouting-position">Position<select id="scouting-position" value={position} onChange={event => setPosition(event.target.value as Position | 'all')} disabled={disabled}><option value="all">All</option>{positions.map(item => <option key={item}>{item}</option>)}</select></label><label htmlFor="scouting-club">Club<select id="scouting-club" value={clubFilter} onChange={event => setClubFilter(event.target.value)} disabled={disabled}><option value="all">All clubs</option>{season.clubs.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}<option value="free">Free agents</option></select></label><fieldset className="scouting-age-filter"><legend>Age</legend><label htmlFor="scouting-min-age"><span className="visually-hidden">Minimum age</span><input id="scouting-min-age" type="number" min={0} max={9999} step={1} value={minimumAge} onChange={event => setMinimumAge(event.target.value)} placeholder="Min" aria-invalid={Boolean(ageError)} aria-describedby={ageError ? 'scouting-age-error' : undefined} disabled={disabled} /></label><span aria-hidden="true">to</span><label htmlFor="scouting-max-age"><span className="visually-hidden">Maximum age</span><input id="scouting-max-age" type="number" min={0} max={9999} step={1} value={maximumAge} onChange={event => setMaximumAge(event.target.value)} placeholder="Max" aria-invalid={Boolean(ageError)} aria-describedby={ageError ? 'scouting-age-error' : undefined} disabled={disabled} /></label></fieldset>{ageFiltered && <label className="scouting-unknown-age"><input id="scouting-include-unknown-age" type="checkbox" checked={includeUnknownAge} onChange={event => setIncludeUnknownAge(event.target.checked)} disabled={disabled} />Include unknown age</label>}<label htmlFor="scouting-sort">Sort<select id="scouting-sort" value={sort} onChange={event => setSort(event.target.value as ScoutingListSort)} disabled={disabled}><option value="name-asc">Name A-Z</option><option value="name-desc">Name Z-A</option><option value="age-asc">Youngest first</option><option value="age-desc">Oldest first</option><option value="rating-desc">Best assessed ability</option><option value="rating-asc">Lowest assessed ability</option></select></label>{filtered && <button className="text-button scouting-clear-filters" onClick={clearFilters} disabled={disabled}>Clear filters</button>}</div>
        {ageError && <p id="scouting-age-error" className="scouting-filter-error" role="alert">{ageError}</p>}
        {!players.length ? <div className="scouting-empty"><Icon name={view === 'shortlist' ? 'people' : 'search'} size={30} /><strong>{view === 'shortlist' && !scouting.shortlist.length ? 'Your shortlist is empty' : view === 'reports' && !reportCount ? 'No reports yet' : 'No players match these filters'}</strong><p>{view === 'shortlist' && !scouting.shortlist.length ? 'Discover players, use Add to shortlist, then observe the targets you want to know better.' : view === 'reports' && !reportCount ? 'Choose Observe next to a player. Finish the match and Continue the matchday to receive the report.' : 'Adjust the age range, position or club to widen your search.'}</p>{view !== 'discover' && <button className="button primary" onClick={() => setView('discover')} disabled={disabled}>Discover players<Icon name="search" size={15} /></button>}{filtered && <button className="text-button" onClick={clearFilters} disabled={disabled}>Clear filters</button>}</div> : <div className="scouting-table-scroll" tabIndex={0} role="region" aria-label="Player scouting directory"><table className="scouting-table"><thead><tr><th scope="col">Player / club</th><th scope="col" aria-sort={sort === 'age-asc' ? 'ascending' : sort === 'age-desc' ? 'descending' : 'none'}><button className="scouting-column-sort" onClick={() => setSort(sort === 'age-asc' ? 'age-desc' : 'age-asc')} disabled={disabled} aria-label={sort === 'age-asc' ? 'Sort oldest first' : 'Sort youngest first'}>Age <span aria-hidden="true">{sort === 'age-asc' ? '\u2191' : sort === 'age-desc' ? '\u2193' : '\u2195'}</span></button></th><th scope="col" title="Reports show an estimated range. Ability sorting uses its conservative bound.">Ability</th><th scope="col">Report</th><th scope="col">Next action</th></tr></thead><tbody>{players.map(player => {
          const owner = ownerOf(player.id), known = getPlayerKnowledge(season, player.id), listed = scouting.shortlist.includes(player.id), age = getCareerPlayerAge(season, player.id, season.date)
          const assigned = scouting.assignments.some(assignment => assignment.playerId === player.id), assignment = quoteScoutingAssignment(season, player.id, club.id, observerContractId)
          return <tr key={player.id} data-scouting-row={player.id} data-player-age={age ?? 'unknown'} className={selectedPlayerId === player.id ? 'scouting-selected-row' : undefined}><th scope="row"><button className="scouting-player-button" id={`scouting-player-${player.id}`} aria-label={`Review ${player.name}`} aria-expanded={selectedPlayerId === player.id} aria-controls={selected ? 'scouting-player-report' : undefined} onClick={event => selectPlayer(player.id, event.currentTarget)} disabled={disabled}><span aria-hidden="true"><Avatar player={owner?.players.find(member => member.id === player.id) ?? player} color={owner?.color ?? '#687385'} size={40} /></span><span><strong>{player.name}</strong><GeneratedTag season={season} playerId={player.id} /><PlayerCareerStatus season={season} playerId={player.id} compact /><small><b>{player.position}</b> &middot; {getPlayerRetirement(season, player.id).status === 'retired' ? 'Retired' : owner?.name ?? 'Free agent'}</small></span><Icon name="chevron" size={13} /></button></th><td className="scouting-age-cell">{age ?? <span className="muted">Unknown</span>}</td><td className="scouting-ability-cell"><PlayerRating knowledge={known} position={player.position} compact label="Ability" /></td><td data-player-knowledge={known.kind}><span className={`scouting-report-status${assigned ? ' pending' : ''}`}>{assigned ? <><Icon name="clock" size={12} />Pending</> : known.kind === 'own' ? 'Own squad' : known.kind === 'unknown' ? 'Not scouted' : known.freshness === 'stale' ? 'Stale report' : `${known.level === 1 ? 'Initial' : known.level === 2 ? 'Developing' : 'Detailed'} report`}</span><span className="scouting-depth" aria-label={knowledgeLabel(known)}>{Array.from({ length: MAX_KNOWLEDGE_LEVEL }, (_, index) => <i key={index} className={index < known.level ? 'known' : ''} aria-hidden="true" />)}<small>{known.kind === 'own' ? 'Current skills' : known.observedOn ? scoutingDate(known.observedOn) : 'No assessment'}</small></span></td><td><div className="scouting-row-actions"><button className={`button small${listed ? ' scouting-saved' : ''}`} data-shortlist-player={player.id} aria-pressed={listed} aria-label={`${listed ? 'Remove' : 'Add'} ${player.name} ${listed ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(player.id, !listed)} disabled={disabled || !enabled || getPlayerRetirement(season, player.id).status === 'retired' && !listed}><Icon name={listed ? 'check' : 'people'} size={13} />{listed ? 'Saved' : 'Add to shortlist'}</button>{assigned ? <button className="button small" data-cancel-scouting={player.id} aria-label={`Cancel observation of ${player.name}`} onClick={() => onCancel(player.id)} disabled={disabled}>Cancel</button> : <button className="button small scouting-observe" data-assign-scouting={player.id} aria-label={`Observe ${player.name} this matchday`} title={assignment.reason ?? 'Receive a report after this matchday'} onClick={() => onAssign(player.id, observerContractId)} disabled={disabled || !assignment.canAssign}><Icon name="search" size={13} />Observe</button>}</div></td></tr>
        })}</tbody></table></div>}
      </section>

      {selected && knowledge && quote && <section ref={report} id="scouting-player-report" className="scouting-player-report panel" tabIndex={-1} aria-labelledby="scouting-player-title" data-scouting-player={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !disabled) { event.preventDefault(); event.stopPropagation(); closeReport() } }}>
        <header className="scouting-heading"><span>Player report</span><button className="scouting-icon-button" id="close-scouting-report" onClick={closeReport} disabled={disabled} aria-label="Close scouting report"><Icon name="close" size={16} /></button></header>
        <div className="scouting-identity"><span aria-hidden="true"><Avatar player={selectedOwner?.players.find(player => player.id === selected.id) ?? selected} color={selectedOwner?.color ?? '#687385'} size={66} /></span><div><h2 id="scouting-player-title">{selected.name}<GeneratedTag season={season} playerId={selected.id} /></h2><span>{selectedRetirement?.status === 'retired' ? 'Retired player' : selectedOwner?.name ?? 'Free agent'}</span><strong>{selected.position} &middot; {selectedAge === null ? 'Age unknown' : `${selectedAge} years`} &middot; {selected.heightCm} cm</strong></div></div>
        <div className="scouting-report-body"><div><PlayerCareerStatus season={season} playerId={selected.id} /><ScoutingKnowledge knowledge={knowledge} potential={getPotentialKnowledge(season, selected.id)} position={selected.position} compact />{latestReport && <ReportSource observer={latestReport.observer} date={latestReport.date} evidence={clubScoutingEvidence(season, season.managedClubId, latestReport)} />}</div><div className="scouting-report-actions"><dl>{selectedRetirement?.status !== 'retired' && <div><dt>One-season wage demand</dt><dd>{money(askingWage)}</dd></div>}<div><dt>Successful observations</dt><dd>{selectedObservations}</dd></div></dl>{(offseasonPaid ? futureContract : selectedContract)?.releaseFee !== undefined && <ReleaseClauseValue fee={(offseasonPaid ? futureContract : selectedContract)?.releaseFee} />}<button id="scouting-shortlist-player" className={`button${shortlisted ? ' scouting-saved' : ''}`} aria-pressed={shortlisted} aria-label={`${shortlisted ? 'Remove' : 'Add'} ${selected.name} ${shortlisted ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(selected.id, !shortlisted)} disabled={disabled || !enabled || selectedRetirement?.status === 'retired' && !shortlisted}>{shortlisted ? 'Saved to shortlist' : 'Add to shortlist'}<Icon name={shortlisted ? 'check' : 'people'} size={15} /></button>{pending ? <button id="scouting-cancel-player" className="button" onClick={() => onCancel(selected.id)} disabled={disabled}>Cancel observation</button> : <button id="scouting-assign-player" className="button primary" onClick={() => onAssign(selected.id, observerContractId)} disabled={disabled || !quote.canAssign} aria-describedby={quote.reason ? 'scouting-assignment-reason' : undefined}>Observe this matchday<Icon name="search" size={15} /></button>}{selectedAssignment ? <p className="scouting-assigned-observer"><Icon name="search" size={14} />Assigned to {observerName(selectedAssignment.observer)}</p> : quote.observer && quote.canAssign && <p className="scouting-assigned-observer"><Icon name="search" size={14} />{observerName(quote.observer)} will watch this player.</p>}{quote.reason && !pending && <p id="scouting-assignment-reason" className="scouting-action-reason">{quote.reason}</p>}<button id="scouting-open-transfers" className="button" onClick={() => onOpenTransfers(selected.id)} disabled={disabled}>{selectedRetirement?.status === 'retired' ? 'View contract records' : inSeasonPaid ? 'Review midseason transfer' : inSeasonFreeAgent ? 'Review this-season contract' : contractQuote?.canOffer ? 'Review contract options' : 'View contract options'}<Icon name="chevron" size={14} /></button>{contractQuote?.reason && <p className="scouting-action-reason">{!season.employment.enabledSince ? 'Enable player contracts in Transfers to negotiate.' : contractQuote.reason}</p>}</div></div>
      </section>}
    </div>

    {enabled && <details className="scouting-activity panel"><summary><span><Icon name="clock" size={15} />Recent reviews</span><small>{recent.length ? `${recent.length} latest outcomes` : 'No completed observations'}</small></summary>{recent.length ? <div className="scouting-review-list">{recent.map(review => {
      const player = getCareerPlayer(season, review.playerId)
      return <div className="scouting-review-row" key={`${review.seasonNumber}:${review.round}:${review.playerId}`} data-scouting-review={review.playerId} data-scouting-outcome={review.outcome}><button className="text-button" onClick={event => selectPlayer(player.id, event.currentTarget)} disabled={disabled}>{player.name}<Icon name="chevron" size={13} /></button><span>{season.clubs.find(team => team.id === review.clubId)!.name}<small>{seasonLabel(review.seasonNumber)} &middot; Matchday {review.round}</small></span><span>{review.outcome === 'observed' ? 'Report updated' : 'No minutes - knowledge unchanged'}<small>{observerName(review.observer)}{review.outcome === 'observed' && clubScoutingEvidence(season, season.managedClubId, review) > 100 && <> &middot; Enhanced report</>}</small><small><time dateTime={review.date}>{scoutingDate(review.date)}</time></small></span></div>
    })}</div> : <p className="scouting-note">Choose Observe beside a player. Reviews arrive when you finish the match and Continue the matchday.</p>}</details>}
    {!embedded && <details className="scouting-help"><summary>How scouting works</summary><ol><li><strong>Discover.</strong> Filter by name, position, club or age.</li><li><strong>Shortlist.</strong> Save targets here; this does not use an observation slot.</li><li><strong>Observe.</strong> Assign up to {capacity} players, finish the match, then Continue the matchday. Players need court time for a report to improve.</li><li><strong>Review.</strong> Open a player to compare skill ranges and review contract options.</li></ol><p>The assistant prioritizes your shortlist and uses available scouts before club observation slots. Better scouts expand your discovery range and provide stronger reports; releasing a scout cancels that scout’s pending observation and keeps completed reports. Switching to Manual keeps pending assignments until you cancel them. Your squad has exact skills; outside reports remain estimates and become less precise as reports get older.</p></details>}
    {!embedded && <p className="scouting-model-note">Fictional development players and birth dates. Ages follow the simulated calendar. Scouting decisions save automatically.</p>}
  </div>
}

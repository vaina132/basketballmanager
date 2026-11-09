import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { Position } from '../domain/types'
import { DEVELOPMENT_PLAYERS, getDevelopmentPlayer } from '../data/development-players'
import { getPlayerAge } from '../data/development-player-profiles'
import { getSeasonWage } from '../data/development-wages'
import { quotePlayerContract } from '../world/employment-policy'
import { getNegotiationDemands } from '../world/negotiations-policy'
import { getPlayerKnowledge, MAX_KNOWLEDGE_LEVEL, quoteScoutingAssignment, SCOUTING_CAPACITY } from '../world/scouting-policy'
import { seasonLabel } from '../world/season'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { knowledgeLabel, scoutingDate, ScoutingKnowledge } from './ScoutingKnowledge'
import './scouting-workspace.css'

interface ScoutingWorkspaceProps {
  season: SeasonState
  disabled: boolean
  selectedPlayerId: string | null
  onSelectPlayer: (id: string | null) => void
  onEnable: () => void
  onAssign: (playerId: string) => void
  onCancel: (playerId: string) => void
  onShortlist: (playerId: string, shortlisted: boolean) => void
  onDelegation: (delegated: boolean) => void
  onOpenTransfers: (playerId: string) => void
}

type ScoutingView = 'shortlist' | 'discover' | 'reports'
const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C']

export function ScoutingWorkspace({ season, disabled, selectedPlayerId, onSelectPlayer, onEnable, onAssign, onCancel, onShortlist, onDelegation, onOpenTransfers }: ScoutingWorkspaceProps) {
  const [view, setView] = useState<ScoutingView>('shortlist')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<Position | 'all'>('all')
  const [clubFilter, setClubFilter] = useState('all')
  const [minimumAge, setMinimumAge] = useState('')
  const [maximumAge, setMaximumAge] = useState('')
  const [includeUnknownAge, setIncludeUnknownAge] = useState(false)
  const report = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const lastFocus = useRef<HTMLElement | null>(null)
  const wasDisabled = useRef(disabled)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const scouting = season.scouting.clubs[club.id]!
  const enabled = season.scouting.enabledSince !== null
  const ownerOf = (playerId: string) => season.clubs.find(team => team.players.some(player => player.id === playerId))
  const selected = selectedPlayerId ? DEVELOPMENT_PLAYERS.find(player => player.id === selectedPlayerId) ?? null : null
  const selectedOwner = selected ? ownerOf(selected.id) : null
  const selectedAge = selected ? getPlayerAge(selected.id, season.date) : null
  const knowledge = selected ? getPlayerKnowledge(season, selected.id) : null
  const quote = selected ? quoteScoutingAssignment(season, selected.id) : null
  const shortlisted = selected ? scouting.shortlist.includes(selected.id) : false
  const pending = selected ? scouting.assignments.some(assignment => assignment.playerId === selected.id) : false
  const askingWage = selected ? season.negotiations.enabledSince ? getNegotiationDemands(selected.id).terms[0]!.seasonWage : getSeasonWage(selected.id) : 0
  const contractQuote = selected ? quotePlayerContract(season, selected.id, askingWage, 1) : null
  const selectedObservations = selected ? scouting.reviews.filter(review => review.playerId === selected.id && review.outcome === 'observed').length : 0
  const reportCount = DEVELOPMENT_PLAYERS.filter(player => getPlayerKnowledge(season, player.id).kind === 'report').length
  const recent = scouting.reviews.slice(-10).reverse()
  const ageFiltered = minimumAge !== '' || maximumAge !== ''
  const ageFloor = minimumAge === '' ? 0 : Number(minimumAge)
  const ageCeiling = maximumAge === '' ? Infinity : Number(maximumAge)
  const ageError = !Number.isInteger(ageFloor) || ageFloor < 0 || maximumAge !== '' && (!Number.isInteger(ageCeiling) || ageCeiling < 0) ? 'Use whole ages of zero or above.' : ageFloor > ageCeiling ? 'Minimum age must not exceed maximum age.' : null
  const filtered = query !== '' || position !== 'all' || clubFilter !== 'all' || ageFiltered
  const candidates = DEVELOPMENT_PLAYERS.filter(player => view === 'shortlist' ? scouting.shortlist.includes(player.id) : view === 'reports' ? getPlayerKnowledge(season, player.id).kind === 'report' : true)
  const players = candidates.filter(player => {
    const age = getPlayerAge(player.id, season.date), owner = ownerOf(player.id)
    const matchesAge = age === null ? !ageFiltered || includeUnknownAge : age >= ageFloor && age <= ageCeiling
    return !ageError && matchesAge && player.name.toLowerCase().includes(query.trim().toLowerCase()) && (position === 'all' || player.position === position) && (clubFilter === 'all' || (owner?.id ?? 'free') === clubFilter)
  }).slice().sort((left, right) => left.name.localeCompare(right.name, 'en'))

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
      {enabled ? <div className="scouting-assignment-strip"><div className="scouting-queue-label"><strong data-scouting-capacity={scouting.assignments.length}><Icon name="search" size={15} />{scouting.assignments.length}/{SCOUTING_CAPACITY} observations</strong><span>{season.status === 'complete' ? 'Assignments resume next season' : 'Reports arrive after Continue matchday'}</span></div><div className="scouting-queue" aria-label="Pending observations">{scouting.assignments.map(assignment => {
        const player = getDevelopmentPlayer(assignment.playerId)
        return <div className="scouting-queue-slot" key={player.id}><span aria-hidden="true"><Avatar player={ownerOf(player.id)?.players.find(member => member.id === player.id) ?? player} color={ownerOf(player.id)?.color ?? '#687385'} size={32} /></span><button className="text-button" data-scouting-queue-player={player.id} onClick={event => selectPlayer(player.id, event.currentTarget)} disabled={disabled}>{player.name}<small>Matchday {assignment.round}</small></button><button className="scouting-icon-button" data-cancel-scouting={player.id} aria-label={`Cancel observation of ${player.name}`} title={`Cancel observation of ${player.name}`} onClick={() => onCancel(player.id)} disabled={disabled}><Icon name="close" size={14} /></button></div>
      })}{scouting.assignments.length < SCOUTING_CAPACITY && <span className="scouting-queue-free">{season.status === 'complete' ? 'No matchday scheduled yet' : `${SCOUTING_CAPACITY - scouting.assignments.length} ${SCOUTING_CAPACITY - scouting.assignments.length === 1 ? 'slot' : 'slots'} available`}</span>}</div><div className="scouting-policy-control"><label htmlFor="scouting-control">Assignments <strong>{scouting.delegated ? 'Assistant' : 'Manual'}</strong></label><input id="scouting-control" type="range" min={0} max={1} step={1} value={scouting.delegated ? 1 : 0} aria-valuetext={scouting.delegated ? 'Assistant' : 'Manual'} onChange={event => onDelegation(event.target.value === '1')} disabled={disabled} /></div></div> : <div className="scouting-enable"><div><strong>Build your recruitment shortlist</strong><p>Save targets, observe their matches, then review contract options.</p></div><button id="enable-scouting" className="button primary" onClick={onEnable} disabled={disabled}>Enable scouting<Icon name="search" size={15} /></button></div>}
    </section>

    <div className={`scouting-layout${selected ? ' scouting-layout-selected' : ''}`}>
      <section className="scouting-directory panel" aria-labelledby="scouting-directory-title">
        <header className="scouting-heading scouting-directory-heading"><div className="scouting-tabs" role="group" aria-label="Player list"><button id="scouting-show-shortlist" aria-pressed={view === 'shortlist'} className={view === 'shortlist' ? 'selected' : ''} onClick={() => setView('shortlist')} disabled={disabled}><Icon name="people" size={15} />Shortlist <small>{scouting.shortlist.length}</small></button><button id="scouting-discover" aria-pressed={view === 'discover'} className={view === 'discover' ? 'selected' : ''} onClick={() => setView('discover')} disabled={disabled}><Icon name="search" size={15} />Discover</button><button id="scouting-show-reports" aria-pressed={view === 'reports'} className={view === 'reports' ? 'selected' : ''} onClick={() => setView('reports')} disabled={disabled}>Reports <small>{reportCount}</small></button></div><span>{players.length} / {candidates.length} players</span></header>
        <div className="scouting-list-context"><h2 id="scouting-directory-title">{view === 'shortlist' ? 'Your saved targets' : view === 'discover' ? 'Find a player' : 'Player reports'}</h2><span>{view === 'shortlist' ? 'Saving a player keeps him here. Observe when you want a report.' : view === 'discover' ? 'Filter players and add the ones you want to follow.' : 'Open a player to review skills and contract options.'}</span></div>
        <div className="scouting-filters"><label className="scouting-search" htmlFor="scouting-search"><Icon name="search" size={15} /><input id="scouting-search" aria-label="Find player" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find player" disabled={disabled} /></label><label htmlFor="scouting-position">Position<select id="scouting-position" value={position} onChange={event => setPosition(event.target.value as Position | 'all')} disabled={disabled}><option value="all">All</option>{positions.map(item => <option key={item}>{item}</option>)}</select></label><label htmlFor="scouting-club">Club<select id="scouting-club" value={clubFilter} onChange={event => setClubFilter(event.target.value)} disabled={disabled}><option value="all">All clubs</option>{season.clubs.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}<option value="free">Free agents</option></select></label><fieldset className="scouting-age-filter"><legend>Age</legend><label htmlFor="scouting-min-age"><span className="visually-hidden">Minimum age</span><input id="scouting-min-age" type="number" min={0} max={9999} step={1} value={minimumAge} onChange={event => setMinimumAge(event.target.value)} placeholder="Min" aria-invalid={Boolean(ageError)} aria-describedby={ageError ? 'scouting-age-error' : undefined} disabled={disabled} /></label><span aria-hidden="true">to</span><label htmlFor="scouting-max-age"><span className="visually-hidden">Maximum age</span><input id="scouting-max-age" type="number" min={0} max={9999} step={1} value={maximumAge} onChange={event => setMaximumAge(event.target.value)} placeholder="Max" aria-invalid={Boolean(ageError)} aria-describedby={ageError ? 'scouting-age-error' : undefined} disabled={disabled} /></label></fieldset>{ageFiltered && <label className="scouting-unknown-age"><input id="scouting-include-unknown-age" type="checkbox" checked={includeUnknownAge} onChange={event => setIncludeUnknownAge(event.target.checked)} disabled={disabled} />Include unknown age</label>}{filtered && <button className="text-button scouting-clear-filters" onClick={clearFilters} disabled={disabled}>Clear filters</button>}</div>
        {ageError && <p id="scouting-age-error" className="scouting-filter-error" role="alert">{ageError}</p>}
        {!players.length ? <div className="scouting-empty"><Icon name={view === 'shortlist' ? 'people' : 'search'} size={30} /><strong>{view === 'shortlist' && !scouting.shortlist.length ? 'Your shortlist is empty' : view === 'reports' && !reportCount ? 'No reports yet' : 'No players match these filters'}</strong><p>{view === 'shortlist' && !scouting.shortlist.length ? 'Discover players, use Add to shortlist, then observe the targets you want to know better.' : view === 'reports' && !reportCount ? 'Choose Observe next to a player. Finish the match and Continue the matchday to receive the report.' : 'Adjust the age range, position or club to widen your search.'}</p>{view !== 'discover' && <button className="button primary" onClick={() => setView('discover')} disabled={disabled}>Discover players<Icon name="search" size={15} /></button>}{filtered && <button className="text-button" onClick={clearFilters} disabled={disabled}>Clear filters</button>}</div> : <div className="scouting-table-scroll" tabIndex={0} role="region" aria-label="Player scouting directory"><table className="scouting-table"><thead><tr><th scope="col">Player / club</th><th scope="col">Age</th><th scope="col">Report</th><th scope="col">Next action</th></tr></thead><tbody>{players.map(player => {
          const owner = ownerOf(player.id), known = getPlayerKnowledge(season, player.id), listed = scouting.shortlist.includes(player.id), age = getPlayerAge(player.id, season.date)
          const assigned = scouting.assignments.some(assignment => assignment.playerId === player.id), assignment = quoteScoutingAssignment(season, player.id)
          return <tr key={player.id} data-scouting-row={player.id} data-player-age={age ?? 'unknown'} className={selectedPlayerId === player.id ? 'scouting-selected-row' : undefined}><th scope="row"><button className="scouting-player-button" id={`scouting-player-${player.id}`} aria-label={`Review ${player.name}`} aria-expanded={selectedPlayerId === player.id} aria-controls={selected ? 'scouting-player-report' : undefined} onClick={event => selectPlayer(player.id, event.currentTarget)} disabled={disabled}><span aria-hidden="true"><Avatar player={owner?.players.find(member => member.id === player.id) ?? player} color={owner?.color ?? '#687385'} size={40} /></span><span><strong>{player.name}</strong><small><b>{player.position}</b> &middot; {owner?.name ?? 'Free agent'}</small></span><Icon name="chevron" size={13} /></button></th><td className="scouting-age-cell">{age ?? <span className="muted">Unknown</span>}</td><td data-player-knowledge={known.kind}><span className={`scouting-report-status${assigned ? ' pending' : ''}`}>{assigned ? <><Icon name="clock" size={12} />Pending</> : known.kind === 'own' ? 'Own squad' : known.kind === 'unknown' ? 'Not scouted' : known.freshness === 'stale' ? 'Stale report' : `${known.level === 1 ? 'Initial' : known.level === 2 ? 'Developing' : 'Detailed'} report`}</span><span className="scouting-depth" aria-label={knowledgeLabel(known)}>{Array.from({ length: MAX_KNOWLEDGE_LEVEL }, (_, index) => <i key={index} className={index < known.level ? 'known' : ''} aria-hidden="true" />)}<small>{known.kind === 'own' ? 'Current skills' : known.observedOn ? scoutingDate(known.observedOn) : 'No assessment'}</small></span></td><td><div className="scouting-row-actions"><button className={`button small${listed ? ' scouting-saved' : ''}`} data-shortlist-player={player.id} aria-pressed={listed} aria-label={`${listed ? 'Remove' : 'Add'} ${player.name} ${listed ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(player.id, !listed)} disabled={disabled || !enabled}><Icon name={listed ? 'check' : 'people'} size={13} />{listed ? 'Saved' : 'Add to shortlist'}</button>{assigned ? <button className="button small" data-cancel-scouting={player.id} aria-label={`Cancel observation of ${player.name}`} onClick={() => onCancel(player.id)} disabled={disabled}>Cancel</button> : <button className="button small scouting-observe" data-assign-scouting={player.id} aria-label={`Observe ${player.name} this matchday`} title={assignment.reason ?? 'Receive a report after this matchday'} onClick={() => onAssign(player.id)} disabled={disabled || !assignment.canAssign}><Icon name="search" size={13} />Observe</button>}</div></td></tr>
        })}</tbody></table></div>}
      </section>

      {selected && knowledge && quote && <section ref={report} id="scouting-player-report" className="scouting-player-report panel" tabIndex={-1} aria-labelledby="scouting-player-title" data-scouting-player={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !disabled) { event.preventDefault(); event.stopPropagation(); closeReport() } }}>
        <header className="scouting-heading"><span>Player report</span><button className="scouting-icon-button" id="close-scouting-report" onClick={closeReport} disabled={disabled} aria-label="Close scouting report"><Icon name="close" size={16} /></button></header>
        <div className="scouting-identity"><span aria-hidden="true"><Avatar player={selectedOwner?.players.find(player => player.id === selected.id) ?? selected} color={selectedOwner?.color ?? '#687385'} size={66} /></span><div><h2 id="scouting-player-title">{selected.name}</h2><span>{selectedOwner?.name ?? 'Free agent'}</span><strong>{selected.position} &middot; {selectedAge === null ? 'Age unknown' : `${selectedAge} years`} &middot; {selected.heightCm} cm</strong></div></div>
        <div className="scouting-report-body"><ScoutingKnowledge knowledge={knowledge} compact /><div className="scouting-report-actions"><dl><div><dt>One-season wage demand</dt><dd>{money(askingWage)}</dd></div><div><dt>Successful observations</dt><dd>{selectedObservations}</dd></div></dl><button id="scouting-shortlist-player" className={`button${shortlisted ? ' scouting-saved' : ''}`} aria-pressed={shortlisted} aria-label={`${shortlisted ? 'Remove' : 'Add'} ${selected.name} ${shortlisted ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(selected.id, !shortlisted)} disabled={disabled || !enabled}>{shortlisted ? 'Saved to shortlist' : 'Add to shortlist'}<Icon name={shortlisted ? 'check' : 'people'} size={15} /></button>{pending ? <button id="scouting-cancel-player" className="button" onClick={() => onCancel(selected.id)} disabled={disabled}>Cancel observation</button> : <button id="scouting-assign-player" className="button primary" onClick={() => onAssign(selected.id)} disabled={disabled || !quote.canAssign} aria-describedby={quote.reason ? 'scouting-assignment-reason' : undefined}>Observe this matchday<Icon name="search" size={15} /></button>}{quote.reason && !pending && <p id="scouting-assignment-reason" className="scouting-action-reason">{quote.reason}</p>}<button id="scouting-open-transfers" className="button" onClick={() => onOpenTransfers(selected.id)} disabled={disabled}>{contractQuote?.canOffer ? 'Review contract options' : 'View contract options'}<Icon name="chevron" size={14} /></button>{contractQuote?.reason && <p className="scouting-action-reason">{!season.employment.enabledSince ? 'Enable player contracts in Transfers to negotiate.' : season.status === 'active' && selectedOwner?.id !== club.id ? 'Recruitment opens after the final matchday.' : contractQuote.reason}</p>}</div></div>
      </section>}
    </div>

    {enabled && <details className="scouting-activity panel"><summary><span><Icon name="clock" size={15} />Recent reviews</span><small>{recent.length ? `${recent.length} latest outcomes` : 'No completed observations'}</small></summary>{recent.length ? <div className="scouting-review-list">{recent.map(review => {
      const player = getDevelopmentPlayer(review.playerId)
      return <div className="scouting-review-row" key={`${review.seasonNumber}:${review.round}:${review.playerId}`} data-scouting-review={review.playerId} data-scouting-outcome={review.outcome}><button className="text-button" onClick={event => selectPlayer(player.id, event.currentTarget)} disabled={disabled}>{player.name}<Icon name="chevron" size={13} /></button><span>{season.clubs.find(team => team.id === review.clubId)!.name}<small>{seasonLabel(review.seasonNumber)} &middot; Matchday {review.round}</small></span><span>{review.outcome === 'observed' ? 'Report updated' : 'No minutes - knowledge unchanged'}<small><time dateTime={review.date}>{scoutingDate(review.date)}</time></small></span></div>
    })}</div> : <p className="scouting-note">Choose Observe beside a player. Reviews arrive when you finish the match and Continue the matchday.</p>}</details>}
    <details className="scouting-help"><summary>How scouting works</summary><ol><li><strong>Discover.</strong> Filter by name, position, club or age.</li><li><strong>Shortlist.</strong> Save targets here; this does not use an observation slot.</li><li><strong>Observe.</strong> Assign up to {SCOUTING_CAPACITY} players, finish the match, then Continue the matchday. Players need court time for a report to improve.</li><li><strong>Review.</strong> Open a player to compare skill ranges and review contract options.</li></ol><p>The assistant prioritizes your shortlist and fills eligible slots. Switching to Manual keeps pending assignments until you cancel them. Your squad has exact skills; outside reports remain estimates and become less precise as reports get older.</p></details>
    <p className="scouting-model-note">Fictional development players and birth dates. Ages follow the simulated calendar. Scouting decisions save automatically.</p>
  </div>
}

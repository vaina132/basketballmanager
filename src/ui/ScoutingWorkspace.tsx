import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { Position } from '../domain/types'
import { DEVELOPMENT_PLAYERS, getDevelopmentPlayer } from '../data/development-players'
import { getSeasonWage } from '../data/development-wages'
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

const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
const positions: Position[] = ['PG', 'SG', 'SF', 'PF', 'C']

export function ScoutingWorkspace({ season, disabled, selectedPlayerId, onSelectPlayer, onEnable, onAssign, onCancel, onShortlist, onDelegation, onOpenTransfers }: ScoutingWorkspaceProps) {
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<Position | 'all'>('all')
  const [clubFilter, setClubFilter] = useState('all')
  const [shortlistOnly, setShortlistOnly] = useState(false)
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
  const knowledge = selected ? getPlayerKnowledge(season, selected.id) : null
  const quote = selected ? quoteScoutingAssignment(season, selected.id) : null
  const shortlisted = selected ? scouting.shortlist.includes(selected.id) : false
  const pending = selected ? scouting.assignments.some(assignment => assignment.playerId === selected.id) : false
  const successful = scouting.reviews.filter(review => review.outcome === 'observed')
  const selectedObservations = selected ? successful.filter(review => review.playerId === selected.id).length : 0
  const reports = DEVELOPMENT_PLAYERS.filter(player => getPlayerKnowledge(season, player.id).kind === 'report').length
  const players = DEVELOPMENT_PLAYERS.filter(player => {
    const owner = ownerOf(player.id)
    return player.name.toLowerCase().includes(query.trim().toLowerCase()) && (position === 'all' || player.position === position) && (clubFilter === 'all' || (owner?.id ?? 'free') === clubFilter) && (!shortlistOnly || scouting.shortlist.includes(player.id))
  }).slice().sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const recent = scouting.reviews.slice(-10).reverse()

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

  return <div className="scouting-workspace" onFocusCapture={event => { if (event.target instanceof HTMLElement) lastFocus.current = event.target }}>
    <section className="scouting-overview panel" aria-labelledby="scouting-heading"><header className="scouting-heading"><div><h2 id="scouting-heading" tabIndex={-1}>{club.name} · Scouting</h2><span>{seasonLabel(season.seasonNumber)} · {season.status === 'complete' ? 'Season complete' : `Matchday ${season.round}`}</span></div><span>{enabled ? scouting.delegated ? 'Assistant assignments' : 'Manual assignments' : 'Not enabled'}</span></header><dl className="scouting-summary"><div><dt>Matchday assignments</dt><dd data-scouting-capacity={scouting.assignments.length}>{scouting.assignments.length}<small> / {SCOUTING_CAPACITY}</small></dd></div><div><dt>Shortlisted</dt><dd data-scouting-shortlist={scouting.shortlist.length}>{scouting.shortlist.length}</dd></div><div><dt>Outside player reports</dt><dd data-scouting-report-count={reports}>{reports}</dd></div><div><dt>Completed observations</dt><dd>{successful.length}</dd></div></dl></section>

    {!enabled ? <section className="scouting-enable panel" aria-labelledby="scouting-enable-title"><header className="scouting-heading"><h2 id="scouting-enable-title">Match observations</h2><span>Not enabled</span></header><div><p>Observe up to {SCOUTING_CAPACITY} outside players per matchday and build a shortlist. Reports arrive when that matchday is committed. Players need court time for their reports to improve.</p><button id="enable-scouting" className="button primary" onClick={onEnable} disabled={disabled}>Enable scouting<Icon name="search" size={15} /></button></div></section> : <div className="scouting-planning">
      <section className="scouting-policy panel" aria-labelledby="scouting-policy-title"><header className="scouting-heading"><h2 id="scouting-policy-title">Assignment responsibility</h2><span>{scouting.delegated ? 'Assistant' : 'Manual'}</span></header><div className="scouting-policy-control"><label htmlFor="scouting-control">Match observation assignments</label><input id="scouting-control" type="range" min={0} max={1} step={1} value={scouting.delegated ? 1 : 0} aria-valuetext={scouting.delegated ? 'Assistant' : 'Manual'} aria-describedby="scouting-control-help" onChange={event => onDelegation(event.target.value === '1')} disabled={disabled} /><div><span>Manual</span><span>Assistant</span></div></div><p id="scouting-control-help" className="scouting-note">The assistant prioritizes shortlisted players and fills eligible assignments immediately, then each matchday. Switching to Manual keeps pending assignments; cancel them individually to free a slot.</p></section>
      <section className="scouting-queue panel" aria-labelledby="scouting-queue-title"><header className="scouting-heading"><h2 id="scouting-queue-title">Pending observations</h2><span>{scouting.assignments.length} / {SCOUTING_CAPACITY}</span></header>{scouting.assignments.length ? <ul>{scouting.assignments.map(assignment => {
        const player = getDevelopmentPlayer(assignment.playerId)
        return <li key={assignment.playerId}><div><button className="text-button" data-scouting-queue-player={player.id} onClick={event => selectPlayer(player.id, event.currentTarget)} disabled={disabled}>{player.name}<Icon name="chevron" size={13} /></button><small>{ownerOf(player.id)?.name ?? 'Free agent'} · Matchday {assignment.round}</small></div><button className="button small" data-cancel-scouting={player.id} aria-label={`Cancel observation of ${player.name}`} onClick={() => onCancel(player.id)} disabled={disabled}>Cancel</button></li>
      })}</ul> : <p className="scouting-empty">{season.status === 'complete' ? 'New observations can be assigned after the next season starts.' : 'No pending assignments. Choose a player below to observe this matchday.'}</p>}<p className="scouting-note">Each club has {SCOUTING_CAPACITY} observation slots per matchday. A player who does not play produces a no-minutes review and no knowledge gain.</p></section>
    </div>}

    {selected && knowledge && quote && <section ref={report} id="scouting-player-report" className="scouting-player-report panel" tabIndex={-1} aria-labelledby="scouting-player-title" data-scouting-player={selected.id} onKeyDown={event => { if (event.key === 'Escape' && !disabled) { event.preventDefault(); event.stopPropagation(); closeReport() } }}>
      <header className="scouting-heading"><div className="scouting-identity"><span aria-hidden="true"><Avatar player={selectedOwner?.players.find(player => player.id === selected.id) ?? selected} color={selectedOwner?.color ?? '#687385'} size={38} /></span><div><h2 id="scouting-player-title">{selected.name}</h2><span>{selectedOwner?.name ?? 'Free agent'} · {selected.position} · {selected.heightCm} cm · {selected.weightKg} kg</span></div></div><button className="text-button" id="close-scouting-report" onClick={closeReport} disabled={disabled} aria-label="Close scouting report"><Icon name="close" size={14} />Close</button></header>
      <div className="scouting-report-body"><ScoutingKnowledge knowledge={knowledge} /><div className="scouting-report-actions"><dl><div><dt>Requested annual wage</dt><dd>{money(getSeasonWage(selected.id))}</dd></div>{knowledge.observedClubId && <div><dt>{knowledge.kind === 'own' ? 'Current club' : 'Club at assessment'}</dt><dd>{season.clubs.find(team => team.id === knowledge.observedClubId)?.name ?? 'Unknown'}</dd></div>}<div><dt>Match observations</dt><dd>{selectedObservations}</dd></div></dl><button id="scouting-shortlist-player" className="button" aria-pressed={shortlisted} aria-label={`${shortlisted ? 'Remove' : 'Add'} ${selected.name} ${shortlisted ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(selected.id, !shortlisted)} disabled={disabled || !enabled}>{shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}<Icon name={shortlisted ? 'check' : 'people'} size={15} /></button>{pending ? <button id="scouting-cancel-player" className="button" onClick={() => onCancel(selected.id)} disabled={disabled}>Cancel observation</button> : <button id="scouting-assign-player" className="button primary" onClick={() => onAssign(selected.id)} disabled={disabled || !quote.canAssign} aria-describedby={quote.reason ? 'scouting-assignment-reason' : undefined}>Observe this matchday<Icon name="search" size={15} /></button>}{quote.reason && !pending && <p id="scouting-assignment-reason" className="scouting-action-reason">{quote.reason}</p>}<button id="scouting-open-transfers" className="text-button" onClick={() => onOpenTransfers(selected.id)} disabled={disabled}>Review contract options<Icon name="chevron" size={14} /></button></div></div>
    </section>}

    <section className="scouting-directory panel" aria-labelledby="scouting-directory-title"><header className="scouting-heading"><h2 id="scouting-directory-title">Player directory</h2><span>{players.length} / {DEVELOPMENT_PLAYERS.length} players</span></header><div className="scouting-filters"><div className="segmented" role="group" aria-label="Player list"><button aria-pressed={!shortlistOnly} className={!shortlistOnly ? 'selected' : ''} onClick={() => setShortlistOnly(false)} disabled={disabled}>All players</button><button id="scouting-show-shortlist" aria-pressed={shortlistOnly} className={shortlistOnly ? 'selected' : ''} onClick={() => setShortlistOnly(true)} disabled={disabled}>Shortlist ({scouting.shortlist.length})</button></div><label htmlFor="scouting-search">Player<input id="scouting-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find player" disabled={disabled} /></label><label htmlFor="scouting-position">Position<select id="scouting-position" value={position} onChange={event => setPosition(event.target.value as Position | 'all')} disabled={disabled}><option value="all">All</option>{positions.map(item => <option key={item}>{item}</option>)}</select></label><label htmlFor="scouting-club">Club<select id="scouting-club" value={clubFilter} onChange={event => setClubFilter(event.target.value)} disabled={disabled}><option value="all">All clubs</option>{season.clubs.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}<option value="free">Free agents</option></select></label></div>
      <div className="scouting-table-scroll" tabIndex={0} role="region" aria-label="Player scouting directory"><table className="scouting-table"><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col">Position</th><th scope="col">Knowledge</th><th scope="col">Last assessment</th><th scope="col">Shortlist</th></tr></thead><tbody>{players.map(player => {
        const owner = ownerOf(player.id), known = getPlayerKnowledge(season, player.id), listed = scouting.shortlist.includes(player.id)
        const assigned = scouting.assignments.some(assignment => assignment.playerId === player.id)
        return <tr key={player.id} data-scouting-row={player.id} className={selectedPlayerId === player.id ? 'scouting-selected-row' : undefined}><th scope="row"><button className="scouting-player-button" id={`scouting-player-${player.id}`} aria-label={`Review ${player.name}`} aria-expanded={selectedPlayerId === player.id} aria-controls={selected ? 'scouting-player-report' : undefined} onClick={event => selectPlayer(player.id, event.currentTarget)} disabled={disabled}><span aria-hidden="true"><Avatar player={owner?.players.find(member => member.id === player.id) ?? player} color={owner?.color ?? '#687385'} size={28} /></span><span><strong>{player.name}</strong><small>{player.heightCm} cm</small></span><Icon name="chevron" size={13} /></button></th><td>{owner?.name ?? 'Free agent'}</td><td>{player.position}</td><td data-player-knowledge={known.kind}>{knowledgeLabel(known)}{assigned && <small className="scouting-assigned">Observation pending</small>}</td><td>{known.observedOn ? <><time dateTime={known.observedOn}>{scoutingDate(known.observedOn)}</time><small>{known.freshness === 'current' ? 'Current' : known.freshness === 'recent' ? 'Recent' : known.freshness === 'aging' ? 'Aging' : 'Stale'}</small></> : 'No assessment'}</td><td><button className="button small" data-shortlist-player={player.id} aria-pressed={listed} aria-label={`${listed ? 'Remove' : 'Add'} ${player.name} ${listed ? 'from' : 'to'} shortlist`} onClick={() => onShortlist(player.id, !listed)} disabled={disabled || !enabled}>{listed ? 'Shortlisted' : 'Add'}</button></td></tr>
      })}{!players.length && <tr><td colSpan={6} className="scouting-empty">{shortlistOnly && !scouting.shortlist.length ? 'Your shortlist is empty. Add players from All players or their report.' : 'No players match these filters.'}</td></tr>}</tbody></table></div><p className="scouting-note">Your squad has exact current skills. Other players need observations for estimated ranges; up to {MAX_KNOWLEDGE_LEVEL} successful observations improve report depth. Stale reports become less precise.</p>
    </section>

    {enabled && <section className="scouting-activity panel" aria-labelledby="scouting-activity-title"><header className="scouting-heading"><h2 id="scouting-activity-title">Recent reviews</h2><span>Latest {recent.length} · completed matchdays</span></header>{recent.length ? <div className="scouting-table-scroll" tabIndex={0} role="region" aria-label="Recent scouting reviews"><table className="scouting-table scouting-review-table"><thead><tr><th scope="col">Player</th><th scope="col">Observed club</th><th scope="col">Matchday</th><th scope="col">Outcome</th></tr></thead><tbody>{recent.map(review => {
      const player = getDevelopmentPlayer(review.playerId)
      return <tr key={`${review.seasonNumber}:${review.round}:${review.playerId}`} data-scouting-review={review.playerId} data-scouting-outcome={review.outcome}><th scope="row"><button className="text-button" onClick={event => selectPlayer(player.id, event.currentTarget)} disabled={disabled}>{player.name}<Icon name="chevron" size={13} /></button></th><td>{season.clubs.find(team => team.id === review.clubId)!.name}</td><td><time dateTime={review.date}>{scoutingDate(review.date)}</time><small>{seasonLabel(review.seasonNumber)} · Matchday {review.round}</small></td><td>{review.outcome === 'observed' ? 'Observed · report updated' : 'No minutes · knowledge unchanged'}</td></tr>
    })}</tbody></table></div> : <p className="scouting-empty">No reviews yet. Assign an observation, then complete the matchday to receive its outcome.</p>}</section>}
    <p className="scouting-model-note">Fictional development players. Reports estimate current playing skills. Scouting decisions trigger an automatic save; Export keeps a separate file backup.</p>
  </div>
}

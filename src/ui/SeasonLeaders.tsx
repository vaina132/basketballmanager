import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import { getPerformanceCoverage, getSeasonPerformance, isQualifiedLeader } from '../world/performance'
import { seasonLabel } from '../world/season'
import type { PerformanceMode } from '../world/performance'
import { PerformanceLegend, PerformanceModeControl, PerformanceTable } from './PerformanceTable'
import { PlayerPerformanceReport } from './PlayerPerformanceReport'
import { canSplitPhases, hasPhaseGames, phaseRows, STAT_PHASES, type StatPhase } from './season-stat-phases'
import './season-leaders.css'

interface SeasonLeadersProps {
  season: SeasonState
  seasonNumber: number
  clubIds?: readonly string[]
  busy?: boolean
  onReviewFixture?: (fixtureId: string) => void
  /** The competition has playoffs (a league's postseason): a "Regular season | Playoffs" toggle splits the figures. */
  phases?: boolean
  /** International: one European competition's games only, split where it has knockout or playoff games. */
  competitionId?: string
  /** The panel's title; "League player statistics" by default. */
  title?: string
  /** A short note on what the table covers (International: clubs without box scores). */
  scopeNote?: string
}

export function SeasonLeaders({ season, seasonNumber, clubIds, busy = false, onReviewFixture, phases = false, competitionId, title = 'League player statistics', scopeNote }: SeasonLeadersProps) {
  const [clubFilter, setClubFilter] = useState('all')
  const [position, setPosition] = useState('all')
  const [query, setQuery] = useState('')
  const [qualifiedOnly, setQualifiedOnly] = useState(true)
  const [mode, setMode] = useState<PerformanceMode>('per-game')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [phase, setPhase] = useState<StatPhase>('regular')
  const section = useRef<HTMLElement>(null)
  const selectionTrigger = useRef<HTMLElement | null>(null)
  const coverage = getPerformanceCoverage(season, seasonNumber)
  const scope = useMemo(() => competitionId ? { competitionId } : {}, [competitionId])
  // Per-game records allow the split; a season kept partly as season totals stays combined (and has no European table).
  const splittable = useMemo(() => coverage === 'complete' && canSplitPhases(season, seasonNumber, clubIds), [coverage, season, seasonNumber, clubIds])
  const showPhases = splittable && (phases || !!competitionId && hasPhaseGames(season, seasonNumber, scope, 'playoffs', clubIds))
  // Without the toggle a European table covers all of the competition's games.
  const shownPhase: StatPhase | null = showPhases ? phase : null
  const rows = useMemo(() => {
    const all = getSeasonPerformance(season, seasonNumber).filter(row => !clubIds || clubIds.includes(row.club.id))
    if (!splittable || !showPhases && !competitionId) return all
    return phaseRows(season, seasonNumber, all, scope, shownPhase)
  }, [season, seasonNumber, clubIds, splittable, showPhases, competitionId, scope, shownPhase])
  const search = query.trim().toLowerCase()
  const selectedClub = clubFilter === 'managed' ? season.managedClubId : clubFilter
  const matchingRows = rows.filter(row =>
    (selectedClub === 'all' || row.club.id === selectedClub) &&
    (position === 'all' || row.player.position === position) &&
    (!search || row.player.name.toLowerCase().includes(search)),
  )
  const visibleRows = qualifiedOnly ? matchingRows.filter(isQualifiedLeader) : matchingRows
  const selected = visibleRows.find(row => row.key === selectedId)
  const hasResults = rows.some(row => row.clubGames > 0)
  const hasFilters = clubFilter !== 'all' || position !== 'all' || query !== '' || !qualifiedOnly

  useEffect(() => {
    if (selectedId !== null && !selected) {
      setSelectedId(null)
      selectionTrigger.current = null
    }
  }, [selectedId, selected])

  function selectPlayer(id: string) {
    if (busy || !visibleRows.some(row => row.key === id)) return
    selectionTrigger.current = section.current?.querySelector<HTMLElement>(`button[data-performance-key="${CSS.escape(id)}"]`) ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setSelectedId(id)
    if (id === selectedId) {
      const report = document.getElementById('player-performance-report')
      report?.focus({ preventScroll: true })
      report?.scrollIntoView({ block: 'start' })
    }
  }

  function closeReport() {
    if (busy) return
    setSelectedId(null)
    if (selectionTrigger.current?.isConnected) selectionTrigger.current.focus()
    else section.current?.querySelector<HTMLInputElement>('#league-player-search')?.focus()
    selectionTrigger.current = null
  }

  function resetFilters() {
    setClubFilter('all'); setPosition('all'); setQuery(''); setQualifiedOnly(true)
  }

  if (coverage === 'unavailable' || competitionId && !splittable) return <section className="season-leaders panel" aria-labelledby="season-leaders-title">
    <header className="season-panel-heading"><h2 id="season-leaders-title">{title}</h2><span>{seasonLabel(seasonNumber)}</span></header>
    <p className="season-leaders-empty">This save did not retain player statistics for this season. Final standings and team results are still available below.</p>
  </section>

  return <>
    <section ref={section} className="season-leaders panel" aria-labelledby="season-leaders-title">
      <header className="season-panel-heading season-leaders-heading"><div><h2 id="season-leaders-title">{title}</h2><p>{seasonLabel(seasonNumber)}{seasonNumber !== season.seasonNumber ? ' · Archived season' : ''}</p></div><div className="season-leaders-toggles">{showPhases && <div className="segmented season-phase-control" role="group" aria-label="Season phase">{STAT_PHASES.map(option => <button type="button" key={option.id} data-stat-phase={option.id} aria-pressed={phase === option.id} className={phase === option.id ? 'selected' : ''} onClick={() => { setPhase(option.id); setSelectedId(null) }} disabled={busy}>{option.label}</button>)}</div>}<PerformanceModeControl mode={mode} onChange={setMode} busy={busy} idPrefix="league-leaders" /></div></header>
      <div className="season-leader-controls">
        <label htmlFor="league-player-club"><span>Club</span><select id="league-player-club" value={clubFilter} onChange={event => setClubFilter(event.target.value)} disabled={busy}><option value="all">All clubs</option>{(!clubIds || clubIds.includes(season.managedClubId)) && <option value="managed">Your club</option>}{season.clubs.filter(club => !clubIds || clubIds.includes(club.id)).map(club => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>
        <label htmlFor="league-player-position"><span>Position</span><select id="league-player-position" value={position} onChange={event => setPosition(event.target.value)} disabled={busy}><option value="all">All positions</option>{(['PG', 'SG', 'SF', 'PF', 'C'] as const).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="season-leader-search" htmlFor="league-player-search"><span>Search players</span><input id="league-player-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Player name" disabled={busy} /></label>
        <label className="season-leader-qualification" htmlFor="league-player-qualified"><input id="league-player-qualified" type="checkbox" checked={qualifiedOnly} onChange={event => setQualifiedOnly(event.target.checked)} aria-describedby="league-qualification-rule" disabled={busy} /><span>Qualified only</span></label>
        {hasFilters && <button className="text-button season-leader-reset" onClick={resetFilters} disabled={busy}>Reset filters</button>}
      </div>
      <p id="league-qualification-rule" className="season-leader-rule">Qualified: played in half the club's games and 5 minutes a club game.</p>
      {scopeNote && <p className="season-leader-rule" data-stats-scope-note>{scopeNote}</p>}
      {phases && coverage === 'complete' && !splittable && <p className="season-leader-rule" data-phases-combined>Regular season and playoffs are shown together: this season's records are kept as season totals.</p>}
      <div className="season-leader-result-count" role="status">{hasResults ? `${visibleRows.length} ${visibleRows.length === 1 ? 'player' : 'players'} shown` : shownPhase === 'playoffs' ? 'No playoff games recorded yet' : 'No recorded matchdays yet'}</div>
      {!hasResults ? <p className="season-leaders-empty">{shownPhase === 'playoffs' ? 'Playoff statistics appear once the first playoff game is played and recorded.' : 'Player statistics appear after you finish a match and Continue to record the matchday.'}</p> : visibleRows.length ? <>
        <PerformanceTable rows={visibleRows} mode={mode} onSelectPlayer={selectPlayer} selectedPlayerId={selected?.key} showClub managedClubId={season.managedClubId} busy={busy} label={shownPhase ? `${title}, ${shownPhase === 'playoffs' ? 'playoffs' : 'regular season'}` : title} />
        <PerformanceLegend mode={mode} note={`Records keep the club each player played for. Only recorded matchdays of the chosen season count.${shownPhase === 'regular' ? competitionId ? ' Regular season: the regular-season games of this competition.' : ' Regular season: league games before the playoffs; European games are not included.' : shownPhase === 'playoffs' ? ' Playoffs: every postseason game (play-in, playoffs, play-outs and final stages); a club\'s games for qualification are its playoff games.' : competitionId ? ' Only games of this competition count.' : ''}`} />
      </> : <div className="season-leaders-empty">
        <p>{matchingRows.length && qualifiedOnly ? 'No players meet the qualification threshold with these filters.' : 'No players match these filters.'}</p>
        {matchingRows.length > 0 && qualifiedOnly && <button className="text-button" onClick={() => setQualifiedOnly(false)} disabled={busy}>Include unqualified players</button>}
      </div>}
    </section>
    {selected && <PlayerPerformanceReport key={selected.key} season={season} record={selected} onClose={closeReport} onReviewFixture={onReviewFixture ? fixtureId => { if (!busy) onReviewFixture(fixtureId) } : undefined} />}
  </>
}

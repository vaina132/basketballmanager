import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import { getPerformanceCoverage, getSeasonPerformance, isQualifiedLeader } from '../world/performance'
import { seasonLabel } from '../world/season'
import type { PerformanceMode } from '../world/performance'
import { PerformanceLegend, PerformanceModeControl, PerformanceTable } from './PerformanceTable'
import { PlayerPerformanceReport } from './PlayerPerformanceReport'
import './season-leaders.css'

interface SeasonLeadersProps {
  season: SeasonState
  seasonNumber: number
  clubIds?: readonly string[]
  busy?: boolean
  onReviewFixture?: (fixtureId: string) => void
}

export function SeasonLeaders({ season, seasonNumber, clubIds, busy = false, onReviewFixture }: SeasonLeadersProps) {
  const [clubFilter, setClubFilter] = useState('all')
  const [position, setPosition] = useState('all')
  const [query, setQuery] = useState('')
  const [qualifiedOnly, setQualifiedOnly] = useState(true)
  const [mode, setMode] = useState<PerformanceMode>('per-game')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const section = useRef<HTMLElement>(null)
  const selectionTrigger = useRef<HTMLElement | null>(null)
  const coverage = getPerformanceCoverage(season, seasonNumber)
  const rows = useMemo(() => getSeasonPerformance(season, seasonNumber).filter(row => !clubIds || clubIds.includes(row.club.id)), [season, seasonNumber, clubIds])
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

  if (coverage === 'unavailable') return <section className="season-leaders panel" aria-labelledby="season-leaders-title">
    <header className="season-panel-heading"><h2 id="season-leaders-title">League player statistics</h2><span>{seasonLabel(seasonNumber)}</span></header>
    <p className="season-leaders-empty">This save did not retain player statistics for this season. Final standings and team results are still available below.</p>
  </section>

  return <>
    <section ref={section} className="season-leaders panel" aria-labelledby="season-leaders-title">
      <header className="season-panel-heading season-leaders-heading"><div><h2 id="season-leaders-title">League player statistics</h2><p>{seasonLabel(seasonNumber)}{seasonNumber !== season.seasonNumber ? ' · Archived season' : ''}</p></div><PerformanceModeControl mode={mode} onChange={setMode} busy={busy} idPrefix="league-leaders" /></header>
      <div className="season-leader-controls">
        <label htmlFor="league-player-club"><span>Club</span><select id="league-player-club" value={clubFilter} onChange={event => setClubFilter(event.target.value)} disabled={busy}><option value="all">All clubs</option>{(!clubIds || clubIds.includes(season.managedClubId)) && <option value="managed">Your club</option>}{season.clubs.filter(club => !clubIds || clubIds.includes(club.id)).map(club => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>
        <label htmlFor="league-player-position"><span>Position</span><select id="league-player-position" value={position} onChange={event => setPosition(event.target.value)} disabled={busy}><option value="all">All positions</option>{(['PG', 'SG', 'SF', 'PF', 'C'] as const).map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="season-leader-search" htmlFor="league-player-search"><span>Search players</span><input id="league-player-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Player name" disabled={busy} /></label>
        <label className="season-leader-qualification" htmlFor="league-player-qualified"><input id="league-player-qualified" type="checkbox" checked={qualifiedOnly} onChange={event => setQualifiedOnly(event.target.checked)} aria-describedby="league-qualification-rule" disabled={busy} /><span>Qualified only</span></label>
        {hasFilters && <button className="text-button season-leader-reset" onClick={resetFilters} disabled={busy}>Reset filters</button>}
      </div>
      <p id="league-qualification-rule" className="season-leader-rule">Qualified: played in half the club's games and 5 minutes a club game.</p>
      <div className="season-leader-result-count" role="status">{hasResults ? `${visibleRows.length} ${visibleRows.length === 1 ? 'player' : 'players'} shown` : 'No recorded matchdays yet'}</div>
      {!hasResults ? <p className="season-leaders-empty">Player statistics appear after you finish a match and Continue to record the matchday.</p> : visibleRows.length ? <>
        <PerformanceTable rows={visibleRows} mode={mode} onSelectPlayer={selectPlayer} selectedPlayerId={selected?.key} showClub managedClubId={season.managedClubId} busy={busy} label="League player statistics" />
        <PerformanceLegend mode={mode} note="Records keep the club each player played for. Only recorded matchdays of the chosen season count." />
      </> : <div className="season-leaders-empty">
        <p>{matchingRows.length && qualifiedOnly ? 'No players meet the qualification threshold with these filters.' : 'No players match these filters.'}</p>
        {matchingRows.length > 0 && qualifiedOnly && <button className="text-button" onClick={() => setQualifiedOnly(false)} disabled={busy}>Include unqualified players</button>}
      </div>}
    </section>
    {selected && <PlayerPerformanceReport key={selected.key} season={season} record={selected} onClose={closeReport} onReviewFixture={onReviewFixture ? fixtureId => { if (!busy) onReviewFixture(fixtureId) } : undefined} />}
  </>
}

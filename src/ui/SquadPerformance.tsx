import { useMemo, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { PerformanceMode } from '../world/performance'
import { getPerformanceCoverage, getSeasonPerformance } from '../world/performance'
import { seasonLabel } from '../world/season'
import { PerformanceLegend, PerformanceModeControl, PerformanceTable } from './PerformanceTable'
import { PlayerPerformanceReport } from './PlayerPerformanceReport'
import './player-performance.css'

interface SquadPerformanceProps {
  season: SeasonState
  selectedPlayerId: string | null
  onSelectPlayer: (id: string | null) => void
  busy?: boolean
}

export function SquadPerformance({ season, selectedPlayerId, onSelectPlayer, busy = false }: SquadPerformanceProps) {
  const [selectedSeason, setSelectedSeason] = useState(season.seasonNumber)
  const [selectedRecordKey, setSelectedRecordKey] = useState<string | null>(null)
  const [mode, setMode] = useState<PerformanceMode>('per-game')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState('all')
  const trigger = useRef<HTMLElement | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const selectedNumber = selectedSeason === season.seasonNumber || season.history.some(archive => archive.seasonNumber === selectedSeason) ? selectedSeason : season.seasonNumber
  const coverage = getPerformanceCoverage(season, selectedNumber)
  const records = useMemo(() => getSeasonPerformance(season, selectedNumber).filter(row => row.club.id === season.managedClubId), [season, selectedNumber])
  const rows = records.filter(row => (position === 'all' || row.player.position === position) && row.player.name.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = selectedPlayerId === null ? undefined : selectedRecordKey !== null ? records.find(row => row.key === selectedRecordKey && row.player.id === selectedPlayerId) : records.find(row => row.player.id === selectedPlayerId)
  const recordedFixtures = selectedNumber === season.seasonNumber ? season.fixtures : season.history.find(archive => archive.seasonNumber === selectedNumber)!.fixtures
  const clubGames = recordedFixtures.filter(fixture => fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(season.managedClubId)).length
  function clearSelection() { setSelectedRecordKey(null); onSelectPlayer(null) }
  return <div className="squad-performance" ref={container}>
    <section className="squad-performance-panel panel" aria-labelledby="squad-performance-title">
      <header className="squad-performance-heading"><div><h2 id="squad-performance-title">Season statistics</h2><span>{seasonLabel(selectedNumber)} · {coverage === 'unavailable' ? 'Player records unavailable' : `${clubGames} club games recorded`}</span></div><PerformanceModeControl mode={mode} onChange={setMode} busy={busy || coverage === 'unavailable'} idPrefix="squad" /></header>
      <div className="squad-performance-filters"><label htmlFor="squad-performance-season">Season<select id="squad-performance-season" value={selectedNumber} onChange={event => { setSelectedSeason(Number(event.target.value)); clearSelection() }} disabled={busy}><option value={season.seasonNumber}>{seasonLabel(season.seasonNumber)} · Current</option>{[...season.history].reverse().map(archive => <option key={archive.seasonNumber} value={archive.seasonNumber}>{seasonLabel(archive.seasonNumber)} · Archived</option>)}</select></label>{coverage === 'complete' && <><label htmlFor="squad-performance-search">Player<input id="squad-performance-search" type="search" value={query} onChange={event => { setQuery(event.target.value); clearSelection() }} placeholder="Find player" disabled={busy} /></label><label htmlFor="squad-performance-position">Position<select id="squad-performance-position" value={position} onChange={event => { setPosition(event.target.value); clearSelection() }} disabled={busy}><option value="all">All positions</option>{['PG', 'SG', 'SF', 'PF', 'C'].map(value => <option key={value}>{value}</option>)}</select></label><span>{rows.length} / {records.length} players</span></>}</div>
      {coverage === 'unavailable' ? <p className="player-performance-empty">This save did not retain player statistics for this season. Team results remain available in Competitions.</p> : <><PerformanceTable rows={rows} mode={mode} onSelectPlayer={key => {
        trigger.current = container.current?.querySelector<HTMLElement>(`button[data-performance-key="${CSS.escape(key)}"]`) ?? null
        const record = records.find(row => row.key === key)
        if (!record) return
        setSelectedRecordKey(key)
        onSelectPlayer(record.player.id)
        if (key === selected?.key) {
          const report = document.getElementById('player-performance-report')
          report?.focus({ preventScroll: true }); report?.scrollIntoView({ block: 'start' })
        }
      }} selectedPlayerId={selected?.key} busy={busy} label="Squad season statistics" />
      <PerformanceLegend mode={mode} />
      <p className="player-performance-note">Only committed matchdays count. Use the season selector to revisit retained player records after rollover.</p></>}
    </section>
    {selected && <PlayerPerformanceReport key={selected.key} season={season} record={selected} onClose={() => { clearSelection(); const target = trigger.current; if (target?.isConnected && target.closest('.squad-performance')) target.focus(); else container.current?.querySelector<HTMLElement>('#squad-performance-search')?.focus() }} />}
  </div>
}

import { useMemo, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { PerformanceMode } from '../world/performance'
import { getSeasonPerformance } from '../world/performance'
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
  const [mode, setMode] = useState<PerformanceMode>('per-game')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState('all')
  const trigger = useRef<HTMLElement | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const records = useMemo(() => getSeasonPerformance(season).filter(row => row.club.id === season.managedClubId), [season.clubs, season.fixtures, season.managedClubId])
  const rows = records.filter(row => (position === 'all' || row.player.position === position) && row.player.name.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = records.find(row => row.player.id === selectedPlayerId)
  return <div className="squad-performance" ref={container}>
    <section className="squad-performance-panel panel" aria-labelledby="squad-performance-title">
      <header className="squad-performance-heading"><div><h2 id="squad-performance-title">Season statistics</h2><span>{seasonLabel(season.seasonNumber)} · {records[0]?.clubGames ?? 0} club games recorded</span></div><PerformanceModeControl mode={mode} onChange={setMode} busy={busy} idPrefix="squad" /></header>
      <div className="squad-performance-filters"><label htmlFor="squad-performance-search">Player<input id="squad-performance-search" type="search" value={query} onChange={event => { setQuery(event.target.value); onSelectPlayer(null) }} placeholder="Find player" disabled={busy} /></label><label htmlFor="squad-performance-position">Position<select id="squad-performance-position" value={position} onChange={event => { setPosition(event.target.value); onSelectPlayer(null) }} disabled={busy}><option value="all">All positions</option>{['PG', 'SG', 'SF', 'PF', 'C'].map(value => <option key={value}>{value}</option>)}</select></label><span>{rows.length} / {records.length} players</span></div>
      <PerformanceTable rows={rows} mode={mode} onSelectPlayer={id => {
        trigger.current = container.current?.querySelector<HTMLElement>(`button[data-performance-player="${CSS.escape(id)}"]`) ?? null
        onSelectPlayer(id)
        if (id === selectedPlayerId) {
          const report = document.getElementById('player-performance-report')
          report?.focus({ preventScroll: true }); report?.scrollIntoView({ block: 'start' })
        }
      }} selectedPlayerId={selected?.player.id} busy={busy} label="Squad season statistics" />
      <PerformanceLegend mode={mode} />
      <p className="player-performance-note">Only committed matchdays count. The current match is added after Continue; season statistics reset when a new season starts.</p>
    </section>
    {selected && <PlayerPerformanceReport season={season} record={selected} onClose={() => { onSelectPlayer(null); const target = trigger.current; if (target?.isConnected && target.closest('.squad-performance')) target.focus(); else container.current?.querySelector<HTMLElement>('#squad-performance-search')?.focus() }} />}
  </div>
}

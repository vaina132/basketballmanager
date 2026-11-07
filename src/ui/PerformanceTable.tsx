import { useState } from 'react'
import type { PerformanceDirection, PerformanceMetric, PerformanceMode, SeasonPlayerPerformance } from '../world/performance'
import { performanceValue, sortPerformance } from '../world/performance'
import { Avatar } from './Avatar'
import './performance.css'

interface PerformanceTableProps {
  rows: readonly SeasonPlayerPerformance[]
  mode: PerformanceMode
  onSelectPlayer: (id: string) => void
  selectedPlayerId?: string | null
  showClub?: boolean
  managedClubId?: string
  busy?: boolean
  label?: string
}

const columns: readonly { metric: PerformanceMetric; short: string; name: string }[] = [
  { metric: 'games', short: 'GP', name: 'Games played' },
  { metric: 'minutes', short: 'MIN', name: 'Minutes' },
  { metric: 'points', short: 'PTS', name: 'Points' },
  { metric: 'rebounds', short: 'REB', name: 'Rebounds' },
  { metric: 'assists', short: 'AST', name: 'Assists' },
  { metric: 'steals', short: 'STL', name: 'Steals' },
  { metric: 'blocks', short: 'BLK', name: 'Blocks' },
  { metric: 'turnovers', short: 'TO', name: 'Turnovers' },
  { metric: 'fgPercent', short: 'FG%', name: 'Field goal percentage' },
  { metric: 'threePercent', short: '3PT%', name: 'Three-point percentage' },
  { metric: 'ftPercent', short: 'FT%', name: 'Free throw percentage' },
]

const modes: readonly { value: PerformanceMode; label: string }[] = [
  { value: 'per-game', label: 'Per game' },
  { value: 'totals', label: 'Totals' },
  { value: 'per-40', label: 'Per 40' },
]

const isPercentage = (metric: PerformanceMetric) => metric === 'fgPercent' || metric === 'threePercent' || metric === 'ftPercent'

export function formatPerformanceValue(value: number | null, metric: PerformanceMetric, mode: PerformanceMode): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (isPercentage(metric)) return `${value.toFixed(1)}%`
  if (metric === 'minutes') return value.toFixed(1)
  if (metric === 'games' || mode === 'totals') return value.toLocaleString('en-GB', { maximumFractionDigits: 0 })
  return value.toFixed(1)
}

function cellDescription(row: SeasonPlayerPerformance, metric: PerformanceMetric, mode: PerformanceMode, value: number | null): string {
  if (isPercentage(metric)) {
    const [made, attempts] = metric === 'fgPercent' ? [row.totals.fieldGoalsMade, row.totals.fieldGoalsAttempted]
      : metric === 'threePercent' ? [row.totals.threePointersMade, row.totals.threePointersAttempted]
        : [row.totals.freeThrowsMade, row.totals.freeThrowsAttempted]
    return attempts ? `${formatPerformanceValue(value, metric, mode)}; ${made} made from ${attempts} attempts` : 'No shot attempts'
  }
  if (metric === 'games') return `${row.games} appearances in ${row.clubGames} club games`
  if (value === null) return mode === 'per-40' && metric !== 'minutes' ? 'No playing time recorded' : 'No appearances recorded'
  if (metric === 'minutes') {
    const elapsed = `${Math.floor(row.totals.secondsPlayed / 60)} minutes ${row.totals.secondsPlayed % 60} seconds`
    return mode === 'totals' ? `Total court time: ${elapsed}` : `${value.toFixed(1)} minutes per appearance; ${elapsed} in ${row.games} appearances`
  }
  return mode === 'totals' ? `${value} total` : mode === 'per-game' ? `${value.toFixed(1)} per appearance over ${row.games} games` : `${value.toFixed(1)} per 40 minutes played`
}

export function PerformanceModeControl({ mode, onChange, busy = false, idPrefix }: { mode: PerformanceMode; onChange: (mode: PerformanceMode) => void; busy?: boolean; idPrefix: string }) {
  return <div id={`${idPrefix}-performance-mode`} className="segmented performance-mode-control" role="group" aria-label="Statistic display">
    {modes.map(option => <button type="button" key={option.value} id={`${idPrefix}-mode-${option.value}`} aria-pressed={mode === option.value} className={mode === option.value ? 'selected' : ''} onClick={() => onChange(option.value)} disabled={busy}>{option.label}</button>)}
  </div>
}

export function PerformanceLegend({ mode }: { mode: PerformanceMode }) {
  return <div className="performance-legend">
    <p>{mode === 'totals' ? 'Totals cover recorded current-season appearances. MIN is total court time.' : mode === 'per-game' ? 'Per-game figures use each player’s appearances. Unused players are excluded from the average; MPG is minutes per appearance.' : 'Per 40 scales counting statistics to 40 minutes played; it is not a prediction. GP remains appearances and MPG remains minutes per appearance.'}</p>
    <p>Shooting percentages use total makes divided by total attempts. — means no appearances, playing time or attempts for that statistic.</p>
  </div>
}

export function PerformanceTable({ rows, mode, onSelectPlayer, selectedPlayerId, showClub = false, managedClubId, busy = false, label = 'Player performance' }: PerformanceTableProps) {
  const [sort, setSort] = useState<{ metric: PerformanceMetric; direction: PerformanceDirection }>({ metric: 'points', direction: 'desc' })
  const sorted = sortPerformance(rows, sort.metric, mode, sort.direction)

  function changeSort(metric: PerformanceMetric) {
    setSort(current => ({ metric, direction: current.metric === metric && current.direction === 'desc' ? 'asc' : 'desc' }))
  }

  return <div className="performance-table-scroll" role="region" aria-label={`${label} table`} tabIndex={0}>
    <table className={`performance-table${showClub ? ' performance-table-with-club' : ''}`} aria-label={label}>
      <thead><tr><th scope="col" className="performance-player-heading">Player</th>{showClub && <th scope="col" className="performance-club-heading">Club</th>}{columns.map(column => {
        const sortedColumn = sort.metric === column.metric
        const nextDirection = sortedColumn && sort.direction === 'desc' ? 'ascending' : 'descending'
        const columnName = column.metric === 'minutes' ? mode === 'totals' ? 'Total minutes' : 'Minutes per appearance' : column.name
        return <th key={column.metric} scope="col" aria-sort={sortedColumn ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} className={sortedColumn ? 'performance-sorted-heading' : ''}>
          <button type="button" data-sort-metric={column.metric} aria-label={`Sort by ${columnName.toLowerCase()}, ${nextDirection}`} title={columnName} onClick={() => changeSort(column.metric)} disabled={busy}>
            <span>{column.metric === 'minutes' && mode !== 'totals' ? 'MPG' : column.short}</span><span className="performance-sort-direction" aria-hidden="true">{sortedColumn ? sort.direction === 'asc' ? '↑' : '↓' : ''}</span>
          </button>
        </th>
      })}</tr></thead>
      <tbody>{sorted.map(row => <tr key={row.player.id} data-player-id={row.player.id} className={[selectedPlayerId === row.player.id ? 'performance-selected-row' : '', managedClubId === row.club.id ? 'performance-managed-row' : ''].filter(Boolean).join(' ')}>
        <th scope="row"><button type="button" className="performance-player" data-performance-player={row.player.id} aria-label={`View ${row.player.name} performance`} aria-current={selectedPlayerId === row.player.id ? 'true' : undefined} onClick={() => onSelectPlayer(row.player.id)} disabled={busy}>
          <span aria-hidden="true"><Avatar player={row.player} color={row.club.color} size={28} /></span><span><strong>{row.player.name}</strong><small>#{row.player.number} · {row.player.position}</small></span>
        </button></th>
        {showClub && <td className="performance-club"><abbr title={row.club.name} style={{ color: row.club.color }}>{row.club.shortName}</abbr></td>}
        {columns.map(column => {
          const value = performanceValue(row, column.metric, mode)
          const description = cellDescription(row, column.metric, mode, value)
          return <td key={column.metric} data-performance-metric={column.metric} className={column.metric === sort.metric ? 'performance-sorted-value' : ''} title={description}><span aria-hidden="true">{formatPerformanceValue(value, column.metric, mode)}</span><span className="visually-hidden">{description}</span></td>
        })}
      </tr>)}</tbody>
      {!sorted.length && <tbody><tr><td className="performance-empty" colSpan={columns.length + (showClub ? 2 : 1)}>No players match this view.</td></tr></tbody>}
    </table>
  </div>
}

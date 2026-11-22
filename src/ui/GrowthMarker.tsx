import './growth-marker.css'

/**
 * A small growth marker (owner feedback, 22 November 2026): "▲ +2" when a rating rose, "▼ −1" when it fell, nothing
 * when it did not change. The words are in the label and tooltip, not only in the arrow's colour.
 */
export function GrowthMarker({ change, label, since }: { change: number | undefined; label: string; since: string }) {
  if (!change) return null
  const up = change > 0, size = Math.abs(change)
  const text = `${label} ${up ? 'up' : 'down'} ${size} since ${since}`
  return <span className={`growth-marker ${up ? 'is-up' : 'is-down'}`} role="img" aria-label={text} title={text} data-growth={change}>{up ? '▲' : '▼'} {up ? '+' : '−'}{size}</span>
}

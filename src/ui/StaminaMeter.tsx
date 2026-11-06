import './match-lineup.css'

/** Current match energy, rather than the player's permanent stamina attribute. */
export function StaminaMeter({ value, label, compact = false }: { value: number; label: string; compact?: boolean }) {
  const energy = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const level = energy >= 80 ? 'fresh' : energy >= 60 ? 'steady' : energy >= 40 ? 'tiring' : 'low'
  const description = { fresh: 'Fresh', steady: 'Steady', tiring: 'Tiring', low: 'Low' }[level]

  return <div className={`stamina-meter${compact ? ' stamina-meter-compact' : ''}`} data-level={level} data-stamina-value={energy.toFixed(1)}>
    <div className="stamina-reading"><span>{description}</span><strong>{Math.round(energy)}<small>%</small></strong></div>
    <div className="stamina-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(energy)} aria-valuetext={`${Math.round(energy)}% stamina, ${description.toLowerCase()}`}>
      <span className="stamina-fill" style={{ width: `${energy}%` }} />
    </div>
  </div>
}

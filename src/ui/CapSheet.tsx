import type { SeasonState } from '../domain/season'
import { nbaCapSheet } from '../world/nba-cap-policy'
import { seasonLabel } from '../world/season'
import { formatMoney } from './money-format'
import './cap-sheet.css'

/**
 * NBA step 6 (format 91): the cap sheet of an NBA club on Squad > Contracts: its payroll against the salary cap, the
 * luxury tax line and the first apron, the owner's limit, cap room, the mid-level exception and the tax the payroll
 * would cost. The season shown is the current one, or the next one once the offseason has started. Amounts follow the
 * currency setting.
 */
export function CapSheet({ season, clubId }: { season: SeasonState; clubId: string }) {
  const year = season.status === 'complete' ? season.seasonNumber + 1 : season.seasonNumber
  const sheet = nbaCapSheet(season, clubId, year)
  if (!sheet) return null
  const top = Math.max(sheet.firstApron, sheet.payroll, sheet.ceiling) * 1.05
  const at = (value: number) => `${Math.min(100, value / top * 100).toFixed(1)}%`
  const rows: [string, string, string?][] = [
    ['Payroll', formatMoney(sheet.payroll), sheet.deadMoney ? `includes ${formatMoney(sheet.deadMoney)} for released players` : undefined],
    ['Salary cap', formatMoney(sheet.cap), sheet.room ? `${formatMoney(sheet.room)} room` : 'over the cap'],
    ['Luxury tax line', formatMoney(sheet.taxLine)],
    ['First apron', formatMoney(sheet.firstApron)],
    ["Owner's limit", formatMoney(sheet.ceiling), 'the most the owner pays in player wages'],
    ['Mid-level exception', sheet.midLevelUsed ? 'Used' : `Up to ${formatMoney(sheet.midLevel)}`, sheet.midLevelUsed ? 'one a season' : 'one signing this offseason'],
    ['Tax due', sheet.taxDue ? formatMoney(sheet.taxDue) : 'None', 'paid after the regular season'],
  ]
  return <section className="cap-sheet panel" aria-labelledby="cap-sheet-heading" data-cap-sheet>
    <header><h3 id="cap-sheet-heading">Cap sheet</h3><span>{seasonLabel(year)} · {sheet.roster} of {sheet.minRoster}–{sheet.maxRoster} players</span></header>
    <div className="cap-sheet-bar" role="img" aria-label={`Payroll ${formatMoney(sheet.payroll)} against a salary cap of ${formatMoney(sheet.cap)}`}>
      <span className={`cap-sheet-fill${sheet.taxDue ? ' cap-sheet-taxed' : ''}`} style={{ width: at(sheet.payroll) }} />
      <i style={{ left: at(sheet.cap) }} title="Salary cap" /><i style={{ left: at(sheet.taxLine) }} title="Luxury tax line" /><i style={{ left: at(sheet.firstApron) }} title="First apron" />
    </div>
    <dl>{rows.map(([label, value, note]) => <div key={label}><dt>{label}</dt><dd>{value}{note && <small>{note}</small>}</dd></div>)}</dl>
  </section>
}

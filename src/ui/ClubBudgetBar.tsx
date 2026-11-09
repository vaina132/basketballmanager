import type { SeasonState } from '../domain/season'
import { COACHING_BUDGET, coachingCommitted } from '../world/coaching'
import { getClubContractSummary } from '../world/employment-policy'
import { getFinanceBalance } from '../world/finance'
import { getPayrollReserve, getSpendableCash } from '../world/payroll'
import { MAX_SEASON_NUMBER, seasonLabel } from '../world/season'
import { Icon } from './Icon'
import './club-budget-bar.css'

interface ClubBudgetBarProps {
  season: SeasonState
  disabled?: boolean
  onOpenClub: () => void
  onOpenStaff: () => void
  onOpenTransfers: () => void
}
const money = (value: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value / 100)

/** One consistent view of the existing cash and annual allowances; never adds unlike budgets. */
export function ClubBudgetBar({ season, disabled, onOpenClub, onOpenStaff, onOpenTransfers }: ClubBudgetBarProps) {
  const clubId = season.managedClubId
  const finance = season.finance.enabledSince !== null
  const coaching = season.coaching.enabledSince !== null
  const employment = season.employment.enabledSince !== null && season.seasonNumber < MAX_SEASON_NUMBER
  const balance = getFinanceBalance(season.finance, clubId)
  const reserve = getPayrollReserve(season, clubId)
  const cash = getSpendableCash(season, clubId)
  const staffCommitted = coachingCommitted(season.coaching, clubId)
  const staffAllocation = Math.max(0, COACHING_BUDGET - staffCommitted)
  const staff = finance ? balance.unpaid ? 0 : Math.min(staffAllocation, cash) : staffAllocation
  const players = getClubContractSummary(season, clubId)
  return <section className="club-budget-bar" aria-label="Club budgets">
    <div className="club-budget-values">
      <button className="club-budget-value" onClick={onOpenClub} disabled={disabled} title="Cash left after this season’s remaining player wages"><Icon name="wallet" size={20} /><span><small>Cash after wages</small><strong data-budget-cash={finance ? cash : undefined}>{finance ? money(cash) : 'Finances off'}</strong></span>{finance && balance.unpaid > 0 && <span className="budget-alert">Unpaid costs</span>}</button>
      <button className="club-budget-value" onClick={onOpenStaff} disabled={disabled} title="Staff hiring room, limited by both the coaching allowance and available cash"><Icon name="staff" size={20} /><span><small>Staff hiring · this season</small><strong data-budget-staff={coaching ? staff : undefined}>{coaching ? money(staff) : 'Coaching off'}</strong></span></button>
      <button className="club-budget-value" onClick={onOpenTransfers} disabled={disabled} title="Remaining annual player wage allowance for next season; enough room must remain to complete the squad"><Icon name="people" size={20} /><span><small>Player wages · next season</small><strong data-budget-players={employment ? players.remainingBudget : undefined}>{employment ? <>{money(players.remainingBudget)}<em> / year</em></> : season.employment.enabledSince ? 'Calendar limit' : 'Contracts off'}</strong></span></button>
    </div>
    <details className="club-budget-details" id="club-budget-details"><summary><Icon name="wallet" size={14} />Budget details</summary><div className="club-budget-breakdown">
      <div><h3><Icon name="wallet" size={16} />Club cash</h3>{finance ? <dl><div><dt>Bank balance</dt><dd>{money(balance.cash)}</dd></div><div><dt>Remaining player wages</dt><dd>{money(reserve)}</dd></div><div><dt>Unpaid costs</dt><dd>{money(balance.unpaid)}</dd></div><div><dt>Cash after wages</dt><dd>{money(cash)}</dd></div></dl> : <p>Enable finances in Club to track cash.</p>}</div>
      <div><h3><Icon name="staff" size={16} />Staff · {seasonLabel(season.seasonNumber)}</h3>{coaching ? <dl><div><dt>Season allowance</dt><dd>{money(COACHING_BUDGET)}</dd></div><div><dt>Fees committed</dt><dd>{money(staffCommitted)}</dd></div><div><dt>Allowance remaining</dt><dd>{money(staffAllocation)}</dd></div><div><dt>Available staff funds</dt><dd>{money(staff)}</dd></div></dl> : <p>Enable coaching in Staff to hire coaches.</p>}</div>
      <div><h3><Icon name="people" size={16} />Players · {employment ? seasonLabel(season.seasonNumber + 1) : 'Next season'}</h3>{employment ? <dl><div><dt>Annual allowance</dt><dd>{money(players.budget)}</dd></div><div><dt>Signed wages / year</dt><dd>{money(players.seasonWages)}</dd></div><div><dt>Room to finish the squad</dt><dd>{money(players.minimumReserve)}</dd></div><div><dt>Extra wage room / year</dt><dd>{money(players.spendableBudget)}</dd></div></dl> : <p>{season.employment.enabledSince ? 'The supported calendar has ended.' : 'Enable player contracts in Transfers to plan wages.'}</p>}</div>
      <p>Staff fees are paid now. Player wages are an annual allowance for next season. These are separate limits, not amounts to add together.</p>
    </div></details>
  </section>
}

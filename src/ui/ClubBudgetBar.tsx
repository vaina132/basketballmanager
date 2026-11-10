import type { SeasonState } from '../domain/season'
import { COACHING_BUDGET, coachingCommitted } from '../world/coaching'
import { getClubContractSummary } from '../world/employment-policy'
import { getFinanceBalance } from '../world/finance'
import { getReservedTransferFees } from '../world/market-policy'
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
  const transferReserve = getReservedTransferFees(season, clubId)
  const staffCommitted = coachingCommitted(season.coaching, clubId)
  const staffAllocation = Math.max(0, COACHING_BUDGET - staffCommitted)
  const staff = finance ? balance.unpaid ? 0 : Math.min(staffAllocation, cash) : staffAllocation
  const players = getClubContractSummary(season, clubId)
  return <section className="club-budget-bar" aria-label="Club budgets">
    <div className="club-budget-values">
      <button className="club-budget-value" onClick={onOpenClub} disabled={disabled} title="Money available after setting aside remaining player salaries and pending transfer fees"><Icon name="wallet" size={20} /><span><small>Remaining budget</small><strong data-budget-cash={finance ? cash : undefined}>{finance ? money(cash) : 'Finances off'}</strong></span>{finance && balance.unpaid > 0 && <span className="budget-alert">Unpaid costs</span>}</button>
      <button className="club-budget-value" onClick={onOpenStaff} disabled={disabled} title="Money available to hire staff this season, within the staff limit and remaining club budget"><Icon name="staff" size={20} /><span><small>Remaining staff budget</small><strong data-budget-staff={coaching ? staff : undefined}>{coaching ? money(staff) : 'Coaching off'}</strong></span></button>
      <button className="club-budget-value" onClick={onOpenTransfers} disabled={disabled} title="Salary budget remaining for next season, after signed contracts and pending offers. Keep enough to complete the squad."><Icon name="people" size={20} /><span><small>Player salary budget</small><strong data-budget-players={employment ? players.remainingBudget : undefined}>{employment ? <>{money(players.remainingBudget)}<em> / year</em></> : season.employment.enabledSince ? 'Calendar limit' : 'Contracts off'}</strong></span></button>
    </div>
    <details className="club-budget-details" id="club-budget-details"><summary><Icon name="wallet" size={14} />Budget details</summary><div className="club-budget-breakdown">
      <div><h3><Icon name="wallet" size={16} />Club budget</h3>{finance ? <dl><div><dt>Bank balance</dt><dd>{money(balance.cash)}</dd></div><div><dt>Reserved for player salaries</dt><dd>{money(reserve)}</dd></div>{transferReserve > 0 && <div><dt>Reserved transfer fees</dt><dd data-budget-transfer-fees={transferReserve}>{money(transferReserve)}</dd></div>}<div><dt>Unpaid costs</dt><dd>{money(balance.unpaid)}</dd></div><div><dt>Remaining budget</dt><dd>{money(cash)}</dd></div></dl> : <p>Enable finances in Club to track the budget.</p>}</div>
      <div><h3><Icon name="staff" size={16} />Staff budget · {seasonLabel(season.seasonNumber)}</h3>{coaching ? <dl><div><dt>Total staff budget</dt><dd>{money(COACHING_BUDGET)}</dd></div><div><dt>Staff fees committed</dt><dd>{money(staffCommitted)}</dd></div><div><dt>Staff allocation remaining</dt><dd>{money(staffAllocation)}</dd></div><div><dt>Remaining staff budget</dt><dd>{money(staff)}</dd></div></dl> : <p>Enable coaching in Staff to hire coaches.</p>}</div>
      <div><h3><Icon name="people" size={16} />Player salaries · {employment ? seasonLabel(season.seasonNumber + 1) : 'Next season'}</h3>{employment ? <dl><div><dt>Total salary budget / year</dt><dd>{money(players.budget)}</dd></div><div><dt>Signed salaries / year</dt><dd>{money(players.seasonWages)}</dd></div>{players.reservedRosterSize > 0 && <><div><dt>Pending offers / year</dt><dd data-budget-offers={players.reservedWages}>{money(players.reservedWages)}</dd></div><div><dt>Squad places held</dt><dd>{players.reservedRosterSize}</dd></div></>}<div><dt>Salary budget remaining</dt><dd>{money(players.remainingBudget)}</dd></div><div><dt>Reserved to complete the squad</dt><dd>{money(players.minimumReserve)}</dd></div><div><dt>Available after squad reserve</dt><dd>{money(players.spendableBudget)}</dd></div></dl> : <p>{season.employment.enabledSince ? 'The supported calendar has ended.' : 'Enable player contracts in Transfers to plan salaries.'}</p>}</div>
      <p>Staff hires use this season’s club budget and staff limit. The player salary budget covers next season’s contracts. Signed salaries and pending offers are already deducted. Transfer fees are paid from the remaining club budget only when the player signs.</p>
    </div></details>
  </section>
}

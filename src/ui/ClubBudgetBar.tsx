import type { SeasonState } from '../domain/season'
import { staffAllocation as staffAllocationFor, remainingStaffBudget } from '../world/staff-policy'
import { BOARD_VERDICT_EFFECTS, governingVerdict, salaryBudgetBasis, type SalaryBudgetBasis } from '../world/board-consequences'
import { getFinanceBalance } from '../world/finance'
import { getInSeasonBudget, getReservedInSeasonFees } from '../world/recruitment-policy'
import { getReservedTransferFees } from '../world/market-policy'
import { getTransferPaymentSummary } from '../world/transfer-payments'
import { getPayrollReserve, getSpendableCash } from '../world/payroll'
import { getClubContractSummary } from '../world/employment-policy'
import { usesWagePool, wagesLeft } from '../world/wage-pool'
import { staffWageReserve, usesStaffContracts } from '../world/staff-contracts'
import { seasonLabel } from '../world/season'
import { Icon } from './Icon'
import './club-budget-bar.css'
import { formatEuros } from './money-format'

interface ClubBudgetBarProps {
  season: SeasonState
  disabled?: boolean
  onOpenClub: () => void
  onOpenStaff: () => void
  onOpenTransfers: () => void
}
const money = (value: number) => formatEuros(value, true)
const signedPercent = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`
/** Format 70: how the board's season verdict set a salary budget, for the budget details. */
function salaryBasisText(basis: SalaryBudgetBasis): string | null {
  if (!basis.governed) return null
  if (basis.provisional) return `Provisional until this season's verdict: ${signedPercent(basis.percent)} (the lowest verdict) on ${money(basis.standard)}`
  return basis.verdict ? `${BOARD_VERDICT_EFFECTS[basis.verdict.verdict].label} verdict, ${seasonLabel(basis.verdict.seasonNumber)}: ${signedPercent(basis.percent)} on ${money(basis.standard)}` : `Standard budget: no verdict for this club`
}

/** Short plain explanations on hover (owner feedback, 18 November 2026: simpler and more playable). */
export const BUDGET_HELP = Object.freeze({
  wages: 'Money left for wages: player wages and staff fees share it. Signing or renewing a player and hiring staff use it.',
  spending: 'Money left to spend: transfer fees, facilities and arena seats. Wages still to pay are already set aside. A bank loan adds to it.',
})

/**
 * Owner feedback (18 November 2026): two budgets. **Wages left** is one pool for player wages and staff fees (this
 * season while it is played, the coming season in the offseason); **Spending left** is the club's spendable money for
 * transfer fees, facilities and the arena. Careers before the wage pool (format 74 and earlier) show the same two
 * figures, and their details say that wages and staff keep separate limits there.
 */
export function ClubBudgetBar({ season, disabled, onOpenClub, onOpenStaff }: ClubBudgetBarProps) {
  const clubId = season.managedClubId
  const finance = season.finance.enabledSince !== null
  const pooled = usesWagePool(season)
  const balance = getFinanceBalance(season.finance, clubId)
  const reserve = getPayrollReserve(season, clubId)
  const staffReserve = staffWageReserve(season, clubId)
  const cash = getSpendableCash(season, clubId)
  const pendingFees = getReservedInSeasonFees(season, clubId) + getReservedTransferFees(season, clubId)
  const transferPayments = getTransferPaymentSummary(season, clubId)
  const wages = wagesLeft(season, clubId)
  const totalStaffBudget = staffAllocationFor(season, clubId, wages.seasonNumber)
  const staffVerdict = governingVerdict(season, clubId, season.seasonNumber)
  const salaryBasis = salaryBasisText(salaryBudgetBasis(season, clubId, wages.seasonNumber))
  const current = wages.seasonNumber === season.seasonNumber
  const salaryRoom = season.employment.enabledSince ? current ? getInSeasonBudget(season, clubId).remainingBudget : getClubContractSummary(season, clubId, wages.seasonNumber).remainingBudget : 0
  const period = current ? 'this season' : `next season (${seasonLabel(wages.seasonNumber)})`
  return <section className="club-budget-bar" aria-label="Club budgets">
    <div className="club-budget-values">
      <button className="club-budget-value" onClick={onOpenStaff} disabled={disabled} title={`${BUDGET_HELP.wages} For ${period}.`}><Icon name="people" size={20} /><span><small>Wages left</small><strong data-budget-wages={wages.amount}>{money(wages.amount)}</strong></span></button>
      <button className="club-budget-value" onClick={onOpenClub} disabled={disabled} title={BUDGET_HELP.spending}><Icon name="wallet" size={20} /><span><small>Spending left</small><strong data-budget-cash={finance ? cash : undefined}>{finance ? money(cash) : 'Finances off'}</strong></span>{finance && (balance.unpaid > 0 || transferPayments.overdue > 0) && <span className="budget-alert">{transferPayments.overdue ? 'Overdue transfer' : 'Unpaid costs'}</span>}</button>
    </div>
    <details className="club-budget-details" id="club-budget-details"><summary><Icon name="wallet" size={14} />Budget details</summary><div className="club-budget-breakdown">
      <div><h3><Icon name="people" size={16} />Wages left · {seasonLabel(wages.seasonNumber)}</h3><dl>
        <div><dt>Budget for players</dt><dd>{money(wages.pool - totalStaffBudget)}</dd></div>
        {salaryBasis && <div><dt>Set by the board</dt><dd data-budget-salary-basis={current ? 'current' : 'next'}>{salaryBasis}</dd></div>}
        <div><dt>Budget for staff</dt><dd data-budget-staff-total={totalStaffBudget}>{money(totalStaffBudget)}</dd></div>
        {staffVerdict && <div><dt>Staff budget set by the board</dt><dd>{BOARD_VERDICT_EFFECTS[staffVerdict.verdict].label} verdict, {seasonLabel(staffVerdict.seasonNumber)}</dd></div>}
        <div><dt>Player wages and offers</dt><dd data-budget-player-wages={wages.players}>−{money(wages.players)}</dd></div>
        <div><dt>Staff fees</dt><dd data-budget-staff-fees={wages.staff}>−{money(wages.staff)}</dd></div>
        <div><dt>Wages left</dt><dd>{money(wages.amount)}</dd></div>
      </dl>{!pooled && <p data-budget-split="true">This career started before the two budgets: players can use {money(salaryRoom)} of it and staff {money(remainingStaffBudget(season, clubId))}.</p>}</div>
      <div><h3><Icon name="wallet" size={16} />Spending left</h3>{finance ? <dl>
        <div><dt>Money in the bank</dt><dd>{money(balance.cash)}</dd></div>
        <div><dt>Wages still to pay</dt><dd>−{money(reserve)}</dd></div>
        {staffReserve > 0 && <div><dt>Staff salaries still to pay</dt><dd data-budget-staff-reserve={staffReserve}>−{money(staffReserve)}</dd></div>}
        {pendingFees > 0 && <div><dt>Transfer offers waiting</dt><dd data-budget-transfer-fees={pendingFees}>−{money(pendingFees)}</dd></div>}
        {transferPayments.outgoingRemaining > 0 && <div><dt>Transfer fees still to pay</dt><dd data-budget-transfer-outstanding={transferPayments.outgoingRemaining}>−{money(transferPayments.outgoingRemaining)}</dd></div>}
        {balance.unpaid > 0 && <div><dt>Unpaid costs</dt><dd>{money(balance.unpaid)}</dd></div>}
        <div><dt>Spending left</dt><dd>{money(cash)}</dd></div>
      </dl> : <p>Club finances are off in this career.</p>}</div>
      <p>Wages left: player wages and staff fees share one budget. {usesStaffContracts(season) ? 'Staff salaries are paid weekly; the rest of this season is set aside from Spending left.' : 'Staff fees are paid when you hire, so a hire also needs Spending left.'} Spending left pays transfer fees, facilities and arena seats; money from a sale counts when it arrives.</p>
    </div></details>
  </section>
}

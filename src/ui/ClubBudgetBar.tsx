import type { SeasonState } from '../domain/season'
import { staffAllocation as staffAllocationFor, staffCommitmentsByRole, remainingStaffBudget } from '../world/staff-policy'
import { getClubContractSummary } from '../world/employment-policy'
import { getFinanceBalance } from '../world/finance'
import { getInSeasonBudget, getReservedInSeasonFees, getReservedInSeasonWages } from '../world/recruitment-policy'
import { getReservedTransferFees } from '../world/market-policy'
import { getTransferPaymentSummary } from '../world/transfer-payments'
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
const money = (value: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value / 100)

/** One consistent view of the existing cash and annual allowances; never adds unlike budgets. */
export function ClubBudgetBar({ season, disabled, onOpenClub, onOpenStaff, onOpenTransfers }: ClubBudgetBarProps) {
  const clubId = season.managedClubId
  const finance = season.finance.enabledSince !== null
  const staffing = season.coaching.enabledSince !== null || season.scouts.enabledSince !== null || season.fitness.enabledSince !== null || season.physio.enabledSince !== null || season.assistant.enabledSince !== null || season.youth.enabledSince !== null
  const employment = season.employment.enabledSince !== null && season.seasonNumber < MAX_SEASON_NUMBER
  const balance = getFinanceBalance(season.finance, clubId)
  const reserve = getPayrollReserve(season, clubId)
  const cash = getSpendableCash(season, clubId)
  const recruitmentFees = getReservedInSeasonFees(season, clubId)
  const recruitmentReserve = getReservedInSeasonWages(season, clubId)
  const currentPlayers = getInSeasonBudget(season, clubId)
  const transferReserve = getReservedTransferFees(season, clubId)
  const transferPayments = getTransferPaymentSummary(season, clubId)
  const commitments = staffCommitmentsByRole(season, clubId)
  const committed = commitments.total
  const coachFees = commitments.coaches
  const scoutFees = commitments.scouts
  const fitnessFees = commitments.fitness
  const physioFees = commitments.physio
  const assistantFees = commitments.assistant
  const youthFees = commitments.youth
  const totalStaffBudget = staffAllocationFor(season, clubId)
  const staffAllocation = Math.max(0, totalStaffBudget - committed)
  const staff = remainingStaffBudget(season, clubId)
  const players = getClubContractSummary(season, clubId)
  return <section className="club-budget-bar" aria-label="Club budgets">
    <div className="club-budget-values">
      <button className="club-budget-value" onClick={onOpenClub} disabled={disabled} title="Money available after setting aside remaining player salaries, pending recruitment salaries, pending transfer offers and agreed unpaid transfer fees"><Icon name="wallet" size={20} /><span><small>Remaining budget</small><strong data-budget-cash={finance ? cash : undefined}>{finance ? money(cash) : 'Finances off'}</strong></span>{finance && (balance.unpaid > 0 || transferPayments.overdue > 0) && <span className="budget-alert">{transferPayments.overdue ? 'Overdue transfer' : 'Unpaid costs'}</span>}</button>
      <button className="club-budget-value" onClick={onOpenStaff} disabled={disabled} title="Money available to hire staff this season, within the staff limit and remaining club budget"><Icon name="staff" size={20} /><span><small>Remaining staff budget</small><strong data-budget-staff={staffing ? staff : undefined}>{staffing ? money(staff) : 'Staff off'}</strong></span></button>
      <button className="club-budget-value" onClick={onOpenTransfers} disabled={disabled} title="Salary budget remaining for next season, after signed contracts and pending offers. Keep enough to complete the squad."><Icon name="people" size={20} /><span><small>Player salary budget</small><strong data-budget-players={employment ? players.remainingBudget : undefined}>{employment ? <>{money(players.remainingBudget)}<em> / year</em></> : season.employment.enabledSince ? 'Calendar limit' : 'Contracts off'}</strong></span></button>
    </div>
    <details className="club-budget-details" id="club-budget-details"><summary><Icon name="wallet" size={14} />Budget details</summary><div className="club-budget-breakdown">
      <div><h3><Icon name="wallet" size={16} />Club budget</h3>{finance ? <dl><div><dt>Bank balance</dt><dd>{money(balance.cash)}</dd></div><div><dt>Reserved for player salaries</dt><dd>{money(reserve)}</dd></div>{recruitmentReserve > 0 && <div><dt>Pending recruitment salaries</dt><dd data-budget-in-season-reserve={recruitmentReserve}>{money(recruitmentReserve)}</dd></div>}{recruitmentFees > 0 && <div><dt>Pending midseason transfer fees</dt><dd data-budget-in-season-fees={recruitmentFees}>{money(recruitmentFees)}</dd></div>}{transferReserve > 0 && <div><dt>Pending transfer offers</dt><dd data-budget-transfer-fees={transferReserve}>{money(transferReserve)}</dd></div>}{transferPayments.outgoingRemaining > 0 && <div><dt>Agreed fees remaining</dt><dd data-budget-transfer-outstanding={transferPayments.outgoingRemaining}>{money(transferPayments.outgoingRemaining)}</dd></div>}{transferPayments.overdue > 0 && <div><dt>Overdue fees (included above)</dt><dd data-budget-transfer-overdue={transferPayments.overdue}>{money(transferPayments.overdue)}</dd></div>}<div><dt>Unpaid costs</dt><dd>{money(balance.unpaid)}</dd></div><div><dt>Remaining budget</dt><dd>{money(cash)}</dd></div></dl> : <p>Enable finances in Club to track the budget.</p>}</div>
      <div><h3><Icon name="staff" size={16} />Staff budget · {seasonLabel(season.seasonNumber)}</h3>{staffing ? <dl><div><dt>Total staff budget</dt><dd data-budget-staff-total={totalStaffBudget}>{money(totalStaffBudget)}</dd></div><div><dt>Training coach fees</dt><dd>{money(coachFees)}</dd></div>{scoutFees > 0 && <div><dt>Scout fees</dt><dd data-budget-scout-fees={scoutFees}>{money(scoutFees)}</dd></div>}{fitnessFees > 0 && <div><dt>Fitness coach fees</dt><dd data-budget-fitness-fees={fitnessFees}>{money(fitnessFees)}</dd></div>}{physioFees > 0 && <div><dt>Physio fees</dt><dd data-budget-physio-fees={physioFees}>{money(physioFees)}</dd></div>}{assistantFees > 0 && <div><dt>Assistant coach fees</dt><dd data-budget-assistant-fees={assistantFees}>{money(assistantFees)}</dd></div>}{youthFees > 0 && <div><dt>Youth coach fees</dt><dd data-budget-youth-fees={youthFees}>{money(youthFees)}</dd></div>}<div><dt>Staff fees committed</dt><dd>{money(committed)}</dd></div><div><dt>Staff allocation remaining</dt><dd>{money(staffAllocation)}</dd></div><div><dt>Remaining staff budget</dt><dd>{money(staff)}</dd></div></dl> : <p>Enable staff recruitment in Staff.</p>}</div>
      <div><h3><Icon name="people" size={16} />Player salaries · {employment ? seasonLabel(season.seasonNumber + 1) : 'Next season'}</h3>{employment ? <dl><div><dt>Total salary budget / year</dt><dd>{money(players.budget)}</dd></div><div><dt>Signed salaries / year</dt><dd>{money(players.seasonWages)}</dd></div>{players.reservedRosterSize > 0 && <><div><dt>Pending offers / year</dt><dd data-budget-offers={players.reservedWages}>{money(players.reservedWages)}</dd></div><div><dt>Squad places held</dt><dd>{players.reservedRosterSize}</dd></div></>}<div><dt>Salary budget remaining</dt><dd>{money(players.remainingBudget)}</dd></div><div><dt>Reserved to complete the squad</dt><dd>{money(players.minimumReserve)}</dd></div><div><dt>Available after squad reserve</dt><dd>{money(players.spendableBudget)}</dd></div></dl> : <p>{season.employment.enabledSince ? 'The supported calendar has ended.' : 'Enable player contracts in Transfers to plan salaries.'}</p>}</div>
      {season.recruitment.enabledSince && <div className="club-budget-current-salaries"><h3><Icon name="people" size={16} />Player salaries &middot; {seasonLabel(season.seasonNumber)} (current season)</h3><dl><div><dt>Total salary budget / year</dt><dd>{money(currentPlayers.budget)}</dd></div><div><dt>Signed salaries / year</dt><dd>{money(currentPlayers.seasonWages)}</dd></div><div><dt>Pending offers / year</dt><dd>{money(currentPlayers.reservedWages)}</dd></div><div><dt>Salary budget remaining / year</dt><dd data-budget-current-players={currentPlayers.remainingBudget}>{money(currentPlayers.remainingBudget)}</dd></div></dl></div>}
      <p>Training coaches, scouts, fitness coaches, physios, assistant coaches and youth coaches share this season’s club budget and staff limit. The player salary budget covers next season’s contracts. Signed salaries and pending offers are already deducted. Current-season offers reserve remaining salary costs and any full transfer fee from Remaining budget. The full unpaid transfer fee stays reserved, including future payments. Sale income is available only when received. Overdue transfer payments block staff hiring, paid transfers and contract buyouts.</p>
    </div></details>
  </section>
}

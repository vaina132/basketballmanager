import { staffLimit } from './wage-pool';
import type { SeasonState } from '../domain/season';
import type { SeasonCoaching } from '../domain/coaching';
import { DEVELOPMENT_COACHES } from '../data/development-coaches';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness';
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios';
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants';
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth';
import { getFinanceBalance } from './finance';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary } from './transfer-payments';
import { staffAllocation } from './board-consequences';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY, staffMember } from '../data/staff-directory';
import type { WorldContext } from '../domain/world';
import { staffFee } from './economy';
import { usesClubLevelStaff } from './staff-levels';
import { formatEuros } from '../ui/money-format';
import { staffHireReserve, usesStaffContracts } from './staff-contracts';
import { seasonRounds } from './career-world';
import { usesBankLoans } from './facility-debt';
import { quoteBankLoan } from './facility-financing';

export { STAFF_BUDGET } from './staff-constants';
export { staffAllocation } from './board-consequences';

/**
 * The season's staff fees counted against the club's staff budget (fees at the club's money level, format 62).
 * Earlier careers keep released appointments' full fees in it; format 74 careers (`coaching-2`) count the staff the
 * club employs now: a sacked person's paid fee is not refunded but no longer uses the budget.
 */
export function staffCommitmentsByRole(state: Pick<SeasonState, 'coaching' | 'seasonNumber'> & Partial<Pick<SeasonState, 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth'>> & WorldContext, clubId: string): { coaches: number; scouts: number; fitness: number; physio: number; assistant: number; youth: number; total: number } {
  const current = usesClubLevelStaff(state);
  const counts = (contract: { releasedRound: number | null }) => !current || contract.releasedRound === null;
  const coaches = state.coaching.contracts.filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && counts(contract)).reduce((sum, contract) => sum + staffFee(state, clubId, staffMember(COACH_DIRECTORY, contract.coachId)?.fee ?? 0), 0);
  const scouts = (state.scouts?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && counts(contract)).reduce((sum, contract) => sum + staffFee(state, clubId, staffMember(SCOUT_DIRECTORY, contract.scoutId)?.fee ?? 0), 0);
  const fitness = (state.fitness?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && counts(contract)).reduce((sum, contract) => sum + staffFee(state, clubId, staffMember(FITNESS_DIRECTORY, contract.coachId)?.fee ?? 0), 0);
  const physio = (state.physio?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && counts(contract)).reduce((sum, contract) => sum + staffFee(state, clubId, staffMember(PHYSIO_DIRECTORY, contract.physioId)?.fee ?? 0), 0);
  const assistant = (state.assistant?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && counts(contract)).reduce((sum, contract) => sum + staffFee(state, clubId, staffMember(ASSISTANT_DIRECTORY, contract.assistantId)?.fee ?? 0), 0);
  const youth = (state.youth?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && counts(contract)).reduce((sum, contract) => sum + staffFee(state, clubId, staffMember(YOUTH_COACH_DIRECTORY, contract.coachId)?.fee ?? 0), 0);
  return { coaches, scouts, fitness, physio, assistant, youth, total: coaches + scouts + fitness + physio + assistant + youth };
}

export function staffCommitted(state: Pick<SeasonState, 'coaching' | 'seasonNumber'> & Partial<Pick<SeasonState, 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth'>> & WorldContext, clubId: string): number { return staffCommitmentsByRole(state, clubId).total; }

/**
 * Why an appointment's season fee does not fit, in plain words naming the real limit and the amounts, or null when it
 * fits. `remainingAllocation` is what the season's staff limit leaves (Wages left in club-level careers) and
 * `remainingBudget` what the club can also pay now (Spending left, the fee is paid in full when hired).
 */
export function staffMoneyReason(state: Pick<SeasonState, 'coaching'>, person: string, fee: number, remainingAllocation: number, remainingBudget: number, clubId?: string): string | null {
  if (fee > remainingAllocation) return usesClubLevelStaff(state) ? `Not enough Wages left: this ${person} costs ${formatEuros(fee)} a season, you have ${formatEuros(remainingAllocation)} left.` : 'This appointment exceeds the shared staff budget. Released staff fees remain committed for this season.';
  if (fee > remainingBudget && !usesStaffContracts(state)) return `Not enough Spending left: the ${formatEuros(fee)} season fee is paid when hired, you have ${formatEuros(remainingBudget)} to spend.`;
  // Format 76: the hire also needs Spending left for this season's salary still to pay (held back like player wages).
  if (clubId !== undefined && usesStaffContracts(state)) return staffSpendingReason(state as SeasonState, clubId, staffHireSpending(state as SeasonState, clubId, fee));
  return null;
}

/**
 * Format 76 (`coaching-4`, owner, 18 November 2026): what a staff hire needs from Spending left and what the club has.
 * `needed` is what the hire adds to this season's staff salary reserve (for a replacement, the whole change at once:
 * compensation for the person leaving, minus his freed salary, plus the new salary); `available` is Spending left now;
 * `after` what is left after the hire (negative when it does not fit).
 */
export interface StaffSpendingCheck { needed: number; available: number; after: number }

let heldStaffDepth = 0;
/**
 * Runs `run` for staff the club already holds rather than hires: the career's opening staff and the season-opening
 * renewals (staff under contract stay, like players' contracts carried into a season). Spending left does not decide
 * them; every other hire, by the manager or a computer club, needs it.
 */
export function keepingHeldStaff<T>(run: () => T, held = true): T {
  if (!held) return run();
  heldStaffDepth += 1;
  try { return run(); } finally { heldStaffDepth -= 1; }
}

/**
 * Format 84 (`coaching.fullStaff`, new careers; owner report, 22 November 2026: computer clubs started a season without a
 * coach): a professional club always fills its six staff roles. A computer club with an empty role first takes the
 * candidate fitting its level and the role's share of the staff budget, then the cheapest candidate its money allows
 * (Wages left, Spending left), and when it can afford no one, the cheapest candidate on the market regardless of money:
 * the minimum appointment. Its salary (or, before staff contracts, its fee) is then owed like any other cost, so what
 * the club's cash cannot cover becomes unpaid costs under the existing rules. The manager's hires are unchanged.
 */
export function usesFullStaff(state: { coaching?: Pick<SeasonCoaching, 'fullStaff'> }): boolean {
  return state.coaching?.fullStaff === true;
}

let minimumStaffDepth = 0;
/** Runs `run` as a minimum appointment (format 84): the money checks of a hire do not apply. */
export function appointingMinimumStaff<T>(run: () => T): T {
  minimumStaffDepth += 1;
  try { return run(); } finally { minimumStaffDepth -= 1; }
}
/** Whether a minimum appointment is being made now (`appointingMinimumStaff`). */
export function minimumStaffAppointment(): boolean { return minimumStaffDepth > 0; }

/** The cheapest candidate (lower fee at the club's money level, then identity), for a minimum appointment. */
export function cheapestStaff<T extends { id: string }>(candidates: readonly T[], fee: (member: T) => number): T | undefined {
  let best: T | undefined, bestFee = Infinity;
  for (const member of candidates) {
    const value = fee(member);
    if (value < bestFee || value === bestFee && best !== undefined && member.id < best.id) { best = member; bestFee = value; }
  }
  return best;
}

/**
 * Whether a scout, fitness coach, physio, assistant or youth coach can join a club now. A season-opening renewal
 * (`kept`) in a career with staff contracts (format 76) only needs him free: staff under contract stay, even one the new
 * season's market no longer lists (the market is sized to the clubs, and clubs promoted from a next division have no
 * country in the world, which shortens the local pools). New hires, and renewals in older careers (whose rollovers stay
 * as they were), need the market. Head coaches follow the same rule in `src/world/coaching.ts`.
 */
export function staffCanJoin(state: Pick<SeasonState, 'coaching'>, kept: boolean, employed: boolean, inMarket: () => boolean): boolean {
  return kept && usesStaffContracts(state) ? !employed : inMarket();
}

/** The Spending left check of a hire at this salary, or null when no check applies (older careers, no finances). */
export function staffHireSpending(state: SeasonState, clubId: string, salary: number): StaffSpendingCheck | null {
  if (heldStaffDepth > 0 || minimumStaffDepth > 0 || !usesStaffContracts(state) || !state.finance.enabledSince) return null;
  const needed = staffHireReserve(state, salary), available = getSpendableCash(state, clubId);
  return { needed, available, after: available - needed };
}

/** The plain refusal when a hire's need does not fit Spending left (with the bank loan when it can cover the gap). */
export function staffSpendingReason(state: SeasonState, clubId: string, check: StaffSpendingCheck | null): string | null {
  if (!check || check.needed <= 0 || check.after >= 0) return null;
  return `Not enough Spending left: this hire needs ${formatEuros(check.needed)} for the rest of the season, you have ${formatEuros(check.available)}.${bankWayOut(state, clubId, -check.after)}`;
}

function bankWayOut(state: SeasonState, clubId: string, shortfall: number): string {
  if (clubId !== state.managedClubId || !usesBankLoans(state.facilities)) return '';
  const loan = quoteBankLoan(state, clubId);
  return loan.canBorrow && loan.maxPrincipal >= shortfall ? ' A bank loan on Club can add the difference.' : '';
}

/**
 * The largest salary a hire can carry under the Spending left check (format 76), so computer clubs choose someone who
 * fits; unlimited when no check applies or the hire adds nothing this season.
 */
export function staffSpendingSalaryCap(state: SeasonState, clubId: string): number {
  const probe = staffHireSpending(state, clubId, 0);
  if (!probe) return Infinity;
  // A salary of one cent a week counts the weeks the hire is paid this season.
  const rounds = seasonRounds(state), weeks = staffHireReserve(state, rounds);
  if (weeks <= 0) return Infinity;
  let salary = Math.floor(probe.available * rounds / weeks);
  while (salary > 0 && staffHireReserve(state, salary) > probe.available) salary -= 1;
  return salary;
}

/** The most a club can pay a new person a season now: Wages left for staff, and (format 76) what Spending left carries. */
export function staffHireBudget(state: SeasonState, clubId = state.managedClubId): number {
  return Math.min(remainingStaffBudget(state, clubId), staffSpendingSalaryCap(state, clubId));
}

/** Matches cash, salary/transfer reservations and arrears guards used by all staff roles. */
export function remainingStaffBudget(state: SeasonState, clubId = state.managedClubId): number {
  const allocation = Math.max(0, staffLimit(state, clubId) - staffCommitted(state, clubId));
  if (!state.finance.enabledSince) return allocation;
  if (getFinanceBalance(state.finance, clubId).unpaid || getTransferPaymentSummary(state, clubId).overdue) return 0;
  // Format 76: staff are paid a weekly salary from Wages left, so Spending left is not needed to hire.
  return usesStaffContracts(state) ? allocation : Math.min(allocation, getSpendableCash(state, clubId));
}

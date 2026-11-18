import { staffLimit } from './wage-pool';
import type { SeasonState } from '../domain/season';
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
import { usesStaffContracts } from './staff-contracts';

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
export function staffMoneyReason(state: Pick<SeasonState, 'coaching'>, person: string, fee: number, remainingAllocation: number, remainingBudget: number): string | null {
  if (fee > remainingAllocation) return usesClubLevelStaff(state) ? `Not enough Wages left: this ${person} costs ${formatEuros(fee)} a season, you have ${formatEuros(remainingAllocation)} left.` : 'This appointment exceeds the shared staff budget. Released staff fees remain committed for this season.';
  if (fee > remainingBudget && !usesStaffContracts(state)) return `Not enough Spending left: the ${formatEuros(fee)} season fee is paid when hired, you have ${formatEuros(remainingBudget)} to spend.`;
  return null;
}

/** Matches cash, salary/transfer reservations and arrears guards used by all staff roles. */
export function remainingStaffBudget(state: SeasonState, clubId = state.managedClubId): number {
  const allocation = Math.max(0, staffLimit(state, clubId) - staffCommitted(state, clubId));
  if (!state.finance.enabledSince) return allocation;
  if (getFinanceBalance(state.finance, clubId).unpaid || getTransferPaymentSummary(state, clubId).overdue) return 0;
  // Format 76: staff are paid a weekly salary from Wages left, so Spending left is not needed to hire.
  return usesStaffContracts(state) ? allocation : Math.min(allocation, getSpendableCash(state, clubId));
}

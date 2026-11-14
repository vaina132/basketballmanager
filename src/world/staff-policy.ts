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
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY } from '../data/staff-directory';

export { STAFF_BUDGET } from './staff-constants';
export { staffAllocation } from './board-consequences';

/** Released appointments keep their full fee in the same annual staff allocation. */
export function staffCommitmentsByRole(state: Pick<SeasonState, 'coaching' | 'seasonNumber'> & Partial<Pick<SeasonState, 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth'>>, clubId: string): { coaches: number; scouts: number; fitness: number; physio: number; assistant: number; youth: number; total: number } {
  const coaches = state.coaching.contracts.filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (COACH_DIRECTORY.find(coach => coach.id === contract.coachId)?.fee ?? 0), 0);
  const scouts = (state.scouts?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (SCOUT_DIRECTORY.find(scout => scout.id === contract.scoutId)?.fee ?? 0), 0);
  const fitness = (state.fitness?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (FITNESS_DIRECTORY.find(coach => coach.id === contract.coachId)?.fee ?? 0), 0);
  const physio = (state.physio?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (PHYSIO_DIRECTORY.find(physio => physio.id === contract.physioId)?.fee ?? 0), 0);
  const assistant = (state.assistant?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (ASSISTANT_DIRECTORY.find(coach => coach.id === contract.assistantId)?.fee ?? 0), 0);
  const youth = (state.youth?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (YOUTH_COACH_DIRECTORY.find(coach => coach.id === contract.coachId)?.fee ?? 0), 0);
  return { coaches, scouts, fitness, physio, assistant, youth, total: coaches + scouts + fitness + physio + assistant + youth };
}

export function staffCommitted(state: Pick<SeasonState, 'coaching' | 'seasonNumber'> & Partial<Pick<SeasonState, 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth'>>, clubId: string): number { return staffCommitmentsByRole(state, clubId).total; }

/** Matches cash, salary/transfer reservations and arrears guards used by all staff roles. */
export function remainingStaffBudget(state: SeasonState, clubId = state.managedClubId): number {
  const allocation = Math.max(0, staffAllocation(state, clubId) - staffCommitted(state, clubId));
  if (!state.finance.enabledSince) return allocation;
  if (getFinanceBalance(state.finance, clubId).unpaid || getTransferPaymentSummary(state, clubId).overdue) return 0;
  return Math.min(allocation, getSpendableCash(state, clubId));
}

import type { SeasonState } from '../domain/season';
import { DEVELOPMENT_COACHES } from '../data/development-coaches';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness';
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios';
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants';
import { getFinanceBalance } from './finance';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary } from './transfer-payments';
import { STAFF_BUDGET } from './staff-constants';

export { STAFF_BUDGET } from './staff-constants';

/** Released appointments keep their full fee in the same annual staff allocation. */
export function staffCommitmentsByRole(state: Pick<SeasonState, 'coaching' | 'seasonNumber'> & Partial<Pick<SeasonState, 'scouts' | 'fitness' | 'physio' | 'assistant'>>, clubId: string): { coaches: number; scouts: number; fitness: number; physio: number; assistant: number; total: number } {
  const coaches = state.coaching.contracts.filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId)?.fee ?? 0), 0);
  const scouts = (state.scouts?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (DEVELOPMENT_SCOUTS.find(scout => scout.id === contract.scoutId)?.fee ?? 0), 0);
  const fitness = (state.fitness?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (DEVELOPMENT_FITNESS_COACHES.find(coach => coach.id === contract.coachId)?.fee ?? 0), 0);
  const physio = (state.physio?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (DEVELOPMENT_PHYSIOS.find(physio => physio.id === contract.physioId)?.fee ?? 0), 0);
  const assistant = (state.assistant?.contracts ?? []).filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + (DEVELOPMENT_ASSISTANTS.find(coach => coach.id === contract.assistantId)?.fee ?? 0), 0);
  return { coaches, scouts, fitness, physio, assistant, total: coaches + scouts + fitness + physio + assistant };
}

export function staffCommitted(state: Pick<SeasonState, 'coaching' | 'seasonNumber'> & Partial<Pick<SeasonState, 'scouts' | 'fitness' | 'physio' | 'assistant'>>, clubId: string): number { return staffCommitmentsByRole(state, clubId).total; }

/** Matches cash, salary/transfer reservations and arrears guards used by all staff roles. */
export function remainingStaffBudget(state: SeasonState, clubId = state.managedClubId): number {
  const allocation = Math.max(0, STAFF_BUDGET - staffCommitted(state, clubId));
  if (!state.finance.enabledSince) return allocation;
  if (getFinanceBalance(state.finance, clubId).unpaid || getTransferPaymentSummary(state, clubId).overdue) return 0;
  return Math.min(allocation, getSpendableCash(state, clubId));
}

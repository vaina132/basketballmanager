import { financeLedgerCount } from './finance-ledger';
import { withCalculationCache } from './pure-cache';
import type { FitnessContract, SeasonFitness } from '../domain/fitness';
import type { SeasonState } from '../domain/season';
import { recordFitnessFee } from './finance';
import { availableFitnessCoaches, getClubFitnessCoach, quoteFitnessHire } from './fitness-policy';
import { seasonRounds } from './career-world';

export function createFitness(): SeasonFitness { return { model: 'fitness-1', enabledSince: null, contracts: [] }; }

export function enableFitness(state: SeasonState): SeasonState {
  if (state.fitness.enabledSince) return state;
  if (!state.finance.enabledSince || !state.training.enabledSince) throw new Error('Enable club finances and training before recruiting fitness coaches.');
  if (state.status !== 'active' || state.round === seasonRounds(state)) throw new Error('Enable fitness coaches when weekly training is available, before the final matchday.');
  return recruitAiFitnessCoaches({ ...state, fitness: { ...state.fitness, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: financeLedgerCount(state.finance) } } });
}

function hireForClub(state: SeasonState, coachId: string, clubId: string): SeasonState {
  const quote = quoteFitnessHire(state, coachId, clubId);
  if (!quote.canHire) throw new Error(quote.reason!);
  const contract: FitnessContract = { id: `fitness-contract-${state.fitness.contracts.length + 1}`, coachId, clubId, seasonNumber: state.seasonNumber, startedRound: state.round, releasedRound: null, releasedLedgerIndex: null, renew: true, hiredLedgerIndex: financeLedgerCount(state.finance) };
  return recordFitnessFee({ ...state, fitness: { ...state.fitness, contracts: [...state.fitness.contracts, contract] } }, contract);
}

export function hireFitnessCoach(state: SeasonState, coachId: string): SeasonState { return hireForClub(state, coachId, state.managedClubId); }

function managedContract(state: SeasonState, contractId: string): FitnessContract {
  const contract = getClubFitnessCoach(state);
  if (!state.fitness.enabledSince || !contract || contract.id !== contractId) throw new Error('Choose the active fitness coach at your club.');
  return contract;
}

export function releaseFitnessCoach(state: SeasonState, contractId: string): SeasonState {
  const contract = managedContract(state, contractId);
  return { ...state, fitness: { ...state.fitness, contracts: state.fitness.contracts.map(item => item.id === contract.id ? { ...item, releasedRound: state.round, releasedLedgerIndex: financeLedgerCount(state.finance) } : item) } };
}

export function setFitnessRenewal(state: SeasonState, contractId: string, renew: boolean): SeasonState {
  if (typeof renew !== 'boolean') throw new Error('Choose whether the fitness coach contract should renew.');
  const contract = managedContract(state, contractId);
  return { ...state, fitness: { ...state.fitness, contracts: state.fitness.contracts.map(item => item.id === contract.id ? { ...item, renew } : item) } };
}

/** Fill one role after scouting coverage and before optional additional training coaches. */
export function recruitAiFitnessCoaches(state: SeasonState): SeasonState {
  if (!state.fitness.enabledSince || state.status !== 'active' || state.round === seasonRounds(state)) return state;
  let next = state;
  for (const club of state.clubs.filter(club => club.id !== state.managedClubId)) {
    if (getClubFitnessCoach(next, club.id)) continue;
    const coach = withCalculationCache(() => availableFitnessCoaches(next).filter(coach => quoteFitnessHire(next, coach.id, club.id).canHire)).sort((left, right) => (right.skills.recovery + right.skills.workload) / right.fee - (left.skills.recovery + left.skills.workload) / left.fee || left.id.localeCompare(right.id, 'en'))[0];
    if (coach) next = hireForClub(next, coach.id, club.id);
  }
  return next;
}

/** Current-year staff spending is fresh; historical fees and reports remain intact. */
export function renewSeasonFitness(state: SeasonState): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew fitness coaches on the new season opening day.');
  if (!state.fitness.enabledSince) return state;
  let next = state;
  for (const contract of state.fitness.contracts.filter(contract => contract.seasonNumber === state.seasonNumber - 1 && contract.releasedRound === null && contract.renew)) {
    if (quoteFitnessHire(next, contract.coachId, contract.clubId).canHire) next = hireForClub(next, contract.coachId, contract.clubId);
  }
  return next;
}

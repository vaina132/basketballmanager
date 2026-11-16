import { financeLedgerCount } from './finance-ledger';
import { withCalculationCache } from './pure-cache';
import type { FitnessContract, SeasonFitness } from '../domain/fitness';
import type { SeasonState } from '../domain/season';
import { recordFitnessFee } from './finance';
import { availableFitnessCoaches, getClubFitnessCoach, quoteFitnessHire } from './fitness-policy';
import { seasonRounds } from './career-world';
import type { FitnessCoach } from '../domain/fitness';
import { fitnessRating } from './fitness-policy';
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness';
import { clubsByStaffLevel, fittingStaffChoice, ratingRange, staffShareCap, staffTargetRating, usesClubLevelStaff } from './staff-levels';
import { remainingStaffBudget } from './staff-policy';
import { staffFee } from './economy';

export function createFitness(): SeasonFitness { return { model: 'fitness-1', enabledSince: null, contracts: [] }; }

/** `opening` (format 74 new careers): the manager's club is staffed too, like every computer club. */
export function enableFitness(state: SeasonState, opening = false): SeasonState {
  if (state.fitness.enabledSince) return state;
  if (!state.finance.enabledSince || !state.training.enabledSince) throw new Error('Enable club finances and training before recruiting fitness coaches.');
  if (state.status !== 'active' || state.round === seasonRounds(state)) throw new Error('Enable fitness coaches when weekly training is available, before the final matchday.');
  return recruitAiFitnessCoaches({ ...state, fitness: { ...state.fitness, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: financeLedgerCount(state.finance) } } }, opening);
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
export function recruitAiFitnessCoaches(state: SeasonState, includeManaged = false): SeasonState {
  if (!state.fitness.enabledSince || state.status !== 'active' || state.round === seasonRounds(state)) return state;
  let next = state;
  const levelled = usesClubLevelStaff(state), clubs = state.clubs.filter(club => includeManaged || club.id !== state.managedClubId);
  for (const club of levelled ? clubsByStaffLevel(state, clubs) : clubs) {
    if (getClubFitnessCoach(next, club.id)) continue;
    const coach = levelled ? fittingFitnessCoach(next, club.id) : withCalculationCache(() => availableFitnessCoaches(next).filter(coach => quoteFitnessHire(next, coach.id, club.id).canHire)).sort((left, right) => (right.skills.recovery + right.skills.workload) / right.fee - (left.skills.recovery + left.skills.workload) / left.fee || left.id.localeCompare(right.id, 'en'))[0];
    if (coach) next = hireForClub(next, coach.id, club.id);
  }
  return next;
}

let range: readonly [number, number] | undefined;
/** Format 74: the fitness coach fitting a club's staff level and its share of the staff budget (`src/world/staff-levels.ts`). */
function fittingFitnessCoach(state: SeasonState, clubId: string): FitnessCoach | undefined {
  const choice = withCalculationCache(() => fittingStaffChoice(availableFitnessCoaches(state), {
    rating: fitnessRating, fee: member => staffFee(state, clubId, member.fee), target: staffTargetRating(state, clubId, 'fitness', range ??= ratingRange(DEVELOPMENT_FITNESS_COACHES, fitnessRating)), cap: staffShareCap(state, clubId, 'fitness'), budget: remainingStaffBudget(state, clubId),
  }));
  return choice && quoteFitnessHire(state, choice.id, clubId).canHire ? choice : undefined;
}

/** One step: the fitness coach leaves (the paid fee is not refunded) and the new fitness coach is hired. */
export function replaceFitnessCoach(state: SeasonState, contractId: string, coachId: string): SeasonState {
  return hireFitnessCoach(releaseFitnessCoach(state, contractId), coachId);
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

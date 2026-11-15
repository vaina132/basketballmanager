import type { FitnessCoach, FitnessContract, FitnessEffects, FitnessHireQuote, FitnessWeekAssignment, SeasonFitness } from '../domain/fitness';
import type { SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness';
import { getFinanceBalance } from './finance';
import { remainingStaffBudget, staffAllocation, staffCommitted } from './staff-policy';
import { getTransferPaymentSummary } from './transfer-payments';
import { seasonRounds, worldOf } from './career-world';
import { FITNESS_DIRECTORY, staffMarket } from '../data/staff-directory';
import type { WorldContext } from '../domain/world';
import { staffFee } from './economy';

export const MAX_FITNESS_COACHES = 1;
export function fitnessRating(coach: FitnessCoach): number { return Math.round((coach.skills.recovery + coach.skills.workload) / 2); }
export function fitnessEffects(coach: FitnessCoach): FitnessEffects { return { recoveryPerDay: coach.skills.recovery / 10, practiceCostReductionPercent: coach.skills.workload * 2.5 }; }

export function getClubFitnessCoach(state: Pick<SeasonState, 'fitness' | 'seasonNumber' | 'managedClubId'>, clubId = state.managedClubId): FitnessContract | null {
  return state.fitness.contracts.find(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null) ?? null;
}

/** The league's market (sized to its clubs) without this season's employed staff. */
export function availableFitnessCoaches(state: Pick<SeasonState, 'fitness' | 'seasonNumber'> & WorldContext): FitnessCoach[] {
  const employed = new Set(state.fitness.contracts.filter(contract => contract.seasonNumber === state.seasonNumber && contract.releasedRound === null).map(contract => contract.coachId));
  return staffMarket(FITNESS_DIRECTORY, worldOf(state)).filter(coach => !employed.has(coach.id));
}

export function getClubFitnessEffects(state: Pick<SeasonState, 'fitness' | 'training' | 'seasonNumber' | 'managedClubId'>, clubId = state.managedClubId): FitnessWeekAssignment | null {
  if (!state.fitness.enabledSince || !state.training.enabledSince) return null;
  const contract = getClubFitnessCoach(state, clubId);
  if (!contract) return null;
  return { contractId: contract.id, coachId: contract.coachId, ...fitnessEffects(FITNESS_DIRECTORY.find(coach => coach.id === contract.coachId)!) };
}

export function quoteFitnessHire(state: SeasonState, coachId: string, clubId = state.managedClubId): FitnessHireQuote {
  const coach = FITNESS_DIRECTORY.find(coach => coach.id === coachId);
  const remainingAllocation = Math.max(0, staffAllocation(state, clubId) - staffCommitted(state, clubId));
  const remainingBudget = remainingStaffBudget(state, clubId);
  let reason: string | null = null;
  if (!state.fitness.enabledSince) reason = 'Enable fitness coach recruitment before hiring.';
  else if (!state.training.enabledSince || !state.finance.enabledSince) reason = 'Fitness coaches require training and club finances.';
  else if (state.status !== 'active' || state.round === seasonRounds(state)) reason = 'No weekly training remains this season. Recruit a fitness coach when the next season starts.';
  else if (!state.clubs.some(club => club.id === clubId) || !coach) reason = 'Choose a fitness coach and club from this career.';
  else if (getClubFitnessCoach(state, clubId)) reason = 'The fitness coach position is already occupied.';
  else if (!availableFitnessCoaches(state).some(available => available.id === coachId)) reason = 'This fitness coach already has an active club contract.';
  else if (getFinanceBalance(state.finance, clubId).unpaid) reason = 'Settle unpaid club costs before hiring a fitness coach.';
  else if (getTransferPaymentSummary(state, clubId).overdue) reason = 'Settle overdue transfer payments before hiring a fitness coach.';
  else if (staffFee(state, clubId, coach.fee) > remainingAllocation) reason = 'This appointment exceeds the shared staff allocation. Released staff fees remain committed for this season.';
  else if (staffFee(state, clubId, coach.fee) > remainingBudget) reason = 'Not enough remaining budget after protected wages and transfer commitments.';
  return { coachId, clubId, fee: staffFee(state, clubId, coach?.fee ?? 0), remainingAllocation, remainingBudget, canHire: reason === null, reason };
}

/** Keep historical weeks independent of later releases, appointments or renewals. */
export function fitnessAssignments(fitness: SeasonFitness, clubs: readonly Team[], seasonNumber: number, afterRound: number): Record<string, FitnessWeekAssignment | null> | null {
  const anchor = fitness.enabledSince;
  if (!anchor || seasonNumber < anchor.seasonNumber || seasonNumber === anchor.seasonNumber && afterRound < anchor.round) return null;
  return Object.fromEntries(clubs.map(club => {
    const contract = fitness.contracts.find(contract => contract.clubId === club.id && contract.seasonNumber === seasonNumber && contract.startedRound <= afterRound && (contract.releasedRound === null || contract.releasedRound > afterRound));
    return [club.id, contract ? { contractId: contract.id, coachId: contract.coachId, ...fitnessEffects(FITNESS_DIRECTORY.find(coach => coach.id === contract.coachId)!) } : null];
  }));
}

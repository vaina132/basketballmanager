import type { YouthCoach, YouthCoachContract, YouthCoachHireQuote, SeasonYouth } from '../domain/youth';
import type { SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import type { AcademyWeek } from '../domain/academy';
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth';
import { getFinanceBalance } from './finance';
import { remainingStaffBudget, staffAllocation, staffCommitted } from './staff-policy';
import { getTransferPaymentSummary } from './transfer-payments';

export const MAX_YOUTH_COACHES = 1;
export function youthCoachRating(coach: YouthCoach): number { return coach.development; }
export function youthCoachEffects(coach: YouthCoach): { bonusPercent: number } { return { bonusPercent: coach.development * 5 }; }
export function getClubYouthCoach(state: Pick<SeasonState, 'youth' | 'seasonNumber' | 'managedClubId'>, clubId = state.managedClubId): YouthCoachContract | null {
  return state.youth.contracts.find(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null) ?? null;
}
export function availableYouthCoaches(state: Pick<SeasonState, 'youth' | 'seasonNumber'>): YouthCoach[] {
  const employed = new Set(state.youth.contracts.filter(contract => contract.seasonNumber === state.seasonNumber && contract.releasedRound === null).map(contract => contract.coachId));
  return DEVELOPMENT_YOUTH_COACHES.filter(coach => !employed.has(coach.id));
}
export function quoteYouthCoachHire(state: SeasonState, coachId: string, clubId = state.managedClubId): YouthCoachHireQuote {
  const coach = DEVELOPMENT_YOUTH_COACHES.find(coach => coach.id === coachId);
  const remainingAllocation = Math.max(0, staffAllocation(state, clubId) - staffCommitted(state, clubId)), remainingBudget = remainingStaffBudget(state, clubId);
  let reason: string | null = null;
  if (!state.youth.enabledSince) reason = 'Enable youth-coach recruitment before hiring.';
  else if (!state.academy.enabledSince || !state.finance.enabledSince) reason = 'Youth coaches require an academy and club finances.';
  else if (state.status !== 'active' || state.round === 10) reason = 'Academy training resumes next season. Hire a youth coach while a training week remains.';
  else if (!coach || !state.clubs.some(club => club.id === clubId)) reason = 'Choose a youth coach and club from this career.';
  else if (getClubYouthCoach(state, clubId)) reason = 'The youth-coach position is already occupied.';
  else if (!availableYouthCoaches(state).some(coach => coach.id === coachId)) reason = 'This youth coach already has an active club contract.';
  else if (getFinanceBalance(state.finance, clubId).unpaid) reason = 'Settle unpaid club costs before hiring a youth coach.';
  else if (getTransferPaymentSummary(state, clubId).overdue) reason = 'Settle overdue transfer payments before hiring a youth coach.';
  else if (coach.fee > remainingAllocation) reason = 'This appointment exceeds the shared staff allocation. Released staff fees remain committed for this season.';
  else if (coach.fee > remainingBudget) reason = 'Not enough remaining budget after protected wages and transfer commitments.';
  return { coachId, clubId, fee: coach?.fee ?? 0, remainingAllocation, remainingBudget, canHire: reason === null, reason };
}
export function youthCoachAssignments(youth: SeasonYouth, clubs: readonly Pick<Team, 'id'>[], seasonNumber: number, afterRound: number): AcademyWeek['coaches'] {
  const enabled = youth.enabledSince && youth.enabledSince.seasonNumber * 10 + youth.enabledSince.round <= seasonNumber * 10 + afterRound;
  return Object.fromEntries(clubs.map(club => {
    const contract = enabled && youth.contracts.find(contract => contract.clubId === club.id && contract.seasonNumber === seasonNumber && contract.startedRound <= afterRound && (contract.releasedRound === null || contract.releasedRound > afterRound));
    const coach = contract && DEVELOPMENT_YOUTH_COACHES.find(coach => coach.id === contract.coachId);
    return [club.id, contract && coach ? { contractId: contract.id, coachId: coach.id, ...youthCoachEffects(coach) } : null];
  }));
}

import { staffLimit } from './wage-pool';
import type { YouthCoach, YouthCoachContract, YouthCoachHireQuote, SeasonYouth } from '../domain/youth';
import type { SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import type { AcademyWeek } from '../domain/academy';
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth';
import { getFinanceBalance } from './finance';
import { remainingStaffBudget, staffAllocation, staffCanJoin, staffCommitted, staffMoneyReason } from './staff-policy';
import { staffMarketWorld } from './staff-levels';
import { getTransferPaymentSummary } from './transfer-payments';
import { roundKey, seasonRounds, worldOf } from './career-world';
import { staffMarket, YOUTH_COACH_DIRECTORY, staffMember } from '../data/staff-directory';
import type { WorldContext } from '../domain/world';
import { staffFee } from './economy';

export const MAX_YOUTH_COACHES = 1;
export function youthCoachRating(coach: YouthCoach): number { return coach.development; }
export function youthCoachEffects(coach: YouthCoach): { bonusPercent: number } { return { bonusPercent: coach.development * 5 }; }
export function getClubYouthCoach(state: Pick<SeasonState, 'youth' | 'seasonNumber' | 'managedClubId'>, clubId = state.managedClubId): YouthCoachContract | null {
  return state.youth.contracts.find(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null) ?? null;
}
/** The league's market (sized to its clubs) without this season's employed staff. */
export function availableYouthCoaches(state: Pick<SeasonState, 'youth' | 'seasonNumber'> & Partial<Pick<SeasonState, 'clubs'>> & WorldContext): YouthCoach[] {
  const employed = new Set(state.youth.contracts.filter(contract => contract.seasonNumber === state.seasonNumber && contract.releasedRound === null).map(contract => contract.coachId));
  return staffMarket(YOUTH_COACH_DIRECTORY, staffMarketWorld(state)).filter(coach => !employed.has(coach.id));
}
/** `kept`: a season-opening renewal, which only needs the coach free in careers with staff contracts (`staffCanJoin`). */
export function quoteYouthCoachHire(state: SeasonState, coachId: string, clubId = state.managedClubId, kept = false): YouthCoachHireQuote {
  const coach = staffMember(YOUTH_COACH_DIRECTORY, coachId);
  const remainingAllocation = Math.max(0, staffLimit(state, clubId) - staffCommitted(state, clubId)), remainingBudget = remainingStaffBudget(state, clubId);
  let reason: string | null = null;
  if (!state.youth.enabledSince) reason = 'Enable youth-coach recruitment before hiring.';
  else if (!state.academy.enabledSince || !state.finance.enabledSince) reason = 'Youth coaches require an academy and club finances.';
  else if (state.status !== 'active' || state.round === seasonRounds(state)) reason = 'Academy training resumes next season. Hire a youth coach while a training week remains.';
  else if (!coach || !state.clubs.some(club => club.id === clubId)) reason = 'Choose a youth coach and club from this career.';
  else if (getClubYouthCoach(state, clubId)) reason = 'The youth-coach position is already occupied.';
  else if (!staffCanJoin(state, kept, state.youth.contracts.some(contract => contract.coachId === coachId && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null), () => availableYouthCoaches(state).some(coach => coach.id === coachId))) reason = 'This youth coach already has an active club contract.';
  else if (getFinanceBalance(state.finance, clubId).unpaid) reason = 'Settle unpaid club costs before hiring a youth coach.';
  else if (getTransferPaymentSummary(state, clubId).overdue) reason = 'Settle overdue transfer payments before hiring a youth coach.';
  else reason = staffMoneyReason(state, 'youth coach', staffFee(state, clubId, coach.fee), remainingAllocation, remainingBudget, clubId);
  return { coachId, clubId, fee: staffFee(state, clubId, coach?.fee ?? 0), remainingAllocation, remainingBudget, canHire: reason === null, reason };
}
export function youthCoachAssignments(youth: SeasonYouth, clubs: readonly Pick<Team, 'id'>[], seasonNumber: number, afterRound: number): AcademyWeek['coaches'] {
  const enabled = youth.enabledSince && roundKey(youth.enabledSince.seasonNumber, youth.enabledSince.round) <= roundKey(seasonNumber, afterRound);
  return Object.fromEntries(clubs.map(club => {
    const contract = enabled && youth.contracts.find(contract => contract.clubId === club.id && contract.seasonNumber === seasonNumber && contract.startedRound <= afterRound && (contract.releasedRound === null || contract.releasedRound > afterRound));
    const coach = contract && staffMember(YOUTH_COACH_DIRECTORY, contract.coachId);
    return [club.id, contract && coach ? { contractId: contract.id, coachId: coach.id, ...youthCoachEffects(coach) } : null];
  }));
}

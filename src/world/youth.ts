import { financeLedgerCount } from './finance-ledger';
import { payStaffCompensation } from './staff-contracts';
import { withCalculationCache } from './pure-cache';
import type { SeasonYouth, YouthCoachContract } from '../domain/youth';
import type { SeasonState } from '../domain/season';
import { recordYouthFee } from './finance';
import { availableYouthCoaches, getClubYouthCoach, quoteYouthCoachHire, youthCoachEffects } from './youth-policy';
import { seasonRounds } from './career-world';
import type { YouthCoach } from '../domain/youth';
import { youthCoachRating } from './youth-policy';
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth';
import { clubsByStaffLevel, fittingLocalStaffChoice, ratingRange, staffShareCap, staffTargetRating, usesClubLevelStaff } from './staff-levels';
import { keepingHeldStaff, staffHireBudget } from './staff-policy';
import { staffFee } from './economy';

export function createYouth(): SeasonYouth { return { model: 'youth-1', enabledSince: null, contracts: [] }; }
/** `opening` (format 74 new careers): the manager's club is staffed too, like every computer club. */
export function enableYouth(state: SeasonState, opening = false): SeasonState {
  if (state.youth.enabledSince) return state;
  if (!state.academy.enabledSince || !state.finance.enabledSince) throw new Error('Enable the academy and club finances before recruiting a youth coach.');
  if (state.status !== 'active' || state.round === seasonRounds(state)) throw new Error('Recruit youth coaches while academy training weeks remain, before the final matchday.');
  // The career's opening staff are held, not hired: Spending left does not decide them (format 76).
  return keepingHeldStaff(() => recruitAiYouthCoaches({ ...state, youth: { ...state.youth, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: financeLedgerCount(state.finance) } } }, opening), opening);
}
function hireForClub(state: SeasonState, coachId: string, clubId: string, kept = false): SeasonState {
  const quote = quoteYouthCoachHire(state, coachId, clubId, kept);
  if (!quote.canHire) throw new Error(quote.reason!);
  const contract: YouthCoachContract = { id: `youth-contract-${state.youth.contracts.length + 1}`, coachId, clubId, seasonNumber: state.seasonNumber, startedRound: state.round, releasedRound: null, releasedLedgerIndex: null, renew: true, hiredLedgerIndex: financeLedgerCount(state.finance) };
  return recordYouthFee({ ...state, youth: { ...state.youth, contracts: [...state.youth.contracts, contract] } }, contract);
}
export function hireYouthCoach(state: SeasonState, coachId: string): SeasonState { return hireForClub(state, coachId, state.managedClubId); }
function managedContract(state: SeasonState, contractId: string): YouthCoachContract {
  const contract = getClubYouthCoach(state);
  if (!state.youth.enabledSince || !contract || contract.id !== contractId) throw new Error('Choose the active youth coach at your club.');
  return contract;
}
export function releaseYouthCoach(state: SeasonState, contractId: string): SeasonState {
  const contract = managedContract(state, contractId);
  return payStaffCompensation({ ...state, youth: { ...state.youth, contracts: state.youth.contracts.map(item => item.id === contract.id ? { ...item, releasedRound: state.round, releasedLedgerIndex: financeLedgerCount(state.finance) } : item) } }, 'youth', contractId);
}
export function setYouthCoachRenewal(state: SeasonState, contractId: string, renew: boolean): SeasonState {
  if (typeof renew !== 'boolean') throw new Error('Choose whether the youth-coach contract should renew.');
  const contract = managedContract(state, contractId);
  return { ...state, youth: { ...state.youth, contracts: state.youth.contracts.map(item => item.id === contract.id ? { ...item, renew } : item) } };
}
export function recruitAiYouthCoaches(state: SeasonState, includeManaged = false): SeasonState {
  if (!state.youth.enabledSince || state.status !== 'active' || state.round === seasonRounds(state)) return state;
  let next = state;
  const levelled = usesClubLevelStaff(state), clubs = state.clubs.filter(club => includeManaged || club.id !== state.managedClubId);
  for (const club of levelled ? clubsByStaffLevel(state, clubs) : clubs) {
    if (getClubYouthCoach(next, club.id)) continue;
    const coach = levelled ? fittingYouthCoach(next, club.id) : withCalculationCache(() => availableYouthCoaches(next).filter(coach => quoteYouthCoachHire(next, coach.id, club.id).canHire)).sort((left, right) => youthCoachEffects(right).bonusPercent / right.fee - youthCoachEffects(left).bonusPercent / left.fee || left.fee - right.fee || left.id.localeCompare(right.id, 'en'))[0];
    if (coach) next = hireForClub(next, coach.id, club.id);
  }
  return next;
}
let range: readonly [number, number] | undefined;
/** Format 74: the youth coach fitting a club's staff level and its share of the staff budget (`src/world/staff-levels.ts`). */
function fittingYouthCoach(state: SeasonState, clubId: string): YouthCoach | undefined {
  const choice = withCalculationCache(() => fittingLocalStaffChoice(state, clubId, 'youth', availableYouthCoaches(state), {
    rating: youthCoachRating, fee: member => staffFee(state, clubId, member.fee), target: staffTargetRating(state, clubId, 'youth', range ??= ratingRange(DEVELOPMENT_YOUTH_COACHES, youthCoachRating)), cap: staffShareCap(state, clubId, 'youth'), budget: staffHireBudget(state, clubId),
  }));
  return choice && quoteYouthCoachHire(state, choice.id, clubId).canHire ? choice : undefined;
}

/** One step: the youth coach leaves (the paid fee is not refunded) and the new youth coach is hired. */
export function replaceYouthCoach(state: SeasonState, contractId: string, coachId: string): SeasonState {
  return hireYouthCoach(releaseYouthCoach(state, contractId), coachId);
}

/** Renewals keep staff the club holds, so Spending left does not decide them (format 76; new hires need it). */
export function renewSeasonYouth(state: SeasonState): SeasonState { return keepingHeldStaff(() => renewYouth(state)); }
function renewYouth(state: SeasonState): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew youth coaches on the new season opening day.');
  if (!state.youth.enabledSince) return state;
  let next = state;
  for (const contract of state.youth.contracts.filter(contract => contract.seasonNumber === state.seasonNumber - 1 && contract.releasedRound === null && contract.renew)) if (quoteYouthCoachHire(next, contract.coachId, contract.clubId, true).canHire) next = hireForClub(next, contract.coachId, contract.clubId, true);
  return next;
}

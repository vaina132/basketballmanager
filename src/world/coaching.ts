import { staffLimit } from './wage-pool';
import type { Coach, CoachingContract, CoachingWeekAssignment, SeasonCoaching } from '../domain/coaching';
import { withCalculationCache } from './pure-cache';
import type { SeasonState } from '../domain/season';
import type { TrainingFocus } from '../domain/training';
import type { PlayerAttributes, SkillAttributes, Team } from '../domain/types';
import { DEVELOPMENT_COACHES } from '../data/development-coaches';
import { getFinanceBalance, recordCoachFee } from './finance';
import { getSpendableCash } from './payroll-policy';
import { getTransferPaymentSummary } from './transfer-payments';
import { keepingHeldStaff, staffCommitted, staffHireSpending, staffMoneyReason, staffSpendingReason, staffSpendingSalaryCap } from './staff-policy';
import { formatEuros } from '../ui/money-format';
import { payStaffCompensation, usesStaffContracts } from './staff-contracts';
import { STAFF_BUDGET } from './staff-constants';
import { staffAllocation } from './board-consequences';
import { MAX_SEASON_ROUNDS, seasonRounds } from './career-world';
import { COACH_DIRECTORY, staffMarket, staffMember } from '../data/staff-directory';
import type { CareerWorld } from '../domain/world';
import { staffFee } from './economy';
import type { WorldContext } from '../domain/world';
import { clubsByStaffLevel, fittingLocalStaffChoice, ratingRange, staffMarketWorld, staffShareCap, staffTargetRating, usesClubLevelStaff } from './staff-levels';

export const COACHING_BUDGET = STAFF_BUDGET;
export const MAX_COACHES = 3;
const ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
const FOCUSES: readonly TrainingFocus[] = ['balanced', ...ATTRIBUTES];
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const coachById = (id: string): Coach => {
  const coach = staffMember(COACH_DIRECTORY, id);
  if (!coach) throw new Error('Choose a coach from the development staff pool.');
  return coach;
};
function validateFocus(focus: TrainingFocus): void { if (!FOCUSES.includes(focus)) throw new Error('Choose a supported coaching assignment.'); }
function validateBoundary(seasonNumber: number, round: number): void {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 7974 || !Number.isInteger(round) || round < 1 || round > MAX_SEASON_ROUNDS) throw new Error('Choose a valid season and matchday for the coaching contract.');
}

export function coachRating(coach: Coach): number { return Math.round(ATTRIBUTES.reduce((sum, attribute) => sum + coach.skills[attribute], 0) / ATTRIBUTES.length); }
export function getClubCoaching(coaching: SeasonCoaching, clubId: string): CoachingContract[] { return coaching.contracts.filter(contract => contract.clubId === clubId && contract.releasedRound === null); }
/**
 * Catalog fees against the fixed catalog coaching limit (`COACHING_BUDGET`): every contract this season, or (format 74)
 * the coaches employed now. Only `coaching-1` careers keep that limit; club-level careers (`coaching-2`, `coaching-3`)
 * are limited by the club's own money instead (Wages left or the scaled staff budget, and Spending left).
 */
export function coachingCommitted(coaching: SeasonCoaching, clubId: string): number {
  const current = usesClubLevelStaff({ coaching });
  return coaching.contracts.filter(contract => contract.clubId === clubId && (!current || contract.releasedRound === null)).reduce((sum, contract) => sum + coachById(contract.coachId).fee, 0);
}
let coachRange: readonly [number, number] | undefined;
/** The coaches' rating range a club's staff level is placed on (format 74). */
export const coachRatingRange = (): readonly [number, number] => coachRange ??= ratingRange(DEVELOPMENT_COACHES, coachRating);
/** The league's coaching market (sized to its clubs) without the coaches under contract. */
export function availableCoaches(coaching: SeasonCoaching, world: Pick<CareerWorld, 'clubs'> & WorldContext): Coach[] {
  const active = new Set(coaching.contracts.filter(contract => contract.releasedRound === null).map(contract => contract.coachId));
  return staffMarket(COACH_DIRECTORY, staffMarketWorld({ ...world, coaching })).filter(coach => !active.has(coach.id));
}

/** The same commitment, vacancy and availability checks serve human and AI clubs. */
function hireForClub(coaching: SeasonCoaching, clubs: readonly Team[], clubId: string, seasonNumber: number, round: number, coachId: string, focus: TrainingFocus, context: WorldContext = {}): SeasonCoaching {
  if (!coaching.enabledSince) throw new Error('Enable coaching staff before recruiting.');
  validateBoundary(seasonNumber, round); validateFocus(focus);
  if (!clubs.some(club => club.id === clubId)) throw new Error('The coaching contract needs a club in this league.');
  const coach = coachById(coachId);
  if (getClubCoaching(coaching, clubId).length >= MAX_COACHES) throw new Error('All three coaching positions are occupied.');
  if (!availableCoaches(coaching, { ...context, clubs }).some(available => available.id === coachId)) throw new Error('This coach is not available: he already works for a club.');
  if (!usesClubLevelStaff({ coaching }) && coachingCommitted(coaching, clubId) + coach.fee > COACHING_BUDGET) throw new Error('This contract exceeds the remaining coaching budget. Released contracts remain committed for the season.');
  return { ...coaching, contracts: [...coaching.contracts, { id: `coach-s${seasonNumber}-c${coaching.contracts.length + 1}`, coachId, clubId, seasonNumber, startedRound: round, releasedRound: null, focus, renew: true }] };
}

/**
 * Opening coaches. Format 74 (`levels`, model 'coaching-2'): each club's coach fits its staff level and its share of the
 * staff budget, the richest club choosing first (`src/world/staff-levels.ts`); earlier careers take the directory in order.
 */
export function createCoaching(clubs: readonly Team[], seasonNumber = 1, round = 1, enabled = true, levels?: WorldContext & { seed: number; model?: 'coaching-4' }): SeasonCoaching {
  validateBoundary(seasonNumber, round);
  let coaching: SeasonCoaching = { model: levels ? levels.model ?? 'coaching-2' : 'coaching-1', enabledSince: enabled ? { seasonNumber, round } : null, contracts: [] };
  if (!enabled) return coaching;
  if (!levels) {
    for (const [index, club] of clubs.entries()) coaching = hireForClub(coaching, clubs, club.id, seasonNumber, round, COACH_DIRECTORY[index]!.id, 'balanced');
    return coaching;
  }
  const context = { ...levels, clubs, seasonNumber };
  for (const club of clubsByStaffLevel(context, clubs)) {
    const fee = (coach: Coach) => staffFee(context, club.id, coach.fee);
    const choice = fittingLocalStaffChoice({ ...context, coaching }, club.id, 'coaches', availableCoaches(coaching, context), {
      rating: coachRating, fee, target: staffTargetRating(context, club.id, 'coaches', coachRatingRange()), cap: staffShareCap(context, club.id, 'coaches'), budget: staffAllocation(context, club.id),
    });
    if (choice) coaching = hireForClub(coaching, clubs, club.id, seasonNumber, round, choice.id, 'balanced', levels);
  }
  return coaching;
}

export function enableCoaching(state: SeasonState): SeasonState {
  if (state.coaching.enabledSince) return state;
  if (state.status === 'complete') throw new Error('Start the next season before enabling coaching staff.');
  let next: SeasonState = { ...state, coaching: { model: 'coaching-1', enabledSince: { seasonNumber: state.seasonNumber, round: state.round }, contracts: [] } };
  for (const [index, club] of state.clubs.entries()) {
    const coach = COACH_DIRECTORY[index]!;
    if (canPayCoach(next, club.id, coach)) next = hireContractForClub(next, club.id, coach.id, 'balanced');
  }
  return next;
}

function canPayCoach(state: SeasonState, clubId: string, coach: Coach): boolean {
  const fee = staffFee(state, clubId, coach.fee);
  // `coaching-1` careers keep the fixed catalog coaching limit; club-level careers are limited by the club's money only.
  if (!usesClubLevelStaff(state) && coachingCommitted(state.coaching, clubId) + coach.fee > COACHING_BUDGET) return false;
  if (staffCommitted(state, clubId) + fee > staffLimit(state, clubId)) return false;
  if (!state.finance.enabledSince) return true;
  const balance = getFinanceBalance(state.finance, clubId);
  // Format 76: Spending left must carry the salary still to pay this season (the shared hire check).
  return balance.unpaid === 0 && getTransferPaymentSummary(state, clubId).overdue === 0 && (usesStaffContracts(state) ? staffSpendingReason(state, clubId, staffHireSpending(state, clubId, fee)) === null : getSpendableCash(state, clubId) >= fee);
}

/** Contracts and their cash payment are one immutable operation for every club. */
function hireContractForClub(state: SeasonState, clubId: string, coachId: string, focus: TrainingFocus): SeasonState {
  if (usesClubLevelStaff(state)) {
    const reason = coachHireReason(state, coachId, clubId);
    if (reason) throw new Error(reason);
  } else if (staffCommitted(state, clubId) > coachingCommitted(state.coaching, clubId) && staffCommitted(state, clubId) + staffFee(state, clubId, coachById(coachId).fee) > staffLimit(state, clubId)) throw new Error('This contract exceeds the shared staff budget. Released staff fees remain committed for the season.');
  const coaching = hireForClub(state.coaching, state.clubs, clubId, state.seasonNumber, state.round, coachId, focus, state);
  return recordCoachFee({ ...state, coaching }, coaching.contracts.at(-1)!);
}

/**
 * Why a club cannot hire this coach now, in plain words, or null. Human and computer clubs share it. Club-level careers
 * are refused only by the real rules: a free coaching place, the coach being available, Wages left (or the scaled staff
 * budget) for the season fee and Spending left to pay it now; `coaching-1` careers also keep the catalog coaching limit.
 */
export function coachHireReason(state: SeasonState, coachId: string, clubId = state.managedClubId): string | null {
  const coach = staffMember(COACH_DIRECTORY, coachId);
  if (state.status === 'complete') return 'Start the next season before recruiting a coach.';
  if (!state.coaching.enabledSince) return 'Enable coaching staff before recruiting.';
  if (!coach || !state.clubs.some(club => club.id === clubId)) return 'Choose a coach and club from this career.';
  if (getClubCoaching(state.coaching, clubId).length >= MAX_COACHES) return 'All three coaching places are filled. Release a coach first.';
  if (!availableCoaches(state.coaching, state).some(available => available.id === coachId)) return 'This coach is not available: he already works for a club.';
  if (!usesClubLevelStaff(state) && coachingCommitted(state.coaching, clubId) + coach.fee > COACHING_BUDGET) return 'This contract exceeds the remaining coaching budget. Released contracts remain committed for the season.';
  const fee = staffFee(state, clubId, coach.fee);
  if (state.finance.enabledSince) {
    const unpaid = getFinanceBalance(state.finance, clubId).unpaid, overdue = getTransferPaymentSummary(state, clubId).overdue;
    if (unpaid) return `Settle ${formatEuros(unpaid)} of unpaid club costs before hiring a coach.`;
    if (overdue) return `${formatEuros(overdue)} of transfer payments is overdue. Settle it before hiring a coach.`;
  }
  const remainingAllocation = Math.max(0, staffLimit(state, clubId) - staffCommitted(state, clubId));
  return staffMoneyReason(state, 'coach', fee, remainingAllocation, state.finance.enabledSince ? Math.min(remainingAllocation, getSpendableCash(state, clubId)) : remainingAllocation, clubId);
}

export function hireCoach(state: SeasonState, coachId: string, focus: TrainingFocus = 'balanced'): SeasonState {
  if (state.status === 'complete') throw new Error('Start the next season before recruiting a coach.');
  return hireContractForClub(state, state.managedClubId, coachId, focus);
}

function managedContract(state: SeasonState, contractId: string): CoachingContract {
  if (!state.coaching.enabledSince) throw new Error('Enable coaching staff before changing a contract.');
  const contract = state.coaching.contracts.find(contract => contract.id === contractId && contract.clubId === state.managedClubId && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null);
  if (!contract) throw new Error('Choose an active coach at your club.');
  return contract;
}

function updateContract(state: SeasonState, contract: CoachingContract): SeasonState {
  return { ...state, coaching: { ...state.coaching, contracts: state.coaching.contracts.map(existing => existing.id === contract.id ? contract : existing) } };
}

export function releaseCoach(state: SeasonState, contractId: string): SeasonState {
  return payStaffCompensation(updateContract(state, { ...managedContract(state, contractId), releasedRound: state.round }), 'coaches', contractId);
}
/** One step: the coach leaves (the paid fee is not refunded) and the new coach takes the same training assignment. */
export function replaceCoach(state: SeasonState, contractId: string, coachId: string): SeasonState {
  const { focus } = managedContract(state, contractId);
  return hireCoach(releaseCoach(state, contractId), coachId, focus);
}
export function setCoachAssignment(state: SeasonState, contractId: string, focus: TrainingFocus): SeasonState {
  validateFocus(focus);
  return updateContract(state, { ...managedContract(state, contractId), focus });
}
export function setCoachRenewal(state: SeasonState, contractId: string, renew: boolean): SeasonState {
  if (typeof renew !== 'boolean') throw new Error('Choose whether the coaching contract should renew.');
  return updateContract(state, { ...managedContract(state, contractId), renew });
}

/** Assignment snapshots keep the focus actually used even when future contracts are edited. */
export function coachingAssignments(coaching: SeasonCoaching, clubs: readonly Team[], seasonNumber: number, afterRound: number): Record<string, CoachingWeekAssignment[]> | null {
  const anchor = coaching.enabledSince;
  if (!anchor || seasonNumber < anchor.seasonNumber || seasonNumber === anchor.seasonNumber && afterRound < anchor.round) return null;
  return Object.fromEntries(clubs.map(club => [club.id, coaching.contracts.filter(contract => contract.clubId === club.id && contract.seasonNumber === seasonNumber && contract.startedRound <= afterRound && (contract.releasedRound === null || contract.releasedRound > afterRound)).map(contract => ({ contractId: contract.id, coachId: contract.coachId, focus: contract.focus }))]));
}

export function coachingRatingForAttribute(assignments: readonly CoachingWeekAssignment[], attribute: keyof SkillAttributes): number {
  return assignments.reduce((rating, assignment) => {
    const skill = coachById(assignment.coachId).skills[attribute];
    return Math.max(rating, assignment.focus === attribute ? skill : assignment.focus === 'balanced' ? skill / 2 : 0);
  }, 0);
}

/** Recruit for marginal coverage of the club's training focuses, normalized by full-season fee. */
export function recruitAiCoaches(state: SeasonState): SeasonState {
  if (!state.coaching.enabledSince || state.status === 'complete' || state.round === seasonRounds(state)) return state;
  let next = state;
  const levelled = usesClubLevelStaff(state);
  const clubs = state.clubs.filter(club => club.id !== state.managedClubId);
  for (const club of levelled ? clubsByStaffLevel(state, clubs) : clubs) {
    // Format 74: a club without a coach first appoints one that fits its level, as at the career's start.
    if (levelled && !getClubCoaching(next.coaching, club.id).length) next = appointFittingCoach(next, club.id);
    const plan = state.training.plans[club.id]!;
    const demand = Object.fromEntries(ATTRIBUTES.map(attribute => [attribute, 0])) as Record<keyof SkillAttributes, number>;
    for (const player of club.players) {
      const individual = plan.individual[player.id]!;
      const focus = individual === 'team' ? plan.delegated ? 'balanced' : plan.focus : individual;
      if (focus === 'balanced') for (const attribute of ATTRIBUTES) demand[attribute] += 1 / ATTRIBUTES.length;
      else demand[focus] += 1;
    }
    while (getClubCoaching(next.coaching, club.id).length < MAX_COACHES) {
      const assignments = coachingAssignments(next.coaching, state.clubs, state.seasonNumber, state.round)![club.id]!;
      // Club-level careers: like every computer appointment, an extra coach costs at most the role's share of the staff
      // budget (`STAFF_LEVEL_RULES`), so computer clubs do not empty the market's top coaches.
      const remaining = Math.min(staffLimit(next, club.id) - staffCommitted(next, club.id), levelled ? staffShareCap(next, club.id, 'coaches') : Infinity);
      const candidates = withCalculationCache(() => availableCoaches(next.coaching, next).filter(coach => staffFee(next, club.id, coach.fee) <= remaining && canPayCoach(next, club.id, coach))).flatMap(coach => FOCUSES.map(focus => ({ coach, focus, utility: ATTRIBUTES.reduce((sum, attribute) => {
        const current = coachingRatingForAttribute(assignments, attribute);
        const next = coachingRatingForAttribute([{ contractId: '', coachId: coach.id, focus }], attribute);
        return sum + demand[attribute] * Math.max(0, next - current);
      }, 0) / coach.fee })));
      candidates.sort((left, right) => right.utility - left.utility || compareText(left.coach.id, right.coach.id) || compareText(left.focus, right.focus));
      const selected = candidates[0];
      if (!selected || selected.utility <= 0) break;
      next = hireContractForClub(next, club.id, selected.coach.id, selected.focus);
    }
  }
  return next;
}

/** Format 74: the coach a club without one appoints, fitting its staff level and its share of the staff budget. */
function appointFittingCoach(state: SeasonState, clubId: string): SeasonState {
  const remaining = Math.max(0, staffLimit(state, clubId) - staffCommitted(state, clubId));
  const budget = !state.finance.enabledSince ? remaining : getFinanceBalance(state.finance, clubId).unpaid || getTransferPaymentSummary(state, clubId).overdue ? 0 : usesStaffContracts(state) ? Math.min(remaining, staffSpendingSalaryCap(state, clubId)) : Math.min(remaining, getSpendableCash(state, clubId));
  const choice = withCalculationCache(() => fittingLocalStaffChoice(state, clubId, 'coaches', availableCoaches(state.coaching, state), {
    rating: coachRating, fee: coach => staffFee(state, clubId, coach.fee), target: staffTargetRating(state, clubId, 'coaches', coachRatingRange()), cap: staffShareCap(state, clubId, 'coaches'), budget,
  }));
  return choice && canPayCoach(state, clubId, choice) ? hireContractForClub(state, clubId, choice.id, 'balanced') : state;
}

/** Funding arrives first; unaffordable renewals lapse without borrowing or disturbing other clubs. */
export function renewSeasonCoaching(state: SeasonState, previous: SeasonCoaching): SeasonState {
  // Renewals keep staff the club holds, so Spending left does not decide them (format 76; new hires need it).
  return keepingHeldStaff(() => renewCoaches(state, previous));
}
function renewCoaches(state: SeasonState, previous: SeasonCoaching): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew staff on the new season opening day.');
  let next: SeasonState = { ...state, coaching: { ...previous, contracts: [] } };
  if (!previous.enabledSince) return next;
  // A club that has left the full world renews no one (step 3.4d-2).
  for (const contract of previous.contracts.filter(contract => contract.releasedRound === null && contract.renew && next.clubs.some(club => club.id === contract.clubId))) {
    const coach = coachById(contract.coachId);
    if (getClubCoaching(next.coaching, contract.clubId).length < MAX_COACHES && staffCommitted(next, contract.clubId) + staffFee(next, contract.clubId, coach.fee) <= staffLimit(next, contract.clubId) && canPayCoach(next, contract.clubId, coach)) {
      next = hireContractForClub(next, contract.clubId, contract.coachId, contract.focus);
    }
  }
  return next;
}

/** Renewals start new obligations; last year's releases and fees do not carry into the new budget. */
export function rolloverCoaching(coaching: SeasonCoaching, clubs: readonly Team[], nextSeasonNumber: number): SeasonCoaching {
  let next: SeasonCoaching = { ...coaching, contracts: [] };
  if (!coaching.enabledSince) return next;
  for (const contract of coaching.contracts.filter(contract => contract.releasedRound === null && contract.renew)) {
    if (getClubCoaching(next, contract.clubId).length < MAX_COACHES && (usesClubLevelStaff({ coaching }) || coachingCommitted(next, contract.clubId) + coachById(contract.coachId).fee <= COACHING_BUDGET)) {
      next = hireForClub(next, clubs, contract.clubId, nextSeasonNumber, 1, contract.coachId, contract.focus);
    }
  }
  return next;
}

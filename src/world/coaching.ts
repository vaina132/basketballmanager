import type { Coach, CoachingContract, CoachingWeekAssignment, SeasonCoaching } from '../domain/coaching';
import type { SeasonState } from '../domain/season';
import type { TrainingFocus } from '../domain/training';
import type { PlayerAttributes, Team } from '../domain/types';
import { DEVELOPMENT_COACHES } from '../data/development-coaches';
import { getFinanceBalance, recordCoachFee } from './finance';
import { getSpendableCash } from './payroll-policy';

export const COACHING_BUDGET = 15_000_000;
export const MAX_COACHES = 3;
const ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
const FOCUSES: readonly TrainingFocus[] = ['balanced', ...ATTRIBUTES];
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const coachById = (id: string): Coach => {
  const coach = DEVELOPMENT_COACHES.find(coach => coach.id === id);
  if (!coach) throw new Error('Choose a coach from the development staff pool.');
  return coach;
};
function validateFocus(focus: TrainingFocus): void { if (!FOCUSES.includes(focus)) throw new Error('Choose a supported coaching assignment.'); }
function validateBoundary(seasonNumber: number, round: number): void {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 7974 || !Number.isInteger(round) || round < 1 || round > 10) throw new Error('Choose a valid season and matchday for the coaching contract.');
}

export function coachRating(coach: Coach): number { return Math.round(ATTRIBUTES.reduce((sum, attribute) => sum + coach.skills[attribute], 0) / ATTRIBUTES.length); }
export function getClubCoaching(coaching: SeasonCoaching, clubId: string): CoachingContract[] { return coaching.contracts.filter(contract => contract.clubId === clubId && contract.releasedRound === null); }
export function coachingCommitted(coaching: SeasonCoaching, clubId: string): number { return coaching.contracts.filter(contract => contract.clubId === clubId).reduce((sum, contract) => sum + coachById(contract.coachId).fee, 0); }
export function availableCoaches(coaching: SeasonCoaching): Coach[] {
  const active = new Set(coaching.contracts.filter(contract => contract.releasedRound === null).map(contract => contract.coachId));
  return DEVELOPMENT_COACHES.filter(coach => !active.has(coach.id));
}

/** The same commitment, vacancy and availability checks serve human and AI clubs. */
function hireForClub(coaching: SeasonCoaching, clubs: readonly Team[], clubId: string, seasonNumber: number, round: number, coachId: string, focus: TrainingFocus): SeasonCoaching {
  if (!coaching.enabledSince) throw new Error('Enable coaching staff before recruiting.');
  validateBoundary(seasonNumber, round); validateFocus(focus);
  if (!clubs.some(club => club.id === clubId)) throw new Error('The coaching contract needs a club in this league.');
  const coach = coachById(coachId);
  if (getClubCoaching(coaching, clubId).length >= MAX_COACHES) throw new Error('All three coaching positions are occupied.');
  if (!availableCoaches(coaching).some(available => available.id === coachId)) throw new Error('This coach already has an active club contract.');
  if (coachingCommitted(coaching, clubId) + coach.fee > COACHING_BUDGET) throw new Error('This contract exceeds the remaining coaching budget. Released contracts remain committed for the season.');
  return { ...coaching, contracts: [...coaching.contracts, { id: `coach-s${seasonNumber}-c${coaching.contracts.length + 1}`, coachId, clubId, seasonNumber, startedRound: round, releasedRound: null, focus, renew: true }] };
}

export function createCoaching(clubs: readonly Team[], seasonNumber = 1, round = 1, enabled = true): SeasonCoaching {
  validateBoundary(seasonNumber, round);
  let coaching: SeasonCoaching = { model: 'coaching-1', enabledSince: enabled ? { seasonNumber, round } : null, contracts: [] };
  if (enabled) for (const [index, club] of clubs.entries()) coaching = hireForClub(coaching, clubs, club.id, seasonNumber, round, DEVELOPMENT_COACHES[index]!.id, 'balanced');
  return coaching;
}

export function enableCoaching(state: SeasonState): SeasonState {
  if (state.coaching.enabledSince) return state;
  if (state.status === 'complete') throw new Error('Start the next season before enabling coaching staff.');
  if (!state.finance.enabledSince) return { ...state, coaching: createCoaching(state.clubs, state.seasonNumber, state.round) };
  let next: SeasonState = { ...state, coaching: { model: 'coaching-1', enabledSince: { seasonNumber: state.seasonNumber, round: state.round }, contracts: [] } };
  for (const [index, club] of state.clubs.entries()) {
    const coach = DEVELOPMENT_COACHES[index]!;
    if (canPayCoach(next, club.id, coach)) next = hireContractForClub(next, club.id, coach.id, 'balanced');
  }
  return next;
}

function canPayCoach(state: SeasonState, clubId: string, coach: Coach): boolean {
  if (!state.finance.enabledSince) return true;
  const balance = getFinanceBalance(state.finance, clubId);
  return balance.unpaid === 0 && getSpendableCash(state, clubId) >= coach.fee;
}

/** Contracts and their cash payment are one immutable operation for every club. */
function hireContractForClub(state: SeasonState, clubId: string, coachId: string, focus: TrainingFocus): SeasonState {
  const coaching = hireForClub(state.coaching, state.clubs, clubId, state.seasonNumber, state.round, coachId, focus);
  return recordCoachFee({ ...state, coaching }, coaching.contracts.at(-1)!);
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
  return updateContract(state, { ...managedContract(state, contractId), releasedRound: state.round });
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

export function coachingRatingForAttribute(assignments: readonly CoachingWeekAssignment[], attribute: keyof PlayerAttributes): number {
  return assignments.reduce((rating, assignment) => {
    const skill = coachById(assignment.coachId).skills[attribute];
    return Math.max(rating, assignment.focus === attribute ? skill : assignment.focus === 'balanced' ? skill / 2 : 0);
  }, 0);
}

/** Recruit for marginal coverage of the club's training focuses, normalized by full-season fee. */
export function recruitAiCoaches(state: SeasonState): SeasonState {
  if (!state.coaching.enabledSince || state.status === 'complete' || state.round === 10) return state;
  let next = state;
  for (const club of state.clubs.filter(club => club.id !== state.managedClubId)) {
    const plan = state.training.plans[club.id]!;
    const demand = Object.fromEntries(ATTRIBUTES.map(attribute => [attribute, 0])) as Record<keyof PlayerAttributes, number>;
    for (const player of club.players) {
      const individual = plan.individual[player.id]!;
      const focus = individual === 'team' ? plan.delegated ? 'balanced' : plan.focus : individual;
      if (focus === 'balanced') for (const attribute of ATTRIBUTES) demand[attribute] += 1 / ATTRIBUTES.length;
      else demand[focus] += 1;
    }
    while (getClubCoaching(next.coaching, club.id).length < MAX_COACHES) {
      const assignments = coachingAssignments(next.coaching, state.clubs, state.seasonNumber, state.round)![club.id]!;
      const remaining = COACHING_BUDGET - coachingCommitted(next.coaching, club.id);
      const candidates = availableCoaches(next.coaching).filter(coach => coach.fee <= remaining && canPayCoach(next, club.id, coach)).flatMap(coach => FOCUSES.map(focus => ({ coach, focus, utility: ATTRIBUTES.reduce((sum, attribute) => {
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

/** Funding arrives first; unaffordable renewals lapse without borrowing or disturbing other clubs. */
export function renewSeasonCoaching(state: SeasonState, previous: SeasonCoaching): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew staff on the new season opening day.');
  let next: SeasonState = { ...state, coaching: { ...previous, contracts: [] } };
  if (!previous.enabledSince) return next;
  for (const contract of previous.contracts.filter(contract => contract.releasedRound === null && contract.renew)) {
    const coach = coachById(contract.coachId);
    if (getClubCoaching(next.coaching, contract.clubId).length < MAX_COACHES && coachingCommitted(next.coaching, contract.clubId) + coach.fee <= COACHING_BUDGET && canPayCoach(next, contract.clubId, coach)) {
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
    if (getClubCoaching(next, contract.clubId).length < MAX_COACHES && coachingCommitted(next, contract.clubId) + coachById(contract.coachId).fee <= COACHING_BUDGET) {
      next = hireForClub(next, clubs, contract.clubId, nextSeasonNumber, 1, contract.coachId, contract.focus);
    }
  }
  return next;
}

import { financeLedgerCount } from './finance-ledger';
import { payStaffCompensation } from './staff-contracts';
import { withCalculationCache } from './pure-cache';
import type { ScoutContract, SeasonScouts } from '../domain/scouts';
import type { SeasonState } from '../domain/season';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { recordScoutFee } from './finance';
import { availableScouts, getClubScouts, quoteScoutHire, scoutEvidence } from './scout-policy';
import { prepareScoutingAssignments } from './scouting';
import { seasonRounds } from './career-world';
import { SCOUT_DIRECTORY } from '../data/staff-directory';
import type { Scout } from '../domain/scouts';
import { scoutRating } from './scout-policy';
import { clubsByStaffLevel, fittingLocalStaffChoice, ratingRange, staffShareCap, staffTargetRating, usesClubLevelStaff } from './staff-levels';
import { keepingHeldStaff, staffHireBudget } from './staff-policy';
import { staffFee } from './economy';

export function createScouts(): SeasonScouts { return { model: 'scouts-1', enabledSince: null, contracts: [] }; }

/** `opening` (format 74 new careers): the manager's club is staffed too, like every computer club. */
export function enableScouts(state: SeasonState, opening = false): SeasonState {
  if (state.scouts.enabledSince) return state;
  if (!state.finance.enabledSince || !state.scouting.enabledSince) throw new Error('Enable club finances and scouting before recruiting scouts.');
  if (state.status !== 'active') throw new Error('Start the next season before enabling scout recruitment.');
  const next = { ...state, scouts: { ...state.scouts, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: financeLedgerCount(state.finance) } } };
  // The career's opening staff are held, not hired: Spending left does not decide them (format 76).
  return keepingHeldStaff(() => prepareScoutingAssignments(recruitAiScouts(next, opening)), opening);
}

function hireForClub(state: SeasonState, scoutId: string, clubId: string, kept = false): SeasonState {
  const quote = quoteScoutHire(state, scoutId, clubId, kept);
  if (!quote.canHire) throw new Error(quote.reason!);
  const contract: ScoutContract = { id: `scout-contract-${state.scouts.contracts.length + 1}`, scoutId, clubId, seasonNumber: state.seasonNumber, startedRound: state.round, releasedRound: null, releasedLedgerIndex: null, renew: true, hiredLedgerIndex: financeLedgerCount(state.finance) };
  return recordScoutFee({ ...state, scouts: { ...state.scouts, contracts: [...state.scouts.contracts, contract] } }, contract);
}

export function hireScout(state: SeasonState, scoutId: string): SeasonState {
  return prepareScoutingAssignments(hireForClub(state, scoutId, state.managedClubId));
}

function managedContract(state: SeasonState, contractId: string): ScoutContract {
  const contract = getClubScouts(state).find(contract => contract.id === contractId);
  if (!state.scouts.enabledSince || !contract) throw new Error('Choose an active scout at your club.');
  return contract;
}

export function releaseScout(state: SeasonState, contractId: string): SeasonState {
  const contract = managedContract(state, contractId), club = state.scouting.clubs[state.managedClubId]!;
  return payStaffCompensation({ ...state,
    scouts: { ...state.scouts, contracts: state.scouts.contracts.map(item => item.id === contract.id ? { ...item, releasedRound: state.round, releasedLedgerIndex: financeLedgerCount(state.finance) } : item) },
    scouting: { ...state.scouting, clubs: { ...state.scouting.clubs, [state.managedClubId]: { ...club, assignments: club.assignments.filter(assignment => assignment.observer?.contractId !== contract.id) } } },
  }, 'scouts', contractId);
}

/** One step: the scout leaves (the paid fee is not refunded) and the new scout is hired. */
export function replaceScout(state: SeasonState, contractId: string, scoutId: string): SeasonState {
  return hireScout(releaseScout(state, contractId), scoutId);
}

export function setScoutRenewal(state: SeasonState, contractId: string, renew: boolean): SeasonState {
  if (typeof renew !== 'boolean') throw new Error('Choose whether the scout contract should renew.');
  const contract = managedContract(state, contractId);
  return { ...state, scouts: { ...state.scouts, contracts: state.scouts.contracts.map(item => item.id === contract.id ? { ...item, renew } : item) } };
}

/** One dedicated scout before optional additional coaches; no hidden budget or catalog knowledge. */
export function recruitAiScouts(state: SeasonState, includeManaged = false): SeasonState {
  if (!state.scouts.enabledSince || state.status !== 'active' || state.round === seasonRounds(state)) return state;
  let next = state;
  const levelled = usesClubLevelStaff(state), clubs = state.clubs.filter(club => includeManaged || club.id !== state.managedClubId);
  for (const club of levelled ? clubsByStaffLevel(state, clubs) : clubs) {
    if (getClubScouts(next, club.id).length) continue;
    const scout = levelled ? fittingScout(next, club.id) : withCalculationCache(() => availableScouts(next).filter(scout => quoteScoutHire(next, scout.id, club.id).canHire)).sort((left, right) => scoutEvidence(right) / right.fee - scoutEvidence(left) / left.fee || left.id.localeCompare(right.id, 'en'))[0];
    if (scout) next = hireForClub(next, scout.id, club.id);
  }
  return next;
}

let range: readonly [number, number] | undefined;
/** Format 74: the scout fitting a club's staff level and its share of the staff budget (`src/world/staff-levels.ts`). */
function fittingScout(state: SeasonState, clubId: string): Scout | undefined {
  const choice = withCalculationCache(() => fittingLocalStaffChoice(state, clubId, 'scouts', availableScouts(state), {
    rating: scoutRating, fee: scout => staffFee(state, clubId, scout.fee), target: staffTargetRating(state, clubId, 'scouts', range ??= ratingRange(DEVELOPMENT_SCOUTS, scoutRating)), cap: staffShareCap(state, clubId, 'scouts'), budget: staffHireBudget(state, clubId),
  }));
  return choice && quoteScoutHire(state, choice.id, clubId).canHire ? choice : undefined;
}

/** Existing coaches renew first; remaining shared funds decide each scout renewal. */
/** Renewals keep staff the club holds, so Spending left does not decide them (format 76; new hires need it). */
export function renewSeasonScouts(state: SeasonState): SeasonState { return keepingHeldStaff(() => renewScouts(state)); }
function renewScouts(state: SeasonState): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew scouts on the new season opening day.');
  if (!state.scouts.enabledSince) return state;
  let next = state;
  const previous = state.scouts.contracts.filter(contract => contract.seasonNumber === state.seasonNumber - 1 && contract.releasedRound === null && contract.renew);
  for (const contract of previous) if (SCOUT_DIRECTORY.some(scout => scout.id === contract.scoutId) && quoteScoutHire(next, contract.scoutId, contract.clubId, true).canHire) next = hireForClub(next, contract.scoutId, contract.clubId, true);
  return next;
}

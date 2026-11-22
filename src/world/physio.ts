import { financeLedgerCount } from './finance-ledger';
import { payStaffCompensation } from './staff-contracts';
import { withCalculationCache } from './pure-cache';
import type { PhysioContract, SeasonPhysio } from '../domain/physio';
import type { SeasonState } from '../domain/season';
import { recordPhysioFee } from './finance';
import { availablePhysios, getClubPhysio, physioEffects, quotePhysioHire } from './physio-policy';
import { seasonRounds } from './career-world';
import type { Physio } from '../domain/physio';
import { physioRating } from './physio-policy';
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios';
import { clubsByStaffLevel, fittingLocalStaffChoice, ratingRange, staffShareCap, staffTargetRating, usesClubLevelStaff } from './staff-levels';
import { appointingMinimumStaff, cheapestStaff, keepingHeldStaff, staffHireBudget, usesFullStaff } from './staff-policy';
import { staffFee } from './economy';

export function createPhysio(): SeasonPhysio { return { model: 'physio-1', enabledSince: null, contracts: [], rehabilitation: [] }; }
/** `opening` (format 74 new careers): the manager's club is staffed too, like every computer club. */
export function enablePhysio(state: SeasonState, opening = false): SeasonState {
  if (state.physio.enabledSince) return state;
  if (!state.finance.enabledSince) throw new Error('Enable club finances before recruiting physios.');
  if (state.status !== 'active' || state.round === seasonRounds(state)) throw new Error('Enable physios while weekly reviews are available, before the final matchday.');
  // The career's opening staff are held, not hired: Spending left does not decide them (format 76).
  return keepingHeldStaff(() => recruitAiPhysios({ ...state, physio: { ...state.physio, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: financeLedgerCount(state.finance) } } }, opening), opening);
}
/** Format 84: the minimum appointment of a club that can afford no one (no money check applies). */
function minimumAppointment(state: SeasonState, clubId: string, member: { id: string } | undefined): SeasonState {
  return member ? appointingMinimumStaff(() => hireForClub(state, member.id, clubId)) : state;
}
function hireForClub(state: SeasonState, physioId: string, clubId: string, kept = false): SeasonState {
  const quote = quotePhysioHire(state, physioId, clubId, kept);
  if (!quote.canHire) throw new Error(quote.reason!);
  const contract: PhysioContract = { id: `physio-contract-${state.physio.contracts.length + 1}`, physioId, clubId, seasonNumber: state.seasonNumber, startedRound: state.round, releasedRound: null, releasedLedgerIndex: null, renew: true, hiredLedgerIndex: financeLedgerCount(state.finance) };
  return recordPhysioFee({ ...state, physio: { ...state.physio, contracts: [...state.physio.contracts, contract] } }, contract);
}
export function hirePhysio(state: SeasonState, physioId: string): SeasonState { return hireForClub(state, physioId, state.managedClubId); }
function managedContract(state: SeasonState, contractId: string): PhysioContract {
  const contract = getClubPhysio(state);
  if (!state.physio.enabledSince || !contract || contract.id !== contractId) throw new Error('Choose the active physio at your club.');
  return contract;
}
export function releasePhysio(state: SeasonState, contractId: string): SeasonState {
  const contract = managedContract(state, contractId);
  return payStaffCompensation({ ...state, physio: { ...state.physio, contracts: state.physio.contracts.map(item => item.id === contract.id ? { ...item, releasedRound: state.round, releasedLedgerIndex: financeLedgerCount(state.finance) } : item) } }, 'physio', contractId);
}
export function setPhysioRenewal(state: SeasonState, contractId: string, renew: boolean): SeasonState {
  if (typeof renew !== 'boolean') throw new Error('Choose whether the physio contract should renew.');
  const contract = managedContract(state, contractId);
  return { ...state, physio: { ...state.physio, contracts: state.physio.contracts.map(item => item.id === contract.id ? { ...item, renew } : item) } };
}
export function recruitAiPhysios(state: SeasonState, includeManaged = false): SeasonState {
  if (!state.physio.enabledSince || state.status !== 'active' || state.round === seasonRounds(state)) return state;
  let next = state;
  const levelled = usesClubLevelStaff(state), clubs = state.clubs.filter(club => includeManaged || club.id !== state.managedClubId);
  for (const club of levelled ? clubsByStaffLevel(state, clubs) : clubs) {
    if (getClubPhysio(next, club.id)) continue;
    const physio = levelled ? fittingPhysio(next, club.id) : withCalculationCache(() => availablePhysios(next).filter(physio => quotePhysioHire(next, physio.id, club.id).canHire)).sort((left, right) => physioEffects(right).creditPerDay / right.fee - physioEffects(left).creditPerDay / left.fee || left.id.localeCompare(right.id, 'en'))[0];
    if (physio) next = hireForClub(next, physio.id, club.id);
    // Format 84: a club that can afford no one still appoints the cheapest candidate (the minimum appointment).
    else if (levelled && usesFullStaff(next)) next = minimumAppointment(next, club.id, withCalculationCache(() => cheapestStaff(availablePhysios(next), member => staffFee(next, club.id, member.fee))));
  }
  return next;
}
let range: readonly [number, number] | undefined;
/** Format 74: the physio fitting a club's staff level and its share of the staff budget (`src/world/staff-levels.ts`). */
function fittingPhysio(state: SeasonState, clubId: string): Physio | undefined {
  const choice = withCalculationCache(() => fittingLocalStaffChoice(state, clubId, 'physio', availablePhysios(state), {
    rating: physioRating, fee: member => staffFee(state, clubId, member.fee), target: staffTargetRating(state, clubId, 'physio', range ??= ratingRange(DEVELOPMENT_PHYSIOS, physioRating)), cap: staffShareCap(state, clubId, 'physio'), budget: staffHireBudget(state, clubId),
  }));
  return choice && quotePhysioHire(state, choice.id, clubId).canHire ? choice : undefined;
}

/** One step: the physio leaves (the paid fee is not refunded) and the new physio is hired. */
export function replacePhysio(state: SeasonState, contractId: string, physioId: string): SeasonState {
  return hirePhysio(releasePhysio(state, contractId), physioId);
}

/** Renewals keep staff the club holds, so Spending left does not decide them (format 76; new hires need it). */
export function renewSeasonPhysio(state: SeasonState): SeasonState { return keepingHeldStaff(() => renewPhysio(state)); }
function renewPhysio(state: SeasonState): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew physios on the new season opening day.');
  if (!state.physio.enabledSince) return state;
  let next = state;
  for (const contract of state.physio.contracts.filter(contract => contract.seasonNumber === state.seasonNumber - 1 && contract.releasedRound === null && contract.renew)) {
    if (quotePhysioHire(next, contract.physioId, contract.clubId, true).canHire) next = hireForClub(next, contract.physioId, contract.clubId, true);
  }
  return next;
}

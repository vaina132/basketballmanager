import { financeLedgerCount } from './finance-ledger';
import { withCalculationCache } from './pure-cache';
import type { ScoutContract, SeasonScouts } from '../domain/scouts';
import type { SeasonState } from '../domain/season';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { recordScoutFee } from './finance';
import { availableScouts, getClubScouts, quoteScoutHire, scoutEvidence } from './scout-policy';
import { prepareScoutingAssignments } from './scouting';
import { seasonRounds } from './career-world';
import { SCOUT_DIRECTORY } from '../data/staff-directory';

export function createScouts(): SeasonScouts { return { model: 'scouts-1', enabledSince: null, contracts: [] }; }

export function enableScouts(state: SeasonState): SeasonState {
  if (state.scouts.enabledSince) return state;
  if (!state.finance.enabledSince || !state.scouting.enabledSince) throw new Error('Enable club finances and scouting before recruiting scouts.');
  if (state.status !== 'active') throw new Error('Start the next season before enabling scout recruitment.');
  const next = { ...state, scouts: { ...state.scouts, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: financeLedgerCount(state.finance) } } };
  return prepareScoutingAssignments(recruitAiScouts(next));
}

function hireForClub(state: SeasonState, scoutId: string, clubId: string): SeasonState {
  const quote = quoteScoutHire(state, scoutId, clubId);
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
  return { ...state,
    scouts: { ...state.scouts, contracts: state.scouts.contracts.map(item => item.id === contract.id ? { ...item, releasedRound: state.round, releasedLedgerIndex: financeLedgerCount(state.finance) } : item) },
    scouting: { ...state.scouting, clubs: { ...state.scouting.clubs, [state.managedClubId]: { ...club, assignments: club.assignments.filter(assignment => assignment.observer?.contractId !== contract.id) } } },
  };
}

export function setScoutRenewal(state: SeasonState, contractId: string, renew: boolean): SeasonState {
  if (typeof renew !== 'boolean') throw new Error('Choose whether the scout contract should renew.');
  const contract = managedContract(state, contractId);
  return { ...state, scouts: { ...state.scouts, contracts: state.scouts.contracts.map(item => item.id === contract.id ? { ...item, renew } : item) } };
}

/** One dedicated scout before optional additional coaches; no hidden budget or catalog knowledge. */
export function recruitAiScouts(state: SeasonState): SeasonState {
  if (!state.scouts.enabledSince || state.status !== 'active' || state.round === seasonRounds(state)) return state;
  let next = state;
  for (const club of state.clubs.filter(club => club.id !== state.managedClubId)) {
    if (getClubScouts(next, club.id).length) continue;
    const scout = withCalculationCache(() => availableScouts(next).filter(scout => quoteScoutHire(next, scout.id, club.id).canHire)).sort((left, right) => scoutEvidence(right) / right.fee - scoutEvidence(left) / left.fee || left.id.localeCompare(right.id, 'en'))[0];
    if (scout) next = hireForClub(next, scout.id, club.id);
  }
  return next;
}

/** Existing coaches renew first; remaining shared funds decide each scout renewal. */
export function renewSeasonScouts(state: SeasonState): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew scouts on the new season opening day.');
  if (!state.scouts.enabledSince) return state;
  let next = state;
  const previous = state.scouts.contracts.filter(contract => contract.seasonNumber === state.seasonNumber - 1 && contract.releasedRound === null && contract.renew);
  for (const contract of previous) if (SCOUT_DIRECTORY.some(scout => scout.id === contract.scoutId) && quoteScoutHire(next, contract.scoutId, contract.clubId).canHire) next = hireForClub(next, contract.scoutId, contract.clubId);
  return next;
}

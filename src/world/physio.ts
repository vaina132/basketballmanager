import { financeLedgerCount } from './finance-ledger';
import type { PhysioContract, SeasonPhysio } from '../domain/physio';
import type { SeasonState } from '../domain/season';
import { recordPhysioFee } from './finance';
import { availablePhysios, getClubPhysio, physioEffects, quotePhysioHire } from './physio-policy';
import { seasonRounds } from './career-world';

export function createPhysio(): SeasonPhysio { return { model: 'physio-1', enabledSince: null, contracts: [], rehabilitation: [] }; }
export function enablePhysio(state: SeasonState): SeasonState {
  if (state.physio.enabledSince) return state;
  if (!state.finance.enabledSince) throw new Error('Enable club finances before recruiting physios.');
  if (state.status !== 'active' || state.round === seasonRounds(state)) throw new Error('Enable physios while weekly reviews are available, before the final matchday.');
  return recruitAiPhysios({ ...state, physio: { ...state.physio, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: financeLedgerCount(state.finance) } } });
}
function hireForClub(state: SeasonState, physioId: string, clubId: string): SeasonState {
  const quote = quotePhysioHire(state, physioId, clubId);
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
  return { ...state, physio: { ...state.physio, contracts: state.physio.contracts.map(item => item.id === contract.id ? { ...item, releasedRound: state.round, releasedLedgerIndex: financeLedgerCount(state.finance) } : item) } };
}
export function setPhysioRenewal(state: SeasonState, contractId: string, renew: boolean): SeasonState {
  if (typeof renew !== 'boolean') throw new Error('Choose whether the physio contract should renew.');
  const contract = managedContract(state, contractId);
  return { ...state, physio: { ...state.physio, contracts: state.physio.contracts.map(item => item.id === contract.id ? { ...item, renew } : item) } };
}
export function recruitAiPhysios(state: SeasonState): SeasonState {
  if (!state.physio.enabledSince || state.status !== 'active' || state.round === seasonRounds(state)) return state;
  let next = state;
  for (const club of state.clubs.filter(club => club.id !== state.managedClubId)) {
    if (getClubPhysio(next, club.id)) continue;
    const physio = availablePhysios(next).filter(physio => quotePhysioHire(next, physio.id, club.id).canHire).sort((left, right) => physioEffects(right).creditPerDay / right.fee - physioEffects(left).creditPerDay / left.fee || left.id.localeCompare(right.id, 'en'))[0];
    if (physio) next = hireForClub(next, physio.id, club.id);
  }
  return next;
}
export function renewSeasonPhysio(state: SeasonState): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew physios on the new season opening day.');
  if (!state.physio.enabledSince) return state;
  let next = state;
  for (const contract of state.physio.contracts.filter(contract => contract.seasonNumber === state.seasonNumber - 1 && contract.releasedRound === null && contract.renew)) {
    if (quotePhysioHire(next, contract.physioId, contract.clubId).canHire) next = hireForClub(next, contract.physioId, contract.clubId);
  }
  return next;
}

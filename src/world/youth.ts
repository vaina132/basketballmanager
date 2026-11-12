import type { SeasonYouth, YouthCoachContract } from '../domain/youth';
import type { SeasonState } from '../domain/season';
import { recordYouthFee } from './finance';
import { availableYouthCoaches, getClubYouthCoach, quoteYouthCoachHire, youthCoachEffects } from './youth-policy';

export function createYouth(): SeasonYouth { return { model: 'youth-1', enabledSince: null, contracts: [] }; }
export function enableYouth(state: SeasonState): SeasonState {
  if (state.youth.enabledSince) return state;
  if (!state.academy.enabledSince || !state.finance.enabledSince) throw new Error('Enable the academy and club finances before recruiting a youth coach.');
  if (state.status !== 'active' || state.round === 10) throw new Error('Recruit youth coaches while academy training weeks remain, from matchday one to nine.');
  return recruitAiYouthCoaches({ ...state, youth: { ...state.youth, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: state.finance.ledger.length } } });
}
function hireForClub(state: SeasonState, coachId: string, clubId: string): SeasonState {
  const quote = quoteYouthCoachHire(state, coachId, clubId);
  if (!quote.canHire) throw new Error(quote.reason!);
  const contract: YouthCoachContract = { id: `youth-contract-${state.youth.contracts.length + 1}`, coachId, clubId, seasonNumber: state.seasonNumber, startedRound: state.round, releasedRound: null, releasedLedgerIndex: null, renew: true, hiredLedgerIndex: state.finance.ledger.length };
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
  return { ...state, youth: { ...state.youth, contracts: state.youth.contracts.map(item => item.id === contract.id ? { ...item, releasedRound: state.round, releasedLedgerIndex: state.finance.ledger.length } : item) } };
}
export function setYouthCoachRenewal(state: SeasonState, contractId: string, renew: boolean): SeasonState {
  if (typeof renew !== 'boolean') throw new Error('Choose whether the youth-coach contract should renew.');
  const contract = managedContract(state, contractId);
  return { ...state, youth: { ...state.youth, contracts: state.youth.contracts.map(item => item.id === contract.id ? { ...item, renew } : item) } };
}
export function recruitAiYouthCoaches(state: SeasonState): SeasonState {
  if (!state.youth.enabledSince || state.status !== 'active' || state.round === 10) return state;
  let next = state;
  for (const club of state.clubs.filter(club => club.id !== state.managedClubId)) {
    if (getClubYouthCoach(next, club.id)) continue;
    const coach = availableYouthCoaches(next).filter(coach => quoteYouthCoachHire(next, coach.id, club.id).canHire).sort((left, right) => youthCoachEffects(right).bonusPercent / right.fee - youthCoachEffects(left).bonusPercent / left.fee || left.fee - right.fee || left.id.localeCompare(right.id, 'en'))[0];
    if (coach) next = hireForClub(next, coach.id, club.id);
  }
  return next;
}
export function renewSeasonYouth(state: SeasonState): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew youth coaches on the new season opening day.');
  if (!state.youth.enabledSince) return state;
  let next = state;
  for (const contract of state.youth.contracts.filter(contract => contract.seasonNumber === state.seasonNumber - 1 && contract.releasedRound === null && contract.renew)) if (quoteYouthCoachHire(next, contract.coachId, contract.clubId).canHire) next = hireForClub(next, contract.coachId, contract.clubId);
  return next;
}

import { financeLedgerCount } from './finance-ledger';
import type { AssistantContract, SeasonAssistant } from '../domain/assistant';
import type { SeasonState } from '../domain/season';
import { recordAssistantFee } from './finance';
import { assistantEffects, availableAssistants, getClubAssistant, quoteAssistantHire } from './assistant-policy';
import { seasonRounds } from './career-world';
import { withCalculationCache } from './pure-cache';

export function createAssistant(): SeasonAssistant { return { model: 'assistant-1', enabledSince: null, contracts: [] }; }

export function enableAssistant(state: SeasonState): SeasonState {
  if (state.assistant.enabledSince) return state;
  if (!state.finance.enabledSince) throw new Error('Enable club finances before recruiting assistant coaches.');
  if (state.status !== 'active' || state.round === seasonRounds(state) && state.activeMatch.status === 'finished') throw new Error('Enable assistant coaches before the final match finishes, or when the next season starts.');
  return recruitAiAssistants({ ...state, assistant: { ...state.assistant, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: financeLedgerCount(state.finance) } } });
}

function hireForClub(state: SeasonState, assistantId: string, clubId: string): SeasonState {
  const quote = quoteAssistantHire(state, assistantId, clubId);
  if (!quote.canHire) throw new Error(quote.reason!);
  const contract: AssistantContract = { id: `assistant-contract-${state.assistant.contracts.length + 1}`, assistantId, clubId, seasonNumber: state.seasonNumber, startedRound: state.round, releasedRound: null, releasedLedgerIndex: null, renew: true, hiredLedgerIndex: financeLedgerCount(state.finance) };
  return recordAssistantFee({ ...state, assistant: { ...state.assistant, contracts: [...state.assistant.contracts, contract] } }, contract);
}

/** Hiring changes staffing and budgets; the prepared match and current policies stay intact. */
export function hireAssistant(state: SeasonState, assistantId: string): SeasonState { return hireForClub(state, assistantId, state.managedClubId); }

function managedContract(state: SeasonState, contractId: string): AssistantContract {
  const contract = getClubAssistant(state);
  if (!state.assistant.enabledSince || !contract || contract.id !== contractId) throw new Error('Choose the active assistant coach at your club.');
  return contract;
}
export function releaseAssistant(state: SeasonState, contractId: string): SeasonState {
  const contract = managedContract(state, contractId);
  return { ...state, assistant: { ...state.assistant, contracts: state.assistant.contracts.map(item => item.id === contract.id ? { ...item, releasedRound: state.round, releasedLedgerIndex: financeLedgerCount(state.finance) } : item) } };
}
export function setAssistantRenewal(state: SeasonState, contractId: string, renew: boolean): SeasonState {
  if (typeof renew !== 'boolean') throw new Error('Choose whether the assistant-coach contract should renew.');
  const contract = managedContract(state, contractId);
  return { ...state, assistant: { ...state.assistant, contracts: state.assistant.contracts.map(item => item.id === contract.id ? { ...item, renew } : item) } };
}

/** One assistant before additional training coaches, using the same budget/arrears guards. */
export function recruitAiAssistants(state: SeasonState): SeasonState {
  if (!state.assistant.enabledSince || state.status !== 'active' || state.round === seasonRounds(state) && state.activeMatch.status === 'finished') return state;
  let next = state;
  for (const club of state.clubs.filter(club => club.id !== state.managedClubId)) {
    if (getClubAssistant(next, club.id)) continue;
    // Candidate quotes share one unchanged accounting boundary. Release it before any appointment changes funds.
    const coach = withCalculationCache(() => availableAssistants(next).filter(coach => quoteAssistantHire(next, coach.id, club.id).canHire)).sort((left, right) => {
      // Resolution is the actual benefit. Identical-effect candidates use fee, then stable ID.
      const leftValue = 1 / assistantEffects(left).skillStep / left.fee, rightValue = 1 / assistantEffects(right).skillStep / right.fee;
      return rightValue - leftValue || left.fee - right.fee || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    })[0];
    if (coach) next = hireForClub(next, coach.id, club.id);
  }
  return next;
}

/** Existing-role renewals precede assistants; unavailable funds cause an honest lapse. */
export function renewSeasonAssistant(state: SeasonState): SeasonState {
  if (state.status !== 'active' || state.round !== 1) throw new Error('Renew assistant coaches on the new season opening day.');
  if (!state.assistant.enabledSince) return state;
  let next = state;
  for (const contract of state.assistant.contracts.filter(contract => contract.seasonNumber === state.seasonNumber - 1 && contract.releasedRound === null && contract.renew)) {
    if (quoteAssistantHire(next, contract.assistantId, contract.clubId).canHire) next = hireForClub(next, contract.assistantId, contract.clubId);
  }
  return next;
}

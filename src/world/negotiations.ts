import type { NegotiationDecision, NegotiationRecord, SeasonNegotiations } from '../domain/negotiations';
import type { SeasonState } from '../domain/season';
import type { SquadRole } from '../domain/relationships';

export function createNegotiations(): SeasonNegotiations {
  return { model: 'negotiations-1', enabledSince: null, records: [] };
}

export function enableNegotiations(state: SeasonState): SeasonState {
  if (state.negotiations.enabledSince) return state;
  if (!state.employment.enabledSince || !state.payroll.enabledSince || !state.finance.enabledSince) throw new Error('Enable player contracts, payroll and finances before enabling negotiations.');
  return { ...state, negotiations: { model: 'negotiations-1', enabledSince: { seasonNumber: state.seasonNumber, round: state.round, contractCount: state.employment.contracts.length }, records: [] } };
}

export function getNegotiationHistory(state: SeasonState, playerId: string, clubId = state.managedClubId, startsSeason = state.seasonNumber + 1): NegotiationRecord[] {
  return state.negotiations.records.filter(record => record.playerId === playerId && record.clubId === clubId && record.startsSeason === startsSeason);
}

export function getLatestNegotiation(state: SeasonState, playerId: string, clubId = state.managedClubId, startsSeason = state.seasonNumber + 1): NegotiationRecord | null {
  return getNegotiationHistory(state, playerId, clubId, startsSeason).at(-1) ?? null;
}

/** Append a reply alongside its optional binding employment term in one caller-owned transaction. */
export function appendNegotiationResponse(state: SeasonState, clubId: string, playerId: string, offeredWage: number, offeredSeasons: number, decision: NegotiationDecision, contractId: string | null, contractCountBefore: number, startsSeason = state.seasonNumber + 1, releaseFee?: number, role?: SquadRole): SeasonState {
  if (!state.negotiations.enabledSince) throw new Error('Enable negotiations before recording a response.');
  const record: NegotiationRecord = {
    id: `negotiation-${state.negotiations.records.length + 1}`, clubId, playerId,
    seasonNumber: state.seasonNumber, round: state.round, date: state.date, status: state.status,
    startsSeason, offeredWage, offeredSeasons,
    ...decision, contractId, contractCountBefore, ...(releaseFee === undefined ? {} : { releaseFee }), ...(role === undefined ? {} : { role }),
  };
  return { ...state, negotiations: { ...state.negotiations, records: [...state.negotiations.records, record] } };
}

import { staffLimit } from './wage-pool';
import type { AssistantCoach, AssistantContract, AssistantHireQuote } from '../domain/assistant';
import type { SeasonState } from '../domain/season';
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants';
import { getFinanceBalance } from './finance';
import { remainingStaffBudget, staffAllocation, staffCanJoin, staffCommitted, staffMoneyReason } from './staff-policy';
import { staffMarketWorld } from './staff-levels';
import { getTransferPaymentSummary } from './transfer-payments';
import { seasonRounds, worldOf } from './career-world';
import { ASSISTANT_DIRECTORY, staffMarket, staffMember } from '../data/staff-directory';
import type { WorldContext } from '../domain/world';
import { staffFee } from './economy';

export const MAX_ASSISTANTS = 1;
export function assistantRating(coach: AssistantCoach): number { return coach.assessment; }
/** Advice resolution only. Current condition, injuries and match eligibility stay exact. */
export function assistantEffects(coach: AssistantCoach): { skillStep: number } {
  return { skillStep: 1 + Math.floor((10 - coach.assessment) / 3) };
}
export function getClubAssistant(state: Pick<SeasonState, 'assistant' | 'seasonNumber' | 'managedClubId'>, clubId = state.managedClubId): AssistantContract | null {
  return state.assistant.contracts.find(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null) ?? null;
}
/** The league's market (sized to its clubs) without this season's employed staff. */
export function availableAssistants(state: Pick<SeasonState, 'assistant' | 'seasonNumber'> & Partial<Pick<SeasonState, 'clubs'>> & WorldContext): AssistantCoach[] {
  const employed = new Set(state.assistant.contracts.filter(contract => contract.seasonNumber === state.seasonNumber && contract.releasedRound === null).map(contract => contract.assistantId));
  return staffMarket(ASSISTANT_DIRECTORY, staffMarketWorld(state)).filter(coach => !employed.has(coach.id));
}
/** `kept`: a season-opening renewal, which only needs the assistant free in careers with staff contracts (`staffCanJoin`). */
export function quoteAssistantHire(state: SeasonState, assistantId: string, clubId = state.managedClubId, kept = false): AssistantHireQuote {
  const coach = staffMember(ASSISTANT_DIRECTORY, assistantId);
  const remainingAllocation = Math.max(0, staffLimit(state, clubId) - staffCommitted(state, clubId));
  const remainingBudget = remainingStaffBudget(state, clubId);
  let reason: string | null = null;
  if (!state.assistant.enabledSince) reason = 'Enable assistant-coach recruitment before hiring.';
  else if (!state.finance.enabledSince) reason = 'Assistant-coach recruitment requires club finances.';
  else if (state.status !== 'active' || state.round === seasonRounds(state) && state.activeMatch?.status === 'finished') reason = 'No match advice remains this season. Recruit an assistant when the next season starts.';
  else if (!state.clubs.some(club => club.id === clubId) || !coach) reason = 'Choose an assistant coach and club from this career.';
  else if (getClubAssistant(state, clubId)) reason = 'The assistant-coach position is already occupied.';
  else if (!staffCanJoin(state, kept, state.assistant.contracts.some(contract => contract.assistantId === assistantId && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null), () => availableAssistants(state).some(available => available.id === assistantId))) reason = 'This assistant coach already has an active club contract.';
  else if (getFinanceBalance(state.finance, clubId).unpaid) reason = 'Settle unpaid club costs before hiring an assistant coach.';
  else if (getTransferPaymentSummary(state, clubId).overdue) reason = 'Settle overdue transfer payments before hiring an assistant coach.';
  else reason = staffMoneyReason(state, 'assistant coach', staffFee(state, clubId, coach.fee), remainingAllocation, remainingBudget, clubId);
  return { assistantId, clubId, fee: staffFee(state, clubId, coach?.fee ?? 0), remainingAllocation, remainingBudget, canHire: reason === null, reason };
}

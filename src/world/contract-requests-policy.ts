import type { ContractRequest, ContractRequestStatus, RelationshipEvent } from '../domain/relationships';
import type { SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { dateForRound } from './season';
import { seasonRounds } from './career-world';
import { RELATIONSHIP_RULES } from './relationship-rules';

export type ContractRequestEvent = Extract<RelationshipEvent, { type: 'contract-request' }>;
export type ContractReplyEvent = Extract<RelationshipEvent, { type: 'contract-reply' }>;
/** What a request's outcome is read from. Replays pass their own prefixes of contracts and negotiation records. */
export type ContractRequestContext = Pick<SeasonState, 'relationships' | 'employment' | 'negotiations' | 'seasonNumber' | 'round' | 'status' | 'date'> & WorldContext;

const RULES = RELATIONSHIP_RULES.contractRequests;
const isRequest = (event: RelationshipEvent): event is ContractRequestEvent => event.type === 'contract-request';
const isReply = (event: RelationshipEvent): event is ContractReplyEvent => event.type === 'contract-reply';

/**
 * A request or reply already made at this point of the career: replays of earlier offers see the whole journal, so
 * an event counts only once its date and its place among negotiation records have been reached.
 */
function visible(context: ContractRequestContext, event: ContractRequestEvent | ContractReplyEvent): boolean {
  return event.date <= context.date && event.negotiationCount <= context.negotiations.records.length
    && (event.seasonNumber < context.seasonNumber || event.seasonNumber === context.seasonNumber && event.round <= context.round);
}

/** An offer recorded before this point (an in-season offer counts from the next matchday, or once the season is over). */
function settled(context: ContractRequestContext, record: SeasonState['negotiations']['records'][number]): boolean {
  return record.seasonNumber < context.seasonNumber || record.date < context.date || context.status === 'complete' && record.status === 'active' && record.seasonNumber === context.seasonNumber;
}

function offerAfter(context: ContractRequestContext, request: ContractRequestEvent, reply: ContractReplyEvent): string | null {
  const records = context.negotiations.records;
  for (let index = records.length - 1; index >= reply.negotiationCount; index -= 1) {
    const record = records[index]!;
    if (record.seasonNumber < request.seasonNumber) break;
    if (record.clubId === request.clubId && record.playerId === request.playerId && record.startsSeason === request.seasonNumber + 1 && settled(context, record)) {
      // The earliest qualifying offer dates the outcome.
      let earliest = record;
      for (let before = index - 1; before >= reply.negotiationCount; before -= 1) {
        const other = records[before]!;
        if (other.clubId === request.clubId && other.playerId === request.playerId && other.startsSeason === request.seasonNumber + 1 && settled(context, other)) earliest = other;
      }
      return earliest.date;
    }
  }
  return null;
}

function renewalDate(context: ContractRequestContext, request: ContractRequestEvent): string | null {
  const contracts = context.employment.contracts;
  for (let index = contracts.length - 1; index >= 0; index -= 1) {
    const contract = contracts[index]!;
    if (contract.signedSeason < request.seasonNumber) break;
    if (contract.playerId === request.playerId && contract.clubId === request.clubId && contract.startsSeason === request.seasonNumber + 1 && (contract.signedSeason > request.seasonNumber || contract.signedRound >= request.round)) return dateForRound(contract.signedRound, contract.signedSeason);
  }
  return null;
}

/** The outcome of one request at this point of the career. */
export function contractRequestOutcome(context: ContractRequestContext, request: ContractRequestEvent, reply: ContractReplyEvent | null): ContractRequest {
  const rounds = seasonRounds(context), year = request.seasonNumber;
  const over = context.seasonNumber > year || context.status === 'complete';
  const replyRound = Math.min(rounds, request.round + RULES.replyRounds);
  let status: ContractRequestStatus, outcomeDate: string | null = null, deadlineDate: string | null = null;
  const renewed = renewalDate(context, request);
  if (reply?.reply === 'talks') deadlineDate = dateForRound(Math.min(rounds, reply.round + RULES.talksRounds - 1), year);
  if (reply?.reply === 'promise') deadlineDate = dateForRound(1, year + 1);
  if (renewed) { status = 'renewed'; outcomeDate = renewed; }
  else if (!reply) {
    if (over || context.round >= replyRound) { status = 'ignored'; outcomeDate = dateForRound(replyRound, year); }
    else status = 'open';
  } else if (reply.reply === 'decline') { status = 'declined'; outcomeDate = reply.date; }
  else {
    const offered = offerAfter(context, request, reply);
    if (offered) { status = 'kept'; outcomeDate = offered; }
    else if (reply.reply === 'talks' && (over || context.round >= reply.round + RULES.talksRounds)) { status = 'lapsed'; outcomeDate = dateForRound(Math.min(rounds, reply.round + RULES.talksRounds), year); }
    else if (reply.reply === 'promise' && context.seasonNumber > year) { status = 'broken'; outcomeDate = deadlineDate; }
    else status = reply.reply === 'talks' ? 'talks' : 'promised';
  }
  const remembered = context.seasonNumber - year < RULES.premiumSeasons;
  return {
    id: request.id, clubId: request.clubId, playerId: request.playerId, seasonNumber: year, round: request.round, date: request.date, trigger: request.trigger,
    reply: reply?.reply ?? null, repliedOn: reply?.date ?? null, status, replyBy: dateForRound(replyRound - 1, year), deadlineDate, outcomeDate,
    premiumPercent: remembered ? RULES.premiumPercent[status] ?? 0 : 0,
  };
}

/** One player's requests at a club, in order, from his journal entries (already filtered to this club and player). */
export function contractRequestsFromEvents(context: ContractRequestContext, events: readonly RelationshipEvent[]): ContractRequest[] {
  const requests: ContractRequestEvent[] = [], replies = new Map<string, ContractReplyEvent>();
  for (const event of events) {
    if (isRequest(event) && visible(context, event)) requests.push(event);
    else if (isReply(event) && visible(context, event) && !replies.has(event.requestId)) replies.set(event.requestId, event);
  }
  return requests.map(request => contractRequestOutcome(context, request, replies.get(request.id) ?? null));
}

/**
 * The extra wage share (percent) a player asks to sign with this club after it refused his request (declined,
 * ignored, lapsed talks or a broken promise), for that season and the next. Zero outside `relationships-2`.
 */
export function refusedContractPremium(context: ContractRequestContext, clubId: string, playerId: string): number {
  if (context.relationships?.model !== 'relationships-2' || !context.relationships.enabledSince) return 0;
  const events = context.relationships.events, earliest = context.seasonNumber - RULES.premiumSeasons + 1, mine: RelationshipEvent[] = [];
  let requested = false;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.seasonNumber < earliest) break;
    if ((isRequest(event) || isReply(event)) && event.clubId === clubId && event.playerId === playerId) { mine.unshift(event); requested ||= isRequest(event); }
  }
  if (!requested) return 0;
  return Math.max(0, ...contractRequestsFromEvents(context, mine).map(request => request.premiumPercent));
}

/** The lowest annual wage this club can offer a player who remembers a refusal, in the wage steps contracts use. */
export function refusedContractMinimum(context: ContractRequestContext, clubId: string, playerId: string, askingWage: number, wageStep: number): number {
  const premium = refusedContractPremium(context, clubId, playerId);
  return premium ? Math.ceil(askingWage * (100 + premium) / (100 * wageStep)) * wageStep : 0;
}

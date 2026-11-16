import type { ContractRequest, ContractRequestReply, ContractRequestTrigger, PlayerRelationship, PlayingTimePromise, PressAnswer, RelationshipAnchor, RelationshipEvent, RelationshipsModel, RelationshipTalk, RelationshipTalkQuote, RoleAgreementQuote, SeasonRelationships, SquadRole } from '../domain/relationships';
import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import { dateForRound } from './season';
import { rosterForRound } from './rosters';
import { isRecovering } from './health';
import { fixturePlayerEvidence } from './senior-history';
import { getPlayerRetirement } from './lifecycle-policy';
import { getPressQuestion, pressAnswerLabel, pressEventFields, pressEventMatches, pressImpact, pressMoraleValue } from './press-policy';
import { governingDerby, RIVALRY_MORALE_WEIGHT } from './rivalries';
import { ordinalRound, roundOrdinal, seasonRounds, worldOf, lastCommittedWeek } from './career-world';
import { overallRating } from './overall-rating';
import { scoutingActualAttributes } from './scouting-policy';
import { contractForSeason, effectiveContractsForRound, effectiveContractsForSeason } from './employment-policy';
import { CONTRACT_REQUEST_TEXT as TEXT, RELATIONSHIP_RULES } from './relationship-rules';
import { contractRequestsFromEvents } from './contract-requests-policy';

export const SQUAD_ROLES: readonly SquadRole[] = ['development', 'rotation', 'starter'];
export const SQUAD_ROLE_DEFINITIONS: Record<SquadRole, { label: string; minMinutes: number; maxMinutes: number }> = {
  development: { label: 'Reserve', minMinutes: 0, maxMinutes: 8 },
  rotation: { label: 'Rotation', minMinutes: 12, maxMinutes: 20 },
  starter: { label: 'Starter', minMinutes: 24, maxMinutes: 32 },
};
export const RELATIONSHIP_COOLDOWN_GAMES = 4;
export const PROMISE_ELIGIBLE_GAMES = 3;
export const PROMISE_DEADLINE_GAMES = 6;
/** Matchdays as one sequence across seasons; stored in anchors and counted forward, so it uses the season length. */
const ordinal = (year: number, round: number, rounds: number) => roundOrdinal(year, round, rounds);
const dateAt = (at: number, rounds: number) => { const { seasonNumber, round } = ordinalRound(at, rounds); return dateForRound(round, seasonNumber); };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const rounded = (n: number) => Math.round(n * 10) / 10;
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type PlayerEvent = Extract<RelationshipEvent, { type: 'role' | 'talk' }>;
type ContractEvent = Extract<RelationshipEvent, { type: 'contract-request' | 'contract-reply' }>;
const playerEvent = (event: RelationshipEvent): event is PlayerEvent => event.type === 'role' || event.type === 'talk';
const contractEvent = (event: RelationshipEvent): event is ContractEvent => event.type === 'contract-request' || event.type === 'contract-reply';
const CONTRACT_RULES = RELATIONSHIP_RULES.contractRequests;
/** Squad-rank default roles and contract requests belong to the `relationships-2` model (new careers, format 66). */
const ranked = (state: SeasonState) => state.relationships.model === 'relationships-2';

/** Disabled relationships are always the original empty journal; the model is chosen when they are enabled. */
export function createRelationships(): SeasonRelationships { return { model: 'relationships-1', enabledSince: null, events: [] }; }
export function relationshipEventAnchor(state: SeasonState): RelationshipAnchor {
  const completed = lastCommittedWeek(state);
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, completedRounds: ordinal(state.seasonNumber, completed, seasonRounds(state)), contractCount: state.employment.contracts.length, rosterCount: state.rosters.length };
}
/** New careers pass `relationships-2`; enabling squad dynamics in an older career keeps the original rules. */
export function enableRelationships(state: SeasonState, model: RelationshipsModel = 'relationships-1'): SeasonState {
  if (state.relationships.enabledSince) return state;
  return { ...state, relationships: { ...createRelationships(), model, enabledSince: relationshipEventAnchor(state), ...(model === 'relationships-2' ? { squadRanks: {} } : {}) } };
}
export function relationshipsAtEventCount(relationships: SeasonRelationships, eventCount: number): SeasonRelationships {
  if (!Number.isInteger(eventCount) || eventCount < 0 || eventCount > relationships.events.length) throw new Error('Choose an existing player-relationship history prefix.');
  return { ...relationships, events: relationships.events.slice(0, eventCount) };
}

function seasons(state: SeasonState) { return [...state.history, { seasonNumber: state.seasonNumber, rosters: state.rosters, fixtures: state.fixtures }]; }
function registeredPlayer(state: SeasonState, clubId: string, playerId: string): Player | undefined {
  return state.clubs.find(club => club.id === clubId)?.players.find(player => player.id === playerId);
}
function historicalPlayer(state: SeasonState, clubId: string, playerId: string): Player | undefined {
  const current = registeredPlayer(state, clubId, playerId);
  if (current) return current;
  for (const season of seasons(state).reverse()) for (const roster of [...season.rosters].reverse()) if (roster.clubId === clubId) {
    const player = roster.players.find(player => player.id === playerId);
    if (player) return player;
  }
  return undefined;
}
/**
 * One calculation's historical sporting evidence, shared across its squad. Never retained across calls: a later
 * import, edited fixture, club move or rivalry change must be read afresh. Keep each season's existing roster
 * ordering and rosterForRound lookup rather than assuming journals are already sorted or validated.
 */
function clubHistory(state: SeasonState, clubId: string) {
  const records = seasons(state), rounds = seasonRounds(state);
  const personal = new Map<string, PlayerEvent[]>(), contracts = new Map<string, ContractEvent[]>();
  for (const event of state.relationships.events) if (playerEvent(event) && event.clubId === clubId) {
    const events = personal.get(event.playerId) ?? [];
    events.push(event); personal.set(event.playerId, events);
  } else if (contractEvent(event) && event.clubId === clubId) {
    const events = contracts.get(event.playerId) ?? [];
    events.push(event); contracts.set(event.playerId, events);
  }
  const memberships = records.flatMap(season => season.rosters.filter(roster => roster.clubId === clubId).sort((a, b) => a.fromRound - b.fromRound)
    .map(roster => ({ at: ordinal(season.seasonNumber, roster.fromRound, rounds), id: roster.id, players: new Set(roster.players.map(player => player.id)) })));
  const ranks = state.relationships.squadRanks ?? {};
  const now = ordinal(state.seasonNumber, state.round, rounds);
  const visibleFixtures = () => records.flatMap(season => season.fixtures
    .filter(fixture => fixture.result && fixture.date <= state.date && (fixture.homeClubId === clubId || fixture.awayClubId === clubId))
    .map(fixture => ({ fixture, seasonNumber: season.seasonNumber, at: ordinal(season.seasonNumber, fixture.round, rounds),
      players: new Set(rosterForRound(season.rosters, clubId, fixture.round).players.map(player => player.id)), derby: undefined as boolean | undefined })))
    .sort((a, b) => a.at - b.at || compareText(a.fixture.id, b.fixture.id));
  // Disabled relationships still need registration stints, but must not inspect unrelated match results.
  let fixtures: ReturnType<typeof visibleFixtures> | undefined;
  return {
    eventsFor(playerId: string): readonly PlayerEvent[] { return personal.get(playerId) ?? []; },
    contractEventsFor(playerId: string): readonly ContractEvent[] { return contracts.get(playerId) ?? []; },
    /**
     * `relationships-2`: the default role from the squad rank recorded for the registration in force at `through`,
     * and when this stint's default last changed (unranked registrations keep the original Rotation default).
     */
    defaultRole(playerId: string, start: number, through = now): { role: SquadRole; since: number; rank: number | null } {
      const roleOf = (roster: (typeof memberships)[number]) => {
        const order = ranks[roster.id], index = order ? order.indexOf(playerId) : -1;
        return { role: (index < 0 || index < RELATIONSHIP_RULES.defaultRoles.rotationMaxRank ? 'rotation' : 'development') as SquadRole, rank: index < 0 ? null : index + 1 };
      };
      const stint = memberships.filter(roster => roster.at >= start && roster.at <= through && roster.players.has(playerId));
      const current = stint.at(-1);
      if (!current) return { role: 'rotation', since: start, rank: null };
      const { role, rank } = roleOf(current);
      let since = current.at;
      for (let index = stint.length - 2; index >= 0 && roleOf(stint[index]!).role === role; index -= 1) since = stint[index]!.at;
      return { role, since, rank };
    },
    stintStart(playerId: string, through = Infinity): number {
      let present = false, from = 1;
      for (const roster of memberships) {
        if (roster.at > through) continue;
        const next = roster.players.has(playerId);
        if (next && !present) from = roster.at;
        present = next;
      }
      return from;
    },
    gamesFor(playerId: string, window: EvidenceWindow): EvidenceGame[] {
      fixtures ??= visibleFixtures();
      const games: EvidenceGame[] = [];
      // Fixtures are sorted once for this calculation. Seek the requested interval and stop after enough
      // eligible evidence; a four-game form check need not materialize a player's entire career.
      const start = afterRoundIndex(fixtures, window.after), end = afterRoundIndex(fixtures, window.through ?? Infinity);
      for (let index = window.first ? start : end - 1; index >= start && index < end && games.length < window.limit; index += window.first ? 1 : -1) {
        const game = fixtures[index]!;
        if (!game.players.has(playerId)) continue;
        const fixture = game.fixture, result = fixture.result!, stats = fixturePlayerEvidence(fixture, playerId);
        const recoveringOutsideSquad = result.selection && Object.hasOwn(result.selection.rested, playerId) && state.injuries.some(injury => injury.playerId === playerId && isRecovering(injury, fixture.date, state.physio));
        const eligible = !!stats && result.kind === 'normal' && !result.injuries[playerId] && !recoveringOutsideSquad && stats.fouls < 5;
        if (window.eligibleOnly && !eligible || window.beforeDate && fixture.date >= window.beforeDate) continue;
        game.derby ??= !!governingDerby(state.rivalries, fixture.homeClubId, fixture.awayClubId, game.seasonNumber, fixture.round, worldOf(state));
        games.push({ at: game.at, id: fixture.id, date: fixture.date, eligible,
          minutes: stats ? stats.secondsPlayed / 60 : 0, won: result.winnerClubId === clubId, derby: game.derby });
      }
      // Preserve chronological evidence and floating-point accumulation order even when seeking backwards.
      return window.first ? games : games.reverse();
    },
    departureDate(playerId: string, after: number): string | null {
      let date: string | null = null;
      for (const roster of memberships) if (roster.at > after && !roster.players.has(playerId)) {
        const candidate = dateAt(roster.at, rounds);
        if (!date || candidate < date) date = candidate;
      }
      const retirement = getPlayerRetirement(state, playerId);
      if (retirement.status === 'retired' && retirement.notice && (!date || retirement.notice.retiredOn < date)) date = retirement.notice.retiredOn;
      return date;
    },
  };
}
type ClubHistory = ReturnType<typeof clubHistory>;
function roleAt(state: SeasonState, events: readonly PlayerEvent[], start: number, history: ClubHistory, playerId: string): { role: SquadRole; after: number; rank: number | null } {
  const event = events.filter((event): event is Extract<RelationshipEvent, { type: 'role' }> => event.type === 'role' && ordinal(event.seasonNumber, event.round, seasonRounds(state)) >= start).at(-1);
  const enabled = state.relationships.enabledSince?.completedRounds ?? 0;
  if (event || !ranked(state)) return { role: event?.role ?? 'rotation', after: Math.max(enabled, start - 1, event ? ordinal(event.seasonNumber, event.round, seasonRounds(state)) : 0), rank: null };
  // A changed default starts a fresh evidence window, as an agreed role change does.
  const fallback = history.defaultRole(playerId, start);
  return { role: fallback.role, after: Math.max(enabled, start - 1, fallback.since - 1), rank: fallback.rank };
}
/** The role a player had before an agreed change at `at`: the latest earlier agreement in the stint, else the default then. */
function priorRole(state: SeasonState, history: ClubHistory, playerId: string, earlier: readonly PlayerEvent[], startOfStint: number, at: number): SquadRole {
  const agreed = earlier.filter((item): item is Extract<RelationshipEvent, { type: 'role' }> => item.type === 'role' && ordinal(item.seasonNumber, item.round, seasonRounds(state)) >= startOfStint).at(-1)?.role;
  return agreed ?? (ranked(state) ? history.defaultRole(playerId, startOfStint, at).role : 'rotation');
}
interface EvidenceGame { at: number; id: string; date: string; eligible: boolean; minutes: number; won: boolean; derby: boolean }
interface EvidenceWindow { after: number; through?: number; beforeDate?: string | null; eligibleOnly?: boolean; limit: number; first?: boolean }
/** First entry strictly after a round; callers retain the fixture-id ordering within a tied round. */
function afterRoundIndex(games: readonly { at: number }[], at: number): number {
  let low = 0, high = games.length;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (games[middle]!.at <= at) low = middle + 1; else high = middle; }
  return low;
}
function promiseFor(state: SeasonState, event: Extract<RelationshipEvent, { type: 'talk' }>, history: ClubHistory): PlayingTimePromise {
  const start = ordinal(event.seasonNumber, event.round, seasonRounds(state)), deadlineRound = start + PROMISE_DEADLINE_GAMES;
  const personal = history.eventsFor(event.playerId), prefix = personal.slice(0, personal.indexOf(event));
  const startOfStint = history.stintStart(event.playerId, start);
  // The agreed role at creation is frozen, even if the player later leaves or returns.
  const targetMinutes = SQUAD_ROLE_DEFINITIONS[priorRole(state, history, event.playerId, prefix.filter(item => item.clubId === event.clubId && item.playerId === event.playerId), startOfStint, start)].minMinutes;
  const departure = history.departureDate(event.playerId, start);
  const eligible = history.gamesFor(event.playerId, { after: start, through: deadlineRound, beforeDate: departure, eligibleOnly: true, limit: PROMISE_ELIGIBLE_GAMES, first: true });
  const average = eligible.length ? eligible.reduce((sum, game) => sum + game.minutes, 0) / eligible.length : null;
  const deadlineDate = dateAt(deadlineRound, seasonRounds(state));
  const expired = relationshipEventAnchor(state).completedRounds >= deadlineRound;
  let status: PlayingTimePromise['status'] = 'active', outcomeDate: string | null = null;
  if (eligible.length === PROMISE_ELIGIBLE_GAMES) { status = average! + 1e-9 >= targetMinutes ? 'kept' : 'broken'; outcomeDate = eligible.at(-1)!.date; }
  else if (departure && departure <= state.date && (!expired || departure <= deadlineDate)) { status = 'departed'; outcomeDate = departure; }
  else if (expired) { status = 'unresolved'; outcomeDate = deadlineDate; }
  return { id: event.id, status, targetMinutes, eligibleGames: eligible.length, averageMinutes: average === null ? null : rounded(average), remainingGames: Math.max(0, PROMISE_ELIGIBLE_GAMES - eligible.length), remainingClubGames: clamp(deadlineRound - relationshipEventAnchor(state).completedRounds, 0, PROMISE_DEADLINE_GAMES), deadlineDate, deadlineRound, outcomeDate, fixtureIds: eligible.map(game => game.id) };
}
const decayed = (impact: number, from: string, to: string, halfLife = 42) => impact * 2 ** (-Math.max(0, (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) / halfLife);

export function getPlayerRelationship(state: SeasonState, playerId: string, clubId = state.managedClubId): PlayerRelationship {
  return playerRelationship(state, playerId, clubId, clubHistory(state, clubId));
}
function playerRelationship(state: SeasonState, playerId: string, clubId: string, evidenceHistory: ClubHistory): PlayerRelationship {
  const player = historicalPlayer(state, clubId, playerId);
  if (!player) throw new Error('Choose a player with a recorded registration at this club.');
  const currentStint = evidenceHistory.stintStart(playerId);
  const events = evidenceHistory.eventsFor(playerId);
  const role = roleAt(state, events, currentStint, evidenceHistory, playerId), definition = SQUAD_ROLE_DEFINITIONS[role.role];
  const evidence = state.relationships.enabledSince ? evidenceHistory.gamesFor(playerId, { after: role.after, eligibleOnly: true, limit: 4 }) : [];
  const average = evidence.length ? evidence.reduce((sum, game) => sum + game.minutes, 0) / evidence.length : null;
  const concern = evidence.length >= 3 && average! + 1e-9 < definition.minMinutes ? `Playing time below the agreed ${definition.label.toLowerCase()} role` : null;
  const personal = state.relationships.enabledSince ? events : [];
  const promises = personal.filter((event): event is Extract<RelationshipEvent, { type: 'talk' }> => event.type === 'talk' && event.choice === 'minutes-promise').map(event => promiseFor(state, event, evidenceHistory));
  let conversationImpact = 0, promiseImpact = 0;
  for (const event of personal) {
    if (event.type === 'talk' && event.choice === 'explain') conversationImpact += decayed(2, event.date, state.date, 21);
    if (event.type === 'role') {
      const at = ordinal(event.seasonNumber, event.round, seasonRounds(state)), startOfStint = evidenceHistory.stintStart(playerId, at);
      const before = priorRole(state, evidenceHistory, playerId, personal.slice(0, personal.indexOf(event)), startOfStint, at);
      if (SQUAD_ROLE_DEFINITIONS[event.role].minMinutes < SQUAD_ROLE_DEFINITIONS[before].minMinutes) conversationImpact += decayed(-4, event.date, state.date);
    }
  }
  for (const promise of promises) if (promise.outcomeDate && ['kept', 'broken'].includes(promise.status)) promiseImpact += decayed(promise.status === 'kept' ? 10 : -15, promise.outcomeDate, state.date);
  conversationImpact = clamp(conversationImpact, -8, 8); promiseImpact = clamp(promiseImpact, -20, 10);
  // relationships-2: contract requests and their outcomes, each fading from its outcome date and bounded together.
  const requests = ranked(state) && state.relationships.enabledSince ? contractRequestsFromEvents(state, evidenceHistory.contractEventsFor(playerId)) : [];
  let contractMorale = 0, contractTrust = 0;
  for (const request of requests) {
    const effect = CONTRACT_RULES.effects[request.status];
    if (!effect || !request.outcomeDate) continue;
    contractMorale += decayed(effect.morale, request.outcomeDate, state.date, CONTRACT_RULES.halfLifeDays);
    contractTrust += decayed(effect.trust, request.outcomeDate, state.date, CONTRACT_RULES.halfLifeDays);
  }
  contractMorale = clamp(contractMorale, CONTRACT_RULES.bounds.morale.min, CONTRACT_RULES.bounds.morale.max);
  contractTrust = clamp(contractTrust, CONTRACT_RULES.bounds.trust.min, CONTRACT_RULES.bounds.trust.max);
  const trust = Math.round(clamp(50 + conversationImpact + promiseImpact + contractTrust, 0, 100));
  const roleImpact = evidence.length < 3 ? 0 : concern ? -Math.min(15, Math.max(3, (definition.minMinutes - average!) * 1.5)) : definition.minMinutes > 0 ? 6 : 0;
  const recent = state.relationships.enabledSince ? evidenceHistory.gamesFor(playerId, { after: Math.max(state.relationships.enabledSince.completedRounds, currentStint - 1), limit: 4 }) : [];
  const resultImpact = recent.length >= 3 ? clamp(recent.reduce((sum, game) => sum + decayed((game.won ? 2 : -2) * (game.derby ? RIVALRY_MORALE_WEIGHT : 1), game.date, state.date, 21), 0), -6, 6) : 0;
  const reasons = [
    { label: concern ?? (evidence.length < 3 ? 'Building playing-time evidence' : definition.minMinutes > 0 ? 'Agreed playing time met' : 'Reserve role accepted'), impact: Math.round(roleImpact) },
    { label: 'Recent team results', impact: Math.round(resultImpact) },
    { label: 'Manager conversations', impact: Math.round(conversationImpact) },
    { label: 'Playing-time promises', impact: Math.round(promiseImpact) },
  ];
  const press = state.relationships.enabledSince ? pressImpact(state, clubId, playerId) : { impact: 0, mentioned: false };
  if (press.mentioned) reasons.push({ label: 'Press comments', impact: Math.round(press.impact) });
  if (requests.length) reasons.push({ label: 'Contract talks', impact: Math.round(contractMorale) });
  const morale = Math.round(clamp(50 + roleImpact + resultImpact + conversationImpact + promiseImpact + press.impact + contractMorale, 0, 100));
  const promise = promises.find(promise => promise.status === 'active') ?? null;
  const latest = personal.at(-1), completedRounds = relationshipEventAnchor(state).completedRounds;
  let talkReason: string | null = null;
  if (!state.relationships.enabledSince) talkReason = 'Enable squad relationships first.';
  else if (!registeredPlayer(state, clubId, playerId)) talkReason = 'This player is no longer registered at the club.';
  else if (state.status !== 'active') talkReason = 'Start the next season before making a new playing-time commitment.';
  else if (getPlayerRetirement(state, playerId).status === 'retired') talkReason = 'This player has retired.';
  else if (promise) talkReason = 'Review the active playing-time promise before starting another conversation.';
  else if (latest && completedRounds - latest.completedRounds < RELATIONSHIP_COOLDOWN_GAMES) talkReason = `Allow ${RELATIONSHIP_COOLDOWN_GAMES - (completedRounds - latest.completedRounds)} more completed club games before another role conversation.`;
  const history = personal.map(event => ({ id: event.id, date: event.date, label: event.type === 'role' ? `${SQUAD_ROLE_DEFINITIONS[event.role].label} role agreed` : event.choice === 'explain' ? 'Competition explained' : 'Playing time promised', detail: event.type === 'role' ? `Future expectation: ${SQUAD_ROLE_DEFINITIONS[event.role].minMinutes}–${SQUAD_ROLE_DEFINITIONS[event.role].maxMinutes} minutes per eligible game.` : event.choice === 'explain' ? 'The player was heard; the agreed playing-time role remains.' : 'Meet the agreed minimum across the next three eligible games after this matchday, within six club games.' }));
  for (const item of promises) if (item.outcomeDate) history.push({ id: `${item.id}-outcome`, date: item.outcomeDate, label: item.status === 'kept' ? 'Playing-time promise kept' : item.status === 'broken' ? 'Playing-time promise broken' : item.status === 'departed' ? 'Promise closed after departure' : 'Promise closed without enough eligible games', detail: item.status === 'kept' || item.status === 'broken' ? `${item.averageMinutes} minutes per eligible game; ${item.targetMinutes} promised.` : 'No promise penalty was applied.' });
  for (const event of state.relationships.events) if (event.type === 'press' && event.clubId === clubId && event.playerIds.includes(playerId)) {
    const value = Math.round(pressMoraleValue(event, playerId) * 10) / 10;
    history.push({ id: event.id, date: event.date, label: `Press: ${pressAnswerLabel(event).toLowerCase()}`, detail: value === 0 ? 'No morale change.' : `${value > 0 ? '+' : ''}${value} morale, fading over the following weeks.` });
  }
  for (const request of requests) history.push(...contractRequestHistory(request));
  history.sort((a, b) => compareText(b.date, a.date) || compareText(b.id, a.id));
  const row: PlayerRelationship = { player, clubId, role: role.role, roleLabel: definition.label, minMinutes: definition.minMinutes, maxMinutes: definition.maxMinutes, morale, trust, moraleLabel: morale >= 65 ? 'Positive' : morale >= 45 ? 'Settled' : morale >= 30 ? 'Concerned' : 'Unsettled', eligibleGames: evidence.length, averageMinutes: average === null ? null : rounded(average), evidenceFixtureIds: evidence.map(game => game.id), concern, reasons, promise, promises, history, canTalk: talkReason === null, talkReason };
  return ranked(state) ? { ...row, squadRank: role.rank, contractRequest: requests.at(-1) ?? null, contractRequests: requests } : row;
}

const REPLY_TEXT: Record<ContractRequestReply, string> = { talks: 'Renewal talks opened', promise: 'Talks promised at season end', decline: 'Contract request declined' };
const OUTCOME_TEXT: Partial<Record<ContractRequest['status'], { label: string; detail: (request: ContractRequest) => string }>> = {
  ignored: { label: 'Contract request ignored', detail: () => `No answer within ${TEXT.replyWindow}: ${TEXT.cost('ignored')}, fading over time; ${TEXT.premium('ignored')}.` },
  lapsed: { label: 'Renewal talks went nowhere', detail: () => `No offer followed within ${TEXT.talksWindow}: ${TEXT.cost('lapsed')}, fading over time; ${TEXT.premium('lapsed')}.` },
  broken: { label: 'Promised contract talks never happened', detail: () => `No offer before the next season: ${TEXT.cost('broken')}, fading over time; ${TEXT.premium('broken')}.` },
  kept: { label: 'Contract talks held', detail: request => request.reply === 'promise' ? 'The promised offer was made.' : 'An offer followed the request.' },
  renewed: { label: 'New contract agreed', detail: () => 'The renewal settled his request and restored morale and trust.' },
};
function contractRequestHistory(request: ContractRequest): PlayerRelationship['history'] {
  const entries: PlayerRelationship['history'] = [{ id: request.id, date: request.date, label: 'Asked about a new contract', detail: request.trigger === 'interest' ? 'Another club has shown interest in him; his contract ends this season.' : 'His contract ends this season and he wants to know his future.' }];
  if (request.reply && request.repliedOn) entries.push({ id: `${request.id}-reply`, date: request.repliedOn, label: REPLY_TEXT[request.reply], detail: request.reply === 'decline' ? `He was told the club will not renew: ${TEXT.cost('declined')}, fading over time; ${TEXT.premium('declined')}.` : request.reply === 'talks' ? `An offer is expected within ${TEXT.talksWindow}.` : 'An offer is expected before the next season starts.' });
  const outcome = OUTCOME_TEXT[request.status];
  if (outcome && request.outcomeDate) entries.push({ id: `${request.id}-outcome`, date: request.outcomeDate, label: outcome.label, detail: outcome.detail(request) });
  return entries;
}

export function getSquadRelationships(state: SeasonState, clubId = state.managedClubId): PlayerRelationship[] {
  const club = state.clubs.find(club => club.id === clubId);
  if (!club) throw new Error('Choose a club in this career.');
  const history = clubHistory(state, clubId);
  return club.players.map(player => playerRelationship(state, player.id, clubId, history));
}
export function quoteSquadRole(state: SeasonState, playerId: string, role: SquadRole, clubId = state.managedClubId): RoleAgreementQuote {
  if (!SQUAD_ROLES.includes(role)) throw new Error('Choose Reserve, Rotation or Starter.');
  const current = getPlayerRelationship(state, playerId, clubId), definition = SQUAD_ROLE_DEFINITIONS[role];
  const currentMinimum = getSquadRelationships(state, clubId).reduce((sum, row) => sum + row.minMinutes, 0);
  const totalMinimum = currentMinimum - current.minMinutes + definition.minMinutes;
  const lower = definition.minMinutes < current.minMinutes;
  let reason = current.talkReason;
  if (!reason && role === current.role) reason = 'This playing-time role is already agreed.';
  if (!reason && totalMinimum > 200 && totalMinimum >= currentMinimum) reason = 'The squad cannot promise more than 200 regulation minutes per game.';
  if (!reason && definition.minMinutes > current.minMinutes && current.concern) reason = 'Resolve the existing playing-time concern before making a larger commitment.';
  if (!reason && lower && !current.concern && currentMinimum <= 200) reason = 'A lower role can be discussed when actual playing time has created a concern or new arrivals leave the squad overcommitted.';
  if (!reason && lower && current.trust < 35) reason = 'The player does not currently trust another reduced commitment.';
  return { role, roleLabel: definition.label, minMinutes: definition.minMinutes, maxMinutes: definition.maxMinutes, totalMinimum, trustChange: lower ? -4 : 0, effectiveFrom: dateAt(ordinal(state.seasonNumber, state.round, seasonRounds(state)) + 1, seasonRounds(state)), canAgree: reason === null, reason };
}
export function quoteRelationshipTalk(state: SeasonState, playerId: string, choice: RelationshipTalk, clubId = state.managedClubId): RelationshipTalkQuote {
  if (!['explain', 'minutes-promise'].includes(choice)) throw new Error('Choose a supported player conversation.');
  const current = getPlayerRelationship(state, playerId, clubId);
  let reason = current.talkReason;
  if (!reason && !current.concern) reason = 'There is no unresolved playing-time concern to discuss.';
  const promise = choice === 'minutes-promise';
  return { choice, title: promise ? 'Promise more playing time' : 'Explain competition for places', detail: promise ? `Average at least ${current.minMinutes} minutes over the next 3 eligible games after this matchday, within 6 club games. Injuries, disqualifications and default results do not count. Keeping the promise adds 10 trust; breaking it costs 15. Too few eligible games closes it without penalty.` : 'Acknowledge the concern and explain competition. This adds 2 trust, fading with time; the agreed role and playing-time concern remain.', trustChange: promise ? 0 : 2, targetMinutes: current.minMinutes, deadlineDate: dateAt(ordinal(state.seasonNumber, state.round, seasonRounds(state)) + PROMISE_DEADLINE_GAMES, seasonRounds(state)), canTalk: reason === null, reason };
}

export function applyRelationshipEvent(state: SeasonState, event: RelationshipEvent): SeasonState {
  if (!state.relationships.enabledSince) throw new Error('Enable squad relationships before making a player commitment.');
  const anchor = relationshipEventAnchor(state);
  for (const key of Object.keys(anchor) as (keyof RelationshipAnchor)[]) if (anchor[key] !== event[key]) throw new Error('Retain the exact calendar, result, contract and registration boundary for player relationships.');
  if (event.id !== `relationship-event-${state.relationships.events.length + 1}`) throw new Error('Player-relationship events must retain sequential identities.');
  if (event.type === 'role') {
    const quote = quoteSquadRole(state, event.playerId, event.role, event.clubId);
    if (!quote.canAgree) throw new Error(quote.reason!);
  } else if (event.type === 'talk') {
    const quote = quoteRelationshipTalk(state, event.playerId, event.choice, event.clubId);
    if (!quote.canTalk) throw new Error(quote.reason!);
  } else if (event.type === 'press') {
    const question = getPressQuestion(state);
    if (!question || question.clubId !== event.clubId) throw new Error('There is no open press question for this club.');
    if (question.answered) throw new Error('This press question has already been answered.');
    if (event.topic !== question.topic || event.triggerRound !== question.triggerRound || !question.answers.includes(event.answer)) throw new Error('Choose one of the answers offered for this press question.');
    const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);
    if (!same(event.playerIds, question.playerIds) || !same(event.coreIds, question.coreIds) || !pressEventMatches(event, question)) throw new Error('Record exactly the squad and regulars the press question addressed.');
  } else if (event.type === 'prepare') {
    if (state.status !== 'active' || anchor.completedRounds !== ordinal(state.seasonNumber, state.round, seasonRounds(state)) - 1) throw new Error('Freeze morale only before a new uncommitted matchday.');
    if (state.relationships.events.some(item => item.type === 'prepare' && item.seasonNumber === state.seasonNumber && item.round === state.round)) throw new Error('This matchday already has frozen morale.');
    const expected = preparationValues(state);
    const sameMap = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && a[key] === b[key]);
    if (!sameMap(event.rosterIds, expected.rosterIds) || !sameMap(event.values, expected.values)) throw new Error('Freeze exact registered-player morale before the matchday.');
  } else if (event.type === 'contract-request') {
    if (event.negotiationCount !== state.negotiations.records.length) throw new Error('Record a contract request at its exact place among contract offers.');
    const check = contractRequestCheck(state, event.clubId, event.playerId);
    if (check.reason) throw new Error(check.reason);
    if (!check.triggers.includes(event.trigger)) throw new Error('Record why the player asked: the middle of the season, or another club\'s interest.');
  } else if (event.type === 'contract-reply') {
    if (event.negotiationCount !== state.negotiations.records.length) throw new Error('Record a contract reply at its exact place among contract offers.');
    const quote = quoteContractReply(state, event.playerId, event.reply, event.clubId);
    if (!quote.canReply) throw new Error(quote.reason!);
    if (quote.requestId !== event.requestId) throw new Error('Answer the player\'s open contract request.');
  } else throw new Error('Choose a supported player-relationship command.');
  return { ...state, relationships: { ...state.relationships, events: [...state.relationships.events, structuredClone(event)] } };
}
function eventId(state: SeasonState) { return `relationship-event-${state.relationships.events.length + 1}`; }
export function agreeSquadRole(state: SeasonState, playerId: string, role: SquadRole, clubId = state.managedClubId): SeasonState {
  return applyRelationshipEvent(state, { ...relationshipEventAnchor(state), id: eventId(state), type: 'role', clubId, playerId, role });
}
export function talkToPlayer(state: SeasonState, playerId: string, choice: RelationshipTalk, clubId = state.managedClubId): SeasonState {
  return applyRelationshipEvent(state, { ...relationshipEventAnchor(state), id: eventId(state), type: 'talk', clubId, playerId, choice });
}
/** The manager answers the open press question; ignoring it leaves the routine answer with no effect. */
export function answerPress(state: SeasonState, answer: PressAnswer): SeasonState {
  const question = getPressQuestion(state);
  if (!question) throw new Error('There is no open press question.');
  return applyRelationshipEvent(state, { ...relationshipEventAnchor(state), id: eventId(state), type: 'press', clubId: question.clubId, topic: question.topic, triggerRound: question.triggerRound, answer, playerIds: question.playerIds, coreIds: question.coreIds, ...pressEventFields(question) });
}
function preparationValues(state: SeasonState): { rosterIds: Record<string, string>; values: Record<string, number> } {
  return { rosterIds: Object.fromEntries(state.clubs.map(club => [club.id, rosterForRound(state.rosters, club.id, state.round).id])), values: Object.fromEntries(state.clubs.flatMap(club => getSquadRelationships(state, club.id).map(row => [row.player.id, row.morale]))) };
}
/**
 * `relationships-2`: record each newly registered squad's order by the players' current overall ratings (best first),
 * once per registration snapshot. Default roles read this record, so saves replay them without today's ratings.
 */
function rankSquads(state: SeasonState): SeasonState {
  if (!ranked(state) || !state.relationships.enabledSince) return state;
  const ranks = state.relationships.squadRanks ?? {}, added: Record<string, string[]> = {};
  for (const club of state.clubs) {
    const roster = rosterForRound(state.rosters, club.id, state.round);
    if (Object.hasOwn(ranks, roster.id)) continue;
    const rating = new Map(roster.players.map(player => [player.id, overallRating(scoutingActualAttributes(state, player.id), player.position)]));
    added[roster.id] = roster.players.map(player => player.id).sort((a, b) => rating.get(b)! - rating.get(a)! || compareText(a, b));
  }
  return Object.keys(added).length ? { ...state, relationships: { ...state.relationships, squadRanks: { ...ranks, ...added } } } : state;
}
export function prepareRelationshipsRound(state: SeasonState): SeasonState {
  if (!state.relationships.enabledSince) return state;
  const next = rankSquads(state);
  if (next.relationships.events.some(event => event.type === 'prepare' && event.seasonNumber === next.seasonNumber && event.round === next.round)) return next;
  return applyRelationshipEvent(next, { ...relationshipEventAnchor(next), id: eventId(next), type: 'prepare', ...preparationValues(next) });
}
/** `relationships-2`: a player's rank in his club's registered squad now (1 = best), or null when unranked. */
export function getSquadRank(state: SeasonState, playerId: string, clubId = state.managedClubId): number | null {
  if (!ranked(state)) return null;
  const order = state.relationships.squadRanks?.[rosterForRound(state.rosters, clubId, state.round).id];
  const index = order ? order.indexOf(playerId) : -1;
  return index < 0 ? null : index + 1;
}

type ContractMaps = { now: Map<string, NonNullable<ReturnType<typeof contractForSeason>>>; next: Set<string> };
function contractMaps(state: SeasonState): ContractMaps {
  // The registration in force at this matchday: a later sale must not rewrite an earlier request when saves replay it.
  return { now: new Map(effectiveContractsForRound(state.employment, state.seasonNumber, state.round).map(contract => [contract.playerId, contract])), next: new Set(effectiveContractsForSeason(state.employment, state.seasonNumber + 1).map(contract => contract.playerId)) };
}
/**
 * Whether a registered player may ask his club about a new contract now (`relationships-2`), and why: he is in the
 * final season of his contract with no next-season agreement, has not asked this season, the middle of the season
 * has passed or another club has proposed a transfer, a full reply window remains, and he is valued.
 */
function contractRequestCheck(state: SeasonState, clubId: string, playerId: string, history = clubHistory(state, clubId), maps = contractMaps(state)): { reason: string | null; triggers: ContractRequestTrigger[]; rank: number | null } {
  const fail = (reason: string) => ({ reason, triggers: [] as ContractRequestTrigger[], rank: null });
  if (!ranked(state) || !state.relationships.enabledSince) return fail('Contract requests belong to the current squad dynamics rules.');
  if (state.status !== 'active') return fail('Players ask about new contracts during the season.');
  const rounds = seasonRounds(state);
  if (state.round + CONTRACT_RULES.replyRounds > rounds) return fail('Too little of the season remains for a contract request.');
  if (!registeredPlayer(state, clubId, playerId)) return fail('Only a registered player asks his club about a new contract.');
  const contract = maps.now.get(playerId);
  if (!contract || contract.clubId !== clubId || contract.endsSeason !== state.seasonNumber) return fail('Only players in the final season of their contract ask about a new one.');
  if (maps.next.has(playerId)) return fail('This player already has a contract for next season.');
  if (getPlayerRetirement(state, playerId).status !== 'active') return fail('This player is retiring.');
  if (history.contractEventsFor(playerId).some(event => event.type === 'contract-request' && event.seasonNumber === state.seasonNumber)) return fail('This player has already asked this season.');
  const triggers: ContractRequestTrigger[] = [];
  if (CONTRACT_RULES.interestTrigger && (state.recruitment?.offers ?? []).some(offer => offer.seasonNumber === state.seasonNumber && offer.playerId === playerId && offer.clubId !== clubId && offer.transfer?.sellerClubId === clubId && offer.offeredOn <= state.date)) triggers.push('interest');
  if (state.round - 1 >= Math.ceil(rounds * CONTRACT_RULES.fromSeasonShare)) triggers.push('mid-season');
  if (!triggers.length) return fail('Players ask from the middle of the season, or once another club shows interest.');
  const rank = getSquadRank(state, playerId, clubId);
  const valued = CONTRACT_RULES.valued;
  let isValued = rank !== null && rank <= valued.maxRank;
  if (!isValued) {
    const games = history.gamesFor(playerId, { after: Math.max(state.relationships.enabledSince.completedRounds, history.stintStart(playerId) - 1), eligibleOnly: true, limit: 4 });
    isValued = games.length >= 3 && games.reduce((sum, game) => sum + game.minutes, 0) / games.length + 1e-9 >= valued.minMinutes;
  }
  if (!isValued) isValued = (getPreparedRelationshipMorale(state)?.values[playerId] ?? 0) >= valued.minMorale;
  if (!isValued) return fail('Only valued players ask: a high squad rank, regular minutes or good morale.');
  return { reason: null, triggers, rank };
}
/** Players who would ask their club about a new contract now: another club's interest first, then the best-ranked. */
export function getContractRequestCandidates(state: SeasonState, clubId: string, maps?: ContractMaps): { playerId: string; trigger: ContractRequestTrigger; rank: number | null }[] {
  const club = state.clubs.find(club => club.id === clubId);
  if (!club || !ranked(state) || !state.relationships.enabledSince || state.status !== 'active' || state.round + CONTRACT_RULES.replyRounds > seasonRounds(state)) return [];
  maps ??= contractMaps(state);
  // Cheap filters first: before the middle of the season only players another club wants can ask.
  const midSeason = state.round - 1 >= Math.ceil(seasonRounds(state) * CONTRACT_RULES.fromSeasonShare);
  const wanted = midSeason || !CONTRACT_RULES.interestTrigger ? null : new Set((state.recruitment?.offers ?? []).filter(offer => offer.seasonNumber === state.seasonNumber && offer.transfer?.sellerClubId === clubId && offer.offeredOn <= state.date).map(offer => offer.playerId));
  const expiring = club.players.filter(player => { const contract = maps.now.get(player.id); return contract?.clubId === clubId && contract.endsSeason === state.seasonNumber && !maps.next.has(player.id) && (!wanted || wanted.has(player.id)); });
  if (!expiring.length) return [];
  const history = clubHistory(state, clubId);
  return expiring.flatMap(player => { const check = contractRequestCheck(state, clubId, player.id, history, maps); return check.reason ? [] : [{ playerId: player.id, trigger: check.triggers[0]!, rank: check.rank }]; })
    .sort((a, b) => Number(b.trigger === 'interest') - Number(a.trigger === 'interest') || (a.rank ?? Infinity) - (b.rank ?? Infinity) || compareText(a.playerId, b.playerId));
}
/** At a matchday boundary, valued final-year players at every club ask about new contracts (a few per club at a time). */
export function raiseContractRequests(state: SeasonState): SeasonState {
  if (!ranked(state) || !state.relationships.enabledSince || state.status !== 'active' || state.round + CONTRACT_RULES.replyRounds > seasonRounds(state)) return state;
  // Requests never sign contracts, so this matchday's registrations hold for every club.
  let next = state;
  const maps = contractMaps(state);
  for (const club of state.clubs) for (const candidate of getContractRequestCandidates(next, club.id, maps).slice(0, CONTRACT_RULES.maxNewPerClubRound)) {
    next = applyRelationshipEvent(next, { ...relationshipEventAnchor(next), id: eventId(next), type: 'contract-request', clubId: club.id, playerId: candidate.playerId, trigger: candidate.trigger, negotiationCount: next.negotiations.records.length });
  }
  return next;
}
/** The latest contract request of a player at a club, with its current outcome. */
export function getContractRequest(state: SeasonState, playerId: string, clubId = state.managedClubId): ContractRequest | null {
  if (!ranked(state) || !state.relationships.enabledSince) return null;
  return contractRequestsFromEvents(state, state.relationships.events.filter(event => contractEvent(event) && event.clubId === clubId && event.playerId === playerId)).at(-1) ?? null;
}
/** Every request at a club with its current outcome, in journal order per player: the inbox and AI clubs read this. */
export function getClubContractRequests(state: SeasonState, clubId = state.managedClubId, seasonNumber?: number): ContractRequest[] {
  if (!ranked(state) || !state.relationships.enabledSince) return [];
  const byPlayer = new Map<string, RelationshipEvent[]>();
  for (const event of state.relationships.events) if (contractEvent(event) && event.clubId === clubId && (seasonNumber === undefined || event.seasonNumber === seasonNumber)) { const list = byPlayer.get(event.playerId) ?? []; list.push(event); byPlayer.set(event.playerId, list); }
  return [...byPlayer.values()].flatMap(events => contractRequestsFromEvents(state, events));
}
/** This season's requests at every club with their current outcome, read in one pass from the end of the journal. */
export function getSeasonContractRequests(state: SeasonState): ContractRequest[] {
  if (!ranked(state) || !state.relationships.enabledSince) return [];
  const groups = new Map<string, RelationshipEvent[]>(), events = state.relationships.events;
  for (let index = events.length - 1; index >= 0 && events[index]!.seasonNumber >= state.seasonNumber; index -= 1) {
    const event = events[index]!;
    if (!contractEvent(event) || event.seasonNumber !== state.seasonNumber) continue;
    const key = `${event.clubId}\u0000${event.playerId}`, list = groups.get(key) ?? [];
    list.unshift(event); groups.set(key, list);
  }
  const sequence = (id: string) => Number(id.slice(id.lastIndexOf('-') + 1));
  return [...groups.values()].flatMap(list => contractRequestsFromEvents(state, list)).sort((a, b) => sequence(a.id) - sequence(b.id));
}
/** An open request the club can still answer: the player is registered there and the season is running. */
export function awaitsContractReply(state: SeasonState, request: ContractRequest): boolean {
  return request.status === 'open' && state.status === 'active' && !!registeredPlayer(state, request.clubId, request.playerId);
}
export interface ContractReplyQuote { reply: ContractRequestReply; requestId: string | null; title: string; detail: string; canReply: boolean; reason: string | null }
const REPLY_DETAIL: Record<ContractRequestReply, { title: string; detail: string }> = {
  talks: { title: 'Open renewal talks', detail: `Make him an offer within ${TEXT.talksWindow}; any offer settles the request and signing him restores morale and trust. Letting the talks lapse ${TEXT.cost('lapsed')}, and ${TEXT.premium('lapsed')}.` },
  promise: { title: 'Promise talks at season end', detail: `Make him an offer before the next season starts. Breaking the promise ${TEXT.cost('broken')}, and ${TEXT.premium('broken')}.` },
  decline: { title: 'Decline', detail: `Tell him the club will not renew. This ${TEXT.cost('declined')}, fading over time, and ${TEXT.premium('declined')}.` },
};
/** The manager's (or an AI club's) answer to an open request: talks now, talks at season end, or a refusal. */
export function quoteContractReply(state: SeasonState, playerId: string, reply: ContractRequestReply, clubId = state.managedClubId): ContractReplyQuote {
  if (!Object.hasOwn(REPLY_DETAIL, reply)) throw new Error('Choose open talks, a promise of talks at season end, or decline.');
  const request = getContractRequest(state, playerId, clubId);
  let reason: string | null = null;
  if (!request) reason = 'This player has not asked about a new contract.';
  else if (request.status !== 'open') reason = 'This contract request has already been answered or has closed.';
  else if (state.status !== 'active') reason = 'Answer contract requests during the season.';
  else if (!registeredPlayer(state, clubId, playerId)) reason = 'This player is no longer registered at the club.';
  return { reply, requestId: request?.id ?? null, ...REPLY_DETAIL[reply], canReply: reason === null, reason };
}
export function replyToContractRequest(state: SeasonState, playerId: string, reply: ContractRequestReply, clubId = state.managedClubId): SeasonState {
  const quote = quoteContractReply(state, playerId, reply, clubId);
  if (!quote.canReply) throw new Error(quote.reason!);
  return applyRelationshipEvent(state, { ...relationshipEventAnchor(state), id: eventId(state), type: 'contract-reply', clubId, playerId, requestId: quote.requestId!, reply, negotiationCount: state.negotiations.records.length });
}
export function getPreparedRelationshipMorale(state: SeasonState, round = state.round, seasonNumber = state.seasonNumber): { model: 'morale-1'; eventCount: number; values: Record<string, number> } | undefined {
  const index = state.relationships.events.findIndex(event => event.type === 'prepare' && event.seasonNumber === seasonNumber && event.round === round);
  const event = state.relationships.events[index];
  return event?.type === 'prepare' ? { model: 'morale-1', eventCount: index + 1, values: { ...event.values } } : undefined;
}
/** One meaningful conversation per AI club at an actual calendar boundary, through normal guards. */
export function automateRelationships(state: SeasonState): SeasonState {
  if (!state.relationships.enabledSince || state.status !== 'active') return state;
  let next = state;
  for (const club of state.clubs) {
    if (club.id === state.managedClubId) continue;
    const squad = getSquadRelationships(next, club.id), overcommitted = squad.reduce((sum, row) => sum + row.minMinutes, 0) > 200;
    const concern = squad.filter(row => (row.concern || overcommitted && row.minMinutes > 0) && row.canTalk).sort((a, b) => a.morale - b.morale || compareText(a.player.id, b.player.id))[0];
    if (!concern) continue;
    const lower: SquadRole = concern.role === 'starter' ? 'rotation' : 'development';
    const quote = quoteSquadRole(next, concern.player.id, lower, club.id);
    if ((overcommitted || concern.averageMinutes! < concern.minMinutes * .75) && quote.canAgree) next = agreeSquadRole(next, concern.player.id, lower, club.id);
    else if (quoteRelationshipTalk(next, concern.player.id, 'minutes-promise', club.id).canTalk) next = talkToPlayer(next, concern.player.id, 'minutes-promise', club.id);
  }
  return next;
}

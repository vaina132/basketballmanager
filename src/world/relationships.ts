import type { PlayerRelationship, PlayingTimePromise, PressAnswer, RelationshipAnchor, RelationshipEvent, RelationshipTalk, RelationshipTalkQuote, RoleAgreementQuote, SeasonRelationships, SquadRole } from '../domain/relationships';
import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import { dateForRound } from './season';
import { rosterForRound } from './rosters';
import { isRecovering } from './health';
import { fixturePlayerEvidence } from './senior-history';
import { getPlayerRetirement } from './lifecycle-policy';
import { getPressQuestion, PRESS_ANSWER_TEXT, PRESS_EFFECTS, pressImpact } from './press-policy';
import { governingDerby, RIVALRY_MORALE_WEIGHT } from './rivalries';
import { ordinalRound, roundOrdinal, seasonRounds, worldOf } from './career-world';

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
const playerEvent = (event: RelationshipEvent): event is PlayerEvent => event.type === 'role' || event.type === 'talk';

export function createRelationships(): SeasonRelationships { return { model: 'relationships-1', enabledSince: null, events: [] }; }
export function relationshipEventAnchor(state: SeasonState): RelationshipAnchor {
  const completed = state.fixtures.filter(fixture => fixture.result !== null).reduce((round, fixture) => Math.max(round, fixture.round), 0);
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, completedRounds: ordinal(state.seasonNumber, completed, seasonRounds(state)), contractCount: state.employment.contracts.length, rosterCount: state.rosters.length };
}
export function enableRelationships(state: SeasonState): SeasonState {
  if (state.relationships.enabledSince) return state;
  return { ...state, relationships: { ...createRelationships(), enabledSince: relationshipEventAnchor(state) } };
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
  const personal = new Map<string, PlayerEvent[]>();
  for (const event of state.relationships.events) if (playerEvent(event) && event.clubId === clubId) {
    const events = personal.get(event.playerId) ?? [];
    events.push(event); personal.set(event.playerId, events);
  }
  const memberships = records.flatMap(season => season.rosters.filter(roster => roster.clubId === clubId).sort((a, b) => a.fromRound - b.fromRound)
    .map(roster => ({ at: ordinal(season.seasonNumber, roster.fromRound, rounds), players: new Set(roster.players.map(player => player.id)) })));
  const visibleFixtures = () => records.flatMap(season => season.fixtures
    .filter(fixture => fixture.result && fixture.date <= state.date && (fixture.homeClubId === clubId || fixture.awayClubId === clubId))
    .map(fixture => ({ fixture, seasonNumber: season.seasonNumber, at: ordinal(season.seasonNumber, fixture.round, rounds),
      players: new Set(rosterForRound(season.rosters, clubId, fixture.round).players.map(player => player.id)), derby: undefined as boolean | undefined })))
    .sort((a, b) => a.at - b.at || compareText(a.fixture.id, b.fixture.id));
  // Disabled relationships still need registration stints, but must not inspect unrelated match results.
  let fixtures: ReturnType<typeof visibleFixtures> | undefined;
  return {
    eventsFor(playerId: string): readonly PlayerEvent[] { return personal.get(playerId) ?? []; },
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
function roleAt(state: SeasonState, events: readonly PlayerEvent[], start: number): { role: SquadRole; after: number } {
  const event = events.filter((event): event is Extract<RelationshipEvent, { type: 'role' }> => event.type === 'role' && ordinal(event.seasonNumber, event.round, seasonRounds(state)) >= start).at(-1);
  return { role: event?.role ?? 'rotation', after: Math.max(state.relationships.enabledSince?.completedRounds ?? 0, start - 1, event ? ordinal(event.seasonNumber, event.round, seasonRounds(state)) : 0) };
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
  const previousRole = prefix.filter((item): item is Extract<RelationshipEvent, { type: 'role' }> => item.type === 'role' && item.clubId === event.clubId && item.playerId === event.playerId && ordinal(item.seasonNumber, item.round, seasonRounds(state)) >= startOfStint).at(-1);
  const targetMinutes = SQUAD_ROLE_DEFINITIONS[previousRole?.role ?? 'rotation'].minMinutes;
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
  const role = roleAt(state, events, currentStint), definition = SQUAD_ROLE_DEFINITIONS[role.role];
  const evidence = state.relationships.enabledSince ? evidenceHistory.gamesFor(playerId, { after: role.after, eligibleOnly: true, limit: 4 }) : [];
  const average = evidence.length ? evidence.reduce((sum, game) => sum + game.minutes, 0) / evidence.length : null;
  const concern = evidence.length >= 3 && average! + 1e-9 < definition.minMinutes ? `Playing time below the agreed ${definition.label.toLowerCase()} role` : null;
  const personal = state.relationships.enabledSince ? events : [];
  const promises = personal.filter((event): event is Extract<RelationshipEvent, { type: 'talk' }> => event.type === 'talk' && event.choice === 'minutes-promise').map(event => promiseFor(state, event, evidenceHistory));
  let conversationImpact = 0, promiseImpact = 0;
  for (const event of personal) {
    if (event.type === 'talk' && event.choice === 'explain') conversationImpact += decayed(2, event.date, state.date, 21);
    if (event.type === 'role') {
      const startOfStint = evidenceHistory.stintStart(playerId, ordinal(event.seasonNumber, event.round, seasonRounds(state)));
      const before = personal.slice(0, personal.indexOf(event)).filter((item): item is Extract<RelationshipEvent, { type: 'role' }> => item.type === 'role' && ordinal(item.seasonNumber, item.round, seasonRounds(state)) >= startOfStint).at(-1)?.role ?? 'rotation';
      if (SQUAD_ROLE_DEFINITIONS[event.role].minMinutes < SQUAD_ROLE_DEFINITIONS[before].minMinutes) conversationImpact += decayed(-4, event.date, state.date);
    }
  }
  for (const promise of promises) if (promise.outcomeDate && ['kept', 'broken'].includes(promise.status)) promiseImpact += decayed(promise.status === 'kept' ? 10 : -15, promise.outcomeDate, state.date);
  conversationImpact = clamp(conversationImpact, -8, 8); promiseImpact = clamp(promiseImpact, -20, 10);
  const trust = Math.round(clamp(50 + conversationImpact + promiseImpact, 0, 100));
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
  const morale = Math.round(clamp(50 + roleImpact + resultImpact + conversationImpact + promiseImpact + press.impact, 0, 100));
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
    const effect = PRESS_EFFECTS[event.answer], value = event.coreIds.includes(playerId) ? effect.core : effect.others;
    history.push({ id: event.id, date: event.date, label: `Press: ${PRESS_ANSWER_TEXT[event.answer].label.toLowerCase()}`, detail: value === 0 ? 'No morale change.' : `${value > 0 ? '+' : ''}${value} morale, fading over the following weeks.` });
  }
  history.sort((a, b) => compareText(b.date, a.date) || compareText(b.id, a.id));
  return { player, clubId, role: role.role, roleLabel: definition.label, minMinutes: definition.minMinutes, maxMinutes: definition.maxMinutes, morale, trust, moraleLabel: morale >= 65 ? 'Positive' : morale >= 45 ? 'Settled' : morale >= 30 ? 'Concerned' : 'Unsettled', eligibleGames: evidence.length, averageMinutes: average === null ? null : rounded(average), evidenceFixtureIds: evidence.map(game => game.id), concern, reasons, promise, promises, history, canTalk: talkReason === null, talkReason };
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
    if (!same(event.playerIds, question.playerIds) || !same(event.coreIds, question.coreIds)) throw new Error('Record exactly the squad and regulars the press question addressed.');
  } else if (event.type === 'prepare') {
    if (state.status !== 'active' || anchor.completedRounds !== ordinal(state.seasonNumber, state.round, seasonRounds(state)) - 1) throw new Error('Freeze morale only before a new uncommitted matchday.');
    if (state.relationships.events.some(item => item.type === 'prepare' && item.seasonNumber === state.seasonNumber && item.round === state.round)) throw new Error('This matchday already has frozen morale.');
    const expected = preparationValues(state);
    const sameMap = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && a[key] === b[key]);
    if (!sameMap(event.rosterIds, expected.rosterIds) || !sameMap(event.values, expected.values)) throw new Error('Freeze exact registered-player morale before the matchday.');
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
  return applyRelationshipEvent(state, { ...relationshipEventAnchor(state), id: eventId(state), type: 'press', clubId: question.clubId, topic: question.topic, triggerRound: question.triggerRound, answer, playerIds: question.playerIds, coreIds: question.coreIds });
}
function preparationValues(state: SeasonState): { rosterIds: Record<string, string>; values: Record<string, number> } {
  return { rosterIds: Object.fromEntries(state.clubs.map(club => [club.id, rosterForRound(state.rosters, club.id, state.round).id])), values: Object.fromEntries(state.clubs.flatMap(club => getSquadRelationships(state, club.id).map(row => [row.player.id, row.morale]))) };
}
export function prepareRelationshipsRound(state: SeasonState): SeasonState {
  if (!state.relationships.enabledSince || state.relationships.events.some(event => event.type === 'prepare' && event.seasonNumber === state.seasonNumber && event.round === state.round)) return state;
  return applyRelationshipEvent(state, { ...relationshipEventAnchor(state), id: eventId(state), type: 'prepare', ...preparationValues(state) });
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

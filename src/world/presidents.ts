import { draftDateOfBirth } from './draft-index';
import type { SeasonDraft } from '../domain/draft';
import type { PresidentTraitLevel, PresidentTraits } from '../data/development-presidents';
import type { BoardClubMandate, BoardCultureObjective, BoardMandate, BoardRequest, BoardYouthObjective, SeasonBoard } from '../domain/board';
import type { SeasonAcademy } from '../domain/academy';
import type { ArchivedFixture, SeasonArchive, SeasonFixture } from '../domain/season';
import type { Player } from '../domain/types';
import type { CareerWorld } from '../domain/world';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { clubPresident, worldOf } from './career-world';
import { overallRating } from './overall-rating';
export { isPresidentTraits, NEGOTIATION_STYLES } from '../data/development-presidents';

/**
 * Format 70 (saved ideas level): president personalities, verdicts on the player salary budget, youth and culture
 * objectives and the president's requests, for careers created with the board-2 model. Every number is here.
 * The traits are fictional game rules, never claims about real people (real-club worlds label them as fictional).
 */
export const PRESIDENT_RULES = Object.freeze({
  model: 'board-2' as const,
  /** Traits drawn for clubs without stored ones: most presidents are moderate (index = stable hash modulo 9). */
  traitDraw: Object.freeze([1, 2, 2, 3, 3, 3, 4, 4, 5] as const),
  negotiationDraw: Object.freeze(['flexible', 'fair', 'fair', 'hard'] as const),
  patience: Object.freeze({
    /** The most confidence moves in one review, by patience 1-5 (board-1: always 8). */
    reviewStep: Object.freeze([10, 9, 8, 7, 6] as const),
    /** A final confidence below this is Under pressure (the dismissal line), by patience 1-5 (board-1: 30). */
    pressureBelow: Object.freeze([36, 33, 30, 27, 24] as const),
  }),
  /** Results targets: the 60/50/40% thirds move by this much per ambition point away from 3, within the bounds. */
  ambition: Object.freeze({ winRateStep: 0.05, minWinRate: 0.3, maxWinRate: 0.7 }),
  /** Capital requests: confidence the board needs (added to 65 - 5 x generosity) and matchdays to wait after a refusal. */
  negotiation: Object.freeze({
    flexible: Object.freeze({ confidence: -5, cooldown: 1 }),
    fair: Object.freeze({ confidence: 0, cooldown: 2 }),
    hard: Object.freeze({ confidence: 5, cooldown: 3 }),
  }),
  salary: Object.freeze({
    /** Next season's player salary budget after each verdict, in percent of the standard budget, for generosity 3. */
    percent: Object.freeze({ confident: 5, steady: 0, concerned: -5, pressure: -10 }),
    /** Each generosity point above 3 raises rises and softens cuts by this share (below 3 the reverse). */
    generosityStep: 0.25,
  }),
  objectives: Object.freeze({
    /** Under-23 players: aged 22 or younger at the season opening. Academy graduates of the club always count. */
    maxAge: 22,
    /**
     * Youth minutes asked per counted game for each under-23 or academy player in the opening squad (at most three), by
     * squad third, before ambition (each point above 3 adds 10%). Squads without one get no minutes objective.
     */
    youthMinutesPerPlayer: Object.freeze({ top: 8, middle: 10, bottom: 12 }), youthPlayersCounted: 3,
    ambitionStep: 0.1,
    /** Youth minutes: (minutes - pace) / pace x 5, rounded, between -4 and +3 assessment points. */
    youthScale: 5, youthMin: -4, youthMax: 3,
    /** Academy promotion: +3 once met; -3 from three quarters of the counted games while unmet. */
    promotionPoints: 3, promotionLateShare: 0.75,
    /** A rotation player played at least ten minutes in at least half of the club's counted games. */
    rotationSeconds: 600, rotationGameShare: 0.5,
    established: Object.freeze({ top: 5, middle: 4, bottom: 3 }),
    young: Object.freeze({ top: 1, middle: 2, bottom: 3 }),
    /** Culture: +3 when met; 2 points per missing player, at most 4. */
    cultureMet: 3, cultureMissPerPlayer: 2, cultureMax: 4,
    /** No youth-minutes or culture assessment before the third counted game (as for results). */
    graceGames: 3,
    /**
     * Automatically run clubs (every rival, and every club while the manager has none) follow their objectives with
     * existing levers. With a youth-minutes or young-rotation objective, a regular-season game starts the club's best
     * healthy under-23 or academy players in place of its weakest other planned starters (at the same position when
     * there is one) while they are at most `aiStarterGap` rating points weaker (the engine's starter bonus): one for
     * youth minutes, up to `aiYoungStarters` for a young-rotation target. A player who counts towards the club's youth
     * or culture objective is renewed up to squad rank `aiRenewMaxRank` (otherwise 8) when he asks for a new contract.
     */
    aiStarterGap: 6, aiYoungStarters: 2, aiRenewMaxRank: 12,
  }),
  requests: Object.freeze({
    /** The chance of a new request at a weekly review, by interference 1-5, when none is open. */
    weeklyChance: Object.freeze([0, 0.05, 0.1, 0.15, 0.2] as const),
    firstRound: 3,
    deadlineWeeks: 4,
    maxPerSeason: 2,
    ticketRaisePercent: 10,
    playMinutes: 40,
    /** Confidence added when met and removed when the deadline passes unmet. */
    met: 4,
    ignored: -6,
  }),
});

const level = (value: PresidentTraitLevel) => value - 1;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function hash(seed: number, key: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  return value;
}

/** Fictional traits from the club's id: the same club always gets the same president personality. */
export function derivePresidentTraits(clubId: string): PresidentTraits {
  const draw = (key: string) => PRESIDENT_RULES.traitDraw[hash(0, `president|${key}|${clubId}`) % PRESIDENT_RULES.traitDraw.length]! as PresidentTraitLevel;
  return { patience: draw('patience'), ambition: draw('ambition'), negotiation: PRESIDENT_RULES.negotiationDraw[hash(0, `president|negotiation|${clubId}`) % PRESIDENT_RULES.negotiationDraw.length]!, interference: draw('interference') };
}

export function presidentTraits(world: CareerWorld, clubId: string): PresidentTraits {
  return clubPresident(world, clubId).traits ?? derivePresidentTraits(clubId);
}

/** Careers created with president personalities (format 70). */
export function usesPresidentBoard(board: Pick<SeasonBoard, 'model'> | undefined | null): boolean { return board?.model === PRESIDENT_RULES.model; }

export const presidentReviewStep = (traits: PresidentTraits) => PRESIDENT_RULES.patience.reviewStep[level(traits.patience)]!;
export const presidentPressureLine = (traits: PresidentTraits) => PRESIDENT_RULES.patience.pressureBelow[level(traits.patience)]!;
export function ambitionWinRate(rate: number, traits: PresidentTraits): number {
  const { winRateStep, minWinRate, maxWinRate } = PRESIDENT_RULES.ambition;
  return Math.round(clamp(rate + (traits.ambition - 3) * winRateStep, minWinRate, maxWinRate) * 100) / 100;
}

/** The salary budget change a verdict brings, in whole percent, scaled by the president's generosity. */
export function salaryVerdictPercent(generosity: PresidentTraitLevel, verdict: keyof typeof PRESIDENT_RULES.salary.percent): number {
  const base = PRESIDENT_RULES.salary.percent[verdict], scale = (generosity - 3) * PRESIDENT_RULES.salary.generosityStep;
  // Halves round away from zero, so rises and cuts mirror each other.
  return base === 0 ? 0 : Math.sign(base) * Math.round(Math.abs(base * (base > 0 ? 1 + scale : 1 - scale)));
}

/** Squad third by the mandate's resource rank. */
export type ClubTier = 'top' | 'middle' | 'bottom';
export function clubTier(resourceRank: number, clubs: number): ClubTier {
  return resourceRank <= Math.ceil(clubs / 3) ? 'top' : resourceRank <= Math.ceil(clubs * 2 / 3) ? 'middle' : 'bottom';
}

/** What objective rules read beyond the board's calculation context; all optional so older contexts stay valid. */
export interface PresidentContext {
  academy?: Pick<SeasonAcademy, 'enabledSince' | 'prospects' | 'graduates'>;
  history?: readonly Pick<SeasonArchive, 'seasonNumber' | 'rosters'>[];
  managedClubId?: string;
}

/** Academy lookups by player, built once per (immutable) academy record. */
const academyIndexes = new WeakMap<object, { births: Map<string, string>; graduates: Set<string> }>();
function academyIndex(academy: PresidentContext['academy']) {
  if (!academy) return null;
  let index = academyIndexes.get(academy);
  if (!index) {
    const births = new Map<string, string>(), graduates = new Set<string>();
    for (const prospect of academy.prospects) if (!births.has(prospect.player.id)) births.set(prospect.player.id, prospect.dateOfBirth);
    for (const graduate of academy.graduates) { births.set(graduate.player.id, graduate.dateOfBirth); graduates.add(`${graduate.clubId}|${graduate.player.id}`); }
    index = { births, graduates };
    academyIndexes.set(academy, index);
  }
  return index;
}

/** Date of birth from the world's profiles or the academy; unknown stays unknown (never young). */
export function boardDateOfBirth(context: PresidentContext & { world?: CareerWorld; dataPackId?: string }, playerId: string): string | null {
  const profiles = worldOf(context).playerProfiles;
  if (Object.hasOwn(profiles, playerId)) return profiles[playerId]!.dateOfBirth;
  return academyIndex(context.academy)?.births.get(playerId) ?? draftDateOfBirth(context as { draft?: SeasonDraft }, playerId);
}

/** Under-23 at the mandate date, or a graduate of the club's own academy. */
export function isYouthPlayer(context: PresidentContext & { world?: CareerWorld; dataPackId?: string }, clubId: string, playerId: string, onDate: string, maxAge: number): boolean {
  if (academyIndex(context.academy)?.graduates.has(`${clubId}|${playerId}`)) return true;
  const age = playerAgeOnDate(boardDateOfBirth(context, playerId), onDate);
  return age !== null && age <= maxAge;
}

/**
 * The youth and culture objectives a club's board sets at the season opening, from the president's traits and the
 * squad third. Ambitious presidents of top-third clubs set no youth objective; academy promotion is asked of the
 * manager's club only; culture objectives come from patient (young players) or interfering and traditional presidents.
 */
export function boardObjectives(context: PresidentContext & { world?: CareerWorld; dataPackId?: string }, input: { clubId: string; seasonNumber: number; date: string; games: number; tier: ClubTier; playerIds: readonly string[]; traits: PresidentTraits }): { youth: BoardYouthObjective | null; culture: BoardCultureObjective | null } {
  const rules = PRESIDENT_RULES.objectives, { traits, tier, clubId } = input;
  if (input.games === 0) return { youth: null, culture: null };
  const young = input.playerIds.filter(id => isYouthPlayer(context, clubId, id, input.date, rules.maxAge)).length;
  let youth: BoardYouthObjective | null = null;
  if (!(tier === 'top' && traits.ambition >= 4)) {
    if (context.managedClubId === clubId && context.academy?.enabledSince && (traits.patience >= 4 || tier === 'bottom')) youth = { kind: 'academy-promotion', target: 1 };
    else if (young) youth = { kind: 'youth-minutes', targetMinutes: Math.round(input.games * Math.min(young, rules.youthPlayersCounted) * rules.youthMinutesPerPlayer[tier] * (1 + rules.ambitionStep * (traits.ambition - 3))), maxAge: rules.maxAge };
  }
  const previous = context.history?.find(archive => archive.seasonNumber === input.seasonNumber - 1);
  const earlier = previous ? new Set(previous.rosters.filter(roster => roster.clubId === clubId).flatMap(roster => roster.players.map(player => player.id))) : null;
  const established = input.playerIds.filter(id => !earlier || earlier.has(id) || academyIndex(context.academy)?.graduates.has(`${clubId}|${id}`));
  let culture: BoardCultureObjective | null = null;
  if (traits.patience >= 4 && youth?.kind !== 'youth-minutes' && young >= 1) culture = { kind: 'young-rotation', target: Math.min(rules.young[tier], young), maxAge: rules.maxAge };
  else if ((traits.interference >= 3 || traits.ambition <= 2) && established.length >= 2) {
    const target = clamp(rules.established[tier] + (traits.ambition >= 4 ? 1 : traits.ambition <= 2 ? -1 : 0), 1, established.length);
    culture = { kind: 'established-core', target, playerIds: [...established] };
  }
  return { youth, culture };
}

/** The board-2 additions to one club's mandate: patience and the objectives. */
export function presidentMandate(context: PresidentContext & { world?: CareerWorld; dataPackId?: string }, input: { clubId: string; seasonNumber: number; date: string; games: number; tier: ClubTier; playerIds: readonly string[] }): Pick<BoardClubMandate, 'reviewStep' | 'pressureBelow' | 'youth' | 'culture'> {
  const traits = presidentTraits(worldOf(context), input.clubId);
  return { reviewStep: presidentReviewStep(traits), pressureBelow: presidentPressureLine(traits), ...boardObjectives(context, { ...input, traits }) };
}

/** Format 70: a club's board objectives in a season (board-2 careers only). */
export function seasonObjectives(board: Pick<SeasonBoard, 'model' | 'mandates'> | undefined, clubId: string, seasonNumber: number): { mandate: BoardMandate; objective: BoardClubMandate } | null {
  if (!board || !usesPresidentBoard(board)) return null;
  const mandate = board.mandates.find(item => item.seasonNumber === seasonNumber), objective = mandate?.clubs[clubId];
  return mandate && objective ? { mandate, objective } : null;
}

/** Whether a player counts towards the club's youth or culture objective this season (an automatic renewal lever). */
export function countsTowardsObjectives(context: PresidentContext & { world?: CareerWorld; dataPackId?: string; board?: Pick<SeasonBoard, 'model' | 'mandates'> }, clubId: string, seasonNumber: number, playerId: string): boolean {
  const found = seasonObjectives(context.board, clubId, seasonNumber);
  if (!found) return false;
  const { mandate, objective } = found, maxAge = PRESIDENT_RULES.objectives.maxAge;
  if (objective.culture?.kind === 'established-core' && objective.culture.playerIds.includes(playerId)) return true;
  return (objective.youth?.kind === 'youth-minutes' || objective.culture?.kind === 'young-rotation') && isYouthPlayer(context, clubId, playerId, mandate.date, maxAge);
}

/**
 * Format 70: an automatically run club's starting five for a regular-season game under a youth-minutes or
 * young-rotation objective (`PRESIDENT_RULES.objectives.aiStarterGap`). `players` are the selected, developed players;
 * unavailable planned starters are always replaceable. Reads state only: no random draws.
 */
export function objectiveStartingFive(context: PresidentContext & { world?: CareerWorld; dataPackId?: string; board?: Pick<SeasonBoard, 'model' | 'mandates'> }, input: { clubId: string; seasonNumber: number; players: readonly Player[]; planned: readonly string[]; unavailable: ReadonlySet<string> }): string[] {
  const rules = PRESIDENT_RULES.objectives, found = seasonObjectives(context.board, input.clubId, input.seasonNumber);
  const youth = found?.objective.youth?.kind === 'youth-minutes' ? found.objective.youth : null;
  const culture = found?.objective.culture?.kind === 'young-rotation' ? found.objective.culture : null;
  if (!found || !youth && !culture) return [...input.planned];
  const maxAge = youth?.maxAge ?? culture!.maxAge, wanted = Math.max(youth ? 1 : 0, culture ? Math.min(rules.aiYoungStarters, culture.target) : 0);
  const byId = new Map(input.players.map(player => [player.id, player]));
  const rating = (id: string) => input.unavailable.has(id) ? -Infinity : overallRating(byId.get(id)!.attributes, byId.get(id)!.position);
  const young = new Set(input.players.filter(player => isYouthPlayer(context, input.clubId, player.id, found.mandate.date, maxAge)).map(player => player.id));
  const order = (a: string, b: string) => rating(a) - rating(b) || (a < b ? -1 : a > b ? 1 : 0);
  let five = input.planned.filter(id => byId.has(id));
  if (five.length < 5) return [...input.planned];
  let starting = five.filter(id => young.has(id) && !input.unavailable.has(id)).length;
  const candidates = [...young].filter(id => !five.includes(id) && !input.unavailable.has(id)).sort((a, b) => order(b, a));
  for (const candidate of candidates) {
    if (starting >= wanted) break;
    const others = five.filter(id => !young.has(id) || input.unavailable.has(id)), position = byId.get(candidate)!.position;
    const same = others.filter(id => byId.get(id)!.position === position);
    const weakest = [...(same.length ? same : others)].sort(order)[0];
    if (weakest === undefined || rating(candidate) < rating(weakest) - rules.aiStarterGap) continue;
    five = five.map(id => id === weakest ? candidate : id);
    starting += 1;
  }
  return five;
}

interface ClubGame { fixture: Pick<SeasonFixture, 'result'> | Pick<ArchivedFixture, 'result'>; players: ReadonlySet<string> }
/** Seconds played per player in a game: the box score, or an archived season's retained appearances. */
export function gameSeconds(result: SeasonFixture['result'] | ArchivedFixture['result'] | null | undefined): Readonly<Record<string, { secondsPlayed: number } | undefined>> {
  return result?.stats ?? (result as ArchivedFixture['result'] | null | undefined)?.appearances ?? {};
}
/** Seconds and rotation games (at least ten minutes) per player in the club's counted games. */
export function playerSeconds(games: readonly ClubGame[]): Map<string, { seconds: number; rotationGames: number }> {
  const totals = new Map<string, { seconds: number; rotationGames: number }>();
  for (const { fixture, players } of games) for (const [playerId, stats] of Object.entries(gameSeconds(fixture.result))) {
    if (!players.has(playerId) || !stats) continue;
    const row = totals.get(playerId) ?? { seconds: 0, rotationGames: 0 };
    row.seconds += stats.secondsPlayed;
    if (stats.secondsPlayed >= PRESIDENT_RULES.objectives.rotationSeconds) row.rotationGames += 1;
    totals.set(playerId, row);
  }
  return totals;
}

export interface ObjectiveAssessment { progress: number; impact: number }

/** Youth objective progress and its assessment points at a review. */
export function assessYouthObjective(context: PresidentContext & { world?: CareerWorld; dataPackId?: string }, objective: BoardYouthObjective, input: { clubId: string; seasonNumber: number; startsRound: number; round: number; mandateDate: string; games: number; played: number; seconds: ReturnType<typeof playerSeconds> }): ObjectiveAssessment {
  const rules = PRESIDENT_RULES.objectives;
  if (objective.kind === 'academy-promotion') {
    const progress = (context.academy?.graduates ?? []).filter(entry => entry.kind === 'promotion' && entry.clubId === input.clubId && entry.availableSince.seasonNumber === input.seasonNumber && entry.availableSince.round >= input.startsRound && entry.availableSince.round <= input.round).length;
    const impact = progress >= objective.target ? rules.promotionPoints : input.played >= Math.ceil(input.games * rules.promotionLateShare) ? -rules.promotionPoints : 0;
    return { progress, impact };
  }
  let seconds = 0;
  for (const [playerId, row] of input.seconds) if (isYouthPlayer(context, input.clubId, playerId, input.mandateDate, objective.maxAge)) seconds += row.seconds;
  const progress = Math.floor(seconds / 60);
  if (input.played < rules.graceGames || input.games === 0) return { progress, impact: 0 };
  const pace = objective.targetMinutes * input.played / input.games;
  return { progress, impact: clamp(Math.round((progress - pace) / Math.max(1, pace) * rules.youthScale), rules.youthMin, rules.youthMax) || 0 };
}

/** Rotation players meeting the culture objective and its assessment points at a review. */
export function assessCultureObjective(context: PresidentContext & { world?: CareerWorld; dataPackId?: string }, objective: BoardCultureObjective, input: { clubId: string; mandateDate: string; played: number; seconds: ReturnType<typeof playerSeconds> }): ObjectiveAssessment {
  const rules = PRESIDENT_RULES.objectives, needed = Math.ceil(input.played * rules.rotationGameShare);
  const core = objective.kind === 'established-core' ? new Set(objective.playerIds) : null;
  let progress = 0;
  for (const [playerId, row] of input.seconds) {
    if (input.played === 0 || row.rotationGames < needed) continue;
    if (core ? core.has(playerId) : isYouthPlayer(context, input.clubId, playerId, input.mandateDate, (objective as Extract<BoardCultureObjective, { kind: 'young-rotation' }>).maxAge)) progress += 1;
  }
  if (input.played < rules.graceGames) return { progress, impact: 0 };
  return { progress, impact: progress >= objective.target ? rules.cultureMet : -Math.min(rules.cultureMax, (objective.target - progress) * rules.cultureMissPerPlayer) };
}

/** Confidence from requests met or ignored at this review for a club; null when none resolved here. */
export function requestImpactAt(requests: readonly BoardRequest[] | undefined, clubId: string, seasonNumber: number, round: number): number | null {
  const resolved = (requests ?? []).filter(request => request.clubId === clubId && request.seasonNumber === seasonNumber && request.resolvedRound === round && request.outcome !== 'open');
  if (!resolved.length) return null;
  return resolved.reduce((sum, request) => sum + (request.outcome === 'met' ? PRESIDENT_RULES.requests.met : request.outcome === 'ignored' ? PRESIDENT_RULES.requests.ignored : 0), 0);
}


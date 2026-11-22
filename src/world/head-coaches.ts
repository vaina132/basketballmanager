import { COACH_ATTRIBUTES, type CoachAttribute, type CoachAttributes, type HeadCoach, type ManagerCoachSeason, type SeasonCoaches } from '../domain/coaches';
import type { BoardRestart } from '../domain/board';
import type { ManagerProfile } from '../domain/manager';
import type { SeasonState } from '../domain/season';
import type { Player, Tactics, Team } from '../domain/types';
import type { CareerWorld, WorldContext } from '../domain/world';
import { REAL_COACHES, REAL_COACH_POSTS, type RealCoach } from '../data/real-coaches';
import { NATIONAL_TEAMS } from '../data/national-teams';
import { countryName, nameCapacity, NAME_COUNTRIES } from '../data/people-names';
import { COACH_LEVELS, coachAge, coachHash, coachOverall, estimateCoach, NO_TITLES } from './coach-ratings';
import { careerPointKey } from './career-rules';
import { clubCountry, seasonRounds, worldOf } from './career-world';
import { overallRating } from './overall-rating';
import { managedClubFor } from './career';
import { seasonVerdict } from './board-consequences';
import { getPostseasons, isRegularFixture } from './season';
import { getEuropeanCompetitions } from './europe';
import { isYouthPlayer } from './presidents';
import { COACH_STEERING_MODEL, coachRotation, isSteeringYoung, moraleImpact, styleFit, type SteeringCoach } from './coach-steering';
import type { CoachRotation, SkillAttributes } from '../domain/types';

/**
 * Format 82 (owner, 22 November 2026, item E): real head coaches for new real-club careers. Every club of the world has
 * one head coach (its real coach from `src/data/real-coaches.ts`, or a generated one, marked), the 24 national teams
 * start with their real coaches, and a market of free coaches grows a little each season.
 *
 * Who coaches where is never saved: every change of coach is already a board change (`board.restarts`, checked by
 * the career check), so the places are replayed from the opening coaches and those changes:
 * - the manager takes a club (`coach: 'manager'`): that club's coach becomes a free agent (the real coach displaced);
 * - a club appoints another coach (`coach: 'ai'`): its coach (if not the manager) becomes a free agent, and the club
 *   hires the free agent its level attracts best.
 * The career saves only the manager's own attributes (`state.coaches`). Design: scratchpad `coaches/design.md`.
 */
export const COACHES_MODEL = 'coaches-1' as const;
export const COACH_RULES = Object.freeze({
  /** Generated free coaches in the market at the start, and new ones each later season. */
  openingMarket: 12, seasonMarket: 4,
  /** Free agents older than this retire at a season's start. */
  retireAfter: 70,
  /** From this age a coach loses one attribute point each season (seeded). */
  declineFrom: 63,
  /** A club hires the best free agent whose reputation is at most its pull plus this. */
  reach: 5,
  /** The manager's attributes: at most this much in total up or down in one season. */
  seasonBudget: 2,
  /** Each point of the manager's overall coach rating above 10 adds this much to his reputation (below 10 removes it). */
  reputationPerPoint: 2,
});

/** The manager in the coaches' places (he is the head coach of his club). */
export const MANAGER_COACH = 'manager';

/** Whether this career has real head coaches (format 82). */
export const usesHeadCoaches = (state: Partial<Pick<SeasonState, 'coaches'>>): boolean => !!state.coaches;

/** Whether a world can have real head coaches: real-club worlds. */
export const headCoachWorld = (world: CareerWorld): boolean => world.source === 'real-data-pack';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const realById = new Map(REAL_COACHES.map(coach => [coach.id, coach]));

/** The level of a world club for a generated coach: its league's tier and European competition. */
export function worldClubLevel(world: CareerWorld, clubId: string): number {
  const europe = world.europeanCompetitions?.filter(competition => competition.clubIds.includes(clubId)) ?? [];
  if (europe.some(competition => competition.kind === 'euroleague')) return COACH_LEVELS.euroleague;
  const league = world.domesticLeagues?.find(item => item.clubIds.includes(clubId)) ?? world.backgroundLeagues?.find(item => item.clubIds.includes(clubId));
  if (league?.tier === 1) return europe.length ? COACH_LEVELS.european : COACH_LEVELS.top;
  if (league) return COACH_LEVELS.second;
  if (europe.length) return COACH_LEVELS.european;
  return world.lowerDivisions?.some(division => 'clubIds' in division ? division.clubIds.includes(clubId) : division.clubs.some(club => club.id === clubId)) ? 0 : COACH_LEVELS.second;
}

/** How well known a coach a club of this level can attract: EuroLeague clubs anyone, second divisions modest names. */
export function levelPull(level: number): number {
  return level >= COACH_LEVELS.euroleague ? 90 : level >= COACH_LEVELS.european ? 65 : level >= COACH_LEVELS.top ? 55 : level >= COACH_LEVELS.second ? 42 : 32;
}

/** The coaches of a world: every person by id, each club's opening coach, each national team's real coach and each club's pull. */
export interface CoachWorld { coaches: ReadonlyMap<string, HeadCoach>; opening: ReadonlyMap<string, string>; national: ReadonlyMap<string, string>; pull: ReadonlyMap<string, number>; marketIds: (seasonNumber: number) => string[] }
const coachWorlds = new WeakMap<CareerWorld, CoachWorld>();

/** A generated coach's name: the country's name list from three quarters of its shuffle (staff take the start, presidents the end). */
function generatedName(country: string | null, key: string, taken: Set<string>): { name: string; nationality: string | null } {
  const hash = coachHash(`coach-name|${key}`);
  const local = country !== null && NAME_COUNTRIES.includes(country) && hash % 100 < 80;
  const chosen = local ? country! : NAME_COUNTRIES[(hash >>> 8) % NAME_COUNTRIES.length]!;
  const size = nameCapacity(chosen);
  for (let attempt = 0; attempt < size; attempt += 1) {
    const name = countryName(chosen, (Math.floor(size * 3 / 4) + (hash >>> 3) + attempt) % size);
    if (name && !taken.has(name)) { taken.add(name); return { name, nationality: chosen }; }
  }
  return { name: `Coach ${taken.size + 1}`, nationality: chosen };
}

/** A generated coach's birth year: 38 to 61 at the career's start, from his key. */
const generatedBorn = (key: string, startDate: string) => String(Number(startDate.slice(0, 4)) - 38 - coachHash(`born|${key}`) % 24);

export function coachWorld(world: CareerWorld): CoachWorld {
  const known = coachWorlds.get(world);
  if (known) return known;
  const coaches = new Map<string, HeadCoach>(), opening = new Map<string, string>(), national = new Map<string, string>(), pull = new Map<string, number>();
  const taken = new Set<string>([...REAL_COACHES.map(coach => coach.name)]);
  const real = (coach: RealCoach) => { if (!coaches.has(coach.id)) coaches.set(coach.id, estimateCoach(coach.id, coach, coach.level, world.startDate)); return coaches.get(coach.id)!; };
  for (const club of world.clubs) {
    const post = REAL_COACH_POSTS.find(item => item.teamId === club.id), facts = post && realById.get(post.coachId);
    const used = facts && [...opening.values()].includes(facts.id);
    if (facts && !used) {
      const coach = real(facts);
      opening.set(club.id, coach.id);
      pull.set(club.id, Math.max(coach.reputation, levelPull(worldClubLevel(world, club.id))));
      continue;
    }
    const level = worldClubLevel(world, club.id), key = `club|${club.id}`;
    const country = world.domesticLeagues?.find(league => league.clubIds.includes(club.id))?.country ?? world.backgroundLeagues?.find(league => league.clubIds.includes(club.id))?.country ?? world.lowerDivisions?.find(division => 'clubIds' in division ? division.clubIds.includes(club.id) : division.clubs.some(item => item.id === club.id))?.country ?? null;
    const { name, nationality } = generatedName(country, key, taken);
    const coach = estimateCoach(`coach-gen-${club.id}`, { name, born: generatedBorn(key, world.startDate), nationality, since: null, titles: NO_TITLES }, level, world.startDate, true);
    coaches.set(coach.id, coach);
    opening.set(club.id, coach.id);
    pull.set(club.id, Math.max(coach.reputation, levelPull(level)));
  }
  for (const team of NATIONAL_TEAMS) {
    const post = REAL_COACH_POSTS.find(item => item.teamId === team.id), facts = post && realById.get(post.coachId);
    if (facts) national.set(team.id, real(facts).id);
  }
  const marketCache = new Map<number, string[]>();
  const countries = [...new Set((world.domesticLeagues ?? []).map(league => league.country))];
  const marketIds = (seasonNumber: number) => {
    let ids = marketCache.get(seasonNumber);
    if (ids) return ids;
    const count = seasonNumber === 1 ? COACH_RULES.openingMarket : COACH_RULES.seasonMarket;
    ids = [];
    for (let k = 1; k <= count; k += 1) {
      const id = `coach-market-s${seasonNumber}-${k}`, key = `market|${seasonNumber}|${k}`;
      if (!coaches.has(id)) {
        const country = countries.length ? countries[coachHash(key) % countries.length]! : null;
        const { name, nationality } = generatedName(country, key, taken);
        const born = String(Number(world.startDate.slice(0, 4)) + seasonNumber - 1 - 36 - coachHash(`born|${key}`) % 20);
        const level = [COACH_LEVELS.second, COACH_LEVELS.top, COACH_LEVELS.top, COACH_LEVELS.european][coachHash(`level|${key}`) % 4]!;
        coaches.set(id, estimateCoach(id, { name, born, nationality, since: null, titles: NO_TITLES }, level, world.startDate, true));
      }
      ids.push(id);
    }
    marketCache.set(seasonNumber, ids);
    return ids;
  };
  const result: CoachWorld = { coaches, opening, national, pull, marketIds };
  coachWorlds.set(world, result);
  return result;
}

/** A coach's attributes in a season: from 63 he loses one point a season on a seeded attribute (never below 1). */
export function coachInSeason(coach: HeadCoach, seasonNumber: number, startDate: string): HeadCoach {
  if (seasonNumber <= 1 || !coach.born) return coach;
  const startYear = Number(startDate.slice(0, 4));
  const attributes = { ...coach.attributes };
  let changed = false;
  for (let season = 2; season <= seasonNumber; season += 1) {
    const age = coachAge(coach.born, `${startYear + season - 1}-09-01`);
    if (age === null || age < COACH_RULES.declineFrom) continue;
    const key = COACH_ATTRIBUTES[coachHash(`decline|${coach.id}|${season}`) % COACH_ATTRIBUTES.length]!;
    if (attributes[key] > 1) { attributes[key] -= 1; changed = true; }
  }
  return changed ? { ...coach, attributes } : coach;
}

/** A coach's spell: a club (or null as a free agent) from a date, until the next spell. */
export interface CoachSpell { clubId: string | null; from: string; seasonNumber: number; reason: 'opening' | 'displaced' | 'sacked' | 'appointed' | 'market' }
/** Who coaches where after a set of board changes: each club's coach (or the manager), the free agents and each coach's spells. */
export interface CoachPlaces { clubs: Readonly<Record<string, string>>; free: readonly string[]; spells: Readonly<Record<string, readonly CoachSpell[]>> }

type PlacesContext = WorldContext & { board?: { restarts?: readonly BoardRestart[] } } & Partial<Pick<SeasonState, 'seasonNumber'>>;
const placesCache = new WeakMap<CareerWorld, WeakMap<readonly BoardRestart[], Map<string, CoachPlaces>>>();
const NO_RESTARTS: readonly BoardRestart[] = Object.freeze([]);

/** The world's start date of a season (its first Saturday is enough for ages and market dates). */
const seasonDate = (world: CareerWorld, seasonNumber: number) => `${Number(world.startDate.slice(0, 4)) + seasonNumber - 1}${world.startDate.slice(4)}`;

/**
 * Who coaches where, replayed from the opening coaches and the board's changes up to a career point (all of them by
 * default), through `seasonNumber` (the career's current season by default: its new market coaches and retirements).
 */
export function coachPlaces(context: PlacesContext, through?: { seasonNumber: number; round: number; phase: BoardRestart['phase'] }): CoachPlaces {
  const world = worldOf(context), restarts = context.board?.restarts ?? NO_RESTARTS;
  const seasonNumber = through?.seasonNumber ?? context.seasonNumber ?? 1;
  const limit = through ? careerPointKey(through.seasonNumber, through.round, through.phase) : Infinity;
  const key = `${seasonNumber}|${limit}`;
  let byRestarts = placesCache.get(world);
  if (!byRestarts) { byRestarts = new WeakMap(); placesCache.set(world, byRestarts); }
  let cache = byRestarts.get(restarts);
  if (!cache) { cache = new Map(); byRestarts.set(restarts, cache); }
  const known = cache.get(key);
  if (known) return known;
  const result = replayPlaces(world, [...restarts].filter(restart => careerPointKey(restart.seasonNumber, restart.round, restart.phase) < limit).sort((a, b) => careerPointKey(a.seasonNumber, a.round, a.phase) - careerPointKey(b.seasonNumber, b.round, b.phase)), seasonNumber);
  cache.set(key, result);
  return result;
}

function replayPlaces(world: CareerWorld, restarts: readonly BoardRestart[], throughSeason: number): CoachPlaces {
  const pool = coachWorld(world), clubs: Record<string, string> = Object.fromEntries(pool.opening);
  const spells: Record<string, CoachSpell[]> = {};
  const addSpell = (coachId: string, spell: CoachSpell) => { (spells[coachId] ??= []).push(spell); };
  for (const [clubId, coachId] of pool.opening) addSpell(coachId, { clubId, from: world.startDate, seasonNumber: 1, reason: 'opening' });
  let free: string[] = [];
  let season = 0;
  const openSeason = (target: number) => {
    while (season < target) {
      season += 1;
      const date = seasonDate(world, season);
      // Free agents past the retirement age leave the game at a new season.
      if (season > 1) free = free.filter(id => (coachAge(pool.coaches.get(id)!.born, date) ?? 0) <= COACH_RULES.retireAfter);
      for (const id of pool.marketIds(season)) { free.push(id); addSpell(id, { clubId: null, from: date, seasonNumber: season, reason: 'market' }); }
    }
  };
  openSeason(1);
  for (const restart of restarts) {
    openSeason(restart.seasonNumber);
    const current = clubs[restart.clubId];
    if (restart.coach === 'manager') {
      if (current && current !== MANAGER_COACH) { free.push(current); addSpell(current, { clubId: null, from: restart.date, seasonNumber: restart.seasonNumber, reason: 'displaced' }); }
      clubs[restart.clubId] = MANAGER_COACH;
      continue;
    }
    const sacked = current && current !== MANAGER_COACH ? current : null;
    if (sacked) { free.push(sacked); addSpell(sacked, { clubId: null, from: restart.date, seasonNumber: restart.seasonNumber, reason: 'sacked' }); }
    const hired = hireFromMarket(world, pool, free.filter(id => id !== sacked), restart);
    free = free.filter(id => id !== hired);
    clubs[restart.clubId] = hired;
    addSpell(hired, { clubId: restart.clubId, from: restart.date, seasonNumber: restart.seasonNumber, reason: 'appointed' });
  }
  openSeason(throughSeason);
  return { clubs, free, spells };
}

/**
 * The free agent a club hires: the best reputation within its pull (plus `COACH_RULES.reach`), ties by a seeded order;
 * a club out of reach of every free agent takes the least known one; with nobody free, a new generated coach.
 */
function hireFromMarket(world: CareerWorld, pool: CoachWorld, free: readonly string[], restart: BoardRestart): string {
  const pull = pool.pull.get(restart.clubId) ?? 40, tie = (id: string) => coachHash(`hire|${restart.clubId}|${restart.seasonNumber}|${restart.round}|${restart.phase}|${id}`);
  const reputation = (id: string) => pool.coaches.get(id)!.reputation;
  const within = free.filter(id => reputation(id) <= pull + COACH_RULES.reach);
  if (within.length) return [...within].sort((a, b) => reputation(b) - reputation(a) || tie(a) - tie(b))[0]!;
  if (free.length) return [...free].sort((a, b) => reputation(a) - reputation(b) || tie(a) - tie(b))[0]!;
  const id = `coach-hire-${restart.clubId}-s${restart.seasonNumber}-r${restart.round}-${restart.phase}`;
  if (!pool.coaches.has(id)) {
    const taken = new Set([...pool.coaches.values()].map(coach => coach.name)), key = `hire|${id}`;
    // Format 85: a promoted next-division club has its country (`clubCountry`); older careers find only opening leagues.
    const country = clubCountry(world, restart.clubId);
    const { name, nationality } = generatedName(country, key, taken);
    (pool.coaches as Map<string, HeadCoach>).set(id, estimateCoach(id, { name, born: generatedBorn(key, world.startDate), nationality, since: null, titles: NO_TITLES }, worldClubLevel(world, restart.clubId), world.startDate, true));
  }
  return id;
}

/** A person by id, with his attributes in the career's current season. */
export function headCoach(context: PlacesContext, coachId: string): HeadCoach | undefined {
  const world = worldOf(context), coach = coachWorld(world).coaches.get(coachId);
  return coach && coachInSeason(coach, context.seasonNumber ?? 1, world.startDate);
}

/** A club's head coach now: a person, the manager (`'manager'`) or undefined in careers without real coaches. */
export function clubHeadCoach(state: PlacesContext & Partial<Pick<SeasonState, 'coaches'>>, clubId: string): HeadCoach | typeof MANAGER_COACH | undefined {
  if (!state.coaches) return undefined;
  const id = coachPlaces(state).clubs[clubId];
  return id === MANAGER_COACH ? MANAGER_COACH : id ? headCoach(state, id) : undefined;
}

/** A coach's current job in words: a club's id, or null for a free agent; undefined when he is not in this career. */
export function coachClub(state: PlacesContext, coachId: string): string | null | undefined {
  const places = coachPlaces(state);
  const club = Object.entries(places.clubs).find(([, id]) => id === coachId)?.[0];
  return club ?? (places.free.includes(coachId) ? null : undefined);
}

const slider = (value: number) => Math.round(clamp(value, 0.2, 0.75) * 20) / 20;
const mean = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 10;

/**
 * A computer club's instructions before a game: its coach's style, moved towards what suits the starting five by his
 * Tactics attribute (a good tactician fits his plan to his players). Sliders stay within 0.2-0.75, in steps of 0.05.
 */
export function coachTactics(coach: HeadCoach, five: readonly Player[]): Tactics {
  const style = { tempo: 0.5 + (coach.style.pace - 10) * 0.03, outsideShare: 0.45 + (coach.style.shooting - 10) * 0.016, pressure: 0.5 + (coach.style.pressure - 10) * 0.015 };
  const skill = (key: 'passing' | 'threePoint' | 'twoPoint' | 'defense' | 'stamina') => mean(five.map(player => player.attributes[key]));
  const fit = { tempo: 0.5 + (skill('passing') - 10) * 0.02, outsideShare: 0.45 + (skill('threePoint') - skill('twoPoint')) * 0.04, pressure: 0.5 + (skill('defense') - 10) * 0.025 + (skill('stamina') - 10) * 0.01 };
  const weight = (coach.attributes.tactics - 1) / 19 * 0.35;
  return { tempo: slider(style.tempo * (1 - weight) + fit.tempo * weight), outsideShare: slider(style.outsideShare * (1 - weight) + fit.outsideShare * weight), pressure: slider(style.pressure * (1 - weight) + fit.pressure * weight) };
}

/**
 * Youth trust in a computer club's league games: a coach whose youth trust is 14 or more starts his best healthy
 * player of 22 or under when he is at most 4 (trust 14-16) or 7 (17 and more) rating points below the weakest
 * planned starter of his position (else of the five). Other coaches keep the planned five.
 */
export function youthTrustFive(coach: HeadCoach, players: readonly Player[], planned: readonly string[], unavailable: ReadonlySet<string>, isYoung: (playerId: string) => boolean): string[] {
  const gap = coach.style.youthTrust >= 17 ? 7 : coach.style.youthTrust >= 14 ? 4 : null;
  if (gap === null || planned.length < 5) return [...planned];
  const byId = new Map(players.map(player => [player.id, player]));
  if (planned.some(id => !byId.has(id))) return [...planned];
  const rating = (id: string) => overallRating(byId.get(id)!.attributes, byId.get(id)!.position);
  if (planned.some(id => isYoung(id) && !unavailable.has(id))) return [...planned];
  const candidate = players.filter(player => !planned.includes(player.id) && !unavailable.has(player.id) && isYoung(player.id)).sort((a, b) => rating(b.id) - rating(a.id) || (a.id < b.id ? -1 : 1))[0];
  if (!candidate) return [...planned];
  const same = planned.filter(id => byId.get(id)!.position === candidate.position);
  const weakest = [...(same.length ? same : planned)].sort((a, b) => rating(a) - rating(b) || (a < b ? -1 : 1))[0]!;
  return rating(candidate.id) >= rating(weakest) - gap ? planned.map(id => id === weakest ? candidate.id : id) : [...planned];
}

/** The team side's tactics for a computer club with a head coach, or null (the manager, or no real coaches). */
export function computerCoachTactics(state: PlacesContext & Partial<Pick<SeasonState, 'coaches' | 'managedClubId'>>, team: Team, lineup: readonly string[]): Tactics | null {
  if (!state.coaches || team.id === state.managedClubId) return null;
  const coach = clubHeadCoach(state, team.id);
  if (!coach || coach === MANAGER_COACH) return null;
  const five = lineup.map(id => team.players.find(player => player.id === id)).filter((player): player is Player => !!player);
  return coachTactics(coach, five.length ? five : team.players.slice(0, 5));
}

// Format 86: head coaches steer their clubs (`src/world/coach-steering.ts`).

/** Whether this career's head coaches steer training, rotation and signings (format 86, `coaches-2`). */
export const steersCoaches = (state: Partial<Pick<SeasonState, 'coaches'>>): boolean => state.coaches?.model === COACH_STEERING_MODEL;

type SteeringContext = PlacesContext & Partial<Pick<SeasonState, 'coaches'>>;

/**
 * Every club's head coach before a career point (changes recorded before it count), for the steering rules: a person's
 * attributes in that season with his style, or the manager's attributes in that season (no style: he decides himself).
 * Undefined in careers without steering. A club without a head coach (a promoted club before its first change) is absent.
 */
export function steeringCoaches(context: SteeringContext, point: { seasonNumber: number; round: number; phase: BoardRestart['phase'] }): Readonly<Record<string, SteeringCoach>> | undefined {
  if (!steersCoaches(context) || !context.coaches) return undefined;
  const world = worldOf(context), pool = coachWorld(world), places = coachPlaces(context, point), manager = managerAttributes(context.coaches, point.seasonNumber);
  const result: Record<string, SteeringCoach> = {};
  for (const [clubId, coachId] of Object.entries(places.clubs)) {
    if (coachId === MANAGER_COACH) { result[clubId] = { attributes: manager, style: null }; continue; }
    const coach = pool.coaches.get(coachId);
    if (coach) { const now = coachInSeason(coach, point.seasonNumber, world.startDate); result[clubId] = { attributes: now.attributes, style: now.style }; }
  }
  return result;
}

/**
 * The head coaches during the training that follows week `afterRound`'s games: changes made before that week ends
 * count; a change before the next week's games (an in-season review, a resignation) comes after this training.
 */
export function trainingCoaches(context: SteeringContext, seasonNumber: number, afterRound: number): Readonly<Record<string, SteeringCoach>> | undefined {
  return steeringCoaches(context, { seasonNumber, round: afterRound + 1, phase: 'season' });
}

/** A club's head coach at the current week (changes before this week's games count only from the next week), for morale. */
export function clubMoraleImpact(state: SteeringContext & Pick<SeasonState, 'seasonNumber' | 'round'>, clubId: string): number {
  const coach = steeringCoaches(state, { seasonNumber: state.seasonNumber, round: state.round, phase: 'season' })?.[clubId];
  return coach ? moraleImpact(coach.attributes) : 0;
}

/**
 * A computer side's rotation by its head coach for a game of week `round` on `date` (format 86), or null (the manager,
 * no coach, older careers). Coach changes before that week's games count; later ones (season end) do not.
 */
export function computerCoachRotation(state: SteeringContext & Partial<Pick<SeasonState, 'managedClubId' | 'academy'>>, team: Team, game: { seasonNumber: number; round: number; date: string }): CoachRotation | null {
  if (!steersCoaches(state) || team.id === state.managedClubId) return null;
  const coach = steeringCoaches(state, { seasonNumber: game.seasonNumber, round: game.round, phase: 'end' })?.[team.id];
  if (!coach?.style) return null;
  return coachRotation({ attributes: coach.attributes, style: coach.style }, team.players.filter(player => isSteeringYoung(state, player.id, game.date)).map(player => player.id));
}

/**
 * How well a player fits a computer club's head coach (format 86), in the club's rating units; null when the club's
 * signings follow no coach (the manager's club, no coach, older careers). `skill` reads what the club knows.
 */
export function clubStyleFit(state: SteeringContext & Partial<Pick<SeasonState, 'managedClubId' | 'academy' | 'date'>>, clubId: string): ((playerId: string, skill: (key: keyof SkillAttributes) => number) => number) | null {
  if (!steersCoaches(state) || clubId === state.managedClubId) return null;
  const coach = clubHeadCoach(state, clubId);
  if (!coach || coach === MANAGER_COACH) return null;
  const date = state.date ?? worldOf(state).startDate;
  return (playerId, skill) => styleFit(coach, skill, isSteeringYoung(state, playerId, date));
}

// The manager's own attributes.

/** The manager's starting attributes: 10 each, moved by age (under 35 or 50 and over) and a seeded -1/0/+1 spread. */
export function managerStartAttributes(manager: ManagerProfile | null, seed: number, date: string): CoachAttributes {
  const age = manager ? coachAge(manager.dateOfBirth, date) : null;
  const ageShift: Partial<CoachAttributes> = age === null ? {} : age < 35 ? { adaptability: 1, youth: 1, discipline: -1 } : age >= 50 ? { discipline: 1, motivation: 1, adaptability: -1 } : {};
  return Object.fromEntries(COACH_ATTRIBUTES.map(key => [key, clamp(10 + (ageShift[key] ?? 0) + (coachHash(`manager|${seed}|${key}`) % 3) - 1, 1, 20)])) as CoachAttributes;
}

/** Format 86: `coaches-2` when head coaches also steer training, rotation and signings (option `coachSteering`). */
export function createCoaches(manager: ManagerProfile | null, seed: number, date: string, steering = false): SeasonCoaches {
  return { model: steering ? COACH_STEERING_MODEL : COACHES_MODEL, manager: { start: managerStartAttributes(manager, seed, date), seasons: [] } };
}

/** The manager's attributes after the seasons recorded before `beforeSeason` (all of them by default). */
export function managerAttributes(coaches: SeasonCoaches, beforeSeason = Infinity): CoachAttributes {
  const attributes = { ...coaches.manager.start };
  for (const season of coaches.manager.seasons) if (season.seasonNumber < beforeSeason) for (const key of COACH_ATTRIBUTES) attributes[key] = clamp(attributes[key] + (season.changes[key] ?? 0), 1, 20);
  return attributes;
}

/** The reputation the manager's coaching adds (format 82): `reputationPerPoint` for each point of his overall rating above 10. */
export function managerCoachingReputation(coaches: SeasonCoaches | undefined, beforeSeason = Infinity): number {
  if (!coaches) return 0;
  return (coachOverall(managerAttributes(coaches, beforeSeason)) - 10) * COACH_RULES.reputationPerPoint;
}

/** The facts a season's change of the manager's attributes rests on. */
export interface ManagerSeasonFacts {
  /** Final board confidence at the club he ran at the season's end, or null without a club. */
  confidence: number | null;
  /** Won his league (champion) or a European competition with his club. */
  trophy: boolean;
  /** His team scored more than it conceded (decides Offence or Defence for a trophy). */
  scoredMore: boolean;
  /** Average overall gain of his under-23 players over the season (null: none). */
  youthGain: number | null;
  /** Dismissed during or at the end of the season. */
  dismissed: boolean;
  /** His age at the season's end, when known. */
  age: number | null;
}

/** One season's change of the manager's attributes, bounded: ±1 per attribute and at most ±2 in total. */
export function managerSeasonChange(start: CoachAttributes, facts: ManagerSeasonFacts, seasonNumber: number): ManagerCoachSeason {
  const ups: { key: CoachAttribute; reason: string }[] = [], downs: { key: CoachAttribute; reason: string }[] = [];
  if (facts.confidence !== null && facts.confidence >= 70) ups.push({ key: 'tactics', reason: 'The board was very pleased with the season.' }, { key: 'motivation', reason: 'The players followed you all season.' });
  if (facts.confidence !== null && facts.confidence < 35) downs.push({ key: start.tactics >= start.motivation ? 'tactics' : 'motivation', reason: 'A poor season: the board lost faith.' });
  if (facts.trophy) ups.push({ key: facts.scoredMore ? 'offence' : 'defence', reason: 'You won a trophy.' });
  if (facts.youthGain !== null && facts.youthGain >= 3) ups.push({ key: 'development', reason: 'Your young players improved a lot.' }, { key: 'youth', reason: 'You gave young players a real chance.' });
  if (facts.dismissed) { downs.push({ key: 'discipline', reason: 'You were dismissed.' }); ups.push({ key: 'adaptability', reason: 'You learned from losing your job.' }); }
  if (facts.age !== null && facts.age >= 60 && seasonNumber % 2 === 0) {
    const highest = [...COACH_ATTRIBUTES].sort((a, b) => start[b] - start[a] || COACH_ATTRIBUTES.indexOf(a) - COACH_ATTRIBUTES.indexOf(b))[0]!;
    downs.push({ key: highest, reason: 'Age is starting to tell.' });
  }
  const changes: Partial<Record<CoachAttribute, number>> = {}, reasons: string[] = [];
  let up = 0, down = 0;
  for (const item of ups) {
    if (up >= COACH_RULES.seasonBudget || changes[item.key] !== undefined || start[item.key] >= 20) continue;
    changes[item.key] = 1; up += 1; reasons.push(item.reason);
  }
  for (const item of downs) {
    if (down >= COACH_RULES.seasonBudget || changes[item.key] !== undefined || start[item.key] <= 1) continue;
    changes[item.key] = -1; down += 1; reasons.push(item.reason);
  }
  return { seasonNumber, changes, reasons };
}

/**
 * The facts of the season just completed for the manager's attributes (`state` is the completed season, before the
 * rollover): the final board verdict and trophies of the club he ran at its end, his under-23 players' growth since
 * the season's start (the season-start rosters against the squads now) and whether he was dismissed in it.
 */
export function managerSeasonFacts(state: SeasonState): ManagerSeasonFacts {
  const seasonNumber = state.seasonNumber, clubId = managedClubFor(state, seasonNumber, false), rounds = seasonRounds(state);
  const employed = !!clubId && state.clubs.some(club => club.id === clubId);
  const verdict = employed ? seasonVerdict(state.board, clubId, seasonNumber, rounds) : null;
  const domestic = employed && getPostseasons(state, seasonNumber).some(postseason => postseason.outcome.champion === clubId);
  const european = employed && !!worldOf(state).europeanCompetitions && getEuropeanCompetitions(state, seasonNumber).some(competition => competition.outcome.champion === clubId);
  const games = state.fixtures.filter(fixture => fixture.result && isRegularFixture(fixture) && (fixture.homeClubId === clubId || fixture.awayClubId === clubId));
  const scored = games.reduce((sum, fixture) => sum + fixture.result!.score[fixture.homeClubId === clubId ? 'home' : 'away'], 0);
  const conceded = games.reduce((sum, fixture) => sum + fixture.result!.score[fixture.homeClubId === clubId ? 'away' : 'home'], 0);
  let youthGain: number | null = null;
  if (employed) {
    const start = state.rosters.find(roster => roster.clubId === clubId), now = state.clubs.find(club => club.id === clubId)!;
    const end = (state.date), gains = (start?.players ?? []).flatMap(before => {
      const after = now.players.find(player => player.id === before.id);
      return after && isYouthPlayer(state, clubId, before.id, end, 22) ? [overallRating(after.attributes, after.position) - overallRating(before.attributes, before.position)] : [];
    });
    youthGain = gains.length ? gains.reduce((sum, gain) => sum + gain, 0) / gains.length : null;
  }
  const dismissed = state.career.moves.some(move => move.seasonNumber === seasonNumber && move.reason === 'dismissed');
  return { confidence: verdict?.confidence ?? null, trophy: domestic || european, scoredMore: scored >= conceded, youthGain, dismissed, age: state.manager ? coachAge(state.manager.dateOfBirth, state.date) : null };
}

/** At the rollover (`state` is the completed season): the manager's attributes change by the season's facts. */
export function recordManagerSeason(state: SeasonState): SeasonCoaches | undefined {
  if (!state.coaches) return undefined;
  const change = managerSeasonChange(managerAttributes(state.coaches), managerSeasonFacts(state), state.seasonNumber);
  return { ...state.coaches, manager: { ...state.coaches.manager, seasons: [...state.coaches.manager.seasons, change] } };
}

/** One row of a coach list: who, his job now and his overall rating. */
export interface CoachListRow { coachId: string; name: string; nationality: string | null; age: number | null; overall: number; reputation: number; clubId: string | null; generated: boolean }

/** A coach's row (his attributes in the current season). */
export function coachRow(state: PlacesContext & Pick<SeasonState, 'date'>, coachId: string, clubId: string | null): CoachListRow | null {
  const coach = headCoach(state, coachId);
  return coach ? { coachId, name: coach.name, nationality: coach.nationality, age: coachAge(coach.born, state.date), overall: coachOverall(coach.attributes), reputation: coach.reputation, clubId, generated: !!coach.generated } : null;
}

/**
 * The Staff page's head coaches: the coach of every club in the given clubs (the manager's league), the manager's own
 * club marked by the manager (no row), and every free agent, best reputation first (the displaced real coach first).
 */
export function headCoachLists(state: SeasonState, clubIds: readonly string[]): { clubs: (CoachListRow & { clubId: string })[]; free: CoachListRow[] } {
  if (!state.coaches) return { clubs: [], free: [] };
  const places = coachPlaces(state);
  const clubs = clubIds.flatMap(clubId => { const id = places.clubs[clubId]; const row = id && id !== MANAGER_COACH ? coachRow(state, id, clubId) : null; return row ? [{ ...row, clubId }] : []; });
  const free = places.free.flatMap(id => { const row = coachRow(state, id, null); return row ? [row] : []; }).sort((a, b) => b.reputation - a.reputation || a.name.localeCompare(b.name));
  return { clubs, free };
}

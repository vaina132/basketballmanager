/**
 * Rating balance (owner decisions, 22 November 2026): the pack's abilities are lined up by position, lowered for a
 * bench role (few minutes per game) and pulled towards the average when they rest on few minutes. Pure and
 * dependency-free, so the publishing function (Deno), the offline preview script (Node) and the tests all run exactly
 * the same calculation on the same pack contents.
 *
 * Why: every ability (1-20) is scored against all players on one shared scale, so centres own the top of two-point
 * shooting and rebounding and point guards the top of passing. The overall rating weighs exactly those skills most
 * for those positions, so centres and point guards averaged 10-17 overall points above small forwards (world-10:
 * C 65, PG 63.5, PF 58.8, SG 54, SF 47.8 for players with 300+ minutes), and small samples added stars (93 overall
 * on 238 minutes).
 *
 * 1. Position balance: a player's standing is measured against players of his own position. In the reference pool
 *    (rated players with `poolMinutes` or more at clubs in a top division or a European competition), each player's
 *    position-weighted skill level (the level behind the overall rating) gets its percentile within his position,
 *    and that percentile is read off one common ladder shared by all positions. So the best tenth of centres and the best tenth of small forwards reach the same
 *    overall ratings, and each position keeps the pool's average and spread. Players outside the pool's range
 *    continue the line at the position's slope. The player's whole skill profile moves by the same amount, so every
 *    individual skill keeps the shared scale's real differences between positions that the match engine relies on: a
 *    centre still rebounds and finishes inside far more than a guard, a point guard still passes most. A separate
 *    position scale for each skill was rejected: it would give an average guard the rebounding of an average centre,
 *    and an average centre the passing of an average point guard.
 * 2. Role (position-balance-2, owner approved 22 November 2026): the ratings come from production per 40 minutes, so
 *    an efficient bench player matched a starter with the same production. A player's role is his minutes per game
 *    (`ratingMinutes` / `ratingGames`, pulled towards his position's average over the first `rolePriorGames` games)
 *    minus the average of his club's `roleStarters` most-used rated players: about 0 for a starter, well below 0 for
 *    a bench player. Roles are compared within a position (centres play fewer minutes than guards everywhere): in
 *    deviations from the position's average role in the reference pool. A role below that average costs
 *    `roleWeight` x the common spread per deviation (at most `roleLimit` deviations), after the ladder. Roles above
 *    the average change nothing, so starters keep their position-balance-1 rating and a starter on a weak team gains
 *    nothing for his long minutes; the ladder and its scale are unchanged, so league and club differences stay as
 *    they were. Each position's pool average drops by its average cost (`roleCost`, about the same for every
 *    position), so the positions stay level with one another. Players without games, and clubs with fewer than
 *    `roleStarters` players with games, have no role cost. With `roleWeight` 0, or without games, the calculation
 *    is exactly position-balance-1 (world-11 and world-12).
 * 3. Few minutes: the balanced profile is blended with the average player of his position in his league (the
 *    position's average profile, moved to the league's level) with a Bayesian weight m / (m + priorMinutes),
 *    rescaled so that `fullMinutes` or more keep the player's own ratings in full.
 *
 * Players without statistics (`all-abilities` estimated, no `ratingMinutes`) are unchanged; the game lifts them to
 * their club's level at career start, and the game's own fairness step still pulls ratings under 600 minutes towards
 * the club's level. Potential is not touched: it comes from age, not from statistics. Old careers carry their own
 * world, so a new pack never changes them.
 */

export type BalancePosition = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export type BalanceSkill = 'twoPoint' | 'threePoint' | 'freeThrow' | 'passing' | 'defense' | 'rebounding' | 'stamina';
export type BalanceAttributes = Record<BalanceSkill, number>;

export interface BalancePlayer {
  id: string; clubId: string; position: BalancePosition; attributes: BalanceAttributes; estimated: string[]; ratingMinutes?: number;
  /** Games behind the ratings (the rating row's recency-weighted games, weighted like `ratingMinutes`); packs from world-13 on. */
  ratingGames?: number;
}
export interface BalanceCompetition { id: string; name: string; kind: string; tier: number; clubIds: string[] }

export const BALANCE_SKILLS: readonly BalanceSkill[] = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
export const BALANCE_POSITIONS: readonly BalancePosition[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export const RATING_BALANCE_RULES = Object.freeze({
  id: 'position-balance-2',
  /** The overall rating's position weights (src/world/overall-rating.ts, OVR_POSITION_WEIGHTS; a test keeps them equal). */
  weights: Object.freeze({
    PG: Object.freeze({ twoPoint: 0.15, threePoint: 0.20, freeThrow: 0.08, passing: 0.27, defense: 0.15, rebounding: 0.05, stamina: 0.10 }),
    SG: Object.freeze({ twoPoint: 0.18, threePoint: 0.26, freeThrow: 0.10, passing: 0.14, defense: 0.17, rebounding: 0.06, stamina: 0.09 }),
    SF: Object.freeze({ twoPoint: 0.20, threePoint: 0.20, freeThrow: 0.08, passing: 0.10, defense: 0.18, rebounding: 0.14, stamina: 0.10 }),
    PF: Object.freeze({ twoPoint: 0.24, threePoint: 0.12, freeThrow: 0.06, passing: 0.08, defense: 0.20, rebounding: 0.22, stamina: 0.08 }),
    C: Object.freeze({ twoPoint: 0.26, threePoint: 0.04, freeThrow: 0.06, passing: 0.07, defense: 0.22, rebounding: 0.28, stamina: 0.07 }),
  }) as Readonly<Record<BalancePosition, Readonly<BalanceAttributes>>>,
  /** The reference pool: rated players with at least this many minutes at clubs in a top division or a European competition (the ratings' own scale rule). */
  poolMinutes: 300,
  /** Full weight for a player's own statistics from this many minutes. */
  fullMinutes: 900,
  /** The prior is worth this many minutes in the Bayesian blend m / (m + priorMinutes). */
  priorMinutes: 300,
  /** A league's level is measured from its players with at least this many minutes (each weighted by his minutes, at most fullMinutes). */
  levelMinutes: 300,
  /** A league with fewer measured players uses the pool's average level. */
  minimumLeaguePlayers: 8,
  /** Role: the cost of a bench role, in common spreads (about 13 overall points) per deviation below the position's average role. */
  roleWeight: 0.3,
  /** Role: minutes per game are pulled towards the position's average with this many games (the ratings' own priorGames). */
  rolePriorGames: 10,
  /** Role: a bench role costs at most this many deviations. */
  roleLimit: 2,
  /** Role: a club's starters are its this many most-used rated players (clubs with fewer players with games give a neutral role). */
  roleStarters: 5,
});

/**
 * Options for checks and the offline preview: another role weight (0 gives position-balance-1), games read another
 * way than `ratingGames`, and a label for where the games came from (recorded in the summary).
 */
export interface BalanceOptions<T extends BalancePlayer = BalancePlayer> { roleWeight?: number; gamesOf?: (player: T) => number | undefined; gamesSource?: string }

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const clampSkill = (value: number) => Math.max(1, Math.min(20, value));
/** Levels are compared at a millionth of a point, so equal profiles always tie whatever the order of additions. */
const exact = (value: number) => Math.round(value * 1e6) / 1e6;

/** The position-weighted skill level (1-20) behind the overall rating: OVR = 8 x level - 36. */
export function weightedLevel(attributes: BalanceAttributes, position: BalancePosition): number {
  const weights = RATING_BALANCE_RULES.weights[position];
  let total = 0;
  for (const key of BALANCE_SKILLS) total += weights[key] * attributes[key];
  return exact(total);
}

/**
 * Whole 1-20 skills for a profile of unrounded values. Rounding each skill on its own would move every player of a
 * position by the same whole point (8 overall points) whenever the move is about the same; instead each skill is
 * rounded down or up so that the position-weighted level comes closest to the unrounded one (each skill stays within
 * one point of its own value; among equally close levels, the skills nearest their own values win).
 */
export function roundProfile(values: BalanceAttributes, position: BalancePosition): BalanceAttributes {
  const weights = RATING_BALANCE_RULES.weights[position];
  let target = 0;
  for (const key of BALANCE_SKILLS) target += weights[key] * values[key];
  const low = BALANCE_SKILLS.map(key => clampSkill(Math.floor(values[key]))), high = BALANCE_SKILLS.map(key => clampSkill(Math.floor(values[key]) + 1));
  let best: number[] = low, bestCost = Infinity;
  for (let mask = 0; mask < 1 << BALANCE_SKILLS.length; mask += 1) {
    const chosen = BALANCE_SKILLS.map((_, index) => (mask >> index) & 1 ? high[index]! : low[index]!);
    let level = 0, distance = 0;
    BALANCE_SKILLS.forEach((key, index) => { level += weights[key] * chosen[index]!; distance += Math.abs(chosen[index]! - values[key]); });
    const cost = exact(Math.abs(level - target)) + distance / 100;
    if (cost < bestCost) { best = chosen; bestCost = cost; }
  }
  return Object.fromEntries(BALANCE_SKILLS.map((key, index) => [key, best[index]!])) as BalanceAttributes;
}

/** The share of a player's own statistics that is kept: m / (m + prior), rescaled to reach 1 at fullMinutes. */
export function statisticsWeight(minutes: number): number {
  const { fullMinutes, priorMinutes } = RATING_BALANCE_RULES;
  if (!(minutes > 0)) return 0;
  return Math.min(1, (minutes / (minutes + priorMinutes)) / (fullMinutes / (fullMinutes + priorMinutes)));
}

/** Minutes per game pulled towards `average` over the first rolePriorGames games: (m + prior x average) / (g + prior). */
export function shrunkMinutesPerGame(minutes: number, games: number, average: number): number {
  const prior = RATING_BALANCE_RULES.rolePriorGames;
  return (minutes + prior * average) / (games + prior);
}

const isRated = (player: BalancePlayer) => typeof player.ratingMinutes === 'number' && Number.isFinite(player.ratingMinutes) && !player.estimated.includes('all-abilities');

/**
 * The league a club's players are compared with: the EuroLeague for its clubs (they play most of their minutes at
 * that level), otherwise the club's domestic league (its highest), otherwise its European competition.
 */
export function leagueOfClubs(competitions: readonly BalanceCompetition[]): Map<string, string> {
  const rank = (competition: BalanceCompetition) => competition.kind === 'european' && competition.tier === 1 ? 0 : competition.kind === 'domestic' ? competition.tier : 10 + competition.tier;
  const ordered = [...competitions].sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const league = new Map<string, string>();
  for (const competition of ordered) for (const clubId of competition.clubIds) if (!league.has(clubId)) league.set(clubId, competition.name);
  return league;
}

/** A sorted ladder of distinct values with their mid-rank percentiles (ties share the middle of their ranks). */
interface Ladder { values: number[]; percentiles: number[] }
function ladder(levels: readonly number[]): Ladder {
  const sorted = [...levels].sort((a, b) => a - b), values: number[] = [], percentiles: number[] = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end < sorted.length && sorted[end] === sorted[start]) end += 1;
    values.push(sorted[start]!); percentiles.push((start + (end - start) / 2) / sorted.length);
    start = end;
  }
  return { values, percentiles };
}
/** Piecewise-linear lookup of `x` in `from`, read off `to` (both ascending, same length; ends held). */
function interpolate(from: readonly number[], to: readonly number[], x: number): number {
  if (x <= from[0]!) return to[0]!;
  if (x >= from[from.length - 1]!) return to[to.length - 1]!;
  let low = 0, high = from.length - 1;
  while (high - low > 1) { const middle = (low + high) >> 1; if (from[middle]! <= x) low = middle; else high = middle; }
  return to[low]! + (to[high]! - to[low]!) * (x - from[low]!) / (from[high]! - from[low]!);
}
const meanOf = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const spreadOfValues = (values: readonly number[]) => { const average = meanOf(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length); };

export interface PositionBalance { players: number; level: number; spread: number; slope: number; profile: BalanceAttributes; minutesPerGame: number; roleAverage: number; roleSpread: number; roleCost: number }
export interface RatingBalanceSummary {
  model: string; poolPlayers: number; commonLevel: number; commonSpread: number;
  positions: Record<BalancePosition, PositionBalance>; leagues: Record<string, { players: number; level: number }>;
  changedPlayers: number; rules: { poolMinutes: number; fullMinutes: number; priorMinutes: number; levelMinutes: number; roleWeight: number; rolePriorGames: number; roleLimit: number; roleStarters: number };
  role: { gamesSource: string; playersWithGames: number; clubsWithStarters: number; poolPlayersWithGames: number };
  note: string;
}

/** The balanced pack players (same order; players without statistics unchanged) and a summary for the pack's source. */
export function balanceRatings<T extends BalancePlayer>(players: readonly T[], competitions: readonly BalanceCompetition[], options: BalanceOptions<T> = {}): { players: T[]; summary: RatingBalanceSummary } {
  const rules = RATING_BALANCE_RULES;
  const roleWeight = options.roleWeight ?? rules.roleWeight;
  const gamesOf = options.gamesOf ?? ((player: T) => player.ratingGames);
  const league = leagueOfClubs(competitions);
  const topClubs = new Set(competitions.filter(competition => competition.kind === 'european' || competition.tier === 1).flatMap(competition => competition.clubIds));
  const rated = players.filter(isRated);
  const pool = rated.filter(player => player.ratingMinutes! >= rules.poolMinutes && topClubs.has(player.clubId));
  const gamesById = new Map<string, number>();
  for (const player of rated) { const games = gamesOf(player); if (typeof games === 'number' && Number.isFinite(games) && games > 0 && player.ratingMinutes! > 0) gamesById.set(player.id, games); }

  // Each position's average profile, level and spread in the pool, and the common level and spread over all of them.
  const positions = {} as Record<BalancePosition, PositionBalance>;
  const levelsOf = {} as Record<BalancePosition, number[]>;
  let poolLevel = 0, poolVariance = 0;
  for (const position of BALANCE_POSITIONS) {
    const members = pool.filter(player => player.position === position);
    if (members.length < 5) throw new Error(`Rating balance needs at least five ${position} players in the reference pool.`);
    const profile = {} as BalanceAttributes;
    for (const key of BALANCE_SKILLS) profile[key] = members.reduce((sum, player) => sum + player.attributes[key], 0) / members.length;
    const levels = members.map(player => weightedLevel(player.attributes, position));
    const level = meanOf(levels), spread = spreadOfValues(levels);
    // Role: the position's average minutes per game in the pool (players with games), the target of the pull for few games.
    const timed = members.filter(player => gamesById.has(player.id));
    const minutesPerGame = timed.length ? meanOf(timed.map(player => player.ratingMinutes! / gamesById.get(player.id)!)) : 0;
    positions[position] = { players: members.length, level, spread, slope: 1, profile, minutesPerGame, roleAverage: 0, roleSpread: 0, roleCost: 0 };
    levelsOf[position] = levels;
    poolLevel += members.length * level; poolVariance += members.length * spread ** 2;
  }
  const commonLevel = poolLevel / pool.length, commonSpread = Math.sqrt(poolVariance / pool.length);
  for (const position of BALANCE_POSITIONS) positions[position].slope = commonSpread / positions[position].spread;

  // Role: minutes per game (pulled for few games) against the club's starters, the average of its `roleStarters` most-used players.
  const minutesPerGameOf = new Map<string, number>(), clubMinutes = new Map<string, number[]>();
  for (const player of rated) {
    const games = gamesById.get(player.id);
    if (games === undefined) continue;
    const value = shrunkMinutesPerGame(player.ratingMinutes!, games, positions[player.position].minutesPerGame);
    minutesPerGameOf.set(player.id, value); clubMinutes.set(player.clubId, [...(clubMinutes.get(player.clubId) ?? []), value]);
  }
  const starters = new Map([...clubMinutes].filter(([, values]) => values.length >= rules.roleStarters).map(([clubId, values]) => [clubId, meanOf([...values].sort((a, b) => b - a).slice(0, rules.roleStarters))]));
  const gapOf = (player: BalancePlayer) => { const value = minutesPerGameOf.get(player.id), reference = starters.get(player.clubId); return value === undefined || reference === undefined ? undefined : value - reference; };
  for (const position of BALANCE_POSITIONS) {
    const gaps = pool.filter(player => player.position === position).map(gapOf).filter((gap): gap is number => gap !== undefined);
    if (gaps.length >= 5) { positions[position].roleAverage = meanOf(gaps); positions[position].roleSpread = spreadOfValues(gaps); }
  }
  /** The role within the position: the gap to the club's starters in deviations of the position's gaps in the pool (capped); 0 without games. */
  const roleOf = (player: BalancePlayer) => {
    const entry = positions[player.position], gap = gapOf(player);
    if (gap === undefined || !(entry.roleSpread > 0)) return 0;
    return Math.max(-rules.roleLimit, Math.min(rules.roleLimit, (gap - entry.roleAverage) / entry.roleSpread));
  };

  // The common ladder: every pool player's level, each position moved to the common average and spread.
  const common = ladder(BALANCE_POSITIONS.flatMap(position => levelsOf[position].map(level => exact(commonLevel + positions[position].slope * (level - positions[position].level)))));
  const ladders = Object.fromEntries(BALANCE_POSITIONS.map(position => {
    const own = ladder(levelsOf[position]);
    return [position, { ...own, targets: own.percentiles.map(percentile => interpolate(common.percentiles, common.values, percentile)) }];
  })) as Record<BalancePosition, Ladder & { targets: number[] }>;
  /** The balanced level: the player's percentile within his position read off the common ladder; outside the pool's range, the position's slope. */
  const ladderLevel = (level: number, position: BalancePosition) => {
    const own = ladders[position], last = own.values.length - 1, slope = positions[position].slope;
    if (level < own.values[0]!) return own.targets[0]! + slope * (level - own.values[0]!);
    if (level > own.values[last]!) return own.targets[last]! + slope * (level - own.values[last]!);
    return interpolate(own.values, own.targets, level);
  };
  // Role: a bench role costs roleWeight x the common spread per deviation below the position's average role.
  const benchOf = (player: BalancePlayer) => Math.max(0, -roleOf(player));
  for (const position of BALANCE_POSITIONS) positions[position].roleCost = roleWeight * commonSpread * meanOf(pool.filter(player => player.position === position).map(benchOf));
  const roleShiftOf = (player: BalancePlayer) => roleWeight === 0 ? 0 : -roleWeight * commonSpread * benchOf(player);
  const balancedLevel = (player: BalancePlayer) => ladderLevel(weightedLevel(player.attributes, player.position), player.position) + roleShiftOf(player);
  // The whole profile moves by the same amount (the position weights sum to 1).
  const moveOf = (player: BalancePlayer) => balancedLevel(player) - weightedLevel(player.attributes, player.position);

  // Each league's level on the balanced scale, from its measured players weighted by their minutes.
  const sums = new Map<string, { weight: number; total: number; players: number }>();
  for (const player of rated) {
    const name = league.get(player.clubId);
    if (!name || player.ratingMinutes! < rules.levelMinutes) continue;
    const weight = Math.min(player.ratingMinutes!, rules.fullMinutes), entry = sums.get(name) ?? { weight: 0, total: 0, players: 0 };
    entry.weight += weight; entry.total += weight * balancedLevel(player); entry.players += 1;
    sums.set(name, entry);
  }
  const leagues: Record<string, { players: number; level: number }> = {};
  for (const name of [...sums.keys()].sort()) { const entry = sums.get(name)!; leagues[name] = { players: entry.players, level: entry.total / entry.weight }; }
  const leagueLevel = (clubId: string) => { const entry = leagues[league.get(clubId) ?? '']; return entry && entry.players >= rules.minimumLeaguePlayers ? entry.level : commonLevel; };

  let changedPlayers = 0;
  const out = players.map(player => {
    if (!isRated(player)) return player;
    const entry = positions[player.position], move = moveOf(player), trust = statisticsWeight(player.ratingMinutes!);
    // The prior: the position's average profile at the league's level.
    const toLeague = leagueLevel(player.clubId) - entry.level, values = {} as BalanceAttributes;
    for (const key of BALANCE_SKILLS) {
      const prior = entry.profile[key] + toLeague;
      values[key] = prior + trust * (player.attributes[key] + move - prior);
    }
    const attributes = roundProfile(values, player.position);
    if (BALANCE_SKILLS.some(key => attributes[key] !== player.attributes[key])) changedPlayers += 1;
    return { ...player, attributes };
  });

  const summary: RatingBalanceSummary = {
    model: roleWeight === rules.roleWeight ? rules.id : `${rules.id} (role weight ${roleWeight})`, poolPlayers: pool.length, commonLevel: round(commonLevel, 3), commonSpread: round(commonSpread, 3),
    positions: Object.fromEntries(BALANCE_POSITIONS.map(position => { const entry = positions[position]; return [position, { players: entry.players, level: round(entry.level, 3), spread: round(entry.spread, 3), slope: round(entry.slope, 3), profile: Object.fromEntries(BALANCE_SKILLS.map(key => [key, round(entry.profile[key])])) as BalanceAttributes, minutesPerGame: round(entry.minutesPerGame), roleAverage: round(entry.roleAverage), roleSpread: round(entry.roleSpread), roleCost: round(entry.roleCost, 3) }]; })) as Record<BalancePosition, PositionBalance>,
    leagues: Object.fromEntries(Object.entries(leagues).map(([name, entry]) => [name, { players: entry.players, level: round(entry.level, 3) }])),
    changedPlayers, rules: { poolMinutes: rules.poolMinutes, fullMinutes: rules.fullMinutes, priorMinutes: rules.priorMinutes, levelMinutes: rules.levelMinutes, roleWeight, rolePriorGames: rules.rolePriorGames, roleLimit: rules.roleLimit, roleStarters: rules.roleStarters },
    role: { gamesSource: options.gamesSource ?? 'ratingGames (rating rows, recency-weighted games)', playersWithGames: gamesById.size, clubsWithStarters: starters.size, poolPlayersWithGames: pool.filter(player => gamesById.has(player.id)).length },
    note: 'Abilities lined up by position (a player\'s percentile within his position sets his overall level on one ladder shared by all positions; his whole skill profile moves with it, so each skill keeps its position\'s real profile), lowered for a bench role (minutes per game well below his club\'s five most-used players, compared within his position), so of two equally efficient players the one with starter minutes rates higher, and blended with the average player of the same position in the same league when they rest on fewer than 900 minutes (owner decisions, 22 November 2026).',
  };
  return { players: out, summary };
}

/**
 * v8 (NBA, 23 November 2026): one country's clubs (the USA: the NBA) are balanced on their own and every other club
 * exactly as before. The NBA's ratings are already on the shared European scale (rating-4), so its own pool keeps its
 * level and spread while its positions are lined up and its bench roles cost what they cost in Europe; the other
 * players, competitions and their order are those of a pack without that country, so they get identical ratings.
 * Without clubs of that country the result is exactly balanceRatings on the whole pack.
 */
export function balanceBySeparateCountry<T extends BalancePlayer>(players: readonly T[], competitions: readonly (BalanceCompetition & { country?: string | null })[], country: string, options: BalanceOptions<T> = {}): { players: T[]; summary: RatingBalanceSummary; usa: RatingBalanceSummary | null } {
  const own = competitions.filter(competition => competition.country === country);
  const ownClubs = new Set(own.flatMap(competition => competition.clubIds));
  const inside = players.filter(player => ownClubs.has(player.clubId));
  if (!inside.length) { const result = balanceRatings(players, competitions, options); return { ...result, usa: null }; }
  const rest = balanceRatings(players.filter(player => !ownClubs.has(player.clubId)), competitions.filter(competition => competition.country !== country), options);
  const separate = balanceRatings(inside, own, options);
  const byId = new Map<string, T>([...rest.players, ...separate.players].map(player => [player.id, player]));
  return { players: players.map(player => byId.get(player.id)!), summary: rest.summary, usa: separate.summary };
}

import type { CareerMove } from '../domain/career';
import type { CompetitionStage } from '../domain/competition';
import type { GrownRivalry, Rivalry, RivalryReason, SeasonRivalries, SeasonRivalryTable } from '../domain/rivalries';
import type { RosterSnapshot } from '../domain/roster';
import type { ArchivedFixture, DomesticDivisions, SeasonFixture, SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import type { CareerWorld, WorldContext } from '../domain/world';
import { clubCountry, worldOf } from './career-world';
import { seasonLeagues } from './divisions';
import { overallRating } from './overall-rating';

/**
 * Rivalries that grow from results (saved ideas level, format 68, new careers only). Every pair of clubs has an
 * intensity from 0 to 100, rebuilt season by season from what was recorded: playoff and knockout series, title and
 * division races decided between them, close or overtime games, repeated and same-country European meetings, and the
 * manager or a star player moving between them. Intensity fades each season; above `levels.rivalry` a pair is a named
 * rivalry and plays the existing derby effects (crowd +5% per point of `effect`, the board's derby assessment and the
 * morale weight, all within their existing limits). Reversible defaults; recorded in the owner's decisions log.
 *
 * Tables change only at season boundaries: the table of season K comes from seasons 1 to K-1 (and season K's opening
 * registrations and divisions, which are fixed at the rollover), so a season's derbies never change mid-season and a
 * save re-derives every table exactly from its history.
 */
export const RIVALRY_GROWTH_RULES = Object.freeze({
  max: 100,
  /** Percentage of last season's intensity a pair keeps: it fades 15% a season without new reasons (rounded down). */
  retentionPercent: 85,
  /** A named rivalry from 30, a fierce one from 60. */
  levels: Object.freeze({ rivalry: 30, fierce: 60 }),
  /** The derby effects' 1-3 intensity (crowd +5% per point): 30-44 is 1, 45-59 is 2, 60 or more is 3. */
  effect: Object.freeze([[60, 3], [45, 2], [30, 1]] as const),
  /** Points for a playoff or knockout series between the pair, and the extra when it went to a deciding game (or a one-game tie was close). */
  series: Object.freeze({
    final: { points: 30, close: 10 }, 'semi-final': { points: 15, close: 8 }, 'quarter-final': { points: 8, close: 5 }, 'play-out': { points: 12, close: 6 },
    'third-place': { points: 4, close: 2 }, 'round-of-16': { points: 4, close: 2 }, 'play-in': { points: 4, close: 2 }, qualifying: { points: 3, close: 2 },
  } satisfies Record<Exclude<CompetitionStage, 'regular'>, { points: number; close: number }>),
  /** Games decided by `margin` points or fewer add `points`, overtime games `overtime`; at most `cap` a season per pair. */
  closeGame: Object.freeze({ margin: 3, points: 2, overtime: 3, cap: 6 }),
  /** Leagues whose table decides the title (no postseason): the top two within `wins`. */
  titleRace: Object.freeze({ wins: 2, points: 10 }),
  /** The clubs either side of a relegation or promotion line, within `wins`. */
  divisionRace: Object.freeze({ wins: 2, points: 8 }),
  /** Each meeting beyond the `usual` number in one season, across competitions. */
  meetings: Object.freeze({ usual: 3, points: 1, cap: 4 }),
  /** Each European game between clubs of the same country. */
  europe: Object.freeze({ points: 3, cap: 6 }),
  /** The manager moving from one club to the other at a season's end. */
  managerMove: 15,
  /** A player among his former club's `top` by overall rating joining the other club (during the season or before the next). */
  starMove: Object.freeze({ top: 2, points: 10, cap: 15 }),
  /** Reasons kept on a named rivalry (newest first), after its lasting base. */
  reasons: 3,
  /** The fictional development league's designed rivalries are lasting bases, at the level of their fixed intensity. */
  fictionalBase: Object.freeze({ 1: 35, 2: 50, 3: 75 } as const),
});

export type RivalryLevel = 'rivalry' | 'fierce';
export const RIVALRY_LEVEL_LABELS: Readonly<Record<RivalryLevel, string>> = Object.freeze({ rivalry: 'Rivalry', fierce: 'Fierce rivalry' });

export function rivalryLevel(intensity: number): RivalryLevel | null {
  return intensity >= RIVALRY_GROWTH_RULES.levels.fierce ? 'fierce' : intensity >= RIVALRY_GROWTH_RULES.levels.rivalry ? 'rivalry' : null;
}

/** The existing derby effects' 1-3 scale for a named rivalry's intensity. */
export function rivalryEffect(intensity: number): 1 | 2 | 3 | null {
  for (const [from, value] of RIVALRY_GROWTH_RULES.effect) if (intensity >= from) return value;
  return null;
}

const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
const pairOf = (key: string) => key.split('|') as [string, string];
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

type GameRecord = SeasonFixture | ArchivedFixture;
interface SeasonRecord { seasonNumber: number; fixtures: readonly GameRecord[]; rosters?: readonly RosterSnapshot[]; divisions?: DomesticDivisions }
/** What a table needs: the world, every completed season, this season's registrations and divisions, and the manager's moves. */
export type RivalryGrowthContext = WorldContext & Pick<SeasonState, 'seasonNumber' | 'history' | 'rosters'> & Partial<Pick<SeasonState, 'divisions' | 'career'>>;

/** Each club's opening (first) and latest registration in a season. */
function registrations(rosters: readonly RosterSnapshot[] | undefined): { opening: Map<string, RosterSnapshot>; latest: Map<string, RosterSnapshot> } {
  const opening = new Map<string, RosterSnapshot>(), latest = new Map<string, RosterSnapshot>();
  for (const roster of rosters ?? []) {
    const first = opening.get(roster.clubId), last = latest.get(roster.clubId);
    if (!first || roster.fromRound < first.fromRound) opening.set(roster.clubId, roster);
    if (!last || roster.fromRound > last.fromRound) latest.set(roster.clubId, roster);
  }
  return { opening, latest };
}
const playerClubs = (snapshots: Map<string, RosterSnapshot>) => {
  const clubs = new Map<string, string>();
  for (const [clubId, roster] of snapshots) for (const player of roster.players) clubs.set(player.id, clubId);
  return clubs;
};
const stars = new WeakMap<RosterSnapshot, ReadonlySet<string>>();
/** A registration's best players by overall rating (ties by id). */
function starsOf(roster: RosterSnapshot): ReadonlySet<string> {
  let found = stars.get(roster);
  if (!found) {
    const rated = roster.players.map((player: Player) => ({ id: player.id, overall: overallRating(player.attributes, player.position) }));
    rated.sort((a, b) => b.overall - a.overall || compare(a.id, b.id));
    found = new Set(rated.slice(0, RIVALRY_GROWTH_RULES.starMove.top).map(item => item.id));
    stars.set(roster, found);
  }
  return found;
}

/** Regular-season wins in a league's own games (domestic, no postseason), with point difference for ordering. */
function leagueRecords(fixtures: readonly GameRecord[], clubIds: readonly string[]): { clubId: string; wins: number; difference: number }[] {
  const members = new Set(clubIds), rows = new Map(clubIds.map(id => [id, { clubId: id, wins: 0, difference: 0 }]));
  for (const fixture of fixtures) {
    if (fixture.stage || fixture.competition || !fixture.result || !members.has(fixture.homeClubId) || !members.has(fixture.awayClubId)) continue;
    const home = rows.get(fixture.homeClubId)!, away = rows.get(fixture.awayClubId)!, margin = fixture.result.score.home - fixture.result.score.away;
    (fixture.result.winnerClubId === fixture.homeClubId ? home : away).wins += 1;
    home.difference += margin; away.difference -= margin;
  }
  return [...rows.values()];
}

/** Every reason a season gave each pair, after the per-season caps. */
function seasonReasons(world: CareerWorld, season: SeasonRecord, next: Omit<SeasonRecord, 'fixtures'> | null, moves: readonly CareerMove[]): Map<string, RivalryReason[]> {
  const rules = RIVALRY_GROWTH_RULES, reasons = new Map<string, RivalryReason[]>(), year = season.seasonNumber;
  const add = (a: string, b: string, reason: RivalryReason) => { if (reason.points <= 0 || a === b) return; const key = pairKey(a, b); reasons.set(key, [...(reasons.get(key) ?? []), reason]); };
  // Games: meetings, close games, same-country European games and the series they belong to.
  const pairs = new Map<string, { meetings: number; close: number; overtime: number; closePoints: number; europe: number }>();
  const series = new Map<string, { key: string; games: GameRecord[] }>(), groups = new Map<string, Set<string>>();
  for (const fixture of season.fixtures) {
    const result = fixture.result;
    if (!result || result.kind === 'default' || fixture.homeClubId === fixture.awayClubId) continue;
    const key = pairKey(fixture.homeClubId, fixture.awayClubId);
    const pair = pairs.get(key) ?? { meetings: 0, close: 0, overtime: 0, closePoints: 0, europe: 0 };
    pairs.set(key, pair);
    pair.meetings += 1;
    if (result.periods > 4) { pair.overtime += 1; pair.closePoints += rules.closeGame.overtime; }
    else if (Math.abs(result.score.home - result.score.away) <= rules.closeGame.margin) { pair.close += 1; pair.closePoints += rules.closeGame.points; }
    if (fixture.competition) {
      const country = clubCountry(world, fixture.homeClubId);
      if (country !== null && country === clubCountry(world, fixture.awayClubId)) pair.europe += 1;
    }
    if (fixture.stage && fixture.seriesId) {
      const id = `${fixture.competition ?? ''}|${fixture.seriesId}|${key}`;
      const entry = series.get(id) ?? { key, games: [] };
      entry.games.push(fixture);
      series.set(id, entry);
      if (fixture.competition) {
        const group = groups.get(`${fixture.competition}|${fixture.seriesId}`) ?? new Set<string>();
        group.add(fixture.homeClubId).add(fixture.awayClubId);
        groups.set(`${fixture.competition}|${fixture.seriesId}`, group);
      }
    }
  }
  for (const [, { key, games }] of [...series].sort(([a], [b]) => compare(a, b))) {
    const first = games[0]!, competition = first.competition ?? null, stage = first.stage!;
    // European groups that share a series id (the BCL's Round of 16) are tables, not series.
    if (competition && groups.get(`${competition}|${first.seriesId}`)!.size > 2) continue;
    const [a, b] = pairOf(key);
    const wins: [number, number] = [games.filter(game => game.result!.winnerClubId === a).length, games.filter(game => game.result!.winnerClubId === b).length];
    const single = games.length === 1 ? first.result! : null;
    const side = (clubId: string) => first.homeClubId === clubId ? 'home' : 'away';
    const close = single ? single.periods > 4 || Math.abs(single.score.home - single.score.away) <= rules.closeGame.margin : games.length >= 3 && Math.abs(wins[0] - wins[1]) === 1;
    const value = rules.series[stage];
    add(a, b, { kind: 'series', seasonNumber: year, stage, competition, wins, score: single ? [single.score[side(a)], single.score[side(b)]] : null, close, points: value.points + (close ? value.close : 0) });
  }
  for (const [key, pair] of [...pairs].sort(([a], [b]) => compare(a, b))) {
    const [a, b] = pairOf(key);
    if (pair.closePoints) add(a, b, { kind: 'close-games', seasonNumber: year, games: pair.close + pair.overtime, overtime: pair.overtime, points: Math.min(rules.closeGame.cap, pair.closePoints) });
    if (pair.meetings > rules.meetings.usual) add(a, b, { kind: 'meetings', seasonNumber: year, games: pair.meetings, points: Math.min(rules.meetings.cap, (pair.meetings - rules.meetings.usual) * rules.meetings.points) });
    if (pair.europe) add(a, b, { kind: 'europe', seasonNumber: year, games: pair.europe, points: Math.min(rules.europe.cap, pair.europe * rules.europe.points) });
  }
  // Title races in leagues whose table decides the title; the built-in league is one such league.
  const leagues = world.domesticLeagues ? seasonLeagues(world, season.divisions) : null;
  const titleLeagues = leagues ? leagues.filter(league => !league.postseason).map(league => league.clubIds) : [[...new Set(season.fixtures.filter(fixture => !fixture.stage && !fixture.competition).flatMap(fixture => [fixture.homeClubId, fixture.awayClubId]))].sort(compare)];
  for (const clubIds of titleLeagues) {
    const table = leagueRecords(season.fixtures, clubIds).sort((x, y) => y.wins - x.wins || y.difference - x.difference || compare(x.clubId, y.clubId));
    if (table.length >= 2 && table[0]!.wins > 0 && table[0]!.wins - table[1]!.wins <= rules.titleRace.wins) add(table[0]!.clubId, table[1]!.clubId, { kind: 'title-race', seasonNumber: year, gap: table[0]!.wins - table[1]!.wins, points: rules.titleRace.points });
  }
  // Division races: the clubs either side of each relegation and promotion line, from this and next season's divisions.
  if (leagues && season.divisions && next?.divisions) {
    const nextTier = new Map(seasonLeagues(world, next.divisions).flatMap(league => league.clubIds.map(id => [id, league.tier] as const)));
    for (const league of leagues) {
      const records = leagueRecords(season.fixtures, league.clubIds);
      const best = (rows: typeof records) => [...rows].sort((x, y) => y.wins - x.wins || compare(x.clubId, y.clubId))[0];
      const worst = (rows: typeof records) => [...rows].sort((x, y) => x.wins - y.wins || compare(x.clubId, y.clubId))[0];
      const relegated = records.filter(row => !nextTier.has(row.clubId) || nextTier.get(row.clubId)! > league.tier);
      const promoted = records.filter(row => nextTier.has(row.clubId) && nextTier.get(row.clubId)! < league.tier);
      const stayed = records.filter(row => !relegated.includes(row) && !promoted.includes(row));
      const race = (kind: 'relegation-race' | 'promotion-race', moved?: { clubId: string; wins: number }, kept?: { clubId: string; wins: number }) => {
        if (moved && kept && Math.abs(moved.wins - kept.wins) <= rules.divisionRace.wins) add(moved.clubId, kept.clubId, { kind, seasonNumber: year, gap: Math.abs(moved.wins - kept.wins), points: rules.divisionRace.points });
      };
      race('relegation-race', best(relegated), worst(stayed));
      race('promotion-race', worst(promoted), best(stayed));
    }
  }
  // The manager's move at this season's end (format 69: a period without a club links no clubs).
  for (const move of moves) if (move.seasonNumber === year && move.fromClubId && move.toClubId) add(move.fromClubId, move.toClubId, { kind: 'manager-move', seasonNumber: year, fromClubId: move.fromClubId, toClubId: move.toClubId, points: rules.managerMove });
  // Star players joining another club of the full world during this season or before the next.
  const now = registrations(season.rosters), later = registrations(next?.rosters);
  const opening = playerClubs(now.opening), latest = playerClubs(now.latest), following = playerClubs(later.opening);
  const starPoints = new Map<string, number>();
  const ids = [...new Set([...opening.keys(), ...latest.keys()])].sort(compare);
  for (const playerId of ids) {
    // The player's registrations in order: this season's opening, this season's latest, next season's opening.
    const route: [string, RosterSnapshot][] = [];
    for (const [clubs, snapshots] of [[opening, now.opening], [latest, now.latest], [following, later.opening]] as const) {
      const clubId = clubs.get(playerId);
      if (clubId) route.push([clubId, snapshots.get(clubId)!]);
    }
    for (let step = 1; step < route.length; step += 1) {
      const [from, snapshot] = route[step - 1]!, [to] = route[step]!;
      if (to === from || !starsOf(snapshot).has(playerId)) continue;
      const key = pairKey(from, to), used = starPoints.get(key) ?? 0, points = Math.min(rules.starMove.points, rules.starMove.cap - used);
      if (points <= 0) continue;
      starPoints.set(key, used + points);
      add(from, to, { kind: 'star-move', seasonNumber: year, playerId, name: snapshot.players.find(player => player.id === playerId)!.name, fromClubId: from, toClubId: to, points });
    }
  }
  return reasons;
}

/**
 * Every season's table up to the current one, derived only from recorded evidence. Season 1 holds the world's lasting
 * bases (the fictional league's designed rivalries; none in real-club worlds).
 */
export function computeRivalryTables(context: RivalryGrowthContext): SeasonRivalryTable[] {
  const world = worldOf(context), rules = RIVALRY_GROWTH_RULES;
  const base = new Map<string, number>();
  for (const rivalry of world.rivalries) if (rivalry.origin === 'fictional-development-league') base.set(pairKey(rivalry.clubIds[0], rivalry.clubIds[1]), rules.fictionalBase[rivalry.intensity]);
  let pairs = new Map<string, { intensity: number; events: RivalryReason[] }>([...base].map(([key, intensity]) => [key, { intensity, events: [] }]));
  const table = (seasonNumber: number): SeasonRivalryTable => ({
    seasonNumber,
    rivalries: [...pairs].filter(([, pair]) => pair.intensity >= rules.levels.rivalry).sort(([a], [b]) => compare(a, b)).map(([key, pair]): GrownRivalry => ({
      clubIds: pairOf(key), intensity: pair.intensity,
      reasons: [...(base.has(key) ? [{ kind: 'base' as const, origin: 'fictional-development-league' as const, points: base.get(key)! }] : []), ...pair.events],
    })),
  });
  const tables = [table(1)];
  const seasonAt = (year: number): SeasonRecord | null => year < context.seasonNumber ? context.history[year - 1] ?? null : year === context.seasonNumber ? { seasonNumber: year, fixtures: [], rosters: context.rosters, ...(context.divisions ? { divisions: context.divisions } : {}) } : null;
  for (let year = 1; year < context.seasonNumber; year += 1) {
    const season = seasonAt(year);
    if (!season) throw new Error('Rivalries need every completed season.');
    const gained = seasonReasons(world, season, seasonAt(year + 1), context.career?.moves ?? []);
    const next = new Map<string, { intensity: number; events: RivalryReason[] }>();
    for (const key of [...new Set([...pairs.keys(), ...gained.keys()])].sort(compare)) {
      const previous = pairs.get(key), reasons = [...(gained.get(key) ?? [])].sort((x, y) => y.points - x.points);
      const kept = Math.max(base.get(key) ?? 0, Math.floor((previous?.intensity ?? 0) * rules.retentionPercent / 100));
      const intensity = Math.min(rules.max, kept + reasons.reduce((sum, reason) => sum + reason.points, 0));
      if (intensity > 0) next.set(key, { intensity, events: [...reasons, ...(previous?.events ?? [])].slice(0, rules.reasons) });
    }
    pairs = next;
    tables.push(table(year + 1));
  }
  return tables;
}

/** Format 68: the rivalries of a new career that starts with rivalries (grown from results; `enableRivalries` anchors them). */
export function createGrownRivalries(world: CareerWorld): SeasonRivalries {
  return { model: 'rivalries-2', enabledSince: null, seasons: computeRivalryTables({ world, seasonNumber: 1, history: [], rosters: [] }) };
}

/** At a rollover: the new season's table, rebuilt from every completed season (older models keep their fixed rivalries). */
export function growRivalries(state: SeasonState): SeasonState {
  if (state.rivalries.model !== 'rivalries-2') return state;
  return { ...state, rivalries: { ...state.rivalries, seasons: computeRivalryTables(state) } };
}

/** The table in force during a season (null in older models or before it exists). */
export function rivalryTable(rivalries: SeasonRivalries | undefined, seasonNumber: number): SeasonRivalryTable | null {
  if (rivalries?.model !== 'rivalries-2') return null;
  return rivalries.seasons?.find(table => table.seasonNumber === seasonNumber) ?? null;
}

interface TableIndex { byPair: Map<string, { entry: GrownRivalry; rivalry: Rivalry }> }
const indexes = new WeakMap<SeasonRivalryTable, TableIndex>();
function tableIndex(table: SeasonRivalryTable, world: CareerWorld): TableIndex {
  let index = indexes.get(table);
  if (!index) {
    index = { byPair: new Map() };
    for (const entry of table.rivalries) {
      const [a, b] = entry.clubIds, effect = rivalryEffect(entry.intensity)!;
      const fictional = world.rivalries.find(item => item.origin === 'fictional-development-league' && item.clubIds.includes(a) && item.clubIds.includes(b));
      const rivalry: Rivalry = fictional ? { ...fictional, intensity: effect } : { id: `rivalry-${a}-${b}`, clubIds: [a, b], name: RIVALRY_LEVEL_LABELS[rivalryLevel(entry.intensity)!], intensity: effect, origin: 'results' };
      index.byPair.set(pairKey(a, b), { entry, rivalry });
    }
    indexes.set(table, index);
  }
  return index;
}

/** A pair's named rivalry during a season, as the derby effects read it, with its intensity and reasons. */
export function grownRivalryBetween(rivalries: SeasonRivalries | undefined, firstClubId: string, secondClubId: string, seasonNumber: number, world: CareerWorld): { entry: GrownRivalry; rivalry: Rivalry } | null {
  const table = rivalryTable(rivalries, seasonNumber);
  if (!table || firstClubId === secondClubId) return null;
  return tableIndex(table, world).byPair.get(pairKey(firstClubId, secondClubId)) ?? null;
}

/** A club's named rivalries during a season, strongest first. */
export function grownRivalriesOf(rivalries: SeasonRivalries | undefined, clubId: string, seasonNumber: number, world: CareerWorld): { entry: GrownRivalry; rivalry: Rivalry; rivalId: string }[] {
  const table = rivalryTable(rivalries, seasonNumber);
  if (!table) return [];
  const index = tableIndex(table, world);
  return table.rivalries.filter(entry => entry.clubIds.includes(clubId)).map(entry => ({ ...index.byPair.get(pairKey(entry.clubIds[0], entry.clubIds[1]))!, rivalId: entry.clubIds[0] === clubId ? entry.clubIds[1] : entry.clubIds[0] }))
    .sort((x, y) => y.entry.intensity - x.entry.intensity || compare(x.rivalId, y.rivalId));
}

export interface RivalryChange { seasonNumber: number; rivalId: string; change: 'formed' | 'intensified'; entry: GrownRivalry }
/** Rivalries of a club that formed or reached a higher level at each season start, from the recorded tables. */
export function rivalryChanges(rivalries: SeasonRivalries | undefined, clubIdFor: (seasonNumber: number) => string): RivalryChange[] {
  if (rivalries?.model !== 'rivalries-2' || !rivalries.seasons) return [];
  const changes: RivalryChange[] = [];
  for (let index = 1; index < rivalries.seasons.length; index += 1) {
    const table = rivalries.seasons[index]!, before = rivalries.seasons[index - 1]!, clubId = clubIdFor(table.seasonNumber);
    for (const entry of table.rivalries) {
      if (!entry.clubIds.includes(clubId)) continue;
      const previous = before.rivalries.find(item => item.clubIds[0] === entry.clubIds[0] && item.clubIds[1] === entry.clubIds[1]);
      const change = !previous ? 'formed' : rivalryEffect(entry.intensity)! > rivalryEffect(previous.intensity)! ? 'intensified' : null;
      if (change) changes.push({ seasonNumber: table.seasonNumber, rivalId: entry.clubIds[0] === clubId ? entry.clubIds[1] : entry.clubIds[0], change, entry });
    }
  }
  return changes;
}

import type { SeasonEurope } from '../domain/season';
import type { BackgroundLeague, CareerWorld, EuropeanCompetition } from '../domain/world';
import { clubCountry, worldOf } from './career-world';
import { playedEuropeanCompetitions } from './european-formats';
import { backgroundSide, europeanEntrants, getEuropeanCompetitions, type EuropeContext } from './europe';
import { overallRating } from './overall-rating';

/**
 * Background tables and next season's European places (step 3.5f, format 60; the reversible default of
 * docs/decisions.md). Unchosen top divisions play no games: each season end ranks their clubs by squad strength with a
 * seeded random element, shown as estimated. The places then follow each season's final orders and European results:
 * - clubs from countries without domestic data keep their places;
 * - EuroLeague clubs on long-term places keep them; one-year holders keep theirs by reaching the playoffs, at most
 *   twice; open one-year places go to the EuroCup champion (the runner-up only when two are open), then to the best
 *   domestic finishers not yet qualified;
 * - every country with domestic data keeps as many EuroCup and BCL places as it had in the opening season, filled from
 *   its top division's final order (EuroLeague first, then EuroCup, then BCL); places still open go to the best
 *   finishers of any such country. Every competition keeps its size.
 */

/** How far the seeded random element can move a club's estimated strength (rating points of the best-eight average). */
export const ESTIMATE_SPREAD = 1;

function hash(seed: number, key: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) value = Math.imul(value ^ key.charCodeAt(index), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b) >>> 0; value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35) >>> 0; value ^= value >>> 16;
  return value >>> 0;
}

/** A squad's strength: the mean position-weighted rating of its best eight. */
const strengthOf = (players: readonly { attributes: Parameters<typeof overallRating>[0]; position: Parameters<typeof overallRating>[1] }[]) => {
  const best = players.map(player => overallRating(player.attributes, player.position)).sort((a, b) => b - a).slice(0, 8);
  return best.reduce((sum, value) => sum + value, 0) / best.length;
};

/** An estimated final table of an unchosen top division: squads aged to the season's start, plus a seeded random element. */
export function estimatedTable(context: EuropeContext & { seed: number }, league: BackgroundLeague, seasonNumber: number): { clubId: string; estimate: number }[] {
  return league.clubIds.map(clubId => ({ clubId, estimate: Math.round((strengthOf(backgroundSide(context, clubId, seasonNumber).players) + ESTIMATE_SPREAD * (2 * hash(context.seed, `estimate:${league.id}:s${seasonNumber}:${clubId}`) / 0xffff_ffff - 1)) * 1000) / 1000 }))
    .sort((a, b) => b.estimate - a.estimate || (a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0));
}

/** The opening season's places: the world's lists and the EuroLeague's one-year places. */
export function openingEurope(world: CareerWorld): SeasonEurope {
  const competitions = playedEuropeanCompetitions(world);
  return { model: 'places-1', entrants: competitions.map(competition => ({ competitionId: competition.id, clubIds: [...competition.clubIds] })), oneYear: [...(competitions.find(competition => competition.kind === 'euroleague')?.oneYear ?? [])] };
}

export interface PlacesInput {
  /** This season's career context: world, seed, lifecycle and background records, its results and its places. */
  context: EuropeContext & { seed: number; europe: SeasonEurope; fixtures: Parameters<typeof getEuropeanCompetitions>[0]['fixtures'] };
  seasonNumber: number;
  /** This season's final regular-season order of each chosen top division, by league id. */
  domesticOrders: ReadonlyMap<string, readonly string[]>;
  /** This season's top divisions of the chosen countries (their divisions this season). */
  topDivisions: readonly { id: string; country: string; clubIds: readonly string[] }[];
  /** Consecutive seasons, ending with this one, in which the club held a one-year EuroLeague place. */
  oneYearSeasons: (clubId: string) => number;
}

/** A one-year holder renews by reaching the playoffs at most twice: three seasons in a row at most. */
export const MAX_ONE_YEAR_SEASONS = 3;

/** Next season's places from this season's orders and European results. */
export function nextEuropeanPlaces(input: PlacesInput): SeasonEurope {
  const { context, seasonNumber } = input, world = worldOf(context), europe = context.europe;
  const competitions = playedEuropeanCompetitions(world), outcomes = getEuropeanCompetitions(context, seasonNumber);
  const byKind = (kind: EuropeanCompetition['kind']) => competitions.find(competition => competition.kind === kind);
  const outcomeOf = (competition: EuropeanCompetition | undefined) => competition ? outcomes.find(entry => entry.competition.id === competition.id) : undefined;
  // Each country with domestic data ranks its top division: the season's real order, or the estimated table.
  const orders = new Map<string, readonly string[]>();
  for (const league of input.topDivisions) orders.set(league.country, input.domesticOrders.get(league.id) ?? []);
  for (const league of world.backgroundLeagues ?? []) orders.set(league.country, estimatedTable(context, league, seasonNumber).map(row => row.clubId));
  const countryOf = (clubId: string) => clubCountry(world, clubId);
  const hasData = (clubId: string) => { const country = countryOf(clubId); return country !== null && orders.has(country); };
  const positionOf = new Map<string, number>();
  for (const order of orders.values()) order.forEach((clubId, index) => positionOf.set(clubId, index));
  const strength = (clubId: string) => strengthOf(backgroundSide(context, clubId, seasonNumber).players);
  // The best finishers of every country with data: by final place, then squad strength.
  const finishers = [...positionOf.keys()].sort((a, b) => positionOf.get(a)! - positionOf.get(b)! || strength(b) - strength(a) || (a < b ? -1 : a > b ? 1 : 0));
  const placed = new Set<string>(), next = new Map<string, string[]>();
  let oneYear: string[] = [];
  // EuroLeague.
  const euroleague = byKind('euroleague');
  if (euroleague) {
    const entrants = europeanEntrants(euroleague, europe), holders = new Set(europe.oneYear);
    const reachedPlayoffs = new Set((outcomeOf(euroleague)?.series ?? []).filter(series => series.stage === 'quarter-final').flatMap(series => [series.higher?.clubId, series.lower?.clubId]).filter((id): id is string => !!id));
    const kept = entrants.filter(clubId => !holders.has(clubId));
    const renewed = entrants.filter(clubId => holders.has(clubId) && reachedPlayoffs.has(clubId) && input.oneYearSeasons(clubId) < MAX_ONE_YEAR_SEASONS);
    const places = (euroleague.oneYear ?? []).length, open = places - renewed.length;
    const newcomers: string[] = [];
    const taken = new Set([...kept, ...renewed]);
    const final = outcomeOf(byKind('eurocup'))?.series.find(series => series.id === 'final');
    if (open > 0 && final?.winner && !taken.has(final.winner)) newcomers.push(final.winner);
    if (open >= 2 && newcomers.length < open && final?.loser && !taken.has(final.loser)) newcomers.push(final.loser);
    for (const clubId of finishers) { if (newcomers.length >= open) break; if (!taken.has(clubId) && !newcomers.includes(clubId)) newcomers.push(clubId); }
    const list = [...kept, ...renewed, ...newcomers].slice(0, entrants.length);
    list.forEach(clubId => placed.add(clubId));
    next.set(euroleague.id, list);
    oneYear = [...renewed, ...newcomers].filter(clubId => list.includes(clubId));
  }
  // EuroCup, then BCL: clubs without domestic data keep their places, then each country's quota, then the best finishers.
  const leavingEuroleague = euroleague ? europeanEntrants(euroleague, europe).filter(clubId => !placed.has(clubId) && !hasData(clubId)) : [];
  for (const kind of ['eurocup', 'bcl'] as const) {
    const competition = byKind(kind);
    if (!competition) continue;
    const entrants = europeanEntrants(competition, europe), size = entrants.length;
    const keepers = entrants.filter(clubId => !hasData(clubId));
    // An outside club leaving the EuroLeague returns to the EuroCup.
    const returning = kind === 'eurocup' ? leavingEuroleague : [];
    const quotas = new Map<string, number>();
    for (const clubId of competition.clubIds) { const country = countryOf(clubId); if (country !== null && orders.has(country)) quotas.set(country, (quotas.get(country) ?? 0) + 1); }
    const quotaPicks: { clubId: string; rank: number; country: string }[] = [];
    for (const [country, quota] of [...quotas].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      let rank = 0;
      for (const clubId of orders.get(country)!) { if (rank >= quota) break; if (!placed.has(clubId)) { quotaPicks.push({ clubId, rank, country }); rank += 1; } }
    }
    quotaPicks.sort((a, b) => a.rank - b.rank || (a.country < b.country ? -1 : 1));
    const list: string[] = [];
    for (const clubId of [...keepers, ...returning, ...quotaPicks.map(pick => pick.clubId), ...finishers]) {
      if (list.length >= size) break;
      if (!placed.has(clubId) && !list.includes(clubId)) list.push(clubId);
    }
    list.forEach(clubId => placed.add(clubId));
    next.set(competition.id, list);
  }
  return { model: 'places-1', entrants: competitions.map(competition => ({ competitionId: competition.id, clubIds: next.get(competition.id) ?? [...europeanEntrants(competition, europe)] })), oneYear };
}

import type { BackgroundClub, LowerDivision } from '../domain/background';
import type { Player, PlayerAttributes, Position } from '../domain/types';
import { NO_LOWER_DIVISION_COUNTRIES } from './career-world';
import type { DomesticLeague } from './divisions';
import { overallRating } from './overall-rating';
import { REAL_WORLD_RULES, realWorldWage } from './real-world';

/**
 * Clubs leaving and joining the full world at a season end (step 3.4d-2, work in progress: these pure functions are
 * not yet used by careers). In each country with a next-division list, the lowest full division's relegated clubs
 * leave as background clubs and the same number come up from an estimated next-division table: squad strength plus a
 * seeded random element, as for the plan's background tables. A club that left earlier returns with its squad; a
 * first-time club gets a generated squad rated just below the division it joins. Italy and France have no list.
 */
export const LOWER_DIVISION_RULES = Object.freeze({
  /** The estimated table's random element: up to this many overall-rating points added to each club's strength. */
  tableSpread: 8,
  /** A generated squad's strength: this many overall-rating points below the weakest club of the division it joins. */
  generatedBelow: 2,
  /** A generated squad's players by position (twelve in all). */
  squadShape: Object.freeze({ PG: 2, SG: 3, SF: 2, PF: 3, C: 2 } as Readonly<Record<Position, number>>),
  /** Each generated player's rating around the squad target, best first: the best eight average the target. */
  playerOffsets: Object.freeze([2, 2, 1, 1, 0, 0, -1, -2, -3, -3, -4, -5]),
  /** Generated players are 19 to 33 years old at the season start. */
  ages: Object.freeze({ youngest: 19, oldest: 33 }),
});

/** FNV-1a over the key, then a full avalanche (MurmurHash3's finaliser) so keys differing in one character spread evenly. */
function hash(seed: number, key: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35) >>> 0;
  return (value ^ value >>> 16) >>> 0;
}

/** Squad strength: the average position-weighted overall rating of the best eight players (as in career setup). */
export function squadStrength(players: readonly Pick<Player, 'attributes' | 'position'>[]): number {
  const best = players.map(player => overallRating(player.attributes, player.position)).sort((a, b) => b - a).slice(0, 8);
  if (!best.length) throw new Error('A squad needs players to have a strength.');
  return best.reduce((sum, value) => sum + value, 0) / best.length;
}

export interface LowerDivisionCandidate { clubId: string; strength: number }

/** The estimated final order of a next division, best first, from an independent seeded stream (never match randomness). */
export function estimatedLowerDivisionOrder(seed: number, seasonNumber: number, country: string, candidates: readonly LowerDivisionCandidate[]): (LowerDivisionCandidate & { score: number })[] {
  if (new Set(candidates.map(candidate => candidate.clubId)).size !== candidates.length) throw new Error('Each next-division club is estimated once.');
  return candidates.map(candidate => ({ ...candidate, score: candidate.strength + LOWER_DIVISION_RULES.tableSpread * hash(seed, `lower-table:${country}:${seasonNumber}:${candidate.clubId}`) / 2 ** 32 }))
    .sort((a, b) => b.score - a.score || (a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0));
}

export interface LowerDivisionExchange {
  country: string;
  /** The lowest full division of the country, which the clubs leave and join. */
  leagueId: string;
  leaving: string[];
  joining: { clubId: string; returning: boolean }[];
}

/**
 * The exchanges at the end of `seasonNumber`. `relegated` gives each league's decided relegated clubs; only the lowest
 * full division of a country with a next-division list loses them. Candidates are the listed clubs and the clubs that
 * left earlier, minus those leaving now; returning clubs are rated by their squads (`returningStrength`), first-time
 * clubs at `generatedStrength` of the league they would join.
 */
export function lowerDivisionExchanges(input: {
  seed: number; seasonNumber: number; leagues: readonly DomesticLeague[]; relegated: ReadonlyMap<string, readonly string[]>;
  lowerDivisions: readonly LowerDivision[]; background: readonly BackgroundClub[];
  returningStrength: (club: BackgroundClub) => number; generatedStrength: (leagueId: string) => number;
}): LowerDivisionExchange[] {
  const exchanges: LowerDivisionExchange[] = [];
  for (const division of input.lowerDivisions) {
    if (NO_LOWER_DIVISION_COUNTRIES.includes(division.country)) throw new Error(`${division.country} has no relegation out of the full world for now.`);
    const own = input.leagues.filter(league => league.country === division.country);
    const lowest = own.find(league => league.tier === Math.max(...own.map(item => item.tier)));
    if (!lowest || lowest.tier + 1 !== division.tier) throw new Error('A next division must sit directly below the country\'s lowest league.');
    const leaving = [...(input.relegated.get(lowest.id) ?? [])];
    if (!leaving.length) continue;
    if (leaving.some(clubId => !lowest.clubIds.includes(clubId)) || new Set(leaving).size !== leaving.length) throw new Error('Only the division\'s own clubs can be relegated out of it.');
    const returning = input.background.filter(club => club.country === division.country && !leaving.includes(club.id));
    const listed = division.clubs.filter(club => !returning.some(item => item.id === club.id));
    const generated = input.generatedStrength(lowest.id);
    const order = estimatedLowerDivisionOrder(input.seed, input.seasonNumber, division.country, [
      ...returning.map(club => ({ clubId: club.id, strength: input.returningStrength(club) })),
      ...listed.map(club => ({ clubId: club.id, strength: generated })),
    ]);
    if (order.length < leaving.length) throw new Error(`${division.country}'s next division has too few clubs to replace those relegated.`);
    exchanges.push({ country: division.country, leagueId: lowest.id, leaving, joining: order.slice(0, leaving.length).map(entry => ({ clubId: entry.clubId, returning: returning.some(club => club.id === entry.clubId) })) });
  }
  return exchanges;
}

const FIRST = ['Aren', 'Bero', 'Calin', 'Dario', 'Edin', 'Faro', 'Goran', 'Hale', 'Ilan', 'Jaro', 'Kian', 'Loren', 'Matei', 'Nevin', 'Oren', 'Pavo', 'Rion', 'Stavo', 'Tarin', 'Valen'];
const LAST = ['Adrel', 'Brenik', 'Casol', 'Delmar', 'Ervan', 'Fennor', 'Galit', 'Harlen', 'Istov', 'Jorvik', 'Kestel', 'Lunar', 'Morvin', 'Nardel', 'Ostrin', 'Pellar', 'Quorin', 'Restan', 'Solvar', 'Tevrin'];
const ATTRIBUTES: readonly (keyof PlayerAttributes)[] = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
/** Position emphasis on the 1-20 scale, matching the authored squads' shape. */
const EMPHASIS: Readonly<Record<Position, Partial<Record<keyof PlayerAttributes, number>>>> = {
  PG: { passing: 2, threePoint: 1, rebounding: -2 }, SG: { threePoint: 2, passing: 1, rebounding: -1 }, SF: { twoPoint: 1, defense: 1 },
  PF: { rebounding: 2, twoPoint: 1, threePoint: -1 }, C: { rebounding: 3, defense: 1, threePoint: -2, passing: -1 },
};

/** Integer abilities whose position-weighted overall rating is as close to `target` as the 1-20 scale allows. */
function attributesFor(target: number, position: Position, variation: (key: string) => number): PlayerAttributes {
  const uniform = (level: number) => overallRating(Object.fromEntries(ATTRIBUTES.map(key => [key, level])) as unknown as PlayerAttributes, position);
  let level = 1;
  while (level < 20 && uniform(level + 1) <= target) level += 1;
  const skills = Object.fromEntries(ATTRIBUTES.map(key => [key, Math.max(1, Math.min(20, level + (EMPHASIS[position][key] ?? 0) + variation(key)))])) as unknown as Record<keyof PlayerAttributes, number>;
  // Nudge one ability at a time towards the target, rotating through the abilities; bounded and deterministic.
  for (let step = 0; step < 140; step += 1) {
    const current = overallRating(skills, position);
    if (current === target) break;
    const key = ATTRIBUTES[step % ATTRIBUTES.length]!;
    if (current < target && skills[key] < 20) skills[key] += 1;
    else if (current > target && skills[key] > 1) skills[key] -= 1;
  }
  return skills;
}

/** A generated squad, its players labelled by identity (`<club>-generated-s<season>-<n>`) and in their profiles. */
export interface GeneratedSquad {
  players: Player[];
  profiles: Record<string, { dateOfBirth: string; source: 'generated' }>;
  /** Estimated season wages in euro cents, as for real-club worlds. */
  wages: Record<string, number>;
  /** Estimated seasons left on each opening contract, as for real-club worlds. */
  contracts: Record<string, number>;
}

/**
 * Twelve fictional players for a first-time club joining the full world before season `seasonNumber`, rated around
 * `targetStrength` (the best eight average it within a point or so). A separate stable stream: never match randomness.
 */
export function generateLowerDivisionSquad(seed: number, clubId: string, seasonNumber: number, seasonStart: string, targetStrength: number): GeneratedSquad {
  const year = Number(seasonStart.slice(0, 4));
  const positions = (Object.entries(LOWER_DIVISION_RULES.squadShape) as [Position, number][]).flatMap(([position, count]) => Array.from({ length: count }, () => position));
  // Spread the best ratings across positions: the strongest player of each position first, then the rest.
  const order = positions.map((position, index) => ({ position, index, rank: positions.slice(0, index).filter(item => item === position).length }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  const squad: GeneratedSquad = { players: [], profiles: {}, wages: {}, contracts: {} };
  const { youngest, oldest } = LOWER_DIVISION_RULES.ages;
  order.forEach(({ position }, slot) => {
    const id = `${clubId}-generated-s${seasonNumber}-${slot + 1}`.slice(0, 80);
    const value = (key: string, count: number) => hash(seed, `${id}:${key}`) % count;
    const target = Math.round(targetStrength) + LOWER_DIVISION_RULES.playerOffsets[slot]!;
    const attributes = attributesFor(target, position, key => value(key, 3) - 1);
    const positionIndex = ['PG', 'SG', 'SF', 'PF', 'C'].indexOf(position);
    const age = youngest + value('age', oldest - youngest + 1);
    squad.players.push({ id, name: `${FIRST[value('first', FIRST.length)]} ${LAST[value('last', LAST.length)]}`, number: 4 + slot, position, heightCm: 182 + positionIndex * 6 + value('height', 9), weightKg: 78 + positionIndex * 7 + value('weight', 10),
      skinTone: ['#e8b58e', '#c98c62', '#a96f49', '#774d35', '#edc5a1'][value('skin', 5)]!, hairColor: ['#29201b', '#553b29', '#191919', '#8b6744'][value('hair', 4)]!, attributes });
    // Exactly `age` on the season's first day: born that many years earlier, a year more if the birthday is still to come.
    const birthday = `${String(1 + value('month', 12)).padStart(2, '0')}-${String(1 + value('day', 28)).padStart(2, '0')}`;
    squad.profiles[id] = { dateOfBirth: `${year - age - (birthday > seasonStart.slice(5) ? 1 : 0)}-${birthday}`, source: 'generated' };
    squad.wages[id] = realWorldWage(overallRating(attributes, position));
    squad.contracts[id] = REAL_WORLD_RULES.contractYears(age, hash(seed, id));
  });
  return squad;
}

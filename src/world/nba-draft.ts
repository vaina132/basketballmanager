import type { DraftLottery, DraftProspect } from '../domain/draft';
import type { Player, Position } from '../domain/types';
import { countryName, nameCapacity, NAME_COUNTRIES } from '../data/people-names';
import { attributesFor } from './lower-division';
import { profiledAttributesFor } from './position-profiles';
import { overallRating } from './overall-rating';
import { withExtraAttributes } from './extra-attributes';
import { realWorldWage } from './real-world';
import { NBA_SALARY_CAP, NBA_LOWEST_MINIMUM } from './nba-cap';
import { memoizePure } from './pure-cache';

/**
 * NBA step 8 (format 95, provisional): the NBA draft's pure rules: the generated prospects of a class, the lottery and
 * the draft order, the computer clubs' choice and the rookie contracts. The career-dependent parts (standings, draft
 * day in the market, the manager's picks, the journal) live in `nba-draft-policy.ts`.
 *
 * Sources: [S] the NBA's draft lottery odds since 2019 (14.0, 14.0, 14.0, 12.5, 10.5, 9.0, 7.5, 6.0, 4.5, 3.0, 2.0, 1.5,
 * 1.0, 0.5% for the first pick, worst record first; four picks drawn, the rest in reverse order of record; NBA.com
 * "Draft lottery odds"); two rounds of thirty picks, the second round in reverse order of record. [S] The 2023 CBA rookie
 * scale (first-round contracts by pick; almost every first-round pick signs at 120% of the scale; [E] the amounts below
 * approximate the 2025-26 first-year scale and grow with the cap); the game keeps three
 * seasons (the scale's two guaranteed years plus the first team option) because contracts are at most three seasons.
 * [E] Second-round picks sign two-season minimum contracts. [E] Prospect ratings are calibrated on the real first-year and
 * second-year NBA players of the published pack (world-14, 23 November 2026: the 17 players aged 19, nearly all 2026
 * first-round picks, average an overall rating of 70.6; the 44 players aged 19-20 average an overall
 * rating of 67, median 68, 10th-90th percentile 58-73, best 85; about 30% of players aged 22 or under are international).
 */
export const NBA_DRAFT_RULES = Object.freeze({
  /** Prospects generated for each class. */
  prospects: 90,
  /** [E] Ages on draft day with their weights (younger prospects are a little more common at the top). */
  ages: Object.freeze([[19, 30], [20, 30], [21, 22], [22, 18]] as const),
  /** [E] Share of international prospects (about 25%). */
  internationalShare: 0.25,
  /** [E] Overall rating by class rank (rank, rating), linear in between, before the prospect's own variation. */
  ratingByRank: Object.freeze([[1, 81], [3, 76], [5, 73], [10, 70], [14, 69], [20, 67], [30, 64], [45, 60], [60, 57], [75, 53], [90, 48]] as const),
  /** [E] Each prospect's own variation around his rank's rating: up to this many points either side. */
  ratingSpread: 3,
  /** [E] Young players' stamina sits about two points below their other skills (real 19-20-year-olds: 10.7 vs 12.6). */
  staminaShift: -2,
  /** [S] Lottery odds for the first pick in tenths of a percent, worst record first (2019 reform). */
  lotteryOdds: Object.freeze([140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5] as const),
  /** [S] Picks decided by the lottery draw. */
  lotteryDraws: 4,
  /** [S] Picks in each of the two rounds. */
  picksPerRound: 30,
  /** [E] A computer club's value of a prospect: this share of his potential overall, the rest his current overall, plus its own scouting noise (up to this many points). */
  potentialWeight: 0.6,
  valueNoise: 3,
  /** [E] Worlds with European countries: real players of European clubs aged 19-22 on draft day join the pool, the best by potential overall (at most `europeans`, potential at least `europeanPotential`). */
  europeans: 20,
  europeanPotential: 66,
  /** [S] The NBA's buyout allowance for bringing a drafted player over from abroad (2026-27, about $875k; dollars). */
  buyoutAllowanceUsd: 875_000,
  /** First-round contracts run three seasons, second-round contracts two. */
  firstRoundSeasons: 3,
  secondRoundSeasons: 2,
  /** [E] About the 2025-26 rookie scale's first-year amounts by pick (US dollars, 100%), grown with the cap and signed at 120%. */
  rookieScaleUsd: Object.freeze([
    11_075_000, 9_909_000, 8_898_000, 8_021_000, 7_266_000, 6_617_000, 6_042_000, 5_538_000, 5_098_000, 4_842_000,
    4_600_000, 4_369_000, 4_152_000, 3_944_000, 3_747_000, 3_559_000, 3_382_000, 3_212_000, 3_052_000, 2_930_000,
    2_813_000, 2_700_000, 2_592_000, 2_499_000, 2_412_000, 2_336_000, 2_272_000, 2_253_000, 2_236_000, 2_220_000,
  ] as const),
  rookieScaleCapUsd: 154_647_000,
  rookieScaleSigned: 1.2,
  /** Prospects show in the Draft tab from this month of the season (February). */
  visibleFromMonth: 2,
});

const WAGE_STEP = 50_000;

/** FNV-1a over the key, then a full avalanche, as `generateLowerDivisionSquad`: its own stream, never match randomness. */
export function draftHash(seed: number, key: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35) >>> 0;
  return (value ^ value >>> 16) >>> 0;
}

/** A class rank's rating before the prospect's own variation. */
export function rankRating(rank: number): number {
  const table = NBA_DRAFT_RULES.ratingByRank;
  for (let index = 1; index < table.length; index += 1) {
    const [r1, v1] = table[index]!, [r0, v0] = table[index - 1]!;
    if (rank <= r1) return v0 + (v1 - v0) * (rank - r0) / (r1 - r0);
  }
  return table.at(-1)![1];
}

const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const HEIGHTS: Readonly<Record<Position, readonly [number, number]>> = { PG: [185, 196], SG: [191, 201], SF: [198, 206], PF: [203, 211], C: [208, 218] };
const INTERNATIONAL = NAME_COUNTRIES.filter(country => country !== 'United States');
/** Nationalities as the data pack spells them. */
const nationalityOf = (country: string) => country === 'United States' ? 'USA' : country;

/** The id of a class's n-th prospect (1-based). */
export const draftProspectId = (seasonNumber: number, n: number) => `nba-draft-s${seasonNumber}-${n}`;

/**
 * A class of generated prospects for the draft of `seasonNumber` held on `draftDay`: `NBA_DRAFT_RULES.prospects`
 * fictional players aged 19-22 on draft day, about a quarter international, rated by class rank as real first-year
 * players are, labelled `generated` (`extras`: the world stores the five further abilities). Seeded by the career seed
 * and the season like `generateLowerDivisionSquad`, so the save check derives the same class again.
 */
export const generateDraftClass = memoizePure((key: string): readonly DraftProspect[] => {
  const [seedText, seasonText, draftDay, extrasText, profilesText] = key.split('|');
  const seed = Number(seedText), seasonNumber = Number(seasonText), extras = extrasText === '1', profiles = profilesText === 'p', year = Number(draftDay!.slice(0, 4));
  const rules = NBA_DRAFT_RULES, totalWeight = rules.ages.reduce((sum, [, weight]) => sum + weight, 0);
  const usedNames = new Set<string>();
  const prospects: DraftProspect[] = [];
  for (let n = 1; n <= rules.prospects; n += 1) {
    const id = draftProspectId(seasonNumber, n);
    const value = (name: string, count: number) => draftHash(seed, `${id}:${name}`) % count;
    const position = POSITIONS[value('position', POSITIONS.length)]!;
    // Younger prospects sit a little higher in the class: the age draw leans young for the first third.
    let ageRoll = value('age', totalWeight * 4) / 4 * (n <= 30 ? 0.85 : 1);
    let age: number = rules.ages[0]![0];
    for (const [candidate, weight] of rules.ages) { if (ageRoll < weight) { age = candidate; break; } ageRoll -= weight; }
    const target = Math.round(rankRating(n) + value('rating', rules.ratingSpread * 2 + 1) - rules.ratingSpread);
    // Format 105 (`world.positionProfiles`): shaped like real NBA players of the position at the target rating, whose
    // stamina already sits low at a rookie's rating (so no extra stamina shift).
    const skills = profiles ? profiledAttributesFor(target, position, 'nba', key => value(key, 3) - 1) : attributesFor(target, position, key => key === 'stamina' ? rules.staminaShift + value('stamina', 3) - 1 : value(key, 3) - 1);
    const [low, high] = HEIGHTS[position], heightCm = low + value('height', high - low + 1);
    const international = value('international', 1000) < rules.internationalShare * 1000;
    const country = international ? INTERNATIONAL[value('country', INTERNATIONAL.length)]! : 'United States';
    let name: string | null = null;
    for (let attempt = 0; attempt < 50 && (!name || usedNames.has(name)); attempt += 1) name = countryName(country, (value('name', nameCapacity(country)) + attempt * 17) % nameCapacity(country));
    name = name && !usedNames.has(name) ? name : `${countryName(country, n % nameCapacity(country)) ?? 'Prospect'} ${n}`;
    usedNames.add(name);
    const attributes = extras ? withExtraAttributes({ id, position, heightCm, attributes: skills, age, minutes: 0 }) : skills;
    const positionIndex = POSITIONS.indexOf(position);
    const player: Player = {
      id, name, number: value('number', 100), position, heightCm, weightKg: 84 + positionIndex * 6 + value('weight', 10),
      skinTone: ['#e8b58e', '#c98c62', '#a96f49', '#774d35', '#edc5a1'][value('skin', 5)]!, hairColor: ['#29201b', '#553b29', '#191919', '#8b6744'][value('hair', 4)]!, attributes,
    };
    // Exactly `age` on draft day: born that many years earlier, a year more if the birthday is still to come.
    const birthday = `${String(1 + value('month', 12)).padStart(2, '0')}-${String(1 + value('day', 28)).padStart(2, '0')}`;
    prospects.push({ player, dateOfBirth: `${year - age - (birthday > draftDay!.slice(5) ? 1 : 0)}-${birthday}`, nationality: nationalityOf(country), wage: realWorldWage(overallRating(attributes, position)) });
  }
  return Object.freeze(prospects);
});

/** The class of a career's season (see `generateDraftClass`). */
export const draftClassProspects = (seed: number, seasonNumber: number, draftDay: string, extras: boolean, profiles = false): readonly DraftProspect[] => generateDraftClass(`${seed}|${seasonNumber}|${draftDay}|${extras ? 1 : 0}${profiles ? '|p' : ''}`);

/**
 * The lottery (2019 odds): four picks drawn among the 14 clubs outside the playoffs (worst record first), each draw
 * weighted by the clubs' odds among those not yet drawn (the same as drawing one of 1,000 combinations and drawing again
 * when it names a club already drawn). Seeded by the career seed and the season.
 */
export function drawLottery(seed: number, seasonNumber: number, clubs: readonly string[]): DraftLottery {
  const odds = NBA_DRAFT_RULES.lotteryOdds;
  if (clubs.length !== odds.length || new Set(clubs).size !== clubs.length) throw new Error('The lottery needs the 14 clubs outside the playoffs.');
  const drawn: string[] = [];
  for (let draw = 0; draw < NBA_DRAFT_RULES.lotteryDraws; draw += 1) {
    const left = clubs.map((clubId, index) => ({ clubId, weight: odds[index]! })).filter(entry => !drawn.includes(entry.clubId));
    let roll = draftHash(seed, `nba-lottery:s${seasonNumber}:${draw}`) % left.reduce((sum, entry) => sum + entry.weight, 0);
    const chosen = left.find(entry => (roll -= entry.weight) < 0)!;
    drawn.push(chosen.clubId);
  }
  return { clubs: [...clubs], drawn };
}

/**
 * The draft order (60 club ids): the four drawn clubs, the other lottery clubs in reverse order of record, the playoff
 * clubs in reverse order of record, then the second round with every club in reverse order of record. `worstFirst` is
 * the NBA's league table reversed (its tie-breaks settle level records).
 */
export function draftOrder(lottery: DraftLottery, worstFirst: readonly string[]): string[] {
  const lotteryClubs = new Set(lottery.clubs);
  const first = [...lottery.drawn, ...lottery.clubs.filter(clubId => !lottery.drawn.includes(clubId)), ...worstFirst.filter(clubId => !lotteryClubs.has(clubId))];
  if (first.length !== NBA_DRAFT_RULES.picksPerRound || new Set(first).size !== first.length) throw new Error('The draft order needs the NBA\'s thirty clubs.');
  return [...first, ...worstFirst];
}

/** A prospect as a club weighs him: current overall rating and the overall he could reach (potential). */
export interface DraftCandidate { id: string; overall: number; potential: number }

/** A computer club's value of a candidate: potential counts most, then the current rating, plus a stable noise of its own (its scouts' view). */
export function candidateValue(seed: number, seasonNumber: number, clubId: string, candidate: DraftCandidate): number {
  const rules = NBA_DRAFT_RULES, noise = draftHash(seed, `nba-draft-value:s${seasonNumber}:${clubId}:${candidate.id}`) % (rules.valueNoise * 200 + 1) / 100 - rules.valueNoise;
  return candidate.potential * rules.potentialWeight + candidate.overall * (1 - rules.potentialWeight) + noise;
}

/** The best available candidate for a club by its value (ties by id). */
export function bestAvailable(seed: number, seasonNumber: number, clubId: string, available: readonly DraftCandidate[]): DraftCandidate {
  let best: DraftCandidate | null = null, bestValue = -Infinity;
  for (const candidate of available) {
    const value = candidateValue(seed, seasonNumber, clubId, candidate);
    if (value > bestValue || value === bestValue && best && candidate.id < best.id) { best = candidate; bestValue = value; }
  }
  if (!best) throw new Error('No prospect is left to draft.');
  return best;
}

/** A first-round pick's rookie-scale season wage (euro cents, 120% of the scale grown with the cap, rounded up to the wage step). */
export function rookieScaleWage(pick: number): number {
  const rules = NBA_DRAFT_RULES, scale = rules.rookieScaleUsd[pick - 1];
  if (scale === undefined) throw new Error('The rookie scale covers the thirty first-round picks.');
  const cents = scale / rules.rookieScaleCapUsd * NBA_SALARY_CAP * rules.rookieScaleSigned;
  return Math.max(NBA_LOWEST_MINIMUM, Math.ceil(cents / WAGE_STEP) * WAGE_STEP);
}

/** The contract a pick signs: first round on the rookie scale for three seasons, second round on the rookie minimum for two. */
export function rookieContract(pick: number): { seasonWage: number; seasons: number } {
  return pick <= NBA_DRAFT_RULES.picksPerRound ? { seasonWage: rookieScaleWage(pick), seasons: NBA_DRAFT_RULES.firstRoundSeasons } : { seasonWage: NBA_LOWEST_MINIMUM, seasons: NBA_DRAFT_RULES.secondRoundSeasons };
}

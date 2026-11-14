#!/usr/bin/env node
/**
 * Real-data ratings (docs/real-data-feasibility.md, part 4): turns stored box scores into the game's seven abilities
 * (1-20), its five positions and estimated height/weight, for one draft dataset version. Provisional rules, all
 * listed in RATING_RULES; every estimate is named in `estimated`, and `method` keeps the inputs behind each rating.
 * Published versions never change, so every run names its version.
 *
 *   node scripts/real-data-ratings.mjs --version 2026.11-world-1
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overallRating, overallRatingStars } from '../src/world/overall-rating.ts';
import { resolvePosition } from './real-data-position.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionArg = process.argv.indexOf('--version');
const VERSION = versionArg > 0 ? process.argv[versionArg + 1] : null;
/** --preview computes the ratings and writes the report without saving anything to the database. */
const PREVIEW = process.argv.includes('--preview');

export const RATING_RULES = Object.freeze({
  id: 'rating-3',
  /** The current season counts fully, the previous one at 70%. */
  recency: Object.freeze({ '2026-27': 1, '2025-26': 0.7 }),
  /**
   * Domestic statistics are converted to the European level statistic by statistic (see leagueGap), measured from
   * players with at least `pairMinutes` in both in the same season; with fewer than `minimumPairs` such players the
   * defaults apply. Volume factors scale per-40 rates and minutes per game; shooting gaps are percentage points.
   */
  pairMinutes: 100,
  minimumPairs: 5,
  defaultLeagueGap: Object.freeze({
    volume: Object.freeze({ twoAttempts: 0.85, threeAttempts: 0.85, rebounds: 0.85, assists: 0.85, minutesPerGame: 1 }),
    shooting: Object.freeze({ two: 0.02, three: 0.01 }),
  }),
  volumeRange: Object.freeze([0.75, 1]),
  shootingGapRange: Object.freeze([0, 0.05]),
  /**
   * rating-3 (sprint 3, many leagues): every competition's statistics are converted to the reference competition's
   * level. Players who played two competitions in one season link them (each weighted by his smaller number of
   * minutes); players who moved between domestic leagues from one season to the next link them at half weight. The
   * links are solved together (weighted least squares, the reference fixed), so a league without direct links to the
   * reference is measured through others. Each competition also starts from a default for its kind and tier, worth
   * `priorMinutes` of links, so thin evidence moves it only a little.
   */
  levels: Object.freeze({
    reference: 'EuroLeague',
    crossSeasonWeight: 0.5,
    priorMinutes: 1500,
    defaults: Object.freeze({
      'european-1': Object.freeze({ volume: 1, shooting: Object.freeze({ two: 0, three: 0 }) }),
      'european-2': Object.freeze({ volume: 0.92, shooting: Object.freeze({ two: 0.01, three: 0.005 }) }),
      'domestic-1': Object.freeze({ volume: 0.85, shooting: Object.freeze({ two: 0.02, three: 0.01 }) }),
      'domestic-2': Object.freeze({ volume: 0.72, shooting: Object.freeze({ two: 0.04, three: 0.025 }) }),
    }),
    volumeRange: Object.freeze([0.6, 1.05]),
    shootingGapRange: Object.freeze([-0.01, 0.08]),
    /** The 1-20 scale is set by players whose main competition is a top division or the reference (as in rating-2). */
    scaleKinds: Object.freeze(['domestic-1', 'european-1']),
  }),
  /** Shooting is pulled towards the position average until this many attempts; rates until this many minutes. */
  priorAttempts: Object.freeze({ two: 60, three: 100, free: 40 }),
  priorMinutes: 200,
  /** Minutes per game and availability are pulled towards the position average until this many games. */
  priorGames: 10,
  /** Players below this many weighted minutes are rated from their position and league and marked estimated. */
  minimumMinutes: 60,
  /** Only players with at least this many weighted minutes set the scale. */
  scaleMinutes: 300,
  /** The game's scale: an average player is 12, one standard deviation is 3.2 points. */
  centre: 12, spread: 3.2, fringePenalty: 1.5,
  /** Stamina falls by one point for each year above this age (at most four). */
  staminaAge: 32,
  /** A competition season's checked free throws are used only if its league-wide rate is believable. */
  plausibleFreeThrows: Object.freeze([0.65, 0.85]),
  /** Estimated build by game position until real measurements exist. */
  build: Object.freeze({ PG: [188, 84], SG: [194, 89], SF: [200, 97], PF: [206, 106], C: [211, 113] }),
});

const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => values.length ? sum(values) / values.length : 0;
const sd = (values) => { const m = mean(values); return Math.sqrt(mean(values.map(value => (value - m) ** 2))) || 1; };
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const clampScale = (value) => Math.max(1, Math.min(20, Math.round(value)));
const group = (position) => /guard/i.test(position ?? '') ? 'Guard' : /center/i.test(position ?? '') ? 'Center' : /forward/i.test(position ?? '') ? 'Forward' : 'Unknown';
const per40 = (value, minutes) => minutes > 0 ? value * 40 / minutes : 0;
/** Shooting totals without impossible provider lines (more made than attempted), where the view supplies them. */
const shot = (row, key) => Number(row[`${key}_valid`] ?? row[key]);

/**
 * How domestic statistics translate to the European competition, statistic by statistic, from players who played
 * both in the same season (each weighted by his smaller number of minutes): per-40 rates and minutes per game as
 * European / domestic ratios, shooting as the drop in percentage points. Bounded by RATING_RULES.
 */
export function leagueGap(rows) {
  const rules = RATING_RULES;
  const blank = () => ({ minutes: 0, games: 0, twoMade: 0, twoAtt: 0, threeMade: 0, threeAtt: 0, rebounds: 0, assists: 0 });
  const byPlayerSeason = new Map();
  for (const row of rows) {
    const key = `${row.player_id}/${row.season_label}`, entry = byPlayerSeason.get(key) ?? { domestic: blank(), european: blank() }, side = entry[row.kind];
    side.minutes += Number(row.seconds_played) / 60; side.games += Number(row.games_played);
    side.twoMade += shot(row, 'two_made'); side.twoAtt += shot(row, 'two_attempted'); side.threeMade += shot(row, 'three_made'); side.threeAtt += shot(row, 'three_attempted');
    side.rebounds += Number(row.rebounds); side.assists += Number(row.assists);
    byPlayerSeason.set(key, entry);
  }
  const pairs = [...byPlayerSeason.values()].filter(entry => entry.domestic.minutes >= rules.pairMinutes && entry.european.minutes >= rules.pairMinutes);
  if (pairs.length < rules.minimumPairs) return { ...rules.defaultLeagueGap, players: pairs.length, measured: false };
  const weight = pairs.map(entry => Math.min(entry.domestic.minutes, entry.european.minutes));
  const weighted = (side, value) => sum(pairs.map((entry, index) => weight[index] * value(entry[side])));
  const ratio = value => weighted('european', value) / Math.max(1e-9, weighted('domestic', value));
  const bound = (value, [low, high]) => Math.round(Math.max(low, Math.min(high, value)) * 1000) / 1000;
  const rate = key => side => per40(side[key], side.minutes);
  const percentage = (made, attempted) => side => sum(pairs.map(entry => entry[side][made])) / Math.max(1, sum(pairs.map(entry => entry[side][attempted])));
  const drop = (made, attempted) => percentage(made, attempted)('domestic') - percentage(made, attempted)('european');
  return {
    volume: {
      twoAttempts: bound(ratio(rate('twoAtt')), rules.volumeRange), threeAttempts: bound(ratio(rate('threeAtt')), rules.volumeRange),
      rebounds: bound(ratio(rate('rebounds')), rules.volumeRange), assists: bound(ratio(rate('assists')), rules.volumeRange),
      minutesPerGame: bound(ratio(side => side.games > 0 ? side.minutes / side.games : 0), rules.volumeRange),
    },
    shooting: { two: bound(drop('twoMade', 'twoAtt'), rules.shootingGapRange), three: bound(drop('threeMade', 'threeAtt'), rules.shootingGapRange) },
    players: pairs.length, measured: true,
  };
}

/** One line for notes and reports. */
export function describeLeagueGap(gap) {
  const { volume, shooting } = gap;
  return `domestic-to-European conversion ${gap.measured ? `measured from ${gap.players} players in both competitions` : 'default'}: two-point attempts x${volume.twoAttempts}, three-point attempts x${volume.threeAttempts}, rebounds x${volume.rebounds}, assists x${volume.assists}, minutes per game x${volume.minutesPerGame}; two-point % -${(shooting.two * 100).toFixed(1)} and three-point % -${(shooting.three * 100).toFixed(1)} points`;
}

const VOLUME_KEYS = ['twoAttempts', 'threeAttempts', 'rebounds', 'assists', 'minutesPerGame'];
/** A competition's group for defaults and the rating scale: its kind and whether it is a top tier. */
export const levelKind = competition => `${competition.kind}-${Number(competition.tier) === 1 ? 1 : 2}`;
function defaultLevel(kind) {
  const base = RATING_RULES.levels.defaults[kind] ?? RATING_RULES.levels.defaults['domestic-1'];
  return { volume: { twoAttempts: base.volume, threeAttempts: base.volume, rebounds: base.volume, assists: base.volume, minutesPerGame: 1 }, shooting: { ...base.shooting } };
}

/** Solves a small dense linear system (Gauss-Jordan elimination with partial pivoting). */
function solve(matrix, vector) {
  const n = vector.length, a = matrix.map((line, index) => [...line, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let line = column + 1; line < n; line += 1) if (Math.abs(a[line][column]) > Math.abs(a[pivot][column])) pivot = line;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let line = 0; line < n; line += 1) {
      if (line === column || !a[line][column]) continue;
      const factor = a[line][column] / a[column][column];
      for (let index = column; index <= n; index += 1) a[line][index] -= factor * a[column][index];
    }
  }
  return a.map((line, index) => line[n] / line[index]);
}

/**
 * rating-3: each competition's conversion to the reference competition's level, statistic by statistic
 * (RATING_RULES.levels). `competitions` lists { name, kind, tier }. Volume factors multiply per-40 rates and minutes
 * per game; shooting gaps are percentage points taken off. Returns a Map from competition name to its conversion,
 * the linking players and minutes, and whether any link measured it.
 */
export function competitionLevels(rows, competitions) {
  const rules = RATING_RULES, config = rules.levels;
  const known = new Map(competitions.map(competition => [competition.name, competition]));
  const blank = () => ({ minutes: 0, games: 0, twoMade: 0, twoAtt: 0, threeMade: 0, threeAtt: 0, rebounds: 0, assists: 0 });
  const byPlayer = new Map();
  for (const row of rows) {
    if (!known.has(row.competition)) continue;
    const seasons = byPlayer.get(row.player_id) ?? new Map(); byPlayer.set(row.player_id, seasons);
    const played = seasons.get(row.season_label) ?? new Map(); seasons.set(row.season_label, played);
    const side = played.get(row.competition) ?? blank(); played.set(row.competition, side);
    side.minutes += Number(row.seconds_played) / 60; side.games += Number(row.games_played);
    side.twoMade += shot(row, 'two_made'); side.twoAtt += shot(row, 'two_attempted'); side.threeMade += shot(row, 'three_made'); side.threeAtt += shot(row, 'three_attempted');
    side.rebounds += Number(row.rebounds); side.assists += Number(row.assists);
  }
  const links = new Map();
  const totals = () => ({ twoAttempts: 0, threeAttempts: 0, rebounds: 0, assists: 0, minutesPerGame: 0, twoMade: 0, twoAtt: 0, threeMade: 0, threeAtt: 0 });
  function link(first, firstSide, second, secondSide, weight) {
    const [a, sideA, b, sideB] = first < second ? [first, firstSide, second, secondSide] : [second, secondSide, first, firstSide];
    const key = `${a}|${b}`, entry = links.get(key) ?? { a, b, weight: 0, players: 0, sums: { a: totals(), b: totals() } };
    entry.weight += weight; entry.players += 1;
    for (const [name, side] of [['a', sideA], ['b', sideB]]) {
      const sums = entry.sums[name];
      sums.twoAttempts += weight * per40(side.twoAtt, side.minutes); sums.threeAttempts += weight * per40(side.threeAtt, side.minutes);
      sums.rebounds += weight * per40(side.rebounds, side.minutes); sums.assists += weight * per40(side.assists, side.minutes);
      sums.minutesPerGame += weight * (side.games > 0 ? side.minutes / side.games : 0);
      sums.twoMade += side.twoMade; sums.twoAtt += side.twoAtt; sums.threeMade += side.threeMade; sums.threeAtt += side.threeAtt;
    }
    links.set(key, entry);
  }
  const seasonOrder = [...new Set(rows.map(row => row.season_label))].sort();
  for (const seasons of byPlayer.values()) {
    for (const played of seasons.values()) {
      const enough = [...played].filter(([, side]) => side.minutes >= rules.pairMinutes);
      for (let i = 0; i < enough.length; i += 1) for (let j = i + 1; j < enough.length; j += 1) link(enough[i][0], enough[i][1], enough[j][0], enough[j][1], Math.min(enough[i][1].minutes, enough[j][1].minutes));
    }
    // A move between domestic leagues from one season to the next links them at reduced weight.
    const mainDomestic = label => [...(seasons.get(label) ?? [])].filter(([name, side]) => known.get(name).kind === 'domestic' && side.minutes >= rules.pairMinutes).sort((x, y) => y[1].minutes - x[1].minutes)[0];
    for (let index = 1; index < seasonOrder.length; index += 1) {
      const before = mainDomestic(seasonOrder[index - 1]), after = mainDomestic(seasonOrder[index]);
      if (before && after && before[0] !== after[0]) link(before[0], before[1], after[0], after[1], config.crossSeasonWeight * Math.min(before[1].minutes, after[1].minutes));
    }
  }
  const names = [...known.keys()], at = new Map(names.map((name, index) => [name, index]));
  const priors = new Map(names.map(name => [name, defaultLevel(levelKind(known.get(name)))]));
  const linkedPlayers = new Map(names.map(name => [name, 0])), linkedMinutes = new Map(names.map(name => [name, 0]));
  for (const entry of links.values()) for (const name of [entry.a, entry.b]) { linkedPlayers.set(name, linkedPlayers.get(name) + entry.players); linkedMinutes.set(name, linkedMinutes.get(name) + entry.weight); }
  // Weighted least squares per statistic: each link says level(a) - level(b) = difference; each prior pulls towards its default.
  function levelsFor(differenceOf, priorOf) {
    const n = names.length, matrix = Array.from({ length: n }, () => Array(n).fill(0)), vector = Array(n).fill(0);
    for (const name of names) { const index = at.get(name), weight = name === config.reference ? 1e9 : config.priorMinutes; matrix[index][index] += weight; vector[index] += weight * priorOf(priors.get(name)); }
    for (const entry of links.values()) {
      const difference = differenceOf(entry.sums.a, entry.sums.b);
      if (!Number.isFinite(difference)) continue;
      const a = at.get(entry.a), b = at.get(entry.b), w = entry.weight;
      matrix[a][a] += w; matrix[b][b] += w; matrix[a][b] -= w; matrix[b][a] -= w; vector[a] += w * difference; vector[b] -= w * difference;
    }
    return solve(matrix, vector);
  }
  const bound = (value, [low, high]) => Math.round(Math.max(low, Math.min(high, value)) * 1000) / 1000;
  const volume = Object.fromEntries(VOLUME_KEYS.map(key => [key, levelsFor((a, b) => a[key] > 0 && b[key] > 0 ? Math.log(b[key] / a[key]) : NaN, prior => Math.log(prior.volume[key]))]));
  const percentage = (sums, made, attempted) => sums[attempted] > 0 ? sums[made] / sums[attempted] : NaN;
  const shooting = {
    two: levelsFor((a, b) => percentage(a, 'twoMade', 'twoAtt') - percentage(b, 'twoMade', 'twoAtt'), prior => prior.shooting.two),
    three: levelsFor((a, b) => percentage(a, 'threeMade', 'threeAtt') - percentage(b, 'threeMade', 'threeAtt'), prior => prior.shooting.three),
  };
  return new Map(names.map(name => {
    const index = at.get(name);
    return [name, {
      volume: Object.fromEntries(VOLUME_KEYS.map(key => [key, bound(Math.exp(volume[key][index]), config.volumeRange)])),
      shooting: { two: bound(shooting.two[index], config.shootingGapRange), three: bound(shooting.three[index], config.shootingGapRange) },
      players: linkedPlayers.get(name), linkMinutes: Math.round(linkedMinutes.get(name)), measured: linkedPlayers.get(name) > 0,
    }];
  }));
}

/** A shooting gap as percentage points: "-3.2" when the competition's percentages drop at the reference level. */
const points = gap => `${gap > 0 ? '-' : '+'}${Math.abs(gap * 100).toFixed(1)}`;

/** One line per competition for notes and reports. */
export function describeLevels(levels) {
  return [...levels].map(([name, level]) => `${name}: x${level.volume.twoAttempts}/${level.volume.threeAttempts}/${level.volume.rebounds}/${level.volume.assists} (2PA/3PA/reb/ast), minutes x${level.volume.minutesPerGame}, 2P% ${points(level.shooting.two)}, 3P% ${points(level.shooting.three)} (${level.measured ? `${level.players} links` : 'default'})`).join('; ');
}

/**
 * Competition seasons whose free throws can be trusted: the league-wide rate over consistent box-score lines (points
 * equal 2 x two-pointers + 3 x three-pointers + free throws, no more made than attempted) must be believable.
 */
export function trustedFreeThrowSeasons(rows) {
  const totals = new Map();
  for (const row of rows) {
    const key = `${row.competition} ${row.season_label}`, entry = totals.get(key) ?? { made: 0, attempted: 0 };
    entry.made += Number(row.free_made_checked ?? 0); entry.attempted += Number(row.free_attempted_checked ?? 0);
    totals.set(key, entry);
  }
  const [low, high] = RATING_RULES.plausibleFreeThrows;
  return new Map([...totals].map(([key, entry]) => { const rate = entry.attempted ? entry.made / entry.attempted : 0; return [key, { rate: Math.round(rate * 1000) / 1000, trusted: entry.attempted > 0 && rate >= low && rate <= high }]; }));
}

/**
 * Ratings for every player with stored statistics. `rows` are season totals (player_season_totals); `players` holds
 * id, provider position and observed age.
 */
export function computeRatings(rows, players, gap, freeThrowSeasons = trustedFreeThrowSeasons(rows), options = {}) {
  const rules = RATING_RULES;
  const profiles = new Map(players.map(player => [player.id, player]));
  const totals = new Map();
  const european = { volume: { twoAttempts: 1, threeAttempts: 1, rebounds: 1, assists: 1, minutesPerGame: 1 }, shooting: { two: 0, three: 0 } };
  // rating-3 passes a Map of conversions per competition (competitionLevels) and the competitions' kinds and tiers;
  // a single gap converts every domestic row to the European level (rating-2).
  const kinds = new Map((options.competitions ?? []).map(competition => [competition.name, levelKind(competition)]));
  const conversionOf = row => gap instanceof Map ? gap.get(row.competition) ?? defaultLevel(kinds.get(row.competition) ?? `${row.kind}-1`) : row.kind === 'european' ? european : gap;
  for (const row of rows) {
    const weight = rules.recency[row.season_label] ?? 0.5, { volume, shooting } = conversionOf(row);
    const minutes = Number(row.seconds_played) / 60, entry = totals.get(row.player_id) ?? { minutes: 0, gameMinutes: 0, games: 0, clubGames: 0, twoMade: 0, twoAtt: 0, twoVolume: 0, threeMade: 0, threeAtt: 0, threeVolume: 0, freeMade: 0, freeAtt: 0, rebounds: 0, assists: 0, seasons: new Set(), byCompetition: new Map(), kinds: new Map() };
    entry.byCompetition.set(row.competition, (entry.byCompetition.get(row.competition) ?? 0) + weight * minutes); entry.kinds.set(row.competition, row.kind);
    entry.minutes += weight * minutes; entry.gameMinutes += weight * minutes * volume.minutesPerGame;
    entry.games += weight * Number(row.games_played); entry.clubGames += weight * Number(row.club_games);
    entry.twoMade += weight * (shot(row, 'two_made') - shooting.two * shot(row, 'two_attempted')); entry.twoAtt += weight * shot(row, 'two_attempted'); entry.twoVolume += weight * volume.twoAttempts * shot(row, 'two_attempted');
    entry.threeMade += weight * (shot(row, 'three_made') - shooting.three * shot(row, 'three_attempted')); entry.threeAtt += weight * shot(row, 'three_attempted'); entry.threeVolume += weight * volume.threeAttempts * shot(row, 'three_attempted');
    if (freeThrowSeasons.get(`${row.competition} ${row.season_label}`)?.trusted) { entry.freeMade += weight * Number(row.free_made_checked ?? row.free_made); entry.freeAtt += weight * Number(row.free_attempted_checked ?? row.free_attempted); }
    entry.rebounds += weight * volume.rebounds * Number(row.rebounds); entry.assists += weight * volume.assists * Number(row.assists);
    entry.seasons.add(`${row.competition} ${row.season_label}`);
    totals.set(row.player_id, entry);
  }
  const ids = [...totals.keys()].filter(id => profiles.has(id));
  const groupOf = id => group(profiles.get(id).position);
  const mainCompetition = id => [...totals.get(id).byCompetition].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
  const experienced = ids.filter(id => totals.get(id).minutes >= rules.scaleMinutes);
  // rating-3: the scale is set by players whose main competition is a top division or the reference competition.
  const qualified = kinds.size ? experienced.filter(id => rules.levels.scaleKinds.includes(kinds.get(mainCompetition(id)))) : experienced;
  // Position averages anchor small samples; with several leagues, the average of the player's own main competition.
  const priorFrom = pool => {
    const base = pool.length >= 5 ? pool : qualified.map(id => totals.get(id));
    const rate = key => sum(base.map(item => item[key])) / Math.max(1, sum(base.map(item => item.minutes)));
    return {
      two: sum(base.map(item => item.twoMade)) / Math.max(1, sum(base.map(item => item.twoAtt))), three: sum(base.map(item => item.threeMade)) / Math.max(1, sum(base.map(item => item.threeAtt))), free: sum(base.map(item => item.freeMade)) / Math.max(1, sum(base.map(item => item.freeAtt))),
      twoRate: rate('twoVolume'), threeRate: rate('threeVolume'), rebounds: rate('rebounds'), assists: rate('assists'),
      mpg: sum(base.map(item => item.gameMinutes)) / Math.max(1, sum(base.map(item => item.games))), availability: sum(base.map(item => item.games)) / Math.max(1, sum(base.map(item => item.clubGames))),
    };
  };
  const priorCache = new Map();
  const priorOf = id => {
    const name = groupOf(id), competition = kinds.size ? mainCompetition(id) : '', key = `${name}|${competition}`;
    if (!priorCache.has(key)) {
      const own = experienced.filter(other => groupOf(other) === name && (!kinds.size || mainCompetition(other) === competition)).map(other => totals.get(other));
      priorCache.set(key, priorFrom(own.length >= 5 ? own : qualified.filter(other => groupOf(other) === name).map(other => totals.get(other))));
    }
    return priorCache.get(key);
  };
  const shrinkRate = (value, minutes, prior) => (value + prior * rules.priorMinutes) / (minutes + rules.priorMinutes);
  // A few games say little about a player's minutes and availability: both start from the position average.
  const shrinkGames = (value, games, prior) => (value + prior * rules.priorGames) / (games + rules.priorGames);
  const features = new Map(ids.map(id => {
    const item = totals.get(id), prior = priorOf(id);
    return [id, {
      two: (item.twoMade + prior.two * rules.priorAttempts.two) / (item.twoAtt + rules.priorAttempts.two),
      three: (item.threeMade + prior.three * rules.priorAttempts.three) / (item.threeAtt + rules.priorAttempts.three),
      free: (item.freeMade + prior.free * rules.priorAttempts.free) / (item.freeAtt + rules.priorAttempts.free),
      twoRate: 40 * shrinkRate(item.twoVolume, item.minutes, prior.twoRate), threeRate: 40 * shrinkRate(item.threeVolume, item.minutes, prior.threeRate),
      rebounds: 40 * shrinkRate(item.rebounds, item.minutes, prior.rebounds), assists: 40 * shrinkRate(item.assists, item.minutes, prior.assists),
      mpg: shrinkGames(item.gameMinutes, item.games, prior.mpg), availability: Math.min(1, shrinkGames(item.games, item.clubGames, prior.availability)),
    }];
  }));
  // Pooled scales keep positional differences (centres rebound more, guards pass more), as in the game's own data.
  const scale = key => { const values = qualified.map(id => features.get(id)[key]); const m = mean(values), s = sd(values); return value => (value - m) / s; };
  const z = Object.fromEntries(['two', 'three', 'free', 'twoRate', 'threeRate', 'rebounds', 'assists', 'mpg', 'availability'].map(key => [key, scale(key)]));
  const composites = {
    two_point: f => 0.65 * z.two(f.two) + 0.35 * z.twoRate(f.twoRate),
    three_point: f => 0.6 * z.three(f.three) + 0.4 * z.threeRate(f.threeRate),
    free_throw: f => z.free(f.free),
    passing: f => z.assists(f.assists),
    rebounding: f => z.rebounds(f.rebounds),
    stamina: f => 0.7 * z.mpg(f.mpg) + 0.3 * z.availability(f.availability),
  };
  composites.defense = f => 0.5 * z.mpg(f.mpg) + 0.5 * mean(['two_point', 'three_point', 'passing', 'rebounding'].map(key => composites[key](f)));
  const standardise = Object.fromEntries(Object.entries(composites).map(([key, compute]) => { const values = qualified.map(id => compute(features.get(id))); const m = mean(values), s = sd(values); return [key, f => (compute(f) - m) / s]; }));
  const guardAssists = median(qualified.filter(id => groupOf(id) === 'Guard').map(id => features.get(id).assists));
  const forwardRebounds = median(qualified.filter(id => groupOf(id) === 'Forward').map(id => features.get(id).rebounds));
  const forwardThrees = median(qualified.filter(id => groupOf(id) === 'Forward').map(id => features.get(id).threeRate));
  const allAssists = qualified.map(id => features.get(id).assists).sort((a, b) => a - b), allRebounds = qualified.map(id => features.get(id).rebounds).sort((a, b) => a - b);
  const pct70 = values => values[Math.floor(values.length * 0.7)] ?? 0;

  return ids.map(id => {
    const item = totals.get(id), f = features.get(id), profile = profiles.get(id), name = groupOf(id);
    const fringe = item.minutes < rules.minimumMinutes;
    const estimated = new Set(['defense', 'height_cm', 'weight_kg']);
    const values = Object.fromEntries(Object.entries(standardise).map(([key, compute]) => [key, clampScale(rules.centre + rules.spread * compute(f) - (fringe ? rules.fringePenalty : 0))]));
    if (fringe) for (const key of Object.keys(values)) estimated.add(key);
    if (item.freeAtt < 5) estimated.add('free_throw');
    const age = profile.age_observed;
    if (age && age > rules.staminaAge) values.stamina = clampScale(values.stamina - Math.min(4, age - rules.staminaAge));
    if (!age) estimated.add('age');
    const inferred = name === 'Center' ? 'C' : name === 'Guard' ? (f.assists >= guardAssists ? 'PG' : 'SG') : name === 'Forward' ? (f.rebounds >= forwardRebounds && f.threeRate <= forwardThrees ? 'PF' : 'SF') : f.assists >= pct70(allAssists) ? 'PG' : f.rebounds >= pct70(allRebounds) ? 'PF' : 'SF';
    const resolution = resolvePosition(profiles.get(id).position, inferred);
    const position = resolution.position;
    if (resolution.estimated) estimated.add('game_position');
    const [height, weight] = rules.build[position];
    const round = value => Math.round(value * 100) / 100;
    return {
      player_id: id, ...values, game_position: position, height_cm: height, weight_kg: weight, estimated: [...estimated].sort(),
      method: { rules: rules.id, weightedMinutes: round(item.minutes), weightedGames: round(item.games), seasons: [...item.seasons].sort(), mainCompetition: mainCompetition(id), conversion: Object.fromEntries([...item.byCompetition.keys()].sort().map(competition => { const { volume, shooting } = conversionOf({ competition, kind: item.kinds.get(competition) }); return [competition, { volume, shooting }]; })), positionGroup: name, shooting: { two: round(f.two), three: round(f.three), free: round(f.free) }, per40: { twoAttempts: round(f.twoRate), threeAttempts: round(f.threeRate), rebounds: round(f.rebounds), assists: round(f.assists) }, minutesPerGame: round(f.mpg), availability: round(f.availability), age: age ?? null },
    };
  });
}

/** The game's position-weighted overall rating (1-99) for one stored rating row. */
export function ratingOverall(rating) {
  return overallRating({ twoPoint: rating.two_point, threePoint: rating.three_point, freeThrow: rating.free_throw, passing: rating.passing, defense: rating.defense, rebounding: rating.rebounding, stamina: rating.stamina }, rating.game_position);
}

async function main() {
  if (!VERSION) throw new Error('Name the dataset version, for example --version 2026.11-pilot-2. Published versions never change, so new ratings always get a new name.');
  const { databaseHelpers } = await import('./real-data-import.mjs');
  const { db, selectAll, write } = await databaseHelpers();
  const rows = await selectAll('player_season_totals?select=*');
  // Records merged into another player (provider duplicates) are not rated.
  const players = await selectAll('players?select=id,full_name,position,age_observed&merged_into=is.null');
  const competitions = await selectAll('competitions?select=name,kind,tier');
  const levels = competitionLevels(rows, competitions), freeThrows = trustedFreeThrowSeasons(rows);
  const ratings = computeRatings(rows, players, levels, freeThrows, { competitions });
  const ignored = [...freeThrows].filter(([, value]) => !value.trusted).map(([key, value]) => `${key} (${Math.round(value.rate * 100)}%)`);
  const notes = `Ratings (${RATING_RULES.id}); conversion to the ${RATING_RULES.levels.reference} level per competition: ${describeLevels(levels)}; free throws ignored for ${ignored.join(', ') || 'none'}`;
  if (!PREVIEW) {
    // A published version is immutable: its pack was built from these ratings.
    const [existing] = await db('GET', `dataset_versions?id=eq.${encodeURIComponent(VERSION)}&select=status`);
    if (existing?.status === 'published') throw new Error(`Version ${VERSION} is published and cannot change; rate into a new version, for example --version ${VERSION}b.`);
    const [run] = await db('GET', 'import_runs?status=eq.succeeded&order=id.desc&limit=1&select=id');
    await write('dataset_versions', [{ id: VERSION, status: 'draft', source_run_id: run?.id ?? null, notes }], { onConflict: 'id' });
    await db('DELETE', `player_ratings?dataset_version_id=eq.${encodeURIComponent(VERSION)}`);
    await write('player_ratings', ratings.map(rating => ({ dataset_version_id: VERSION, ...rating })));
  }

  // A short report for a human check: the best-rated players of each current squad's competition, by the game's overall rating.
  const memberships = await selectAll('roster_memberships?select=player_id,club_id,seasons(label,competitions(name))');
  const clubs = new Map((await selectAll('clubs?select=id,name')).map(club => [club.id, club.name]));
  const names = new Map(players.map(player => [player.id, player.full_name]));
  // A player can be registered in a domestic and a European competition at once.
  const registrations = memberships.filter(row => row.seasons?.label === '2026-27').map(row => ({ playerId: row.player_id, club: clubs.get(row.club_id), competition: row.seasons.competitions.name }));
  const ratingOf = new Map(ratings.map(rating => [rating.player_id, rating]));
  const lines = [`# Ratings ${VERSION}${PREVIEW ? ' (preview, not saved)' : ''}`, '', `Rules ${RATING_RULES.id}. ${ratings.length} players rated, ${ratings.filter(rating => rating.estimated.includes('two_point')).length} with too few minutes (estimated). Free throws ignored for: ${ignored.join(', ') || 'none'} (implausible provider data).`, ''];
  lines.push(`## Conversion to the ${RATING_RULES.levels.reference} level`, '', '| Competition | 2PA | 3PA | Reb | Ast | Minutes | 2P% | 3P% | Linking players |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, level] of [...levels].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`| ${name} | x${level.volume.twoAttempts} | x${level.volume.threeAttempts} | x${level.volume.rebounds} | x${level.volume.assists} | x${level.volume.minutesPerGame} | ${points(level.shooting.two)} | ${points(level.shooting.three)} | ${level.measured ? level.players : 'default'} |`);
  // League strength: each club's best eight overall ratings, averaged; then the competition's spread.
  lines.push('', '## League strength 2026-27 (average of each club\'s best eight)', '', '| Competition | Clubs | Strongest | Median | Weakest |', '| --- | --- | --- | --- | --- |');
  const competitionNames = [...new Set(registrations.map(item => item.competition))].sort();
  for (const competition of competitionNames) {
    const byClub = new Map();
    for (const item of registrations.filter(entry => entry.competition === competition)) { const rating = ratingOf.get(item.playerId); if (rating) byClub.set(item.club, [...(byClub.get(item.club) ?? []), ratingOverall(rating)]); }
    const strength = [...byClub].map(([club, values]) => [club, Math.round(mean(values.sort((a, b) => b - a).slice(0, 8)) * 10) / 10]).sort((a, b) => b[1] - a[1]);
    if (strength.length) lines.push(`| ${competition} | ${strength.length} | ${strength[0][0]} ${strength[0][1]} | ${strength[Math.floor(strength.length / 2)][1]} | ${strength.at(-1)[0]} ${strength.at(-1)[1]} |`);
  }
  lines.push('');
  for (const competition of competitionNames) {
    lines.push(`## ${competition} 2026-27: top 15`, '', '| Player | Club | Pos | OVR | Stars | 2P | 3P | FT | Pass | Def* | Reb | Sta | Minutes |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    const pool = [...new Map(registrations.filter(item => item.competition === competition && ratingOf.has(item.playerId)).map(item => [item.playerId, item])).values()].sort((a, b) => ratingOverall(ratingOf.get(b.playerId)) - ratingOverall(ratingOf.get(a.playerId))).slice(0, 15);
    for (const item of pool) { const r = ratingOf.get(item.playerId); lines.push(`| ${names.get(r.player_id)} | ${item.club} | ${r.game_position} | ${ratingOverall(r)} | ${overallRatingStars(ratingOverall(r))} | ${r.two_point} | ${r.three_point} | ${r.free_throw} | ${r.passing} | ${r.defense} | ${r.rebounding} | ${r.stamina} | ${Math.round(r.method.weightedMinutes)} |`); }
    lines.push('');
  }
  lines.push('*Defence is estimated: the provider has no steals, blocks or fouls. Minutes are weighted (previous season at 70%).');
  const report = path.join(ROOT, '.local-data', 'real-data', `ratings-report-${VERSION}.md`);
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, `${lines.join('\n')}\n`);
  console.log(`${PREVIEW ? 'Previewed' : 'Rated'} ${ratings.length} players for ${VERSION} (${RATING_RULES.id}). Report: ${path.relative(ROOT, report)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

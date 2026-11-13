#!/usr/bin/env node
/**
 * Real-data ratings (docs/real-data-feasibility.md, part 4): turns stored box scores into the game's seven abilities
 * (1-20), its five positions and estimated height/weight, for one draft dataset version. Provisional rules, all
 * listed in RATING_RULES; every estimate is named in `estimated`, and `method` keeps the inputs behind each rating.
 * Published versions never change, so every run names its version.
 *
 *   node scripts/real-data-ratings.mjs --version 2026.11-pilot-2
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overallRating, overallRatingStars } from '../src/world/overall-rating.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionArg = process.argv.indexOf('--version');
const VERSION = versionArg > 0 ? process.argv[versionArg + 1] : null;
/** --preview computes the ratings and writes the report without saving anything to the database. */
const PREVIEW = process.argv.includes('--preview');

export const RATING_RULES = Object.freeze({
  id: 'rating-2',
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
    side.twoMade += Number(row.two_made); side.twoAtt += Number(row.two_attempted); side.threeMade += Number(row.three_made); side.threeAtt += Number(row.three_attempted);
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
export function computeRatings(rows, players, gap, freeThrowSeasons = trustedFreeThrowSeasons(rows)) {
  const rules = RATING_RULES;
  const profiles = new Map(players.map(player => [player.id, player]));
  const totals = new Map();
  const european = { volume: { twoAttempts: 1, threeAttempts: 1, rebounds: 1, assists: 1, minutesPerGame: 1 }, shooting: { two: 0, three: 0 } };
  for (const row of rows) {
    const weight = rules.recency[row.season_label] ?? 0.5, { volume, shooting } = row.kind === 'european' ? european : gap;
    const minutes = Number(row.seconds_played) / 60, entry = totals.get(row.player_id) ?? { minutes: 0, gameMinutes: 0, games: 0, clubGames: 0, twoMade: 0, twoAtt: 0, twoVolume: 0, threeMade: 0, threeAtt: 0, threeVolume: 0, freeMade: 0, freeAtt: 0, rebounds: 0, assists: 0, seasons: new Set() };
    entry.minutes += weight * minutes; entry.gameMinutes += weight * minutes * volume.minutesPerGame;
    entry.games += weight * Number(row.games_played); entry.clubGames += weight * Number(row.club_games);
    entry.twoMade += weight * (Number(row.two_made) - shooting.two * Number(row.two_attempted)); entry.twoAtt += weight * Number(row.two_attempted); entry.twoVolume += weight * volume.twoAttempts * Number(row.two_attempted);
    entry.threeMade += weight * (Number(row.three_made) - shooting.three * Number(row.three_attempted)); entry.threeAtt += weight * Number(row.three_attempted); entry.threeVolume += weight * volume.threeAttempts * Number(row.three_attempted);
    if (freeThrowSeasons.get(`${row.competition} ${row.season_label}`)?.trusted) { entry.freeMade += weight * Number(row.free_made_checked ?? row.free_made); entry.freeAtt += weight * Number(row.free_attempted_checked ?? row.free_attempted); }
    entry.rebounds += weight * volume.rebounds * Number(row.rebounds); entry.assists += weight * volume.assists * Number(row.assists);
    entry.seasons.add(`${row.competition} ${row.season_label}`);
    totals.set(row.player_id, entry);
  }
  const ids = [...totals.keys()].filter(id => profiles.has(id));
  const groupOf = id => group(profiles.get(id).position);
  const qualified = ids.filter(id => totals.get(id).minutes >= rules.scaleMinutes);
  // Position averages anchor small samples.
  const priors = {};
  for (const name of ['Guard', 'Forward', 'Center', 'Unknown']) {
    const pool = qualified.filter(id => groupOf(id) === name).map(id => totals.get(id));
    const base = pool.length >= 5 ? pool : qualified.map(id => totals.get(id));
    const rate = key => sum(base.map(item => item[key])) / Math.max(1, sum(base.map(item => item.minutes)));
    priors[name] = {
      two: sum(base.map(item => item.twoMade)) / Math.max(1, sum(base.map(item => item.twoAtt))), three: sum(base.map(item => item.threeMade)) / Math.max(1, sum(base.map(item => item.threeAtt))), free: sum(base.map(item => item.freeMade)) / Math.max(1, sum(base.map(item => item.freeAtt))),
      twoRate: rate('twoVolume'), threeRate: rate('threeVolume'), rebounds: rate('rebounds'), assists: rate('assists'),
      mpg: sum(base.map(item => item.gameMinutes)) / Math.max(1, sum(base.map(item => item.games))), availability: sum(base.map(item => item.games)) / Math.max(1, sum(base.map(item => item.clubGames))),
    };
  }
  const shrinkRate = (value, minutes, prior) => (value + prior * rules.priorMinutes) / (minutes + rules.priorMinutes);
  // A few games say little about a player's minutes and availability: both start from the position average.
  const shrinkGames = (value, games, prior) => (value + prior * rules.priorGames) / (games + rules.priorGames);
  const features = new Map(ids.map(id => {
    const item = totals.get(id), prior = priors[groupOf(id)];
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
    const position = name === 'Center' ? 'C' : name === 'Guard' ? (f.assists >= guardAssists ? 'PG' : 'SG') : name === 'Forward' ? (f.rebounds >= forwardRebounds && f.threeRate <= forwardThrees ? 'PF' : 'SF') : f.assists >= pct70(allAssists) ? 'PG' : f.rebounds >= pct70(allRebounds) ? 'PF' : 'SF';
    if (name === 'Unknown') estimated.add('game_position');
    const [height, weight] = rules.build[position];
    const round = value => Math.round(value * 100) / 100;
    return {
      player_id: id, ...values, game_position: position, height_cm: height, weight_kg: weight, estimated: [...estimated].sort(),
      method: { rules: rules.id, weightedMinutes: round(item.minutes), weightedGames: round(item.games), seasons: [...item.seasons].sort(), leagueGap: { volume: gap.volume, shooting: gap.shooting, players: gap.players, measured: gap.measured }, positionGroup: name, shooting: { two: round(f.two), three: round(f.three), free: round(f.free) }, per40: { twoAttempts: round(f.twoRate), threeAttempts: round(f.threeRate), rebounds: round(f.rebounds), assists: round(f.assists) }, minutesPerGame: round(f.mpg), availability: round(f.availability), age: age ?? null },
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
  const gap = leagueGap(rows), freeThrows = trustedFreeThrowSeasons(rows);
  const ratings = computeRatings(rows, players, gap, freeThrows);
  const ignored = [...freeThrows].filter(([, value]) => !value.trusted).map(([key, value]) => `${key} (${Math.round(value.rate * 100)}%)`);
  const notes = `Pilot ratings (${RATING_RULES.id}); ${describeLeagueGap(gap)}; free throws ignored for ${ignored.join(', ') || 'none'}`;
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
  const current = new Map(memberships.filter(row => row.seasons?.label === '2026-27').map(row => [row.player_id, { club: clubs.get(row.club_id), competition: row.seasons.competitions.name }]));
  const lines = [`# Pilot ratings ${VERSION}${PREVIEW ? ' (preview, not saved)' : ''}`, '', `Rules ${RATING_RULES.id}; ${describeLeagueGap(gap)}. ${ratings.length} players rated, ${ratings.filter(rating => rating.estimated.includes('two_point')).length} with too few minutes (estimated). Free throws ignored for: ${ignored.join(', ') || 'none'} (implausible provider data).`, ''];
  for (const competition of [...new Set([...current.values()].map(item => item.competition))].sort()) {
    lines.push(`## ${competition} 2026-27: top 15`, '', '| Player | Club | Pos | OVR | Stars | 2P | 3P | FT | Pass | Def* | Reb | Sta | Minutes |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    const pool = ratings.filter(rating => current.get(rating.player_id)?.competition === competition).sort((a, b) => ratingOverall(b) - ratingOverall(a)).slice(0, 15);
    for (const r of pool) lines.push(`| ${names.get(r.player_id)} | ${current.get(r.player_id).club} | ${r.game_position} | ${ratingOverall(r)} | ${overallRatingStars(ratingOverall(r))} | ${r.two_point} | ${r.three_point} | ${r.free_throw} | ${r.passing} | ${r.defense} | ${r.rebounding} | ${r.stamina} | ${Math.round(r.method.weightedMinutes)} |`);
    lines.push('');
  }
  lines.push('*Defence is estimated: the provider has no steals, blocks or fouls. Minutes are weighted (previous season at 70%).');
  const report = path.join(ROOT, '.local-data', 'real-data', `ratings-report-${VERSION}.md`);
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, `${lines.join('\n')}\n`);
  console.log(`${PREVIEW ? 'Previewed' : 'Rated'} ${ratings.length} players for ${VERSION} (${RATING_RULES.id}); ${describeLeagueGap(gap)}. Report: ${path.relative(ROOT, report)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

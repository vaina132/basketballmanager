#!/usr/bin/env node
/**
 * Real-data ratings (docs/real-data-feasibility.md, part 4): turns stored box scores into the game's seven abilities
 * (1-20), its five positions and estimated height/weight, for one draft dataset version. Provisional rules, all
 * listed in RATING_RULES; every estimate is named in `estimated`, and `method` keeps the inputs behind each rating.
 * Published versions never change, so every run names its version.
 *
 *   node scripts/real-data-ratings.mjs --version 2026.11-world-1
 *   node scripts/real-data-ratings.mjs --version 2026.11-world-16 --strength   (rating-5)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overallRating, overallRatingStars } from '../src/world/overall-rating.ts';
import {
  RATING_RULES, STRENGTH_RULES, competitionLevels, computeRatings, describeLevels, mean, per40, points, seasonLines, shot, strengthRatings, sum, teamStrengths,
  trustedFreeThrowSeasons, VOLUME_KEYS,
} from '../supabase/functions/publish-starter-pack/rating-model.mjs';

// The rating model itself (rating-3 and rating-5) lives in the publishing function's folder, so the function runs the
// same code; it is re-exported here for the other scripts and the tests.
export { RATING_RULES, STRENGTH_RULES, competitionLevels, computeRatings, describeLevels, levelKind, neutralLines, seasonLines, strengthRatings, teamStrengths, trustedFreeThrowSeasons } from '../supabase/functions/publish-starter-pack/rating-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionArg = process.argv.indexOf('--version');
const VERSION = versionArg > 0 ? process.argv[versionArg + 1] : null;
/** --preview computes the ratings and writes the report without saving anything to the database. */
const PREVIEW = process.argv.includes('--preview');
/** --strength rates with rating-5 (team and opposition strength, STRENGTH_RULES) instead of rating-3. */
const STRENGTH = process.argv.includes('--strength');


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


/**
 * rating-4 (NBA, 23 November 2026, owner decision: one shared 1-20 scale anchored on Europe). Europe is solved exactly
 * as rating-3 and stays as published; then one more competition's level (the NBA) is fitted with every European
 * level held fixed, from the same kinds of links as rating-3 (players in both in one season at full weight; a move
 * between domestic leagues from one season to the next at `crossSeasonWeight`: 2025-26 NBA -> 2026-27 Europe and
 * 2025-26 Europe -> 2026-27 NBA), plus its own prior worth `priorMinutes` of links. Its players are then rated with
 * computeRatings on the fixed European scale (options.scale), so every European player keeps his rating and an NBA
 * player is measured on the same ladder (stars reach 20).
 *
 * The links alone (20 players in the 2026-11 data) say x1.34 two-point attempts and x1.40 minutes per game: almost all
 * are NBA bench players who became starters in Europe (or European stars who became NBA bench players), so they mix
 * the role change into the level, and applied to NBA starters they would put nearly every NBA player at 99. The prior
 * therefore carries most of the weight (worth 20,000 link minutes against about 2,400 measured): per-40 volumes x0.95
 * (the NBA plays about 100 possessions in 48 minutes, 83 per 40, against the EuroLeague's 72, so x0.87 for pace,
 * then x1.09 for the stronger opposition), minutes per game x0.85 (40 of 48 minutes, x1.02 for strength), shooting
 * one percentage point better at the reference level. Checked on the result: each NBA club's eighth-best player rates
 * above about 89% of European players with 300+ minutes, about 30 NBA players reach 99.
 */
export const NBA_LEVEL_RULES = Object.freeze({
  id: 'rating-4',
  competition: 'NBA',
  crossSeasonWeight: 0.5,
  priorMinutes: 20000,
  prior: Object.freeze({ volume: 0.95, minutesPerGame: 0.85, shooting: Object.freeze({ two: -0.01, three: -0.01 }) }),
  volumeRange: Object.freeze([0.75, 1.8]),
  shootingGapRange: Object.freeze([-0.1, 0.02]),
});

/** Per-player sides by season and competition, as competitionLevels collects them. */
function sidesByPlayer(rows, known) {
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
  return byPlayer;
}

/**
 * One competition's conversion to the reference level with every other competition's conversion fixed (`fixedLevels`,
 * a Map as competitionLevels returns). Each link to the target says level(target) = level(other) + difference (the
 * difference measured as competitionLevels measures it, from the link's weighted rates and pooled percentages); the
 * weighted mean of those with the prior is the least-squares answer for one unknown.
 */
export function fitCompetitionLevel(rows, competitions, fixedLevels, rules = NBA_LEVEL_RULES) {
  const target = rules.competition, known = new Map(competitions.map(competition => [competition.name, competition]));
  const byPlayer = sidesByPlayer(rows, known), links = [];
  const seasonOrder = [...new Set(rows.map(row => row.season_label))].sort();
  for (const [playerId, seasons] of byPlayer) {
    for (const [season, played] of seasons) {
      const own = played.get(target);
      if (!own || own.minutes < RATING_RULES.pairMinutes) continue;
      for (const [name, side] of played) if (name !== target && side.minutes >= RATING_RULES.pairMinutes && fixedLevels.has(name)) links.push({ playerId, other: name, targetSide: own, otherSide: side, weight: Math.min(own.minutes, side.minutes), kind: `same season ${season}` });
    }
    const mainDomestic = label => [...(seasons.get(label) ?? [])].filter(([name, side]) => known.get(name).kind === 'domestic' && side.minutes >= RATING_RULES.pairMinutes).sort((x, y) => y[1].minutes - x[1].minutes)[0];
    for (let index = 1; index < seasonOrder.length; index += 1) {
      const before = mainDomestic(seasonOrder[index - 1]), after = mainDomestic(seasonOrder[index]);
      if (!before || !after || before[0] === after[0] || ![before[0], after[0]].includes(target)) continue;
      const [own, other] = before[0] === target ? [before, after] : [after, before];
      if (fixedLevels.has(other[0])) links.push({ playerId, other: other[0], targetSide: own[1], otherSide: other[1], weight: rules.crossSeasonWeight * Math.min(before[1].minutes, after[1].minutes), kind: before[0] === target ? 'moved from the NBA' : 'moved to the NBA' });
    }
  }
  const sideRate = (side, key) => key === 'minutesPerGame' ? (side.games > 0 ? side.minutes / side.games : 0) : per40(side[{ twoAttempts: 'twoAtt', threeAttempts: 'threeAtt', rebounds: 'rebounds', assists: 'assists' }[key]], side.minutes);
  const empty = () => ({ twoAttempts: 0, threeAttempts: 0, rebounds: 0, assists: 0, minutesPerGame: 0, twoMade: 0, twoAtt: 0, threeMade: 0, threeAtt: 0 });
  const byOther = new Map();
  for (const link of links) {
    const entry = byOther.get(link.other) ?? { weight: 0, players: 0, target: empty(), other: empty() };
    entry.weight += link.weight; entry.players += 1;
    for (const [name, side] of [['target', link.targetSide], ['other', link.otherSide]]) {
      for (const key of VOLUME_KEYS) entry[name][key] += link.weight * sideRate(side, key);
      entry[name].twoMade += side.twoMade; entry[name].twoAtt += side.twoAtt; entry[name].threeMade += side.threeMade; entry[name].threeAtt += side.threeAtt;
    }
    byOther.set(link.other, entry);
  }
  const fit = (differenceOf, levelOf, prior) => {
    let weight = rules.priorMinutes, total = rules.priorMinutes * prior;
    for (const [other, entry] of byOther) { const difference = differenceOf(entry); if (!Number.isFinite(difference)) continue; weight += entry.weight; total += entry.weight * (levelOf(fixedLevels.get(other)) + difference); }
    return total / weight;
  };
  const bound = (value, [low, high]) => Math.round(Math.max(low, Math.min(high, value)) * 1000) / 1000;
  const volume = Object.fromEntries(VOLUME_KEYS.map(key => [key, bound(Math.exp(fit(entry => entry.target[key] > 0 && entry.other[key] > 0 ? Math.log(entry.other[key] / entry.target[key]) : NaN, level => Math.log(level.volume[key]), Math.log(key === 'minutesPerGame' ? rules.prior.minutesPerGame : rules.prior.volume))), rules.volumeRange)]));
  const percentage = (sums, made, attempted) => sums[attempted] > 0 ? sums[made] / sums[attempted] : NaN;
  const shooting = {
    two: bound(fit(entry => percentage(entry.target, 'twoMade', 'twoAtt') - percentage(entry.other, 'twoMade', 'twoAtt'), level => level.shooting.two, rules.prior.shooting.two), rules.shootingGapRange),
    three: bound(fit(entry => percentage(entry.target, 'threeMade', 'threeAtt') - percentage(entry.other, 'threeMade', 'threeAtt'), level => level.shooting.three, rules.prior.shooting.three), rules.shootingGapRange),
  };
  return {
    volume, shooting, players: new Set(links.map(link => link.playerId)).size, linkMinutes: Math.round(links.reduce((total, link) => total + link.weight, 0)), measured: links.length > 0,
    links: [...byOther].map(([other, entry]) => ({ other, players: entry.players, weight: Math.round(entry.weight) })).sort((a, b) => b.weight - a.weight),
    linkList: links.map(link => ({ playerId: link.playerId, other: link.other, kind: link.kind, weight: Math.round(link.weight) })),
  };
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
  let levels = competitionLevels(rows, competitions), ratings = null;
  const freeThrows = trustedFreeThrowSeasons(rows);
  if (STRENGTH) {
    // rating-5: the same lines from the box scores with their clubs, put in a neutral setting before rating-3 runs.
    const games = await selectAll('games?select=id,season_id,home_club_id,away_club_id,home_score,away_score,stats_rows');
    const seasons = new Map((await selectAll('seasons?select=id,label,competitions(name,kind)')).map(season => [season.id, { label: season.label, competition: season.competitions.name, kind: season.competitions.kind }]));
    const stats = await selectAll('player_game_stats?select=game_id,player_id,club_id,seconds_played,two_made,two_attempted,three_made,three_attempted,free_made,free_attempted,rebounds,assists,points');
    const result = strengthRatings(seasonLines(stats, games, seasons), players, competitions, teamStrengths(games));
    levels = result.neutralLevels;
    ratings = result.adjusted.map(rating => { const { unclamped, ...row } = rating; return { ...row, method: { ...row.method, rules: STRENGTH_RULES.id, strength: result.contexts.get(rating.player_id) ?? null } }; });
  } else ratings = computeRatings(rows, players, levels, freeThrows, { competitions });
  const ignored = [...freeThrows].filter(([, value]) => !value.trusted).map(([key, value]) => `${key} (${Math.round(value.rate * 100)}%)`);
  const notes = `Ratings (${STRENGTH ? `${STRENGTH_RULES.id}: rating-3 on lines in a neutral team and opposition setting` : RATING_RULES.id}); conversion to the ${RATING_RULES.levels.reference} level per competition: ${describeLevels(levels)}; free throws ignored for ${ignored.join(', ') || 'none'}`;
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

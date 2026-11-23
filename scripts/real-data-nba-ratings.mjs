#!/usr/bin/env node
/**
 * NBA ratings on the shared 1-20 scale (docs/nba-plan.md step 2, rule rating-4; owner decision 23 November 2026: one
 * scale anchored on Europe, European ratings exactly as they are, NBA stars may reach 20).
 *
 * Europe is not rated again: its ratings stay those of dataset version 2026.11-world-1 (rating-3). From that version
 * this script keeps three fixed inputs, read once with SQL (23 November 2026) and written below:
 * - EUROPE_LEVELS: each European competition's conversion to the EuroLeague level (every rating row's `conversion`);
 * - EUROPE_SCALE: the means and spreads of rating-3's features and composites over its scale pool (1,062 players with
 *   300+ weighted minutes whose main competition is a top division or the EuroLeague), from the rating rows' stored
 *   features. Recomputing every stored European rating from them gives the stored value or one point off where the
 *   stored features' rounding (two decimals) decides (never more), so the scale is the published one;
 * - the European season totals of players who also played in the NBA (--europe), for the links.
 * Then fitCompetitionLevel (scripts/real-data-ratings.mjs) fits the NBA's conversion with the European levels fixed,
 * and computeRatings rates every NBA roster player from his NBA (and any European) season totals on the fixed
 * European scale. The box scores come from API-Sports with the importer's own mapping (scripts/real-data-nba.mjs).
 *
 *   node scripts/real-data-nba-ratings.mjs --data nba-data.json --europe europe-rows.json --out nba-ratings.json
 *
 * The output adds to each standard roster player his game abilities (unclamped values kept for the report),
 * `ratingMinutes`, `ratingGames` and `estimated`; the position balance runs later, in publish-starter-pack, on the
 * NBA alone.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RATING_RULES, NBA_LEVEL_RULES, computeRatings, fitCompetitionLevel, trustedFreeThrowSeasons, describeLevels } from './real-data-ratings.mjs';
import { overallRating } from '../src/world/overall-rating.ts';

/** Each European competition's rating-3 conversion (dataset version 2026.11-world-1). */
export const EUROPE_LEVELS = Object.freeze({
  'Basketball Bundesliga': { volume: { assists: 0.913, rebounds: 0.836, twoAttempts: 0.98, threeAttempts: 0.904, minutesPerGame: 0.98 }, shooting: { two: 0.04, three: -0.001 } },
  'Basketball Champions League': { volume: { assists: 0.9, rebounds: 0.88, twoAttempts: 0.974, threeAttempts: 0.922, minutesPerGame: 0.961 }, shooting: { two: 0.02, three: 0.006 } },
  'Basketbol Süper Ligi': { volume: { assists: 0.875, rebounds: 0.902, twoAttempts: 0.985, threeAttempts: 0.931, minutesPerGame: 0.991 }, shooting: { two: 0.024, three: 0.01 } },
  'Élite 2': { volume: { assists: 0.719, rebounds: 0.758, twoAttempts: 0.797, threeAttempts: 0.821, minutesPerGame: 0.862 }, shooting: { two: 0.062, three: 0.034 } },
  EuroCup: { volume: { assists: 0.887, rebounds: 0.891, twoAttempts: 0.973, threeAttempts: 0.947, minutesPerGame: 0.979 }, shooting: { two: 0.032, three: -0.009 } },
  EuroLeague: { volume: { assists: 1, rebounds: 1, twoAttempts: 1, threeAttempts: 1, minutesPerGame: 1 }, shooting: { two: 0, three: 0 } },
  'Greek Basket League': { volume: { assists: 0.84, rebounds: 0.894, twoAttempts: 0.985, threeAttempts: 0.951, minutesPerGame: 0.947 }, shooting: { two: 0.031, three: 0.012 } },
  'Lega Basket Serie A': { volume: { assists: 0.926, rebounds: 0.905, twoAttempts: 0.968, threeAttempts: 0.955, minutesPerGame: 0.988 }, shooting: { two: 0.034, three: 0.01 } },
  'Liga ACB': { volume: { assists: 1.05, rebounds: 0.855, twoAttempts: 0.95, threeAttempts: 0.972, minutesPerGame: 1.015 }, shooting: { two: 0.011, three: 0.012 } },
  'LNB Élite': { volume: { assists: 0.842, rebounds: 0.898, twoAttempts: 1.009, threeAttempts: 0.901, minutesPerGame: 0.956 }, shooting: { two: 0.041, three: 0.002 } },
  'Primera FEB': { volume: { assists: 0.816, rebounds: 0.734, twoAttempts: 0.761, threeAttempts: 0.778, minutesPerGame: 0.922 }, shooting: { two: 0.03, three: 0.07 } },
  'Serie A2': { volume: { assists: 0.884, rebounds: 0.765, twoAttempts: 0.755, threeAttempts: 0.841, minutesPerGame: 0.78 }, shooting: { two: 0.048, three: 0.006 } },
  'Türkiye Basketbol Ligi': { volume: { assists: 0.671, rebounds: 0.672, twoAttempts: 0.746, threeAttempts: 0.725, minutesPerGame: 0.772 }, shooting: { two: 0.052, three: 0.054 } },
});
export const EUROPE_COMPETITIONS = Object.freeze([
  ['Basketball Bundesliga', 'domestic', 1], ['Basketball Champions League', 'european', 2], ['Basketbol Süper Ligi', 'domestic', 1], ['Élite 2', 'domestic', 2], ['EuroCup', 'european', 2],
  ['EuroLeague', 'european', 1], ['Greek Basket League', 'domestic', 1], ['Lega Basket Serie A', 'domestic', 1], ['Liga ACB', 'domestic', 1], ['LNB Élite', 'domestic', 1],
  ['Primera FEB', 'domestic', 2], ['Serie A2', 'domestic', 2], ['Türkiye Basketbol Ligi', 'domestic', 2],
].map(([name, kind, tier]) => ({ name, kind, tier })));
/** Free throws the published ratings ignored (implausible league-wide rates in the provider data). */
export const EUROPE_UNTRUSTED_FREE_THROWS = Object.freeze(['EuroCup 2026-27', 'EuroLeague 2026-27']);
/** rating-3's scale over its pool (2026.11-world-1): features, then composites, then the position medians. */
export const EUROPE_SCALE = Object.freeze({
  pool: 1062,
  features: {
    two: { mean: 0.519359698681732, sd: 0.0594954032558156 }, three: { mean: 0.342514124293786, sd: 0.0282474152299107 }, free: { mean: 0.755282485875707, sd: 0.0710313135785761 },
    twoRate: { mean: 7.24267419962336, sd: 2.22938245806432 }, threeRate: { mean: 5.1052165725047, sd: 2.38676732976419 }, rebounds: { mean: 5.76696798493408, sd: 2.06015957477845 },
    assists: { mean: 3.39736346516008, sd: 1.83193069551393 }, mpg: { mean: 20.1635404896422, sd: 3.32169871905736 }, availability: { mean: 0.791676082862523, sd: 0.144518867236401 },
  },
  composites: {
    two_point: { mean: 0, sd: 0.812682003685812 }, three_point: { mean: 0, sd: 0.822747906814425 }, free_throw: { mean: 0, sd: 1 }, passing: { mean: 0, sd: 1 },
    rebounding: { mean: 0, sd: 1 }, stamina: { mean: 0, sd: 0.800141449067786 }, defense: { mean: 0, sd: 0.543354242099941 },
  },
  medians: { guardAssists: 4.64, forwardRebounds: 6.75, forwardThrees: 4.59 },
});

const GAME_KEYS = { two_point: 'twoPoint', three_point: 'threePoint', free_throw: 'freeThrow', passing: 'passing', defense: 'defense', rebounding: 'rebounding', stamina: 'stamina' };
const GROUP = { PG: 'Guard', SG: 'Guard', SF: 'Forward', PF: 'Forward', C: 'Center' };
const OPENING = '2026-09-05';
export const ageOn = (born, day = OPENING) => Number(day.slice(0, 4)) - Number(born.slice(0, 4)) - Number(day.slice(5) < born.slice(5));
/** Within a broad group without an exact position, the ratings' own rule (scripts/real-data-ratings.mjs). */
const withinGroup = (group, method) => {
  if (['G', 'GF', 'FG'].includes(group) && method) return group === 'G' ? (method.per40.assists >= EUROPE_SCALE.medians.guardAssists ? 'PG' : 'SG') : (method.per40.rebounds >= EUROPE_SCALE.medians.forwardRebounds ? 'SF' : 'SG');
  if (['F', 'FC', 'CF'].includes(group) && method) return group === 'F' ? (method.per40.rebounds >= EUROPE_SCALE.medians.forwardRebounds && method.per40.threeAttempts <= EUROPE_SCALE.medians.forwardThrees ? 'PF' : 'SF') : 'PF';
  return { G: 'SG', GF: 'SF', FG: 'SF', F: 'SF', FC: 'PF', CF: 'PF', C: 'C' }[group] ?? 'SF';
};

export function rateNba(data, europeRows, rules = NBA_LEVEL_RULES) {
  const competitions = [...EUROPE_COMPETITIONS, { name: 'NBA', kind: 'domestic', tier: 1 }];
  const fixed = new Map(Object.entries(EUROPE_LEVELS).map(([name, level]) => [name, { ...level, measured: true }]));
  const europe = europeRows.map(([apiId, , , season, competition, secondsPlayed, games, clubGames, twoMade, twoAtt, threeMade, threeAtt, freeMade, freeAtt, rebounds, assists]) => ({
    player_id: apiId, season_label: season, competition, kind: competition.startsWith('Euro') || competition.includes('Champions') ? 'european' : 'domestic', seconds_played: secondsPlayed, games_played: games, club_games: clubGames,
    two_made_valid: twoMade, two_attempted_valid: twoAtt, three_made_valid: threeMade, three_attempted_valid: threeAtt, free_made_checked: freeMade, free_attempted_checked: freeAtt, free_made: freeMade, free_attempted: freeAtt, rebounds, assists,
  }));
  const rows = [...data.totals, ...europe];
  const level = fitCompetitionLevel(rows, competitions, fixed, rules);
  const levels = new Map([...fixed, ['NBA', level]]);
  const trusted = trustedFreeThrowSeasons(rows);
  for (const key of trusted.keys()) if (!key.startsWith('NBA ')) trusted.set(key, { ...trusted.get(key), trusted: !EUROPE_UNTRUSTED_FREE_THROWS.includes(key) });
  const standard = data.players.filter(player => !player.twoWay);
  const rated = standard.filter(player => player.apiPlayerId);
  const provisional = player => player.position ?? withinGroup(player.group, null);
  const profiles = rated.map(player => ({ id: player.apiPlayerId, position: GROUP[provisional(player)], age_observed: player.birthDate ? ageOn(player.birthDate, data.observedOn) : null }));
  const ids = new Set(profiles.map(profile => profile.id));
  const ratings = computeRatings(rows.filter(row => ids.has(row.player_id)), profiles, levels, trusted, { competitions, scale: EUROPE_SCALE, unclamped: true });
  const byId = new Map(ratings.map(rating => [rating.player_id, rating]));
  // Players without statistics start from the NBA's average profile of their position (the game lifts them to their club's level).
  const averages = {};
  for (const position of ['PG', 'SG', 'SF', 'PF', 'C']) {
    const pool = standard.filter(player => provisional(player) === position && byId.get(player.apiPlayerId)?.method.weightedMinutes >= RATING_RULES.scaleMinutes).map(player => byId.get(player.apiPlayerId));
    averages[position] = Object.fromEntries(Object.entries(GAME_KEYS).map(([key, game]) => [game, Math.max(1, Math.min(20, Math.round(pool.reduce((sum, rating) => sum + rating[key], 0) / Math.max(1, pool.length))))]));
  }
  const players = standard.map(player => {
    const rating = player.apiPlayerId ? byId.get(player.apiPlayerId) : null;
    const position = player.position ?? withinGroup(player.group, rating?.method);
    const estimated = rating ? rating.estimated.filter(field => !['game_position', 'height_cm', 'weight_kg', 'age'].includes(field)) : ['all-abilities'];
    if (!player.position) estimated.push('game_position');
    if (!player.heightCm) estimated.push('height_cm');
    if (!player.weightKg) estimated.push('weight_kg');
    const attributes = rating ? Object.fromEntries(Object.entries(GAME_KEYS).map(([key, game]) => [game, rating[key]])) : { ...averages[position] };
    return {
      ...player, position, positionSource: player.position ? 'provider' : 'estimated', attributes, ...(rating ? { unclamped: rating.unclamped, ratingMinutes: Math.round(rating.method.weightedMinutes), ratingGames: Math.round(rating.method.weightedGames * 10) / 10, method: rating.method } : {}),
      age: player.birthDate ? ageOn(player.birthDate) : null, estimated: [...new Set(estimated)].sort(), overall: overallRating(attributes, position),
    };
  });
  return { rules: NBA_LEVEL_RULES.id, level: { volume: level.volume, shooting: level.shooting, players: level.players, linkMinutes: level.linkMinutes, links: level.links, linkList: level.linkList }, note: describeLevels(new Map([['NBA', level]])), players };
}

async function main() {
  const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const data = JSON.parse(readFileSync(option('--data'), 'utf8')), europe = JSON.parse(readFileSync(option('--europe'), 'utf8')).rows;
  // --rules '{"priorMinutes": ...}' tries other settings for a check; the published ratings use NBA_LEVEL_RULES.
  const result = rateNba(data, europe, option('--rules') ? { ...NBA_LEVEL_RULES, ...JSON.parse(option('--rules')) } : NBA_LEVEL_RULES);
  writeFileSync(option('--out'), `${JSON.stringify(result, null, 1)}\n`);
  console.log(result.note);
  console.log(`links: ${result.level.players} players, ${result.level.linkMinutes} weighted minutes: ${result.level.links.map(link => `${link.other} ${link.players}`).join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });

import type { ArchivedFixture, FixtureResult, SeasonFixture, SeasonInjury, SeasonState } from '../domain/season';
import type { PlayerStats, Side, Team } from '../domain/types';
import { DEVELOPMENT_CLUBS, DEVELOPMENT_DATA_PACK_ID } from '../data/development-league';
import { MAX_MATCH_PERIODS } from '../engine/match';
import { createSchedule, DAILY_RECOVERY, fixtureSeed, MAX_SEASON_NUMBER, ROUND_INTERVAL_DAYS } from '../world/season';
import { createSeasonInjury, isRecovering } from '../world/health';
import { readLocalSeason, writeLocalSeason } from './season-indexed-db';
import { validateMatchState } from './validate-match';

export const MAX_SEASON_SAVE_BYTES = 8 * 1024 * 1024;
const FORMAT = 'basketball-manager-season';
const SIDES = ['home', 'away'] as const;
const STAT_KEYS: readonly (keyof PlayerStats)[] = [
  'secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade',
  'threePointersAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'rebounds', 'assists',
  'steals', 'blocks', 'turnovers', 'fouls', 'condition',
];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !keys.includes(key))) fail(path, 'has missing or unsupported fields');
  return fields;
}
function number(value: unknown, path: string, min: number, max: number, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) fail(path, `must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  return value;
}
function array(value: unknown, path: string, length: number): unknown[] {
  if (!Array.isArray(value) || value.length !== length) fail(path, `must contain exactly ${length} entries`);
  return value;
}
function sameData(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && sameData((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
function score(value: unknown, path: string): Record<Side, number> {
  const fields = record(value, path, SIDES);
  return { home: number(fields.home, `${path}.home`, 0, 1_000_000), away: number(fields.away, `${path}.away`, 0, 1_000_000) };
}
function checkSize(text: string): void {
  if (text.length > MAX_SEASON_SAVE_BYTES || new TextEncoder().encode(text).byteLength > MAX_SEASON_SAVE_BYTES) throw new Error('The season file is too large. The season save limit is 8 MB.');
}
function checkJsonTree(root: unknown): void {
  const pending: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++count > 800_000 || depth > 40) throw new Error('The season file has too many values or nested objects.');
    if (value === null || typeof value !== 'object') continue;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('The season must contain plain save data.');
    const entries = Object.entries(value);
    if (entries.length > 20_000) throw new Error('The season file contains an oversized collection.');
    for (const [key, child] of entries) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error('The season file contains an unsafe property.');
      pending.push({ value: child, depth: depth + 1 });
    }
  }
}

/** Both full current results and compact career archives retain official result rules. */
function validateResultSummary(fields: Record<string, unknown>, path: string, home: Team, away: Team) {
  if (fields.kind !== 'normal' && fields.kind !== 'default') fail(`${path}.kind`, 'is unsupported');
  const periods = number(fields.periods, `${path}.periods`, fields.kind === 'normal' ? 4 : 1, MAX_MATCH_PERIODS);
  const earned = score(fields.score, `${path}.score`), official = score(fields.officialScore, `${path}.officialScore`);
  if (fields.winnerClubId !== home.id && fields.winnerClubId !== away.id) fail(`${path}.winnerClubId`, 'must identify a participating club');
  const winner: Side = fields.winnerClubId === home.id ? 'home' : 'away', loser: Side = winner === 'home' ? 'away' : 'home';
  if (official[winner] <= official[loser]) fail(`${path}.officialScore`, 'does not identify the declared winner');
  if (fields.kind === 'normal' && !sameData(earned, official)) fail(`${path}.officialScore`, 'must equal earned points for a normal result');
  if (fields.kind === 'default') {
    const expected = earned[winner] > earned[loser] ? earned : { [winner]: 2, [loser]: 0 };
    if (!sameData(expected, official)) fail(`${path}.officialScore`, 'does not match the default award rule');
  }
  return { periods, earned, loser };
}

/** Completed matches retain accounting, not a second copy of their event history. */
function validateResult(value: unknown, path: string, home: Team, away: Team, legacy: boolean): FixtureResult {
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'stats', ...(legacy ? [] : ['injuries'])]);
  const injuries = legacy ? {} : validateInjuryMap(fields.injuries, `${path}.injuries`, [...home.players, ...away.players].map(player => player.id));
  const { periods, earned, loser } = validateResultSummary(fields, path, home, away);
  const elapsedLimit = periods <= 4 ? periods * 600 : 2400 + (periods - 4) * 300;
  const players = [...home.players, ...away.players];
  const stats = record(fields.stats, `${path}.stats`, players.map(player => player.id));
  const totals = { home: { points: 0, seconds: 0, eligible: 0, made: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, misses: 0 }, away: { points: 0, seconds: 0, eligible: 0, made: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, misses: 0 } };
  for (const side of SIDES) {
    const team = side === 'home' ? home : away;
    for (const player of team.players) {
      const location = `${path}.stats.${player.id}`;
      const entry = record(stats[player.id], location, STAT_KEYS);
      for (const key of STAT_KEYS) number(entry[key], `${location}.${key}`, key === 'condition' ? 35 : 0, key === 'secondsPlayed' ? elapsedLimit : key === 'fouls' ? 5 : key === 'condition' ? 100 : 1_000_000, key !== 'condition');
      const stat = entry as unknown as PlayerStats;
      if (stat.fieldGoalsMade > stat.fieldGoalsAttempted || stat.threePointersMade > stat.threePointersAttempted || stat.freeThrowsMade > stat.freeThrowsAttempted) fail(location, 'has more makes than attempts');
      if (stat.threePointersMade > stat.fieldGoalsMade || stat.threePointersAttempted > stat.fieldGoalsAttempted || stat.fieldGoalsMade - stat.threePointersMade > stat.fieldGoalsAttempted - stat.threePointersAttempted) fail(location, 'has inconsistent two-point and three-point totals');
      if (stat.points !== 2 * stat.fieldGoalsMade + stat.threePointersMade + stat.freeThrowsMade) fail(location, 'has points inconsistent with shooting');
      const total = totals[side];
      total.points += stat.points; total.seconds += stat.secondsPlayed; total.eligible += stat.fouls < 5 && !Object.hasOwn(injuries, player.id) ? 1 : 0;
      total.made += stat.fieldGoalsMade; total.assists += stat.assists; total.steals += stat.steals;
      total.blocks += stat.blocks; total.turnovers += stat.turnovers; total.misses += stat.fieldGoalsAttempted - stat.fieldGoalsMade;
    }
    const total = totals[side];
    if (total.points !== earned[side]) fail(`${path}.score.${side}`, 'does not equal player points');
    if (total.seconds > elapsedLimit * 5) fail(`${path}.stats`, 'contains excessive court time');
    if (fields.kind === 'normal' && (total.seconds < elapsedLimit * 2 || total.eligible >= 5 && total.seconds !== elapsedLimit * 5)) fail(`${path}.stats`, 'does not reconcile with elapsed game time');
    if (total.assists > total.made) fail(`${path}.stats`, 'has more assists than made baskets');
  }
  for (const side of SIDES) {
    const other = side === 'home' ? 'away' : 'home';
    if (totals[side].steals > totals[other].turnovers || totals[side].blocks > totals[other].misses) fail(`${path}.stats`, 'has inconsistent steals or blocks');
  }
  if (fields.kind === 'default' && totals[loser].eligible >= 2) fail(path, 'cannot declare default while two eligible players remain');
  return fields as unknown as FixtureResult;
}

/** Old seasons deliberately omit player box scores; current fixtures still validate them. */
function validateArchivedResult(value: unknown, path: string, home: Team, away: Team): ArchivedFixture['result'] {
  const fields = record(value, path, ['score', 'officialScore', 'winnerClubId', 'kind', 'periods', 'injuries']);
  validateResultSummary(fields, path, home, away);
  validateInjuryMap(fields.injuries, `${path}.injuries`, [...home.players, ...away.players].map(player => player.id));
  return fields as unknown as ArchivedFixture['result'];
}

/** Compact result diagnoses identify both new injuries and players already unavailable. */
function validateInjuryMap(value: unknown, path: string, playerIds: readonly string[]): Record<string, SeasonInjury['kind']> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  for (const [id, kind] of Object.entries(fields)) {
    if (!playerIds.includes(id)) fail(`${path}.${id}`, 'must identify a participating player');
    if (kind !== 'ankle' && kind !== 'muscle') fail(`${path}.${id}`, 'must identify a supported injury');
  }
  return fields as Record<string, SeasonInjury['kind']>;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort(), b = [...right].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function requireNoPlay(stats: PlayerStats, path: string): void {
  if (STAT_KEYS.some(key => key !== 'condition' && stats[key] !== 0)) fail(path, 'must have zero personal statistics while recovering from an earlier injury');
}

/** Older schemas keep their original constraints before migration adds career fields. */
function validateState(value: unknown, version: 1 | 2 | 3): void {
  const legacy = version === 1, career = version === 3;
  checkJsonTree(value);
  const state = record(value, 'state', ['schemaVersion', 'engineVersion', 'dataPackId', 'seed', 'managedClubId', 'date', 'status', 'round', 'clubs', 'plans', 'conditions', 'fixtures', 'activeFixtureId', 'activeMatch', ...(legacy ? [] : ['injuryMode', 'injuries']), ...(career ? ['seasonNumber', 'history'] : [])]);
  if (state.schemaVersion !== version || state.engineVersion !== 'possession-3' || state.dataPackId !== DEVELOPMENT_DATA_PACK_ID) fail('state', 'uses an unsupported schema, engine or data pack');
  const seed = number(state.seed, 'seed', 0, 0xffff_ffff), round = number(state.round, 'round', 1, 10);
  const seasonNumber = career ? number(state.seasonNumber, 'seasonNumber', 1, MAX_SEASON_NUMBER) : 1;
  const injuryMode = legacy ? 'off' : state.injuryMode;
  if (!['standard', 'reduced', 'off'].includes(injuryMode as string)) fail('injuryMode', 'must be standard, reduced or off');
  if (!legacy && (!Array.isArray(state.injuries) || state.injuries.length > 600 * seasonNumber)) fail('injuries', 'must be a bounded injury history');
  if (state.status !== 'active' && state.status !== 'complete') fail('status', 'must be active or complete');
  if (state.status === 'complete' && round !== 10) fail('round', 'must reach the final matchday before completion');
  if (!sameData(state.clubs, DEVELOPMENT_CLUBS)) fail('clubs', 'must match the versioned development data pack');
  const clubs = state.clubs as readonly Team[], clubIds = clubs.map(club => club.id);
  if (typeof state.managedClubId !== 'string' || !clubIds.includes(state.managedClubId)) fail('managedClubId', 'must identify a club in this league');
  const plans = record(state.plans, 'plans', clubIds);
  const playerIds = clubs.flatMap(club => club.players.map(player => player.id));
  const conditions = record(state.conditions, 'conditions', playerIds);
  for (const club of clubs) {
    const plan = record(plans[club.id], `plans.${club.id}`, ['tactics', 'lineup', 'autoSubstitutions']);
    const tactics = record(plan.tactics, `plans.${club.id}.tactics`, ['tempo', 'outsideShare', 'pressure']);
    for (const key of ['tempo', 'outsideShare', 'pressure']) number(tactics[key], `plans.${club.id}.tactics.${key}`, 0, 1, false);
    const lineup = array(plan.lineup, `plans.${club.id}.lineup`, 5);
    if (new Set(lineup).size !== 5 || lineup.some(id => !club.players.some(player => player.id === id))) fail(`plans.${club.id}.lineup`, 'must select five distinct players from its club');
    if (typeof plan.autoSubstitutions !== 'boolean' || club.id !== state.managedClubId && !plan.autoSubstitutions) fail(`plans.${club.id}.autoSubstitutions`, 'must be boolean and enabled for opponent clubs');
    for (const player of club.players) number(conditions[player.id], `conditions.${player.id}`, 0, 100, false);
  }
  const history: SeasonInjury[] = [];
  const latestInjuries = new Map<string, SeasonInjury>();
  function recordFixtureInjuries(result: ArchivedFixture['result'], expected: SeasonFixture, home: Team, away: Team, path: string, stats?: FixtureResult['stats']): void {
    const carried = [...latestInjuries.values()].filter(injury => [home.id, away.id].includes(injury.clubId) && isRecovering(injury, expected.date));
    for (const injury of carried) {
      if (result.injuries[injury.playerId] !== injury.kind) fail(`${path}.result.injuries`, 'must retain every player still recovering at this fixture');
      if (stats) requireNoPlay(stats[injury.playerId]!, `${path}.result.stats.${injury.playerId}`);
    }
    for (const [id, kind] of Object.entries(result.injuries)) {
      if (carried.some(injury => injury.playerId === id)) continue;
      if (injuryMode === 'off') fail(`${path}.result.injuries`, 'cannot record a new injury while injuries are off');
      if (stats && stats[id]!.secondsPlayed === 0) fail(`${path}.result.injuries.${id}`, 'requires exposure in its originating fixture');
      const club = home.players.some(player => player.id === id) ? home : away;
      const injury = createSeasonInjury(seed, expected, club.id, id, kind);
      history.push(injury);
      latestInjuries.set(id, injury);
    }
  }
  if (career) {
    const archives = array(state.history, 'history', seasonNumber - 1);
    for (const [archiveIndex, value] of archives.entries()) {
      const path = `history[${archiveIndex}]`, archive = record(value, path, ['seasonNumber', 'fixtures']);
      if (archive.seasonNumber !== archiveIndex + 1) fail(`${path}.seasonNumber`, 'must preserve every previous season in order');
      const schedule = createSchedule(clubs, archiveIndex + 1);
      const fixtures = array(archive.fixtures, `${path}.fixtures`, schedule.length);
      for (const [index, value] of fixtures.entries()) {
        const location = `${path}.fixtures[${index}]`, expected = schedule[index]!;
        const fixture = record(value, location, ['id', 'round', 'date', 'homeClubId', 'awayClubId', 'result']);
        for (const key of ['id', 'round', 'date', 'homeClubId', 'awayClubId'] as const) if (fixture[key] !== expected[key]) fail(location, 'does not match the versioned schedule');
        const home = clubs.find(club => club.id === expected.homeClubId)!, away = clubs.find(club => club.id === expected.awayClubId)!;
        const result = validateArchivedResult(fixture.result, `${location}.result`, home, away);
        recordFixtureInjuries(result, expected, home, away, location);
      }
    }
  }
  const schedule = createSchedule(clubs, seasonNumber), fixtures = array(state.fixtures, 'fixtures', schedule.length);
  const committedRound = state.status === 'complete' ? round : round - 1;
  for (const [index, value] of fixtures.entries()) {
    const path = `fixtures[${index}]`, expected = schedule[index]!;
    const fixture = record(value, path, ['id', 'round', 'date', 'homeClubId', 'awayClubId', 'result']);
    for (const key of ['id', 'round', 'date', 'homeClubId', 'awayClubId'] as const) if (fixture[key] !== expected[key]) fail(path, 'does not match the versioned schedule');
    if (expected.round <= committedRound) {
      if (fixture.result === null) fail(`${path}.result`, 'is missing from a completed matchday');
      const home = clubs.find(club => club.id === expected.homeClubId)!, away = clubs.find(club => club.id === expected.awayClubId)!;
      const result = validateResult(fixture.result, `${path}.result`, home, away, legacy);
      if (!legacy) recordFixtureInjuries(result, expected, home, away, path, result.stats);
    } else if (fixture.result !== null) fail(`${path}.result`, 'cannot be committed before its matchday');
  }
  if (!legacy) {
    const injuries = state.injuries as unknown[];
    for (const [index, injury] of injuries.entries()) record(injury, `injuries[${index}]`, ['id', 'playerId', 'clubId', 'kind', 'fixtureId', 'occurredOn', 'returnOn']);
    const ids = injuries.map(injury => (injury as SeasonInjury).id);
    if (new Set(ids).size !== ids.length || !sameIds(ids, history.map(injury => injury.id))) fail('injuries', 'must match the committed fixture injury history exactly');
    const byId = new Map(injuries.map(entry => [(entry as SeasonInjury).id, entry]));
    for (const injury of history) if (!sameData(byId.get(injury.id), injury)) fail(`injuries.${injury.id}`, 'has inconsistent identity, diagnosis, origin or recovery dates');
  }
  const active = (fixtures as SeasonFixture[]).find(fixture => fixture.round === round && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId as string))!;
  if (state.activeFixtureId !== active.id || state.date !== active.date) fail('activeFixtureId/date', 'must identify the managed club fixture on the current matchday');
  validateMatchState(state.activeMatch);
  const match = state.activeMatch;
  if (match.engineVersion !== 'possession-3' || match.seed !== fixtureSeed(seed, active.id)) fail('activeMatch', 'has the wrong engine or fixture seed');
  const home = clubs.find(club => club.id === active.homeClubId)!, away = clubs.find(club => club.id === active.awayClubId)!;
  if (!sameData(match.home, home) || !sameData(match.away, away)) fail('activeMatch', 'must use the fixture home and away squads');
  const opposition: Side = active.homeClubId === state.managedClubId ? 'away' : 'home';
  if (!match.autoSubstitutions[opposition]) fail('activeMatch.autoSubstitutions', 'must enable opponent substitutions');
  if (match.injuryMode !== injuryMode) fail('activeMatch.injuryMode', 'must match the season-wide injury setting');
  if (legacy) {
    if (Object.keys(match.injuries).length !== 0 || Object.hasOwn(match, 'preExistingInjuries')) fail('activeMatch', 'must use the legacy season-wide injury-off setting');
  } else {
    // The final fixture may already be in history, but its new injuries are not inherited.
    const carried = history.filter(injury => injury.fixtureId !== active.id && [home.id, away.id].includes(injury.clubId) && isRecovering(injury, active.date));
    if (!sameIds(match.preExistingInjuries ?? [], carried.map(injury => injury.playerId))) fail('activeMatch.preExistingInjuries', 'must match the players still recovering at kickoff');
    for (const injury of carried) {
      if (match.injuries[injury.playerId]?.kind !== injury.kind) fail('activeMatch.injuries', 'must retain the carried diagnosis');
      requireNoPlay(match.stats[injury.playerId]!, `activeMatch.stats.${injury.playerId}`);
    }
    if (injuryMode === 'off' && Object.keys(match.injuries).length) fail('activeMatch.injuries', 'cannot record injuries in an injury-free season');
  }
  if (state.status === 'complete') {
    if (match.status !== 'finished' || !match.result) fail('activeMatch', 'must be finished when the season is complete');
    const result = { score: match.score, officialScore: match.result.officialScore, winnerClubId: match[match.result.winner].id, kind: match.result.kind, periods: match.period, stats: match.stats, ...(legacy ? {} : { injuries: Object.fromEntries(Object.entries(match.injuries).map(([id, injury]) => [id, injury.kind])) }) };
    if (!sameData(active.result, result)) fail('activeMatch', 'does not match its committed final result');
  }
  // Recovery belongs to a completed matchday, so imports cannot run it twice.
  for (const club of clubs) {
    const latest = (fixtures as SeasonFixture[]).find(fixture => fixture.round === committedRound && [fixture.homeClubId, fixture.awayClubId].includes(club.id));
    for (const player of club.players) {
      const previous = latest?.result?.stats[player.id].condition ?? 100;
      const expected = state.status === 'complete' ? previous : Math.min(100, Math.round((previous + DAILY_RECOVERY * ROUND_INTERVAL_DAYS) * 1000) / 1000);
      if (conditions[player.id] !== expected) fail(`conditions.${player.id}`, 'does not match the last committed recovery boundary');
      if (match.status === 'ready' && (club.id === home.id || club.id === away.id) && match.stats[player.id]!.condition !== conditions[player.id]) fail(`activeMatch.stats.${player.id}.condition`, 'must match current season condition before tipoff');
    }
  }
}

/** Validate every reference and committed round before replacing any live season. */
export function validateSeasonState(value: unknown): asserts value is SeasonState { validateState(value, 3); }

export function serializeSeason(state: SeasonState): string {
  validateSeasonState(state);
  const text = JSON.stringify({ format: FORMAT, formatVersion: 3, engineVersion: 'possession-3', state });
  checkSize(text);
  return text;
}

export function parseSeason(text: string): SeasonState {
  checkSize(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This is not a valid JSON season file.'); }
  checkJsonTree(parsed);
  const envelope = record(parsed, 'envelope', ['format', 'formatVersion', 'engineVersion', 'state']);
  if (envelope.format !== FORMAT || ![1, 2, 3].includes(envelope.formatVersion as number) || envelope.engineVersion !== 'possession-3') throw new Error('This season file uses an unsupported save format or engine version.');
  if (envelope.formatVersion === 1) {
    validateState(envelope.state, 1);
    const legacy = envelope.state as Omit<SeasonState, 'schemaVersion' | 'injuryMode' | 'injuries' | 'seasonNumber' | 'history'>;
    const upgraded: SeasonState = { ...legacy, schemaVersion: 3, seasonNumber: 1, history: [], injuryMode: 'off', injuries: [], fixtures: legacy.fixtures.map(fixture => ({ ...fixture, result: fixture.result ? { ...fixture.result, injuries: {} } : null })) };
    validateSeasonState(upgraded);
    return upgraded;
  }
  if (envelope.formatVersion === 2) {
    validateState(envelope.state, 2);
    const previous = envelope.state as Omit<SeasonState, 'schemaVersion' | 'seasonNumber' | 'history'>;
    const upgraded: SeasonState = { ...previous, schemaVersion: 3, seasonNumber: 1, history: [] };
    validateSeasonState(upgraded);
    return upgraded;
  }
  validateSeasonState(envelope.state);
  return envelope.state;
}

export async function saveLocalSeason(state: SeasonState): Promise<void> { await writeLocalSeason(serializeSeason(state)); }
export async function loadLocalSeason(): Promise<SeasonState | null> { const text = await readLocalSeason(); return text === null ? null : parseSeason(text); }

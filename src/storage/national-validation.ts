import type { NationalCompetition, NationalFixture, SeasonNational } from '../domain/national';
import type { SeasonState } from '../domain/season';
import { NATIONAL_TEAMS } from '../data/national-teams';
import { worldOf } from '../world/career-world';
import { addCalendarDays } from '../world/competition-calendar';
import { NATIONAL_MODEL, qualifierCompetition, usesNationalTeams } from '../world/national';
import { NATIONAL_RULES, nationalTournamentDays } from '../world/national-calendar';
import { validateMatchState } from './validate-match';
import { isMatchInjuryKind } from '../domain/injuries';

/**
 * Format 80 save checks for national teams (development mode: shape and key totals). Exact: the teams, each season's
 * qualifier schedule, one coach per team, the manager's job matching his coach entry and an open game matching an
 * unplayed fixture of his team. Plausible: results (scores, squads of up to twelve, minutes and points) and the
 * summer tournament's games. The weekly training check replays national duty from the stored squads and minutes.
 */
function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function record(value: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isObject(value)) fail(path, 'must be an object');
  if (keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))) fail(path, 'has missing or unsupported fields');
  return value;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(path, `must be an integer between ${min} and ${max}`);
  return value;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
function date(value: unknown, path: string): string {
  if (typeof value !== 'string' || !DATE.test(value)) fail(path, 'must be a calendar date');
  return value;
}
function text(value: unknown, path: string, max = 120): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) fail(path, 'must be a short text');
  return value;
}
function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!isObject(left) && !Array.isArray(left) || !isObject(right) && !Array.isArray(right) || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left as object), b = Object.keys(right as object);
  return a.length === b.length && a.every(key => Object.hasOwn(right as object, key) && same((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function validateResult(value: unknown, path: string): void {
  const result = record(value, path, ['home', 'away', 'squads', 'minutes', 'points', 'strength', 'injuries']);
  const home = integer(result.home, `${path}.home`, 0, 250), away = integer(result.away, `${path}.away`, 0, 250);
  if (home === away) fail(path, 'must have a winner');
  const squads = record(result.squads, `${path}.squads`, ['home', 'away']), ids = new Set<string>();
  for (const side of ['home', 'away'] as const) {
    const squad = squads[side];
    if (!Array.isArray(squad) || squad.length < 5 || squad.length > NATIONAL_RULES.squadSize) fail(`${path}.squads.${side}`, `must list five to ${NATIONAL_RULES.squadSize} players`);
    for (const id of squad) { if (typeof id !== 'string' || ids.has(id)) fail(`${path}.squads.${side}`, 'must list distinct players'); ids.add(id); }
  }
  for (const key of ['minutes', 'points'] as const) {
    const entries = record(result[key], `${path}.${key}`, Object.keys(result[key] as object));
    for (const [id, amount] of Object.entries(entries)) { if (!ids.has(id)) fail(`${path}.${key}`, 'must name players of the squads'); integer(amount, `${path}.${key}.${id}`, 0, key === 'minutes' ? 60 : 120); }
  }
  const totals = (side: 'home' | 'away') => (squads[side] as string[]).reduce((sum, id) => sum + ((result.points as Record<string, number>)[id] ?? 0), 0);
  // A game awarded by default keeps its official 20-0 score; every other score is the players' points.
  const awarded = home + away === 20 && (home === 0 || away === 0);
  if (!awarded && (totals('home') !== home || totals('away') !== away)) fail(`${path}.points`, 'must add up to the score');
  const strength = record(result.strength, `${path}.strength`, ['home', 'away']);
  integer(strength.home, `${path}.strength.home`, 1, 99); integer(strength.away, `${path}.strength.away`, 1, 99);
  // Injured players played in the game (the club's injury record is checked with the career's injuries).
  const injuries = record(result.injuries, `${path}.injuries`, Object.keys(result.injuries as object));
  for (const [id, kind] of Object.entries(injuries)) if (!Object.hasOwn(result.minutes as object, id) || !isMatchInjuryKind(kind)) fail(`${path}.injuries.${id}`, 'must be a match injury of a player who played');
}

function validateFixture(value: unknown, path: string, competition: Record<string, unknown>, teamIds: ReadonlySet<string>, latest: string): NationalFixture {
  const fixture = record(value, path, ['id', 'competitionId', 'window', 'stage', 'groupId', 'date', 'homeTeamId', 'awayTeamId', 'result']);
  text(fixture.id, `${path}.id`); date(fixture.date, `${path}.date`);
  if (fixture.competitionId !== competition.id) fail(`${path}.competitionId`, 'must name its competition');
  if (![1, 2, 3].includes(fixture.window as number) || !['group', 'semi', 'third', 'final'].includes(fixture.stage as string)) fail(path, 'has an unsupported window or stage');
  if (!teamIds.has(fixture.homeTeamId as string) || !teamIds.has(fixture.awayTeamId as string) || fixture.homeTeamId === fixture.awayTeamId) fail(path, 'must name two national teams');
  if (fixture.result !== null) {
    if ((fixture.date as string) > latest) fail(`${path}.result`, 'cannot be recorded before the game');
    validateResult(fixture.result, `${path}.result`);
  }
  return fixture as unknown as NationalFixture;
}

export function validateNationalShape(value: unknown, state: SeasonState, version: number): asserts value is SeasonNational {
  if (version < 80) fail('national', 'requires format 80 or later');
  if (!state.world || !usesNationalTeams(worldOf(state))) fail('national', 'requires a real-club world with a national team\'s country');
  const national = record(value, 'national', ['model', 'teams', 'coaches', 'coachCount', 'competitions', 'job', 'offers', 'verdicts', 'events', 'activeFixtureId', 'activeMatch']);
  if (national.model !== NATIONAL_MODEL) fail('national.model', 'is unsupported');
  if (!same(national.teams, NATIONAL_TEAMS)) fail('national.teams', 'must be the game\'s national teams');
  const teamIds = new Set(NATIONAL_TEAMS.map(team => team.id)), seasonNumber = state.seasonNumber;
  const coachCount = integer(national.coachCount, 'national.coachCount', NATIONAL_TEAMS.length, 100_000);
  if (!Array.isArray(national.coaches) || national.coaches.length !== NATIONAL_TEAMS.length) fail('national.coaches', 'must give every team one coach');
  const managerTeams: string[] = [];
  national.coaches.forEach((value, index) => {
    const path = `national.coaches.${index}`, coach = record(value, path, ['teamId', 'name', 'since', 'confidence'], ['manager']);
    if (coach.teamId !== NATIONAL_TEAMS[index]!.id) fail(`${path}.teamId`, 'must follow the teams\' order');
    text(coach.name, `${path}.name`, 80); integer(coach.confidence, `${path}.confidence`, 0, 100);
    const since = record(coach.since, `${path}.since`, ['seasonNumber', 'date']);
    integer(since.seasonNumber, `${path}.since.seasonNumber`, 1, seasonNumber + 1); date(since.date, `${path}.since.date`);
    if (Object.hasOwn(coach, 'manager')) { if (coach.manager !== true) fail(`${path}.manager`, 'must be true when recorded'); managerTeams.push(coach.teamId as string); }
  });
  void coachCount;
  // Results can be recorded up to the end of the week being played (the manager's games come before its training).
  const latest = addCalendarDays(state.date, 7);
  if (!Array.isArray(national.competitions) || national.competitions.length < 1 || national.competitions.length > 8) fail('national.competitions', 'must hold this season\'s and recent competitions');
  const ids = new Set<string>(), fixtureIds = new Set<string>();
  for (const [index, value] of national.competitions.entries()) {
    const path = `national.competitions.${index}`, competition = record(value, path, ['id', 'seasonNumber', 'kind', 'name', 'groups', 'fixtures']);
    const year = integer(competition.seasonNumber, `${path}.seasonNumber`, Math.max(1, seasonNumber - 2), seasonNumber + 1);
    if (typeof competition.id !== 'string' || ids.has(competition.id)) fail(`${path}.id`, 'must be distinct'); ids.add(competition.id);
    if (!['qualifiers', 'tournament'].includes(competition.kind as string)) fail(`${path}.kind`, 'is unsupported');
    text(competition.name, `${path}.name`);
    if (!Array.isArray(competition.groups) || !Array.isArray(competition.fixtures)) fail(path, 'must list groups and games');
    const members = new Set<string>();
    for (const [groupIndex, group] of competition.groups.entries()) {
      const fields = record(group, `${path}.groups.${groupIndex}`, ['id', 'name', 'teamIds']);
      text(fields.id, `${path}.groups.${groupIndex}.id`, 4); text(fields.name, `${path}.groups.${groupIndex}.name`, 40);
      if (!Array.isArray(fields.teamIds) || fields.teamIds.some(id => !teamIds.has(id as string) || members.has(id as string))) fail(`${path}.groups.${groupIndex}.teamIds`, 'must list distinct national teams');
      for (const id of fields.teamIds as string[]) members.add(id);
    }
    // A summer tournament is played at the rollover, so its last games can come after the new season's first day.
    const fixtures = competition.fixtures.map((fixture, fixtureIndex) => validateFixture(fixture, `${path}.fixtures.${fixtureIndex}`, competition, teamIds, competition.kind === 'tournament' ? '9999-12-31' : latest));
    for (const fixture of fixtures) { if (fixtureIds.has(fixture.id)) fail(`${path}.fixtures`, 'must have distinct ids'); fixtureIds.add(fixture.id); }
    if (competition.kind === 'qualifiers') {
      // The qualifier schedule follows from the groups exactly.
      const expected = qualifierCompetition(year, competition.groups as NationalCompetition['groups']);
      if (competition.id !== expected.id || competition.name !== expected.name || competition.groups.length !== 4 || members.size !== NATIONAL_TEAMS.length || !same(fixtures.map(fixture => ({ ...fixture, result: null })), expected.fixtures)) fail(path, 'must follow the qualifier schedule of its groups');
    } else {
      const days = nationalTournamentDays(year);
      if (competition.id !== `nt-s${year}` || members.size !== 12 || fixtures.length > 16 || fixtures.some(fixture => fixture.window !== 3 || !days.includes(fixture.date) || !fixture.result)) fail(path, 'must be a played summer tournament of twelve teams');
    }
  }
  const job = national.job;
  if (job === null) { if (managerTeams.length) fail('national.coaches', 'can name the manager only while he has a national job'); }
  else {
    const fields = record(job, 'national.job', ['teamId', 'since', 'untilSeason', 'salary', 'selection']);
    if (!teamIds.has(fields.teamId as string) || managerTeams.length !== 1 || managerTeams[0] !== fields.teamId) fail('national.job', 'must match the manager\'s coach entry');
    const since = record(fields.since, 'national.job.since', ['seasonNumber', 'date']);
    integer(since.seasonNumber, 'national.job.since.seasonNumber', 1, seasonNumber); date(since.date, 'national.job.since.date');
    integer(fields.untilSeason, 'national.job.untilSeason', seasonNumber, seasonNumber + NATIONAL_RULES.contractSeasons);
    if (!Object.values(NATIONAL_RULES.salary).includes(fields.salary as number)) fail('national.job.salary', 'must be a national salary');
    if (!Array.isArray(fields.selection) || fields.selection.length > NATIONAL_RULES.squadSize || fields.selection.some(id => typeof id !== 'string') || new Set(fields.selection).size !== fields.selection.length) fail('national.job.selection', `must list up to ${NATIONAL_RULES.squadSize} distinct players`);
  }
  for (const [key, keys] of [['offers', ['id', 'teamId', 'date', 'expiresOn', 'status']], ['verdicts', ['id', 'teamId', 'date', 'confidence', 'change', 'outcome']], ['events', ['id', 'teamId', 'date', 'kind']]] as const) {
    const list = national[key];
    if (!Array.isArray(list) || list.length > 400) fail(`national.${key}`, 'must be a bounded list');
    list.forEach((value, index) => {
      const item = record(value, `national.${key}.${index}`, keys);
      text(item.id, `national.${key}.${index}.id`); date(item.date, `national.${key}.${index}.date`);
      if (!teamIds.has(item.teamId as string)) fail(`national.${key}.${index}.teamId`, 'must name a national team');
    });
  }
  if ((national.offers as Record<string, unknown>[]).filter(offer => offer.status === 'open').length > 1) fail('national.offers', 'can hold one open offer at a time');
  if ((national.offers as Record<string, unknown>[]).some(offer => !['open', 'accepted', 'declined', 'expired'].includes(offer.status as string))) fail('national.offers', 'has an unsupported status');
  if (national.activeMatch === null || national.activeFixtureId === null) {
    if (national.activeMatch !== null || national.activeFixtureId !== null) fail('national.activeMatch', 'must come with its fixture');
  } else {
    const fixture = (national.competitions as NationalCompetition[]).flatMap(competition => competition.fixtures).find(item => item.id === national.activeFixtureId);
    const teamId = (job as { teamId?: string } | null)?.teamId;
    if (!fixture || fixture.result || !teamId || fixture.homeTeamId !== teamId && fixture.awayTeamId !== teamId) fail('national.activeFixtureId', 'must be an unplayed game of the manager\'s national team');
    validateMatchState(national.activeMatch);
    if (national.activeMatch.home.id !== fixture.homeTeamId || national.activeMatch.away.id !== fixture.awayTeamId) fail('national.activeMatch', 'must be its fixture\'s game');
  }
}

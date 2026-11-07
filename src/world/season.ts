import type { ArchivedFixture, ClubPlan, FixtureResult, SeasonFixture, SeasonState, Standing } from '../domain/season';
import type { InjuryMode, MatchState, Side, Team } from '../domain/types';
import { DEVELOPMENT_CLUBS, DEVELOPMENT_DATA_PACK_ID, DEVELOPMENT_START_DATE } from '../data/development-league';
import { createFixtureMatch, simulateToEnd } from '../engine/match';
import { injuriesFromMatch, isRecovering } from './health';
import { createTraining, developClub, processTrainingWeek } from './training';
import { createCoaching, recruitAiCoaches, renewSeasonCoaching } from './coaching';
import { createFinance, enableFinance, prepareFinanceRound, processFinanceRound, startFinanceSeason } from './finance';

export const SEASON_ROUNDS = 10;
export const ROUND_INTERVAL_DAYS = 7;
export const DAILY_RECOVERY = 3;
/** The ISO calendar used by saves has four-digit years. */
export const MAX_SEASON_NUMBER = 7974;
const DAY_MS = 86_400_000;
const SIDES: readonly Side[] = ['home', 'away'];
const defaultPlan = (club: Team, automatic: boolean): ClubPlan => ({
  tactics: { tempo: .5, outsideShare: .45, pressure: .5 },
  lineup: club.players.slice(0, 5).map(player => player.id),
  autoSubstitutions: automatic,
});

function seasonYear(seasonNumber: number): number {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > MAX_SEASON_NUMBER) throw new Error('Choose a supported career season number.');
  return Number(DEVELOPMENT_START_DATE.slice(0, 4)) + seasonNumber - 1;
}

export function seasonLabel(seasonNumber = 1): string {
  const year = seasonYear(seasonNumber);
  return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

/** Development seasons begin on the first Saturday in September, in UTC. */
export function seasonStartDate(seasonNumber = 1): string {
  const september = new Date(Date.UTC(seasonYear(seasonNumber), 8, 1));
  september.setUTCDate(1 + (6 - september.getUTCDay() + 7) % 7);
  return september.toISOString().slice(0, 10);
}

/** Date arithmetic is UTC-only and does not depend on locale or the wall clock. */
export function dateForRound(round: number, seasonNumber = 1): string {
  if (!Number.isInteger(round) || round < 1 || round > SEASON_ROUNDS) throw new Error('Choose a round between one and ten.');
  const start = Date.parse(`${seasonStartDate(seasonNumber)}T00:00:00.000Z`);
  return new Date(start + (round - 1) * ROUND_INTERVAL_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/** Circle scheduling: each club plays once per round and visits every opponent. */
export function createSchedule(clubs: readonly Team[] = DEVELOPMENT_CLUBS, seasonNumber = 1): SeasonFixture[] {
  if (clubs.length !== 6 || new Set(clubs.map(club => club.id)).size !== 6) throw new Error('The development league requires six distinct clubs.');
  seasonYear(seasonNumber);
  const prefix = seasonNumber === 1 ? 'dev' : `dev-s${seasonNumber}`;
  let ring = clubs.map(club => club.id);
  const firstLeg: SeasonFixture[] = [];
  for (let round = 1; round <= 5; round += 1) {
    for (let game = 0; game < 3; game += 1) {
      const pair = [ring[game]!, ring[ring.length - 1 - game]!] as const;
      const reverse = (round + game) % 2 === 0;
      firstLeg.push({ id: `${prefix}-r${round}-g${game + 1}`, round, date: dateForRound(round, seasonNumber), homeClubId: pair[reverse ? 1 : 0], awayClubId: pair[reverse ? 0 : 1], result: null });
    }
    ring = [ring[0]!, ring.at(-1)!, ...ring.slice(1, -1)];
  }
  return [...firstLeg, ...firstLeg.map(fixture => ({
    ...fixture, id: fixture.id.replace(`r${fixture.round}-`, `r${fixture.round + 5}-`), round: fixture.round + 5,
    date: dateForRound(fixture.round + 5, seasonNumber), homeClubId: fixture.awayClubId, awayClubId: fixture.homeClubId,
  }))];
}

/** Independent fixture streams make results independent of UI and processing order. */
export function fixtureSeed(seed: number, fixtureId: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < fixtureId.length; index += 1) hash = Math.imul(hash ^ fixtureId.charCodeAt(index), 16777619) >>> 0;
  return hash;
}

export function getActiveFixture(season: SeasonState): SeasonFixture {
  const fixture = season.fixtures.find(fixture => fixture.id === season.activeFixtureId);
  if (!fixture) throw new Error('The active season fixture is missing.');
  return fixture;
}

export function managedSide(season: SeasonState): Side {
  const fixture = getActiveFixture(season);
  if (fixture.homeClubId === season.managedClubId) return 'home';
  if (fixture.awayClubId === season.managedClubId) return 'away';
  throw new Error('The active fixture must include the managed club.');
}

function prepareMatch(season: Pick<SeasonState, 'seed' | 'clubs' | 'plans' | 'conditions' | 'managedClubId' | 'injuryMode' | 'injuries' | 'training'>, fixture: SeasonFixture): MatchState {
  const home = season.clubs.find(club => club.id === fixture.homeClubId);
  const away = season.clubs.find(club => club.id === fixture.awayClubId);
  if (!home || !away) throw new Error('A fixture refers to a missing club.');
  const homePlan = season.plans[home.id]!, awayPlan = season.plans[away.id]!;
  return createFixtureMatch(fixtureSeed(season.seed, fixture.id), developClub(home, season.training), developClub(away, season.training), {
    lineups: { home: homePlan.lineup, away: awayPlan.lineup },
    tactics: { home: homePlan.tactics, away: awayPlan.tactics },
    autoSubstitutions: { home: home.id === season.managedClubId ? homePlan.autoSubstitutions : true, away: away.id === season.managedClubId ? awayPlan.autoSubstitutions : true },
    conditions: Object.fromEntries([...home.players, ...away.players].map(player => [player.id, season.conditions[player.id]!])),
    injuryMode: season.injuryMode,
    preExistingInjuries: Object.fromEntries(season.injuries.filter(injury => [home.id, away.id].includes(injury.clubId) && isRecovering(injury, fixture.date)).map(injury => [injury.playerId, injury.kind])),
  });
}

export function createSeason(seed = 42, managedClubId = DEVELOPMENT_CLUBS[0]!.id, injuryMode: InjuryMode = 'standard', trainingEnabled = true, coachingEnabled = true, financeEnabled = true): SeasonState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('Choose a whole-number season seed between zero and 4294967295.');
  if (!DEVELOPMENT_CLUBS.some(club => club.id === managedClubId)) throw new Error('Choose a club from the development league.');
  if (!['standard', 'reduced', 'off'].includes(injuryMode)) throw new Error('Choose a valid season injury setting.');
  if (typeof trainingEnabled !== 'boolean') throw new Error('Choose a valid training setting.');
  if (typeof coachingEnabled !== 'boolean') throw new Error('Choose a valid coaching setting.');
  if (typeof financeEnabled !== 'boolean') throw new Error('Choose a valid club finance setting.');
  const clubs = DEVELOPMENT_CLUBS;
  const fixtures = createSchedule(clubs);
  const first = fixtures.find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(managedClubId))!;
  const preparation = {
    seed, clubs, managedClubId, injuryMode, injuries: [], training: createTraining(clubs, trainingEnabled), coaching: createCoaching(clubs, 1, 1, coachingEnabled),
    plans: Object.fromEntries(clubs.map(club => [club.id, defaultPlan(club, club.id !== managedClubId)])),
    conditions: Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, 100]))),
  };
  const state: SeasonState = {
    schemaVersion: 6, engineVersion: 'possession-3', dataPackId: DEVELOPMENT_DATA_PACK_ID, seasonNumber: 1, history: [], finance: createFinance(clubs, managedClubId),
    ...preparation, date: first.date, status: 'active', round: 1, fixtures,
    activeFixtureId: first.id, activeMatch: prepareMatch(preparation, first),
  };
  return financeEnabled ? enableFinance(state) : state;
}

function compactResult(match: MatchState): FixtureResult {
  if (match.status !== 'finished' || !match.result) throw new Error('Only a finished game can post a season result.');
  return {
    score: { ...match.score }, officialScore: { ...match.result.officialScore }, winnerClubId: match[match.result.winner].id,
    kind: match.result.kind, periods: match.period,
    stats: Object.fromEntries(Object.entries(match.stats).map(([id, stats]) => [id, { ...stats }])),
    injuries: Object.fromEntries(Object.entries(match.injuries).map(([id, injury]) => [id, injury.kind])),
  };
}

function postMatch(season: SeasonState, fixture: SeasonFixture, match: MatchState): void {
  if (fixture.result) throw new Error('This fixture result has already been committed.');
  if (match.home.id !== fixture.homeClubId || match.away.id !== fixture.awayClubId || match.seed !== fixtureSeed(season.seed, fixture.id)) throw new Error('The match does not belong to its season fixture.');
  fixture.result = compactResult(match);
  for (const injury of injuriesFromMatch(season.seed, fixture, match)) {
    if (season.injuries.some(existing => existing.id === injury.id || existing.playerId === injury.playerId && isRecovering(existing, fixture.date))) throw new Error('An unavailable player cannot receive a duplicate injury episode.');
    season.injuries.push(injury);
  }
  for (const side of SIDES) {
    const club = match[side], previous = season.plans[club.id]!;
    // Fouls reset next game. Keep the final lineup, filling any excluded-player
    // vacancies from the previous starters and then the roster's stable order.
    const lineup = [...new Set([...match.lineups[side], ...previous.lineup, ...club.players.map(player => player.id)])].slice(0, 5);
    season.plans[club.id] = { tactics: { ...match.tactics[side] }, lineup, autoSubstitutions: club.id === season.managedClubId ? match.autoSubstitutions[side] : true };
    for (const player of club.players) season.conditions[player.id] = match.stats[player.id]!.condition;
  }
}

/** Commits a complete round atomically; a failed transition leaves its input untouched. */
export function advanceSeason(state: SeasonState): SeasonState {
  if (state.status === 'complete') throw new Error('This season is complete.');
  if (state.engineVersion !== 'possession-3' || state.activeMatch.engineVersion !== state.engineVersion) throw new Error('The season and its match must use the supported possession engine.');
  if (state.activeMatch.status !== 'finished' || state.activeMatch.requiredSubstitutions.length) throw new Error('Finish the current match and resolve required decisions before continuing.');
  if (state.activeMatch.injuryMode !== state.injuryMode || state.injuryMode === 'off' && (state.injuries.length || Object.keys(state.activeMatch.injuries).length)) throw new Error('Every club must use the same season injury setting.');
  const current = getActiveFixture(state);
  managedSide(state);
  if (current.round !== state.round || current.date !== state.date || current.result) throw new Error('The current round is not awaiting this match result.');
  let next: SeasonState = {
    ...state,
    fixtures: state.fixtures.map(fixture => ({ ...fixture })),
    plans: Object.fromEntries(Object.entries(state.plans).map(([id, plan]) => [id, { ...plan, tactics: { ...plan.tactics }, lineup: [...plan.lineup] }])),
    conditions: { ...state.conditions },
    injuries: state.injuries.map(injury => ({ ...injury })),
  };
  for (const fixture of next.fixtures.filter(fixture => fixture.round === next.round)) {
    const match = fixture.id === next.activeFixtureId ? next.activeMatch : simulateToEnd(prepareMatch(next, fixture));
    postMatch(next, fixture, match);
  }
  next = processFinanceRound(next);
  if (next.round === SEASON_ROUNDS) {
    next.status = 'complete';
    return next;
  }
  next = recruitAiCoaches(next);
  next.round += 1;
  next.date = dateForRound(next.round, next.seasonNumber);
  if (next.training.enabledSince) {
    const trained = processTrainingWeek({ training: next.training, coaching: next.coaching, clubs: next.clubs, conditions: next.conditions, injuries: next.injuries, seasonNumber: next.seasonNumber, afterRound: next.round - 1, fromDate: state.date, toDate: next.date });
    next.training = trained.training; next.conditions = trained.conditions;
  } else {
    for (const id of Object.keys(next.conditions)) next.conditions[id] = Math.min(100, Math.round((next.conditions[id]! + DAILY_RECOVERY * ROUND_INTERVAL_DAYS) * 1000) / 1000);
  }
  next = prepareFinanceRound(next);
  const fixture = next.fixtures.find(fixture => fixture.round === next.round && [fixture.homeClubId, fixture.awayClubId].includes(next.managedClubId))!;
  next.activeFixtureId = fixture.id;
  next.activeMatch = prepareMatch(next, fixture);
  return next;
}

/** Archive the completed competition and prepare the same club's next opening day. */
export function rolloverSeason(state: SeasonState): SeasonState {
  if (state.status !== 'complete') throw new Error('Complete the current season before starting the next one.');
  if (state.engineVersion !== 'possession-3' || state.activeMatch.engineVersion !== state.engineVersion) throw new Error('The season and its match must use the supported possession engine.');
  if (state.round !== SEASON_ROUNDS || state.date !== dateForRound(SEASON_ROUNDS, state.seasonNumber)) throw new Error('The season must finish its final matchday before rollover.');
  if (state.activeMatch.status !== 'finished' || !state.activeMatch.result || state.activeMatch.requiredSubstitutions.length) throw new Error('Finish the current match and resolve required decisions before continuing.');
  if (state.activeMatch.injuryMode !== state.injuryMode || state.injuryMode === 'off' && (state.injuries.length || Object.keys(state.activeMatch.injuries).length)) throw new Error('Every club must use the same season injury setting.');
  if (state.history.length !== state.seasonNumber - 1 || state.history.some((archive, index) => archive.seasonNumber !== index + 1)) throw new Error('Career history must contain each previous season exactly once.');
  const canonical = createSchedule(state.clubs, state.seasonNumber);
  if (state.fixtures.length !== canonical.length || state.fixtures.some((fixture, index) => {
    const expected = canonical[index]!;
    return !fixture.result || fixture.id !== expected.id || fixture.round !== expected.round || fixture.date !== expected.date || fixture.homeClubId !== expected.homeClubId || fixture.awayClubId !== expected.awayClubId;
  })) throw new Error('Every scheduled fixture must have a committed result before rollover.');
  const current = getActiveFixture(state);
  managedSide(state);
  if (current.round !== SEASON_ROUNDS || state.activeMatch.home.id !== current.homeClubId || state.activeMatch.away.id !== current.awayClubId || state.activeMatch.seed !== fixtureSeed(state.seed, current.id)) throw new Error('The final match does not belong to the completed season.');
  const result = current.result!;
  if (result.winnerClubId !== state.activeMatch[state.activeMatch.result.winner].id || result.kind !== state.activeMatch.result.kind || result.periods !== state.activeMatch.period || SIDES.some(side => result.score[side] !== state.activeMatch.score[side] || result.officialScore[side] !== state.activeMatch.result!.officialScore[side])) throw new Error('The final score must match its committed fixture result.');

  const seasonNumber = state.seasonNumber + 1;
  const fixtures = createSchedule(state.clubs, seasonNumber);
  const first = fixtures.find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId))!;
  const recoveryDays = (Date.parse(`${first.date}T00:00:00.000Z`) - Date.parse(`${state.date}T00:00:00.000Z`)) / DAY_MS;
  const archive = {
    seasonNumber: state.seasonNumber,
    fixtures: state.fixtures.map((fixture): ArchivedFixture => {
      const result = fixture.result!;
      return {
        id: fixture.id, round: fixture.round, date: fixture.date, homeClubId: fixture.homeClubId, awayClubId: fixture.awayClubId,
        result: { score: { ...result.score }, officialScore: { ...result.officialScore }, winnerClubId: result.winnerClubId, kind: result.kind, periods: result.periods, injuries: { ...result.injuries } },
      };
    }),
  };
  let next: SeasonState = {
    ...state, seasonNumber, history: [...state.history, archive], fixtures, round: 1, date: first.date, status: 'active', activeFixtureId: first.id,
    plans: Object.fromEntries(Object.entries(state.plans).map(([id, plan]) => [id, { ...plan, tactics: { ...plan.tactics }, lineup: [...plan.lineup] }])),
    conditions: Object.fromEntries(Object.entries(state.conditions).map(([id, condition]) => [id, Math.min(100, Math.round((condition + DAILY_RECOVERY * recoveryDays) * 1000) / 1000)])),
    injuries: state.injuries.map(injury => ({ ...injury })),
    training: { ...state.training, lastWeek: null },
    coaching: { ...state.coaching, contracts: [] },
  };
  next = startFinanceSeason(next);
  next = renewSeasonCoaching(next, state.coaching);
  next = recruitAiCoaches(next);
  next.activeMatch = prepareMatch(next, first);
  return next;
}

/** Fictional league rules: wins, overall point difference, points scored, club ID. */
export function getStandings(season: { clubs: readonly Team[]; fixtures: readonly (SeasonFixture | ArchivedFixture)[] }): Standing[] {
  const rows = new Map(season.clubs.map(club => [club.id, { position: 0, clubId: club.id, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, difference: 0 }]));
  for (const fixture of season.fixtures) {
    if (!fixture.result) continue;
    for (const side of SIDES) {
      const id = side === 'home' ? fixture.homeClubId : fixture.awayClubId;
      const row = rows.get(id);
      if (!row) throw new Error('A result refers to a club outside the league.');
      row.played += 1;
      if (fixture.result.winnerClubId === id) row.wins += 1; else row.losses += 1;
      row.pointsFor += fixture.result.officialScore[side];
      row.pointsAgainst += fixture.result.officialScore[side === 'home' ? 'away' : 'home'];
      row.difference = row.pointsFor - row.pointsAgainst;
    }
  }
  return [...rows.values()].sort((a, b) => b.wins - a.wins || b.difference - a.difference || b.pointsFor - a.pointsFor || (a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0)).map((row, index) => ({ ...row, position: index + 1 }));
}

import type { ClubPlan, FixtureResult, SeasonFixture, SeasonState, Standing } from '../domain/season';
import type { InjuryMode, MatchState, Side, Team } from '../domain/types';
import { DEVELOPMENT_CLUBS, DEVELOPMENT_DATA_PACK_ID, DEVELOPMENT_START_DATE } from '../data/development-league';
import { createFixtureMatch, simulateToEnd } from '../engine/match';
import { injuriesFromMatch, isRecovering } from './health';

export const SEASON_ROUNDS = 10;
export const ROUND_INTERVAL_DAYS = 7;
export const DAILY_RECOVERY = 3;
const SIDES: readonly Side[] = ['home', 'away'];
const defaultPlan = (club: Team, automatic: boolean): ClubPlan => ({
  tactics: { tempo: .5, outsideShare: .45, pressure: .5 },
  lineup: club.players.slice(0, 5).map(player => player.id),
  autoSubstitutions: automatic,
});

/** Date arithmetic is UTC-only and does not depend on locale or the wall clock. */
export function dateForRound(round: number): string {
  if (!Number.isInteger(round) || round < 1 || round > SEASON_ROUNDS) throw new Error('Choose a round between one and ten.');
  const start = Date.parse(`${DEVELOPMENT_START_DATE}T00:00:00.000Z`);
  return new Date(start + (round - 1) * ROUND_INTERVAL_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Circle scheduling: each club plays once per round and visits every opponent. */
export function createSchedule(clubs: readonly Team[] = DEVELOPMENT_CLUBS): SeasonFixture[] {
  if (clubs.length !== 6 || new Set(clubs.map(club => club.id)).size !== 6) throw new Error('The development league requires six distinct clubs.');
  let ring = clubs.map(club => club.id);
  const firstLeg: SeasonFixture[] = [];
  for (let round = 1; round <= 5; round += 1) {
    for (let game = 0; game < 3; game += 1) {
      const pair = [ring[game]!, ring[ring.length - 1 - game]!] as const;
      const reverse = (round + game) % 2 === 0;
      firstLeg.push({ id: `dev-r${round}-g${game + 1}`, round, date: dateForRound(round), homeClubId: pair[reverse ? 1 : 0], awayClubId: pair[reverse ? 0 : 1], result: null });
    }
    ring = [ring[0]!, ring.at(-1)!, ...ring.slice(1, -1)];
  }
  return [...firstLeg, ...firstLeg.map(fixture => ({
    ...fixture, id: fixture.id.replace(`r${fixture.round}-`, `r${fixture.round + 5}-`), round: fixture.round + 5,
    date: dateForRound(fixture.round + 5), homeClubId: fixture.awayClubId, awayClubId: fixture.homeClubId,
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

function prepareMatch(season: Pick<SeasonState, 'seed' | 'clubs' | 'plans' | 'conditions' | 'managedClubId' | 'injuryMode' | 'injuries'>, fixture: SeasonFixture): MatchState {
  const home = season.clubs.find(club => club.id === fixture.homeClubId);
  const away = season.clubs.find(club => club.id === fixture.awayClubId);
  if (!home || !away) throw new Error('A fixture refers to a missing club.');
  const homePlan = season.plans[home.id]!, awayPlan = season.plans[away.id]!;
  return createFixtureMatch(fixtureSeed(season.seed, fixture.id), home, away, {
    lineups: { home: homePlan.lineup, away: awayPlan.lineup },
    tactics: { home: homePlan.tactics, away: awayPlan.tactics },
    autoSubstitutions: { home: home.id === season.managedClubId ? homePlan.autoSubstitutions : true, away: away.id === season.managedClubId ? awayPlan.autoSubstitutions : true },
    conditions: Object.fromEntries([...home.players, ...away.players].map(player => [player.id, season.conditions[player.id]!])),
    injuryMode: season.injuryMode,
    preExistingInjuries: Object.fromEntries(season.injuries.filter(injury => [home.id, away.id].includes(injury.clubId) && isRecovering(injury, fixture.date)).map(injury => [injury.playerId, injury.kind])),
  });
}

export function createSeason(seed = 42, managedClubId = DEVELOPMENT_CLUBS[0]!.id, injuryMode: InjuryMode = 'standard'): SeasonState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('Choose a whole-number season seed between zero and 4294967295.');
  if (!DEVELOPMENT_CLUBS.some(club => club.id === managedClubId)) throw new Error('Choose a club from the development league.');
  if (!['standard', 'reduced', 'off'].includes(injuryMode)) throw new Error('Choose a valid season injury setting.');
  const clubs = DEVELOPMENT_CLUBS;
  const fixtures = createSchedule(clubs);
  const first = fixtures.find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(managedClubId))!;
  const preparation = {
    seed, clubs, managedClubId, injuryMode, injuries: [],
    plans: Object.fromEntries(clubs.map(club => [club.id, defaultPlan(club, club.id !== managedClubId)])),
    conditions: Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, 100]))),
  };
  return {
    schemaVersion: 2, engineVersion: 'possession-3', dataPackId: DEVELOPMENT_DATA_PACK_ID,
    ...preparation, date: first.date, status: 'active', round: 1, fixtures,
    activeFixtureId: first.id, activeMatch: prepareMatch(preparation, first),
  };
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
  const next: SeasonState = {
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
  if (next.round === SEASON_ROUNDS) {
    next.status = 'complete';
    return next;
  }
  next.round += 1;
  next.date = dateForRound(next.round);
  for (const id of Object.keys(next.conditions)) next.conditions[id] = Math.min(100, Math.round((next.conditions[id]! + DAILY_RECOVERY * ROUND_INTERVAL_DAYS) * 1000) / 1000);
  const fixture = next.fixtures.find(fixture => fixture.round === next.round && [fixture.homeClubId, fixture.awayClubId].includes(next.managedClubId))!;
  next.activeFixtureId = fixture.id;
  next.activeMatch = prepareMatch(next, fixture);
  return next;
}

/** Fictional league rules: wins, overall point difference, points scored, club ID. */
export function getStandings(season: Pick<SeasonState, 'clubs' | 'fixtures'>): Standing[] {
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

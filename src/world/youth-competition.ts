import { financeLedgerCount } from './finance-ledger';
import type { SeasonAcademy } from '../domain/academy';
import type { SeasonInjury, SeasonState, Standing } from '../domain/season';
import type { Team } from '../domain/types';
import type { SeasonYouthCompetition, YouthCompetitionSeason, YouthFixture, YouthFixtureFull, YouthPlayerStatus } from '../domain/youth-competition';
import { createFixtureMatch, simulateToEnd } from '../engine/match';
import { createSchedule } from './season';
import { developAcademyPlayer, emptyAcademyPoints, getAcademyProspect } from './academy-policy';
import { academyAtBoundary } from './academy';
import { isYouthOutcome } from './youth-history';
import { generateYouthSquadProspects } from './academy-generation';
import { injuriesFromMatch, isRecovering } from './health';
import { memoizePure } from './pure-cache';
import { roundKey } from './career-world';

export const YOUTH_SQUAD_SIZE = 8;
const DAY_MS = 86_400_000;
type YouthContext = { youthCompetition?: SeasonYouthCompetition; date?: string };
// Save validation replays these conversions many times per career; both are pure.
const calendarNumber = memoizePure((date: string): number => {
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid youth calendar date.');
  return value;
});
const isoDay = memoizePure((time: number): string => new Date(time).toISOString().slice(0, 10));

export function createYouthCompetition(): SeasonYouthCompetition { return { model: 'youth-competition-1', enabledSince: null, seasons: [] }; }

export function getYouthFixtures(state: Pick<SeasonState, 'youthCompetition' | 'seasonNumber'>, seasonNumber = state.seasonNumber): YouthFixture[] {
  return state.youthCompetition.seasons.find(season => season.seasonNumber === seasonNumber)?.fixtures ?? [];
}

export function getYouthFixtureTeams(fixture: YouthFixture, state?: Pick<SeasonState, 'clubs' | 'academy'>): { home: Team; away: Team } | null {
  if (!isYouthOutcome(fixture)) return fixture.home && fixture.away ? { home: fixture.home, away: fixture.away } : null;
  if (!state) throw new Error('A historical youth outcome needs its career academy records for review.');
  // Settlement follows this round's accepted promotions and precedes its next practice interval. Reconstruct at
  // the fixture's own boundary, including on the final matchday when there is no subsequent practice report.
  const context = { clubs: state.clubs, academy: academyAtBoundary(state.academy, fixture.seasonNumber, fixture.round), seasonNumber: fixture.seasonNumber, round: fixture.round };
  const home = buildYouthClubTeam(context, fixture.homeClubId), away = buildYouthClubTeam(context, fixture.awayClubId);
  for (const side of ['home', 'away'] as const) {
    const team = side === 'home' ? home : away, ids = fixture.playerIds[side];
    if (team.players.length !== ids.length || team.players.some((player, index) => player.id !== ids[index])) throw new Error('The historical youth squad does not match its retained match membership.');
  }
  return { home, away };
}

/** The same ordered prospect membership and shirt-number assignment serve live matches and historical reviews. */
function buildYouthClubTeam(state: Pick<SeasonState, 'clubs' | 'academy' | 'seasonNumber' | 'round'>, clubId: string): Team {
  const club = state.clubs.find(club => club.id === clubId);
  if (!club) throw new Error('A youth fixture must use clubs in this league.');
  const numbers = new Set<number>();
  const players = state.academy.prospects.filter(prospect => prospect.clubId === clubId && getAcademyProspect(state, prospect.player.id)).map(prospect => {
    const player = developAcademyPlayer(prospect, state.academy.points[prospect.player.id]!);
    let number = player.number;
    if (numbers.has(number)) { number = 1; while (numbers.has(number)) number += 1; }
    numbers.add(number);
    return { ...player, number };
  });
  return { id: club.id, name: `${club.name} Academy`, shortName: club.shortName, color: club.color, players };
}

/**
 * Each player's youth appearances and injury episodes in fixture order, built once per (immutable) competition
 * record. Status checks run for every prospect and day during play and save validation; scanning every fixture
 * each time made long leagues slow (step 2.8d). The answers are identical to scanning all fixtures.
 */
interface YouthPlayerIndex { appearances: Map<string, YouthFixture[]>; injuries: Map<string, { fixture: YouthFixture; episode: SeasonInjury }[]> }
const playerIndexes = new WeakMap<SeasonYouthCompetition, YouthPlayerIndex>();
function playerIndex(competition: SeasonYouthCompetition): YouthPlayerIndex {
  let index = playerIndexes.get(competition);
  if (index) return index;
  index = { appearances: new Map(), injuries: new Map() };
  for (const season of competition.seasons) for (const fixture of season.fixtures) {
    if (!fixture.result) continue;
    if (fixture.result.played) for (const playerId of Object.keys(fixture.result.stats)) { const list = index.appearances.get(playerId) ?? []; list.push(fixture); index.appearances.set(playerId, list); }
    for (const episode of fixture.result.injuries) { const list = index.injuries.get(episode.playerId) ?? []; list.push({ fixture, episode }); index.injuries.set(episode.playerId, list); }
  }
  playerIndexes.set(competition, index);
  return index;
}
/** The fixtures a status check may see: those with a result on or before the date, optionally before a given fixture. */
const visibleFixture = (fixture: YouthFixture, onDate: string, beforeFixtureId?: string) => fixture.date <= onDate && fixture.id !== beforeFixtureId && (!beforeFixtureId || fixture.date < onDate);

/** Dated diagnoses and actual workload remain separate from senior health and condition. */
export function getYouthPlayerStatus(context: YouthContext, playerId: string, onDate = context.date ?? '', beforeFixtureId?: string): YouthPlayerStatus {
  const empty = { playerId, condition: 100, available: true, injury: null, returnOn: null };
  if (!context.youthCompetition?.enabledSince || onDate < context.youthCompetition.enabledSince.date) return empty;
  const until = calendarNumber(onDate), index = playerIndex(context.youthCompetition);
  const injuries = (index.injuries.get(playerId) ?? []).filter(entry => visibleFixture(entry.fixture, onDate, beforeFixtureId)).map(entry => entry.episode);
  const current = [...injuries].reverse().find(episode => isRecovering(episode, onDate)) ?? null;
  const last = [...(index.appearances.get(playerId) ?? [])].reverse().find(fixture => visibleFixture(fixture, onDate, beforeFixtureId));
  let condition = last?.result!.stats[playerId]?.condition ?? 100;
  if (last) for (let date = calendarNumber(last.date) + DAY_MS; date <= until && condition < 100; date += DAY_MS) {
    const day = isoDay(date);
    const available = !injuries.some(episode => isRecovering(episode, day));
    // The fixed academy practice plan applies only between this season's fixtures.
    const practice = context.youthCompetition.seasons.some(season => season.fixtures.length > 1 && day > season.fixtures[0]!.date && day <= season.fixtures.at(-1)!.date);
    condition = Math.max(35, Math.min(100, Math.round((condition + 3 - (practice && available ? 2 : 0)) * 1000) / 1000));
  }
  return { playerId, condition, available: current === null, injury: current, returnOn: current?.returnOn ?? null };
}

function supplement(state: SeasonState): { academy: SeasonAcademy; intakeIds: string[] } {
  let academy = state.academy;
  const intakeIds: string[] = [];
  for (const club of state.clubs) {
    if (academy.intakes.some(entry => entry.clubId === club.id && entry.seasonNumber === state.seasonNumber && entry.source === 'youth-squad')) throw new Error('Supplement each youth squad at most once per season.');
    const current = academy.prospects.filter(prospect => prospect.clubId === club.id && getAcademyProspect({ ...state, academy }, prospect.player.id));
    const prospects = generateYouthSquadProspects(state.seed, club.id, state.seasonNumber, state.round, current, Math.max(0, YOUTH_SQUAD_SIZE - current.length));
    const id = `academy-intake-${academy.intakes.length + 1}`;
    academy = { ...academy, prospects: [...academy.prospects, ...prospects], intakes: [...academy.intakes, { id, clubId: club.id, seasonNumber: state.seasonNumber, round: state.round, date: state.date, initial: false, source: 'youth-squad', prospectIds: prospects.map(prospect => prospect.player.id) }], points: { ...academy.points, ...Object.fromEntries(prospects.map(prospect => [prospect.player.id, emptyAcademyPoints()])) }, focus: { ...academy.focus, ...Object.fromEntries(prospects.map(prospect => [prospect.player.id, 'balanced' as const])) } };
    intakeIds.push(id);
  }
  return { academy, intakeIds };
}

function prepare(state: SeasonState, fromRound: number): SeasonState {
  const added = supplement(state);
  const fixtures: YouthFixture[] = createSchedule(state.clubs, state.seasonNumber).filter(fixture => fixture.round >= fromRound).map(fixture => ({ ...fixture, id: `youth-s${state.seasonNumber}-r${fixture.round}-${fixture.id.slice(fixture.id.lastIndexOf('g'))}`, seasonNumber: state.seasonNumber, home: null, away: null, startingConditions: null, result: null }));
  const season: YouthCompetitionSeason = { seasonNumber: state.seasonNumber, fromRound, preparedOn: state.date, supplementalIntakeIds: added.intakeIds, fixtures };
  return { ...state, academy: added.academy, youthCompetition: { ...state.youthCompetition, seasons: [...state.youthCompetition.seasons, season] } };
}

export function enableYouthCompetition(state: SeasonState): SeasonState {
  if (state.youthCompetition.enabledSince) return state;
  if (!state.academy.enabledSince) throw new Error('Enable the academy before arranging youth matches.');
  if (state.status !== 'active') throw new Error('Enable youth matches during an active season.');
  const enabledSince = { seasonNumber: state.seasonNumber, round: state.round, date: state.date, ledgerIndex: financeLedgerCount(state.finance), contractCount: state.employment.contracts.length, negotiationCount: state.negotiations.records.length, recruitmentEventCount: state.recruitment.events.length, academyIntakeCount: state.academy.intakes.length, academyGraduateCount: state.academy.graduates.length };
  return prepare({ ...state, youthCompetition: { ...state.youthCompetition, enabledSince } }, state.round);
}

export function prepareYouthSeason(state: SeasonState): SeasonState {
  if (!state.youthCompetition.enabledSince) return state;
  if (state.status !== 'active' || state.round !== 1) throw new Error('Prepare the youth season on opening day.');
  if (state.youthCompetition.seasons.some(season => season.seasonNumber === state.seasonNumber)) return state;
  const previous = state.youthCompetition.seasons.at(-1);
  if (!previous || previous.seasonNumber + 1 !== state.seasonNumber || previous.fixtures.some(fixture => !fixture.result)) throw new Error('Complete the preceding youth season before preparing the next one.');
  return prepare(state, 1);
}

export function youthFixtureSeed(seed: number, fixtureId: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  for (const character of `youth-match:${fixtureId}`) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  return value;
}

export function prepareYouthFixture(state: SeasonState, fixture: YouthFixture): { home: Team; away: Team; startingConditions: Record<string, number>; unavailable: Record<string, SeasonInjury['kind']>; lineups: { home: string[]; away: string[] } } {
  if (fixture.seasonNumber !== state.seasonNumber || fixture.round !== state.round || fixture.date !== state.date) throw new Error('Prepare youth teams on their scheduled matchday.');
  const home = buildYouthClubTeam(state, fixture.homeClubId), away = buildYouthClubTeam(state, fixture.awayClubId);
  const statuses = [...home.players, ...away.players].map(player => getYouthPlayerStatus(state, player.id, fixture.date, fixture.id));
  const startingConditions = Object.fromEntries(statuses.map(status => [status.playerId, status.condition]));
  const unavailable = Object.fromEntries(statuses.filter(status => status.injury).map(status => [status.playerId, status.injury!.kind]));
  const lineup = (team: Team): string[] => {
    const available = team.players.filter(player => !Object.hasOwn(unavailable, player.id));
    const chosen: string[] = [];
    for (const position of ['PG', 'SG', 'SF', 'PF', 'C']) {
      const player = available.find(player => player.position === position && !chosen.includes(player.id));
      if (player) chosen.push(player.id);
    }
    return [...chosen, ...available.filter(player => !chosen.includes(player.id)).map(player => player.id)].slice(0, 5);
  };
  return { home, away, startingConditions, unavailable, lineups: { home: lineup(home), away: lineup(away) } };
}

/** Actual engine statistics when playable; explicit unplayed decisions never manufacture minutes or an MVP. */
export function settleYouthFixture(state: SeasonState, fixture: YouthFixture): YouthFixtureFull {
  if (fixture.result) throw new Error('A youth fixture can be settled only once.');
  const prepared = prepareYouthFixture(state, fixture), { home, away, startingConditions, lineups, unavailable } = prepared;
  const homeShort = lineups.home.length < 5, awayShort = lineups.away.length < 5;
  if (homeShort || awayShort) {
    const both = homeShort && awayShort, score = both ? { home: 0, away: 0 } : { home: homeShort ? 0 : 20, away: awayShort ? 0 : 20 };
    return { ...fixture, home, away, startingConditions, result: { kind: both ? 'no-contest' : 'default', played: false, score, officialScore: { ...score }, winnerClubId: both ? null : homeShort ? away.id : home.id, periods: 0, stats: {}, injuries: [], reason: both ? 'Both academies have fewer than five available players; no contest.' : `${homeShort ? home.name : away.name} have fewer than five available players; 20–0 forfeit.` } };
  }
  const match = simulateToEnd(createFixtureMatch(youthFixtureSeed(state.seed, fixture.id), home, away, { lineups, conditions: startingConditions, preExistingInjuries: unavailable, injuryMode: state.injuryMode, autoSubstitutions: { home: true, away: true } }));
  if (!match.result || match.status !== 'finished') throw new Error('The youth match must complete before its result is recorded.');
  return { ...fixture, home, away, startingConditions, result: { kind: match.result.kind === 'default' ? 'default' : 'played', played: true, score: { ...match.score }, officialScore: { ...match.result.officialScore }, winnerClubId: match[match.result.winner].id, periods: match.period, stats: Object.fromEntries(Object.entries(match.stats).map(([id, stats]) => [id, { ...stats }])), injuries: injuriesFromMatch(state.seed, fixture, match), reason: match.result.kind === 'default' ? 'The match ended after a team had fewer than two eligible players.' : null } };
}

export function processYouthRound(state: SeasonState): SeasonState {
  if (!state.youthCompetition.enabledSince) return state;
  const season = state.youthCompetition.seasons.find(season => season.seasonNumber === state.seasonNumber);
  if (!season) throw new Error('Prepare this youth season before settling its matches.');
  const due = season.fixtures.filter(fixture => fixture.round === state.round);
  if (due.length !== state.clubs.length / 2 || season.fixtures.some(fixture => fixture.round < state.round && !fixture.result)) throw new Error('Settle youth fixtures in calendar order.');
  if (due.every(fixture => fixture.result)) return state;
  if (due.some(fixture => fixture.result)) throw new Error('Settle the whole youth matchday atomically.');
  const settled = new Map(due.map(fixture => [fixture.id, settleYouthFixture(state, fixture)]));
  return { ...state, youthCompetition: { ...state.youthCompetition, seasons: state.youthCompetition.seasons.map(entry => entry === season ? { ...entry, fixtures: entry.fixtures.map(fixture => settled.get(fixture.id) ?? fixture) } : entry) } };
}

/** Strip future results for historical practice, injury and promotion replay. */
export function youthCompetitionAtBoundary(competition: SeasonYouthCompetition, seasonNumber: number, round: number, includeCurrentRound = false): SeasonYouthCompetition {
  if (!competition.enabledSince || roundKey(competition.enabledSince.seasonNumber, competition.enabledSince.round) > roundKey(seasonNumber, round)) return createYouthCompetition();
  return { ...competition, seasons: competition.seasons.filter(season => season.seasonNumber <= seasonNumber).map(season => ({ ...season, fixtures: season.fixtures.map(fixture => fixture.seasonNumber < seasonNumber || fixture.round < round || includeCurrentRound && fixture.round === round ? fixture : { id: fixture.id, seasonNumber: fixture.seasonNumber, round: fixture.round, date: fixture.date, homeClubId: fixture.homeClubId, awayClubId: fixture.awayClubId, home: null, away: null, startingConditions: null, result: null }) })) };
}

export function getYouthStandings(state: Pick<SeasonState, 'youthCompetition' | 'seasonNumber' | 'clubs'>, seasonNumber = state.seasonNumber): Standing[] {
  const rows = new Map(state.clubs.map(club => [club.id, { position: 0, clubId: club.id, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, difference: 0 }]));
  for (const fixture of getYouthFixtures(state, seasonNumber)) {
    const result = fixture.result;
    if (!result || result.kind === 'no-contest') continue;
    for (const side of ['home', 'away'] as const) {
      const row = rows.get(side === 'home' ? fixture.homeClubId : fixture.awayClubId)!;
      row.played += 1; if (row.clubId === result.winnerClubId) row.wins += 1; else row.losses += 1;
      row.pointsFor += result.officialScore[side]; row.pointsAgainst += result.officialScore[side === 'home' ? 'away' : 'home']; row.difference = row.pointsFor - row.pointsAgainst;
    }
  }
  return [...rows.values()].sort((a, b) => b.wins - a.wins || b.difference - a.difference || b.pointsFor - a.pointsFor || a.clubId.localeCompare(b.clubId, 'en')).map((row, index) => ({ ...row, position: index + 1 }));
}

export function getYouthPlayerPerformance(state: Pick<SeasonState, 'youthCompetition' | 'seasonNumber'>, playerId: string, seasonNumber = state.seasonNumber): { appearances: number; secondsPlayed: number; points: number; rebounds: number; assists: number } {
  const totals = { appearances: 0, secondsPlayed: 0, points: 0, rebounds: 0, assists: 0 };
  for (const fixture of getYouthFixtures(state, seasonNumber)) {
    const stats = fixture.result?.played ? fixture.result.stats[playerId] : undefined;
    if (!stats || stats.secondsPlayed === 0) continue;
    totals.appearances += 1; totals.secondsPlayed += stats.secondsPlayed; totals.points += stats.points; totals.rebounds += stats.rebounds; totals.assists += stats.assists;
  }
  return totals;
}

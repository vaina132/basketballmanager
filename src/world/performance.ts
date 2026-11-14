import type { SeasonState } from '../domain/season';
import type { MatchResult, Player, PlayerStats, Team } from '../domain/types';
import { getFixtureTeams, getSeasonRosterData } from './rosters';
import { emptySeniorTotals, SENIOR_TOTAL_KEYS } from './senior-history';

export type PerformanceTotals = Omit<PlayerStats, 'condition'>;
export type PerformanceMode = 'per-game' | 'totals' | 'per-40';
export type PerformanceMetric = 'games' | 'minutes' | 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers' | 'fgPercent' | 'threePercent' | 'ftPercent';
export type PerformanceDirection = 'asc' | 'desc';

export interface PlayerGameLog {
  seasonNumber: number;
  clubId: string;
  fixtureId: string;
  date: string;
  round: number;
  opponentClubId: string;
  home: boolean;
  result: 'W' | 'L';
  teamScore: number;
  opponentScore: number;
  kind: MatchResult['kind'];
  periods: number;
  participation: 'played' | 'injured' | 'dnp';
  stats: PerformanceTotals;
}

export interface SeasonPlayerPerformance {
  /** A player can have separate club stints in the same season. */
  key: string;
  seasonNumber: number;
  player: Player;
  club: Team;
  clubGames: number;
  games: number;
  totals: PerformanceTotals;
  log: PlayerGameLog[];
  /** Registered matches included in the totals whose individual box scores were summarized. */
  summaryGames?: number;
}

export const LEADER_QUALIFICATION_TEXT = 'At least half of club games played and 5 minutes per club game.';
const TOTAL_KEYS = SENIOR_TOTAL_KEYS;
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const emptyTotals = emptySeniorTotals;

/** Missing legacy box scores are unavailable history, never zero performances. */
export function getPerformanceCoverage(season: SeasonState, seasonNumber = season.seasonNumber): 'complete' | 'unavailable' {
  const data = getSeasonRosterData(season, seasonNumber);
  return data.fixtures.some(fixture => fixture.result !== null && fixture.result.stats === null && !('appearances' in fixture.result)) ? 'unavailable' : 'complete';
}

export function performanceRecordKey(seasonNumber: number, clubId: string, playerId: string): string {
  return `${seasonNumber}:${clubId}:${playerId}`;
}

/** Attribute each committed box score to the squad recorded for that fixture. */
export function getSeasonPerformance(season: SeasonState, seasonNumber = season.seasonNumber): SeasonPlayerPerformance[] {
  const data = getSeasonRosterData(season, seasonNumber);
  if (getPerformanceCoverage(season, seasonNumber) === 'unavailable') return [];
  const records = new Map<string, SeasonPlayerPerformance>();
  const clubGames = new Map(season.clubs.map(club => [club.id, data.fixtures.filter(fixture => fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(club.id)).length]));
  // Snapshots preserve departed players and their identity without consulting today's squad.
  for (const club of season.clubs) for (const roster of [...data.rosters].filter(roster => roster.clubId === club.id).sort((a, b) => a.fromRound - b.fromRound)) {
    for (const player of roster.players) {
      const key = performanceRecordKey(seasonNumber, club.id, player.id);
      const existing = records.get(key);
      if (existing) { existing.player = player; existing.club = { ...club, players: [...roster.players] }; }
      else records.set(key, { key, seasonNumber, player, club: { ...club, players: [...roster.players] }, clubGames: clubGames.get(club.id)!, games: 0, totals: emptyTotals(), log: [] });
    }
  }
  // Sorting a copy makes totals/log order independent of the input fixture order.
  const fixtures = data.fixtures.filter(fixture => fixture.result !== null).sort((left, right) => compareText(right.date, left.date) || right.round - left.round || compareText(left.id, right.id));
  for (const fixture of fixtures) {
    const result = fixture.result!;
    if (result.stats === null) {
      if (!('appearances' in result) || !result.appearances || !data.summary) throw new Error('Player statistics were not retained for this season.');
      for (const clubId of [fixture.homeClubId, fixture.awayClubId]) {
        const team = getFixtureTeams(season, fixture, seasonNumber)[clubId === fixture.homeClubId ? 'home' : 'away'];
        for (const player of team.players) {
          const row = records.get(performanceRecordKey(seasonNumber, clubId, player.id))!;
          row.summaryGames = (row.summaryGames ?? 0) + 1;
        }
      }
      continue;
    }
    const teams = getFixtureTeams(season, fixture, seasonNumber);
    for (const home of [true, false]) {
      const clubId = home ? fixture.homeClubId : fixture.awayClubId;
      const side = home ? 'home' : 'away', opponent = home ? 'away' : 'home';
      for (const player of teams[side].players) {
        const row = records.get(performanceRecordKey(seasonNumber, clubId, player.id));
        if (!row) throw new Error('A committed performance result refers to an unknown roster member.');
        const source = result.stats[row.player.id];
        if (!source) throw new Error('A committed performance result is missing player statistics.');
        const stats = emptyTotals();
        for (const key of TOTAL_KEYS) { stats[key] = source[key]; row.totals[key] += source[key]; }
        const played = TOTAL_KEYS.some(key => stats[key] !== 0);
        if (played) row.games += 1;
        row.log.push({
          seasonNumber, clubId,
          fixtureId: fixture.id, date: fixture.date, round: fixture.round,
          opponentClubId: home ? fixture.awayClubId : fixture.homeClubId, home,
          result: result.winnerClubId === clubId ? 'W' : 'L',
          teamScore: result.officialScore[side], opponentScore: result.officialScore[opponent],
          kind: result.kind, periods: result.periods,
          participation: played ? 'played' : Object.hasOwn(result.injuries, row.player.id) ? 'injured' : 'dnp', stats,
        });
      }
    }
  }
  for (const summary of data.summary?.players ?? []) {
    const row = records.get(performanceRecordKey(seasonNumber, summary.clubId, summary.playerId));
    if (!row) throw new Error('Season totals refer to an unknown registration.');
    row.games += summary.games;
    for (const key of TOTAL_KEYS) row.totals[key] += summary.totals[key];
  }
  return [...records.values()];
}

/** Percentages use combined attempts; per-40 adjusts counting stats, never appearances or MPG. */
export function performanceValue(row: SeasonPlayerPerformance, metric: PerformanceMetric, mode: PerformanceMode): number | null {
  if (metric === 'games') return row.games;
  if (metric === 'minutes') return mode === 'totals' ? row.totals.secondsPlayed / 60 : row.games ? row.totals.secondsPlayed / 60 / row.games : null;
  if (metric === 'fgPercent' || metric === 'threePercent' || metric === 'ftPercent') {
    const [made, attempted] = metric === 'fgPercent' ? [row.totals.fieldGoalsMade, row.totals.fieldGoalsAttempted]
      : metric === 'threePercent' ? [row.totals.threePointersMade, row.totals.threePointersAttempted]
        : [row.totals.freeThrowsMade, row.totals.freeThrowsAttempted];
    return attempted ? made / attempted * 100 : null;
  }
  if (mode === 'totals') return row.totals[metric];
  const denominator = mode === 'per-game' ? row.games : row.totals.secondsPlayed / 2400;
  return denominator ? row.totals[metric] / denominator : null;
}

/** Nulls stay last in either direction; identity breaks equal values independently of locale. */
export function sortPerformance(rows: readonly SeasonPlayerPerformance[], metric: PerformanceMetric, mode: PerformanceMode, direction: PerformanceDirection): SeasonPlayerPerformance[] {
  return [...rows].sort((left, right) => {
    const a = performanceValue(left, metric, mode), b = performanceValue(right, metric, mode);
    if (a === null && b !== null) return 1;
    if (a !== null && b === null) return -1;
    if (a !== null && b !== null && a !== b) return direction === 'asc' ? a - b : b - a;
    return compareText(left.player.name, right.player.name) || compareText(left.player.id, right.player.id) || compareText(left.club.id, right.club.id);
  });
}

export function leaderQualificationThreshold(row: Pick<SeasonPlayerPerformance, 'clubGames'>): { games: number; minutes: number } {
  return { games: Math.ceil(row.clubGames / 2), minutes: 5 * row.clubGames };
}

export function isQualifiedLeader(row: SeasonPlayerPerformance): boolean {
  const threshold = leaderQualificationThreshold(row);
  return row.clubGames > 0 && row.games >= threshold.games && row.totals.secondsPlayed >= threshold.minutes * 60;
}

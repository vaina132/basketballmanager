import type { SeasonState } from '../domain/season';
import type { MatchResult, Player, PlayerStats, Team } from '../domain/types';

export type PerformanceTotals = Omit<PlayerStats, 'condition'>;
export type PerformanceMode = 'per-game' | 'totals' | 'per-40';
export type PerformanceMetric = 'games' | 'minutes' | 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers' | 'fgPercent' | 'threePercent' | 'ftPercent';
export type PerformanceDirection = 'asc' | 'desc';

export interface PlayerGameLog {
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
  player: Player;
  club: Team;
  clubGames: number;
  games: number;
  totals: PerformanceTotals;
  log: PlayerGameLog[];
}

export const LEADER_QUALIFICATION_TEXT = 'At least half of club games played and 5 minutes per club game.';
const TOTAL_KEYS: readonly (keyof PerformanceTotals)[] = [
  'secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade',
  'threePointersAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'rebounds', 'assists',
  'steals', 'blocks', 'turnovers', 'fouls',
];
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const emptyTotals = (): PerformanceTotals => Object.fromEntries(TOTAL_KEYS.map(key => [key, 0])) as PerformanceTotals;

/** Derive this season's performance only from results committed to the calendar. */
export function getSeasonPerformance(season: SeasonState): SeasonPlayerPerformance[] {
  const rows = season.clubs.flatMap(club => club.players.map((player): SeasonPlayerPerformance => ({ player, club, clubGames: 0, games: 0, totals: emptyTotals(), log: [] })));
  const clubRows = new Map(season.clubs.map(club => [club.id, rows.filter(row => row.club.id === club.id)]));
  // Sorting a copy makes totals/log order independent of the input fixture order.
  const fixtures = season.fixtures.filter(fixture => fixture.result !== null).sort((left, right) => compareText(right.date, left.date) || right.round - left.round || compareText(left.id, right.id));
  for (const fixture of fixtures) {
    const result = fixture.result!;
    for (const home of [true, false]) {
      const clubId = home ? fixture.homeClubId : fixture.awayClubId;
      const side = home ? 'home' : 'away', opponent = home ? 'away' : 'home';
      const participants = clubRows.get(clubId);
      if (!participants) throw new Error('A committed performance result refers to an unknown club.');
      for (const row of participants) {
        const source = result.stats[row.player.id];
        if (!source) throw new Error('A committed performance result is missing player statistics.');
        const stats = emptyTotals();
        for (const key of TOTAL_KEYS) { stats[key] = source[key]; row.totals[key] += source[key]; }
        const played = TOTAL_KEYS.some(key => stats[key] !== 0);
        row.clubGames += 1;
        if (played) row.games += 1;
        row.log.push({
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
  return rows;
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

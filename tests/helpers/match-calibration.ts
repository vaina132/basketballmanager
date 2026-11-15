import type { MatchState, Side } from '../../src/domain/types';

/** One side's box-score totals in one finished match (player rebounds split by the rebound events). */
export interface SideLine {
  points: number; fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
  orb: number; drb: number; teamOrb: number; teamDrb: number; assists: number; turnovers: number; steals: number; blocks: number; fouls: number;
  starterSeconds: number[]; starterPoints: number[]; benchSeconds: number[]; benchPoints: number[]; topFiveSeconds: number; teamSeconds: number;
}
export interface GameLine { home: SideLine; away: SideLine; periods: number; homeWin: boolean; margin: number }

const SIDES: readonly Side[] = ['home', 'away'];

/** Summarise a finished match; `starters` is each side's lineup at tip-off. */
export function gameLine(end: MatchState, starters: Record<Side, readonly string[]>): GameLine {
  const lines = {} as Record<Side, SideLine>;
  for (const side of SIDES) {
    const ids = end[side].players.map(player => player.id), stats = ids.map(id => end.stats[id]!);
    const sum = (key: keyof (typeof stats)[number]) => stats.reduce((total, item) => total + (item[key] as number), 0);
    const starting = new Set(starters[side]);
    const seconds = ids.map(id => end.stats[id]!.secondsPlayed).sort((a, b) => b - a);
    lines[side] = {
      points: sum('points'), fgm: sum('fieldGoalsMade'), fga: sum('fieldGoalsAttempted'), tpm: sum('threePointersMade'), tpa: sum('threePointersAttempted'),
      ftm: sum('freeThrowsMade'), fta: sum('freeThrowsAttempted'), orb: 0, drb: 0, teamOrb: 0, teamDrb: 0, assists: sum('assists'), turnovers: sum('turnovers'), steals: sum('steals'), blocks: sum('blocks'), fouls: sum('fouls'),
      starterSeconds: ids.filter(id => starting.has(id)).map(id => end.stats[id]!.secondsPlayed),
      starterPoints: ids.filter(id => starting.has(id)).map(id => end.stats[id]!.points),
      benchSeconds: ids.filter(id => !starting.has(id) && end.stats[id]!.secondsPlayed > 0).map(id => end.stats[id]!.secondsPlayed),
      benchPoints: ids.filter(id => !starting.has(id) && end.stats[id]!.secondsPlayed > 0).map(id => end.stats[id]!.points),
      topFiveSeconds: seconds.slice(0, 5).reduce((total, value) => total + value, 0), teamSeconds: seconds.reduce((total, value) => total + value, 0),
    };
  }
  for (const event of end.events) if (event.type === 'rebound' && event.side) {
    if (/offensive rebound/.test(event.text)) lines[event.side].orb += 1; else lines[event.side].drb += 1;
  } else if (event.type === 'command' && event.side && /team rebound/.test(event.text)) {
    if (/keep possession/.test(event.text)) lines[event.side].teamOrb += 1; else lines[event.side].teamDrb += 1;
  }
  return { home: lines.home, away: lines.away, periods: end.period, homeWin: end.score.home > end.score.away, margin: Math.abs(end.score.home - end.score.away) };
}

const mean = (values: readonly number[]) => values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
const quantile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * fraction, floor = Math.floor(index);
  return sorted.length ? sorted[floor]! + (sorted[Math.min(floor + 1, sorted.length - 1)]! - sorted[floor]!) * (index - floor) : NaN;
};
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Per-team-per-game averages and shares, comparable with the 2025-26 European regular-season targets. */
export function calibrationSummary(games: readonly GameLine[]) {
  const teams = games.flatMap(game => [game.home, game.away]);
  const avg = (pick: (line: SideLine) => number) => mean(teams.map(pick));
  const fga = avg(line => line.fga), fgm = avg(line => line.fgm), tpa = avg(line => line.tpa), tpm = avg(line => line.tpm), fta = avg(line => line.fta), ftm = avg(line => line.ftm);
  const orb = avg(line => line.orb), drb = avg(line => line.drb), turnovers = avg(line => line.turnovers), points = avg(line => line.points);
  const teamOrb = avg(line => line.teamOrb), teamDrb = avg(line => line.teamDrb);
  const possessions = fga - orb - teamOrb + turnovers + 0.44 * fta;
  const starterMinutes = teams.flatMap(line => line.starterSeconds.map(value => value / 60));
  const benchMinutes = teams.flatMap(line => line.benchSeconds.map(value => value / 60));
  const margins = games.map(game => game.margin);
  const share = (test: (value: number) => boolean) => round(100 * games.filter(game => test(game.margin)).length / Math.max(1, games.length));
  return {
    games: games.length,
    points: round(points), possessions: round(possessions), offensiveRating: round(100 * points / possessions),
    fgm: round(fgm), fga: round(fga), fgPct: round(100 * fgm / fga), twoPm: round(fgm - tpm), twoPa: round(fga - tpa), twoPct: round(100 * (fgm - tpm) / (fga - tpa)),
    threePm: round(tpm), threePa: round(tpa), threePct: round(100 * tpm / tpa), threeShare: round(100 * tpa / fga),
    ftm: round(ftm), fta: round(fta), ftPct: round(100 * ftm / fta), ftaPerFga: round(fta / fga, 2),
    orb: round(orb), drb: round(drb), rebounds: round(orb + drb), teamOrb: round(teamOrb), teamDrb: round(teamDrb), totalRebounds: round(orb + drb + teamOrb + teamDrb), orbPct: round(100 * orb / (orb + drb)),
    assists: round(avg(line => line.assists)), assistedPct: round(100 * avg(line => line.assists) / fgm), turnovers: round(turnovers),
    steals: round(avg(line => line.steals)), blocks: round(avg(line => line.blocks)), fouls: round(avg(line => line.fouls)),
    margin: round(mean(margins)), within3: share(value => value <= 3), within5: share(value => value <= 5), within10: share(value => value <= 10), atLeast20: share(value => value >= 20),
    overtimePct: round(100 * games.filter(game => game.periods > 4).length / Math.max(1, games.length)),
    homeWinPct: round(100 * games.filter(game => game.homeWin).length / Math.max(1, games.length)),
    starterMinutes: round(mean(starterMinutes)), starterMinutesP10: round(quantile(starterMinutes, .1)), starterMinutesP90: round(quantile(starterMinutes, .9)),
    starterMinuteShare: round(100 * mean(teams.map(line => line.starterSeconds.reduce((a, b) => a + b, 0) / line.teamSeconds))),
    starterPointShare: round(100 * mean(teams.map(line => line.starterPoints.reduce((a, b) => a + b, 0) / Math.max(1, line.points)))),
    starterPoints: round(mean(teams.flatMap(line => line.starterPoints))), benchPoints: round(mean(teams.flatMap(line => line.benchPoints))),
    benchMinutes: round(mean(benchMinutes)), benchUsed: round(mean(teams.map(line => line.benchSeconds.length))),
    topFiveMinuteShare: round(100 * mean(teams.map(line => line.topFiveSeconds / line.teamSeconds))),
  };
}

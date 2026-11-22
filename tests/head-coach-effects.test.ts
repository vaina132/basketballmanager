import { beforeAll, describe, expect, it } from 'vitest';
import type { Tactics, Team } from '../src/domain/types';
import type { HeadCoach } from '../src/domain/coaches';
import { createFixtureMatch, simulateToEnd } from '../src/engine/match';
import { REAL_COACHES } from '../src/data/real-coaches';
import { estimateCoach, NO_TITLES } from '../src/world/coach-ratings';
import { coachTactics } from '../src/world/head-coaches';
import { calibrationSummary, calibrationTeam, gameLine, type GameLine } from './helpers/match-calibration';

/**
 * Format 82 (owner item E): computer clubs play their head coach's style. Over many seeded games a defence-minded
 * coach's team concedes fewer points than the same team under a neutral coach, and a league of real coaches' styles
 * keeps the match calibration bands (the engine itself is unchanged; only the instructions differ).
 */
const PLAYS = { playModel: 'plays-2', computerCoach: ['home', 'away'] } as const;
const strengths = [-1, -.5, -.25, 0, .25, .5, 1, 0];
const teams: Team[] = strengths.map((strength, index) => calibrationTeam(index, strength));
const date = '2026-09-05';
const defensive: HeadCoach = estimateCoach('coach-test-defence', { name: 'Defence Test', born: '1968', nationality: 'Greece', since: 1998, titles: NO_TITLES, hints: ['defence', 'discipline'] }, 2, date);
const neutralTactics: Tactics = { tempo: .5, outsideShare: .45, pressure: .5 };
const realCoaches = REAL_COACHES.map(coach => estimateCoach(coach.id, coach, coach.level, date));

const conceded = { defensive: 0, neutral: 0, games: 0 };
const league: GameLine[] = [];
beforeAll(() => {
  let seed = 8200;
  for (const home of teams) for (const away of teams) {
    if (home === away) continue;
    // Each pairing three times, each time twice with the same seed: once the home side has the defensive coach, once a neutral one.
    const homeFive = home.players.slice(0, 5);
    for (let repeat = 0; repeat < 3; repeat += 1) {
      for (const variant of ['defensive', 'neutral'] as const) {
        const tactics = variant === 'defensive' ? coachTactics(defensive, homeFive) : neutralTactics;
        const end = simulateToEnd(createFixtureMatch(seed + repeat * 100_000, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', tactics: { home: tactics, away: neutralTactics }, ...PLAYS }));
        conceded[variant] += end.score.away;
      }
      conceded.games += 1;
    }
    // A league where every side plays a real coach's style.
    const homeCoach = realCoaches[seed % realCoaches.length]!, awayCoach = realCoaches[(seed * 7 + 3) % realCoaches.length]!;
    const match = createFixtureMatch(seed + 50_000, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', tactics: { home: coachTactics(homeCoach, homeFive), away: coachTactics(awayCoach, away.players.slice(0, 5)) }, ...PLAYS });
    league.push(gameLine(simulateToEnd(match), { home: match.lineups.home, away: match.lineups.away }));
    seed += 1;
  }
}, 600_000);

describe('head coaches steer computer clubs (format 82)', () => {
  it('a defence-minded coach\'s team concedes fewer points on average', () => {
    const defensiveAverage = conceded.defensive / conceded.games, neutralAverage = conceded.neutral / conceded.games;
    expect(defensiveAverage).toBeLessThan(neutralAverage - 0.75);
  });

  it('a league of real coaches\' styles keeps the calibration bands', () => {
    const s = calibrationSummary(league);
    expect(s.possessions).toBeGreaterThanOrEqual(71); expect(s.possessions).toBeLessThanOrEqual(79);
    expect(s.points).toBeGreaterThanOrEqual(80); expect(s.points).toBeLessThanOrEqual(90);
    expect(s.offensiveRating).toBeGreaterThanOrEqual(107); expect(s.offensiveRating).toBeLessThanOrEqual(118);
    expect(s.threeShare).toBeGreaterThanOrEqual(37); expect(s.threeShare).toBeLessThanOrEqual(46);
    expect(s.ftaPerFga).toBeGreaterThanOrEqual(.28); expect(s.ftaPerFga).toBeLessThanOrEqual(.4);
    expect(s.turnovers).toBeGreaterThanOrEqual(11.5); expect(s.turnovers).toBeLessThanOrEqual(15);
    expect(s.steals).toBeGreaterThanOrEqual(5.5); expect(s.steals).toBeLessThanOrEqual(8.5);
  });
});

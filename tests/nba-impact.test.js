import { describe, expect, it } from 'vitest';
import { NBA_IMPACT_RULES, impactOverall, nbaImpactTotals } from '../scripts/real-data-nba-ratings.mjs';

/** rating-4 NBA impact (23 November 2026): stars, not efficient bench shooters, reach the top of the NBA scale. */
const row = (id, games, minutesPerGame, starts, points, extra = {}) => ({
  player_id: id, season_label: '2025-26', competition: 'NBA', games_played: games, seconds_played: games * minutesPerGame * 60, starts,
  two_made: 0, two_attempted: 0, three_made: 0, three_attempted: 0, free_made: 0, free_attempted: 0, rebounds: 0, assists: 0, points, ...extra,
});

describe('NBA impact score', () => {
  it('bends the top: the line up to the bend, then ever smaller steps that stay below the asymptote', () => {
    const { centre, spread, bend, top } = NBA_IMPACT_RULES;
    expect(impactOverall(0)).toBe(centre);
    expect(impactOverall((bend - centre) / spread)).toBeCloseTo(bend, 10);
    const steps = [1.5, 2, 2.5, 3, 4].map(score => impactOverall(score));
    for (let index = 1; index < steps.length; index += 1) expect(steps[index]).toBeGreaterThan(steps[index - 1]);
    expect(steps[4] - steps[3]).toBeLessThan(steps[1] - steps[0]);
    expect(impactOverall(20)).toBeLessThan(top);
  });

  it('counts per-game production, minutes and starts, pulled towards a fringe player for few games', () => {
    const totals = nbaImpactTotals([
      row('star', 70, 35, 70, 2100, { two_made: 500, two_attempted: 1000, three_made: 150, three_attempted: 400, free_made: 400, free_attempted: 450, rebounds: 400, assists: 500 }),
      row('bench', 70, 18, 3, 560, { three_made: 120, three_attempted: 280, two_made: 40, two_attempted: 80 }),
      row('cameo', 3, 30, 3, 90),
      { ...row('europe-only', 10, 20, 0, 100), competition: 'EuroLeague' },
    ]);
    const star = totals.get('star'), bench = totals.get('bench'), cameo = totals.get('cameo');
    expect(star.production).toBeGreaterThan(2 * bench.production);
    expect(star.minutesPerGame).toBeGreaterThan(bench.minutesPerGame);
    expect(star.startShare).toBeGreaterThan(0.7);
    expect(bench.startShare).toBeLessThan(0.05);
    // Three games at 30 points are not a star's season.
    expect(cameo.production).toBeLessThan(10);
    expect(totals.has('europe-only')).toBe(false);
  });
});

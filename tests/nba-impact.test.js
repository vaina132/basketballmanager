import { describe, expect, it } from 'vitest';
import { NBA_IMPACT_RULES, impactOverall, nbaAdjustedPlusMinus, nbaImpactTotals } from '../scripts/real-data-nba-ratings.mjs';

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

  it('finds the players behind the margins (adjusted plus-minus, 24 November 2026)', () => {
    // Two clubs of six; the "anchor" on team 1 and the "drag" on team 2 change results by about ten points when they
    // play; everyone else is average. Random minutes give each player a different share in each game.
    let state = 7;
    const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
    const team = (id, names) => names.map(name => ({ id: `${id}-${name}`, team: id }));
    const clubs = [team(1, ['anchor', 'a', 'b', 'c', 'd', 'e']), team(2, ['drag', 'f', 'g', 'h', 'i', 'j'])];
    const value = { '1-anchor': 10, '2-drag': -10 };
    const games = [];
    for (let index = 0; index < 400; index += 1) {
      const [home, away] = index % 2 ? clubs : [clubs[1], clubs[0]];
      const lines = [...home, ...away].map(player => [player.id, player.team, Math.round(600 + random() * 1800)]);
      const share = (side, id) => { const own = lines.filter(line => line[1] === side[0].team); return 5 * lines.find(line => line[0] === id)[2] / own.reduce((sum, line) => sum + line[2], 0); };
      const margin = 2 + Object.entries(value).reduce((sum, [id, points]) => sum + (home.some(player => player.id === id) ? 1 : -1) * share(home.some(player => player.id === id) ? home : away, id) * points, 0) + (random() - .5) * 8;
      games.push(['2025-26', home[0].team, away[0].team, 100 + Math.round(margin), 100, lines]);
    }
    const { homeEdge, players } = nbaAdjustedPlusMinus(games, { plusMinus: { lambda: 5 } });
    expect(homeEdge).toBeGreaterThan(1);
    expect(players.get('1-anchor').value).toBeGreaterThan(4);
    expect(players.get('2-drag').value).toBeLessThan(-4);
    const others = [...players].filter(([id]) => !(id in value)).map(([, player]) => Math.abs(player.value));
    expect(Math.max(...others)).toBeLessThan(players.get('1-anchor').value);
    expect(NBA_IMPACT_RULES.weights.plusMinus).toBeGreaterThan(0);
  });
});

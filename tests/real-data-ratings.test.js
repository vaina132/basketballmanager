import { describe, expect, it } from 'vitest';
import { computeRatings, leagueFactor, RATING_RULES, trustedFreeThrowSeasons } from '../scripts/real-data-ratings.mjs';

// Synthetic season totals in the shape of player_season_totals (no database needed).
function row(player, overrides = {}) {
  return {
    player_id: player, season_label: '2026-27', competition: 'League', kind: 'domestic', games_played: 20, club_games: 20, seconds_played: 20 * 25 * 60,
    two_made: 60, two_attempted: 110, three_made: 30, three_attempted: 85, free_made: 40, free_attempted: 52, free_made_checked: 40, free_attempted_checked: 52,
    rebounds: 80, assists: 50, points: 300, ...overrides,
  };
}
const positions = ['Guard', 'Forward', 'Center'];
const players = Array.from({ length: 30 }, (_, index) => ({ id: `p${index}`, full_name: `Player ${index}`, position: positions[index % 3], age_observed: 25 + (index % 12) }));
const rows = players.map((player, index) => row(player.id, {
  two_made: 50 + index * 2, three_made: index % 3 === 2 ? 2 : 25 + index, three_attempted: index % 3 === 2 ? 8 : 85,
  rebounds: index % 3 === 2 ? 180 + index : 60 + index, assists: index % 3 === 0 ? 110 + index : 30 + index,
}));

describe('real-data ratings', () => {
  it('keeps every ability on the game\'s 1-20 scale and names the estimates', () => {
    const ratings = computeRatings(rows, players, 0.9);
    expect(ratings).toHaveLength(30);
    for (const rating of ratings) {
      for (const key of ['two_point', 'three_point', 'free_throw', 'passing', 'defense', 'rebounding', 'stamina']) expect(rating[key]).toBeGreaterThanOrEqual(1), expect(rating[key]).toBeLessThanOrEqual(20);
      expect(rating.estimated).toEqual(expect.arrayContaining(['defense', 'height_cm', 'weight_kg']));
      expect(RATING_RULES.build[rating.game_position]).toEqual([rating.height_cm, rating.weight_kg]);
    }
  });

  it('keeps positional differences: centres rebound more, guards pass more, and get the matching game positions', () => {
    const ratings = computeRatings(rows, players, 0.9), by = id => ratings.find(rating => rating.player_id === id);
    const average = (group, key) => ratings.filter((_, index) => index % 3 === group).reduce((sum, rating) => sum + rating[key], 0) / 10;
    expect(average(2, 'rebounding')).toBeGreaterThan(average(0, 'rebounding'));
    expect(average(0, 'passing')).toBeGreaterThan(average(2, 'passing'));
    expect(by('p2').game_position).toBe('C');
    expect(['PG', 'SG']).toContain(by('p0').game_position);
  });

  it('rates players with very few minutes from their position and marks every ability as estimated', () => {
    const fringe = computeRatings([...rows, row('rookie', { seconds_played: 30 * 60, games_played: 3 })], [...players, { id: 'rookie', full_name: 'Rookie', position: 'Guard', age_observed: 19 }], 0.9).find(rating => rating.player_id === 'rookie');
    expect(fringe.estimated).toEqual(expect.arrayContaining(['two_point', 'three_point', 'passing', 'rebounding', 'stamina']));
  });

  it('ignores a competition season whose free throws are implausible', () => {
    const broken = rows.map(item => ({ ...item, competition: 'Cup', free_made_checked: 50, free_attempted_checked: 52 }));
    expect(trustedFreeThrowSeasons(broken).get('Cup 2026-27')).toEqual({ rate: 0.962, trusted: false });
    expect(trustedFreeThrowSeasons(rows).get('League 2026-27').trusted).toBe(true);
    expect(computeRatings(broken, players, 0.9).every(rating => rating.estimated.includes('free_throw'))).toBe(true);
  });

  it('measures domestic strength from players in both competitions, within its allowed range', () => {
    const both = players.slice(0, 6).flatMap(player => [row(player.id, { points: 400 }), row(player.id, { kind: 'european', competition: 'Europe', points: 340 })]);
    expect(leagueFactor(both)).toEqual({ factor: 0.85, players: 6, measured: true });
    expect(leagueFactor(rows)).toEqual({ factor: RATING_RULES.defaultDomesticFactor, players: 0, measured: false });
  });
});

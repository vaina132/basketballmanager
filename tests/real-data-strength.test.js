import { describe, expect, it } from 'vitest';
import { STRENGTH_RULES, computeRatings, competitionLevels, neutralLines, seasonLines, strengthRatings, teamStrengths, trustedFreeThrowSeasons } from '../scripts/real-data-ratings.mjs';

// A small synthetic league: four clubs, a double round robin, club A strong and club D weak (rating-5, STRENGTH_RULES).
const clubs = ['A', 'B', 'C', 'D'];
const quality = { A: 10, B: 2, C: -2, D: -10 };
const seasons = new Map([['s1', { label: '2025-26', competition: 'League', kind: 'domestic' }]]);
const games = [];
for (const home of clubs) for (const away of clubs) {
  if (home === away) continue;
  for (let leg = 0; leg < 3; leg += 1) games.push({ id: `${home}-${away}-${leg}`, season_id: 's1', home_club_id: home, away_club_id: away, home_score: 80 + quality[home] + 2 + leg, away_score: 80 + quality[away] + leg, stats_rows: 10 });
}
const positions = ['Guard', 'Forward', 'Center'];
const players = Array.from({ length: 24 }, (_, index) => ({ id: `p${index}`, full_name: `Player ${index}`, position: positions[index % 3], age_observed: 26 }));
const clubOf = index => clubs[index % 4];
// Every player has the same line in every game: 25 minutes, 4/8 twos, 1/3 threes, 2/3 free throws, 5 rebounds, 3 assists.
const stats = games.flatMap(game => players.filter((_, index) => [game.home_club_id, game.away_club_id].includes(clubOf(index))).map((player, index) => ({
  game_id: game.id, player_id: player.id, club_id: clubOf(Number(player.id.slice(1))), seconds_played: 1500, two_made: 4, two_attempted: 8, three_made: 1, three_attempted: 3,
  free_made: 2, free_attempted: 3, rebounds: 5 + (index % 3), assists: 3, points: 13,
})));
const competitions = [{ name: 'League', kind: 'domestic', tier: 1 }];

describe('rating-5: team and opposition strength', () => {
  it('sums box scores into season lines exactly as the view player_season_totals does, with the club kept', () => {
    const extra = [
      { game_id: 'A-B-0', player_id: 'x', club_id: 'A', seconds_played: 0, two_made: 0, two_attempted: 0, three_made: 0, three_attempted: 0, free_made: 0, free_attempted: 0, rebounds: 0, assists: 0, points: 0 },
      { game_id: 'A-C-0', player_id: 'x', club_id: 'A', seconds_played: 600, two_made: 3, two_attempted: 2, three_made: 1, three_attempted: 2, free_made: 1, free_attempted: 1, rebounds: 2, assists: 1, points: 10 },
      { game_id: 'A-D-0', player_id: 'x', club_id: 'A', seconds_played: 600, two_made: 1, two_attempted: 2, three_made: null, three_attempted: 1, free_made: 2, free_attempted: 2, rebounds: null, assists: 0, points: 4 },
    ];
    const [line] = seasonLines(extra, games, seasons);
    expect(line).toMatchObject({
      player_id: 'x', club_id: 'A', season_label: '2025-26', competition: 'League', kind: 'domestic', games_played: 2, seconds_played: 1200, club_games: 18,
      two_made: 4, two_attempted: 4, two_made_valid: 1, two_attempted_valid: 2, three_made: 1, three_attempted: 3, three_made_valid: 1, three_attempted_valid: 3,
      free_made_checked: 1, free_attempted_checked: 1, rebounds: 2, lines: 3, lines_consistent: 2,
    });
  });

  it('measures club strength from margins, opponent- and home-adjusted, centred and pulled towards the average', () => {
    const strengths = teamStrengths(games);
    const of = club => strengths.get(`s1|${club}`);
    expect(of('A').strength).toBeGreaterThan(of('B').strength);
    expect(of('C').strength).toBeGreaterThan(of('D').strength);
    expect(clubs.reduce((total, club) => total + of(club).strength, 0)).toBeCloseTo(0, 6);
    // 18 games each with a prior of six: the true 20-point gap between A and D shrinks a little.
    expect(of('A').strength - of('D').strength).toBeGreaterThan(15);
    expect(of('A').strength - of('D').strength).toBeLessThan(20);
    // A weak club meets stronger opposition on average (it never plays itself).
    expect(of('D').schedule).toBeGreaterThan(0);
    expect(of('A').schedule).toBeLessThan(0);
    expect(of('A').games).toBe(18);
    expect(Math.abs(of('A').strength)).toBeLessThanOrEqual(STRENGTH_RULES.limit);
  });

  it('puts a weak club\'s lines in a neutral setting: fewer attempts and minutes per game, same per-40 minutes and availability', () => {
    const lines = seasonLines(stats, games, seasons), strengths = teamStrengths(games);
    const neutral = neutralLines(lines, strengths);
    const weak = neutral.find(line => line.club_id === 'D'), weakBefore = lines.find(line => line.player_id === weak.player_id);
    const strong = neutral.find(line => line.club_id === 'A'), strongBefore = lines.find(line => line.player_id === strong.player_id);
    expect(weak.two_attempted_valid).toBeLessThan(weakBefore.two_attempted_valid);
    expect(weak.games_played).toBeGreaterThan(weakBefore.games_played);
    expect(weak.seconds_played / weak.games_played).toBeLessThan(weakBefore.seconds_played / weakBefore.games_played);
    expect(weak.games_played / weak.club_games).toBeCloseTo(weakBefore.games_played / weakBefore.club_games, 9);
    expect(weak.seconds_played).toBe(weakBefore.seconds_played);
    expect(strong.two_attempted_valid).toBeGreaterThan(strongBefore.two_attempted_valid);
    expect(strong.seconds_played / strong.games_played).toBeGreaterThan(strongBefore.seconds_played / strongBefore.games_played);
    expect(weak.strength.team).toBeLessThan(0);
    // No strength for the line: unchanged.
    expect(neutralLines(lines, new Map())).toEqual(lines);
  });

  it('with both weights at zero changes nothing, and otherwise lowers the weak club\'s players against the strong club\'s', () => {
    const lines = seasonLines(stats, games, seasons), strengths = teamStrengths(games);
    const off = strengthRatings(lines, players, competitions, strengths, { ...STRENGTH_RULES, teamWeight: 0, opponentWeight: 0 });
    for (const delta of off.deltas.values()) for (const value of Object.values(delta)) expect(value).toBe(0);
    // rating-3 inside strengthRatings is rating-3 as computed on its own.
    const levels = competitionLevels(lines, competitions);
    const plain = computeRatings(lines, players, levels, trustedFreeThrowSeasons(lines), { competitions });
    for (const rating of plain) { const again = off.base.find(item => item.player_id === rating.player_id); for (const key of ['two_point', 'three_point', 'passing', 'defense', 'rebounding', 'stamina']) expect(again[key]).toBe(rating[key]); }
    const on = strengthRatings(lines, players, competitions, strengths);
    const total = id => Object.values(on.deltas.get(id)).reduce((sum, value) => sum + value, 0);
    const byClub = club => players.filter((_, index) => clubOf(index) === club).map(player => total(player.id));
    const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(average(byClub('D'))).toBeLessThan(0);
    expect(average(byClub('A'))).toBeGreaterThan(0);
    expect(on.contexts.get('p3').team).toBeLessThan(0);
    for (const delta of on.deltas.values()) expect(Math.abs(delta.free_throw)).toBe(0);
  });
});

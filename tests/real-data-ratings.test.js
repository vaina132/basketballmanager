import { describe, expect, it } from 'vitest';
import { competitionLevels, computeRatings, leagueGap, RATING_RULES, ratingOverall, trustedFreeThrowSeasons } from '../scripts/real-data-ratings.mjs';

const GAP = { volume: { twoAttempts: 0.85, threeAttempts: 0.85, rebounds: 0.85, assists: 0.85, minutesPerGame: 0.95 }, shooting: { two: 0.02, three: 0.01 }, players: 6, measured: true };

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
    const ratings = computeRatings(rows, players, GAP);
    expect(ratings).toHaveLength(30);
    for (const rating of ratings) {
      for (const key of ['two_point', 'three_point', 'free_throw', 'passing', 'defense', 'rebounding', 'stamina']) expect(rating[key]).toBeGreaterThanOrEqual(1), expect(rating[key]).toBeLessThanOrEqual(20);
      expect(rating.estimated).toEqual(expect.arrayContaining(['defense', 'height_cm', 'weight_kg']));
      expect(RATING_RULES.build[rating.game_position]).toEqual([rating.height_cm, rating.weight_kg]);
    }
  });

  it('keeps positional differences: centres rebound more, guards pass more, and get the matching game positions', () => {
    const ratings = computeRatings(rows, players, GAP), by = id => ratings.find(rating => rating.player_id === id);
    const average = (group, key) => ratings.filter((_, index) => index % 3 === group).reduce((sum, rating) => sum + rating[key], 0) / 10;
    expect(average(2, 'rebounding')).toBeGreaterThan(average(0, 'rebounding'));
    expect(average(0, 'passing')).toBeGreaterThan(average(2, 'passing'));
    expect(by('p2').game_position).toBe('C');
    expect(['PG', 'SG']).toContain(by('p0').game_position);
  });

  it('rates players with very few minutes from their position and marks every ability as estimated', () => {
    const fringe = computeRatings([...rows, row('rookie', { seconds_played: 30 * 60, games_played: 3 })], [...players, { id: 'rookie', full_name: 'Rookie', position: 'Guard', age_observed: 19 }], GAP).find(rating => rating.player_id === 'rookie');
    expect(fringe.estimated).toEqual(expect.arrayContaining(['two_point', 'three_point', 'passing', 'rebounding', 'stamina']));
  });

  it('ignores a competition season whose free throws are implausible', () => {
    const broken = rows.map(item => ({ ...item, competition: 'Cup', free_made_checked: 50, free_attempted_checked: 52 }));
    expect(trustedFreeThrowSeasons(broken).get('Cup 2026-27')).toEqual({ rate: 0.962, trusted: false });
    expect(trustedFreeThrowSeasons(rows).get('League 2026-27').trusted).toBe(true);
    expect(computeRatings(broken, players, GAP).every(rating => rating.estimated.includes('free_throw'))).toBe(true);
  });

  it('measures the domestic-to-European conversion statistic by statistic from players in both competitions', () => {
    const both = players.slice(0, 6).flatMap(player => [row(player.id), row(player.id, { kind: 'european', competition: 'Europe', two_made: 55, rebounds: 68, assists: 45 })]);
    expect(leagueGap(both)).toEqual({ volume: { twoAttempts: 1, threeAttempts: 1, rebounds: 0.85, assists: 0.9, minutesPerGame: 1 }, shooting: { two: 0.045, three: 0 }, players: 6, measured: true });
    // Bounded: a much weaker showing in Europe still counts as at most a 25% drop, and shooting at most 5 points.
    const extreme = players.slice(0, 6).flatMap(player => [row(player.id), row(player.id, { kind: 'european', competition: 'Europe', two_made: 30, rebounds: 20 })]);
    expect(leagueGap(extreme)).toMatchObject({ volume: { rebounds: 0.75 }, shooting: { two: 0.05 } });
    expect(leagueGap(rows)).toEqual({ ...RATING_RULES.defaultLeagueGap, players: 0, measured: false });
  });

  it('rates the same statistics lower in the domestic league than in the European competition', () => {
    const line = { two_made: 70, three_made: 32, rebounds: 120, assists: 60 };
    const pair = [...rows, row('home', line), row('away', { ...line, kind: 'european', competition: 'Europe' })];
    const rated = computeRatings(pair, [...players, { id: 'home', full_name: 'Home', position: 'Forward', age_observed: 27 }, { id: 'away', full_name: 'Away', position: 'Forward', age_observed: 27 }], GAP);
    const home = rated.find(rating => rating.player_id === 'home'), away = rated.find(rating => rating.player_id === 'away');
    expect(ratingOverall(away)).toBeGreaterThan(ratingOverall(home));
    for (const key of ['two_point', 'rebounding', 'passing']) expect(away[key]).toBeGreaterThanOrEqual(home[key]);
    expect(home.method).toMatchObject({ rules: 'rating-3', mainCompetition: 'League', conversion: { League: { volume: GAP.volume, shooting: GAP.shooting } } });
  });

  it('does not give a handful of full games top minutes, stamina or defence', () => {
    // The same production per minute; only the number of games differs.
    const season = (id, games) => { const share = games * 28 / 500, base = row(id); return row(id, { games_played: games, club_games: games, seconds_played: games * 28 * 60, ...Object.fromEntries(['two_made', 'two_attempted', 'three_made', 'three_attempted', 'free_made', 'free_attempted', 'free_made_checked', 'free_attempted_checked', 'rebounds', 'assists', 'points'].map(key => [key, Math.round(base[key] * share)])) }); };
    const steady = season('steady', 30), hot = season('hot', 8);
    // A realistic spread of minutes: 20 to 29 a game.
    const varied = rows.map((item, index) => ({ ...item, seconds_played: 20 * (20 + index % 10) * 60 }));
    const rated = computeRatings([...varied, steady, hot], [...players, { id: 'steady', full_name: 'Steady', position: 'Center', age_observed: 27 }, { id: 'hot', full_name: 'Hot', position: 'Center', age_observed: 27 }], GAP);
    const by = id => rated.find(rating => rating.player_id === id);
    expect(by('hot').stamina).toBeLessThan(by('steady').stamina);
    expect(by('hot').defense).toBeLessThanOrEqual(by('steady').defense);
    expect(by('hot').method.weightedGames).toBe(8);
  });

  describe('rating-3: every competition converted to the reference level', () => {
    const COMPETITIONS = [
      { name: 'EuroLeague', kind: 'european', tier: 1 }, { name: 'Top', kind: 'domestic', tier: 1 },
      { name: 'Second', kind: 'domestic', tier: 2 }, { name: 'Quiet', kind: 'domestic', tier: 1 },
    ];
    // Twenty players play the top league and the EuroLeague in one season, rebounding a quarter less in Europe;
    // twenty others moved from the second division to the top league, rebounding a fifth less after the move.
    const european = Array.from({ length: 20 }, (_, index) => [row(`e${index}`, { competition: 'Top' }), row(`e${index}`, { competition: 'EuroLeague', kind: 'european', rebounds: 60 })]).flat();
    const movers = Array.from({ length: 20 }, (_, index) => [row(`m${index}`, { competition: 'Second', season_label: '2025-26', rebounds: 100 }), row(`m${index}`, { competition: 'Top' })]).flat();

    it('measures leagues linked directly, chains a league linked only through another, and keeps defaults without links', () => {
      const levels = competitionLevels([...european, ...movers], COMPETITIONS);
      expect(levels.get('EuroLeague')).toMatchObject({ volume: { rebounds: 1, twoAttempts: 1 }, shooting: { two: 0, three: 0 } });
      const top = levels.get('Top'), second = levels.get('Second'), quiet = levels.get('Quiet');
      // Measured: 20 x 500 minutes of links outweigh the default's 1,500 minutes.
      expect(top.volume.rebounds).toBeGreaterThan(0.75); expect(top.volume.rebounds).toBeLessThan(0.8);
      expect(top.volume.twoAttempts).toBeGreaterThan(0.93);
      expect(top).toMatchObject({ measured: true, players: 40 });
      // The second division reaches the EuroLeague only through the top league, and sits below it.
      expect(second.measured).toBe(true);
      expect(second.volume.rebounds).toBeLessThan(top.volume.rebounds); expect(second.volume.rebounds).toBeLessThan(0.7);
      expect(second.volume.rebounds).toBeGreaterThanOrEqual(RATING_RULES.levels.volumeRange[0]);
      // No player links the quiet league: it keeps the default for a top division.
      expect(quiet).toMatchObject({ volume: { twoAttempts: 0.85, rebounds: 0.85, minutesPerGame: 1 }, shooting: { two: 0.02, three: 0.01 }, players: 0, measured: false });
    });

    it('rates the same production lower in a second division, and lets only top divisions and the reference set the scale', () => {
      const levels = competitionLevels([...european, ...movers], COMPETITIONS);
      const line = { two_made: 70, three_made: 32, rebounds: 120, assists: 60 };
      // The varied synthetic population plays the top league and sets the scale.
      const both = [...rows.map(item => ({ ...item, competition: 'Top' })), row('top', { ...line, competition: 'Top' }), row('second', { ...line, competition: 'Second' })];
      const profiles = [...players, { id: 'top', full_name: 'Top', position: 'Forward', age_observed: 27 }, { id: 'second', full_name: 'Second', position: 'Forward', age_observed: 27 }];
      const rated = computeRatings(both, profiles, levels, undefined, { competitions: COMPETITIONS });
      const top = rated.find(rating => rating.player_id === 'top'), second = rated.find(rating => rating.player_id === 'second');
      expect(ratingOverall(top)).toBeGreaterThan(ratingOverall(second));
      expect(second.method).toMatchObject({ rules: 'rating-3', mainCompetition: 'Second', conversion: { Second: { volume: levels.get('Second').volume } } });
      // A crowd of strong-looking second-division players does not move the top league's scale.
      const crowd = Array.from({ length: 30 }, (_, index) => row(`c${index}`, { competition: 'Second', two_made: 90, rebounds: 200 }));
      const crowdProfiles = crowd.map(item => ({ id: item.player_id, full_name: item.player_id, position: 'Forward', age_observed: 27 }));
      const withCrowd = computeRatings([...both, ...crowd], [...profiles, ...crowdProfiles], levels, undefined, { competitions: COMPETITIONS });
      expect(withCrowd.find(rating => rating.player_id === 'top')).toMatchObject({ two_point: top.two_point, rebounding: top.rebounding });
    });
  });

  it('reports the game\'s own overall rating for a stored rating row', () => {
    const flat = { two_point: 12, three_point: 12, free_throw: 12, passing: 12, defense: 12, rebounding: 12, stamina: 12 };
    expect(ratingOverall({ ...flat, game_position: 'C' })).toBe(60);
    expect(ratingOverall({ ...flat, rebounding: 18, game_position: 'C' })).toBeGreaterThan(ratingOverall({ ...flat, rebounding: 18, game_position: 'PG' }));
  });
});

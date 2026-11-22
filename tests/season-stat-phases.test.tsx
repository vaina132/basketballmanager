import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FixtureResult, SeasonFixture, SeasonState } from '../src/domain/season';
import type { PlayerStats } from '../src/domain/types';
import { getSeasonPerformance } from '../src/world/performance';
import { createSeason } from '../src/world/season';
import { rosterForRound } from '../src/world/rosters';
import { canSplitPhases, hasPhaseGames, inStatPhase, inStatScope, phaseRows } from '../src/ui/season-stat-phases';
import { SeasonLeaders } from '../src/ui/SeasonLeaders';
import europe from '../src/ui/EuropeWorkspace.tsx?raw';
import seasonWorkspace from '../src/ui/SeasonWorkspace.tsx?raw';

function stats(change: Partial<PlayerStats> = {}): PlayerStats {
  const value: PlayerStats = { secondsPlayed: 0, points: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, threePointersMade: 0, threePointersAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0, condition: 100, ...change };
  value.points = 2 * value.fieldGoalsMade + value.threePointersMade + value.freeThrowsMade;
  return value;
}

/** Plays the first club's game of a round with every player scoring `made` field goals in 20 minutes, and labels the game. */
function play(state: SeasonState, round: number, made: number, label: Pick<SeasonFixture, 'stage' | 'competition'> = {}): SeasonState {
  const club = state.clubs[0]!;
  const fixture = state.fixtures.find(item => item.round === round && [item.homeClubId, item.awayClubId].includes(club.id))!;
  const home = state.clubs.find(team => team.id === fixture.homeClubId)!, away = state.clubs.find(team => team.id === fixture.awayClubId)!;
  const records = Object.fromEntries([...home.players, ...away.players].map(player => [player.id, stats({ secondsPlayed: 1200, fieldGoalsMade: made, fieldGoalsAttempted: made * 2 })]));
  const score = { home: home.players.length * made * 2, away: away.players.length * made * 2 + 1 };
  const result: FixtureResult = { score, officialScore: { ...score }, winnerClubId: away.id, kind: 'normal', periods: 4, stats: records, injuries: {}, rosterIds: { home: rosterForRound(state.rosters, home.id, round).id, away: rosterForRound(state.rosters, away.id, round).id } };
  return { ...state, fixtures: state.fixtures.map(item => item.id === fixture.id ? { ...item, ...label, result } : item) };
}

// Owner suggestion (HANDOVER): regular-season and playoff player statistics shown apart on Competitions.
describe('regular season and playoff statistics', () => {
  const base = createSeason({ seed: 31, injuryMode: 'off' });
  // Round 1 regular season (1 basket each), round 2 a playoff final (3), round 3 a European regular-season game (5),
  // round 4 a European final (7) and round 5 a European qualifier (11).
  let season = play(base, 1, 1);
  season = play(season, 2, 3, { stage: 'final' });
  season = play(season, 3, 5, { competition: 'euroleague' });
  season = play(season, 4, 7, { competition: 'euroleague', stage: 'final' });
  season = play(season, 5, 11, { competition: 'euroleague', stage: 'qualifying' });
  const all = getSeasonPerformance(season);
  const playerId = season.clubs[0]!.players[0]!.id;
  const points = (rows: ReturnType<typeof phaseRows>) => rows.find(row => row.player.id === playerId)!;

  it('sorts games into scope and phase: no stage is the regular season, every stage but qualifying is the playoffs', () => {
    expect(inStatScope({}, {})).toBe(true);
    expect(inStatScope({ competition: 'euroleague' }, {})).toBe(false);
    expect(inStatScope({ competition: 'euroleague' }, { competitionId: 'euroleague' })).toBe(true);
    expect(inStatPhase({}, 'regular')).toBe(true);
    expect(inStatPhase({ stage: 'semi-final' }, 'playoffs')).toBe(true);
    expect(inStatPhase({ stage: 'play-out' }, 'playoffs')).toBe(true);
    expect(inStatPhase({ stage: 'qualifying' }, 'playoffs')).toBe(false);
    expect(inStatPhase({ stage: 'qualifying' }, 'regular')).toBe(false);
    expect(inStatPhase({ stage: 'qualifying' }, null)).toBe(true);
  });

  it('rebuilds each player\'s appearances, totals, game log and club games from the games of one phase', () => {
    const combined = points(all);
    expect(combined.games).toBe(5);
    expect(combined.totals.points).toBe(2 * (1 + 3 + 5 + 7 + 11));
    const regular = points(phaseRows(season, season.seasonNumber, all, {}, 'regular'));
    expect(regular).toMatchObject({ games: 1, clubGames: 1, totals: expect.objectContaining({ points: 2, fieldGoalsMade: 1, secondsPlayed: 1200 }) });
    expect(regular.log.map(game => game.round)).toEqual([1]);
    const playoffs = points(phaseRows(season, season.seasonNumber, all, {}, 'playoffs'));
    expect(playoffs).toMatchObject({ games: 1, clubGames: 1, totals: expect.objectContaining({ points: 6 }) });
    const europeRegular = points(phaseRows(season, season.seasonNumber, all, { competitionId: 'euroleague' }, 'regular'));
    expect(europeRegular.totals.points).toBe(10);
    const europePlayoffs = points(phaseRows(season, season.seasonNumber, all, { competitionId: 'euroleague' }, 'playoffs'));
    expect(europePlayoffs.totals.points).toBe(14);
    // Without the toggle a European table covers all of the competition's games, qualifiers included.
    expect(points(phaseRows(season, season.seasonNumber, all, { competitionId: 'euroleague' }, null)).totals.points).toBe(2 * (5 + 7 + 11));
    // Players without a game of the phase are left out; the source rows are unchanged.
    const inRoundOne = all.filter(row => row.log.some(game => game.round === 1)).length;
    expect(inRoundOne).toBeLessThan(all.length);
    expect(phaseRows(season, season.seasonNumber, all, {}, 'regular')).toHaveLength(inRoundOne);
    expect(points(all).totals.points).toBe(combined.totals.points);
  });

  it('knows when a season can be split and when a phase has games', () => {
    expect(canSplitPhases(season, season.seasonNumber)).toBe(true);
    expect(hasPhaseGames(season, season.seasonNumber, { competitionId: 'euroleague' }, 'playoffs')).toBe(true);
    expect(hasPhaseGames(base, base.seasonNumber, { competitionId: 'euroleague' }, 'playoffs')).toBe(false);
    expect(hasPhaseGames(base, base.seasonNumber, {}, 'regular')).toBe(true);
  });

  it('shows a "Regular season | Playoffs" toggle on League for a league with playoffs, opening on the regular season', () => {
    const html = renderToStaticMarkup(<SeasonLeaders season={season} seasonNumber={season.seasonNumber} phases />);
    expect(html).toContain('role="group" aria-label="Season phase"');
    expect(html).toMatch(/data-stat-phase="regular" aria-pressed="true"[^>]*>Regular season</);
    expect(html).toMatch(/data-stat-phase="playoffs" aria-pressed="false"[^>]*>Playoffs</);
    expect(html).toContain('League player statistics, regular season');
    // The regular season counts only league games before the playoffs: one appearance each.
    expect(html).not.toContain('No recorded matchdays yet');
    // A league without playoffs keeps one table of all its clubs' games, without the toggle.
    const plain = renderToStaticMarkup(<SeasonLeaders season={season} seasonNumber={season.seasonNumber} />);
    expect(plain).not.toContain('data-stat-phase');
    expect(plain).toContain('aria-label="League player statistics"');
    expect(seasonWorkspace).toContain('phases={!!league?.postseason}');
  });

  it('gives International a statistics table of the competition shown, split where it has knockout games', () => {
    const html = renderToStaticMarkup(<SeasonLeaders season={season} seasonNumber={season.seasonNumber} competitionId="euroleague" title="EuroLeague player statistics" scopeNote="Only clubs from the countries in your career keep player statistics." />);
    expect(html).toContain('>EuroLeague player statistics</h2>');
    expect(html).toContain('data-stat-phase="playoffs"');
    expect(html).toContain('data-stats-scope-note');
    expect(html).toContain('Regular season: the regular-season games of this competition.');
    // No knockout game in the season: one table of the competition's games.
    const early = play(base, 3, 5, { competition: 'euroleague' });
    const single = renderToStaticMarkup(<SeasonLeaders season={early} seasonNumber={early.seasonNumber} competitionId="euroleague" title="EuroLeague player statistics" />);
    expect(single).not.toContain('data-stat-phase');
    expect(single).toContain('Only games of this competition count.');
    expect(europe).toContain('competitionId={entry.competition.id} title={`${entry.competition.name} player statistics`}');
  });
});

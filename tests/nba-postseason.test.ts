import { describe, expect, it } from 'vitest';
import { derivePostseason, POSTSEASON_FORMATS, postseasonFormatAllowed, postseasonFormatFor, postseasonOutcome, postseasonPlacesNeeded } from '../src/world/postseason';
import { nbaPostseasonSlotDay, nbaSeasonDates } from '../src/world/nba-schedule';
import { calendarDaysBetween } from '../src/world/competition-calendar';

const format = POSTSEASON_FORMATS['nba-2026-1'];
const east = Array.from({ length: 15 }, (_, index) => `e${index + 1}`), west = Array.from({ length: 15 }, (_, index) => `w${index + 1}`);
// League order: w1 has the best record, then e1, then the rest alternating.
const league = east.flatMap((club, index) => index === 0 ? ['w1', 'e1'] : [west[index]!, club]);
type Played = { id: string; homeClubId: string; awayClubId: string; result: { winnerClubId: string } | null };

/** Plays every due game until the postseason is decided, the club `winner(home, away)` names winning each game. */
function play(winner: (home: string, away: string, seriesId: string) => string) {
  const fixtures: Played[] = [];
  for (let guard = 0; guard < 200; guard += 1) {
    const derived = derivePostseason({ leagueId: 'nba', format, seasonNumber: 1, order: league, groupOrders: { east, west }, slotDay: slot => nbaPostseasonSlotDay(1, slot), fixtures });
    const due = derived.fixtures.filter(fixture => !fixtures.some(played => played.id === fixture.id));
    if (!due.length) return { ...derived, fixtures: derived.fixtures, outcome: postseasonOutcome(format, league, derived.series) };
    for (const fixture of due) fixtures.push({ id: fixture.id, homeClubId: fixture.homeClubId, awayClubId: fixture.awayClubId, result: { winnerClubId: winner(fixture.homeClubId, fixture.awayClubId, fixture.seriesId) } });
  }
  throw new Error('The postseason did not finish.');
}
const seedOf = (club: string) => Number(club.slice(1));
/** Games already played per series in the long-series case. */
const gamesSoFar: string[] = [];

describe('NBA postseason (nba-2026-1)', () => {
  it('is the USA\'s format: play-in and four best-of-seven rounds, no promotion or relegation', () => {
    expect(postseasonFormatFor('USA', 1)).toBe('nba-2026-1');
    expect(postseasonFormatAllowed('nba-2026-1', 'USA', 1, 30)).toBe(true);
    expect(postseasonFormatAllowed('nba-2026-1', 'Spain', 1, 30)).toBe(false);
    expect(postseasonPlacesNeeded(format)).toBe(20);
    expect(format.promoted).toEqual([]);
    expect(format.relegated).toEqual([]);
    expect(format.series.filter(spec => spec.stage !== 'play-in').every(spec => spec.bestOf === 7)).toBe(true);
  });

  it('seeds each conference\'s play-in and bracket, with the better seed at home 2-2-1-1-1', () => {
    // The better seed always wins.
    const done = play((home, away) => (league.indexOf(home) < league.indexOf(away) ? home : away));
    const series = new Map(done.series.map(entry => [entry.id, entry]));
    const pair = (seriesId: string) => [series.get(seriesId)!.higher!.clubId, series.get(seriesId)!.lower!.clubId];
    expect(pair('east-pi-a')).toEqual(['e7', 'e8']);
    expect(pair('east-pi-b')).toEqual(['e9', 'e10']);
    expect(pair('east-pi-c')).toEqual(['e8', 'e9']);
    expect(pair('east-r1-a')).toEqual(['e1', 'e8']);
    expect(series.get('east-r1-a')!.lower!.rank).toBe(8);
    expect(pair('east-r1-b')).toEqual(['e4', 'e5']);
    expect(pair('east-r1-c')).toEqual(['e2', 'e7']);
    expect(pair('east-r1-d')).toEqual(['e3', 'e6']);
    expect(pair('east-sf-a')).toEqual(['e1', 'e4']);
    expect(pair('west-cf')).toEqual(['w1', 'w2']);
    // Home court in the Finals by league record: w1 is first in the league, e1 second.
    expect(pair('final')).toEqual(['w1', 'e1']);
    expect(done.outcome.champion).toBe('w1');
    expect(done.outcome.promoted).toEqual([]);
    const games = done.fixtures.filter(fixture => fixture.seriesId === 'east-r1-a');
    expect(games).toHaveLength(4);
    expect(games.map(fixture => fixture.homeClubId)).toEqual(['e1', 'e1', 'e8', 'e8']);
  });

  it('plays a long series to game seven, every second day from the Tuesday after the regular season', () => {
    // The lower seed wins games 3, 4 and 6 of every series: each best-of-seven goes the distance.
    const done = play((home, away, seriesId) => {
      const played = gamesSoFar.filter(id => id.startsWith(`${seriesId}|`)).length + 1;
      gamesSoFar.push(`${seriesId}|${played}`);
      const better = league.indexOf(home) < league.indexOf(away) ? home : away, worse = better === home ? away : home;
      return [3, 4, 6].includes(played) ? worse : better;
    });
    const finals = done.fixtures.filter(fixture => fixture.seriesId === 'final');
    expect(finals).toHaveLength(7);
    expect(finals.map(fixture => fixture.homeClubId)).toEqual(['w1', 'w1', 'e1', 'e1', 'w1', 'e1', 'w1']);
    const first = done.fixtures.find(fixture => fixture.seriesId === 'east-pi-a')!;
    expect(first.date).toBe('2027-04-13');
    expect(calendarDaysBetween(nbaSeasonDates(1).end, first.date)).toBe(2);
    expect(calendarDaysBetween(first.date, finals.at(-1)!.date)).toBe(2 * 29);
    for (const seriesId of ['east-r1-a', 'final']) {
      const dates = done.fixtures.filter(fixture => fixture.seriesId === seriesId).map(fixture => fixture.date);
      expect(dates.slice(1).every((date, index) => calendarDaysBetween(dates[index]!, date) === 2)).toBe(true);
    }
    expect(done.outcome.champion).toBe('w1');
    expect(seedOf(done.series.find(entry => entry.id === 'east-pi-c')!.winner!)).toBe(8);
  });
});

import { describe, expect, it } from 'vitest';
import { addCalendarDays, calendarDaysBetween } from '../src/world/competition-calendar';
import { derivePostseason, POSTSEASON_FORMATS, POSTSEASON_SLOT_OFFSETS, postseasonFormatFor, postseasonOutcome, postseasonSlots, postseasonWeeks, type PostseasonFormatId } from '../src/world/postseason';

// A league whose regular season ended in week 34 (Saturday 24 April 2027); clubs c1..cN finished in that order.
const LAST_REGULAR = '2027-04-24';
const slotDay = (slot: number) => {
  const week = Math.floor((slot - 1) / 3) + 1;
  return { round: 34 + week, date: addCalendarDays(LAST_REGULAR, week * 7 + POSTSEASON_SLOT_OFFSETS[(slot - 1) % 3]!) };
};
const clubs = (n: number) => Array.from({ length: n }, (_, index) => `c${index + 1}`);
type Game = { id: string; homeClubId: string; awayClubId: string; round: number; date: string; result: { winnerClubId: string } | null };

/** Plays the postseason to its end; `winner` decides each game (default: the home club). */
function playOut(id: PostseasonFormatId, size: number, winner: (game: Game) => string = game => game.homeClubId, otherOrder?: string[]) {
  const format = POSTSEASON_FORMATS[id], order = clubs(size), games = new Map<string, Game>();
  for (let guard = 0; guard < 200; guard += 1) {
    const derived = derivePostseason({ leagueId: 'lg', format, seasonNumber: 1, order, otherOrder, slotDay, fixtures: [...games.values()] });
    for (const fixture of derived.fixtures) if (!games.has(fixture.id)) games.set(fixture.id, { ...fixture, result: null });
    const open = [...games.values()].filter(game => !game.result).sort((a, b) => a.date.localeCompare(b.date));
    if (!open.length) return { format, order, games: [...games.values()], series: derived.series };
    // Play the earliest open game day, as the calendar does.
    for (const game of open.filter(game => game.date === open[0]!.date)) game.result = { winnerClubId: winner(game) };
  }
  throw new Error('The postseason did not finish.');
}

describe('domestic postseason formats (step 3.4b)', () => {
  it('reserve consecutive slots stage by stage, three a week, after every series a stage depends on', () => {
    const bbl = postseasonSlots(POSTSEASON_FORMATS['bbl-2026-1']);
    expect(Object.fromEntries(bbl)).toMatchObject({ 'pi-a': 1, 'pi-b': 1, 'pi-c': 2, 'qf-a': 3, 'qf-d': 3, 'sf-a': 8, final: 13 });
    expect(postseasonWeeks(POSTSEASON_FORMATS['bbl-2026-1'])).toBe(6);
    expect(postseasonWeeks(POSTSEASON_FORMATS['lnb-elite-2026-1'])).toBe(5);
    expect(postseasonWeeks(POSTSEASON_FORMATS['primera-feb-2026-1'])).toBe(3);
    // Serie A2's play-outs run in parallel with the play-in and the playoffs, never pushing them back.
    const a2 = postseasonSlots(POSTSEASON_FORMATS['serie-a2-2026-1']);
    expect(Object.fromEntries(a2)).toMatchObject({ 'pi-a': 1, 'pi-c': 2, 'qf-a': 3, 'po-a': 1, 'po-c': 6, final: 13 });
    expect(postseasonWeeks(POSTSEASON_FORMATS['serie-a2-2026-1'])).toBe(6);
  });

  it('create a game only when it is needed, home by the bracket seed, with a full rest day between a club\'s games', () => {
    const { games, series } = playOut('bbl-2026-1', 18);
    const byId = new Map(series.map(entry => [entry.id, entry]));
    // Home wins every game: play-in 7 and 8 advance; every best-of-five goes the distance (2-2-1).
    expect(byId.get('pi-a')).toMatchObject({ winner: 'c7', loser: 'c8' });
    expect(byId.get('pi-c')).toMatchObject({ higher: { clubId: 'c8', rank: 8 }, lower: { clubId: 'c9', rank: 9 }, winner: 'c8' });
    expect(byId.get('qf-a')).toMatchObject({ higher: { clubId: 'c1' }, lower: { clubId: 'c8', rank: 8 }, winner: 'c1', wins: { c1: 3, c8: 2 } });
    expect(byId.get('qf-a')!.fixtureIds).toHaveLength(5);
    expect(byId.get('final')).toMatchObject({ higher: { clubId: 'c1' }, lower: { clubId: 'c2' }, winner: 'c1' });
    const qfa = games.filter(game => game.id.includes('-qf-a-')).sort((a, b) => a.date.localeCompare(b.date));
    expect(qfa.map(game => game.homeClubId)).toEqual(['c1', 'c1', 'c8', 'c8', 'c1']);
    const dates = new Map<string, string[]>();
    for (const game of games) for (const club of [game.homeClubId, game.awayClubId]) dates.set(club, [...(dates.get(club) ?? []), game.date]);
    for (const list of dates.values()) list.sort().forEach((date, index) => { if (index) expect(calendarDaysBetween(list[index - 1]!, date)).toBeGreaterThanOrEqual(2); });
    expect(Math.max(...games.map(game => game.round))).toBe(34 + 6);
    expect(games.every(game => game.date > LAST_REGULAR)).toBe(true);
  });

  it('stop a series as soon as it is decided, so reserved games that are not needed never exist', () => {
    // The better seed wins every game: three-game sweeps in best-of-five series, two-game sweeps in best-of-three.
    const sweep = playOut('bsl-2026-1', 16, game => Number(game.homeClubId.slice(1)) < Number(game.awayClubId.slice(1)) ? game.homeClubId : game.awayClubId);
    const counts = Object.fromEntries(sweep.series.map(entry => [entry.id, entry.fixtureIds.length]));
    expect(counts).toEqual({ 'qf-a': 2, 'qf-b': 2, 'qf-c': 2, 'qf-d': 2, 'sf-a': 3, 'sf-b': 3, final: 3 });
    expect(postseasonOutcome(sweep.format, sweep.order, sweep.series)).toEqual({ champion: 'c1', promoted: [], relegated: [{ clubId: 'c15', unlessWinsLowerFinal: false }, { clubId: 'c16', unlessWinsLowerFinal: false }] });
  });

  it('seed the top division\'s 15th into the French second division\'s bracket as seed 5, with the official pairing', () => {
    const elite = clubs(16).map(id => `e-${id}`);
    const { series, format, order } = playOut('lnb-elite2-2026-1', 20, undefined, elite);
    const byId = new Map(series.map(entry => [entry.id, entry]));
    expect(byId.get('qf-d')).toMatchObject({ higher: { clubId: 'c5', rank: 4 }, lower: { clubId: 'e-c15', rank: 5 } });
    expect(byId.get('qf-b')).toMatchObject({ higher: { clubId: 'c4', rank: 3 }, lower: { clubId: 'c6', rank: 6 } });
    expect(byId.get('qf-a')).toMatchObject({ higher: { clubId: 'c2', rank: 1 }, lower: { rank: 8 } });
    expect(byId.get('sf-a')!.higher!.clubId).toBe('c2');
    expect(postseasonOutcome(format, order, series)).toMatchObject({ champion: 'c1', promoted: ['c1', 'c2'], relegated: [{ clubId: 'c19' }, { clubId: 'c20' }] });
    // Without the top division's order, seed 5 (and the series that depend on it) cannot start.
    const waiting = derivePostseason({ leagueId: 'lg', format, seasonNumber: 1, order: clubs(20), otherOrder: null, slotDay, fixtures: [] });
    expect(waiting.series.find(entry => entry.id === 'qf-d')).toMatchObject({ higher: null, fixtureIds: [] });
  });

  it('play Serie A2 play-outs alongside the promotion playoffs, relegating 20th and the play-out loser', () => {
    const { series, format, order } = playOut('serie-a2-2026-1', 20);
    const byId = new Map(series.map(entry => [entry.id, entry]));
    expect(byId.get('pi-c')).toMatchObject({ higher: { clubId: 'c9' }, lower: { clubId: 'c10' } });
    expect(byId.get('po-c')).toMatchObject({ higher: { clubId: 'c18' }, lower: { clubId: 'c19' }, loser: 'c19' });
    expect(postseasonOutcome(format, order, series)).toMatchObject({ champion: 'c1', promoted: ['c1', 'c2'], relegated: [{ clubId: 'c20' }, { clubId: 'c19' }] });
  });

  it('play Primera FEB\'s final stage as single games at one venue', () => {
    const { series } = playOut('primera-feb-2026-1', 18);
    expect(series.filter(entry => entry.stage !== 'quarter-final').map(entry => [entry.id, entry.bestOf, entry.neutral, entry.fixtureIds.length])).toEqual([['sf-a', 1, true, 1], ['sf-b', 1, true, 1], ['final', 1, true, 1]]);
  });

  it('wait for the regular season, and refuse games that do not match their series', () => {
    const format = POSTSEASON_FORMATS['acb-2026-1'];
    expect(derivePostseason({ leagueId: 'lg', format, seasonNumber: 1, order: null, slotDay, fixtures: [] }).fixtures).toEqual([]);
    const first = derivePostseason({ leagueId: 'lg', format, seasonNumber: 1, order: clubs(18), slotDay, fixtures: [] }).fixtures[0]!;
    expect(first).toMatchObject({ id: 'lg-s1-qf-a-g1', homeClubId: 'c1', awayClubId: 'c8', stage: 'quarter-final', seriesId: 'qf-a', game: 1 });
    const swapped = { ...first, homeClubId: first.awayClubId, awayClubId: first.homeClubId, result: { winnerClubId: 'c8' } };
    expect(() => derivePostseason({ leagueId: 'lg', format, seasonNumber: 1, order: clubs(18), slotDay, fixtures: [swapped] })).toThrow(/does not match its series/);
  });

  it('give every league in scope its format, and mark the unverified Turkish second division', () => {
    expect([['Germany', 1], ['France', 1], ['France', 2], ['Turkey', 1], ['Turkey', 2], ['Spain', 1], ['Spain', 2], ['Italy', 1], ['Italy', 2], ['Greece', 1]].map(([country, tier]) => postseasonFormatFor(country as string, tier as number))).toEqual(['bbl-2026-1', 'lnb-elite-2026-1', 'lnb-elite2-2026-1', 'bsl-2026-1', 'tbl-2026-1', 'acb-2026-1', 'primera-feb-2026-1', 'lba-2026-1', 'serie-a2-2026-1', 'gbl-2026-1']);
    expect(postseasonFormatFor('Germany', 2)).toBeNull();
    expect(Object.values(POSTSEASON_FORMATS).filter(format => !format.verified).map(format => format.id)).toEqual(['tbl-2026-1']);
    for (const format of Object.values(POSTSEASON_FORMATS)) expect(format.source.length).toBeGreaterThan(20);
  });
});

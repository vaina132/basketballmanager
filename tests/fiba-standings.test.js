import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { classificationPoints, rankFibaTable } from '../src/world/fiba-ranking';
import { competitionTable } from '../src/world/competition-table';
import { standingsRuleAllowed, standingsRuleFor } from '../src/domain/competition';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, getStandings, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { validateWorld } from '../src/world/career-world';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { SeasonWorkspace } from '../src/ui/SeasonWorkspace';
import { seasonLeagues } from '../src/world/divisions';

const ids = table => table.map(row => row.clubId);
/** A completed (or, with `pending`, unfinished) single round robin given as 'A-B 100-55' lines. */
function tableOf(lines, pending = false) {
  const games = lines.map((line, index) => {
    const [, home, away, h, a] = line.match(/^(\w+)-(\w+) (\d+)-(\d+)$/);
    return { id: `game-${index}`, competitionId: 'fiba-test', stage: 'regular', stageRound: index + 1, groupId: null, seriesId: null, date: '2026-09-05', neutral: false, homeClubId: home, awayClubId: away, home: Number(h), away: Number(a) };
  });
  const clubIds = [...new Set(games.flatMap(game => [game.homeClubId, game.awayClubId]))].sort();
  return competitionTable({ competitionId: 'fiba-test', clubIds, rule: 'fiba-2026-d', games: pending ? [...games, { ...games[0], id: 'future' }] : games,
    results: games.map(game => ({ fixtureId: game.id, home: game.home, away: game.away, winnerClubId: game.home > game.away ? game.homeClubId : game.awayClubId })) });
}
const row = (clubId, wins, losses, pointsFor = 700, pointsAgainst = 700) => ({ clubId, played: wins + losses, wins, losses, pointsFor, pointsAgainst, position: 0 });
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const uiProps = { onNewCareer() {}, onOpenMatch() {}, onAdvance() {}, onRollover() {}, onLoad() {} };

/** Two FIBA-default leagues: an odd five-club field (real byes) and a four-club field. */
export function fibaWorld() {
  const base = testWorld(9);
  return { ...base, id: 'fiba-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'north', name: 'North test league', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 5).map(club => club.id), standingsRule: 'fiba-2026-d' },
    { id: 'south', name: 'South test league', country: 'Otherland', tier: 1, clubIds: base.clubs.slice(5).map(club => club.id), standingsRule: 'fiba-2026-d' },
  ] };
}

describe('FIBA Official Basketball Rules 2026, Appendix D (the labelled default, step 3.4e-1)', () => {
  // The seven worked examples printed in Appendix D.2, with the classification the rulebook states for each.
  it.each([
    ['D.2.1', ['A-B 100-55', 'A-C 90-85', 'A-D 75-80', 'B-C 100-95', 'B-D 80-75', 'C-D 60-55'], ['A', 'B', 'C', 'D']],
    ['D.2.2', ['A-B 100-55', 'A-C 90-85', 'A-D 120-75', 'B-C 100-85', 'B-D 75-80', 'C-D 65-55'], ['A', 'B', 'C', 'D']],
    ['D.2.3', ['A-B 85-90', 'A-C 55-100', 'A-D 75-120', 'B-C 100-95', 'B-D 75-85', 'C-D 65-55'], ['C', 'D', 'B', 'A']],
    ['D.2.4', ['A-B 85-90', 'A-C 55-100', 'A-D 75-120', 'B-C 100-90', 'B-D 75-85', 'C-D 65-55'], ['B', 'C', 'D', 'A']],
    ['D.2.5', ['A-B 100-55', 'A-C 85-90', 'A-D 120-75', 'A-E 80-100', 'A-F 85-80', 'B-C 100-95', 'B-D 80-75', 'B-E 75-80', 'B-F 110-90', 'C-D 55-60', 'C-E 90-75', 'C-F 105-75', 'D-E 70-45', 'D-F 65-60', 'E-F 75-80'], ['A', 'B', 'D', 'C', 'E', 'F']],
    ['D.2.6', ['A-B 71-65', 'A-C 85-86', 'A-D 77-75', 'A-E 80-86', 'A-F 85-80', 'B-C 88-87', 'B-D 80-75', 'B-E 75-76', 'B-F 95-90', 'C-D 95-100', 'C-E 82-75', 'C-F 105-75', 'D-E 68-67', 'D-F 65-60', 'E-F 80-75'], ['C', 'A', 'B', 'E', 'D', 'F']],
    ['D.2.7', ['A-B 73-71', 'A-C 85-86', 'A-D 77-75', 'A-E 90-96', 'A-F 85-80', 'B-C 88-87', 'B-D 80-79', 'B-E 79-80', 'B-F 95-90', 'C-D 95-96', 'C-E 82-75', 'C-F 105-75', 'D-E 68-67', 'D-F 80-75', 'E-F 80-75'], ['C', 'B', 'D', 'E', 'A', 'F']],
  ])('reproduces example %s', (_, lines, expected) => {
    const table = tableOf(lines);
    expect(ids(table)).toEqual(expected);
    expect(table.map(entry => entry.position)).toEqual(expected.map((__, index) => index + 1));
    expect(table.some(entry => entry.rankingTie)).toBe(false);
  });

  it('ranks by classification points, so a club with more games played ranks above one with the same wins', () => {
    expect(classificationPoints({ wins: 3, losses: 1 })).toBe(7);
    // A: 3-1 (7 points); B: 3-0 (6 points, a game in hand); C: 0-0 after a bye (0 points) below a club that lost (1 point).
    expect(ids(rankFibaTable([row('b', 3, 0), row('c', 0, 0), row('a', 3, 1), row('d', 0, 1)], [], null))).toEqual(['a', 'b', 'd', 'c']);
  });

  it('uses the games between level clubs before overall margin, and restarts for the clubs still level', () => {
    // All 2-1 overall. C has the best overall margin, but A and B are 2-1 against each other... A beat B twice.
    const rows = [row('a', 2, 1, 240, 250), row('b', 2, 1, 260, 250), row('c', 2, 1, 300, 200)];
    const games = [{ homeClubId: 'a', awayClubId: 'b', home: 80, away: 70, winnerClubId: 'a' }, { homeClubId: 'b', awayClubId: 'a', home: 79, away: 80, winnerClubId: 'a' }];
    // Mini-table: A 4 points (two wins), B 2 points (two losses), C 0 (no meeting): A, B, then C.
    expect(ids(rankFibaTable(rows, games, null))).toEqual(['a', 'b', 'c']);
  });

  it('marks unresolved ties during the season and settles a fully tied final table by a reproducible draw', () => {
    const lines = ['A-B 80-70', 'B-C 80-70', 'C-A 80-70'];
    expect(tableOf(lines, true).every(entry => entry.rankingTie === 'unresolved')).toBe(true);
    const first = tableOf(lines);
    expect(first.every(entry => entry.rankingTie === 'draw')).toBe(true);
    expect(tableOf([...lines].reverse()).map(({ clubId, position }) => [clubId, position])).toEqual(first.map(({ clubId, position }) => [clubId, position]));
    expect(new Set(first.map(entry => entry.position)).size).toBe(3);
  });

  it('gives new worlds the French rule in France only and the FIBA default everywhere else', () => {
    expect(standingsRuleFor('France', 1)).toBe('lnb-2026-1');
    expect(standingsRuleFor('France', 2)).toBe('lnb-2026-1');
    for (const country of ['Germany', 'Greece', 'Italy', 'Spain', 'Turkey']) for (const tier of [1, 2]) expect(standingsRuleFor(country, tier)).toBe('fiba-2026-d');
    expect(standingsRuleAllowed('fiba-2026-d', 'France', 1)).toBe(false);
    expect(standingsRuleAllowed('lnb-2026-1', 'Spain', 1)).toBe(false);
    expect(standingsRuleAllowed('made-up', 'Spain', 1)).toBe(false);
  });

  it('rejects a wrong rule for a country, a partly ruled FIBA world and FIBA rules disguised as format 50', () => {
    const world = fibaWorld();
    expect(() => validateWorld(world)).not.toThrow();
    for (const [country, rule] of [['France', 'fiba-2026-d'], ['Testland', 'lnb-2026-1'], ['Testland', 'made-up']]) {
      const wrong = structuredClone(world);
      Object.assign(wrong.domesticLeagues[0], { country, standingsRule: rule });
      expect(() => validateWorld(wrong)).toThrow(/standingsRule/);
    }
    const partial = structuredClone(world); delete partial.domesticLeagues[1].standingsRule;
    expect(() => validateWorld(partial)).toThrow(/every league/);
    const mixed = structuredClone(world); Object.assign(mixed.domesticLeagues[0], { country: 'France', standingsRule: 'lnb-2026-1' });
    expect(() => validateWorld(mixed)).not.toThrow();
    const envelope = JSON.parse(serializeSeason(createSeason({ world })));
    envelope.formatVersion = 50; envelope.state.schemaVersion = 50;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/requires format 51/);
  });

  it('ranks a career\'s live and archived tables by the rule, with real byes, strict saves and the rule kept after rollover', () => {
    let state = setEmploymentDelegation(createSeason({ world: fibaWorld(), seed: 3141, ...NEW_CAREER_SYSTEMS, injuryMode: 'off' }), true);
    const north = state.world.domesticLeagues[0];
    state = play(state);
    // Week one: in the five-club league one club had a bye and has 0 points, below the two clubs that lost (1 point each).
    const week1 = getStandings(state).filter(entry => north.clubIds.includes(entry.clubId));
    expect(week1.map(entry => entry.played).sort()).toEqual([0, 1, 1, 1, 1]);
    expect(week1.at(-1).played).toBe(0);
    const markup = renderToStaticMarkup(createElement(SeasonWorkspace, { ...uiProps, season: state }));
    expect(markup).toContain('FIBA default · Classification points');
    expect(markup).toContain('>Pts</th>');
    expect(markup).toContain('Appendix D');
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    while (state.status === 'active') {
      state = play(state);
      for (const league of seasonLeagues(state.world, state.divisions)) {
        const points = getStandings(state).filter(entry => league.clubIds.includes(entry.clubId)).map(classificationPoints);
        expect(points).toEqual([...points].sort((a, b) => b - a));
      }
      if (state.round === 6) expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    }
    const table = getStandings(state);
    expect(table.every(entry => entry.rankingTie !== 'unresolved')).toBe(true);
    // This seed's manager is dismissed and joins another club of this world. Strict checks once accepted only clubs of
    // the built-in league here, so such a career could not be saved.
    expect(state.career.moves).toMatchObject([{ seasonNumber: 1, fromClubId: 'w0-rhine-falcons', reason: 'dismissed' }]);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    for (let step = 0; step < 80 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    expect(getMarketStartReason(state)).toBeNull();
    const next = rolloverSeason(state);
    expect(next.world.domesticLeagues.map(league => league.standingsRule)).toEqual(['fiba-2026-d', 'fiba-2026-d']);
    expect(getStandings({ ...next, fixtures: next.history[0].fixtures })).toEqual(table);
    expect(parseSeason(serializeSeasonCompact(next))).toEqual(next);
  }, 300_000);
});

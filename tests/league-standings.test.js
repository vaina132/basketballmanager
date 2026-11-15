import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rankAcbTable, rankBblTable, rankFipTable } from '../src/world/league-rankings';
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

const ids = table => table.map(row => row.clubId);
/** A season row; `pf`/`pa` default to an equal 700:700. */
const row = (clubId, wins, losses, pf = 700, pa = 700) => ({ clubId, played: wins + losses, wins, losses, pointsFor: pf, pointsAgainst: pa, position: 0 });
/** 'A-B 80-70' (optionally ' f20-18' for each side's fouls). */
const games = lines => lines.map(line => {
  const [, home, away, h, a, fh, fa] = line.match(/^(\w+)-(\w+) (\d+)-(\d+)(?: f(\d+)-(\d+))?$/);
  return { homeClubId: home, awayClubId: away, home: Number(h), away: Number(a), winnerClubId: Number(h) > Number(a) ? home : away, ...(fh ? { fouls: { home: Number(fh), away: Number(fa) } } : {}) };
});
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const uiProps = { onNewCareer() {}, onOpenMatch() {}, onAdvance() {}, onRollover() {}, onLoad() {} };

describe('easyCredit BBL Spielordnung 2026/2027, § 20 (step 3.4e-2)', () => {
  it('ranks by plus points, then fewer minus points', () => {
    // 3-0 (6:0) is ahead of 3-1 (6:2); FIBA's 2/1 points would put the 3-1 club first.
    expect(ids(rankBblTable([row('a', 3, 1), row('b', 3, 0), row('c', 0, 0)], [], null))).toEqual(['b', 'a', 'c']);
  });
  it('uses the games between level clubs, then overall difference, then the quotient, restarting for clubs still level', () => {
    // a, b, c all 2-2. a beat b and c; b and c split. b has the better overall difference.
    const rows = [row('a', 2, 2, 400, 410), row('b', 2, 2, 420, 400), row('c', 2, 2, 400, 410)];
    const played = games(['a-b 80-70', 'a-c 80-75', 'b-c 70-80', 'c-b 70-90']);
    // Direct plus points: a 4, b 2, c 2. Restart for b and c: direct 1-1, direct difference b +10.
    expect(ids(rankBblTable(rows, played, null))).toEqual(['a', 'b', 'c']);
  });
  it('reads the quotient rule as more points scored at an equal non-zero difference, and no decision at zero', () => {
    expect(ids(rankBblTable([row('a', 1, 1, 150, 140), row('b', 1, 1, 160, 150)], [], null))).toEqual(['b', 'a']);
    expect(ids(rankBblTable([row('a', 1, 1, 150, 160), row('b', 1, 1, 140, 150)], [], null))).toEqual(['a', 'b']);
    const zero = rankBblTable([row('b', 1, 1, 150, 150), row('a', 1, 1, 160, 160)], [], null);
    expect(zero.every(entry => entry.rankingTie === 'unresolved')).toBe(true);
    expect(rankBblTable([row('b', 1, 1, 150, 150), row('a', 1, 1, 160, 160)], [], 'key').every(entry => entry.rankingTie === 'draw')).toBe(true);
  });
});

describe('ACB Normas Internas 2026/2027, articles 6.2 and 7 (step 3.4e-2)', () => {
  it('uses only season-wide criteria until the level clubs have all met home and away (7.3.1)', () => {
    // a beat b in their only meeting, but b has the better overall difference.
    expect(ids(rankAcbTable([row('a', 2, 1, 240, 235), row('b', 2, 1, 250, 230)], games(['a-b 80-79']), null))).toEqual(['b', 'a']);
    // Home and away played: direct wins, then direct difference come first (7.3.2 a).
    expect(ids(rankAcbTable([row('a', 2, 2, 300, 320), row('b', 2, 2, 330, 300)], games(['a-b 80-70', 'b-a 75-70']), null))).toEqual(['a', 'b']);
  });
  it('uses direct points scored for three or more clubs before overall difference (7.3.2 b)', () => {
    // Two clubs level on direct wins and difference go straight to overall difference (7.3.2 a).
    const two = rankAcbTable([row('a', 1, 1, 300, 300), row('b', 1, 1, 310, 300)], games(['a-b 90-80', 'b-a 80-70']), null);
    expect(ids(two)).toEqual(['b', 'a']);
    // Three clubs, each 2-2 directly with a direct difference of 0; direct points scored are a 360, b 340, c 320,
    // so a leads although b and c have the better overall difference.
    const three = rankAcbTable([row('c', 2, 2, 400, 380), row('a', 2, 2, 300, 300), row('b', 2, 2, 400, 380)], games(['a-b 100-90', 'b-a 100-90', 'a-c 90-80', 'c-a 90-80', 'b-c 70-80', 'c-b 70-80']), null);
    expect(ids(three)).toEqual(['a', 'b', 'c']);
  });
  it('puts level clubs with fewer games first and ranks by win percentage while games played differ (6.2, 7.2)', () => {
    expect(ids(rankAcbTable([row('a', 4, 2), row('b', 2, 1), row('c', 2, 3)], [], null))).toEqual(['b', 'a', 'c']);
  });
  it('compares the sum of per-game scoring quotients to a thousandth', () => {
    // Same difference and points: a 100-50 and 50-100 (2.5), b 80-70 and 70-80 (2.018...).
    const rows = [row('b', 1, 1, 150, 150), row('a', 1, 1, 150, 150), row('x', 1, 1, 100, 100), row('y', 1, 1, 100, 100)];
    const played = games(['a-x 100-50', 'y-a 100-50', 'b-x 80-70', 'y-b 80-70']);
    expect(ids(rankAcbTable(rows, played, null)).slice(0, 2)).toEqual(['a', 'b']);
  });
});

describe('FIP Regolamento Esecutivo Gare, article 62 (step 3.4e-2)', () => {
  it('ranks two level clubs by direct wins, then the direct quotient, then the overall quotient', () => {
    expect(ids(rankFipTable([row('a', 2, 2, 300, 310), row('b', 2, 2, 320, 300)], games(['a-b 80-70', 'b-a 75-78']), null))).toEqual(['a', 'b']);
    expect(ids(rankFipTable([row('a', 2, 2, 330, 300), row('b', 2, 2, 300, 310)], games(['a-b 80-70', 'b-a 85-70']), null))).toEqual(['b', 'a']);
    // Equal direct totals (150:150): the overall quotient decides.
    expect(ids(rankFipTable([row('a', 2, 2, 300, 310), row('b', 2, 2, 320, 300)], games(['a-b 80-70', 'b-a 80-70']), null))).toEqual(['b', 'a']);
  });
  it('builds a table of direct games for three or more, then restarts with the two-club criteria', () => {
    // a beat b and c twice... b and c split and b has the better direct quotient between them.
    const rows = [row('a', 4, 2), row('b', 4, 2), row('c', 4, 2)];
    const played = games(['a-b 80-70', 'b-a 70-80', 'a-c 80-70', 'c-a 70-80', 'b-c 90-70', 'c-b 80-75']);
    expect(ids(rankFipTable(rows, played, null))).toEqual(['a', 'b', 'c']);
  });
  it('keeps four decimals of a quotient, then uses fewer fouls in the direct games and in all games', () => {
    // Overall quotients 1.00005 and 1.00009 are equal to four decimals; the direct games are 1-1 at 160:160.
    const rows = [row('a', 2, 2, 100005, 100000), row('b', 2, 2, 100009, 100000)];
    expect(ids(rankFipTable(rows, games(['a-b 80-70 f20-18', 'b-a 90-80 f17-21']), null))).toEqual(['b', 'a']);
    // Equal direct fouls (38 each): all games' fouls decide (here only the direct games plus one more).
    const more = games(['a-b 80-70 f20-19', 'b-a 90-80 f19-18', 'a-x 80-70 f10-10', 'b-x 80-70 f15-10']);
    expect(ids(rankFipTable([row('a', 3, 2, 100005, 100000), row('b', 3, 2, 100009, 100000), row('x', 0, 2)], more, null)).slice(0, 2)).toEqual(['a', 'b']);
  });
});

describe('rule choice, validation and careers (step 3.4e-2)', () => {
  it('gives new worlds each verified rule in its own league only and keeps older worlds on the FIBA default', () => {
    expect([['France', 1], ['France', 2], ['Spain', 1], ['Spain', 2], ['Germany', 1], ['Italy', 1], ['Italy', 2], ['Greece', 1], ['Turkey', 1], ['Turkey', 2]].map(([country, tier]) => standingsRuleFor(country, tier)))
      .toEqual(['lnb-2026-1', 'lnb-2026-1', 'acb-art7-2026', 'fiba-2026-d', 'bbl-art20-2026', 'fip-art62-2026', 'fip-art62-2026', 'fiba-2026-d', 'fiba-2026-d', 'fiba-2026-d']);
    // A format-51 world created with the FIBA default for these leagues keeps it.
    for (const [country, tier] of [['Spain', 1], ['Germany', 1], ['Italy', 1], ['Italy', 2]]) expect(standingsRuleAllowed('fiba-2026-d', country, tier)).toBe(true);
    expect(standingsRuleAllowed('fiba-2026-d', 'France', 1)).toBe(false);
    expect(standingsRuleAllowed('acb-art7-2026', 'Spain', 2)).toBe(false);
    expect(standingsRuleAllowed('bbl-art20-2026', 'Greece', 1)).toBe(false);
    expect(standingsRuleAllowed('fip-art62-2026', 'Spain', 1)).toBe(false);
  });

  it('checks fouls and rules in saves and refuses the new rules disguised as format 51', () => {
    const fixture = { id: 'g', competitionId: 'it', stage: 'regular', stageRound: 1, groupId: null, seriesId: null, date: '2026-09-05', homeClubId: 'a', awayClubId: 'b', neutral: false };
    const input = { rule: 'fip-art62-2026', competitionId: 'it', clubIds: ['a', 'b'], games: [fixture] };
    expect(() => competitionTable({ ...input, results: [{ fixtureId: 'g', home: 80, away: 70, winnerClubId: 'a', fouls: { home: -1, away: 3 } }] })).toThrow(/Foul/);
    expect(competitionTable({ ...input, results: [{ fixtureId: 'g', home: 80, away: 70, winnerClubId: 'a', fouls: { home: 18, away: 20 } }] }).map(entry => entry.clubId)).toEqual(['a', 'b']);
    const envelope = JSON.parse(serializeSeason(createSeason({ world: ruledWorld() })));
    envelope.formatVersion = 51; envelope.state.schemaVersion = 51;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/requires format 52/);
    const wrong = ruledWorld(); wrong.domesticLeagues[0].standingsRule = 'acb-art7-2026';
    expect(() => validateWorld(wrong)).toThrow(/standingsRule/);
    const partial = ruledWorld(); delete partial.domesticLeagues[2].standingsRule;
    expect(() => validateWorld(partial)).toThrow(/every league/);
  });

  it('plays a three-country career with each league\'s rule: live tables, fouls from retained evidence, strict saves and archived tables', () => {
    let state = setEmploymentDelegation(createSeason({ world: ruledWorld(), seed: 2718, ...NEW_CAREER_SYSTEMS, injuryMode: 'off' }), true);
    state = play(state);
    const markup = renderToStaticMarkup(createElement(SeasonWorkspace, { ...uiProps, season: state }));
    expect(markup).toContain('FIP · Points');
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    while (state.status === 'active') {
      state = play(state);
      if (state.round === 5) expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    }
    const table = getStandings(state);
    for (const league of state.world.domesticLeagues) {
      const rows = table.filter(entry => league.clubIds.includes(entry.clubId));
      expect(rows.map(entry => entry.wins)).toEqual([...rows.map(entry => entry.wins)].sort((a, b) => b - a));
      expect(rows.every(entry => entry.rankingTie !== 'unresolved')).toBe(true);
    }
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    for (let step = 0; step < 80 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    const next = rolloverSeason(state);
    expect(next.world.domesticLeagues.map(league => league.standingsRule)).toEqual(['fip-art62-2026', 'bbl-art20-2026', 'acb-art7-2026']);
    // The archive keeps full box scores only for the manager's games; the foul totals come from retained appearances.
    expect(next.history[0].fixtures.some(fixture => fixture.result.stats === null)).toBe(true);
    expect(getStandings({ ...next, fixtures: next.history[0].fixtures })).toEqual(table);
    expect(parseSeason(serializeSeasonCompact(next))).toEqual(next);
    // The Competition screen opens on the manager's league: a German and a Spanish career show their own rules.
    const world = ruledWorld();
    const opening = league => renderToStaticMarkup(createElement(SeasonWorkspace, { ...uiProps, season: createSeason({ world, managedClubId: world.domesticLeagues.find(item => item.id === league).clubIds[0] }) }));
    expect(opening('germany')).toContain('BBL · Wertungspunkte');
    expect(opening('germany')).toContain('>0:0</td>');
    expect(opening('spain')).toContain('ACB · Wins');
  }, 300_000);
});

/** Italian (FIP), German (BBL) and Spanish (ACB) top divisions of four, five and four clubs, without postseasons. */
export function ruledWorld() {
  const base = testWorld(13);
  return { ...base, id: 'league-rules-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'italy', name: 'Italian test league', country: 'Italy', tier: 1, clubIds: base.clubs.slice(0, 4).map(club => club.id), standingsRule: 'fip-art62-2026' },
    { id: 'germany', name: 'German test league', country: 'Germany', tier: 1, clubIds: base.clubs.slice(4, 9).map(club => club.id), standingsRule: 'bbl-art20-2026' },
    { id: 'spain', name: 'Spanish test league', country: 'Spain', tier: 1, clubIds: base.clubs.slice(9).map(club => club.id), standingsRule: 'acb-art7-2026' },
  ] };
}

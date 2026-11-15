import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rankLnbTable } from '../src/world/lnb-ranking';
import { competitionTable } from '../src/world/competition-table';
import { testWorld } from './world-fixtures';
import { createSeason, advanceSeason, getStandings, rolloverSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { validateWorld } from '../src/world/career-world';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { SeasonWorkspace } from '../src/ui/SeasonWorkspace';

const row = (clubId, wins = 4, played = 8, diff = 0, pointsFor = 700) => ({ clubId, wins, played, losses: played - wins, pointsFor, pointsAgainst: pointsFor - diff, position: 0 });
const game = (homeClubId, awayClubId, home, away) => ({ homeClubId, awayClubId, home, away, winnerClubId: home > away ? homeClubId : awayClubId });
const ids = table => table.map(row => row.clubId);
function tableOf(games, clubIds, pending = false) {
  const fixtures = games.map((g, i) => ({ id: `game-${i}`, competitionId: 'french-league', stage: 'regular', stageRound: i + 1, groupId: null, seriesId: null, date: '2026-09-05', neutral: false, ...g }));
  return competitionTable({ competitionId: 'french-league', clubIds, rule: 'lnb-2026-1', games: pending ? [...fixtures, { ...fixtures[0], id: 'future' }] : fixtures, results: fixtures.map(g => ({ fixtureId: g.id, home: g.home, away: g.away, winnerClubId: g.winnerClubId })) });
}
export function frenchWorld() {
  const base = testWorld(9);
  return { ...base, id: 'lnb-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'france-one', name: 'French test league', country: 'France', tier: 1, clubIds: base.clubs.slice(0, 5).map(c => c.id), standingsRule: 'lnb-2026-1' },
    { id: 'other-league', name: 'Other test league', country: 'Germany', tier: 1, clubIds: base.clubs.slice(5).map(c => c.id) },
  ] };
}
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const uiProps = { onNewCareer() {}, onOpenMatch() {}, onAdvance() {}, onRollover() {}, onLoad() {} };

describe('LNB regular-season ranking', () => {
  it('uses exact win percentage when clubs have different games played', () => {
    expect(ids(rankLnbTable([row('a', 1, 1), row('b', 2, 3), row('c', 0, 0)], [], null))).toEqual(['a', 'b', 'c']);
    const equal = rankLnbTable([row('a', 1, 3, 10), row('b', 2, 6, 20)], [], null);
    expect(ids(equal)).toEqual(['b', 'a']);
  });
  it('puts direct meetings before overall scoring margin', () => {
    const table = tableOf([game('a','b',80,70), game('a','c',50,70), game('a','d',80,79), game('b','c',100,30), game('b','d',100,30), game('c','d',40,80)], ['a','b','c','d']);
    expect(ids(table).slice(0,2)).toEqual(['a','b']);
    expect(table[1].pointsFor - table[1].pointsAgainst).toBeGreaterThan(table[0].pointsFor - table[0].pointsAgainst);
  });
  it('reproduces the official six-club example with a club that has no direct meeting', () => {
    const rows = [row('a',4,8,59),row('b',4,8,44),row('c',4,8,43),row('d',4,8,26),row('e',4,8,14),row('f',4,8,9)];
    const games = [game('b','f',96,70),game('e','d',78,70),game('d','a',95,70)];
    expect(ids(rankLnbTable(rows, games, null))).toEqual(['b','e','c','d','a','f']);
  });
  it('restarts head-to-head for the clubs left tied after another club separates', () => {
    // C leads the mini-table. A and B are both 1–2; their own meetings then put A first.
    const rows = [row('a',4,8,0),row('b',4,8,100),row('c',4,8,-10)];
    const games = [game('a','b',80,60),game('b','a',80,70),game('c','a',90,70),game('c','b',90,70)];
    expect(ids(rankLnbTable(rows, games, null))).toEqual(['c','a','b']);
  });
  it('uses direct points scored before overall points difference', () => {
    const rows = [row('a',4,8,100), row('b',4,8,20), row('c',4,8,10)];
    // 1–1 each, equal direct difference, different direct scoring totals: B separates first.
    const games = [game('a','b',80,70),game('b','c',90,80),game('c','a',70,60)];
    // Their direct scoring totals order B, C, A despite A's greater overall margin.
    expect(ids(rankLnbTable(rows, games, null))).toEqual(['b','c','a']);
  });
  it('has a reproducible final draw, never a draw before the last scheduled game', () => {
    const games = [game('a','b',80,70),game('b','c',80,70),game('c','a',80,70)];
    const pending = tableOf(games, ['a','b','c'], true);
    expect(pending.every(r => r.rankingTie === 'unresolved')).toBe(true);
    const first = tableOf(games, ['a','b','c']);
    expect(first.every(r => r.rankingTie === 'draw')).toBe(true);
    expect(tableOf(games, ['c','b','a'])).toEqual(first);
    expect(tableOf(games, ['a','b','c'])).toEqual(first);
    const frozen = JSON.stringify(games);
    tableOf(games, ['a','b','c']);
    expect(JSON.stringify(games)).toBe(frozen);
    expect(new Set(first.map(r => r.position)).size).toBe(3);
  });
  it('excludes other stages and competitions and rejects duplicate or damaged results', () => {
    const fixture = { id: 'a-b', competitionId: 'lnb', stage: 'regular', stageRound: 1, groupId: null, seriesId: null, date:'2026-09-05', homeClubId:'a', awayClubId:'b', neutral:false };
    const result = { fixtureId: 'a-b', home:80, away:70, winnerClubId:'a' };
    const input = { rule:'lnb-2026-1', competitionId:'lnb', clubIds:['a','b'], games:[fixture], results:[result] };
    expect(competitionTable({ ...input, games:[fixture,{...fixture,id:'cup',stage:'final'}], results:[result,{...result,fixtureId:'cup',home:70,away:90,winnerClubId:'b'}] })).toEqual(competitionTable(input));
    expect(() => competitionTable({...input,results:[result,result]})).toThrow(/twice/);
    expect(() => competitionTable({...input,results:[{...result,winnerClubId:'b'}]})).toThrow(/result/);
    expect(() => competitionTable({...input,rule:'unknown'})).toThrow(/rule/);
  });
});

describe('standings in careers, saves and screens', () => {
  it('uses one league-specific table in the UI, without uncommitted match results or another league leaking in', () => {
    let state = createSeason({ world:frenchWorld() });
    const group = state.world.domesticLeagues[0];
    state = play(state);
    const standings = getStandings(state).filter(r => group.clubIds.includes(r.clubId));
    const before = JSON.stringify(state);
    const markup = renderToStaticMarkup(createElement(SeasonWorkspace,{...uiProps,season:state}));
    const body = markup.slice(markup.indexOf('season-standings-table'),markup.indexOf('season-table-rules'));
    expect([...body.matchAll(/data-club-id="([^"]+)"/g)].map(m=>m[1])).toEqual(ids(standings));
    expect(markup).toContain('LNB · Win percentage');
    expect(markup).toContain('Regular-season table');
    expect(markup).toContain('Table rules');
    expect(JSON.stringify(state)).toBe(before);
    if (state.activeMatch) {
      const finished = {...state,activeMatch:simulateToEnd(setAutoSubstitutions(state.activeMatch,managedSide(state),true))};
      expect(getStandings(finished)).toEqual(getStandings(state));
    }
    const legacy = structuredClone(state); delete legacy.world.domesticLeagues[0].standingsRule;
    expect(renderToStaticMarkup(createElement(SeasonWorkspace,{...uiProps,season:legacy}))).toContain('Prototype ranking');
  });
  it('strictly reloads every week, settles final positions and preserves the rule after rollover', () => {
    let state = setEmploymentDelegation(createSeason({world:frenchWorld(),seed:778,...NEW_CAREER_SYSTEMS,injuryMode:'off'}),true);
    while(state.status==='active') {
      expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
      state=play(state);
    }
    const table = getStandings(state);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    for(let i=0;i<80&&getMarketStartReason(state);i++) state=advanceMarket(state);
    expect(getMarketStartReason(state)).toBeNull();
    let next=rolloverSeason(state);
    expect(next.world.domesticLeagues[0].standingsRule).toBe('lnb-2026-1');
    expect(getStandings({...next,fixtures:next.history[0].fixtures})).toEqual(table);
    expect(parseSeason(serializeSeasonCompact(next))).toEqual(next);
    while(next.status==='active') next=play(next);
    // Season two has negotiated sponsorships and an archived season; validation recomputes both tables.
    expect(parseSeason(serializeSeasonCompact(next))).toEqual(next);
    expect(getStandings({...next,fixtures:next.history[0].fixtures})).toEqual(table);
  },120000);
  it('rejects unknown, misplaced and backdated rule markers including mutation after world validation', () => {
    const world=frenchWorld(); validateWorld(world);
    world.domesticLeagues[0].standingsRule='made-up';
    expect(()=>validateWorld(world)).toThrow(/standingsRule/);
    world.domesticLeagues[0].standingsRule='lnb-2026-1'; world.domesticLeagues[0].country='Germany';
    expect(()=>validateWorld(world)).toThrow(/standingsRule/);
    const state=createSeason({world:frenchWorld()});
    const envelope=JSON.parse(serializeSeason(state));
    envelope.formatVersion=47; envelope.state.schemaVersion=47;
    expect(()=>parseSeason(JSON.stringify(envelope))).toThrow(/format 48/);
    const changed=structuredClone(state);changed.world.domesticLeagues[0].standingsRule=null;
    expect(()=>serializeSeasonCompact(changed)).toThrow(/standingsRule/);
  });
});

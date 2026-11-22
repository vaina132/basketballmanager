import { beforeAll, describe, expect, it } from 'vitest';
import type { MatchState, Team } from '../src/domain/types';
import type { SeasonState } from '../src/domain/season';
import { createFixtureMatch, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseMatch, serializeMatch } from '../src/storage/match-storage';
import { validateMatchState } from '../src/storage/validate-match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { worldFromPack } from '../src/world/real-world';
import { advanceMatchday } from './helpers/board-funding';
import { economyPack } from './helpers/economy-pack';
import { currentSeasonFile } from './helpers/season-format';
import { calibrationSummary, calibrationTeam, gameLine, type GameLine } from './helpers/match-calibration';

/**
 * Format 79 (owner feedback 16, 22 November 2026): the richer play model (`plays-2`, src/engine/plays.ts). Named
 * actions at realistic rates, the sprint-4 calibration bands kept, valid saves, and the earlier engine unchanged.
 */
const PLAYS = { playModel: 'plays-2', computerCoach: ['home', 'away'] } as const;
const strengths = [-1.5, -1.25, -1, -.75, -.5, -.25, 0, .25, .5, .75, 1, 1.5];
const teams: Team[] = strengths.map((strength, index) => calibrationTeam(index, strength));
const ACTIONS: Record<string, RegExp> = {
  pickAndRoll: /sets a ball screen/, postUp: /backs down .* in the post/, fastBreak: /on the fast break|leads the fast break/, putback: /scores the putback|misses the putback|tips it in|cannot tip it in|'s (putback|tip-in)\./,
  alleyOop: /throws the lob/, dunk: /throws down the dunk|cannot finish the dunk|finishes the alley-oop/, kickOut: /kicks it out/, catchAndShoot: /catch-and-shoot three/, pullUpThree: /pull-up three/,
  andOne: /: and one\./, charge: /charge|Illegal screen|pushes off in the post/, technical: /technical foul/, intentional: /intentionally to stop the clock/, coachTimeout: /call time to/,
  heave: /heave/, shotClock: /shot-clock signal/, travel: /travels/, blockOut: /out of bounds after the block/, floater: /floater/, hook: /hook shot/,
};
const games: GameLine[] = [];
const perGame: Record<string, number> = {};
const wins = new Map(teams.map(team => [team.id, 0]));

beforeAll(() => {
  let seed = 9100;
  for (const home of teams) for (const away of teams) {
    if (home === away) continue;
    const match = createFixtureMatch(seed++, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', ...PLAYS });
    const end = simulateToEnd(match);
    games.push(gameLine(end, { home: match.lineups.home, away: match.lineups.away }));
    const winner = end.score.home > end.score.away ? home.id : away.id;
    wins.set(winner, wins.get(winner)! + 1);
    for (const event of end.events) for (const [key, pattern] of Object.entries(ACTIONS)) if (pattern.test(event.text)) perGame[key] = (perGame[key] ?? 0) + 1;
  }
  for (const key of Object.keys(ACTIONS)) perGame[key] = (perGame[key] ?? 0) / games.length;
}, 120_000);

describe('richer play model (format 79)', () => {
  it('keeps the sprint-4 calibration against European regular-season averages', () => {
    const s = calibrationSummary(games);
    expect(s.possessions).toBeGreaterThanOrEqual(71); expect(s.possessions).toBeLessThanOrEqual(79);
    expect(s.points).toBeGreaterThanOrEqual(80); expect(s.points).toBeLessThanOrEqual(90);
    expect(s.offensiveRating).toBeGreaterThanOrEqual(107); expect(s.offensiveRating).toBeLessThanOrEqual(118);
    expect(s.twoPct).toBeGreaterThanOrEqual(51); expect(s.twoPct).toBeLessThanOrEqual(58);
    expect(s.threePct).toBeGreaterThanOrEqual(32); expect(s.threePct).toBeLessThanOrEqual(38);
    expect(s.threeShare).toBeGreaterThanOrEqual(37); expect(s.threeShare).toBeLessThanOrEqual(46);
    expect(s.ftaPerFga).toBeGreaterThanOrEqual(.28); expect(s.ftaPerFga).toBeLessThanOrEqual(.4);
    expect(s.turnovers).toBeGreaterThanOrEqual(11.5); expect(s.turnovers).toBeLessThanOrEqual(15);
    expect(s.steals).toBeGreaterThanOrEqual(5.5); expect(s.steals).toBeLessThanOrEqual(8.5);
    expect(s.blocks).toBeGreaterThanOrEqual(1.8); expect(s.blocks).toBeLessThanOrEqual(3.6);
    expect(s.fouls).toBeGreaterThanOrEqual(19); expect(s.fouls).toBeLessThanOrEqual(25);
    expect(s.orbPct).toBeGreaterThanOrEqual(25); expect(s.orbPct).toBeLessThanOrEqual(33);
    expect(s.assistedPct).toBeGreaterThanOrEqual(55); expect(s.assistedPct).toBeLessThanOrEqual(70);
    expect(s.margin).toBeGreaterThanOrEqual(9); expect(s.margin).toBeLessThanOrEqual(15);
    expect(s.homeWinPct).toBeGreaterThanOrEqual(50); expect(s.homeWinPct).toBeLessThanOrEqual(70);
  });

  it('plays the named actions at realistic rates (per game, both teams)', () => {
    const between = (key: string, low: number, high: number) => { expect(perGame[key], key).toBeGreaterThanOrEqual(low); expect(perGame[key], key).toBeLessThanOrEqual(high); };
    between('pickAndRoll', 35, 65); between('postUp', 5, 16); between('fastBreak', 8, 30); between('putback', 3, 12);
    between('alleyOop', .3, 3); between('dunk', 3, 14); between('kickOut', 6, 22); between('catchAndShoot', 18, 45); between('pullUpThree', 6, 20);
    between('andOne', 1.5, 7); between('charge', .8, 4); between('technical', 0, .6); between('intentional', 0, 3); between('coachTimeout', .5, 5);
    between('heave', .3, 2.5); between('shotClock', .05, 1); between('travel', .5, 4); between('blockOut', .3, 3); between('floater', 2, 12); between('hook', 3, 14);
  });

  it('lets stronger squads win more often without deciding every game', () => {
    const pct = (index: number) => wins.get(teams[index]!.id)! / 22;
    const strongest = (pct(11) + pct(10) + pct(9)) / 3, weakest = (pct(0) + pct(1) + pct(2)) / 3;
    expect(strongest).toBeGreaterThan(weakest + .25);
    expect(strongest).toBeLessThan(.97); expect(weakest).toBeGreaterThan(.03);
  });

  it('lets Blocking and Stealing decide blocks and steals', () => {
    const boosted: Team = { ...teams[6]!, players: teams[6]!.players.map(p => ({ ...p, attributes: { ...p.attributes, blocking: Math.min(20, p.attributes.blocking! + 6), stealing: Math.min(20, p.attributes.stealing! + 6) } })) };
    const totals = (home: Team) => {
      const sum = { blocks: 0, steals: 0 };
      for (let game = 0; game < 40; game += 1) {
        const end = simulateToEnd(createFixtureMatch(500 + game, home, teams[5]!, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', ...PLAYS }));
        for (const p of home.players) { sum.blocks += end.stats[p.id]!.blocks; sum.steals += end.stats[p.id]!.steals; }
      }
      return sum;
    };
    const base = totals(teams[6]!), strong = totals(boosted);
    expect(strong.blocks).toBeGreaterThan(base.blocks * 1.15);
    expect(strong.steals).toBeGreaterThan(base.steals * 1.1);
  });

  it('records valid match states at every step and round-trips match saves', () => {
    for (const seed of [11, 12, 13]) {
      let state: MatchState = createFixtureMatch(seed, teams[3]!, teams[8]!, { autoSubstitutions: { home: true, away: true }, injuryMode: 'standard', ...PLAYS });
      for (let step = 0; state.status !== 'finished' && step < 5000; step += 1) {
        state = stepMatch(state);
        if (step % 25 === 0) validateMatchState(state);
      }
      expect(state.status).toBe('finished');
      validateMatchState(state);
      expect(parseMatch(serializeMatch(state))).toEqual(state);
    }
  });

  it('refuses a play model value it does not know', () => {
    const state = structuredClone(simulateToEnd(createFixtureMatch(5, teams[1]!, teams[2]!, { injuryMode: 'off', ...PLAYS })));
    (state as { playModel: string }).playModel = 'plays-9';
    expect(() => validateMatchState(state)).toThrow(/playModel/);
  });

  it('leaves the earlier possession engine unchanged', () => {
    // Golden value of the possession engine before format 79 (same seed, squads and options).
    const end = simulateToEnd(createFixtureMatch(4242, teams[4]!, teams[7]!, { autoSubstitutions: { home: true, away: true }, injuryMode: 'standard' }));
    expect(end.playModel).toBeUndefined();
    expect(fingerprint(end)).toBe(OLD_ENGINE_FINGERPRINT);
  });
});

/** FNV-1a over the finished match's JSON. */
function fingerprint(state: MatchState): string {
  let hash = 2166136261;
  for (const character of JSON.stringify(state)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return `${hash.toString(16)}:${state.score.home}-${state.score.away}:${state.events.length}`;
}
/** Measured with the engine as it was before format 79 (commit 81e2ee8). */
const OLD_ENGINE_FINGERPRINT = 'd9a811cc:83-78:758';

describe('new careers play with the richer model (format 79)', () => {
  const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 8] }], null, 13);
  const world = worldFromPack(pack, 'bbl');
  let played: SeasonState;
  beforeAll(() => {
    let state = createSeason({ seed: 21, world, managedClubId: 'bbl-1', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    for (let day = 0; day < 3; day += 1) state = advanceMatchday(state);
    played = state;
  }, 300_000);

  it('records the play model on the career and on every prepared match, with computer coaches for the other clubs', () => {
    expect(played.matchModel).toBe('plays-2');
    expect(played.activeMatch?.playModel).toBe('plays-2');
    const side = played.activeMatch!.home.id === 'bbl-1' ? 'home' : 'away';
    expect(played.activeMatch!.computerCoach).toEqual([side === 'home' ? 'away' : 'home']);
  });

  it('round-trips through the strict save check, which replays the matches with the play model', () => {
    expect(parseSeason(serializeSeason(played))).toEqual(played);
    const changed = structuredClone(played), fixture = changed.fixtures.find(item => item.result && item.result.kind === 'normal')!;
    fixture.result!.score.home += 1;
    expect(() => parseSeason(currentSeasonFile(changed))).toThrow(/Invalid season save/);
    const engine = structuredClone(played);
    delete (engine as { matchModel?: string }).matchModel;
    expect(() => parseSeason(currentSeasonFile(engine))).toThrow(/Invalid season save/);
  });

  it('keeps careers without the option on the earlier possession actions', () => {
    const old = createSeason({ seed: 21, world, managedClubId: 'bbl-1', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, matchPlays: false });
    expect(old.matchModel).toBeUndefined();
    expect(old.activeMatch?.playModel).toBeUndefined();
  }, 120_000);
});

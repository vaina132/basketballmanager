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
import { calibrationSummary, calibrationTeam, gameLine, type GameLine } from './helpers/match-calibration';

/**
 * Format 81 (owner feedback, 22 November 2026 evening: "the ball going out, backcourt violations ... hundreds of
 * possibilities"): `plays-3` adds the dead balls of a real game at realistic rates, keeps the sprint-4 calibration bands,
 * records valid matches, and leaves `plays-2` and the earlier engine replaying exactly.
 */
const FLOW = { playModel: 'plays-3', computerCoach: ['home', 'away'] } as const;
const strengths = [-1.5, -1.25, -1, -.75, -.5, -.25, 0, .25, .5, .75, 1, 1.5];
const teams: Team[] = strengths.map((strength, index) => calibrationTeam(index, strength));
/** Per game, both teams; ranges around European top-flight rates. */
export const DEAD_BALLS: Record<string, { pattern: RegExp; low: number; high: number }> = {
  knockedOut: { pattern: /keep the ball, (sideline|baseline) throw-in/, low: 8, high: 20 },
  outOfBoundsTurnover: { pattern: /out of bounds\.|sails out of bounds|steps out of bounds|steps on the sideline/, low: 3, high: 9 },
  teamRebound: { pattern: /team rebound/, low: 5, high: 13 },
  kicked: { pattern: /Kicked ball/, low: .6, high: 3 },
  heldBall: { pattern: /Held ball/, low: .8, high: 3 },
  travel: { pattern: /travels/, low: .8, high: 3.5 },
  backcourt: { pattern: /backcourt violation/, low: .3, high: 2 },
  eightSeconds: { pattern: /8-second violation/, low: .05, high: .6 },
  fiveSeconds: { pattern: /5-second violation/, low: 0, high: .4 },
  doubleDribble: { pattern: /double dribble|carrying the ball/, low: .05, high: .8 },
  threeSeconds: { pattern: /three seconds/, low: .1, high: 1.2 },
  shotClock: { pattern: /shot-clock signal/, low: .1, high: 1.2 },
  goaltending: { pattern: /goaltending/, low: .05, high: .8 },
  interference: { pattern: /Basket interference/, low: 0, high: .5 },
  unsportsmanlike: { pattern: /: unsportsmanlike foul/, low: .1, high: .9 },
  technical: { pattern: /technical foul/, low: 0, high: .6 },
  charge: { pattern: /charge|Illegal screen|pushes off/, low: .8, high: 4 },
  timeout: { pattern: /take a timeout/, low: 3, high: 9 },
  lastShot: { pattern: /holds the ball for the last shot|runs down the clock with the lead/, low: .8, high: 4 },
};
const games: GameLine[] = [];
const perGame: Record<string, number> = {};
let sample: MatchState[] = [];

beforeAll(() => {
  let seed = 9100;
  for (const home of teams) for (const away of teams) {
    if (home === away) continue;
    const match = createFixtureMatch(seed++, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'standard', ...FLOW });
    const end = simulateToEnd(match);
    if (sample.length < 6) sample.push(end);
    games.push(gameLine(end, { home: match.lineups.home, away: match.lineups.away }));
    for (const event of end.events) for (const [key, { pattern }] of Object.entries(DEAD_BALLS)) if (pattern.test(event.text)) perGame[key] = (perGame[key] ?? 0) + 1;
  }
  for (const key of Object.keys(DEAD_BALLS)) perGame[key] = (perGame[key] ?? 0) / games.length;
}, 180_000);

describe('the dead balls of a real game (format 81, plays-3)', () => {
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

  it('records each kind of dead ball at a realistic rate (per game, both teams)', () => {
    for (const [key, { low, high }] of Object.entries(DEAD_BALLS)) {
      expect(perGame[key], key).toBeGreaterThanOrEqual(low);
      expect(perGame[key], key).toBeLessThanOrEqual(high);
    }
  });

  it('keeps the ball with the attack after a ball knocked out, with the shot clock running on', () => {
    let checked = 0;
    for (const end of sample) end.events.forEach((event, index) => {
      if (!/keep the ball, (sideline|baseline) throw-in/.test(event.text)) return;
      const shotClock = Number(/Shot clock (\d+)/.exec(event.text)![1]);
      expect(shotClock).toBeGreaterThanOrEqual(5);
      // The next action is the throw-in by the same team (or a substitution or timeout first).
      const next = end.events.slice(index + 1).find(item => item.scene && item.type !== 'substitution');
      expect(next?.side).not.toBe(event.side);
      checked += 1;
    });
    expect(checked).toBeGreaterThan(20);
  });

  it('gives the fouled team the ball after an unsportsmanlike foul\'s free throws', () => {
    let found = 0;
    for (let seed = 1; seed < 60 && found < 3; seed += 1) {
      const end = simulateToEnd(createFixtureMatch(seed, teams[2]!, teams[9]!, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', ...FLOW }));
      end.events.forEach((event, index) => {
        if (!/: unsportsmanlike foul/.test(event.text)) return;
        const fouled = event.side === 'home' ? 'away' : 'home';
        const after = end.events.slice(index + 1).find(item => item.type !== 'free-throw' && item.type !== 'substitution' && item.type !== 'timeout' && item.type !== 'foul-out' && item.type !== 'injury' && !(item.type === 'command' && /free-throw line|replaces|request/.test(item.text)));
        if (!after || after.type === 'period-end' || after.type === 'final') return;
        expect(after.text).toMatch(/keep the ball after the unsportsmanlike foul/);
        expect(after.side).toBe(fouled);
        found += 1;
      });
    }
    expect(found).toBeGreaterThan(0);
  }, 120_000);

  it('records valid match states at every step and round-trips match saves', () => {
    for (const seed of [21, 22]) {
      let state: MatchState = createFixtureMatch(seed, teams[3]!, teams[8]!, { autoSubstitutions: { home: true, away: true }, injuryMode: 'standard', ...FLOW });
      for (let step = 0; state.status !== 'finished' && step < 5000; step += 1) {
        state = stepMatch(state);
        if (seed === 21 || step % 25 === 0) validateMatchState(state);
      }
      expect(state.status).toBe('finished');
      expect(parseMatch(serializeMatch(state))).toEqual(state);
    }
  }, 120_000);

  it('leaves plays-2 matches replaying exactly', () => {
    // Measured with the play model before format 81 (main d912cf7).
    const end = simulateToEnd(createFixtureMatch(4242, teams[4]!, teams[7]!, { autoSubstitutions: { home: true, away: true }, injuryMode: 'standard', playModel: 'plays-2', computerCoach: ['home', 'away'] }));
    const stopped = simulateToEnd(createFixtureMatch(777, teams[1]!, teams[10]!, { autoSubstitutions: { home: true, away: false }, injuryMode: 'standard', playModel: 'plays-2', computerCoach: ['away'] }));
    expect(fingerprint(end)).toBe('27100829:105-77:790');
    expect(fingerprint(stopped)).toBe('8b03d16a:28-33:394');
  });
});

/** FNV-1a over the finished match's JSON. */
function fingerprint(state: MatchState): string {
  let hash = 2166136261;
  for (const character of JSON.stringify(state)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return `${hash.toString(16)}:${state.score.home}-${state.score.away}:${state.events.length}`;
}

describe('new careers play with the dead balls of a real game (format 81)', () => {
  const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 8] }], null, 13);
  const world = worldFromPack(pack, 'bbl');
  let played: SeasonState;
  beforeAll(() => {
    let state = createSeason({ seed: 21, world, managedClubId: 'bbl-1', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    for (let day = 0; day < 2; day += 1) state = advanceMatchday(state);
    played = state;
  }, 300_000);

  it('records plays-3 on the career and its prepared match, and round-trips through the strict save check', () => {
    expect(played.matchModel).toBe('plays-3');
    expect(played.activeMatch?.playModel).toBe('plays-3');
    expect(parseSeason(serializeSeason(played))).toEqual(played);
  });

  it('keeps careers without the option on plays-2', () => {
    const old = createSeason({ seed: 21, world, managedClubId: 'bbl-1', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, matchFlow: false });
    expect(old.matchModel).toBe('plays-2');
    expect(old.activeMatch?.playModel).toBe('plays-2');
  }, 120_000);
});

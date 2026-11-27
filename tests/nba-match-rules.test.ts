import { beforeAll, describe, expect, it } from 'vitest';
import type { MatchEvent, MatchState } from '../src/domain/types';
import { createFixtureMatch, isPlayerEligible, remainingTimeouts, requestTimeout, setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { FIBA_2024, inPenalty, NBA_2026, rulesOf } from '../src/engine/rulesets';
import { calibrationFor } from '../src/engine/calibration';
import { validateMatchState } from '../src/storage/validate-match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { worldFromPack } from '../src/world/real-world';
import { economyPack } from './helpers/economy-pack';
import { nbaTeam } from './helpers/nba-calibration';
import { calibrationTeam } from './helpers/match-calibration';

/** NBA step 3: the NBA rules in the match engine (48 minutes, six fouls, the NBA penalty and timeouts, five-minute overtimes). */
const NBA = { autoSubstitutions: { home: true, away: true }, injuryMode: 'standard', playModel: 'plays-3', computerCoach: ['home', 'away'], ruleset: 'nba-2026' } as const;
const teams = Array.from({ length: 6 }, (_, index) => nbaTeam(index, 2.5 + index * .3));
const ends: MatchState[] = [];

beforeAll(() => {
  let seed = 31_000;
  for (const home of teams) for (const away of teams) if (home !== away) ends.push(simulateToEnd(createFixtureMatch(seed++, home, away, NBA)));
}, 600_000);

const teamSeconds = (end: MatchState, side: 'home' | 'away') => end[side].players.reduce((sum, p) => sum + end.stats[p.id]!.secondsPlayed, 0);
const regulation = (end: MatchState) => 2880 + (end.period - 4) * 300;

describe('NBA rules in the match engine', () => {
  it('records the ruleset only when chosen; FIBA matches stay without it', () => {
    const fiba = createFixtureMatch(5, teams[0]!, teams[1]!, { playModel: 'plays-3', computerCoach: ['away'] });
    expect(Object.hasOwn(fiba, 'ruleset')).toBe(false);
    expect(rulesOf(fiba)).toBe(FIBA_2024);
    expect(fiba.clockSeconds).toBe(600);
    const nba = createFixtureMatch(5, teams[0]!, teams[1]!, NBA);
    expect(nba.ruleset).toBe('nba-2026');
    expect(rulesOf(nba)).toBe(NBA_2026);
    expect(nba.clockSeconds).toBe(720);
    expect(nba.events[0]!.text).toMatch(/NAL rules/);
    expect(calibrationFor(FIBA_2024).PLAYS).toBe(calibrationFor(rulesOf(fiba)).PLAYS);
  });

  it('refuses unknown rules and the NBA rules without the play model', () => {
    expect(() => createFixtureMatch(5, teams[0]!, teams[1]!, { ruleset: 'euroleague' as never })).toThrow(/competition rules/);
    expect(() => createFixtureMatch(5, teams[0]!, teams[1]!, { ruleset: 'nba-2026' })).toThrow(/play model/);
  });

  it('plays four 12-minute quarters and 5-minute overtimes, every match valid', () => {
    expect(ends.length).toBe(30);
    for (const end of ends) {
      expect(end.status).toBe('finished');
      expect(end.period).toBeGreaterThanOrEqual(4);
      for (const side of ['home', 'away'] as const) expect(teamSeconds(end, side)).toBe(5 * regulation(end));
      const starts = end.events.filter(event => event.type === 'period-start');
      for (const start of starts) expect(start.clockSeconds).toBe(start.period <= 4 ? 720 : 300);
      expect(() => validateMatchState(end)).not.toThrow();
    }
  });

  it('excludes a player at his sixth personal foul, not his fifth', () => {
    const match = createFixtureMatch(7, teams[2]!, teams[3]!, NBA), id = match.home.players[0]!.id;
    const five = { ...match, stats: { ...match.stats, [id]: { ...match.stats[id]!, fouls: 5 } } };
    expect(isPlayerEligible(five, id)).toBe(true);
    expect(isPlayerEligible({ ...five, stats: { ...five.stats, [id]: { ...five.stats[id]!, fouls: 6 } } }, id)).toBe(false);
    expect(isPlayerEligible({ ...five, ruleset: undefined }, id)).toBe(false);
    for (const end of ends) {
      for (const stats of Object.values(end.stats)) expect(stats.fouls).toBeLessThanOrEqual(6);
      for (const event of end.events.filter(item => item.type === 'foul-out')) expect(event.text).toMatch(/six personal fouls/);
    }
    expect(ends.some(end => Object.values(end.stats).some(stats => stats.fouls === 5))).toBe(true);
  });

  it('gives the penalty from the fifth team foul of a quarter, the fourth of an overtime, or the second in the last two minutes', () => {
    const base = createFixtureMatch(9, teams[0]!, teams[4]!, NBA);
    const foul = (period: number, clockSeconds: number): MatchEvent => ({ id: 0, period, clockSeconds, type: 'foul', side: 'home', playerId: base.home.players[0]!.id, text: 'foul', score: { home: 0, away: 0 } });
    const at = (period: number, clockSeconds: number, fouls: number, events: MatchEvent[] = []) => ({ ...base, period, clockSeconds, teamFouls: { home: fouls, away: 0 }, events: [...base.events, ...events] });
    expect(inPenalty(at(2, 400, 4), 'home')).toBe(false);
    expect(inPenalty(at(2, 400, 5), 'home')).toBe(true);
    expect(inPenalty(at(5, 200, 3), 'home')).toBe(false);
    expect(inPenalty(at(5, 200, 4), 'home')).toBe(true);
    // Last two minutes: one foul there is not enough, two are (even with fewer than five in the quarter).
    expect(inPenalty(at(3, 90, 2, [foul(3, 300), foul(3, 100)]), 'home')).toBe(false);
    expect(inPenalty(at(3, 90, 3, [foul(3, 300), foul(3, 100), foul(3, 90)]), 'home')).toBe(true);
    expect(inPenalty(at(3, 90, 2, [foul(2, 100), foul(3, 90)]), 'home')).toBe(false);
    // FIBA: the fifth foul, overtime counted with the fourth quarter, no late rule.
    const fiba = { ...at(3, 90, 3, [foul(3, 100), foul(3, 90)]), ruleset: undefined };
    expect(inPenalty(fiba, 'home')).toBe(false);
    expect(inPenalty({ ...fiba, period: 5, teamFouls: { home: 4, away: 0 } }, 'home')).toBe(false);
    // In play: team fouls restart in every NBA overtime.
    let overtime: MatchState | undefined;
    for (let seed = 40_000; !overtime && seed < 40_400; seed += 1) {
      const end = simulateToEnd(createFixtureMatch(seed, teams[2]!, teams[3]!, NBA));
      if (end.period > 4) overtime = end;
    }
    expect(overtime).toBeDefined();
    const fouls = overtime!.events.filter(event => event.type === 'foul' && event.period === overtime!.period);
    expect(overtime!.teamFouls.home + overtime!.teamFouls.away).toBe(fouls.length);
    expect(overtime!.events.find(event => event.type === 'period-start' && event.period === 5)!.clockSeconds).toBe(300);
    expect(() => validateMatchState(overtime)).not.toThrow();
  });

  it('allows seven timeouts, at most four in the fourth quarter and two in its last three minutes, two per overtime', () => {
    const base = createFixtureMatch(11, teams[1]!, teams[5]!, NBA);
    const usage = (firstHalf: number, secondHalf: number, lateFourth: number, overtime = 0) => ({ home: { firstHalf, secondHalf, lateFourth, overtime }, away: { firstHalf: 0, secondHalf: 0, lateFourth: 0, overtime: 0 } });
    expect(remainingTimeouts(base, 'home')).toBe(7);
    expect(remainingTimeouts({ ...base, period: 3, timeoutUsage: usage(5, 0, 0) }, 'home')).toBe(2);
    expect(remainingTimeouts({ ...base, period: 4, clockSeconds: 600, timeoutUsage: usage(1, 0, 0) }, 'home')).toBe(4);
    expect(remainingTimeouts({ ...base, period: 4, clockSeconds: 170, timeoutUsage: usage(1, 1, 0) }, 'home')).toBe(2);
    expect(remainingTimeouts({ ...base, period: 4, clockSeconds: 170, timeoutUsage: usage(1, 3, 1) }, 'home')).toBe(1);
    expect(remainingTimeouts({ ...base, period: 4, clockSeconds: 100, timeoutUsage: usage(6, 1, 0) }, 'home')).toBe(0);
    expect(remainingTimeouts({ ...base, period: 5, clockSeconds: 300, timeoutUsage: usage(7, 0, 0) }, 'home')).toBe(2);
    expect(remainingTimeouts({ ...base, ruleset: undefined, clockSeconds: 600 }, 'home')).toBe(2);
    // A manager asking for every timeout: the engine grants them within the limits and the strict check agrees.
    let state = createFixtureMatch(13, teams[3]!, teams[0]!, { ...NBA, autoSubstitutions: { home: false, away: true } });
    for (let guard = 0; guard < 20_000 && state.status !== 'finished'; guard += 1) {
      if (state.requiredSubstitutions.length) { state = setAutoSubstitutions(state, 'home', true); continue; }
      if (!state.timeoutRequested.home && remainingTimeouts(state, 'home') > 0 && state.stepCount % 25 === 0 && state.stepCount > 0) state = requestTimeout(state, 'home');
      state = stepMatch(state);
    }
    const granted = state.events.filter(event => event.type === 'timeout' && event.side === 'home');
    const regular = granted.filter(event => event.period <= 4), fourth = granted.filter(event => event.period === 4);
    expect(regular.length).toBe(7);
    expect(fourth.length).toBeLessThanOrEqual(4);
    expect(fourth.filter(event => event.clockSeconds <= 180).length).toBeLessThanOrEqual(2);
    expect(() => validateMatchState(state)).not.toThrow();
  }, 120_000);

  it('calls defensive three seconds rarely, with one free throw and the ball kept by the attack', () => {
    const calls = ends.flatMap(end => end.events.map((event, index) => ({ end, event, index })).filter(item => /^Defensive three seconds/.test(item.event.text)));
    expect(calls.length / ends.length).toBeGreaterThan(.2);
    expect(calls.length / ends.length).toBeLessThan(3);
    const { end, index } = calls.find(item => item.end.events.slice(item.index).some(event => /keep the ball after the technical free throw/.test(event.text)))!;
    const after = end.events.slice(index + 1, index + 6);
    expect(after.filter(event => event.type === 'free-throw').length).toBe(1);
    expect(after.some(event => /keep the ball after the technical free throw/.test(event.text))).toBe(true);
  });

  it('refuses a recorded ruleset in saves before format 90', () => {
    const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 8] }], null, 13);
    const state = createSeason({ seed: 21, world: worldFromPack(pack, 'bbl'), managedClubId: 'bbl-1', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    expect(() => parseSeason(serializeSeason(state))).not.toThrow();
    const match = state.activeMatch!;
    const nba = { ...match, ruleset: 'nba-2026' as const, clockSeconds: 720, events: [{ ...match.events[0]!, clockSeconds: 720 }, ...match.events.slice(1)] };
    expect(() => validateMatchState(nba)).not.toThrow();
    expect(() => parseSeason(serializeSeason({ ...state, activeMatch: nba }))).toThrow(/ruleset/);
  }, 120_000);

  it('keeps FIBA matches on 40 minutes and five fouls', () => {
    const end = simulateToEnd(createFixtureMatch(17, calibrationTeam(1, 0), calibrationTeam(2, 0), { autoSubstitutions: { home: true, away: true }, playModel: 'plays-3', computerCoach: ['home', 'away'] }));
    expect(teamSeconds(end, 'home')).toBe(5 * (2400 + (end.period - 4) * 300));
    for (const stats of Object.values(end.stats)) expect(stats.fouls).toBeLessThanOrEqual(5);
  });
});

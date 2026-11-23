import { createHash } from 'node:crypto';
import type { CoachRotation, MatchState, Team } from '../../src/domain/types';
import { createFixtureMatch, createMatch, requestTimeout, setAutoSubstitutions, simulateToEnd, stepMatch, substitutePlayer, type FixtureMatchOptions } from '../../src/engine/match';
import { calibrationTeam } from './match-calibration';

/**
 * FIBA golden matches (NBA step 3, 23 November 2026): seeded matches across every match model in use before the
 * per-competition rulesets (both engines, the possession actions, plays-2, plays-3 with match flow, head-coach rotations,
 * neutral venues, youth-strength squads, injuries, morale, circles and live commands). Their hashes are captured once
 * by scripts/capture-fiba-golden.mjs into tests/fixtures/fiba-golden.json; FIBA matches must replay bit for bit.
 */
export interface GoldenCase { name: string; run: () => MatchState }
export interface GoldenHashes { events: string; boxScore: string; state: string; score: string; periods: number; steps: number }

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const strengths = [-1.5, -1, -.5, 0, .5, 1, 1.5, 2];
const teams = strengths.map((strength, index) => calibrationTeam(index, strength));
/** Youth-strength squads: the calibration generator about five points below the senior regulars. */
const youth = [0, 1, 2, 3].map(index => renamed(calibrationTeam(20 + index, -5 + index * .5), `youth-${index}`));
const AUTO = { autoSubstitutions: { home: true, away: true } } as const;

function renamed(team: Team, prefix: string): Team {
  return { ...team, id: prefix, players: team.players.map(player => ({ ...player, id: `${prefix}-${player.id}` })) };
}
function rotation(team: Team, depth: number, timeoutRun: number): CoachRotation {
  return { depth, youthBonus: depth > 0 ? 4 : -1, young: team.players.slice(7, 9 + depth).map(p => p.id), restCondition: 92 + depth, foulTrouble: 4 + depth / 2, swapThreshold: 2.6 + depth * .2, closingSeconds: 180 + depth * 30, timeoutRun };
}
function fixture(seed: number, home: Team, away: Team, options: FixtureMatchOptions): () => MatchState {
  return () => simulateToEnd(createFixtureMatch(seed, home, away, options));
}
/** A manager who plays by hand: timeouts and substitutions at fixed steps, assistant switched on when a change is required. */
function scripted(seed: number, home: Team, away: Team, options: FixtureMatchOptions): () => MatchState {
  return () => {
    let state = createFixtureMatch(seed, home, away, { ...options, autoSubstitutions: { home: false, away: true } });
    for (let guard = 0; guard < 20_000 && state.status !== 'finished'; guard += 1) {
      if (state.requiredSubstitutions.length) { state = setAutoSubstitutions(state, 'home', true); continue; }
      const steps = state.stepCount;
      if ([40, 150, 260, 300, 330].includes(steps) && !state.timeoutRequested.home) {
        try { state = requestTimeout(state, 'home'); } catch { /* none left in this allowance */ }
      }
      if (steps === 90 || steps === 200) {
        const bench = state.home.players.find(p => !state.lineups.home.includes(p.id) && state.stats[p.id]!.fouls < 5 && !state.injuries[p.id] && !state.pendingSubstitutions.home.some(r => r.inId === p.id));
        const out = state.lineups.home.find(id => !state.pendingSubstitutions.home.some(r => r.outId === id));
        if (bench && out) state = substitutePlayer(state, 'home', out, bench.id);
      }
      state = stepMatch(state);
    }
    return state;
  };
}

export function goldenCases(): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const add = (name: string, run: () => MatchState) => cases.push({ name, run });
  // The exhibition engines.
  for (const seed of [1, 42, 777]) add(`exhibition rules-2 ${seed}`, () => simulateToEnd(setAutoSubstitutions(createMatch(seed, 'rules-2'), 'home', true)));
  for (const seed of [1, 42, 777]) add(`exhibition possession-3 ${seed}`, () => simulateToEnd(setAutoSubstitutions(createMatch(seed, 'possession-3'), 'home', true)));
  // Possession actions (no play model), with each injury setting and pre-existing injuries.
  for (const [index, injuryMode] of (['standard', 'reduced', 'off', 'standard', 'standard', 'off'] as const).entries()) {
    const home = teams[index]!, away = teams[(index + 3) % teams.length]!;
    add(`possession ${injuryMode} ${index}`, fixture(5000 + index, home, away, { ...AUTO, injuryMode }));
  }
  add('possession pre-existing injuries', fixture(5101, teams[2]!, teams[5]!, { ...AUTO, preExistingInjuries: { [teams[2]!.players[1]!.id]: 'hamstring', [teams[5]!.players[0]!.id]: 'ankle-sprain' }, injuryRisk: { [teams[2]!.players[0]!.id]: { hamstring: 3 } } }));
  add('possession tactics and conditions', fixture(5102, teams[4]!, teams[1]!, { ...AUTO, tactics: { home: { tempo: .9, outsideShare: .8, pressure: .9 }, away: { tempo: .1, outsideShare: .15, pressure: .2 } }, conditions: Object.fromEntries(teams[4]!.players.map((p, i) => [p.id, 70 + i * 2])) }));
  add('possession neutral venue', fixture(5103, teams[6]!, teams[0]!, { ...AUTO, neutralVenue: true }));
  // plays-2 with computer coaches.
  for (let index = 0; index < 6; index += 1) {
    const home = teams[index]!, away = teams[(index + 2) % teams.length]!;
    add(`plays-2 ${index}`, fixture(6000 + index, home, away, { ...AUTO, injuryMode: index % 3 === 2 ? 'off' : 'standard', playModel: 'plays-2', computerCoach: index % 2 ? ['home', 'away'] : ['away'] }));
  }
  // plays-3 (match flow), the format-81 default for new careers.
  for (let index = 0; index < 15; index += 1) {
    const home = teams[(index * 3) % teams.length]!, away = teams[(index * 3 + 1 + (index % 4)) % teams.length]!;
    add(`plays-3 ${index}`, fixture(7000 + index, home, away, { ...AUTO, playModel: 'plays-3', computerCoach: ['home', 'away'], ...(index % 3 === 0 ? { tactics: { home: { tempo: .3 + index / 20, outsideShare: .6, pressure: .4 }, away: { tempo: .7, outsideShare: .3, pressure: .7 } } } : {}) }));
  }
  // Head coaches' rotations (format 86).
  for (let index = 0; index < 8; index += 1) {
    const home = teams[(index + 1) % teams.length]!, away = teams[(index + 5) % teams.length]!, depth = index % 5 - 2;
    add(`coach rotation ${index}`, fixture(8000 + index, home, away, { ...AUTO, playModel: index < 2 ? 'plays-2' : 'plays-3', computerCoach: ['home', 'away'], coachRotation: { home: rotation(home, depth, index % 3 - 1), ...(index % 2 ? { away: rotation(away, -depth, 0) } : {}) } }));
  }
  // Neutral venues (format 85).
  for (let index = 0; index < 4; index += 1) add(`neutral venue ${index}`, fixture(8500 + index, teams[index]!, teams[7 - index]!, { ...AUTO, neutralVenue: true, playModel: index % 2 ? 'plays-2' : 'plays-3', computerCoach: ['home', 'away'] }));
  // Youth matches: possession actions between youth-strength squads, as src/world/youth-competition.ts plays them.
  for (let index = 0; index < 4; index += 1) {
    const home = youth[index]!, away = youth[(index + 1) % 4]!;
    add(`youth ${index}`, fixture(9000 + index, home, away, { ...AUTO, injuryMode: index === 3 ? 'reduced' : 'standard', conditions: Object.fromEntries(home.players.map((p, i) => [p.id, 100 - i])), ...(index === 1 ? { preExistingInjuries: { [away.players[2]!.id]: 'calf' } } : {}) }));
  }
  // Morale (format 30s) and the court picture's circles (format 74).
  for (let index = 0; index < 2; index += 1) {
    const home = teams[index + 3]!, away = teams[index]!;
    const values = Object.fromEntries([...home.players, ...away.players].map((p, i) => [p.id, (i * 17 + index * 9) % 101]));
    add(`morale ${index}`, fixture(9100 + index, home, away, { ...AUTO, morale: { model: 'morale-1', eventCount: 12 + index, values }, ...(index ? { playModel: 'plays-3', computerCoach: ['away'] } : {}) }));
  }
  add('circles plays-3', fixture(9200, teams[5]!, teams[2]!, { ...AUTO, playModel: 'plays-3', computerCoach: ['away'], slots: { home: { [teams[5]!.players[0]!.id]: 'SG', [teams[5]!.players[1]!.id]: 'PG', [teams[5]!.players[4]!.id]: 'PF' } } }));
  add('circles possession', fixture(9201, teams[1]!, teams[6]!, { ...AUTO, slots: { home: { [teams[1]!.players[2]!.id]: 'PF', [teams[1]!.players[3]!.id]: 'SF' } } }));
  // A manager playing by hand: timeouts, substitutions and the assistant switched on when a change is required.
  add('manual possession', scripted(9300, teams[3]!, teams[4]!, { injuryMode: 'standard' }));
  add('manual plays-2', scripted(9301, teams[2]!, teams[7]!, { playModel: 'plays-2', computerCoach: ['away'] }));
  add('manual plays-3', scripted(9302, teams[6]!, teams[5]!, { playModel: 'plays-3', computerCoach: ['away'] }));
  add('manual plays-3 strong', scripted(9303, teams[7]!, teams[0]!, { playModel: 'plays-3', computerCoach: ['away'], injuryMode: 'off' }));
  return cases;
}

export function goldenHashes(end: MatchState): GoldenHashes {
  const box = Object.fromEntries(Object.entries(end.stats).sort(([a], [b]) => a.localeCompare(b)));
  return {
    events: sha(end.events), boxScore: sha({ box, score: end.score, result: end.result, teamFouls: end.teamFouls, timeoutUsage: end.timeoutUsage }), state: sha(end),
    score: `${end.score.home}-${end.score.away}`, periods: end.period, steps: end.stepCount,
  };
}

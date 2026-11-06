import { describe, expect, it } from 'vitest';
import type { MatchState, PlayerStats, PossessionPlay, Side, Tactics } from '../src/domain/types';
import {
  createMatch, isPlayerEligible, requestTimeout, setAutoSubstitutions, setInjuryMode,
  setTactics, simulateToEnd, simulateToQuarterEnd, stepMatch, substitutePlayer,
} from '../src/engine/match';
import { assignMatchups, courtDistance, createPossessionPlay, shotContext } from '../src/engine/possession';
import { hoopPosition } from '../src/engine/court-events';

const sides: Side[] = ['home', 'away'];
const other = (side: Side): Side => side === 'home' ? 'away' : 'home';
function fixture(seed = 42, automatic = true): MatchState {
  let state = setInjuryMode(createMatch(seed), 'off');
  for (const side of sides) state = setAutoSubstitutions(state, side, automatic);
  return state;
}
function sum(state: MatchState, side: Side, field: keyof PlayerStats): number {
  return state[side].players.reduce((total, player) => total + state.stats[player.id]![field], 0);
}
function until(state: MatchState, condition: (state: MatchState) => boolean): MatchState {
  for (let count = 0; count < 5000; count += 1) {
    if (condition(state)) return state;
    if (state.status === 'finished' || state.requiredSubstitutions.length) break;
    state = stepMatch(state);
  }
  throw new Error('The fixed fixture did not reach the requested action boundary.');
}
function stripScenes(state: MatchState): MatchState {
  return { ...state, events: state.events.map(event => {
    const { scene: _scene, ...sporting } = event;
    return sporting;
  }) };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

describe('possession-3 shared match rules', () => {
  it('selects the modern engine explicitly while preserving the legacy version', () => {
    expect(createMatch(1).engineVersion).toBe('possession-3');
    expect(Object.hasOwn(createMatch(1), 'possessionPlay')).toBe(true);
    const legacy = createMatch(1, 'rules-2');
    expect(legacy.engineVersion).toBe('rules-2');
    expect(Object.hasOwn(legacy, 'possessionPlay')).toBe(false);
  });

  it('reaches identical complete states through step, quarter skip and instant modes', () => {
    const initial = fixture(876);
    let stepped = initial, quarters = initial;
    for (let count = 0; count < 5000 && stepped.status !== 'finished'; count += 1) stepped = stepMatch(stepped);
    for (let count = 0; count < 24 && quarters.status !== 'finished'; count += 1) quarters = simulateToQuarterEnd(quarters);
    expect(stepped.status).toBe('finished');
    expect(quarters).toEqual(stepped);
    expect(simulateToEnd(initial)).toEqual(stepped);
  });

  it('accounts for exact quarter time, active minutes and scoring across varied seeds', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const quarter = simulateToQuarterEnd(fixture(seed));
      expect(quarter.period).toBe(1); expect(quarter.clockSeconds).toBe(0);
      for (const side of sides) expect(sum(quarter, side, 'secondsPlayed')).toBe(3000);
      const final = simulateToEnd(quarter);
      expect(final.status).toBe('finished'); expect(final.result?.kind).toBe('normal');
      const elapsed = 2400 + Math.max(0, final.period - 4) * 300;
      for (const side of sides) {
        expect(sum(final, side, 'secondsPlayed')).toBe(5 * elapsed);
        expect(final.courtSeconds[side]).toBe(5 * elapsed);
        expect(sum(final, side, 'points')).toBe(final.score[side]);
        expect(final.score[side]).toBe(2 * sum(final, side, 'fieldGoalsMade') + sum(final, side, 'threePointersMade') + sum(final, side, 'freeThrowsMade'));
        expect(final.lineups[side].every(id => isPlayerEligible(final, id))).toBe(true);
      }
      expect(stepMatch(final)).toBe(final);
    }
  });

  it('holds fifth-foul replacement across every progression mode and rebuilds the active play', () => {
    const state = until(fixture(14, false), current => current.phase === 'live-ball' && current.possessionPlay != null);
    const outgoing = state.lineups.home[0]!, incoming = state.home.players[5]!.id;
    state.stats[outgoing]!.fouls = 5;
    const stopped = stepMatch(state);
    expect(stopped.requiredSubstitutions).toEqual([{ side: 'home', playerId: outgoing, reason: 'fouled-out' }]);
    expect(stopped.clockSeconds).toBe(state.clockSeconds);
    expect(simulateToEnd(stopped)).toBe(stopped); expect(simulateToQuarterEnd(stopped)).toBe(stopped);
    expect(stepMatch(stopped).stats).toEqual(stopped.stats);
    const resumed = substitutePlayer(stopped, 'home', outgoing, incoming);
    expect(resumed.requiredSubstitutions).toHaveLength(0);
    expect(resumed.lineups.home).toContain(incoming); expect(resumed.lineups.home).not.toContain(outgoing);
    const next = stepMatch(resumed);
    expect(next.stats[outgoing]!.secondsPlayed).toBe(state.stats[outgoing]!.secondsPlayed);
    expect(next.possessionPlay?.positions.some(position => position.playerId === outgoing) ?? false).toBe(false);
  });

  it('queues live changes without RNG or recovery, then applies them at a legal stoppage', () => {
    const state = until(fixture(19, false), current => current.phase === 'live-ball' && current.stoppage == null && current.possessionPlay != null);
    const outgoing = state.lineups.home[0]!, incoming = state.home.players[5]!.id;
    const queued = requestTimeout(substitutePlayer(state, 'home', outgoing, incoming), 'home');
    expect(queued.rngState).toBe(state.rngState); expect(queued.stats).toEqual(state.stats);
    expect(queued.pendingSubstitutions.home).toEqual([{ outId: outgoing, inId: incoming }]);
    expect(queued.lineups.home).toContain(outgoing); expect(queued.timeoutUsage.home.firstHalf).toBe(0);
    const applied = until(queued, current => current.timeoutUsage.home.firstHalf === 1 && current.pendingSubstitutions.home.length === 0);
    expect(applied.lineups.home).toContain(incoming); expect(applied.timeoutRequested.home).toBe(false);
    const substitution = applied.events.find(event => event.type === 'substitution' && event.playerId === incoming)!;
    expect(substitution).toBeDefined();
    expect(substitution.clockSeconds).toBeLessThan(state.clockSeconds);
    const next = stepMatch(applied);
    if (next.possessionPlay) expect(next.possessionPlay.positions.map(position => position.playerId).sort()).toEqual([...next.lineups.home, ...next.lineups.away].sort());
  });
});

describe('authoritative possession actions', () => {
  it('records completed passes before independent later misses and credits only the actual last passer', () => {
    let passes = 0, passesFollowedByMisses = 0, assists = 0, andOneAssists = 0, clearedByDrive = 0, offensiveRebounds = 0;
    for (let seed = 1; seed <= 3; seed += 1) {
      let state = fixture(seed);
      for (let step = 0; step < 5000 && state.status !== 'finished'; step += 1) {
        const next = stepMatch(state), events = next.events.slice(state.events.length), play = state.possessionPlay;
        const pass = events.find(event => event.type === 'pass');
        if (pass) {
          passes += 1;
          const changedBeforePass = events.slice(0, events.indexOf(pass)).some(event => event.type === 'substitution' || event.type === 'period-start');
          if (!changedBeforePass && play) expect(pass.playerId).toBe(play.handlerId);
          expect(next.lineups[pass.side!]).toContain(pass.playerId);
          expect(pass.receiverId).not.toBe(pass.playerId);
          expect(next.possessionPlay?.handlerId).toBe(pass.receiverId);
          expect(next.possessionPlay?.passerId).toBe(pass.playerId);
          expect(events.some(event => event.type === 'shot')).toBe(false);
        }
        const drive = events.find(event => event.type === 'drive');
        if (drive) {
          if (play?.passerId) clearedByDrive += 1;
          expect(next.possessionPlay?.passerId).toBeNull();
        }
        for (const event of events.filter(event => event.shot)) {
          const changedBeforeShot = events.slice(0, events.indexOf(event)).some(before => before.type === 'substitution' || before.type === 'period-start');
          const passerId = changedBeforeShot ? null : play?.passerId ?? null;
          if (!changedBeforeShot && play) expect(event.playerId).toBe(play.handlerId);
          if (!event.shot!.made && passerId) passesFollowedByMisses += 1;
          if (event.assistPlayerId) {
            assists += 1;
            expect(event.shot!.made).toBe(true); expect(event.assistPlayerId).toBe(passerId);
            expect(event.assistPlayerId).not.toBe(event.playerId);
            if (next.freeThrows?.total === 1 && events.some(foul => foul.type === 'foul' && /on the shot/.test(foul.text))) {
              andOneAssists += 1;
              expect(next.freeThrows.shooterId).toBe(event.playerId);
            }
          }
          if (!passerId || !event.shot!.made) expect(event.assistPlayerId).toBeUndefined();
        }
        if (events.some(event => event.type === 'rebound' && /offensive rebound/i.test(event.text))) {
          offensiveRebounds += 1;
          expect(next.possessionPlay?.passerId ?? null).toBeNull();
        }
        state = next;
      }
      expect(state.status).toBe('finished');
      for (const [id, stats] of Object.entries(state.stats)) expect(state.events.filter(event => event.assistPlayerId === id)).toHaveLength(stats.assists);
    }
    expect(passes).toBeGreaterThan(100); expect(passesFollowedByMisses).toBeGreaterThan(10);
    expect(assists).toBeGreaterThan(10); expect(clearedByDrive).toBeGreaterThan(0); expect(offensiveRebounds).toBeGreaterThan(0);
    expect(andOneAssists).toBeGreaterThan(0);
  });

  it('charges real clock, court exposure and fatigue for advance, pass and drive actions', () => {
    let state = fixture(32, false);
    const seen = new Set<string>();
    for (let count = 0; count < 200 && seen.size < 3; count += 1) {
      const next = stepMatch(state), events = next.events.slice(state.events.length);
      const action = events.find(event => event.type === 'pass' || event.type === 'drive' || (event.type === 'command' && event.scene?.kind === 'setup'));
      if (action) {
        const seconds = state.clockSeconds - next.clockSeconds;
        expect(seconds).toBeGreaterThan(0);
        expect(next.shotClockSeconds).toBe(state.shotClockSeconds - seconds);
        expect(next.score).toEqual(state.score);
        for (const side of sides) {
          expect(next.courtSeconds[side] - state.courtSeconds[side]).toBe(seconds * state.lineups[side].length);
          for (const id of state.lineups[side]) {
            expect(next.stats[id]!.secondsPlayed - state.stats[id]!.secondsPlayed).toBe(seconds);
            expect(next.stats[id]!.condition).toBeLessThan(state.stats[id]!.condition);
          }
        }
        seen.add(action.type);
      }
      state = next;
    }
    expect([...seen].sort()).toEqual(['command', 'drive', 'pass']);
  });

  it('interrupts a longer non-shot action at the horn without completing it or fabricating a shot', () => {
    let state = fixture(51), checkedPass = false, checkedDrive = false;
    for (let count = 0; count < 800 && (!checkedPass || !checkedDrive); count += 1) {
      const next = stepMatch(state), events = next.events.slice(state.events.length);
      const action = events.find(event => event.type === 'pass' || event.type === 'drive');
      if (action && state.period === next.period && state.clockSeconds - next.clockSeconds > 1) {
        const short = { ...state, clockSeconds: 1 };
        const interrupted = stepMatch(short), newEvents = interrupted.events.slice(short.events.length);
        expect(interrupted.clockSeconds).toBe(0); expect(interrupted.phase).toBe('period-end');
        expect(newEvents.some(event => ['pass', 'drive', 'shot'].includes(event.type))).toBe(false);
        expect(interrupted.score).toEqual(short.score);
        for (const side of sides) expect(interrupted.courtSeconds[side] - short.courtSeconds[side]).toBe(short.lineups[side].length);
        if (action.type === 'pass') checkedPass = true; else checkedDrive = true;
      }
      state = next;
    }
    expect(checkedPass).toBe(true); expect(checkedDrive).toBe(true);
  });

  it('clears a prior pass credit when a legal substitution changes the active lineup', () => {
    const state = until(fixture(61, false), current => current.possessionPlay?.passerId != null);
    const offense = state.possession, outgoing = state.possessionPlay!.handlerId;
    const incoming = state[offense].players.find(player => !state.lineups[offense].includes(player.id))!.id;
    state.phase = 'dead-ball';
    state.stoppage = { reason: 'whistle', substitutionSides: ['home', 'away'], timeoutSides: ['home', 'away'] };
    const changed = substitutePlayer(state, offense, outgoing, incoming);
    expect(changed.lineups[offense]).toContain(incoming);
    expect(changed.possessionPlay?.passerId ?? null).toBeNull();
    const next = stepMatch(changed);
    expect(next.events.slice(changed.events.length).filter(event => event.assistPlayerId)).toHaveLength(0);
    if (next.possessionPlay) expect(next.possessionPlay.positions.some(position => position.playerId === outgoing)).toBe(false);
  });
});

describe('matchups, court positions and presentation independence', () => {
  function shootingFixture(): { state: MatchState; play: PossessionPlay } {
    const state = fixture(8);
    state.possession = 'home'; state.frontcourt = true;
    const play = createPossessionPlay(state);
    const shooter = play.positions.find(position => position.playerId === play.handlerId)!;
    shooter.x = .8; shooter.y = .5;
    const defenderId = play.matchups.find(pair => pair.attackerId === play.handlerId)!.defenderId;
    const defender = play.positions.find(position => position.playerId === defenderId)!;
    defender.x = shooter.x + .3 / 28; defender.y = shooter.y;
    return { state, play };
  }

  it('assigns stable active defenders by roles, including unequal lineups', () => {
    const state = fixture(5), before = JSON.stringify(state);
    const assignments = assignMatchups(freeze(state), 'home');
    expect(assignments).toEqual(assignMatchups(state, 'home'));
    expect(assignments.map(pair => pair.attackerId).sort()).toEqual([...state.lineups.home].sort());
    expect(new Set(assignments.map(pair => pair.defenderId)).size).toBe(5);
    for (const pair of assignments) expect(state.lineups.away).toContain(pair.defenderId);
    expect(JSON.stringify(state)).toBe(before);
    const short = { ...state, lineups: { home: [...state.lineups.home], away: state.lineups.away.slice(0, 2) } };
    const coverage = assignMatchups(short, 'home');
    expect(coverage).toHaveLength(5);
    for (const pair of coverage) expect(short.lineups.away).toContain(pair.defenderId);
  });

  it('uses assigned defender ability and real separation in shot probability without cosmetic input', () => {
    const { state, play } = shootingFixture();
    const close = shotContext(state, play);
    expect(close.contest).toBe('contested'); expect(close.separationM).toBeCloseTo(.3);
    const open = structuredClone(play);
    open.positions.find(position => position.playerId === close.defenderId)!.x = .8 + 2.5 / 28;
    const openContext = shotContext(state, open);
    expect(openContext.contest).toBe('open'); expect(openContext.makeChance).toBeGreaterThan(close.makeChance);
    const changeDefense = (id: string, defense: number): MatchState => ({ ...state, away: { ...state.away,
      players: state.away.players.map(player => player.id === id ? { ...player, attributes: { ...player.attributes, defense } } : player),
    } });
    expect(shotContext(changeDefense(close.defenderId, 20), play).makeChance).toBeLessThan(shotContext(changeDefense(close.defenderId, 1), play).makeChance);
    const reserve = state.away.players.find(player => !state.lineups.away.includes(player.id))!.id;
    expect(shotContext(changeDefense(reserve, 20), play)).toEqual(shotContext(changeDefense(reserve, 1), play));
    const frozenState = freeze(state), frozenPlay = freeze(play), before = JSON.stringify({ state, play });
    shotContext(frozenState, frozenPlay);
    expect(JSON.stringify({ state, play })).toBe(before);
  });

  it('derives shot distance and two/three-point value from the actual shooting location', () => {
    const { state, play } = shootingFixture();
    const origin = play.positions.find(position => position.playerId === play.handlerId)!;
    expect(shotContext(state, play).value).toBe(2);
    expect(shotContext(state, play).distanceM).toBeCloseTo(courtDistance(origin, hoopPosition(state, 'home')), 1);
    origin.x = .68;
    expect(shotContext(state, play).value).toBe(3);
    expect(shotContext(state, play).distanceM).toBeGreaterThan(6.75);
  });

  it('keeps sporting positions, shot context and each action scene aligned with the actual lineup', () => {
    let state = fixture(88), checked = 0, shots = 0;
    for (let step = 0; step < 5000 && state.status !== 'finished'; step += 1) {
      const next = stepMatch(state), events = next.events.slice(state.events.length);
      const lineups = { home: [...state.lineups.home], away: [...state.lineups.away] };
      for (const event of events) {
        if (event.type === 'substitution' && event.side && event.outgoingPlayerId) {
          lineups[event.side] = lineups[event.side].filter(id => id !== event.outgoingPlayerId);
          if (event.playerId) lineups[event.side].push(event.playerId);
        }
        if (!event.scene) continue;
        const active = [...lineups.home, ...lineups.away].sort();
        expect(event.scene.start.map(position => position.playerId).sort()).toEqual(active);
        expect(event.scene.end.map(position => position.playerId).sort()).toEqual(active);
        if (event.shot) {
          shots += 1;
          const origin = event.scene.start.find(position => position.playerId === event.playerId)!;
          expect(event.shot).toMatchObject({ x: origin.x, y: origin.y });
          expect(event.scene.ball.from).toMatchObject({ x: origin.x, y: origin.y });
          expect(lineups[other(event.side!)]).toContain(event.shot.defenderId);
          const defender = event.scene.start.find(position => position.playerId === event.shot!.defenderId)!;
          const separation = courtDistance(origin, defender);
          expect(event.shot.contest).toBe(separation <= .85 ? 'contested' : separation <= 1.75 ? 'pressured' : 'open');
          expect(event.shot.distanceM).toBeCloseTo(courtDistance(origin, hoopPosition({ ...next, period: event.period }, event.side!)), 1);
        }
      }
      const play = next.possessionPlay;
      if (play) {
        checked += 1;
        expect(play.offense).toBe(next.possession); expect(next.lineups[play.offense]).toContain(play.handlerId);
        expect(play.positions.map(position => position.playerId).sort()).toEqual([...next.lineups.home, ...next.lineups.away].sort());
        if (play.passerId) { expect(next.lineups[play.offense]).toContain(play.passerId); expect(play.passerId).not.toBe(play.handlerId); }
        for (const point of play.positions) {
          expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(1);
          expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThanOrEqual(1);
        }
        const scene = events.filter(event => event.scene).at(-1)?.scene;
        if (scene) expect(scene.end).toEqual(play.positions);
      }
      state = next;
    }
    expect(state.status).toBe('finished');
    expect(checked).toBeGreaterThan(100); expect(shots).toBeGreaterThan(100);
  }, 30_000);

  it('never reads historic cosmetic scenes to decide future sporting actions', () => {
    let shown = fixture(57), absent = stripScenes(shown);
    for (let step = 0; step < 5000 && shown.status !== 'finished'; step += 1) {
      shown = stepMatch(shown); absent = stripScenes(stepMatch(absent));
      expect(stripScenes(shown)).toEqual(absent);
    }
    expect(absent.status).toBe('finished');
  }, 30_000);

  it('preserves frozen action snapshots and does not consume RNG for instructions', () => {
    const state = freeze(until(fixture(7), current => current.possessionPlay != null && current.frontcourt));
    const before = JSON.stringify(state);
    const next = stepMatch(state);
    const changed = setTactics(state, 'home', { tempo: .8 });
    expect(JSON.stringify(state)).toBe(before); expect(next).not.toBe(state);
    expect(changed.rngState).toBe(state.rngState); expect(changed.stats).toEqual(state.stats);
  });
});

describe('independent tactical effects across paired seeds', () => {
  function comparison(control: keyof Tactics, teams: Side[], measure: (state: MatchState) => number, seeds = 24): [number, number] {
    const totals: [number, number] = [0, 0];
    for (let seed = 1; seed <= seeds; seed += 1) for (const value of [0, 1] as const) {
      let state = fixture(seed * 173);
      for (const side of teams) state = setTactics(state, side, { [control]: value });
      totals[value] += measure(simulateToEnd(state));
    }
    return totals;
  }
  const elapsed = (state: MatchState) => 2400 + Math.max(0, state.period - 4) * 300;

  it('increases actions per minute when only tempo increases', () => {
    const [slow, fast] = comparison('tempo', sides, state => state.stepCount / elapsed(state));
    expect(fast).toBeGreaterThan(slow);
  }, 90_000);

  it('increases actual three-point attempt share when only outside emphasis increases', () => {
    const [inside, outside] = comparison('outsideShare', ['home'], state => sum(state, 'home', 'threePointersAttempted') / sum(state, 'home', 'fieldGoalsAttempted'));
    expect(outside).toBeGreaterThan(inside);
  }, 90_000);

  it('trades increased disruption for fouls when only defensive pressure increases', () => {
    const totals = { fouls: [0, 0], turnovers: [0, 0] };
    for (let seed = 1; seed <= 30; seed += 1) for (const pressure of [0, 1] as const) {
      const final = simulateToEnd(setTactics(fixture(seed * 173), 'home', { pressure }));
      totals.fouls[pressure]! += sum(final, 'home', 'fouls') / elapsed(final);
      totals.turnovers[pressure]! += sum(final, 'away', 'turnovers') / elapsed(final);
    }
    expect(totals.fouls[1]).toBeGreaterThan(totals.fouls[0]!);
    expect(totals.turnovers[1]).toBeGreaterThan(totals.turnovers[0]!);
  }, 90_000);

  it('charges more fatigue for pressure over the same active exposure', () => {
    const initial = until(fixture(45, false), state => state.possessionPlay != null && state.frontcourt);
    // Frontcourt action duration belongs to the offense; change the defending side only.
    const defense = other(initial.possession), id = initial.lineups[defense][0]!;
    const low = stepMatch(setTactics(initial, defense, { pressure: 0 }));
    const high = stepMatch(setTactics(initial, defense, { pressure: 1 }));
    expect(high.stats[id]!.secondsPlayed).toBe(low.stats[id]!.secondsPlayed);
    expect(high.stats[id]!.condition).toBeLessThan(low.stats[id]!.condition);
  });
});

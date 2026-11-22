import type { CourtScene, MatchEvent, MatchState, Position, Side } from '../domain/types';
import { INJURY_KINDS, MATCH_INJURY_KINDS } from '../domain/injuries';
import { MAX_INJURY_RISK, MAX_MATCH_PERIODS } from '../engine/match';
import { COURT_POSITIONS } from '../engine/positions';
import { abilityShapeProblem } from '../world/extra-attributes';

const SIDES = ['home', 'away'] as const;
const ATTRIBUTE_KEYS = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
const STAT_KEYS = [
  'secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted',
  'threePointersMade', 'threePointersAttempted', 'freeThrowsMade', 'freeThrowsAttempted',
  'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls', 'condition',
];
const EVENT_TYPES = ['tipoff', 'pass', 'drive', 'shot', 'free-throw', 'turnover', 'foul', 'rebound', 'period-end', 'period-start', 'final', 'substitution', 'tactics', 'foul-out', 'injury', 'timeout', 'command', 'shot-clock', 'held-ball'];

function fail(path: string, reason: string): never {
  throw new Error(`Invalid match save: ${path} ${reason}.`);
}

function record(value: unknown, path: string, required?: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const result = value as Record<string, unknown>;
  if (required) {
    if (required.some((key) => !Object.hasOwn(result, key))) fail(path, 'has missing fields');
    if (Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))) fail(path, 'has unsupported fields');
  }
  return result;
}

function number(value: unknown, path: string, min: number, max: number, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(path, `must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return value;
}

function string(value: unknown, path: string, max = 120): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(path, 'must be a nonempty, bounded text value');
  }
  return value;
}

function id(value: unknown, path: string): string {
  const result = string(value, path, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(result) || ['__proto__', 'prototype', 'constructor'].includes(result)) fail(path, 'is not a supported identifier');
  return result;
}

function color(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/iu.test(value)) fail(path, 'must be a six-digit hex colour');
}

function choice(value: unknown, allowed: readonly unknown[], path: string): void {
  if (!allowed.includes(value)) fail(path, 'has an unsupported value');
}

function boolean(value: unknown, path: string): void {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
}

function sides(value: unknown, path: string): unknown[] {
  const values = array(value, path, 0, 2);
  if (new Set(values).size !== values.length) fail(path, 'contains duplicate teams');
  for (const entry of values) choice(entry, SIDES, path);
  return values;
}

function array(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `must contain between ${min} and ${max} entries`);
  return value;
}

function score(value: unknown, path: string): { home: number; away: number } {
  const fields = record(value, path, SIDES);
  return { home: number(fields.home, `${path}.home`, 0, 1_000_000), away: number(fields.away, `${path}.away`, 0, 1_000_000) };
}

function elapsed(period: number, clock: number): number {
  return period <= 4 ? period * 600 - clock : 2400 + (period - 4) * 300 - clock;
}

/** Live possession geometry is simulation state, never reconstructed from animation. */
function possessionPlay(value: unknown, state: Record<string, unknown>, lineups: Record<Side, string[]>): void {
  if (value === null) return;
  const play = record(value, 'possessionPlay', ['offense', 'handlerId', 'passerId', 'actions', 'positions', 'matchups']);
  choice(play.offense, SIDES, 'possessionPlay.offense');
  if (play.offense !== state.possession) fail('possessionPlay.offense', 'must match the current possession');
  if (state.status === 'finished' || state.phase === 'free-throws' || state.phase === 'period-end' || (state.requiredSubstitutions as unknown[]).length) fail('possessionPlay', 'must be cleared at this stopped-play boundary');
  const offense = play.offense as Side;
  const defense = offense === 'home' ? 'away' : 'home';
  const attackers = new Set(lineups[offense]);
  const defenders = new Set(lineups[defense]);
  const handlerId = id(play.handlerId, 'possessionPlay.handlerId');
  if (!attackers.has(handlerId)) fail('possessionPlay.handlerId', 'must be an active attacking player');
  if (play.passerId !== null) {
    const passerId = id(play.passerId, 'possessionPlay.passerId');
    if (!attackers.has(passerId) || passerId === handlerId) fail('possessionPlay.passerId', 'must be a different active attacking player');
  }
  number(play.actions, 'possessionPlay.actions', 0, Math.min(24, state.stepCount as number));
  const expectedActors = new Set([...attackers, ...defenders]);
  const actors = new Set<string>();
  for (const [index, value] of array(play.positions, 'possessionPlay.positions', expectedActors.size, expectedActors.size).entries()) {
    const path = `possessionPlay.positions[${index}]`;
    const position = record(value, path, ['playerId', 'x', 'y']);
    const playerId = id(position.playerId, `${path}.playerId`);
    if (!expectedActors.has(playerId) || actors.has(playerId)) fail(path, 'must identify each current active player exactly once');
    actors.add(playerId);
    number(position.x, `${path}.x`, 0, 1, false);
    number(position.y, `${path}.y`, 0, 1, false);
  }
  const assignedAttackers = new Set<string>();
  const assignedDefenders = new Set<string>();
  for (const [index, value] of array(play.matchups, 'possessionPlay.matchups', attackers.size, attackers.size).entries()) {
    const path = `possessionPlay.matchups[${index}]`;
    const matchup = record(value, path, ['attackerId', 'defenderId']);
    const attackerId = id(matchup.attackerId, `${path}.attackerId`);
    const defenderId = id(matchup.defenderId, `${path}.defenderId`);
    if (!attackers.has(attackerId) || assignedAttackers.has(attackerId)) fail(path, 'must assign every active attacker exactly once');
    if (!defenders.has(defenderId)) fail(path, 'must assign an active opposing defender');
    if (defenders.size >= attackers.size && assignedDefenders.has(defenderId)) fail(path, 'must use distinct defenders when enough are available');
    assignedAttackers.add(attackerId);
    assignedDefenders.add(defenderId);
  }
}

/** Presentation metadata is optional, but a supplied scene must be complete. */
function courtScene(value: unknown, path: string, event: Record<string, unknown>, playerIds: Record<Side, Set<string>>): void {
  const scene = record(value, path, ['kind', 'durationMs', 'offense', 'start', 'end', 'ball']);
  const allowedKinds: Record<string, string> = {
    tipoff: 'setup', command: 'setup', 'period-start': 'setup', substitution: 'setup', pass: 'pass', drive: 'drive', shot: 'shot',
    'free-throw': 'free-throw', rebound: 'rebound', turnover: 'turnover', 'shot-clock': 'turnover',
  };
  if (!allowedKinds[event.type as string] || scene.kind !== allowedKinds[event.type as string]) fail(`${path}.kind`, 'does not match its action');
  number(scene.durationMs, `${path}.durationMs`, 250, 3000);
  choice(scene.offense, SIDES, `${path}.offense`);
  if (['pass', 'drive', 'shot', 'free-throw', 'turnover', 'shot-clock'].includes(event.type as string) && scene.offense !== event.side) fail(`${path}.offense`, 'must match the acting team');
  const positionIds: Record<'start' | 'end', Set<string>> = { start: new Set(), end: new Set() };
  for (const endpoint of ['start', 'end'] as const) {
    const counts = { home: 0, away: 0 };
    for (const [index, value] of array(scene[endpoint], `${path}.${endpoint}`, 0, 10).entries()) {
      const positionPath = `${path}.${endpoint}[${index}]`;
      const position = record(value, positionPath, ['playerId', 'x', 'y']);
      const playerId = id(position.playerId, `${positionPath}.playerId`);
      const side = SIDES.find((side) => playerIds[side].has(playerId));
      if (!side) fail(positionPath, 'references an unknown player');
      if (positionIds[endpoint].has(playerId)) fail(positionPath, 'duplicates an actor');
      positionIds[endpoint].add(playerId);
      if (++counts[side] > 5) fail(`${path}.${endpoint}`, 'places more than five players from one team on court');
      number(position.x, `${positionPath}.x`, 0, 1, false);
      number(position.y, `${positionPath}.y`, 0, 1, false);
    }
  }
  if (positionIds.start.size !== positionIds.end.size || [...positionIds.start].some((playerId) => !positionIds.end.has(playerId))) fail(path, 'must preserve the same actors throughout an action');
  const ball = record(scene.ball, `${path}.ball`, ['from', 'to', 'arcHeight']);
  for (const endpoint of ['from', 'to']) {
    const point = record(ball[endpoint], `${path}.ball.${endpoint}`, ['x', 'y', 'height']);
    number(point.x, `${path}.ball.${endpoint}.x`, 0, 1, false);
    number(point.y, `${path}.ball.${endpoint}.y`, 0, 1, false);
    number(point.height, `${path}.ball.${endpoint}.height`, 0, 8, false);
  }
  number(ball.arcHeight, `${path}.ball.arcHeight`, 0, 8, false);
  const validated = scene as unknown as CourtScene;
  if (event.type === 'shot') {
    const shot = event.shot as NonNullable<MatchEvent['shot']>;
    if (validated.ball.from.x !== shot.x || validated.ball.from.y !== shot.y) fail(`${path}.ball.from`, 'must match the recorded shot location');
    if (shot.defenderId) {
      const shooter = validated.start.find((actor) => actor.playerId === event.playerId);
      const defender = validated.start.find((actor) => actor.playerId === shot.defenderId);
      if (!shooter || shooter.x !== shot.x || shooter.y !== shot.y || !defender) fail(path, 'must show the shooter and defender at the recorded release');
      const separation = Math.hypot((shooter.x - defender.x) * 28, (shooter.y - defender.y) * 15);
      const contest = separation <= 0.85 ? 'contested' : separation <= 1.75 ? 'pressured' : 'open';
      if (shot.contest !== contest) fail(path, 'does not match the recorded defensive contest');
    }
  }
  if (event.type === 'pass') {
    const passer = validated.start.find((actor) => actor.playerId === event.playerId);
    const receiver = validated.end.find((actor) => actor.playerId === event.receiverId);
    if (!passer || !receiver || validated.ball.from.x !== passer.x || validated.ball.from.y !== passer.y || validated.ball.to.x !== receiver.x || validated.ball.to.y !== receiver.y) fail(`${path}.ball`, 'must travel from the passer to the receiver');
  }
  if (event.type === 'drive') {
    const start = validated.start.find((actor) => actor.playerId === event.playerId);
    const end = validated.end.find((actor) => actor.playerId === event.playerId);
    if (!start || !end || validated.ball.from.x !== start.x || validated.ball.from.y !== start.y || validated.ball.to.x !== end.x || validated.ball.to.y !== end.y) fail(`${path}.ball`, 'must travel with the driving player');
  }
}

/** Recover historical active players without assuming the original starting five. */
function sceneLineups(events: MatchEvent[], currentLineups: Record<Side, string[]>, finished: boolean, modern: boolean, play: MatchState['possessionPlay']): void {
  if (!modern && !events.some((event) => event.scene || event.type === 'pass')) return;
  const active = { home: new Set(currentLineups.home), away: new Set(currentLineups.away) };
  if (finished) {
    // Finishing can remove excluded players without emitting another substitution.
    // An exclusion after the player's last departure means they were still active.
    const lastDepartures = new Map<string, number>();
    for (const event of events) if (event.type === 'substitution') lastDepartures.set(event.outgoingPlayerId!, event.id);
    for (const event of events) {
      if ((event.type === 'foul-out' || event.type === 'injury') && event.id > (lastDepartures.get(event.playerId!) ?? 0)) active[event.side!].add(event.playerId!);
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type !== 'substitution') continue;
    const lineup = active[event.side!];
    if (event.playerId && !lineup.delete(event.playerId)) fail(`events[${index}]`, 'does not reconcile with subsequent active players');
    if (lineup.has(event.outgoingPlayerId!)) fail(`events[${index}]`, 'removes a player who was already on the bench');
    lineup.add(event.outgoingPlayerId!);
    if (lineup.size > 5) fail(`events[${index}]`, 'does not reconcile with five active players');
  }
  let lastPass: MatchEvent | null = null;
  for (const [index, event] of events.entries()) {
    if (event.type === 'substitution') {
      active[event.side!].delete(event.outgoingPlayerId!);
      if (event.playerId) active[event.side!].add(event.playerId);
    }
    if (event.type === 'pass' && (!active[event.side!].has(event.playerId!) || !active[event.side!].has(event.receiverId!))) fail(`events[${index}]`, 'must pass between active players');
    if (modern) {
      if (['drive', 'shot'].includes(event.type) && !active[event.side!].has(event.playerId!)) fail(`events[${index}]`, 'must act through an active player');
      if (event.type === 'shot') {
        const defense = event.side === 'home' ? 'away' : 'home';
        if (!active[defense].has(event.shot!.defenderId!)) fail(`events[${index}].shot.defenderId`, 'must identify an active opposing defender');
      }
      if (event.assistPlayerId && (!active[event.side!].has(event.assistPlayerId) || !lastPass || lastPass.side !== event.side || lastPass.receiverId !== event.playerId || lastPass.playerId !== event.assistPlayerId)) fail(`events[${index}].assistPlayerId`, 'must credit the active player who completed the preceding pass to this shooter');
      if (event.type === 'pass') lastPass = event;
      // Sprint 4: the receiver's drive keeps the pass's assist credit (catch and drive).
      else if (event.type === 'drive' && lastPass && lastPass.side === event.side && lastPass.receiverId === event.playerId) { /* the pass still counts */ }
      else if (!['tactics', 'command'].includes(event.type) || (event.type === 'command' && (event.scene || event.period !== events[index - 1]?.period || event.clockSeconds !== events[index - 1]?.clockSeconds))) lastPass = null;
    }
    if (!event.scene) continue;
    const expected = new Set([...active.home, ...active.away]);
    const actual = event.scene.start.map((position) => position.playerId);
    if (actual.length !== expected.size || actual.some((playerId) => !expected.has(playerId))) fail(`events[${index}].scene`, 'must show the active players at this point in the match');
  }
  if (modern && play?.passerId && (!lastPass || lastPass.side !== play.offense || lastPass.playerId !== play.passerId || lastPass.receiverId !== play.handlerId)) fail('possessionPlay.passerId', 'must match the last completed pass to the current handler');
}

/** Validates a complete rules-engine snapshot without coercion or mutation. */
export function validateMatchState(value: unknown): asserts value is MatchState {
  const candidate = record(value, 'state');
  if (candidate.schemaVersion === 1 || candidate.engineVersion === 'prototype-1') {
    fail('state', 'belongs to the earlier prototype engine; keep that save and start a new exhibition');
  }
  const modern = candidate.engineVersion === 'possession-3';
  const state = record(value, 'state', [
    'schemaVersion', 'engineVersion', 'seed', 'rngState', 'home', 'away', 'score',
    'period', 'clockSeconds', 'status', 'phase', 'possession', 'lineups', 'tactics', 'stats', 'events', 'stepCount',
    'possessionArrow', 'shotClockSeconds', 'frontcourt', 'teamFouls', 'timeoutUsage', 'timeoutRequested',
    'pendingSubstitutions', 'requiredSubstitutions', 'freeThrows', 'stoppage', 'substitutionLocks',
    'autoSubstitutions', 'injuryMode', 'injuries', 'courtSeconds', 'result',
    ...(modern ? ['possessionPlay'] : []),
  ], modern ? ['preExistingInjuries', 'morale', 'injuryRisk', 'slots', 'startingSlots', 'playModel', 'computerCoach'] : []);
  if (state.schemaVersion !== 2 || !['rules-2', 'possession-3'].includes(state.engineVersion as string)) fail('state', 'uses an unsupported schema or engine version');
  // Format 79: the richer play model, with the sides a computer coach runs.
  if (Object.hasOwn(state, 'playModel') && state.playModel !== 'plays-2') fail('playModel', 'must be plays-2 when recorded');
  if (Object.hasOwn(state, 'computerCoach')) {
    const coached = state.computerCoach;
    if (!Object.hasOwn(state, 'playModel') || !Array.isArray(coached) || coached.length > 2 || new Set(coached).size !== coached.length || coached.some(side => !SIDES.includes(side as Side))) fail('computerCoach', 'must name distinct teams of a match with the play model');
  } else if (Object.hasOwn(state, 'playModel')) fail('computerCoach', 'must be recorded with the play model');
  number(state.seed, 'seed', 0, 0xffff_ffff);
  number(state.rngState, 'rngState', 1, 0xffff_ffff);
  const period = number(state.period, 'period', 1, MAX_MATCH_PERIODS);
  const clock = number(state.clockSeconds, 'clockSeconds', 0, period <= 4 ? 600 : 300);
  const played = elapsed(period, clock);
  const steps = number(state.stepCount, 'stepCount', 0, 100_000);
  if (steps > played) fail('stepCount', 'exceeds the elapsed seconds');
  choice(state.status, ['ready', 'playing', 'finished'], 'status');
  choice(state.phase, ['live-ball', 'dead-ball', 'free-throws', 'period-end'], 'phase');
  choice(state.possession, SIDES, 'possession');
  choice(state.possessionArrow, SIDES, 'possessionArrow');
  number(state.shotClockSeconds, 'shotClockSeconds', 0, 24);
  if (modern && state.status !== 'finished' && ['live-ball', 'dead-ball'].includes(state.phase as string) && state.shotClockSeconds === 0) fail('shotClockSeconds', 'must be positive before the next live action');
  boolean(state.frontcourt, 'frontcourt');
  choice(state.injuryMode, ['standard', 'reduced', 'off'], 'injuryMode');
  const currentScore = score(state.score, 'score');
  if (state.status === 'ready' && (period !== 1 || clock !== 600 || steps !== 0)) fail('ready match', 'must be at its initial clock');
  if (state.status === 'ready' && (currentScore.home !== 0 || currentScore.away !== 0)) fail('ready match', 'must begin with a zero score');
  const preMatchDefault = modern && Object.hasOwn(state, 'preExistingInjuries') && state.status === 'finished' && steps === 0 && played === 0;
  if (!preMatchDefault && state.status !== 'ready' && steps === 0) fail('stepCount', 'must advance when a match has started');
  if (!preMatchDefault && state.status !== 'ready' && played === 0) fail('clockSeconds', 'must advance when a match has started');
  if (state.phase === 'period-end' && clock !== 0) fail('phase', 'cannot end a period with time remaining');
  if (state.phase === 'live-ball' && clock === 0) fail('phase', 'cannot be live with an expired game clock');
  let result: Record<string, unknown> | null = null;
  if (state.result !== null) {
    result = record(state.result, 'result', ['winner', 'kind', 'officialScore']);
    choice(result.winner, SIDES, 'result.winner');
    choice(result.kind, ['normal', 'default'], 'result.kind');
    const officialScore = score(result.officialScore, 'result.officialScore');
    const winner = result.winner as 'home' | 'away';
    const loser = winner === 'home' ? 'away' : 'home';
    if (officialScore[winner] <= officialScore[loser]) fail('result', 'must identify the winning team');
    if (result.kind === 'normal') {
      if (period < 4 || clock !== 0 || currentScore[winner] <= currentScore[loser]) fail('result', 'must have a winner at a completed final period');
      if (officialScore.home !== currentScore.home || officialScore.away !== currentScore.away) fail('result.officialScore', 'must equal the played score for a normal result');
    } else {
      const expected = currentScore[winner] > currentScore[loser] ? currentScore : { [winner]: 2, [loser]: 0 };
      if (officialScore.home !== expected.home || officialScore.away !== expected.away) fail('result.officialScore', 'must preserve a leading winner or award 2-0 after a default');
    }
  }
  if (preMatchDefault && (result?.kind !== 'default' || currentScore.home !== 0 || currentScore.away !== 0)) fail('result', 'must be a scoreless pre-match default');
  if ((state.status === 'finished') !== (result !== null)) fail('result', 'must exist exactly when the match is finished');

  const allIds = new Set<string>();
  const playerIds: Record<'home' | 'away', Set<string>> = { home: new Set(), away: new Set() };
  const teamIds = new Set<string>();
  for (const side of SIDES) {
    const team = record(state[side], side, ['id', 'name', 'shortName', 'color', 'players']);
    const teamId = id(team.id, `${side}.id`);
    if (teamIds.has(teamId)) fail('teams', 'must have distinct identities');
    teamIds.add(teamId);
    string(team.name, `${side}.name`);
    string(team.shortName, `${side}.shortName`, 12);
    color(team.color, `${side}.color`);
    const jerseys = new Set<number>();
    for (const [index, entry] of array(team.players, `${side}.players`, 5, 20).entries()) {
      const path = `${side}.players[${index}]`;
      const player = record(entry, path, ['id', 'name', 'number', 'position', 'heightCm', 'weightKg', 'skinTone', 'hairColor', 'attributes']);
      const playerId = id(player.id, `${path}.id`);
      if (allIds.has(playerId)) fail('players', 'contain a duplicate identity');
      allIds.add(playerId);
      playerIds[side].add(playerId);
      string(player.name, `${path}.name`);
      const jersey = number(player.number, `${path}.number`, 0, 99);
      if (jerseys.has(jersey)) fail(path, 'has a duplicate team jersey number');
      jerseys.add(jersey);
      choice(player.position, ['PG', 'SG', 'SF', 'PF', 'C'], `${path}.position`);
      number(player.heightCm, `${path}.heightCm`, 120, 260);
      number(player.weightKg, `${path}.weightKg`, 35, 250, false);
      color(player.skinTone, `${path}.skinTone`);
      color(player.hairColor, `${path}.hairColor`);
      const problem = abilityShapeProblem(player.attributes, ATTRIBUTE_KEYS);
      if (problem) fail(`${path}.attributes`, problem);
    }
  }

  if (Object.hasOwn(state, 'morale')) {
    const morale = record(state.morale, 'morale', ['model', 'eventCount', 'values']);
    choice(morale.model, ['morale-1'], 'morale.model');
    number(morale.eventCount, 'morale.eventCount', 1, 1_000_000);
    const values = record(morale.values, 'morale.values', [...allIds]);
    for (const playerId of allIds) number(values[playerId], `morale.values.${playerId}`, 0, 100);
  }
  const lineups = record(state.lineups, 'lineups', SIDES);
  const tactics = record(state.tactics, 'tactics', SIDES);
  const stats = record(state.stats, 'stats', [...allIds]);
  const injuries = record(state.injuries, 'injuries');
  const preExisting = new Set<string>();
  if (Object.hasOwn(state, 'preExistingInjuries')) {
    for (const value of array(state.preExistingInjuries, 'preExistingInjuries', 1, allIds.size)) {
      const playerId = id(value, 'preExistingInjuries');
      if (!allIds.has(playerId) || preExisting.has(playerId) || !Object.hasOwn(injuries, playerId)) fail('preExistingInjuries', 'must identify distinct known injured players');
      preExisting.add(playerId);
    }
  }
  for (const [playerId, value] of Object.entries(injuries)) {
    if (!allIds.has(playerId)) fail('injuries', 'references an unknown player');
    const injury = record(value, `injuries.${playerId}`, ['kind', 'occurredAtSeconds']);
    choice(injury.kind, INJURY_KINDS, `injuries.${playerId}.kind`);
    number(injury.occurredAtSeconds, `injuries.${playerId}.occurredAtSeconds`, 0, played);
    if (preExisting.has(playerId) && injury.occurredAtSeconds !== 0) fail(`injuries.${playerId}`, 'must record carried unavailability at zero elapsed match time');
    if (state.status === 'ready' && !preExisting.has(playerId)) fail('injuries', 'cannot introduce a new injury before play begins');
  }
  if (Object.hasOwn(state, 'injuryRisk')) {
    const risks = record(state.injuryRisk, 'injuryRisk');
    if (!Object.keys(risks).length) fail('injuryRisk', 'must identify at least one player');
    for (const [playerId, value] of Object.entries(risks)) {
      if (!allIds.has(playerId)) fail('injuryRisk', 'references an unknown player');
      const risk = record(value, `injuryRisk.${playerId}`);
      if (!Object.keys(risk).length) fail(`injuryRisk.${playerId}`, 'must name at least one injury kind');
      for (const [kind, multiplier] of Object.entries(risk)) {
        choice(kind, MATCH_INJURY_KINDS, `injuryRisk.${playerId}`);
        number(multiplier, `injuryRisk.${playerId}.${kind}`, Number.MIN_VALUE, MAX_INJURY_RISK, false);
      }
    }
  }
  const courtSeconds = record(state.courtSeconds, 'courtSeconds', SIDES);
  const teamFouls = record(state.teamFouls, 'teamFouls', SIDES);
  const timeoutUsage = record(state.timeoutUsage, 'timeoutUsage', SIDES);
  const timeoutRequested = record(state.timeoutRequested, 'timeoutRequested', SIDES);
  const autoSubstitutions = record(state.autoSubstitutions, 'autoSubstitutions', SIDES);
  const eligibleCounts = { home: 0, away: 0 };
  for (const side of SIDES) {
    const lineup = array(lineups[side], `lineups.${side}`, state.status === 'finished' ? 0 : 2, 5);
    if (new Set(lineup).size !== lineup.length || lineup.some((playerId) => typeof playerId !== 'string' || !playerIds[side].has(playerId))) {
      fail(`lineups.${side}`, 'must contain unique players from that team');
    }
    if (lineup.some(playerId => preExisting.has(playerId as string))) fail(`lineups.${side}`, 'cannot include a player unavailable before tipoff');
    const availableAtStart = [...playerIds[side]].filter(playerId => !preExisting.has(playerId)).length;
    if (state.status === 'ready' && lineup.length !== Math.min(5, availableAtStart)) fail(`lineups.${side}`, 'must start with five players unless carried injuries leave fewer available');
    number(courtSeconds[side], `courtSeconds.${side}`, 0, played * 5);
    number(teamFouls[side], `teamFouls.${side}`, 0, playerIds[side].size * 5);
    boolean(timeoutRequested[side], `timeoutRequested.${side}`);
    boolean(autoSubstitutions[side], `autoSubstitutions.${side}`);
    const usage = record(timeoutUsage[side], `timeoutUsage.${side}`, ['firstHalf', 'secondHalf', 'overtime', 'lateFourth']);
    number(usage.firstHalf, `timeoutUsage.${side}.firstHalf`, 0, 2);
    const secondHalf = number(usage.secondHalf, `timeoutUsage.${side}.secondHalf`, 0, period < 3 ? 0 : 3);
    number(usage.overtime, `timeoutUsage.${side}.overtime`, 0, period <= 4 ? 0 : 1);
    number(usage.lateFourth, `timeoutUsage.${side}.lateFourth`, 0, period < 4 ? 0 : Math.min(2, secondHalf));
    const instructions = record(tactics[side], `tactics.${side}`, ['tempo', 'outsideShare', 'pressure']);
    for (const key of ['tempo', 'outsideShare', 'pressure']) number(instructions[key], `tactics.${side}.${key}`, 0, 1, false);
    let teamPoints = 0;
    let teamSeconds = 0;
    for (const playerId of playerIds[side]) {
      const path = `stats.${playerId}`;
      const entry = record(stats[playerId], path, STAT_KEYS);
      for (const key of STAT_KEYS) {
        if (key === 'condition') number(entry[key], `${path}.${key}`, 0, 100, false);
        else number(entry[key], `${path}.${key}`, 0, key === 'secondsPlayed' ? played : key === 'fouls' ? 5 : 1_000_000);
      }
      const stat = entry as unknown as MatchState['stats'][string];
      if ((state.status === 'ready' || preMatchDefault || preExisting.has(playerId)) && STAT_KEYS.some((key) => key !== 'condition' && entry[key] !== 0)) fail(path, 'must have zero statistics before play or while unavailable before tipoff');
      if (stat.fieldGoalsMade > stat.fieldGoalsAttempted || stat.threePointersMade > stat.threePointersAttempted || stat.freeThrowsMade > stat.freeThrowsAttempted) fail(path, 'has more made shots than attempts');
      if (stat.threePointersMade > stat.fieldGoalsMade || stat.threePointersAttempted > stat.fieldGoalsAttempted || stat.fieldGoalsMade - stat.threePointersMade > stat.fieldGoalsAttempted - stat.threePointersAttempted) fail(path, 'has inconsistent two-point and three-point totals');
      if (stat.points !== 2 * stat.fieldGoalsMade + stat.threePointersMade + stat.freeThrowsMade) fail(path, 'has points inconsistent with shooting totals');
      teamPoints += stat.points;
      teamSeconds += stat.secondsPlayed;
      if (stat.fouls < 5 && !Object.hasOwn(injuries, playerId)) eligibleCounts[side] += 1;
    }
    if (teamPoints !== currentScore[side]) fail(`score.${side}`, 'does not match player points');
    if (teamSeconds !== courtSeconds[side]) fail(`stats.${side}`, 'does not reconcile with integrated court exposure');
    if (eligibleCounts[side] >= 5 && teamSeconds !== played * 5) fail(`stats.${side}`, 'does not reconcile with five available players and elapsed time');
  }

  const isEligible = (playerId: string) => (stats[playerId] as MatchState['stats'][string]).fouls < 5 && !Object.hasOwn(injuries, playerId);
  const required = array(state.requiredSubstitutions, 'requiredSubstitutions', 0, 10);
  const requiredIds = new Set<string>();
  for (const [index, entry] of required.entries()) {
    const path = `requiredSubstitutions[${index}]`;
    const decision = record(entry, path, ['side', 'playerId', 'reason']);
    choice(decision.side, SIDES, `${path}.side`);
    choice(decision.reason, ['fouled-out', 'injured'], `${path}.reason`);
    const playerId = id(decision.playerId, `${path}.playerId`);
    const side = decision.side as 'home' | 'away';
    if (!playerIds[side].has(playerId) || !(lineups[side] as unknown[]).includes(playerId)) fail(path, 'must identify an active player from its team');
    if (requiredIds.has(playerId)) fail(path, 'duplicates a pending replacement');
    requiredIds.add(playerId);
    if (decision.reason === 'fouled-out' && (stats[playerId] as MatchState['stats'][string]).fouls !== 5) fail(path, 'requires five personal fouls');
    if (decision.reason === 'injured' && !Object.hasOwn(injuries, playerId)) fail(path, 'requires a recorded injury');
    if (state.phase === 'live-ball') fail(path, 'cannot await a replacement during live play');
  }
  for (const side of SIDES) {
    for (const playerId of lineups[side] as string[]) {
      if (!isEligible(playerId) && !requiredIds.has(playerId)) fail(`lineups.${side}`, 'contains an ineligible player without a required replacement');
    }
    if (state.status !== 'finished' && eligibleCounts[side] >= 5 && (lineups[side] as string[]).length !== 5) fail(`lineups.${side}`, 'must use five players when enough eligible players remain');
  }
  if (result?.kind === 'default') {
    const loser = result.winner === 'home' ? 'away' : 'home';
    if (eligibleCounts[loser] >= 2) fail('result', 'cannot declare a default with two eligible players remaining');
  }

  const pending = record(state.pendingSubstitutions, 'pendingSubstitutions', SIDES);
  for (const side of SIDES) {
    const requests = array(pending[side], `pendingSubstitutions.${side}`, 0, 5);
    const used = new Set<string>();
    for (const [index, entry] of requests.entries()) {
      const path = `pendingSubstitutions.${side}[${index}]`;
      const request = record(entry, path, ['outId', 'inId']);
      const outId = id(request.outId, `${path}.outId`);
      const inId = id(request.inId, `${path}.inId`);
      if (!playerIds[side].has(outId) || !playerIds[side].has(inId)) fail(path, 'must reference players from its team');
      if (!(lineups[side] as string[]).includes(outId) || (lineups[side] as string[]).includes(inId)) fail(path, 'must replace an active player with a bench player');
      if (!isEligible(inId)) fail(path, 'cannot introduce an ineligible player');
      if (used.has(outId) || used.has(inId) || outId === inId) fail(path, 'overlaps another queued substitution');
      used.add(outId); used.add(inId);
    }
    if (state.status === 'finished' && (requests.length > 0 || timeoutRequested[side])) fail('pending commands', 'must be cleared when the match finishes');
  }
  if (state.status === 'finished' && required.length > 0) fail('requiredSubstitutions', 'must be cleared when the match finishes');
  // Format 74: the court picture's chosen circles, for players on court (one different position each) and reserves
  // queued for a circle; the chosen circles when the clock first ran are kept once play has started.
  if (Object.hasOwn(state, 'slots')) {
    const slots = record(state.slots, 'slots');
    if (!Object.keys(slots).length || Object.keys(slots).some(side => !SIDES.includes(side as Side))) fail('slots', 'must name the teams that use the court picture');
    for (const [side, value] of Object.entries(slots)) {
      const circles = record(value, `slots.${side}`), onCourt = Object.keys(circles).filter(playerId => (lineups[side] as string[]).includes(playerId));
      const queued = ((pending as Record<string, unknown>)[side] as { inId: string }[]).map(request => request.inId);
      if (Object.keys(circles).some(playerId => !onCourt.includes(playerId) && !queued.includes(playerId)) || new Set(onCourt.map(playerId => circles[playerId])).size !== onCourt.length || Object.values(circles).some(position => !COURT_POSITIONS.includes(position as Position))) fail(`slots.${side}`, 'must give players on court a different court position each, or a queued reserve his circle');
    }
  }
  if (Object.hasOwn(state, 'startingSlots')) {
    const starting = record(state.startingSlots, 'startingSlots');
    if (steps === 0 || !Object.hasOwn(state, 'slots')) fail('startingSlots', 'are kept only once play has started with the court picture');
    for (const [side, value] of Object.entries(starting)) {
      if (!SIDES.includes(side as Side) || !Object.hasOwn(state.slots as object, side)) fail('startingSlots', 'must name a team that uses the court picture');
      const circles = record(value, `startingSlots.${side}`);
      if (Object.keys(circles).length > 5 || Object.keys(circles).some(playerId => !playerIds[side as Side].has(playerId)) || new Set(Object.values(circles)).size !== Object.keys(circles).length || Object.values(circles).some(position => !COURT_POSITIONS.includes(position as Position))) fail(`startingSlots.${side}`, 'must give up to five players of the team different court positions');
    }
  }
  if (modern) possessionPlay(state.possessionPlay, state, lineups as Record<Side, string[]>);

  const locks = array(state.substitutionLocks, 'substitutionLocks', 0, allIds.size);
  if (new Set(locks).size !== locks.length || locks.some((playerId) => typeof playerId !== 'string' || !allIds.has(playerId))) fail('substitutionLocks', 'must contain unique known player identities');
  if (state.freeThrows !== null) {
    const throws = record(state.freeThrows, 'freeThrows', ['side', 'shooterId', 'total', 'remaining']);
    choice(throws.side, SIDES, 'freeThrows.side');
    const side = throws.side as 'home' | 'away';
    if (side !== state.possession) fail('freeThrows.side', 'must match the team awarded the pending possession');
    const shooterId = id(throws.shooterId, 'freeThrows.shooterId');
    if (!playerIds[side].has(shooterId) || !(lineups[side] as string[]).includes(shooterId)) fail('freeThrows.shooterId', 'must be an active player from the shooting team');
    if (!isEligible(shooterId) && !requiredIds.has(shooterId)) fail('freeThrows.shooterId', 'must be eligible or awaiting mandatory replacement');
    const total = number(throws.total, 'freeThrows.total', 1, 3);
    number(throws.remaining, 'freeThrows.remaining', 1, total);
    if (state.phase !== 'free-throws') fail('freeThrows', 'requires the free-throws phase');
  } else if (state.phase === 'free-throws') fail('phase', 'requires an outstanding free-throw sequence');
  if (state.status === 'finished' && state.freeThrows !== null) fail('freeThrows', 'must be resolved before the match finishes');

  if (state.stoppage !== null) {
    const stoppage = record(state.stoppage, 'stoppage', ['reason', 'substitutionSides', 'timeoutSides']);
    choice(stoppage.reason, ['pre-game', 'whistle', 'made-basket', 'free-throws', 'period-end', 'timeout'], 'stoppage.reason');
    const substitutionSides = sides(stoppage.substitutionSides, 'stoppage.substitutionSides');
    const timeoutSides = sides(stoppage.timeoutSides, 'stoppage.timeoutSides');
    const madeBasket = stoppage.reason === 'made-basket';
    const expectedSubstitutions: readonly unknown[] = madeBasket ? (period >= 4 && clock <= 120 ? [state.possession] : []) : SIDES;
    const expectedTimeouts: readonly unknown[] = madeBasket ? [state.possession]
      : ['pre-game', 'period-end'].includes(stoppage.reason as string) || steps === 0 || clock === 0 ? [] : SIDES;
    if (substitutionSides.length !== expectedSubstitutions.length || substitutionSides.some((side) => !expectedSubstitutions.includes(side))) fail('stoppage.substitutionSides', 'does not match the legal opportunity');
    if (timeoutSides.length !== expectedTimeouts.length || timeoutSides.some((side) => !expectedTimeouts.includes(side))) fail('stoppage.timeoutSides', 'does not match the legal opportunity');
    if (state.phase === 'live-ball' && stoppage.reason !== 'made-basket') fail('stoppage', 'cannot grant a stopped-clock opportunity during live play');
    if (stoppage.reason === 'period-end' && clock !== 0) fail('stoppage', 'cannot end a period with time remaining');
    if (stoppage.reason === 'period-end' && state.phase !== 'period-end') fail('stoppage', 'requires the period-end phase');
    if (stoppage.reason === 'pre-game' && state.status !== 'ready') fail('stoppage', 'cannot be pre-game after play begins');
    if (stoppage.reason === 'pre-game' && state.phase !== 'dead-ball') fail('stoppage', 'requires the initial dead-ball phase');
    if (state.freeThrows !== null) {
      const sequence = state.freeThrows as MatchState['freeThrows'];
      if (sequence!.remaining !== sequence!.total) fail('stoppage', 'cannot reopen coaching opportunities between free throws');
    }
  } else if (state.phase === 'dead-ball' && state.status !== 'finished') fail('stoppage', 'must explain a dead-ball opportunity');

  const events = array(state.events, 'events', 1, 20_000);
  let priorElapsed = 0;
  let priorScore = { home: 0, away: 0 };
  const countedFouls = Object.fromEntries([...allIds].map((playerId) => [playerId, 0]));
  const countedAssists = Object.fromEntries([...allIds].map((playerId) => [playerId, 0]));
  const countedTeamFouls = { home: 0, away: 0 };
  const countedTimeouts = {
    home: { firstHalf: 0, secondHalf: 0, overtime: 0, lateFourth: 0 },
    away: { firstHalf: 0, secondHalf: 0, overtime: 0, lateFourth: 0 },
  };
  const countedInjuries = new Set<string>(preExisting);
  for (const [index, value] of events.entries()) {
    const path = `events[${index}]`;
    const event = record(value, path, ['id', 'period', 'clockSeconds', 'type', 'text', 'score'], ['side', 'playerId', 'outgoingPlayerId', 'receiverId', 'shot', 'scene', ...(modern ? ['assistPlayerId'] : [])]);
    if (event.id !== index + 1) fail(`${path}.id`, 'must follow the event sequence');
    const eventPeriod = number(event.period, `${path}.period`, 1, period);
    const eventClock = number(event.clockSeconds, `${path}.clockSeconds`, 0, eventPeriod <= 4 ? 600 : 300);
    const eventElapsed = elapsed(eventPeriod, eventClock);
    if (eventElapsed < priorElapsed || eventElapsed > played) fail(path, 'is outside the ordered match timeline');
    priorElapsed = eventElapsed;
    choice(event.type, EVENT_TYPES, `${path}.type`);
    if (!modern && event.type === 'drive') fail(`${path}.type`, 'is not supported by the saved engine');
    if (index === 0 && (event.type !== (preMatchDefault ? 'final' : 'tipoff') || eventPeriod !== 1 || eventClock !== 600)) fail('first event', 'must describe the initial tipoff or a pre-match default');
    if (event.type === 'final' && (state.status !== 'finished' || index !== events.length - 1)) fail(path, 'has a final event before the match ends');
    string(event.text, `${path}.text`, 1000);
    const eventScore = score(event.score, `${path}.score`);
    for (const side of SIDES) {
      if (eventScore[side] < priorScore[side] || eventScore[side] > currentScore[side]) fail(`${path}.score`, 'is inconsistent with match scoring');
    }
    const homeDelta = eventScore.home - priorScore.home;
    const awayDelta = eventScore.away - priorScore.away;
    const scoringDelta = homeDelta + awayDelta;
    if (scoringDelta > 0 && (!['shot', 'free-throw'].includes(event.type as string) || (homeDelta > 0 && event.side !== 'home') || (awayDelta > 0 && event.side !== 'away'))) fail(`${path}.score`, 'changes without a scoring event for that team');
    if (event.type === 'free-throw' && scoringDelta > 1) fail(`${path}.score`, 'awards more than one point for a free throw');
    if (Object.hasOwn(event, 'side')) choice(event.side, SIDES, `${path}.side`);
    if (['pass', 'drive', 'shot', 'free-throw', 'foul', 'rebound', 'turnover', 'foul-out', 'injury'].includes(event.type as string) && (!Object.hasOwn(event, 'side') || !Object.hasOwn(event, 'playerId'))) fail(path, 'is missing its team or player');
    if (event.type === 'substitution' && (!Object.hasOwn(event, 'side') || !Object.hasOwn(event, 'outgoingPlayerId'))) fail(path, 'is missing its team or outgoing player');
    if (event.type === 'timeout' && !Object.hasOwn(event, 'side')) fail(path, 'is missing the team taking its timeout');
    if (Object.hasOwn(event, 'playerId')) {
      const playerId = id(event.playerId, `${path}.playerId`);
      if (!allIds.has(playerId)) fail(`${path}.playerId`, 'references an unknown player');
      if (event.side !== undefined && !playerIds[event.side as 'home' | 'away'].has(playerId)) fail(path, 'references a player from the wrong team');
    }
    if (Object.hasOwn(event, 'outgoingPlayerId')) {
      const outgoing = id(event.outgoingPlayerId, `${path}.outgoingPlayerId`);
      if (event.type !== 'substitution' || !SIDES.includes(event.side as 'home' | 'away') || !playerIds[event.side as 'home' | 'away'].has(outgoing) || outgoing === event.playerId) fail(path, 'has an invalid outgoing substitution player');
    }
    if (Object.hasOwn(event, 'receiverId')) {
      const receiverId = id(event.receiverId, `${path}.receiverId`);
      if (event.type !== 'pass' || !playerIds[event.side as Side]?.has(receiverId) || receiverId === event.playerId) fail(`${path}.receiverId`, 'must identify a different player from the passing team');
    } else if (event.type === 'pass') fail(path, 'is missing its receiving player');
    if (event.type === 'foul') {
      const playerId = event.playerId as string;
      const side = event.side as 'home' | 'away';
      countedFouls[playerId] += 1;
      if (countedFouls[playerId] > 5) fail(path, 'records a foul after five-foul exclusion');
      if (eventPeriod === period || (period > 4 && eventPeriod >= 4)) countedTeamFouls[side] += 1;
    }
    if (event.type === 'foul-out' && countedFouls[event.playerId as string] !== 5) fail(path, 'must follow the player’s fifth personal foul');
    if (event.type === 'injury') {
      const playerId = event.playerId as string;
      const injury = injuries[playerId] as { occurredAtSeconds: number } | undefined;
      if (countedInjuries.has(playerId) || !injury || injury.occurredAtSeconds !== eventElapsed) fail(path, 'must match one recorded injury at this game time');
      countedInjuries.add(playerId);
    }
    if (event.type === 'timeout') {
      const usage = countedTimeouts[event.side as 'home' | 'away'];
      if (eventPeriod <= 2) usage.firstHalf += 1;
      else if (eventPeriod <= 4) usage.secondHalf += 1;
      else if (eventPeriod === period) usage.overtime += 1;
      if (eventPeriod === 4 && eventClock <= 120) usage.lateFourth += 1;
    }
    if (Object.hasOwn(event, 'shot')) {
      if (event.type !== 'shot') fail(`${path}.shot`, 'must belong to a shot event');
      const shot = record(event.shot, `${path}.shot`, ['x', 'y', 'made', 'value', ...(modern ? ['defenderId', 'contest', 'distanceM'] : [])]);
      number(shot.x, `${path}.shot.x`, 0, 1, false);
      number(shot.y, `${path}.shot.y`, 0, 1, false);
      if (typeof shot.made !== 'boolean') fail(`${path}.shot.made`, 'must be a boolean');
      choice(shot.value, [2, 3], `${path}.shot.value`);
      if (scoringDelta !== (shot.made ? shot.value : 0)) fail(`${path}.score`, 'does not match the recorded shot');
      if (modern) {
        const defenderId = id(shot.defenderId, `${path}.shot.defenderId`);
        const defense = event.side === 'home' ? 'away' : 'home';
        if (!playerIds[defense].has(defenderId)) fail(`${path}.shot.defenderId`, 'must identify an opposing player');
        choice(shot.contest, ['open', 'pressured', 'contested'], `${path}.shot.contest`);
        const distance = number(shot.distanceM, `${path}.shot.distanceM`, 0, 32, false);
        const hoopX = (event.side === 'home') === (eventPeriod <= 2) ? 26.425 / 28 : 1.575 / 28;
        const measured = Math.hypot(((shot.x as number) - hoopX) * 28, ((shot.y as number) - 0.5) * 15);
        if (Math.abs(distance - measured) > 0.011) fail(`${path}.shot.distanceM`, 'does not match its court location and attacking basket');
      }
    } else if (event.type === 'shot') fail(path, 'is missing shot geometry');
    if (Object.hasOwn(event, 'assistPlayerId')) {
      const assister = id(event.assistPlayerId, `${path}.assistPlayerId`);
      if (event.type !== 'shot' || !(event.shot as MatchEvent['shot'])?.made || !playerIds[event.side as Side]?.has(assister) || assister === event.playerId) fail(`${path}.assistPlayerId`, 'must identify a teammate assisting a made field goal');
      countedAssists[assister] += 1;
    }
    if (Object.hasOwn(event, 'scene')) courtScene(event.scene, `${path}.scene`, event, playerIds);
    const actorIds = [event.playerId, event.outgoingPlayerId, event.receiverId, event.assistPlayerId, (event.shot as MatchEvent['shot'])?.defenderId];
    const scene = event.scene as MatchEvent['scene'];
    if (scene) actorIds.push(...scene.start.map(point => point.playerId), ...scene.end.map(point => point.playerId));
    if (actorIds.some(playerId => typeof playerId === 'string' && preExisting.has(playerId))) fail(path, 'cannot involve a player unavailable before tipoff');
    priorScore = eventScore;
  }
  sceneLineups(events as MatchEvent[], lineups as Record<Side, string[]>, state.status === 'finished', modern, state.possessionPlay as MatchState['possessionPlay']);
  for (const playerId of allIds) {
    if (countedFouls[playerId] !== (stats[playerId] as MatchState['stats'][string]).fouls) fail(`stats.${playerId}.fouls`, 'does not match foul events');
    if (modern && countedAssists[playerId] !== (stats[playerId] as MatchState['stats'][string]).assists) fail(`stats.${playerId}.assists`, 'does not match assisted shot events');
  }
  if (countedInjuries.size !== Object.keys(injuries).length) fail('injuries', 'do not match injury events');
  for (const side of SIDES) {
    if (countedTeamFouls[side] !== teamFouls[side]) fail(`teamFouls.${side}`, 'does not match fouls in the current quarter or overtime group');
    const usage = timeoutUsage[side] as Record<string, unknown>;
    for (const [key, count] of Object.entries(countedTimeouts[side])) {
      if (usage[key] !== count) fail(`timeoutUsage.${side}.${key}`, 'does not match granted timeout events');
    }
  }
  if (priorScore.home !== currentScore.home || priorScore.away !== currentScore.away) fail('events', 'do not end at the current score');
  if (state.status === 'finished' && record(events.at(-1), 'final event').type !== 'final') fail('events', 'must end with a final event when finished');
}

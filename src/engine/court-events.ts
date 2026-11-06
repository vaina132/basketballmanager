import type { CourtBallPoint, CourtPoint, CourtPosition, CourtScene, MatchState, Position, Side } from '../domain/types';

const SIDES: readonly Side[] = ['home', 'away'];
const FORMATION: Record<Position, CourtPoint> = {
  PG: { x: 0.64, y: 0.5 }, SG: { x: 0.73, y: 0.15 }, SF: { x: 0.73, y: 0.85 },
  PF: { x: 0.83, y: 0.7 }, C: { x: 0.85, y: 0.37 },
};
const round = (value: number): number => Math.round(value * 100000) / 100000;
const bound = (value: number): number => Math.max(0, Math.min(1, value));
const direction = (state: MatchState, side: Side): 1 | -1 => (side === 'home') === (state.period <= 2) ? 1 : -1;
const mirror = (state: MatchState, side: Side, point: CourtPoint): CourtPoint => ({ x: direction(state, side) === 1 ? point.x : 1 - point.x, y: point.y });
const ballAt = (point: CourtPoint, height = 1.25): CourtBallPoint => ({ x: point.x, y: point.y, height });

function lastScene(state: MatchState): CourtScene | undefined {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const scene = state.events[index]!.scene;
    if (scene) return scene;
  }
  return undefined;
}

/** Formation is authored here, once, and saved with each action. No RNG is consumed. */
function formation(state: MatchState, offense: Side): CourtPosition[] {
  return SIDES.flatMap(side => state.lineups[side].map((playerId, index) => {
    const player = state[side].players.find(candidate => candidate.id === playerId)!;
    const base = FORMATION[player.position];
    // Defensive roles shade the offensive formation toward the basket.
    const point = side === offense ? base : { x: Math.min(0.91, base.x + 0.045), y: 0.5 + (base.y - 0.5) * 0.8 };
    // Duplicate positional roles still occupy distinct lanes.
    const duplicates = state.lineups[side].slice(0, index).filter(id => state[side].players.find(candidate => candidate.id === id)!.position === player.position).length;
    return { playerId, ...mirror(state, offense, { x: point.x, y: bound(point.y + duplicates * 0.055) }) };
  }));
}

function startingPositions(state: MatchState, offense: Side): CourtPosition[] {
  const previous = new Map(lastScene(state)?.end.map(position => [position.playerId, position]));
  return formation(state, offense).map(position => ({ ...(previous.get(position.playerId) ?? position) }));
}

function moveActor(positions: CourtPosition[], playerId: string, point: CourtPoint): void {
  const actor = positions.find(position => position.playerId === playerId);
  if (!actor) throw new Error('A court action references a player outside its active lineup.');
  actor.x = point.x;
  actor.y = point.y;
}

function actorAt(positions: CourtPosition[], playerId: string): CourtPosition {
  const actor = positions.find(position => position.playerId === playerId);
  if (!actor) throw new Error('A court action is missing its active player.');
  return actor;
}

function scene(kind: CourtScene['kind'], offense: Side, durationMs: number, start: CourtPosition[], end: CourtPosition[], from: CourtBallPoint, to: CourtBallPoint, arcHeight: number): CourtScene {
  // Clone nested values: earlier snapshots must never change when a new action begins.
  return { kind, offense, durationMs, start: start.map(point => ({ ...point })), end: end.map(point => ({ ...point })), ball: { from: { ...from }, to: { ...to }, arcHeight } };
}

export function hoopPosition(state: MatchState, offense: Side): CourtPoint {
  return { x: direction(state, offense) === 1 ? 26.425 / 28 : 1.575 / 28, y: 0.5 };
}

export function freeThrowPosition(state: MatchState, offense: Side): CourtPoint {
  return mirror(state, offense, { x: 22.2 / 28, y: 0.5 });
}

export function setupScene(state: MatchState, offense: Side, handlerId: string, destination?: CourtPoint, freeThrow = false): CourtScene {
  const start = startingPositions(state, offense), end = formation(state, offense);
  if (freeThrow) {
    // A deterministic free-throw lane: shooter at the line, others alongside the paint.
    for (const side of SIDES) {
      const waiting = end.filter(position => state.lineups[side].includes(position.playerId) && position.playerId !== handlerId);
      waiting.forEach((position, index) => {
        const point = mirror(state, offense, { x: 0.87 - Math.floor(index / 2) * 0.045 - (side === offense ? 0.02 : 0), y: index % 2 ? 0.69 : 0.31 });
        position.x = point.x; position.y = point.y;
      });
    }
  }
  if (destination) moveActor(end, handlerId, destination);
  const from = lastScene(state)?.ball.to ?? ballAt(actorAt(start, handlerId));
  return scene('setup', offense, freeThrow ? 650 : 850, start, end, from, ballAt(actorAt(end, handlerId)), 0.12);
}

export function passScene(state: MatchState, offense: Side, passerId: string, receiverId: string, destination: CourtPoint): CourtScene {
  const start = startingPositions(state, offense), end = start.map(position => ({ ...position }));
  moveActor(end, receiverId, destination);
  return scene('pass', offense, 600, start, end, ballAt(actorAt(start, passerId)), ballAt(actorAt(end, receiverId)), 0.35);
}

export function shotScene(state: MatchState, offense: Side, shooterId: string, location: CourtPoint, made: boolean, blockedBy?: string, freeThrow = false): CourtScene {
  const start = startingPositions(state, offense), end = start.map(position => ({ ...position }));
  moveActor(end, shooterId, location);
  const hoop = hoopPosition(state, offense);
  let target: CourtBallPoint;
  if (blockedBy) {
    // The deflection stays near the shooter, before any rim contact.
    const defender = actorAt(end, blockedBy);
    moveActor(end, blockedBy, { x: bound(location.x + direction(state, offense) * 0.025), y: bound(location.y + (defender.y < location.y ? -0.025 : 0.025)) });
    target = ballAt({ x: bound(location.x + direction(state, offense) * 0.06), y: bound(location.y + 0.06) }, 1.1);
  } else if (made) target = ballAt(hoop, 3.05);
  else {
    const lateral = (state.stepCount + state.period) % 2 ? 1 : -1;
    target = ballAt({ x: round(bound(hoop.x - direction(state, offense) * 0.035)), y: round(hoop.y + lateral * 0.075) }, 2.65);
  }
  return scene(freeThrow ? 'free-throw' : 'shot', offense, blockedBy ? 700 : 1100, start, end, ballAt(location, 2.1), target, blockedBy ? 0.5 : freeThrow ? 1.65 : 2.35);
}

export function reboundScene(state: MatchState, offense: Side, rebounderId: string): CourtScene {
  const start = startingPositions(state, offense), end = start.map(position => ({ ...position }));
  const from = lastScene(state)?.ball.to ?? ballAt(hoopPosition(state, offense), 2.65);
  const landing = { x: bound(from.x - direction(state, offense) * 0.018), y: bound(from.y) };
  moveActor(end, rebounderId, landing);
  return scene('rebound', offense, 650, start, end, from, ballAt(landing, 1.65), 0.2);
}

export function turnoverScene(state: MatchState, offense: Side, handlerId: string, stealerId?: string, outOfBounds = false): CourtScene {
  const start = startingPositions(state, offense), end = start.map(position => ({ ...position }));
  const handler = actorAt(start, handlerId);
  let target: CourtPoint = handler;
  if (stealerId) {
    target = { x: bound(handler.x + direction(state, offense) * 0.035), y: bound(handler.y + (handler.y > 0.5 ? -0.035 : 0.035)) };
    moveActor(end, stealerId, target);
  } else if (outOfBounds) target = { x: handler.x, y: handler.y >= 0.5 ? 1 : 0 };
  return scene('turnover', offense, 700, start, end, ballAt(handler), ballAt(target, outOfBounds ? 0.2 : 1.25), 0.15);
}

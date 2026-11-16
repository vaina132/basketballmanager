/**
 * Court positions played (owner request, 16 November 2026: the starting five on a court picture with PG, SG, SF, PF
 * and C circles). A side with circles (`MatchState.slots`) plays each player on court in his circle's position; a
 * side without circles plays everyone in his own listed position, as computer clubs do. Pure and deterministic: no
 * random draws, so arranging circles never changes the match's random sequence.
 */
import type { MatchState, Player, PlayerAttributes, Position, Side } from '../domain/types';

/** The court picture's circles, in the order they are listed. */
export const COURT_POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const ORDER: Readonly<Record<Position, number>> = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
/**
 * Playing out of position (reversible default, 16 November 2026): the share by which a player's skills in play are
 * reduced, by the steps between his listed position and the circle he plays along PG-SG-SF-PF-C. His own position
 * costs nothing, an adjacent one 5%, two steps 12%, three or four steps 25% (a guard at centre, a point guard at power
 * forward).
 */
export const OUT_OF_POSITION_PERCENT: readonly number[] = [0, 5, 12, 25, 25];
/** The skills reduced out of position. Free throws and stamina do not depend on the position played. */
export const POSITIONAL_SKILLS: readonly (keyof PlayerAttributes)[] = ['twoPoint', 'threePoint', 'passing', 'defense', 'rebounding'];

export const isCourtPosition = (value: unknown): value is Position => typeof value === 'string' && Object.hasOwn(ORDER, value);
export const positionSteps = (a: Position, b: Position): number => Math.abs(ORDER[a] - ORDER[b]);
/** The percentage a player loses in the circle `played`; 0 in his own position. */
export const outOfPositionPercent = (listed: Position, played: Position): number => OUT_OF_POSITION_PERCENT[positionSteps(listed, played)]!;

/** A player's skills in play when he plays `played`. */
export function playedAttributes(attributes: PlayerAttributes, listed: Position, played: Position): PlayerAttributes {
  const factor = 1 - outOfPositionPercent(listed, played) / 100;
  if (factor === 1) return attributes;
  const result = { ...attributes } as Record<keyof PlayerAttributes, number>;
  for (const key of POSITIONAL_SKILLS) result[key] = attributes[key] * factor;
  return result;
}

const played = new WeakMap<Player, Partial<Record<Position, Player>>>();
/**
 * The player as the simulation sees him in a circle: the circle's position, his positional skills reduced out of
 * position. In his own position the same object is returned. Rosters are immutable, so the result is cached.
 */
export function asPlayedIn(player: Player, position: Position): Player {
  if (player.position === position) return player;
  let byPosition = played.get(player);
  if (!byPosition) played.set(player, byPosition = {});
  return byPosition[position] ??= { ...player, position, attributes: playedAttributes(player.attributes, player.position, position) };
}

/** The circle a player plays on a side with circles; undefined on a side without them or for a reserve. */
export const circleOf = (state: Pick<MatchState, 'slots'>, side: Side, id: string): Position | undefined => state.slots?.[side]?.[id];

/** A roster player as the simulation sees him now: in his circle when his side has circles, otherwise as listed. */
export function matchPlayer(state: Pick<MatchState, 'home' | 'away' | 'slots'>, side: Side, id: string): Player | undefined {
  const player = state[side].players.find(candidate => candidate.id === id);
  const circle = player && circleOf(state, side, id);
  return player && circle ? asPlayedIn(player, circle) : player;
}

type Listed = Pick<Player, 'id' | 'position'>;
/**
 * Circles for up to five players. Each map in `keep` is applied in order: a player keeps the circle it names while
 * that circle is free. The other players take the free circles with the smallest total out-of-position cost, then the
 * most players in the circle `current` names, then the players' order. Deterministic.
 */
export function arrangeCircles(players: readonly Listed[], keep: readonly Readonly<Record<string, Position>>[] = [], current: Readonly<Record<string, Position>> = {}): Record<string, Position> {
  if (players.length > COURT_POSITIONS.length || new Set(players.map(player => player.id)).size !== players.length) throw new Error('Arrange circles for up to five different players.');
  const result: Record<string, Position> = {}, used = new Set<Position>();
  for (const kept of keep) for (const player of players) {
    const circle = kept[player.id];
    if (circle && isCourtPosition(circle) && !Object.hasOwn(result, player.id) && !used.has(circle)) { result[player.id] = circle; used.add(circle); }
  }
  const rest = players.filter(player => !Object.hasOwn(result, player.id)), free = COURT_POSITIONS.filter(circle => !used.has(circle));
  let best: { circles: Position[]; cost: number; moved: number } | null = null;
  const choose = (index: number, chosen: Position[]) => {
    if (index === rest.length) {
      const cost = rest.reduce((sum, player, at) => sum + outOfPositionPercent(player.position, chosen[at]!), 0);
      const moved = rest.reduce((sum, player, at) => sum + (current[player.id] === chosen[at] ? 0 : 1), 0);
      if (!best || cost < best.cost || cost === best.cost && moved < best.moved) best = { circles: [...chosen], cost, moved };
      return;
    }
    for (const circle of free) if (!chosen.includes(circle)) { chosen.push(circle); choose(index + 1, chosen); chosen.pop(); }
  };
  choose(0, []);
  rest.forEach((player, at) => { result[player.id] = best!.circles[at]!; });
  return result;
}

/** The total out-of-position percentage of a side's circles (0 when everyone plays his own position). */
export function circlesCost(players: readonly Listed[], circles: Readonly<Record<string, Position>>): number {
  return players.reduce((sum, player) => sum + (circles[player.id] ? outOfPositionPercent(player.position, circles[player.id]!) : 0), 0);
}

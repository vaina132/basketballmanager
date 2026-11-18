/**
 * Court positions played (owner request, 16 November 2026: the starting five on a court picture with PG, SG, SF, PF
 * and C circles). A player the manager puts in a circle (`MatchState.slots`) plays that circle's position while on
 * court; everyone else plays his own listed position: computer clubs, the automatic rotation's changes and a five the
 * manager never arranged. Pure and deterministic: no random draws, so arranging circles never changes the match's
 * random sequence.
 */
import { extraAttributes } from '../world/extra-attributes';
import type { MatchState, Player, PlayerAttributes, SkillAttributes, Position, Side } from '../domain/types';

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
export const POSITIONAL_SKILLS: readonly (keyof SkillAttributes)[] = ['twoPoint', 'threePoint', 'passing', 'defense', 'rebounding'];

export const isCourtPosition = (value: unknown): value is Position => typeof value === 'string' && Object.hasOwn(ORDER, value);
export const positionSteps = (a: Position, b: Position): number => Math.abs(ORDER[a] - ORDER[b]);
/** The percentage a player loses in the circle `played`; 0 in his own position. */
export const outOfPositionPercent = (listed: Position, played: Position): number => OUT_OF_POSITION_PERCENT[positionSteps(listed, played)]!;

/** A player's skills in play when he plays `played`. */
export function playedAttributes(attributes: PlayerAttributes, listed: Position, played: Position): PlayerAttributes {
  const factor = 1 - outOfPositionPercent(listed, played) / 100;
  if (factor === 1) return attributes;
  const result = { ...attributes } as Record<keyof SkillAttributes, number>;
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
  // The five further abilities do not depend on the circle: he keeps his own (stored or estimated from his listed position).
  return byPosition[position] ??= { ...player, position, attributes: { ...playedAttributes(player.attributes, player.position, position), ...extraAttributes(player) } };
}

/** A roster player as the simulation sees him now: in the circle the manager chose while he is on court, otherwise as listed. */
export function matchPlayer(state: Pick<MatchState, 'home' | 'away' | 'slots' | 'lineups'>, side: Side, id: string): Player | undefined {
  const player = state[side].players.find(candidate => candidate.id === id);
  const circle = player && state.slots?.[side]?.[id];
  return player && circle && state.lineups[side].includes(id) ? asPlayedIn(player, circle) : player;
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

/**
 * The court picture: the circle each player on court is shown in. Players the manager placed are in their chosen
 * circles; the others fill the free circles at the smallest distance from their listed positions (they play as listed).
 */
export function courtCircles(state: Pick<MatchState, 'home' | 'away' | 'slots' | 'lineups'>, side: Side): Record<string, Position> {
  const players = [...new Set(state.lineups[side])].flatMap(id => state[side].players.filter(player => player.id === id)).slice(0, COURT_POSITIONS.length);
  return arrangeCircles(players, [state.slots?.[side] ?? {}]);
}

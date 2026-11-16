import type { CourtPoint, CourtPosition, MatchState, Player, Position, PossessionPlay, Side } from '../domain/types';
import { HOME_COURT_MAKE_BONUS, SCORE_EFFECT, SHOT_MAKING } from './calibration';
import { matchPlayer } from './positions';

const other = (side: Side): Side => side === 'home' ? 'away' : 'home';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const ranks: Record<Position, number> = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
const round = (n: number) => Math.round(n * 100000) / 100000;
export const courtDistance = (a: CourtPoint, b: CourtPoint): number => Math.hypot((a.x - b.x) * 28, (a.y - b.y) * 15);
export const offenseDirection = (state: MatchState, side: Side): 1 | -1 => (side === 'home') === (state.period <= 2) ? 1 : -1;
export const basketPoint = (state: MatchState, side: Side): CourtPoint => ({ x: offenseDirection(state, side) === 1 ? 26.425 / 28 : 1.575 / 28, y: .5 });
const mirror = (state: MatchState, offense: Side, point: CourtPoint): CourtPoint => ({ x: round(offenseDirection(state, offense) === 1 ? point.x : 1 - point.x), y: round(point.y) });
export const positionOf = (play: PossessionPlay, id: string): CourtPosition => {
  const position = play.positions.find(point => point.playerId === id);
  if (!position) throw new Error('A possession actor is missing from the current court positions.');
  return position;
};
/** Players on court as they play: in their circles on a side with the court picture's circles (format 74). */
const active = (state: MatchState, side: Side): Player[] => state.lineups[side].map(id => matchPlayer(state, side, id)!);

/** Stable positional assignments, including unequal lineups. No sporting draws. */
export function assignMatchups(state: MatchState, offense: Side): PossessionPlay['matchups'] {
  const attackers = [...active(state, offense)].sort((a, b) => ranks[a.position] - ranks[b.position] || a.id.localeCompare(b.id));
  const defenders = active(state, other(offense));
  const use = new Map(defenders.map(player => [player.id, 0]));
  return attackers.map(attacker => {
    const defender = [...defenders].sort((a, b) => {
      const cost = (player: Player) => (use.get(player.id) ?? 0) * 100 + Math.abs(ranks[attacker.position] - ranks[player.position]) * 5 + Math.abs(attacker.heightCm - player.heightCm) / 20;
      return cost(a) - cost(b) || a.id.localeCompare(b.id);
    })[0]!;
    if (!defender) throw new Error('A live possession needs an opposing defender.');
    use.set(defender.id, (use.get(defender.id) ?? 0) + 1);
    return { attackerId: attacker.id, defenderId: defender.id };
  });
}

/** Coarse role spacing in metres, authored before outcome resolution. */
export function possessionFormation(state: MatchState, offense: Side, frontcourt = true): CourtPosition[] {
  const intent = state.tactics[offense].outsideShare;
  const attack = active(state, offense);
  const positions = attack.map((player, index) => {
    const rank = ranks[player.position];
    const wing = index % 2 ? -1 : 1;
    let point: CourtPoint;
    if (!frontcourt) point = { x: .32 + rank * .035, y: .5 + (index - (attack.length - 1) / 2) * .11 };
    else if (rank === 0) point = { x: .68, y: .5 };
    else if (rank <= 2) point = { x: .715 + (1 - intent) * .045, y: rank === 1 ? .16 : .84 };
    else {
      const stretch = intent * clamp((player.attributes.threePoint - 3) / 12, 0, 1);
      point = { x: .90 - stretch * .15, y: .5 + wing * (.09 + stretch * .26) };
    }
    // Nonstandard lineups retain separate lanes even with duplicated roles.
    const duplicate = attack.slice(0, index).filter(p => p.position === player.position).length;
    point.y = clamp(point.y + duplicate * .055, .06, .94);
    return { playerId: player.id, ...mirror(state, offense, point) };
  });
  const matchups = assignMatchups(state, offense);
  for (const defender of active(state, other(offense))) {
    const assignment = matchups.find(pair => pair.defenderId === defender.id);
    const target = positions.find(p => p.playerId === assignment?.attackerId) ?? positions[0]!;
    const separation = (1.75 - state.tactics[other(offense)].pressure * .8 - (defender.attributes.defense - 10) * .025) / 28;
    positions.push({ playerId: defender.id, x: round(clamp(target.x + offenseDirection(state, offense) * separation, .035, .965)), y: target.y });
  }
  return positions;
}

/** The side's primary ball handler on court: the best passer, a point guard counting six points more. */
export function primaryHandler(state: MatchState, side: Side): string {
  return [...active(state, side)].sort((a, b) => (b.attributes.passing + (b.position === 'PG' ? 6 : 0)) - (a.attributes.passing + (a.position === 'PG' ? 6 : 0)) || a.id.localeCompare(b.id))[0]!.id;
}

export function createPossessionPlay(state: MatchState, handlerId?: string): PossessionPlay {
  const offense = state.possession;
  const handler = handlerId && state.lineups[offense].includes(handlerId) ? handlerId : primaryHandler(state, offense);
  return { offense, handlerId: handler, passerId: null, actions: 0, positions: possessionFormation(state, offense, state.frontcourt), matchups: assignMatchups(state, offense) };
}

export function matchedDefender(state: MatchState, play: PossessionPlay, attackerId = play.handlerId): Player {
  const id = play.matchups.find(pair => pair.attackerId === attackerId)?.defenderId;
  const defender = id === undefined ? undefined : matchPlayer(state, other(play.offense), id);
  if (!defender) throw new Error('A possession attacker is missing a defensive assignment.');
  return defender;
}

/** Move actual sporting positions; the viewer receives these exact endpoints. */
export function moveForAction(state: MatchState, play: PossessionPlay, action: 'advance' | 'pass' | 'drive', receiverId?: string, separationRoll = .5): CourtPosition[] {
  if (action === 'advance') return possessionFormation(state, play.offense, true);
  const positions = play.positions.map(point => ({ ...point }));
  const offense = play.offense, direction = offenseDirection(state, offense);
  const actorId = action === 'pass' ? receiverId! : play.handlerId;
  const target = positions.find(point => point.playerId === actorId)!;
  if (!target) throw new Error('An action target is outside the active lineup.');
  const defender = matchedDefender(state, play, actorId);
  if (action === 'pass') {
    const preferred = possessionFormation(state, offense, true).find(point => point.playerId === actorId)!;
    target.x = preferred.x;
    target.y = clamp(preferred.y + (play.actions % 2 ? -.055 : .055), .06, .94);
  } else {
    const basket = basketPoint(state, offense);
    const metres = courtDistance(target, basket) > 5 ? 3.8 : 1.8;
    target.x = basket.x - direction * metres / 28;
    target.y = clamp(.5 + (target.y - .5) * .35, .14, .86);
  }
  // Off-ball defenders follow assignments; the primary defender's recovery is
  // determined by passing/creation versus defense, with bounded uncertainty.
  for (const candidate of active(state, other(offense))) {
    const assignment = play.matchups.find(pair => pair.defenderId === candidate.id);
    const attacker = positions.find(point => point.playerId === assignment?.attackerId);
    const pose = positions.find(point => point.playerId === candidate.id)!;
    if (!attacker) continue;
    const ability = action === 'pass' ? matchPlayer(state, offense, play.handlerId)!.attributes.passing : matchPlayer(state, offense, actorId)!.attributes.twoPoint;
    const gap = candidate.id === defender.id
      ? clamp(1.3 + (ability - candidate.attributes.defense) * .055 + (separationRoll - .5) * 2.1 - state.tactics[other(offense)].pressure * .25, .35, 3)
      : clamp(1.65 - state.tactics[other(offense)].pressure * .65, .7, 2);
    pose.x = clamp(attacker.x + direction * gap / 28, .035, .965);
    pose.y = attacker.y;
  }
  return positions.map(point => ({ ...point, x: round(point.x), y: round(point.y) }));
}

export function shotContext(state: MatchState, play: PossessionPlay): { defenderId: string; distanceM: number; separationM: number; contest: 'open' | 'pressured' | 'contested'; value: 2 | 3; makeChance: number } {
  const shooter = matchPlayer(state, play.offense, play.handlerId)!;
  const defender = matchedDefender(state, play);
  const origin = positionOf(play, shooter.id), basket = basketPoint(state, play.offense);
  const distance = courtDistance(origin, basket), separationM = courtDistance(origin, positionOf(play, defender.id));
  // This increment uses the arc; its authored perimeter positions avoid corners.
  const value: 2 | 3 = distance >= 6.75 ? 3 : 2;
  const contest = separationM <= .85 ? 'contested' : separationM <= 1.75 ? 'pressured' : 'open';
  const skill = value === 3 ? shooter.attributes.threePoint : shooter.attributes.twoPoint;
  const fatigue = (100 - state.stats[shooter.id]!.condition) / 100;
  const space = clamp((separationM - 1.3) * .045, -.05, .075);
  const defense = (defender.attributes.defense - 10) * SHOT_MAKING.defense;
  const height = clamp((defender.heightCm - shooter.heightCm) / 1000, -.025, .025) * (value === 2 ? 1 : .5);
  const range = value === 3 ? Math.max(0, distance - 7.2) * .025 : Math.max(0, distance - 2) * .025;
  const home = play.offense === 'home' ? HOME_COURT_MAKE_BONUS : -HOME_COURT_MAKE_BONUS;
  const lead = clamp(state.score[play.offense] - state.score[play.offense === 'home' ? 'away' : 'home'], -SCORE_EFFECT.cap, SCORE_EFFECT.cap);
  const base = value === 3 ? SHOT_MAKING.threeBase + skill * SHOT_MAKING.threeSkill : SHOT_MAKING.twoBase + skill * SHOT_MAKING.twoSkill;
  const scoreEffect = lead * SCORE_EFFECT.perPoint * (state.period >= 4 ? SCORE_EFFECT.fourthQuarter : 1);
  const makeChance = clamp(base + space - defense - height - range - fatigue * .07 + home - scoreEffect, .08, value === 3 ? .65 : .82);
  return { defenderId: defender.id, distanceM: Math.round(distance * 100) / 100, separationM, contest, value, makeChance };
}

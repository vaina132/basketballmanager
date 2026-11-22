import type { SeasonState } from '../domain/season';
import type { MatchState, Player, Position, Side } from '../domain/types';
import { MAX_MATCHDAY_PLAYERS } from '../domain/roster';
import { arrangeBestFive, isPlayerEligible, placeInCircle } from '../engine/match';
import { courtCircles } from '../engine/positions';
import { usesFullClubRoster } from './club-roster-policy';
import { isRecovering } from './health';
import { overallRating } from './overall-rating';
import { getActiveFixture, setMatchdaySelection, setPlannedFive, startingFivePlanBlock, startingFivePlanMatch } from './season';

/**
 * Where a player goes on the Squad page (owner feedback, 22 November 2026): a court circle, the bench (the rest of the
 * matchday squad) or the reserves (first-team players outside the matchday squad). `sendOff` says where the player
 * shown in the circle goes when a reserve takes it; `swapWith` names the player who changes places with him.
 */
export type SquadSpot =
  | { kind: 'court'; position: Position; sendOff?: 'bench' | 'reserves' }
  | { kind: 'bench'; swapWith?: string }
  | { kind: 'reserves'; swapWith?: string };

export interface SquadBoard {
  /** The prepared next match (or the plan's presentation of it) the five is shown on. */
  match: MatchState;
  side: Side;
  /** True when the career has matchday squads (full club rosters); otherwise there are no reserves. */
  reservesOpen: boolean;
  limit: number;
  five: string[];
  bench: string[];
  reserves: string[];
}

const managedSideOf = (match: MatchState, clubId: string): Side => match.home.id === clubId ? 'home' : 'away';

/** The next game's date: the prepared fixture's, or today's for the plan between games (as the plan's match uses). */
function boardDate(state: SeasonState): string {
  return state.activeMatch ? getActiveFixture(state).date : state.date;
}

/** The court, bench and reserves for the next game. Throws when planning is closed (`startingFivePlanBlock`). */
export function getSquadBoard(state: SeasonState): SquadBoard {
  const match = startingFivePlanMatch(state), side = managedSideOf(match, state.managedClubId);
  const club = state.clubs.find(club => club.id === state.managedClubId)!;
  const selected = new Set(match[side].players.map(player => player.id)), five = [...match.lineups[side]];
  const reservesOpen = usesFullClubRoster(state);
  return {
    match, side, reservesOpen, limit: reservesOpen ? MAX_MATCHDAY_PLAYERS : match[side].players.length, five,
    bench: match[side].players.filter(player => !five.includes(player.id)).map(player => player.id),
    reserves: reservesOpen ? club.players.filter(player => !selected.has(player.id)).map(player => player.id) : [],
  };
}

/** True when the player is injured (or fouled out) for the next game: he cannot be put on court or on the bench. */
export function isSquadPlayerUnavailable(state: SeasonState, board: SquadBoard, playerId: string): boolean {
  if (board.match[board.side].players.some(player => player.id === playerId)) return !isPlayerEligible(board.match, playerId);
  const date = boardDate(state);
  return state.injuries.some(injury => injury.playerId === playerId && isRecovering(injury, date, state.physio));
}

/** The healthiest fit from the bench for a circle: the best overall rating in that position, weighted by condition. */
function benchReplacement(board: SquadBoard, position: Position): string | null {
  const { match, side } = board;
  const value = (player: Player) => overallRating(player.attributes, position) * (.55 + .45 * (match.stats[player.id]?.condition ?? 100) / 100) + (player.position === position ? .5 : 0);
  const candidates = match[side].players.filter(player => board.bench.includes(player.id) && isPlayerEligible(match, player.id));
  return candidates.sort((a, b) => value(b) - value(a))[0]?.id ?? null;
}

const nameOf = (state: SeasonState, id: string) => state.clubs.find(club => club.id === state.managedClubId)!.players.find(player => player.id === id)?.name ?? 'This player';

/**
 * Moves one player between court, bench and reserves for the next game. The five and the matchday squad are saved in
 * the club's plan together (`setPlannedFive`), so the next match starts from them; every guard of the plan applies
 * (five different available players, five to twelve in the matchday squad). Injured players cannot be placed on court
 * or on the bench. No move returns the same state.
 */
export function moveSquadPlayer(state: SeasonState, playerId: string, to: SquadSpot): SeasonState {
  const block = startingFivePlanBlock(state);
  if (block) throw new Error(block);
  const board = getSquadBoard(state), { match, side } = board;
  const where = board.five.includes(playerId) ? 'court' : board.bench.includes(playerId) ? 'bench' : board.reserves.includes(playerId) ? 'reserves' : null;
  if (!where) throw new Error('Choose a player from your first team.');
  const name = nameOf(state, playerId);
  const matchday = [...board.five, ...board.bench];
  const commit = (next: MatchState, ids?: readonly string[]) => setPlannedFive(state, next.lineups[side], next.slots?.[side] ?? {}, ids);
  const unavailable = (id: string) => isSquadPlayerUnavailable(state, board, id);
  const needsReserves = () => { if (!board.reservesOpen) throw new Error('This career has no reserves: every registered player is in the matchday squad.'); };
  const full = matchday.length >= board.limit;
  const circles = courtCircles(match, side);

  if (to.kind === 'court') {
    if (where === 'bench' && unavailable(playerId)) throw new Error(`${name} is injured and cannot be placed.`);
    if (where !== 'reserves') return commit(placeInCircle(match, side, playerId, to.position));
    needsReserves();
    if (unavailable(playerId)) throw new Error(`${name} is injured and cannot be placed.`);
    const occupant = Object.keys(circles).find(id => circles[id] === to.position);
    if (!occupant) throw new Error('Choose a circle with a player.');
    const sendOff = to.sendOff ?? (full ? 'reserves' : 'bench');
    if (sendOff === 'bench' && full) throw new Error(`The matchday squad is full (${board.limit}). Move a bench player to Reserves first.`);
    const five = board.five.map(id => id === occupant ? playerId : id);
    const slots = Object.fromEntries(Object.entries(match.slots?.[side] ?? {}).filter(([id]) => id !== occupant));
    slots[playerId] = to.position;
    const ids = [...matchday.filter(id => sendOff === 'bench' || id !== occupant), playerId];
    return setPlannedFive(state, five, slots, ids);
  }

  if (to.kind === 'bench') {
    if (where === 'bench') return state;
    if (where === 'court') {
      const replacement = to.swapWith ?? benchReplacement(board, circles[playerId]!);
      if (!replacement || !board.bench.includes(replacement) || !isPlayerEligible(match, replacement)) throw new Error(`No healthy player on the bench can take ${name}'s place.`);
      return commit(placeInCircle(match, side, replacement, circles[playerId]!));
    }
    needsReserves();
    if (unavailable(playerId)) throw new Error(`${name} is injured and cannot be placed.`);
    if (to.swapWith !== undefined) {
      if (!board.bench.includes(to.swapWith)) throw new Error('Choose a bench player to swap with.');
      return setPlannedFive(state, board.five, match.slots?.[side] ?? {}, [...matchday.filter(id => id !== to.swapWith), playerId]);
    }
    if (full) throw new Error(`The matchday squad is full (${board.limit}). Move a bench player to Reserves first.`);
    return setPlannedFive(state, board.five, match.slots?.[side] ?? {}, [...matchday, playerId]);
  }

  needsReserves();
  if (where === 'reserves') return state;
  if (to.swapWith !== undefined) {
    if (!board.reserves.includes(to.swapWith)) throw new Error('Choose a reserve to swap with.');
    if (where === 'court') return moveSquadPlayer(state, to.swapWith, { kind: 'court', position: circles[playerId]!, sendOff: 'reserves' });
    return moveSquadPlayer(state, to.swapWith, { kind: 'bench', swapWith: playerId });
  }
  if (where === 'bench') return setPlannedFive(state, board.five, match.slots?.[side] ?? {}, matchday.filter(id => id !== playerId));
  const replacement = benchReplacement(board, circles[playerId]!);
  if (!replacement) throw new Error(`No healthy player on the bench can take ${name}'s place. Put a player on the bench first.`);
  return commit(placeInCircle(match, side, replacement, circles[playerId]!), matchday.filter(id => id !== playerId));
}

/**
 * "Auto-pick": back to the automatic choice. The matchday squad is chosen automatically again and the five is the
 * best five from it (the court picture's Best five).
 */
export function autoPickSquad(state: SeasonState): SeasonState {
  const block = startingFivePlanBlock(state);
  if (block) throw new Error(block);
  const club = state.clubs.find(club => club.id === state.managedClubId)!, plan = state.plans[club.id]!;
  const automatic = !usesFullClubRoster(state) ? state
    : state.activeMatch ? setMatchdaySelection(state, null)
    : { ...state, plans: { ...state.plans, [club.id]: { ...plan, matchday: null } } };
  const match = startingFivePlanMatch(automatic), side = managedSideOf(match, club.id), best = arrangeBestFive(match, side);
  return best === match ? automatic : setPlannedFive(automatic, best.lineups[side], best.slots?.[side] ?? {});
}

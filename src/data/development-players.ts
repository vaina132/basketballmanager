import type { Player } from '../domain/types';
import { DEVELOPMENT_CLUBS } from './development-league';

/** Stable identities and base ratings; employment determines each season's club. */
export const DEVELOPMENT_PLAYERS: readonly Player[] = Object.freeze(DEVELOPMENT_CLUBS.flatMap(club => club.players));

export function getDevelopmentPlayer(playerId: string): Player {
  const player = DEVELOPMENT_PLAYERS.find(player => player.id === playerId);
  if (!player) throw new Error('Choose a player from the development player catalog.');
  return player;
}

import { DEVELOPMENT_CLUBS } from './development-league';

/** Fictional gross season wages for this development database, not researched salaries. */
const ROSTER_WAGES_EUROS = [18000, 17500, 17000, 16500, 16000, 14500, 14000, 13500, 13000, 12500] as const;
export const DEVELOPMENT_WAGES: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(
  DEVELOPMENT_CLUBS.flatMap(club => club.players.map((player, index) => [player.id, ROSTER_WAGES_EUROS[index]! * 100])),
));

export function getSeasonWage(playerId: string): number {
  const wage = DEVELOPMENT_WAGES[playerId];
  if (wage === undefined) throw new Error('Choose a player from the development wage catalog.');
  return wage;
}

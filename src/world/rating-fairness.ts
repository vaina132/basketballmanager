import type { DataPack, DataPackPlayer } from './data-pack';
import type { PlayerAttributes } from '../domain/types';

/**
 * Rating fairness (sprint 4, owner feedback point 7): a rating built from few minutes says little, so it is pulled
 * towards the level of the player's club (the minutes-weighted average of its rated players, a step lower, because
 * squad players are usually below the regulars). Ratings resting on at least `FAIRNESS_MINUTES` keep their value;
 * below that they move towards the club's level in proportion to the minutes missing. Players with no statistics at
 * all take that level. Packs without minutes (older packs) only lift players with no statistics.
 */
export const FAIRNESS_MINUTES = 600;
export const FAIRNESS_SQUAD_STEP = 1;
const KEYS: readonly (keyof PlayerAttributes)[] = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];

const minutesOf = (player: DataPackPlayer): number | undefined => player.estimated.includes('all-abilities') ? 0 : player.ratingMinutes;

/** A copy of the pack with fairer ratings; the original pack is unchanged. */
export function withFairRatings(pack: DataPack): DataPack {
  const byId = new Map(pack.players.map(player => [player.id, player]));
  const adjusted = new Map<string, PlayerAttributes>();
  for (const club of pack.clubs) {
    const members = club.playerIds.map(id => byId.get(id)!).filter(Boolean);
    const rated = members.filter(player => (minutesOf(player) ?? 0) > 0);
    const weight = rated.reduce((sum, player) => sum + minutesOf(player)!, 0);
    if (!weight) continue;
    const level = Object.fromEntries(KEYS.map(key => [key, rated.reduce((sum, player) => sum + player.attributes[key] * minutesOf(player)!, 0) / weight - FAIRNESS_SQUAD_STEP])) as Record<keyof PlayerAttributes, number>;
    for (const player of members) {
      const minutes = minutesOf(player);
      if (minutes === undefined) continue;
      const trust = Math.min(1, minutes / FAIRNESS_MINUTES);
      if (trust === 1) continue;
      adjusted.set(player.id, Object.fromEntries(KEYS.map(key => [key, Math.max(1, Math.min(20, Math.round(trust * player.attributes[key] + (1 - trust) * level[key])))])) as unknown as PlayerAttributes);
    }
  }
  return adjusted.size ? { ...pack, players: pack.players.map(player => adjusted.has(player.id) ? { ...player, attributes: adjusted.get(player.id)! } : player) } : pack;
}

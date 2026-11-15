import type { DataPack, DataPackPlayer } from './data-pack';
import type { PlayerAttributes } from '../domain/types';
import { OVR_POSITION_WEIGHTS } from './overall-rating';

/**
 * Rating fairness (sprint 4, owner feedback point 7): a rating built from few minutes says little, so it is pulled
 * towards the level of the player's club (the minutes-weighted level of its rated players, a step lower, because
 * squad players are usually below the regulars). Ratings resting on at least `FAIRNESS_MINUTES` keep their value;
 * below that they move towards the club's level in proportion to the minutes missing. Players with no statistics at
 * all take that level. Packs without minutes (older packs) only lift players with no statistics.
 *
 * Levels are compared on each player's own position scale (the overall rating's position weights) and the player's
 * own skill profile is shifted, so a centre stays a centre. The first version averaged skills across all positions;
 * that mixed profile rated about 15 overall points below the clubs' rotations and pulled newcomers down too hard
 * (match-calibration review of Beşiktaş and Fenerbahçe, 15 November 2026).
 */
export const FAIRNESS_MINUTES = 600;
export const FAIRNESS_SQUAD_STEP = 1;
const KEYS: readonly (keyof PlayerAttributes)[] = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];

const minutesOf = (player: DataPackPlayer): number | undefined => player.estimated.includes('all-abilities') ? 0 : player.ratingMinutes;

const weighted = (player: DataPackPlayer, attributes: PlayerAttributes = player.attributes) => KEYS.reduce((sum, key) => sum + OVR_POSITION_WEIGHTS[player.position][key] * attributes[key], 0);

/** A copy of the pack with fairer ratings; the original pack is unchanged. */
export function withFairRatings(pack: DataPack): DataPack {
  const byId = new Map(pack.players.map(player => [player.id, player]));
  const adjusted = new Map<string, PlayerAttributes>();
  for (const club of pack.clubs) {
    const members = club.playerIds.map(id => byId.get(id)!).filter(Boolean);
    const rated = members.filter(player => (minutesOf(player) ?? 0) > 0);
    const weight = rated.reduce((sum, player) => sum + minutesOf(player)!, 0);
    if (!weight) continue;
    // The club's level in position-weighted skill points (1-20), one step lower for squad players.
    const level = rated.reduce((sum, player) => sum + weighted(player) * minutesOf(player)!, 0) / weight - FAIRNESS_SQUAD_STEP;
    for (const player of members) {
      const minutes = minutesOf(player);
      if (minutes === undefined) continue;
      const trust = Math.min(1, minutes / FAIRNESS_MINUTES);
      if (trust === 1) continue;
      // Position weights sum to 1, so shifting every skill by the gap moves the weighted level by the same amount.
      const shift = (1 - trust) * (level - weighted(player));
      adjusted.set(player.id, Object.fromEntries(KEYS.map(key => [key, Math.max(1, Math.min(20, Math.round(player.attributes[key] + shift)))])) as unknown as PlayerAttributes);
    }
  }
  return adjusted.size ? { ...pack, players: pack.players.map(player => adjusted.has(player.id) ? { ...player, attributes: adjusted.get(player.id)! } : player) } : pack;
}

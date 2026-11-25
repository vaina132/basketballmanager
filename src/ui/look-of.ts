import { PLAYER_LOOK_CODES } from '../data/player-looks'
import { generatedLook, unpackLook } from './player-look'
import type { PlayerLook } from './player-look'

const cache = new Map<string, PlayerLook>()

/** The player's drawn look: the recorded one for real-pack players, else one worked out from the player. Never random. */
export function lookOf(player: { id: string; skinTone: string; hairColor: string }): PlayerLook {
  const hit = cache.get(player.id)
  if (hit) return hit
  const code = player.id.startsWith('player-') && Object.hasOwn(PLAYER_LOOK_CODES, player.id.slice(7)) ? PLAYER_LOOK_CODES[player.id.slice(7)] : undefined
  const look = (code && unpackLook(code)) || generatedLook(player)
  cache.set(player.id, look)
  return look
}

import { PLAYER_NAMES } from '../data/player-names'

/**
 * Real-pack players appear under names close to their own (owner decision, 27 November 2026), so the game carries no
 * real player names. Applied when a pack is read, so new careers and friendlies use them; saved careers keep the
 * names they were created with.
 */
export function packPlayerName(id: string, name: string): string {
  return id.startsWith('player-') && Object.hasOwn(PLAYER_NAMES, id.slice(7)) ? PLAYER_NAMES[id.slice(7)]! : name
}

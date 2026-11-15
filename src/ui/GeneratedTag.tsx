import type { SeasonState } from '../domain/season'
import { worldOf } from '../world/career-world'

/**
 * A generated player of a next-division club (step 3.4d-2): the data has no real squad for the club, so the game made the
 * player up. The label keeps generated players from passing as real ones.
 */
export function GeneratedTag({ season, playerId }: { season: SeasonState | null | undefined; playerId: string }) {
  if (!season || worldOf(season).playerProfiles[playerId]?.source !== 'generated') return null
  return <small className="generated-tag" title="Generated player: the data has no real squad for this club, so the game created this player">Generated</small>
}

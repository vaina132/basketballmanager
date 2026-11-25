import { useMemo } from 'react'
import type { Player } from '../domain/types'
import { lookOf } from './look-of'
import { drawingMarkup } from './player-drawing'
import { rgb } from '../viewer/projection'

/**
 * Drawn player portraits (owner decision, 25 November 2026): real players look like themselves (skin tone, hair,
 * beard, face shape), drawn in one simple style in their club's colours. Real photos are no longer used.
 */
export function Avatar({ player, color, size = 42 }: { player: Player; color: string; size?: number }) {
  const look = lookOf(player)
  const markup = useMemo(() => {
    const c = rgb(color)
    const light = c ? c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114 > 200 : false
    return drawingMarkup(look, { primary: c ? color : '#687385', secondary: light ? '#1c2521' : '#ffffff' })
  }, [look, color])
  return <svg width={size} height={size} viewBox="0 0 128 128" role="img" aria-label={`${player.name}, number ${player.number}`} className="avatar avatar-drawing" data-player-drawing={player.id} dangerouslySetInnerHTML={{ __html: markup }} />
}

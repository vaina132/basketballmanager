import { useState } from 'react'
import { PLAYER_PHOTOS } from '../data/player-photos'
import './player-photo.css'

/** Credit for the real club and competition logos, on the setup screen and in the Credits view. */
export function LogoCredit() {
  return <p data-credits="logos"><strong>Credits:</strong> club and competition logos come from API-Sports. They belong to their clubs and competitions and are removed on request.</p>
}

/**
 * Credits for the real player photos (owner decision, 22 November 2026): every photo's player, author,
 * licence (linked) and Commons file page. The long list renders only once the disclosure is opened.
 */
export function PhotoCredits({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const photos = Object.entries(PLAYER_PHOTOS).sort(([, a], [, b]) => a.player.localeCompare(b.player))
  if (!photos.length) return null
  return <details className="photo-credits" data-credits="photos" open={defaultOpen || undefined} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Player photos: {photos.length} from Wikimedia Commons</summary>
    <p>Photos by the authors below, under the licences named. Each was cropped and resized for the game; photos under CC BY-SA stay under CC BY-SA. A photo is removed on request.</p>
    {open && <ul className="photo-credits-list" aria-label="Player photo credits" tabIndex={0}>{photos.map(([playerId, photo]) => <li key={playerId} data-photo-credit-row={playerId}>
      <strong>{photo.player}</strong> <span>{photo.author}</span> · {photo.licenceUrl ? <a href={photo.licenceUrl} target="_blank" rel="noreferrer">{photo.licence}</a> : photo.licence} · <a href={photo.source} target="_blank" rel="noreferrer" aria-label={`Commons file page for the photo of ${photo.player}`}>Commons file</a>
    </li>)}</ul>}
  </details>
}

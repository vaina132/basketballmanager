import { useState } from 'react'
import { PLAYER_PHOTOS } from '../data/player-photos'
import './player-photo.css'

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
    {open && <div className="photo-credits-list" role="region" aria-label="Player photo credits" tabIndex={0}><table>
      <thead><tr><th scope="col">Player</th><th scope="col">Author</th><th scope="col">Licence</th><th scope="col">File</th></tr></thead>
      <tbody>{photos.map(([playerId, photo]) => <tr key={playerId} data-photo-credit-row={playerId}>
        <td>{photo.player}</td>
        <td>{photo.author}</td>
        <td>{photo.licenceUrl ? <a href={photo.licenceUrl} target="_blank" rel="noreferrer">{photo.licence}</a> : photo.licence}</td>
        <td><a href={photo.source} target="_blank" rel="noreferrer" aria-label={`Commons file page for the photo of ${photo.player}`}>Commons</a></td>
      </tr>)}</tbody>
    </table></div>}
  </details>
}

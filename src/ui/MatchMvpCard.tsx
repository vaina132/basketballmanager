import type { MatchMvp } from '../world/performance-rating'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { MatchRating } from './PlayerRating'
import './match-performance.css'

export function MatchMvpCard({ mvp }: { mvp: MatchMvp | null }) {
  if (!mvp) return null
  return <section className="match-mvp panel" aria-label="Match MVP" data-mvp-player={mvp.playerId}>
    <div className="match-mvp-title"><Icon name="star" size={21} /><span>Match MVP</span></div>
    <Avatar player={mvp.player} color={mvp.club.color} size={46} />
    <div className="match-mvp-player"><strong>{mvp.player.name}</strong><span>{mvp.club.name}</span></div>
    <dl><div><dt>PIR</dt><dd data-mvp-pir={mvp.pir}>{mvp.pir}</dd></div><div><dt>Rating</dt><dd><MatchRating value={mvp.rating} compact /></dd></div><div><dt>Pts</dt><dd>{mvp.stats.points}</dd></div><div><dt>Reb</dt><dd>{mvp.stats.rebounds}</dd></div><div><dt>Ast</dt><dd>{mvp.stats.assists}</dd></div></dl>
  </section>
}

import type { MarketOffer } from '../domain/market'
import type { SeasonState } from '../domain/season'
import { getDevelopmentPlayer } from '../data/development-players'
import { getClubContractSummary } from '../world/employment-policy'
import { getMarketOffers, getMarketWindow, getNextMarketDate, isLiveMarketOffer } from '../world/market-policy'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import './offseason-market.css'

interface OffseasonMarketPanelProps {
  season: SeasonState
  disabled: boolean
  onAdvance: () => void
  onWithdraw: (offerId: string) => void
  onReview: (playerId: string) => void
}

const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
const daysBetween = (first: string, last: string) => Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000)
export const marketOfferStatus = (offer: MarketOffer) => ({ pending: 'Awaiting reply', countered: 'Counteroffer', accepted: 'Signed', rejected: 'Rejected', withdrawn: 'Withdrawn', expired: 'Expired', replaced: 'Replaced' })[offer.status]

export function OffseasonMarketPanel({ season, disabled, onAdvance, onWithdraw, onReview }: OffseasonMarketPanelProps) {
  const window = getMarketWindow(season)
  if (!window || season.status !== 'complete') return null
  const offers = getMarketOffers(season)
  const open = offers.filter(isLiveMarketOffer)
  const recent = offers.filter(offer => !isLiveMarketOffer(offer)).slice(-8).reverse()
  const summary = getClubContractSummary(season, season.managedClubId)
  const nextDate = getNextMarketDate(season)
  const duration = Math.max(1, daysBetween(window.openedOn, window.closesOn))
  const elapsed = Math.max(0, daysBetween(window.openedOn, window.date))
  const daysLeft = Math.max(0, daysBetween(window.date, window.closesOn))
  return <section className="offseason-market panel" aria-labelledby="offseason-market-title">
    <header className="transfers-heading"><div><h2 id="offseason-market-title"><Icon name="calendar" size={17} />Offseason</h2><span>{daysLeft ? `${daysLeft} days left to recruit` : 'Final recruitment decisions'}</span></div><strong className="market-current-date" data-market-date={window.date}><time dateTime={window.date}>{scoutingDate(window.date)}</time></strong></header>
    <div className="market-calendar">
      <div className="market-window-track"><div><span>Window opens</span><strong><time dateTime={window.openedOn}>{scoutingDate(window.openedOn)}</time></strong></div><progress value={Math.min(duration, elapsed)} max={duration} aria-label={`${daysLeft} days remaining in the recruitment window`} /><div><span>Window closes</span><strong><time dateTime={window.closesOn}>{scoutingDate(window.closesOn)}</time></strong></div></div>
      <div className="market-next-decision"><span><Icon name="clock" size={17} />{nextDate ? <>Next decisions <strong><time dateTime={nextDate}>{scoutingDate(nextDate)}</time></strong></> : 'No further decision dates'}</span><button id="advance-offseason" className="button primary" onClick={onAdvance} disabled={disabled || !nextDate}>Continue offseason<Icon name="next" size={15} /></button></div>
    </div>
    <div className="market-offers-heading"><h3>Your open offers <span data-market-open-count={open.length}>{open.length}</span></h3>{open.length > 0 && <span><Icon name="wallet" size={15} /><strong data-market-reserved-wages={summary.reservedWages}>{money(summary.reservedWages)}</strong> / year held · {summary.reservedRosterSize} {summary.reservedRosterSize === 1 ? 'place' : 'places'}</span>}</div>
    {open.length ? <div className="market-offer-grid">{open.map(offer => {
      const player = getDevelopmentPlayer(offer.playerId)
      const owner = season.clubs.find(club => club.players.some(member => member.id === player.id))
      return <article className={`market-offer-card market-offer-${offer.status}`} key={offer.id} data-market-offer={offer.id} data-market-player={offer.playerId} data-market-status={offer.status}>
        <button className="market-offer-player" onClick={() => onReview(player.id)} disabled={disabled} aria-label={`Review offer to ${player.name}`}><span aria-hidden="true"><Avatar player={owner?.players.find(member => member.id === player.id) ?? player} color={owner?.color ?? '#687385'} size={42} /></span><span><strong>{player.name}</strong><small>{player.position} · {owner?.name ?? 'Free agent'}</small></span><Icon name="chevron" size={14} /></button>
        <div className="market-offer-terms"><strong>{money(offer.seasonWage)} <small>/ year</small></strong><span>{offer.seasons} {offer.seasons === 1 ? 'season' : 'seasons'}</span></div>
        <div className="market-offer-deadline"><Icon name={offer.status === 'countered' ? 'mail' : 'clock'} size={16} /><div><strong>{marketOfferStatus(offer)}</strong><span>{offer.status === 'pending' ? 'Reply' : 'Expires'} <time dateTime={offer.status === 'pending' ? offer.responseOn : offer.expiresOn}>{scoutingDate(offer.status === 'pending' ? offer.responseOn : offer.expiresOn)}</time></span></div></div>
        <div className="market-offer-actions"><button className={`button small${offer.status === 'countered' ? ' primary' : ''}`} data-review-market-offer={offer.id} onClick={() => onReview(player.id)} disabled={disabled}>{offer.status === 'countered' ? 'Review counteroffer' : 'Review'}<Icon name="chevron" size={14} /></button><button className="text-button" data-withdraw-market-offer={offer.id} onClick={() => onWithdraw(offer.id)} disabled={disabled} aria-label={`Withdraw offer to ${player.name}`}>Withdraw</button></div>
      </article>
    })}</div> : <p className="market-empty">{nextDate ? 'No offers waiting. Find players below or continue to the next decision date.' : 'Recruitment is complete. Review your signed squad and start next season.'}</p>}
    {recent.length > 0 && <details className="market-recent game-disclosure"><summary><Icon name="clock" size={15} />Recent offer activity</summary><ol>{recent.map(offer => <li key={offer.id} data-market-history={offer.id}><strong>{getDevelopmentPlayer(offer.playerId).name}</strong><span className={offer.status === 'accepted' ? 'market-signed' : ''}>{marketOfferStatus(offer)}</span><time dateTime={offer.closedOn ?? offer.respondedOn ?? offer.offeredOn}>{scoutingDate(offer.closedOn ?? offer.respondedOn ?? offer.offeredOn)}</time></li>)}</ol></details>}
    <details className="market-help game-disclosure"><summary><Icon name="wallet" size={15} />Offers, dates & budget</summary><div><p>Sending an offer holds its annual wages and squad place. The player replies on the shown date. If accepted, the contract signs automatically; withdraw before the reply to cancel.</p><p>Counteroffers hold your original offer until its deadline. Submit revised terms to replace it, or withdraw to release the hold. No current cash is paid. Start next season when every club has at least eight signed players and all offers are resolved.</p></div></details>
  </section>
}

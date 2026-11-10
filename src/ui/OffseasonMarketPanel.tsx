import type { MarketOffer } from '../domain/market'
import type { SeasonState } from '../domain/season'
import { getDevelopmentPlayer } from '../data/development-players'
import { getClubContractSummary } from '../world/employment-policy'
import { sellerReplacementReason } from '../world/transfers-policy'
import { getMarketOffers, getMarketWindow, getNextMarketDate, getRivalMarketOffers, isCompetitiveMarket, isLiveMarketOffer } from '../world/market-policy'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { paymentPlanLabel } from '../world/transfer-payments'
import { TransferPaymentTerms } from './TransferPaymentTerms'
import './offseason-market.css'

interface OffseasonMarketPanelProps {
  season: SeasonState
  disabled: boolean
  onAdvance: () => void
  onWithdraw: (offerId: string) => void
  onReview: (playerId: string) => void
  onClubDecision: (offerId: string, response: 'accept' | 'reject' | 'counter') => void
}

const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100)
const daysBetween = (first: string, last: string) => Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000)
export function marketOfferStatus(offer: MarketOffer): string {
  if (offer.status === 'club-review') return 'Club decision needed'
  if (offer.transfer && offer.status === 'pending') return offer.transfer.clubStatus === 'accepted' ? 'Awaiting player reply' : 'Awaiting club reply'
  if (offer.transfer?.clubStatus === 'countered' && offer.status === 'countered') return 'Club counteroffer'
  if (offer.transfer?.clubStatus === 'rejected' && offer.status === 'rejected') return 'Club declined'
  return ({ pending: 'Awaiting reply', countered: 'Counteroffer', accepted: 'Signed', rejected: 'Rejected', withdrawn: 'Withdrawn', expired: 'Expired', replaced: 'Replaced', lost: 'Chose another club' })[offer.status]
}

export function chosenMarketOffer(season: SeasonState, offer: MarketOffer | null) {
  return offer?.chosenOfferId ? getMarketWindow(season)?.offers.find(candidate => candidate.id === offer.chosenOfferId) ?? null : null
}

export function RivalOfferBadge({ season, playerId, onReview, disabled }: { season: SeasonState; playerId: string; onReview: () => void; disabled: boolean }) {
  const rivals = getRivalMarketOffers(season, playerId)
  if (!rivals.length) return null
  const clubs = rivals.map(offer => season.clubs.find(club => club.id === offer.clubId)!)
  return <button className="market-rival-badge" onClick={onReview} disabled={disabled} data-rival-player={playerId} data-rival-count={rivals.length} aria-label={`Review ${rivals.length === 1 ? 'rival offer' : `${rivals.length} rival offers`} for ${getDevelopmentPlayer(playerId).name}: ${clubs.map(club => club.name).join(', ')}`} title={clubs.map(club => club.name).join(', ')}><Icon name="people" size={14} />{rivals.length === 1 ? `Rival offer · ${clubs[0]!.shortName}` : `${rivals.length} rival offers`}<Icon name="chevron" size={12} /></button>
}

export function OffseasonMarketPanel({ season, disabled, onAdvance, onWithdraw, onReview, onClubDecision }: OffseasonMarketPanelProps) {
  const window = getMarketWindow(season)
  if (!window || season.status !== 'complete') return null
  const offers = getMarketOffers(season)
  const open = offers.filter(isLiveMarketOffer)
  const recent = offers.filter(offer => !isLiveMarketOffer(offer)).slice(-8).reverse()
  const decisions = offers.filter(offer => offer.status === 'lost' && offer.closedOn === window.date)
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
    {decisions.length > 0 && <div className="market-decisions" role="status" aria-label="Recruitment decisions">{decisions.map(offer => {
      const selected = chosenMarketOffer(season, offer)
      const selectedClub = season.clubs.find(club => club.id === selected?.clubId)
      return <div key={offer.id} data-market-decision={offer.id}><Icon name="swap" size={17} /><div><strong>{getDevelopmentPlayer(offer.playerId).name}</strong><span>Chose {selectedClub?.name ?? 'another club'} · {offer.transfer ? 'fee, salary budget and squad place released' : 'salary budget and squad place released'}</span></div><button className="button small" data-review-market-decision={offer.id} onClick={() => onReview(offer.playerId)} disabled={disabled}>Review<Icon name="chevron" size={13} /></button></div>
    })}</div>}
    <IncomingTransferOffers season={season} disabled={disabled} onDecision={onClubDecision} />
    <div className="market-offers-heading"><h3>Your open offers <span data-market-open-count={open.length}>{open.length}</span></h3>{open.length > 0 && <span><Icon name="wallet" size={15} /><strong data-market-reserved-wages={summary.reservedWages}>{money(summary.reservedWages)}</strong> / year held · {summary.reservedRosterSize} {summary.reservedRosterSize === 1 ? 'place' : 'places'}</span>}</div>
    {open.length ? <div className="market-offer-grid">{open.map(offer => {
      const player = getDevelopmentPlayer(offer.playerId)
      const owner = season.clubs.find(club => club.players.some(member => member.id === player.id))
      return <article className={`market-offer-card market-offer-${offer.status}`} key={offer.id} data-market-offer={offer.id} data-market-player={offer.playerId} data-market-status={offer.status}>
        <button className="market-offer-player" onClick={() => onReview(player.id)} disabled={disabled} aria-label={`Review offer to ${player.name}`}><span aria-hidden="true"><Avatar player={owner?.players.find(member => member.id === player.id) ?? player} color={owner?.color ?? '#687385'} size={42} /></span><span><strong>{player.name}</strong><small>{player.position} · {owner?.name ?? 'Free agent'}</small></span><Icon name="chevron" size={14} /></button>
        <div className="market-offer-terms"><strong>{money(offer.seasonWage)} <small>/ year</small></strong><span>{offer.seasons} {offer.seasons === 1 ? 'season' : 'seasons'}</span></div>
        {offer.transfer && <><div className="market-transfer-fee"><Icon name="wallet" size={14} /><span>Fee held</span><strong>{money(offer.transfer.fee)}</strong></div><span className="market-transfer-plan">{paymentPlanLabel(offer.transfer.paymentPlan ?? 'upfront')}</span></>}
        <div className="market-offer-deadline"><Icon name={offer.status === 'countered' ? 'mail' : 'clock'} size={16} /><div><strong>{marketOfferStatus(offer)}</strong><span>{offer.status === 'pending' ? 'Reply' : 'Expires'} <time dateTime={offer.status === 'pending' ? offer.responseOn : offer.expiresOn}>{scoutingDate(offer.status === 'pending' ? offer.responseOn : offer.expiresOn)}</time></span></div></div>
        <RivalOfferBadge season={season} playerId={player.id} onReview={() => onReview(player.id)} disabled={disabled} />
        <div className="market-offer-actions"><button className={`button small${offer.status === 'countered' ? ' primary' : ''}`} data-review-market-offer={offer.id} onClick={() => onReview(player.id)} disabled={disabled}>{offer.status === 'countered' ? 'Review counteroffer' : 'Review'}<Icon name="chevron" size={14} /></button><button className="text-button" data-withdraw-market-offer={offer.id} onClick={() => onWithdraw(offer.id)} disabled={disabled} aria-label={`Withdraw offer to ${player.name}`}>Withdraw</button></div>
      </article>
    })}</div> : <p className="market-empty">{nextDate ? 'No offers waiting. Find players below or continue to the next decision date.' : 'Recruitment is complete. Review your signed squad and start next season.'}</p>}
    {recent.length > 0 && <details className="market-recent game-disclosure"><summary><Icon name="clock" size={15} />Recent offer activity</summary><ol>{recent.map(offer => {
      const contractId = season.negotiations.records.find(record => record.id === offer.negotiationId)?.contractId
      const buyout = contractId ? season.employment.buyouts.find(item => item.releasedContractIds.includes(contractId)) : null
      return <li key={offer.id} data-market-history={offer.id}><strong>{getDevelopmentPlayer(offer.playerId).name}</strong><span className={offer.status === 'accepted' ? 'market-signed' : ''}>{marketOfferStatus(offer)}{buyout && <small>Bought out {scoutingDate(buyout.completedOn)}</small>}{offer.status === 'lost' && <small>{season.clubs.find(club => club.id === chosenMarketOffer(season, offer)?.clubId)?.name}</small>}</span><time dateTime={offer.closedOn ?? offer.respondedOn ?? offer.offeredOn}>{scoutingDate(offer.closedOn ?? offer.respondedOn ?? offer.offeredOn)}</time><button className="text-button" data-review-market-history={offer.id} onClick={() => onReview(offer.playerId)} disabled={disabled} aria-label={`Review offer to ${getDevelopmentPlayer(offer.playerId).name}`}>Review</button></li>
    })}</ol></details>}
    <details className="market-help game-disclosure"><summary><Icon name="wallet" size={15} />Offers, dates & budget</summary><div><p>Sending an offer holds its annual salary budget and a squad place. Contracted players also require a reserved transfer fee and club approval first. The player replies on the shown date. If accepted, the contract signs automatically; withdraw before the reply to cancel.</p>{isCompetitiveMarket(season) ? <p>Other clubs can bid for the same player. Signing for one club closes the other offers and releases their salary budgets and squad places. Review rival offers before sending or changing yours.</p> : <p>Existing offers finish under their original rules. Rival bids open once these offers are resolved.</p>}<p>Counteroffers hold your original offer until its deadline. Submit revised terms to replace it, or withdraw to release the hold. The first transfer payment is made only after club approval and player acceptance. Any later payments follow the agreed dates. The full unpaid fee remains reserved, whatever the payment plan. Start next season when every club has at least eight signed players and all offers are resolved.</p></div></details>
  </section>
}

function IncomingTransferOffers({ season, disabled, onDecision }: { season: SeasonState; disabled: boolean; onDecision: (offerId: string, response: 'accept' | 'reject' | 'counter') => void }) {
  const incoming = (getMarketWindow(season)?.offers ?? []).filter(offer => offer.transfer?.sellerClubId === season.managedClubId)
  if (!incoming.length) return null
  const live = incoming.filter(isLiveMarketOffer)
  const recent = incoming.filter(offer => !isLiveMarketOffer(offer)).slice(-6).reverse()
  return <section className="incoming-transfers" aria-labelledby="incoming-transfers-title"><header><h3 id="incoming-transfers-title"><Icon name="mail" size={17} />Offers for your players <span>{live.length}</span></h3><small>{season.employment.delegated ? 'Assistant handles club replies' : 'You decide whether to sell'}</small></header>
    {live.map(offer => {
      const player = getDevelopmentPlayer(offer.playerId), buyer = season.clubs.find(club => club.id === offer.clubId)!, transfer = offer.transfer!
      const review = offer.status === 'club-review'
      const reason = review ? sellerReplacementReason(season, offer) : null
      const inTime = season.date < offer.expiresOn
      return <article className="incoming-transfer" key={offer.id} data-incoming-transfer={offer.id} data-incoming-status={offer.status}>
        <div className="incoming-transfer-player"><span aria-hidden="true"><Avatar player={player} color={season.clubs.find(club => club.id === season.managedClubId)!.color} size={38} /></span><div><strong>{player.name}</strong><small>{buyer.name} · {player.position}</small></div><div className="incoming-transfer-price"><strong>{money(transfer.fee)}</strong><small>Transfer fee</small></div></div>
        <div className="incoming-transfer-state"><span><Icon name={review ? 'mail' : 'clock'} size={14} />{review ? 'Your decision' : marketOfferStatus(offer)}</span><span>{transfer.clubStatus === 'accepted' ? 'Player reply' : 'Expires'} <time dateTime={transfer.clubStatus === 'accepted' ? offer.responseOn : offer.expiresOn}>{scoutingDate(transfer.clubStatus === 'accepted' ? offer.responseOn : offer.expiresOn)}</time></span></div>
        <TransferPaymentTerms fee={transfer.fee} plan={transfer.paymentPlan ?? 'upfront'} startsSeason={offer.seasonNumber + 1} earliestSigning={transfer.clubStatus === 'accepted' ? offer.responseOn : undefined} incoming />
        {transfer.clubReason && <p className="incoming-transfer-explanation">{transfer.clubReason}</p>}
        {review && <><p className="incoming-transfer-explanation">Approve the fee to let the player consider {money(offer.seasonWage)} / year for {offer.seasons} {offer.seasons === 1 ? 'season' : 'seasons'}. The first payment arrives only if he signs; later receipts follow the schedule above.</p>{reason && <p id={`sale-reason-${offer.id}`} className="contract-offer-reason">{reason}</p>}<div className="incoming-transfer-actions"><button className="button primary small" data-accept-transfer={offer.id} onClick={() => onDecision(offer.id, 'accept')} disabled={disabled || !inTime || !!reason} aria-describedby={reason ? `sale-reason-${offer.id}` : undefined}>Accept terms<Icon name="check" size={14} /></button>{transfer.fee < transfer.requiredFee && <button className="button small" data-counter-transfer={offer.id} onClick={() => onDecision(offer.id, 'counter')} disabled={disabled || !inTime}>Ask {money(transfer.requiredFee)}</button>}<button className="text-button" data-reject-transfer={offer.id} onClick={() => onDecision(offer.id, 'reject')} disabled={disabled || !inTime}>Reject</button></div></>}
      </article>
    })}
    {recent.length > 0 && <details className="game-disclosure incoming-transfer-history"><summary>Recent club decisions</summary><ul>{recent.map(offer => <li key={offer.id} data-incoming-history={offer.id}><strong>{getDevelopmentPlayer(offer.playerId).name}</strong><span>{season.clubs.find(club => club.id === offer.clubId)!.name}</span><span>{marketOfferStatus(offer)} · {money(offer.transfer!.fee)}</span></li>)}</ul></details>}
  </section>
}

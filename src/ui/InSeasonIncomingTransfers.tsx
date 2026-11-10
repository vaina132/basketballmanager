import { useEffect, useRef } from 'react'
import type { SeasonState } from '../domain/season'
import { getDevelopmentPlayer } from '../data/development-players'
import { isLiveInSeasonOffer, quoteInSeasonSale } from '../world/recruitment-policy'
import { seasonLabel } from '../world/season'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { TransferPaymentTerms, transferMoney as money } from './TransferPaymentTerms'

export type InSeasonClubDecision = (offerId: string, response: 'accept' | 'reject' | 'counter') => void

export function InSeasonIncomingTransfers({ season, disabled, onDecision }: { season: SeasonState; disabled: boolean; onDecision: InSeasonClubDecision }) {
  const club = season.clubs.find(item => item.id === season.managedClubId)!
  const incoming = season.recruitment.offers.filter(offer => offer.transfer?.sellerClubId === club.id)
  const live = incoming.filter(offer => offer.seasonNumber === season.seasonNumber && isLiveInSeasonOffer(offer))
  const history = incoming.filter(offer => !isLiveInSeasonOffer(offer)).slice(-8).reverse()
  const previousStatuses = useRef(new Map(incoming.map(offer => [offer.id, offer.status])))
  useEffect(() => {
    if (disabled) return
    const changed = incoming.find(offer => previousStatuses.current.has(offer.id) && previousStatuses.current.get(offer.id) !== offer.status)
    if (changed) (document.querySelector<HTMLElement>(`[data-in-season-incoming="${changed.id}"]`) ?? document.getElementById('in-season-incoming-title'))?.focus({ preventScroll: true })
    previousStatuses.current = new Map(incoming.map(offer => [offer.id, offer.status]))
  }, [disabled, incoming])
  if (!incoming.length) return null
  return <section className="in-season-incoming" aria-labelledby="in-season-incoming-title">
    <header className="in-season-section-heading"><h3 id="in-season-incoming-title" tabIndex={-1}><Icon name="mail" size={17} />Offers for your players <span>{live.length}</span></h3><small>{season.employment.delegated ? 'Assistant handles club replies' : 'You decide whether to sell'}</small></header>
    {live.map(offer => {
      const transfer = offer.transfer!
      const player = club.players.find(item => item.id === offer.playerId) ?? getDevelopmentPlayer(offer.playerId)
      const buyer = season.clubs.find(item => item.id === offer.clubId)!
      const quote = quoteInSeasonSale(season, offer.id)
      const review = offer.status === 'club-review'
      return <article key={offer.id} className="in-season-sale" tabIndex={-1} aria-label={`Offer for ${player.name} from ${buyer.name}`} data-in-season-incoming={offer.id} data-incoming-status={offer.status}>
        <div className="in-season-sale-heading"><div className="in-season-player"><Avatar player={player} color={club.color} size={38} /><div><strong>{player.name}</strong><small>From {buyer.name} &middot; {player.position}</small></div></div><div><strong>{money(transfer.fee)}</strong><small>Transfer fee</small></div></div>
        <div className="in-season-sale-status"><span><Icon name={review ? 'mail' : 'clock'} size={15} />{review ? 'Your decision before Continue' : 'Fee approved - awaiting player'}</span><span>Earliest departure <time dateTime={offer.responseOn}>{scoutingDate(offer.responseOn)}</time></span></div>
        {review && <div className="in-season-sale-actions"><button className="button primary small" data-accept-in-season={offer.id} onClick={() => onDecision(offer.id, 'accept')} disabled={disabled || !quote.canAccept} aria-describedby={!quote.canAccept ? `in-season-sale-reason-${offer.id}` : undefined}>Approve fee<Icon name="check" size={14} /></button>{transfer.fee < transfer.requiredFee && <button className="button small" data-counter-in-season={offer.id} onClick={() => onDecision(offer.id, 'counter')} disabled={disabled || !quote.canCounter} title={quote.counterReason ?? undefined}>Ask {money(transfer.requiredFee)}</button>}<button className="text-button" data-reject-in-season={offer.id} onClick={() => onDecision(offer.id, 'reject')} disabled={disabled}>Reject</button><span data-sale-roster-after={quote.rosterAfter}>{quote.rosterAfter} players after approved departures</span></div>}
        {review && quote.acceptReason && <p className="in-season-sale-reason" id={`in-season-sale-reason-${offer.id}`}>{quote.acceptReason}</p>}
        <details className="game-disclosure in-season-sale-details"><summary><Icon name="wallet" size={14} />Payments &amp; squad impact</summary><div><TransferPaymentTerms fee={transfer.fee} plan={transfer.paymentPlan} startsSeason={offer.seasonNumber} startsRound={offer.responseRound} earliestSigning={offer.responseOn} incoming /><dl className="contract-offer-facts"><div><dt>Annual salary budget freed on sale</dt><dd data-sale-annual-freed={quote.annualSalaryFreed}>{money(quote.annualSalaryFreed)}</dd></div><div><dt>Remaining salary saved</dt><dd data-sale-wages-freed={quote.remainingWagesFreed}>{money(quote.remainingWagesFreed)}</dd></div><div><dt>Salary cost to date</dt><dd>{money(quote.salaryAlreadyCharged)}</dd></div>{quote.nonRefundablePrepayment > 0 && <div><dt>Salary prepaid - no refund</dt><dd data-sale-prepaid={quote.nonRefundablePrepayment}>{money(quote.nonRefundablePrepayment)}</dd></div>}<div><dt>Contract ends</dt><dd>{seasonLabel(quote.releasedThroughSeason)}</dd></div><div><dt>Club decision deadline</dt><dd><time dateTime={quote.decisionDeadline}>{scoutingDate(quote.decisionDeadline)}</time> &middot; before Continue</dd></div></dl><p>Approval lets the player decide on the offered contract. The current match stays unchanged. Money arrives only after signing; unanswered offers expire when you Continue.</p></div></details>
      </article>
    })}
    {history.length > 0 && <details className="game-disclosure in-season-sale-history"><summary>Recent offers for your players</summary><ul>{history.map(offer => <li key={offer.id} data-in-season-sale-history={offer.id}><strong>{getDevelopmentPlayer(offer.playerId).name}</strong><span>{season.clubs.find(item => item.id === offer.clubId)?.name}</span><span>{offer.status === 'accepted' ? 'Transferred' : offer.status === 'countered' ? 'Counteroffer sent' : offer.status === 'rejected' ? 'Declined' : offer.status === 'expired' ? 'Expired' : offer.status === 'lost' ? 'Another offer chosen' : offer.status === 'replaced' ? 'Replaced' : offer.status === 'withdrawn' ? 'Withdrawn' : 'Cancelled'} &middot; {money(offer.transfer!.fee)}</span><time dateTime={offer.closedOn ?? offer.responseOn}>{scoutingDate(offer.closedOn ?? offer.responseOn)}</time></li>)}</ul></details>}
  </section>
}

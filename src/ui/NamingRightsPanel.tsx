import { useEffect, useRef, useState } from 'react'
import type { NamingRightsOffer } from '../domain/commercial'
import type { SeasonState } from '../domain/season'
import { getDevelopmentSponsor } from '../data/development-sponsors'
import { getClubNamingRights, quoteNamingOffer, type SponsorshipPaymentRow } from '../world/commercial'
import { agreementLastSeason, SPONSORSHIP_REQUEST_PERCENT } from '../world/commercial-policy'
import { dateForRound, seasonLabel } from '../world/season'
import { focusWhenReady } from './focus-when-ready'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { formatMoney } from './money-format'
import { TerminationControl, type SponsorshipActions } from './SponsorshipPanel'
import { clauseSummary, exitExplanation } from './sponsor-exit-text'
import './facilities-panel.css'
import './sponsorship-panel.css'

type NamingActions = Pick<SponsorshipActions, 'onAcceptNaming' | 'onDeclineNaming' | 'onRequestNaming' | 'onNamingDelegation' | 'onTerminateSponsorship'>

const money = (amount: number) => formatMoney(amount)
const seasons = (from: number, count: number) => count === 1 ? seasonLabel(from) : `${seasonLabel(from)} – ${seasonLabel(from + count - 1)}`
const sponsorName = (sponsorId: string) => getDevelopmentSponsor(sponsorId).name
const paymentStatus: Record<SponsorshipPaymentRow['status'], string> = { received: 'Received', scheduled: 'Scheduled', conditional: 'Conditional', 'not-earned': 'Not earned' }
const closedStatus: Record<Exclude<NamingRightsOffer['status'], 'open'>, string> = { accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', superseded: 'Closed after another agreement', expired: 'Expired' }

function requestOutcome(offer: NamingRightsOffer): string | null {
  if (!offer.request) return null
  if (offer.request.response === 'accepted') return `Agreed to your request: ${money(offer.annualFee)} a season`
  if (offer.request.response === 'withdrawn') return 'Withdrew after your request'
  return offer.annualFee > offer.initialAnnualFee ? `Countered at ${money(offer.annualFee)} a season` : 'Kept its original offer'
}

function NamingReview({ season, offer, busy, onConfirm, onClose }: { season: SeasonState; offer: NamingRightsOffer; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const region = useRef<HTMLElement>(null)
  const quote = quoteNamingOffer(season, offer.id)
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return <section ref={region} id="naming-offer-review" className="sponsor-review" tabIndex={-1} aria-labelledby="naming-review-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}>
    <header><div><h3 id="naming-review-title">Name the arena {offer.arenaName}</h3><span>{sponsorName(offer.sponsorId)} · {seasons(offer.forSeason, offer.seasons)}</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header>
    <dl className="sponsor-review-facts"><div><dt>Guaranteed each season</dt><dd data-naming-review-fee={offer.annualFee}>{money(offer.annualFee)}</dd></div><div><dt>Guaranteed in total</dt><dd>{money(quote.totalGuaranteed)}</dd></div><div><dt>Seats valued</dt><dd>{offer.basis.capacity.toLocaleString('en-GB')} (league average {offer.basis.leagueCapacity.toLocaleString('en-GB')})</dd></div><div><dt>Offer open until</dt><dd><time dateTime={offer.expiresOn}>{scoutingDate(offer.expiresOn)}</time></dd></div></dl>
    <p className="sponsor-clause" data-naming-clause><strong>Exit clause.</strong> {clauseSummary(season, quote.clause)}</p>
    <table className="sponsor-schedule"><caption>Payment dates</caption><thead><tr><th scope="col">Date</th><th scope="col">Payment</th><th scope="col">Amount</th></tr></thead><tbody>{quote.payments.map(payment => <tr key={`${payment.seasonNumber}-${payment.installment}`}><td><time dateTime={payment.date}>{scoutingDate(payment.date)}</time></td><td>{payment.installment === 1 ? 'Matchday 6 installment' : 'Final matchday installment'} · {seasonLabel(payment.seasonNumber)}</td><td>{money(payment.amount)}</td></tr>)}</tbody></table>
    <footer><span id="naming-accept-reason" role="status">{quote.reason ?? `Accepting renames the arena ${offer.arenaName} on club, match and fixture screens from ${seasonLabel(offer.forSeason)} and closes your other naming offers.`}</span><button id="naming-accept-confirm" className="button primary" disabled={busy || !quote.canAccept} onClick={onConfirm} aria-describedby="naming-accept-reason"><Icon name="check" size={15} />Sign naming rights</button></footer>
  </section>
}

/** Arena naming rights (format 64): a separate agreement negotiated like the main sponsor. Absent in older careers. */
export function NamingRightsPanel({ season, busy = false, onAcceptNaming, onDeclineNaming, onRequestNaming, onNamingDelegation, onTerminateSponsorship }: NamingActions & { season: SeasonState; busy?: boolean }) {
  const naming = getClubNamingRights(season)
  const [reviewId, setReviewId] = useState<string | null>(null)
  if (!naming?.enabled || !onAcceptNaming || !onDeclineNaming || !onRequestNaming || !onNamingDelegation) return null
  const review = naming.open.find(offer => offer.id === reviewId) ?? null
  const nextSeason = season.seasonNumber + 1, current = naming.current
  const endedNow = naming.ended.find(agreement => agreement.exit!.seasonNumber === season.seasonNumber)
  function closeReview() { const id = reviewId; setReviewId(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-naming-review="${id}"]`)?.focus({ preventScroll: true })) }

  let outlook: string
  if (naming.next && naming.next.id === current?.id) outlook = `The arena carries this name through ${seasonLabel(agreementLastSeason(current))}.`
  else if (naming.next) outlook = `${naming.next.arenaName} from ${seasonLabel(naming.next.startsSeason)}.`
  else if (naming.open.length) outlook = `${naming.open.length} naming ${naming.open.length === 1 ? 'offer' : 'offers'} for ${seasonLabel(nextSeason)}. Open offers expire on ${scoutingDate(naming.open[0]!.expiresOn)}.`
  else if (season.status === 'complete') outlook = `No naming partner for ${seasonLabel(nextSeason)}. The arena keeps its official name and earns no naming income.`
  else if (season.round < 6) outlook = `Naming offers for ${seasonLabel(nextSeason)} arrive on matchday 6 (${scoutingDate(dateForRound(6, season.seasonNumber))}).`
  else outlook = 'No naming offers are open. Arenas still without a partner receive a second round after the final matchday.'
  if (endedNow) outlook = `${exitExplanation(endedNow.sponsorId, 'naming', endedNow.exit!, endedNow.startsSeason).detail} ${outlook}`

  return <section className="sponsorship-panel naming-rights-panel panel" aria-labelledby="naming-title" data-naming-enabled>
    <header className="club-heading"><h2 id="naming-title"><Icon name="building" size={18} />Arena naming rights</h2><div className="facility-delegation"><label htmlFor="naming-control">Control</label><input id="naming-control" type="range" min={0} max={1} step={1} value={naming.delegated ? 1 : 0} aria-valuetext={naming.delegated ? 'Automatic' : 'Manual'} aria-describedby="naming-automatic-help" onChange={event => onNamingDelegation(event.target.value === '1')} disabled={busy} /><output htmlFor="naming-control">{naming.delegated ? 'Automatic' : 'Manual'}</output></div></header>
    <p className="facility-automatic-note" id="naming-automatic-help">Automatic signs the best naming offer when offers arrive.</p>
    <div className="sponsor-current" data-naming-current={current?.id ?? 'none'} tabIndex={-1}>{current ? <><div className="sponsor-identity"><strong data-arena-name={current.arenaName}>{current.arenaName}</strong><span>{sponsorName(current.sponsorId)} · {seasons(current.startsSeason, agreementLastSeason(current) - current.startsSeason + 1)} · official venue {naming.officialVenue}</span></div><dl><div><dt>This season</dt><dd>{money(current.annualFee)}</dd></div><div><dt>Exit payment</dt><dd>{money(current.clause.exitPayment)}</dd></div></dl></> : <div className="sponsor-identity"><strong data-arena-name={naming.officialVenue}>{naming.officialVenue}</strong><span>No naming partner this season.</span></div>}</div>
    {naming.payments.length > 0 && <ul className="sponsor-payments" aria-label={`Naming-rights payments ${seasonLabel(season.seasonNumber)}`}>{naming.payments.map(payment => <li key={payment.label} data-naming-payment={payment.status}><span><strong>{payment.label}</strong><small><time dateTime={payment.date}>{scoutingDate(payment.date)}</time></small></span><span>{money(payment.amount)}</span><span className={`sponsor-pill sponsor-pill--${payment.status}`}>{paymentStatus[payment.status]}</span></li>)}</ul>}
    <p className="sponsor-outlook" data-naming-outlook>{outlook}</p>
    {(current ?? naming.next) && <details className="sponsor-clause-details"><summary>Exit clause</summary><p data-naming-clause>{clauseSummary(season, (current ?? naming.next)!.clause)}</p></details>}
    {naming.termination && <TerminationControl quote={naming.termination} contract="naming" busy={busy} onTerminate={onTerminateSponsorship} />}
    {naming.open.length > 0 && <div className="sponsor-offers">{naming.open.map(offer => {
      const quote = quoteNamingOffer(season, offer.id), outcome = requestOutcome(offer)
      return <article className="sponsor-offer" key={offer.id} data-naming-offer={offer.id} aria-labelledby={`${offer.id}-name`}>
        <div className="sponsor-identity"><strong id={`${offer.id}-name`}>{offer.arenaName}</strong><span>{sponsorName(offer.sponsorId)} · {seasons(offer.forSeason, offer.seasons)}</span>{outcome && <small className="sponsor-request-outcome">{outcome}</small>}</div>
        <dl><div><dt>Per season</dt><dd data-naming-fee={offer.annualFee}>{money(offer.annualFee)}</dd></div><div><dt>Guaranteed</dt><dd>{money(quote.totalGuaranteed)}</dd></div></dl>
        <div className="sponsor-actions"><button className="button small primary" data-naming-review={offer.id} onClick={() => setReviewId(offer.id)} disabled={busy || !quote.canAccept} aria-expanded={reviewId === offer.id} aria-controls="naming-offer-review">Review<Icon name="chevron" size={13} /></button>{quote.canRequest && <button className="button small" data-naming-request={offer.id} onClick={() => { setReviewId(null); onRequestNaming(offer.id) }} disabled={busy}>Ask for {SPONSORSHIP_REQUEST_PERCENT}% more</button>}<button className="text-button" data-naming-decline={offer.id} onClick={() => { setReviewId(null); onDeclineNaming(offer.id) }} disabled={busy}>Decline</button></div>
      </article>
    })}</div>}
    {review && <NamingReview key={review.id} season={season} offer={review} busy={busy} onClose={closeReview} onConfirm={() => { onAcceptNaming(review.id); setReviewId(null); focusWhenReady('[data-naming-current]') }} />}
    <details className="facility-rules"><summary><Icon name="settings" size={14} />How naming rights work{naming.closed.length > 0 || naming.ended.length > 0 ? ' · History' : ''}</summary><p>A naming partner pays for the arena to carry its name on club, match and fixture screens while the agreement runs; the official venue name stays unchanged in the league's records. Offers for next season arrive on matchday 6 of the final contracted season and value the arena's seats against the league's average venue, the league level, your sponsorship benchmark and the club's current appeal.</p><p>Each season is paid in two installments, on matchday 6 and after the final matchday. The same exit clause as for the main sponsor applies: after relegation or a sharp fall in results and crowds the partner may leave and pays its exit payment; your club can end the agreement early during a season for its termination fee per cancelled season.</p>{naming.ended.length > 0 && <ul className="facility-history" aria-label="Naming agreements ended early">{naming.ended.map(agreement => { const text = exitExplanation(agreement.sponsorId, 'naming', agreement.exit!, agreement.startsSeason); return <li key={agreement.id} data-naming-ended={agreement.id}><span><strong>{text.title}</strong><small>{scoutingDate(agreement.exit!.date)} · {text.detail}</small></span></li> })}</ul>}{naming.closed.length > 0 && <ul className="facility-history">{naming.closed.map(offer => <li key={offer.id} data-naming-history={offer.id}><span><strong>{offer.arenaName}</strong><small>{closedStatus[offer.status as Exclude<NamingRightsOffer['status'], 'open'>]}{offer.closedOn ? ` · ${scoutingDate(offer.closedOn)}` : ''}{requestOutcome(offer) ? ` · ${requestOutcome(offer)}` : ''}</small></span><span>{money(offer.annualFee)} / season</span></li>)}</ul>}</details>
  </section>
}

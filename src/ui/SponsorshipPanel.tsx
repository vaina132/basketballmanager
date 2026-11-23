import { useEffect, useRef, useState } from 'react'
import type { SponsorshipAgreement, SponsorshipOffer } from '../domain/commercial'
import type { SeasonState } from '../domain/season'
import { getDevelopmentSponsor } from '../data/development-sponsors'
import { getClubSponsorship, quoteSponsorshipOffer, type CommercialContract, type SponsorshipPaymentRow, type SponsorshipTerminationQuote } from '../world/commercial'
import { agreementLastSeason, sponsorshipReferenceFee, SPONSORSHIP_REQUEST_PERCENT } from '../world/commercial-policy'
import { dateForRound, seasonLabel } from '../world/season'
import { focusWhenReady } from './focus-when-ready'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import './facilities-panel.css'
import './sponsorship-panel.css'
import { formatMoney } from './money-format'
import { worldOf } from '../world/career-world'
import { clauseSummary, exitExplanation } from './sponsor-exit-text'

export interface SponsorshipActions {
  onEnableSponsorship: () => void
  onAcceptSponsorship: (offerId: string) => void
  onDeclineSponsorship: (offerId: string) => void
  onRequestSponsorship: (offerId: string) => void
  onSponsorshipDelegation: (delegated: boolean) => void
  /** Format 64: arena naming rights and early termination; absent where the career has no exit clauses. */
  onAcceptNaming?: (offerId: string) => void
  onDeclineNaming?: (offerId: string) => void
  onRequestNaming?: (offerId: string) => void
  onNamingDelegation?: (delegated: boolean) => void
  onTerminateSponsorship?: (contract: CommercialContract, agreementId: string) => void
}

/** Ending an agreement early: a two-step confirmation that states the fee and what follows (format 64). */
export function TerminationControl({ quote, contract, busy, onTerminate }: { quote: SponsorshipTerminationQuote; contract: CommercialContract; busy: boolean; onTerminate?: (contract: CommercialContract, agreementId: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  if (!onTerminate) return null
  const id = `terminate-${contract}-confirm`, cancelled = quote.lastSeason < quote.agreement.startsSeason
  return <div className="sponsor-terminate" data-sponsor-terminate={quote.agreement.id}>
    {!confirming ? <button className="text-button" onClick={() => setConfirming(true)} disabled={busy} aria-expanded={false} aria-controls={id}><Icon name="close" size={13} />End agreement early</button> : <div id={id} role="group" aria-label="End agreement early">
      <p>Ending it now costs a termination fee of <strong data-terminate-fee={quote.fee}>{money(quote.fee)}</strong> for {quote.cancelledSeasons} cancelled {quote.cancelledSeasons === 1 ? 'season' : 'seasons'}, paid today. {cancelled ? 'The agreement is cancelled before it starts.' : `It still pays through ${seasonLabel(quote.lastSeason)}.`} New offers arrive at the next sponsorship window.</p>
      {quote.reason && <p role="status" className="sponsor-terminate-reason">{quote.reason}</p>}
      <div className="sponsor-actions"><button className="button small" data-terminate-confirm={quote.agreement.id} disabled={busy || !quote.canTerminate} onClick={() => { setConfirming(false); onTerminate(contract, quote.agreement.id) }}>Pay {money(quote.fee)} and end</button><button className="text-button" onClick={() => setConfirming(false)} disabled={busy}>Keep agreement</button></div>
    </div>}
  </div>
}

const money = (amount: number) => formatMoney(amount)
const seasons = (from: number, count: number) => count === 1 ? seasonLabel(from) : `${seasonLabel(from)} – ${seasonLabel(from + count - 1)}`
// Format 64: an agreement ended early covers only the seasons up to its exit.
const covered = (agreement: SponsorshipAgreement) => seasons(agreement.startsSeason, agreementLastSeason(agreement) - agreement.startsSeason + 1)
const sponsorName = (sponsorId: string) => getDevelopmentSponsor(sponsorId).name
const paymentStatus: Record<SponsorshipPaymentRow['status'], string> = { received: 'Received', scheduled: 'Scheduled', conditional: 'If top half', 'not-earned': 'Not earned' }
const closedStatus: Record<Exclude<SponsorshipOffer['status'], 'open'>, string> = { accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', superseded: 'Closed after another agreement', expired: 'Expired' }

function requestOutcome(offer: SponsorshipOffer): string | null {
  if (!offer.request) return null
  if (offer.request.response === 'accepted') return `Agreed to your request: ${money(offer.annualFee)} a season`
  if (offer.request.response === 'withdrawn') return 'Withdrew after your request'
  return offer.annualFee > offer.initialAnnualFee ? `Countered at ${money(offer.annualFee)} a season` : 'Kept its original offer'
}

function OfferReview({ season, offer, busy, onConfirm, onClose }: { season: SeasonState; offer: SponsorshipOffer; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const region = useRef<HTMLElement>(null)
  const quote = quoteSponsorshipOffer(season, offer.id)
  useEffect(() => { region.current?.focus({ preventScroll: true }); region.current?.scrollIntoView({ block: 'nearest' }) }, [])
  return <section ref={region} id="sponsor-offer-review" className="sponsor-review" tabIndex={-1} aria-labelledby="sponsor-review-title" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() } }}>
    <header><div><h3 id="sponsor-review-title">Sign {sponsorName(offer.sponsorId)}</h3><span>Main sponsor · {seasons(offer.forSeason, offer.seasons)}</span></div><button className="text-button" onClick={onClose} disabled={busy}><Icon name="close" size={14} />Close</button></header>
    <dl className="sponsor-review-facts"><div><dt>Guaranteed each season</dt><dd data-sponsor-review-fee={offer.annualFee}>{money(offer.annualFee)}</dd></div><div><dt>Guaranteed in total</dt><dd>{money(quote.totalGuaranteed)}</dd></div><div><dt>Top-half bonus</dt><dd>{offer.bonus > 0 ? `${money(offer.bonus)} per season` : 'None'}</dd></div><div><dt>Offer open until</dt><dd><time dateTime={offer.expiresOn}>{scoutingDate(offer.expiresOn)}</time></dd></div></dl>
    {quote.clause && <p className="sponsor-clause" data-sponsor-clause><strong>Exit clause.</strong> {clauseSummary(season, quote.clause)}</p>}
    <table className="sponsor-schedule"><caption>Payment dates</caption><thead><tr><th scope="col">Date</th><th scope="col">Payment</th><th scope="col">Amount</th></tr></thead><tbody>{quote.payments.map(payment => <tr key={`${payment.seasonNumber}-${payment.installment}`}><td><time dateTime={payment.date}>{scoutingDate(payment.date)}</time></td><td>{payment.installment === 1 ? 'Opening installment' : 'Matchday 6 installment'} · {seasonLabel(payment.seasonNumber)}</td><td>{money(payment.amount)}</td></tr>)}{offer.bonus > 0 && <tr><td>After the final matchday</td><td>Top-half bonus, each season</td><td>{money(offer.bonus)}</td></tr>}</tbody></table>
    <footer><span id="sponsor-accept-reason" role="status">{quote.reason ?? 'Accepting signs this sponsor and closes your other offers.'}</span><button id="sponsor-accept-confirm" className="button primary" disabled={busy || !quote.canAccept} onClick={onConfirm} aria-describedby="sponsor-accept-reason"><Icon name="check" size={15} />Sign sponsor</button></footer>
  </section>
}

export function SponsorshipPanel({ season, busy = false, onEnableSponsorship, onAcceptSponsorship, onDeclineSponsorship, onRequestSponsorship, onSponsorshipDelegation, onTerminateSponsorship }: SponsorshipActions & { season: SeasonState; busy?: boolean }) {
  const sponsorship = getClubSponsorship(season)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const review = sponsorship.open.find(offer => offer.id === reviewId) ?? null
  const nextSeason = season.seasonNumber + 1
  const enableReason = !season.finance.enabledSince ? 'Enable club finances first.' : season.status !== 'active' ? 'Start the next season before enabling sponsorship negotiations.' : null
  const current = sponsorship.current
  const nextIsSeparate = sponsorship.next && sponsorship.next.id !== current?.id
  function closeReview() { const id = reviewId; setReviewId(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-sponsor-review="${id}"]`)?.focus({ preventScroll: true })) }

  let outlook: string
  const endedNow = sponsorship.ended.find(agreement => agreement.exit!.seasonNumber === season.seasonNumber)
  if (sponsorship.next && sponsorship.next.id === current?.id) outlook = `Contracted through ${seasonLabel(agreementLastSeason(current))}.`
  else if (nextIsSeparate) outlook = `${sponsorName(sponsorship.next!.sponsorId)} is signed from ${seasonLabel(sponsorship.next!.startsSeason)}.`
  else if (sponsorship.open.length) outlook = `${sponsorship.open.length} ${sponsorship.open.length === 1 ? 'offer' : 'offers'} for ${seasonLabel(nextSeason)}. Open offers expire on ${scoutingDate(sponsorship.open[0]!.expiresOn)}.`
  else if (season.status === 'complete') outlook = `No sponsor for ${seasonLabel(nextSeason)}. That season starts without main-sponsor income.`
  else if (season.round < 6) outlook = `Offers for ${seasonLabel(nextSeason)} arrive on matchday 6 (${scoutingDate(dateForRound(6, season.seasonNumber))}).`
  else outlook = `No offers are open. Clubs still without a sponsor receive a second round after the final matchday.`
  if (endedNow) outlook = `${exitExplanation(endedNow.sponsorId, 'main', endedNow.exit!, endedNow.startsSeason).detail} ${outlook}`

  return <section className="sponsorship-panel panel" aria-labelledby="sponsorship-title" data-sponsorship-enabled={sponsorship.enabled}>
    <header className="club-heading"><h2 id="sponsorship-title"><Icon name="wallet" size={18} />Main sponsor</h2>{sponsorship.enabled && <div className="facility-delegation"><label htmlFor="sponsor-control">Control</label><input id="sponsor-control" type="range" min={0} max={1} step={1} value={sponsorship.delegated ? 1 : 0} aria-valuetext={sponsorship.delegated ? 'Automatic' : 'Manual'} aria-describedby="sponsor-automatic-help" onChange={event => onSponsorshipDelegation(event.target.value === '1')} disabled={busy} /><output htmlFor="sponsor-control">{sponsorship.delegated ? 'Automatic' : 'Manual'}</output></div>}</header>
    {!sponsorship.enabled ? <div className="facility-enable"><Icon name="wallet" size={26} /><div><strong>Negotiate your main sponsor</strong><p>Your current sponsor pays a fixed {money(sponsorshipReferenceFee(worldOf(season), season.managedClubId, season))} a season. Enable negotiations to receive dated offers for future seasons, with two payments each season and optional bonuses. This season stays as it is.</p>{enableReason && <p id="sponsor-enable-reason">{enableReason}</p>}</div><button id="enable-sponsorship" className="button" onClick={onEnableSponsorship} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'sponsor-enable-reason' : undefined}>Enable negotiations</button></div> : <>
      <p className="facility-automatic-note" id="sponsor-automatic-help">Automatic signs the best offer when offers arrive.</p>
      <div className="sponsor-current" data-sponsor-current={current?.id ?? 'none'} tabIndex={-1}>{current ? <><div className="sponsor-identity"><strong>{sponsorName(current.sponsorId)}</strong><span>{getDevelopmentSponsor(current.sponsorId).sector} · {covered(current)}</span></div><dl><div><dt>This season</dt><dd>{sponsorship.fixedThisSeason ? `${money(current.annualFee)} · fixed` : money(current.annualFee)}</dd></div>{current.bonus > 0 && <div><dt>Top-half bonus</dt><dd>{money(current.bonus)}</dd></div>}{current.clause && <div><dt>Exit payment</dt><dd>{money(current.clause.exitPayment)}</dd></div>}</dl></> : <div className="sponsor-identity"><strong>No main sponsor this season</strong><span>No sponsorship income until a new agreement starts.</span></div>}</div>
      {sponsorship.payments.length > 0 && <ul className="sponsor-payments" aria-label={`Sponsorship payments ${seasonLabel(season.seasonNumber)}`}>{sponsorship.payments.map(payment => <li key={payment.label} data-sponsor-payment={payment.status}><span><strong>{payment.label}</strong><small><time dateTime={payment.date}>{scoutingDate(payment.date)}</time></small></span><span>{money(payment.amount)}</span><span className={`sponsor-pill sponsor-pill--${payment.status}`}>{paymentStatus[payment.status]}</span></li>)}</ul>}
      <p className="sponsor-outlook" data-sponsor-outlook>{outlook}</p>
      {(current?.clause ?? sponsorship.next?.clause) && <details className="sponsor-clause-details"><summary>Exit clause</summary><p data-sponsor-clause>{clauseSummary(season, (current?.clause ?? sponsorship.next?.clause)!)}</p></details>}
      {sponsorship.termination && <TerminationControl quote={sponsorship.termination} contract="main" busy={busy} onTerminate={onTerminateSponsorship} />}
      {sponsorship.open.length > 0 && <div className="sponsor-offers">{sponsorship.open.map(offer => {
        const quote = quoteSponsorshipOffer(season, offer.id), outcome = requestOutcome(offer)
        return <article className="sponsor-offer" key={offer.id} data-sponsor-offer={offer.id} aria-labelledby={`${offer.id}-name`}>
          <div className="sponsor-identity"><strong id={`${offer.id}-name`}>{sponsorName(offer.sponsorId)}</strong><span>{getDevelopmentSponsor(offer.sponsorId).sector} · {seasons(offer.forSeason, offer.seasons)}</span>{outcome && <small className="sponsor-request-outcome">{outcome}</small>}</div>
          <dl><div><dt>Per season</dt><dd data-sponsor-fee={offer.annualFee}>{money(offer.annualFee)}</dd></div><div><dt>Guaranteed</dt><dd>{money(quote.totalGuaranteed)}</dd></div><div><dt>Top-half bonus</dt><dd>{offer.bonus > 0 ? money(offer.bonus) : 'None'}</dd></div></dl>
          <div className="sponsor-actions"><button className="button small primary" data-sponsor-review={offer.id} onClick={() => setReviewId(offer.id)} disabled={busy || !quote.canAccept} aria-expanded={reviewId === offer.id} aria-controls="sponsor-offer-review">Review<Icon name="chevron" size={13} /></button>{quote.canRequest && <button className="button small" data-sponsor-request={offer.id} onClick={() => { setReviewId(null); onRequestSponsorship(offer.id) }} disabled={busy}>Ask for {SPONSORSHIP_REQUEST_PERCENT}% more</button>}<button className="text-button" data-sponsor-decline={offer.id} onClick={() => { setReviewId(null); onDeclineSponsorship(offer.id) }} disabled={busy}>Decline</button></div>
        </article>
      })}</div>}
      {review && <OfferReview key={review.id} season={season} offer={review} busy={busy} onClose={closeReview} onConfirm={() => { onAcceptSponsorship(review.id); setReviewId(null); focusWhenReady('[data-sponsor-current]') }} />}
      <details className="facility-rules"><summary><Icon name="settings" size={14} />How sponsorship works{sponsorship.closed.length > 0 ? ' · Offer history' : ''}</summary><p>Offers for next season arrive on matchday 6 of your sponsor's final season. Their value reflects your arena's demand compared with the league, this season's results and actual home attendance. Each offer can be improved once: the sponsor may agree, counter or occasionally withdraw.</p><p>Each season is paid in two installments, on the opening matchday and on matchday 6. A bonus is paid only after a top-half finish. Without an agreement the next season starts without sponsorship income; clubs still without a sponsor receive a second round of offers after the final matchday. Open offers expire when the season they would start begins.</p>{sponsorship.clauses && <p>Agreements carry an exit clause: after a season in which your club is relegated, misses the sponsor's objective badly or sees results and crowds fall sharply, the sponsor may leave and pays the agreed exit payment. Your club can end an agreement early during a season by paying its termination fee for each cancelled season.</p>}{sponsorship.ended.length > 0 && <ul className="facility-history" aria-label="Agreements ended early">{sponsorship.ended.map(agreement => { const text = exitExplanation(agreement.sponsorId, 'main', agreement.exit!, agreement.startsSeason); return <li key={agreement.id} data-sponsor-ended={agreement.id}><span><strong>{text.title}</strong><small>{scoutingDate(agreement.exit!.date)} · {text.detail}</small></span></li> })}</ul>}{sponsorship.closed.length > 0 && <ul className="facility-history">{sponsorship.closed.map(offer => <li key={offer.id} data-sponsor-history={offer.id}><span><strong>{sponsorName(offer.sponsorId)}</strong><small>{closedStatus[offer.status as Exclude<SponsorshipOffer['status'], 'open'>]}{offer.closedOn ? ` · ${scoutingDate(offer.closedOn)}` : ''}{requestOutcome(offer) ? ` · ${requestOutcome(offer)}` : ''}</small></span><span>{money(offer.annualFee)} / season</span></li>)}</ul>}</details>
    </>}
  </section>
}

import { useState, type ReactNode } from 'react'
import type { FacilityType } from '../domain/facilities'
import type { SeasonState } from '../domain/season'
import type { BoardFundingQuote } from '../world/board-funding-policy'
import { seasonRounds } from '../world/career-world'
import { facilityAutomationBuffer } from '../world/facilities-policy'
import { FACILITY_FINANCING_RULES as RULES, paymentRounds } from '../world/facility-debt'
import { quoteFacilityLease, quoteFacilityLoan } from '../world/facility-financing'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { formatEuros } from './money-format'
import './facility-financing.css'

export type FinancingChoice = 'cash' | 'board' | 'loan' | 'lease'
const money = (amount: number) => formatEuros(amount)
/** A yearly rate in basis points, as "5.25%". */
export const ratePercent = (basisPoints: number) => `${(basisPoints / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`
const SHARES = [100, 75, 50] as const

/** Format 71: the plain-English loan rules, shared by the review and the Club page. */
export function loanRulesText(season: SeasonState): string {
  const weeks = paymentRounds(seasonRounds(season))
  return `The bank lends up to the project cost while the club's loans and leases together stay within its borrowing limit. The rate is fixed for the whole loan: ${ratePercent(RULES.baseRateBasisPoints)} a year, up to ${RULES.leverageRateBasisPoints / 100} points more the more of its limit the club will owe, and ${RULES.thinCashRateBasisPoints / 100} point more while Spending left is below ${money(facilityAutomationBuffer(season, season.managedClubId))} (at most ${ratePercent(RULES.maxRateBasisPoints)}). Payments fall in weeks ${weeks.join(' and ')} of each season, starting with the next payment week; each covers half a year's interest on what is still owed and repays the rest. This season's payments are kept back in Spending left. A payment that cash cannot cover becomes an unpaid cost, which the board sees at its reviews. You can repay early on Club: the remaining principal plus a ${RULES.earlyRepaymentFeePercent}% fee.`
}

/** Format 71: the plain-English lease rules. */
export function leaseRulesText(): string {
  return `The leased level is installed for the next matchday and nothing is paid now. The lease costs the purchase price plus ${RULES.leasePremiumPercentPerSeason}% for each season of its term, paid in equal parts twice a season; once every payment is made, the level is the club's. While leased, the facility cannot be upgraded further. Ending the lease early on Club hands the level back and costs ${RULES.leaseEndPenaltyPercent}% of the payments still to come.`
}

interface FinancingProps {
  season: SeasonState
  type: FacilityType
  project: 'upgrade' | 'repair'
  /** Whether paying in full now is possible, and the footer that does it. */
  cashAvailable: boolean
  cashFooter: ReactNode
  /** The board's quote when money is the only obstacle, and its section. */
  board: BoardFundingQuote | null
  boardBlock: ReactNode
  busy: boolean
  onLoan: (seasons: number, principal: number) => void
  onLease?: (seasons: number) => void
}

/**
 * Format 71: how to pay for an upgrade or repair: pay now, board capital (when money is the only obstacle), a bank
 * loan or, for arena and training upgrades, a lease. Each choice shows its full cost before anything is committed.
 */
export function FacilityFinancing({ season, type, project, cashAvailable, cashFooter, board, boardBlock, busy, onLoan, onLease }: FinancingProps) {
  const leaseable = project === 'upgrade' && RULES.leaseTypes.includes(type) && !!onLease
  const [choice, setChoice] = useState<FinancingChoice>(cashAvailable ? 'cash' : board?.eligible ? 'board' : 'loan')
  const [seasons, setSeasons] = useState(3)
  const [share, setShare] = useState<typeof SHARES[number]>(100)
  const clubId = season.managedClubId
  const probe = quoteFacilityLoan(season, type, clubId, project, seasons)
  const principal = share === 100 ? probe.maxPrincipal : Math.floor(probe.maxPrincipal * share / 100 / 100) * 100
  const loan = quoteFacilityLoan(season, type, clubId, project, seasons, principal)
  const lease = leaseable ? quoteFacilityLease(season, type, clubId, seasons) : null
  const work = project === 'repair' ? 'the repair' : 'construction'
  const options: { value: FinancingChoice; label: string; detail: string }[] = [
    { value: 'cash', label: 'Pay now', detail: cashAvailable ? 'From Spending left' : 'Not possible now' },
    ...(board ? [{ value: 'board' as const, label: 'Board capital', detail: board.eligible ? board.approved ? 'The board would approve' : 'The board would refuse' : 'Not available now' }] : []),
    { value: 'loan', label: 'Bank loan', detail: loan.canBorrow ? `${ratePercent(loan.rateBasisPoints)} a year, fixed` : 'Not available now' },
    ...(lease ? [{ value: 'lease' as const, label: 'Lease', detail: lease.canLease ? 'Nothing paid now' : 'Not available now' }] : []),
  ]
  const terms = <label>Term<select value={seasons} onChange={event => setSeasons(Number(event.target.value))} disabled={busy} data-financing-term>{RULES.termSeasons.map(value => <option key={value} value={value}>{value} seasons</option>)}</select></label>
  return <section className="facility-financing" aria-labelledby={`facility-financing-${project}-title`} data-financing-choice={choice}>
    <h4 id={`facility-financing-${project}-title`}><Icon name="wallet" size={15} />How to pay</h4>
    <fieldset className="facility-financing-options"><legend className="visually-hidden">Payment method</legend>{options.map(option => <label key={option.value} className={choice === option.value ? 'selected' : ''}><input type="radio" name={`facility-financing-${project}`} value={option.value} checked={choice === option.value} onChange={() => setChoice(option.value)} disabled={busy} data-financing-option={option.value} /><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}</fieldset>
    {choice === 'cash' && cashFooter}
    {choice === 'board' && boardBlock}
    {choice === 'loan' && <div className="facility-financing-terms" data-financing="loan">
      <div className="facility-financing-controls">{terms}<label>Borrow<select value={share} onChange={event => setShare(Number(event.target.value) as typeof SHARES[number])} disabled={busy} data-financing-share>{SHARES.map(value => <option key={value} value={value}>{value === 100 ? probe.maxPrincipal < probe.cost ? 'Up to the borrowing limit' : 'The whole cost' : value === 75 ? 'Three quarters' : 'Half'}</option>)}</select></label></div>
      <dl className="facility-review-facts">
        <div><dt>Borrowed</dt><dd data-loan-principal={loan.principal}>{money(loan.principal)}<small>{loan.downPayment ? `${money(loan.downPayment)} paid now from Spending left` : 'Nothing paid now'}</small></dd></div>
        <div><dt>Fixed interest</dt><dd data-loan-rate={loan.rateBasisPoints}>{ratePercent(loan.rateBasisPoints)} a year</dd></div>
        <div><dt>Repayments</dt><dd data-loan-payment={loan.payment}>{loan.payments} × {money(loan.payment)}<small>{loan.schedule[0] ? <>Two a season · first <time dateTime={loan.schedule[0].date}>{scoutingDate(loan.schedule[0].date)}</time></> : 'Two a season'}</small></dd></div>
        <div><dt>Total interest</dt><dd data-loan-interest={loan.interest}>{money(loan.interest)}</dd></div>
        <div><dt>Total repaid</dt><dd data-loan-total={loan.total}>{money(loan.total)}</dd></div>
        <div><dt>Repayments this season</dt><dd data-loan-reserved={loan.dueThisSeason}>{money(loan.dueThisSeason)}<small>Kept back in Spending left</small></dd></div>
        <div><dt>Club debt after</dt><dd>{money(loan.debtAfter)}<small>Borrowing limit {money(loan.limit)}</small></dd></div>
      </dl>
      <details className="facility-review-details"><summary>Loan rules</summary><p>{loanRulesText(season)}</p></details>
      <footer><span id={`facility-loan-reason-${project}`} role="status">{loan.reason ?? `Borrow ${money(loan.principal)} and start ${work} now.`}</span><button id={`facility-loan-confirm-${project}`} className="button primary" disabled={busy || !loan.canBorrow} onClick={() => onLoan(seasons, loan.principal)} aria-describedby={`facility-loan-reason-${project}`}><Icon name="wallet" size={15} />Borrow and start</button></footer>
    </div>}
    {choice === 'lease' && lease && onLease && <div className="facility-financing-terms" data-financing="lease">
      <div className="facility-financing-controls">{terms}</div>
      <dl className="facility-review-facts">
        <div><dt>Paid now</dt><dd>{money(0)}<small>Level {lease.toLevel} ready for the next matchday</small></dd></div>
        <div><dt>Lease payments</dt><dd data-lease-payment={lease.payment}>{lease.payments} × {money(lease.payment)}<small>{lease.schedule[0] ? <>Two a season · first <time dateTime={lease.schedule[0].date}>{scoutingDate(lease.schedule[0].date)}</time></> : 'Two a season'}</small></dd></div>
        <div><dt>Total cost</dt><dd data-lease-total={lease.total}>{money(lease.total)}<small>{money(lease.premium)} more than buying for {money(lease.price)}</small></dd></div>
        <div><dt>Payments this season</dt><dd data-lease-reserved={lease.dueThisSeason}>{money(lease.dueThisSeason)}<small>Kept back in Spending left</small></dd></div>
        <div><dt>Ending early</dt><dd>{RULES.leaseEndPenaltyPercent}% of what is left<small>The level is handed back</small></dd></div>
        <div><dt>Club debt after</dt><dd>{money(lease.debtAfter)}<small>Borrowing limit {money(lease.limit)}</small></dd></div>
      </dl>
      <details className="facility-review-details"><summary>Lease rules</summary><p>{leaseRulesText()}</p></details>
      <footer><span id="facility-lease-reason" role="status">{lease.reason ?? `Lease level ${lease.toLevel} for ${seasons} seasons; it is installed for the next matchday.`}</span><button id="facility-lease-confirm" className="button primary" disabled={busy || !lease.canLease} onClick={() => onLease(seasons)} aria-describedby="facility-lease-reason"><Icon name="building" size={15} />Sign lease</button></footer>
    </div>}
  </section>
}

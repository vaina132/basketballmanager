import { useState } from 'react'
import type { SeasonState } from '../domain/season'
import { calendarDaysBetween } from '../world/competition-calendar'
import { BANK_LOAN_RULES, debtSourceId, FACILITY_FINANCING_RULES } from '../world/facility-debt'
import { getClubDebts, quoteBankLoan, type ClubDebts } from '../world/facility-financing'
import { financeLedgerRows } from '../world/finance'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { formatMoney } from './money-format'
import './facility-financing.css'
import './simple-facilities.css'

const money = (amount: number) => formatMoney(amount)
const rate = (basisPoints: number) => `${(basisPoints / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`
const seasons = (value: number) => `${value} ${value === 1 ? 'season' : 'seasons'}`

/** The amounts the bank offers: from the smallest loan to the club's room under its limit, in about 40 steps. */
export function bankLoanAmounts(minimum: number, maximum: number): number[] {
  if (maximum < minimum) return []
  const step = Math.max(minimum, Math.ceil((maximum - minimum) / 40 / minimum) * minimum)
  const amounts: number[] = []
  for (let amount = minimum; amount < maximum; amount += step) amounts.push(amount)
  return [...amounts, maximum]
}

/** Whole weeks from today to a date ("this week" when it is today or past). */
function inWeeks(today: string, date: string): string {
  const days = calendarDaysBetween(today, date)
  if (days <= 0) return 'this week'
  const value = Math.ceil(days / 7)
  return `in ${value} ${value === 1 ? 'week' : 'weeks'}`
}

/**
 * Format 74 (`bank-1`): the simple bank loan on Club. The amount goes straight into Remaining budget and can pay for
 * anything; it is repaid with interest in equal payments, twice a season from next season. Running loans show what is
 * still owed, the next payment and when the loan is paid off.
 */
export function BankPanel({ season, busy = false, suggested, onBorrow, onRepayLoan }: { season: SeasonState; busy?: boolean; suggested?: number | null; onBorrow?: (principal: number, seasons: number) => void; onRepayLoan?: (debtId: string) => void }) {
  const probe = quoteBankLoan(season, season.managedClubId, BANK_LOAN_RULES.termSeasons[1]!)
  const amounts = bankLoanAmounts(probe.minimumPrincipal, probe.maxPrincipal)
  const initial = suggested ? amounts.findIndex(amount => amount >= suggested) : -1
  const [index, setIndex] = useState(initial >= 0 ? initial : Math.max(0, Math.floor(amounts.length / 4)))
  const [term, setTerm] = useState(BANK_LOAN_RULES.termSeasons[1]!)
  const [confirming, setConfirming] = useState<string | null>(null)
  const debts = getClubDebts(season)
  const amount = amounts[Math.min(index, amounts.length - 1)] ?? probe.minimumPrincipal
  const quote = quoteBankLoan(season, season.managedClubId, term, amount)
  const unpaidBy = new Map(financeLedgerRows(season.finance, season.managedClubId).filter(row => typeof row.debt?.payment === 'number').map(row => [row.sourceId, row.unpaidDelta]))
  const open = debts.rows.filter(row => !row.position.settled && row.position.outstanding > 0)
  const closed = debts.rows.filter(row => !open.includes(row))
  const next = open.map(row => row.position.next).filter(item => item !== null).sort((left, right) => left.date.localeCompare(right.date))[0]
  const nextTotal = next ? open.reduce((sum, row) => sum + (row.position.next?.date === next.date ? row.position.next.amount : 0), 0) : 0
  const missed = open.reduce((sum, row) => sum + row.position.schedule.slice(0, row.position.booked).reduce((total, payment) => total + Math.max(0, unpaidBy.get(debtSourceId(row.debt.id, payment.number)) ?? 0), 0), 0)

  function card(row: ClubDebts['rows'][number]) {
    const { debt, position, settlement } = row, running = !position.settled && position.outstanding > 0
    const last = position.schedule.at(-1)!, paid = position.schedule.slice(0, position.booked).reduce((sum, payment) => sum + payment.amount, 0)
    return <article className="club-debt bank-loan" key={debt.id} data-debt={debt.id} data-debt-kind={debt.kind}>
      <header><div><strong>{money(debt.principal)} loan</strong><small>{seasons(debt.seasons)} at {rate(debt.rateBasisPoints)} · from <time dateTime={debt.date}>{scoutingDate(debt.date)}</time></small></div><div><strong data-debt-outstanding={position.outstanding}>{money(position.outstanding)}</strong><small>{running ? 'Still owed' : position.settled ? 'Repaid early' : 'Repaid'}</small></div></header>
      {running && <dl className="club-debt-facts">
        <div><dt>Next payment</dt><dd data-debt-next={position.next?.amount}>{position.next ? <>{money(position.next.amount)} · <time dateTime={position.next.date}>{scoutingDate(position.next.date)}</time><small>{position.next.seasonNumber === season.seasonNumber ? inWeeks(season.date, position.next.date) : 'next season'}</small></> : '—'}</dd></div>
        <div><dt>Payments left</dt><dd data-debt-booked={position.booked}>{position.schedule.length - position.booked} of {position.schedule.length}</dd></div>
        <div><dt>Paid off</dt><dd><time dateTime={last.date}>{scoutingDate(last.date)}</time><small>{last.seasonNumber === season.seasonNumber ? inWeeks(season.date, last.date) : `${last.seasonNumber - season.seasonNumber === 1 ? 'next season' : `in ${last.seasonNumber - season.seasonNumber} seasons`}`}</small></dd></div>
      </dl>}
      <progress value={paid} max={Math.max(1, debt.total)} aria-label={`${money(paid)} repaid of ${money(debt.total)}`} />
      {running && onRepayLoan && (confirming === debt.id ? <div className="club-debt-confirm" role="group" aria-label="Confirm early repayment"><p>Pay {money(settlement.amount)} now: the {money(settlement.outstanding)} still owed plus a {FACILITY_FINANCING_RULES.earlyRepaymentFeePercent}% fee. No interest is charged after today.</p><div><button className="button" onClick={() => setConfirming(null)} disabled={busy}>Keep the loan</button><button className="button primary" data-debt-confirm={debt.id} onClick={() => { setConfirming(null); onRepayLoan(debt.id) }} disabled={busy || !settlement.canSettle}>Repay now</button></div></div>
        : <div className="club-debt-actions"><span id={`debt-reason-${debt.id}`}>{settlement.reason ?? `Repay early for ${money(settlement.amount)}.`}</span><button className="button small" data-debt-settle={debt.id} onClick={() => setConfirming(debt.id)} disabled={busy || !settlement.canSettle} aria-describedby={`debt-reason-${debt.id}`}>Repay early</button></div>)}
    </article>
  }

  return <section id="club-bank" className="club-bank panel" aria-labelledby="club-bank-title" tabIndex={-1}>
    <header className="club-heading"><h2 id="club-bank-title"><Icon name="wallet" size={18} />Bank</h2><span>{open.length ? `${open.length} ${open.length === 1 ? 'loan' : 'loans'} running` : 'No loans'}</span></header>
    <dl className="club-finance-summary"><div><dt>Owed</dt><dd data-debts-outstanding={debts.outstanding}>{money(debts.outstanding)}</dd></div><div><dt>You can still borrow</dt><dd data-bank-room={probe.maxPrincipal}>{money(probe.maxPrincipal)}<small>limit {money(debts.limit)}</small></dd></div><div><dt>Next payment</dt><dd>{next ? <>{money(nextTotal)} · <time dateTime={next.date}>{scoutingDate(next.date)}</time></> : 'None'}</dd></div></dl>
    {missed > 0 && <p className="club-unpaid-note" role="status">{money(missed)} of loan payments could not be paid and became unpaid costs. New income clears them first.</p>}
    {amounts.length ? <details className="game-disclosure bank-borrow-more" open={suggested ? true : undefined}><summary><Icon name="wallet" size={15} />Borrow money</summary><div className="bank-borrow">
      <div className="bank-borrow-controls">
        <div className="club-ticket-control"><div><label htmlFor="bank-amount">Amount</label><output htmlFor="bank-amount" data-bank-amount={amount}>{money(amount)}</output></div><input id="bank-amount" type="range" min={0} max={amounts.length - 1} step={1} value={Math.min(index, amounts.length - 1)} aria-valuetext={money(amount)} onChange={event => setIndex(Number(event.target.value))} disabled={busy} /><div className="club-range-labels"><span>{money(amounts[0]!)}</span><span>{money(amounts.at(-1)!)}</span></div></div>
        <fieldset className="bank-terms"><legend>Repay over</legend><div className="segmented" role="group">{BANK_LOAN_RULES.termSeasons.map(value => <button key={value} type="button" aria-pressed={term === value} className={term === value ? 'selected' : ''} onClick={() => setTerm(value)} disabled={busy} data-bank-term={value}>{seasons(value)}</button>)}</div></fieldset>
      </div>
      <dl className="club-debt-facts bank-quote"><div><dt>Interest</dt><dd data-bank-rate={quote.rateBasisPoints}>{rate(quote.rateBasisPoints)} a year</dd></div><div><dt>Repayments</dt><dd data-bank-payment={quote.payment}>{quote.payments} × {money(quote.payment)}<small>twice a season, from {quote.schedule[0] ? scoutingDate(quote.schedule[0].date) : 'next season'}</small></dd></div><div><dt>Total to repay</dt><dd data-bank-total={quote.total}>{money(quote.total)}<small>{money(quote.interest)} interest</small></dd></div><div><dt>Spending left after</dt><dd data-bank-budget-after={quote.remainingBudgetAfter}>{money(quote.remainingBudgetAfter)}</dd></div></dl>
      <footer><span id="bank-borrow-reason" role="status">{quote.reason ?? 'The money is added to Spending left at once and can pay for anything.'}</span><button id="bank-borrow" className="button primary" onClick={() => onBorrow?.(amount, term)} disabled={busy || !quote.canBorrow || !onBorrow} aria-describedby="bank-borrow-reason"><Icon name="wallet" size={15} />Borrow {money(amount)}</button></footer>
    </div></details> : <p className="club-note">{probe.reason ?? 'The club has reached its borrowing limit.'}</p>}
    {open.length > 0 && <div className="club-debt-list">{open.map(card)}</div>}
    {closed.length > 0 && <details className="game-disclosure club-debts-settled"><summary><Icon name="check" size={15} />Repaid · {closed.length}</summary><div className="club-debt-list">{[...closed].reverse().map(card)}</div></details>}
    <details className="game-disclosure club-debts-help"><summary><Icon name="wallet" size={15} />How the bank works</summary><p>The club may owe up to {BANK_LOAN_RULES.limitBudgetPercent}% of its season budget. Interest is fixed when you borrow: {rate(FACILITY_FINANCING_RULES.baseRateBasisPoints)} a year, up to {rate(FACILITY_FINANCING_RULES.leverageRateBasisPoints)} more the closer the club gets to its limit and {rate(FACILITY_FINANCING_RULES.thinCashRateBasisPoints)} more while Spending left is low, at most {rate(FACILITY_FINANCING_RULES.maxRateBasisPoints)}.</p><p>Repayments start next season and are kept back from each season's Spending left, so they cannot be spent twice. A payment the club cannot cover becomes an unpaid cost. Above {FACILITY_FINANCING_RULES.boardDebtFreePercent}% of the limit the board's reviews drop a little (at most {FACILITY_FINANCING_RULES.boardDebtImpactMax} points). Early repayment costs a {FACILITY_FINANCING_RULES.earlyRepaymentFeePercent}% fee.</p></details>
  </section>
}

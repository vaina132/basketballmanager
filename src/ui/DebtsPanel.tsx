import { useState } from 'react'
import type { SeasonState } from '../domain/season'
import { financeLedgerRows } from '../world/finance'
import { debtSourceId, FACILITY_FINANCING_RULES as RULES } from '../world/facility-debt'
import { getClubDebts, type ClubDebts } from '../world/facility-financing'
import { FACILITY_LABELS } from './FacilitiesPanel'
import { leaseRulesText, loanRulesText, ratePercent } from './FacilityFinancing'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { formatEuros } from './money-format'
import './facility-financing.css'

const money = (amount: number) => formatEuros(amount)

/** Format 71: the club's loans and leases on Club: what is owed, the next payments, missed payments and early settlement. */
export function DebtsPanel({ season, busy = false, onRepayLoan, onEndLease }: { season: SeasonState; busy?: boolean; onRepayLoan?: (debtId: string) => void; onEndLease?: (debtId: string) => void }) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const debts = getClubDebts(season)
  if (!debts.enabled || !debts.rows.length) return null
  // A scheduled payment that cash could not cover shows as an increase in unpaid costs on its ledger row.
  const unpaidBy = new Map(financeLedgerRows(season.finance, season.managedClubId).filter(row => typeof row.debt?.payment === 'number').map(row => [row.sourceId, row.unpaidDelta]))
  const missedOf = (row: ClubDebts['rows'][number]) => row.position.schedule.slice(0, row.position.booked).reduce((sum, payment) => sum + Math.max(0, unpaidBy.get(debtSourceId(row.debt.id, payment.number)) ?? 0), 0)
  const open = debts.rows.filter(row => !row.position.settled && row.position.outstanding > 0)
  const closed = debts.rows.filter(row => !open.includes(row))
  const missed = open.reduce((sum, row) => sum + missedOf(row), 0)
  function card(row: ClubDebts['rows'][number]) {
    const { debt, position, settlement } = row, loan = debt.kind === 'loan'
    const project = season.facilities.projects.find(item => item.id === debt.projectId)
    const label = loan ? project?.kind === 'repair' ? 'Repair loan' : `Loan · level ${project?.toLevel ?? ''}` : `Lease · level ${project?.toLevel ?? ''}`
    const paid = position.schedule.slice(0, position.booked).reduce((sum, payment) => sum + payment.amount, 0)
    const status = position.settled ? loan ? 'Repaid early' : 'Ended early' : position.outstanding === 0 ? loan ? 'Repaid' : 'Paid · level owned' : 'Running'
    const action = loan ? onRepayLoan : onEndLease, isOpen = !position.settled && position.outstanding > 0
    return <article className="club-debt" key={debt.id} data-debt={debt.id} data-debt-kind={debt.kind}>
      <header><div><strong>{FACILITY_LABELS[debt.facilityType]}</strong><small>{label} · from <time dateTime={debt.date}>{scoutingDate(debt.date)}</time></small></div><div><strong data-debt-outstanding={position.outstanding}>{money(position.outstanding)}</strong><small>{loan ? 'Principal left' : 'Payments to come'}</small></div></header>
      <dl className="club-debt-facts">
        <div><dt>{loan ? 'Borrowed' : 'Purchase price'}</dt><dd>{money(debt.principal)}</dd></div>
        <div><dt>{loan ? 'Fixed interest' : 'Total cost'}</dt><dd>{loan ? `${ratePercent(debt.rateBasisPoints)} a year` : money(debt.total)}</dd></div>
        <div><dt>Payments made</dt><dd data-debt-booked={position.booked}>{position.booked} of {position.schedule.length}</dd></div>
        <div><dt>Next payment</dt><dd data-debt-next={position.next?.amount}>{position.next ? <>{money(position.next.amount)} · <time dateTime={position.next.date}>{scoutingDate(position.next.date)}</time></> : status}</dd></div>
      </dl>
      <progress value={paid} max={Math.max(1, debt.total)} aria-label={`${money(paid)} paid of ${money(debt.total)}`} />
      <details className="club-debt-schedule"><summary>{status} · Payment dates</summary><ol>{position.schedule.map(payment => {
        const booked = payment.number <= position.booked, unpaid = booked ? Math.max(0, unpaidBy.get(debtSourceId(debt.id, payment.number)) ?? 0) : 0
        return <li key={payment.number} data-debt-payment={payment.number}><span>Payment {payment.number} · <time dateTime={payment.date}>{scoutingDate(payment.date)}</time></span><span className={unpaid ? 'club-debt-unpaid' : ''}>{money(payment.amount)} · {booked ? unpaid ? `${money(unpaid)} unpaid` : 'Paid' : position.settled ? 'Not needed' : 'Scheduled'}</span></li>
      })}</ol>{debt.settled && <p>{loan ? 'Repaid early' : 'Ended early'} <time dateTime={debt.settled.date}>{scoutingDate(debt.settled.date)}</time> · {money(debt.settled.amount)}</p>}</details>
      {isOpen && action && (confirming === debt.id ? <div className="club-debt-confirm" role="group" aria-label={loan ? 'Confirm early repayment' : 'Confirm ending the lease'}>
        <p>{loan ? `Pay ${money(settlement.amount)} now: the ${money(settlement.outstanding)} still owed plus a ${RULES.earlyRepaymentFeePercent}% fee of ${money(settlement.charge)}. The interest not yet due is saved.` : `Pay a penalty of ${money(settlement.amount)}, ${RULES.leaseEndPenaltyPercent}% of the ${money(settlement.outstanding)} still to come. The leased level is handed back after today and the ${FACILITY_LABELS[debt.facilityType].toLowerCase()} return to level ${project?.fromLevel ?? 1}.`}</p>
        <div><button className="button" onClick={() => setConfirming(null)} disabled={busy}>{loan ? 'Keep the loan' : 'Keep the lease'}</button><button className="button primary" data-debt-confirm={debt.id} onClick={() => { setConfirming(null); action(debt.id) }} disabled={busy || !settlement.canSettle}>{loan ? 'Repay now' : 'End lease'}</button></div>
      </div> : <div className="club-debt-actions"><span id={`debt-reason-${debt.id}`}>{settlement.reason ?? (loan ? `Early repayment: ${money(settlement.amount)}, including the ${RULES.earlyRepaymentFeePercent}% fee.` : `Ending early costs ${money(settlement.amount)} and hands the level back.`)}</span><button className="button small" data-debt-settle={debt.id} onClick={() => setConfirming(debt.id)} disabled={busy || !settlement.canSettle} aria-describedby={`debt-reason-${debt.id}`}>{loan ? 'Repay early' : 'End lease'}</button></div>)}
    </article>
  }
  return <section className="club-debts panel" aria-labelledby="club-debts-title">
    <header className="club-heading"><h2 id="club-debts-title"><Icon name="wallet" size={18} />Loans &amp; leases</h2><span>{open.length} running</span></header>
    <dl className="club-finance-summary"><div><dt>Owed</dt><dd data-debts-outstanding={debts.outstanding}>{money(debts.outstanding)}</dd></div><div><dt>Borrowing limit · {debts.ratioPercent}% used</dt><dd data-debts-limit={debts.limit}>{money(debts.limit)}</dd></div><div><dt>Still to pay this season · reserved</dt><dd data-debts-reserved={debts.dueThisSeason}>{money(debts.dueThisSeason)}</dd></div></dl>
    {missed > 0 && <p className="club-unpaid-note" role="status">{money(missed)} of loan and lease payments could not be paid from cash and became unpaid costs. New income clears them first; the board sees unpaid costs at its reviews.</p>}
    {open.length > 0 && <div className="club-debt-list">{open.map(card)}</div>}
    {closed.length > 0 && <details className="game-disclosure club-debts-settled"><summary><Icon name="check" size={15} />Repaid and ended · {closed.length}</summary><div className="club-debt-list">{[...closed].reverse().map(card)}</div></details>}
    <details className="game-disclosure club-debts-help"><summary><Icon name="wallet" size={15} />How loans and leases work</summary><p>Owed counts each loan's remaining principal and each lease's remaining payments. This season's payments are kept back in Remaining budget, so they cannot be spent twice. Above {RULES.boardDebtFreePercent}% of the borrowing limit the board's reviews lower its assessment a little (at most {RULES.boardDebtImpactMax} points), and from {RULES.boardCapitalSurcharge.at(-1)![0]}% it needs more confidence before granting capital.</p><p>{loanRulesText(season)}</p><p>{leaseRulesText()}</p></details>
  </section>
}

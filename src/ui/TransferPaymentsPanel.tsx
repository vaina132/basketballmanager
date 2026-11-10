import type { EmploymentTransfer } from '../domain/employment'
import type { SeasonState } from '../domain/season'
import { getDevelopmentPlayer } from '../data/development-players'
import { getTransferInstallmentRemaining, getTransferInstallments, getTransferPayments, getTransferPaymentSummary, paymentPlanLabel } from '../world/transfer-payments'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { transferMoney as money } from './TransferPaymentTerms'
import './transfer-payments.css'

export function TransferPaymentRecord({ transfer, date, incoming = false }: { transfer: EmploymentTransfer; date: string; incoming?: boolean }) {
  const installments = getTransferInstallments(transfer)
  const payments = getTransferPayments(transfer)
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0)
  const remaining = transfer.fee - paid
  const overdue = installments.reduce((sum, installment, index) => sum + (installment.dueOn <= date ? getTransferInstallmentRemaining(transfer, index) : 0), 0)
  return <div className="transfer-payment-record" data-transfer-record={transfer.id}>
    <div className="transfer-payment-totals"><span>{incoming ? 'Received' : 'Paid'} <strong data-transfer-paid={paid}>{money(paid)}</strong></span><span>{incoming ? 'To receive' : 'Remaining'} <strong data-transfer-remaining={remaining}>{money(remaining)}</strong></span>{overdue > 0 && <span className="transfer-overdue">Overdue <strong data-transfer-overdue={overdue}>{money(overdue)}</strong></span>}</div>
    <progress value={paid} max={transfer.fee} aria-label={`${money(paid)} ${incoming ? 'received' : 'paid'} of ${money(transfer.fee)}`} />
    <details className="transfer-payment-detail"><summary>{paymentPlanLabel(transfer.paymentPlan ?? 'upfront')} · Dates & receipts</summary><ol>{installments.map((installment, index) => {
      const unpaid = getTransferInstallmentRemaining(transfer, index)
      const receipts = payments.filter(payment => payment.installmentIndex === index)
      return <li key={index} data-transfer-installment={index}><div><span>Payment {index + 1} · <time dateTime={installment.dueOn}>{scoutingDate(installment.dueOn)}</time></span><strong>{money(installment.amount)}</strong></div><div><span className={unpaid && installment.dueOn <= date ? 'transfer-overdue' : ''}>{unpaid ? `${money(unpaid)} ${installment.dueOn <= date ? 'overdue' : incoming ? 'expected' : 'scheduled'}` : incoming ? 'Received in full' : 'Paid in full'}</span>{receipts.map(payment => <small key={payment.id}>{money(payment.amount)} {incoming ? 'received' : 'paid'} <time dateTime={payment.paidOn}>{scoutingDate(payment.paidOn)}</time></small>)}</div></li>
    })}</ol></details>
  </div>
}

export function TransferPaymentsPanel({ season }: { season: SeasonState }) {
  const clubId = season.managedClubId
  const transfers = season.employment.transfers.filter(transfer => transfer.toClubId === clubId || transfer.fromClubId === clubId)
  if (!transfers.length) return null
  const summary = getTransferPaymentSummary(season, clubId)
  const nextDueAmount = transfers.filter(transfer => transfer.toClubId === clubId).reduce((total, transfer) => total + getTransferInstallments(transfer).reduce((sum, installment, index) => sum + (installment.dueOn === summary.nextDueOn ? getTransferInstallmentRemaining(transfer, index) : 0), 0), 0)
  const unsettled = transfers.filter(transfer => getTransferPayments(transfer).reduce((sum, payment) => sum + payment.amount, 0) < transfer.fee)
  const settled = transfers.filter(transfer => !unsettled.includes(transfer))
  function card(transfer: EmploymentTransfer) {
    const incoming = transfer.fromClubId === clubId
    const counterpart = season.clubs.find(club => club.id === (incoming ? transfer.toClubId : transfer.fromClubId))!
    const player = getDevelopmentPlayer(transfer.playerId)
    return <article className="club-transfer-payment" key={transfer.id} data-payment-direction={incoming ? 'incoming' : 'outgoing'}><header><span aria-hidden="true"><Avatar player={player} color={counterpart.color} size={36} /></span><div><strong>{player.name}</strong><small>{incoming ? 'From' : 'To'} {counterpart.name}</small></div><div><strong>{money(transfer.fee)}</strong><small>{incoming ? 'Sale income' : 'Transfer fee'}</small></div></header><TransferPaymentRecord transfer={transfer} date={season.date} incoming={incoming} /></article>
  }
  return <section className="club-transfer-payments panel" aria-labelledby="club-transfer-payments-title"><header className="club-heading"><h2 id="club-transfer-payments-title"><Icon name="swap" size={18} />Transfer payments</h2><span>{unsettled.length} open {unsettled.length === 1 ? 'agreement' : 'agreements'}</span></header>
    <dl className="club-finance-summary"><div><dt>Payments remaining</dt><dd data-transfer-outgoing={summary.outgoingRemaining}>{money(summary.outgoingRemaining)}</dd></div><div><dt>Overdue · included above</dt><dd className={summary.overdue ? 'transfer-overdue' : ''}>{money(summary.overdue)}</dd></div><div><dt>Expected sale income</dt><dd data-transfer-incoming={summary.incomingRemaining}>{money(summary.incomingRemaining)}</dd></div></dl>
    {summary.nextDueOn && !summary.overdue && <p className="club-transfer-next"><Icon name="calendar" size={15} />Next payment <strong>{money(nextDueAmount)}</strong><time dateTime={summary.nextDueOn}>{scoutingDate(summary.nextDueOn)}</time></p>}
    {summary.overdue > 0 && <p className="club-unpaid-note" role="status">{money(summary.overdue)} remains overdue. Staff hiring, paid transfers and contract buyouts are blocked. Available cash after player salaries is collected automatically when the calendar advances.</p>}
    <div className="club-transfer-payment-list">{unsettled.map(card)}</div>
    {settled.length > 0 && <details className="game-disclosure club-transfer-settled"><summary><Icon name="check" size={15} />Settled transfers · {settled.length}</summary><div className="club-transfer-payment-list">{[...settled].reverse().map(card)}</div></details>}
    <details className="game-disclosure transfer-payment-help"><summary><Icon name="wallet" size={15} />How payments affect your budget</summary><p>All unpaid fees stay reserved in Remaining budget. Due payments are collected automatically as the calendar advances, after protecting player salaries. Expected sale income becomes available only when received.{summary.incomingOverdue > 0 && <> {money(summary.incomingOverdue)} of expected sale income is overdue.</>}</p></details>
  </section>
}

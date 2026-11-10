import type { TransferPaymentPlan } from '../domain/transfer-payments'
import { getTransferPaymentSchedule, paymentPlanLabel } from '../world/transfer-payments'
import { scoutingDate } from './ScoutingKnowledge'
import './transfer-payments.css'

export const transferMoney = (amount: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount / 100)

/** Proposals do not promise a completion date. Only the later calendar dates are fixed. */
export function TransferPaymentTerms({ fee, plan, startsSeason, earliestSigning, incoming = false }: { fee: number; plan: TransferPaymentPlan; startsSeason: number; earliestSigning?: string; incoming?: boolean }) {
  if (!Number.isSafeInteger(fee) || fee < 4) return null
  const schedule = getTransferPaymentSchedule(fee, plan, earliestSigning ?? '2000-01-01', startsSeason)
  return <div className="transfer-payment-terms" data-payment-plan={plan}>
    <div className="transfer-payment-plan-label"><strong>{paymentPlanLabel(plan)}</strong><span>{incoming ? 'Receipt schedule' : 'Payment schedule'}</span></div>
    <ol>{schedule.map((installment, index) => <li key={index}><span className="transfer-payment-step" aria-hidden="true">{index + 1}</span><span><strong>{transferMoney(installment.amount)}</strong><small>{index === 0 ? 'On signing' : <time dateTime={installment.dueOn}>{scoutingDate(installment.dueOn)}</time>}</small></span><span className="transfer-payment-timing">{index === 0 ? earliestSigning ? <>Earliest {scoutingDate(earliestSigning)}</> : 'After both agreements' : index === 1 ? 'Opening day' : 'Matchday 6'}</span></li>)}</ol>
  </div>
}

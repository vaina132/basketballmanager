import type { TransferInstallment, TransferPaymentPlan } from '../domain/transfer-payments'
import { getTransferPaymentSchedule, paymentPlanLabel } from '../world/transfer-payments'
import { scoutingDate } from './ScoutingKnowledge'
import './transfer-payments.css'
import { formatEuros } from './money-format'

export const transferMoney = (amount: number) => formatEuros(amount, true)

/** Proposals do not promise a completion date. Only the later calendar dates are fixed. */
export function TransferPaymentTerms({ fee, plan, startsSeason, startsRound = 1, installments, earliestSigning, incoming = false }: { fee: number; plan: TransferPaymentPlan; startsSeason: number; startsRound?: number; installments?: readonly TransferInstallment[]; earliestSigning?: string; incoming?: boolean }) {
  if (!Number.isSafeInteger(fee) || fee < 4) return null
  const schedule = installments ?? getTransferPaymentSchedule(fee, plan, earliestSigning ?? '2000-01-01', startsSeason, startsRound)
  if (!schedule.length) return null
  return <div className="transfer-payment-terms" data-payment-plan={plan}>
    <div className="transfer-payment-plan-label"><strong>{paymentPlanLabel(plan)}</strong><span>{incoming ? 'Receipt schedule' : 'Payment schedule'}</span></div>
    <ol>{schedule.map((installment, index) => <li key={index}><span className="transfer-payment-step" aria-hidden="true">{index + 1}</span><span><strong>{transferMoney(installment.amount)}</strong><small>{index === 0 ? 'On signing' : <time dateTime={installment.dueOn}>{scoutingDate(installment.dueOn)}</time>}</small></span><span className="transfer-payment-timing">{index === 0 ? earliestSigning ? <>Earliest {scoutingDate(earliestSigning)}</> : 'After both agreements' : index === 1 ? startsRound > 1 ? 'Next opening day' : 'Opening day' : startsRound > 1 ? 'Next season, Matchday 6' : 'Matchday 6'}</span></li>)}</ol>
  </div>
}

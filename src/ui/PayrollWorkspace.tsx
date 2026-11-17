import { useEffect, useRef, useState } from 'react'
import type { SeasonState } from '../domain/season'
import type { WagePrepaymentQuote } from '../domain/payroll'
import { getFinanceBalance } from '../world/finance'
import { getClubPayrollSummary, getPlayerPayroll, PAYROLL_AUTOMATION_CUSHION, PAYROLL_INSTALLMENTS, PREPAYMENT_DISCOUNT_PERCENT, quoteWagePrepayment } from '../world/payroll'
import { seasonLabel } from '../world/season'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import './payroll-workspace.css'
import { formatEuros } from './money-format'
import { automationCushion } from '../world/economy'

interface PayrollWorkspaceProps {
  season: SeasonState
  busy?: boolean
  onEnable: () => void
  onDelegationChange: (delegated: boolean) => void
  onPrepay: (playerId: string) => void
  onOpenClub: () => void
  onSelectPlayer: (id: string) => void
}

const moneyFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const money = (cents: number) => Math.abs(cents) >= 100_000_000 ? formatEuros(cents) : moneyFormatter.format(cents / 100)

export function PayrollWorkspace({ season, busy = false, onEnable, onDelegationChange, onPrepay, onOpenClub, onSelectPlayer }: PayrollWorkspaceProps) {
  const [query, setQuery] = useState('')
  const [reviewId, setReviewId] = useState<string | null>(null)
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const enabled = season.payroll.enabledSince !== null
  const financeEnabled = season.finance.enabledSince !== null
  const balance = getFinanceBalance(season.finance, club.id)
  const summary = getClubPayrollSummary(season, club.id)
  const delegated = season.payroll.delegated[club.id]!
  const startedThisSeason = season.payroll.enabledSince?.seasonNumber === season.seasonNumber ? season.payroll.enabledSince.round : null
  const players = club.players.filter(player => player.name.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = enabled ? club.players.find(player => player.id === reviewId && getPlayerPayroll(season, player.id)) : null
  const quote = selected ? quoteWagePrepayment(season, selected.id) : null
  const enableReason = !financeEnabled ? 'Enable club finances in Club before starting player payroll.' : season.status === 'complete' ? 'Start next season before enabling player payroll.' : null

  return <div className={`payroll-workspace${enabled ? ' payroll-enabled' : ''}`}>
    <section className="payroll-overview panel" aria-label="Wage commitments">
      <header className="payroll-heading"><div><h2 id="payroll-heading" tabIndex={-1}>{club.name}</h2><span>{seasonLabel(season.seasonNumber)} · Player wages</span></div><button className="button small" onClick={onOpenClub} disabled={busy}>Open Club<Icon name="chevron" size={14} /></button></header>
      {enabled && <dl className="payroll-summary"><div><dt>Cash</dt><dd data-payroll-cash={balance.cash}>{money(balance.cash)}</dd></div><div><dt>Future wages reserved</dt><dd data-payroll-reserve={summary.futureCommitted}>{money(summary.futureCommitted)}</dd></div><div><dt>Remaining budget</dt><dd data-payroll-spendable={summary.spendableCash}>{money(summary.spendableCash)}</dd></div><div><dt>Next payroll</dt><dd data-payroll-next={summary.nextInstallment}>{money(summary.nextInstallment)}</dd></div></dl>}
    </section>

    {!enabled ? <section className="payroll-enable panel" aria-labelledby="payroll-enable-title"><header className="payroll-heading"><h2 id="payroll-enable-title">Player payroll</h2><span>Not enabled</span></header><div><p>Start wage installments from the current matchday, with no charges for earlier matchdays. Existing squad terms continue annually. Remaining season wages can be settled early for a {PREPAYMENT_DISCOUNT_PERCENT}% discount.</p>{enableReason && <p id="payroll-enable-reason">{enableReason}</p>}<button id="enable-payroll" className="button primary" onClick={onEnable} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'payroll-enable-reason' : undefined}>Enable player payroll<Icon name="people" size={16} /></button></div></section> : <>
      <section className="payroll-policy panel" aria-labelledby="payroll-policy-title"><header className="payroll-heading"><h2 id="payroll-policy-title">Payment control</h2><span>{delegated ? 'Automatic' : 'Manual'}</span></header><div className="payroll-policy-control"><label htmlFor="payroll-control">Early settlement policy</label><input id="payroll-control" type="range" min={0} max={1} step={1} value={delegated ? 1 : 0} aria-valuetext={delegated ? 'Automatic' : 'Manual'} aria-describedby="payroll-policy-help" onChange={event => onDelegationChange(event.target.value === '1')} disabled={busy} /><div><span>Manual</span><span>Automatic</span></div></div><p className="payroll-note" id="payroll-policy-help">{season.status === 'complete' ? 'This policy applies from next season. Automatic reviews settlements at each prepared matchday.' : 'Switching to Automatic reviews settlements immediately and again at each prepared matchday.'} It protects all other future wages plus a {money(automationCushion(season, club.id, PAYROLL_AUTOMATION_CUSHION))} cash buffer. Manual settlements protect other future wages.</p></section>

      {balance.unpaid > 0 && <p className="payroll-unpaid panel">Club costs of {money(balance.unpaid)} are unpaid. Early wage settlements are unavailable until those costs are cleared. <button className="text-button" onClick={onOpenClub} disabled={busy}>View club activity<Icon name="chevron" size={13} /></button></p>}

      <section className="payroll-roster panel" aria-labelledby="payroll-roster-title"><header className="payroll-heading"><h2 id="payroll-roster-title">Squad wage schedule</h2><label className="payroll-search" htmlFor="payroll-search">Find player<input id="payroll-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search squad" disabled={busy} /></label></header>
        <div className="payroll-table-scroll" tabIndex={0} role="region" aria-label="Squad wage agreements"><table className="payroll-table"><thead><tr><th scope="col">Player</th><th scope="col">Annual salary</th><th scope="col">Charged</th><th scope="col">Remaining scheduled</th><th scope="col">Settle now</th><th scope="col">Saving</th><th scope="col">Action</th></tr></thead><tbody>{players.map(player => {
          const payroll = getPlayerPayroll(season, player.id)
          if (!payroll) return null
          const playerQuote = quoteWagePrepayment(season, player.id)
          return <tr key={player.id} data-payroll-player={player.id}>
            <th scope="row"><button className="payroll-player" data-payroll-profile={player.id} onClick={() => onSelectPlayer(player.id)} aria-label={`View ${player.name}`} disabled={busy}><span aria-hidden="true"><Avatar player={player} color={club.color} size={28} /></span><span><strong>{player.name}</strong><small>{player.position} · #{player.number}</small></span></button></th>
            <td>{money(payroll.seasonWages)}{payroll.agreement.startsRound > 1 && <small className="payroll-salary-start" data-payroll-starts-round={payroll.agreement.startsRound}>Wages from Matchday {payroll.agreement.startsRound}</small>}</td><td data-player-wages-charged={payroll.charged}>{money(payroll.charged)}</td><td data-player-wages-remaining={payroll.futureCommitted}>{money(payroll.futureCommitted)}</td><td>{money(playerQuote.amount)}</td><td>{money(playerQuote.discount)}</td>
            <td className="payroll-action"><button className="button small" data-prepay-player={player.id} aria-label={`Settle wages for ${player.name}`} aria-describedby={!playerQuote.canPrepay ? `payroll-reason-${player.id}` : undefined} onClick={() => setReviewId(player.id)} disabled={busy || !playerQuote.canPrepay}>Settle wages</button>{!playerQuote.canPrepay && <small id={`payroll-reason-${player.id}`}>{payroll.prepaid ? 'Settled in advance' : playerQuote.reason}</small>}</td>
          </tr>
        })}{!players.length && <tr><td colSpan={7} className="payroll-empty">No players match this search.</td></tr>}</tbody></table></div>
        <div className="payroll-totals"><span>Annual salaries <strong>{money(summary.seasonWages)}</strong></span><span>Charged <strong data-payroll-charged={summary.charged}>{money(summary.charged)}</strong></span><span>Settlement savings <strong data-payroll-savings={summary.savings}>{money(summary.savings)}</strong></span></div>
        {startedThisSeason !== null && startedThisSeason > 1 && <p className="payroll-note">Payroll started on Matchday {startedThisSeason}. Annual salaries show the annual rate; no charges were created for earlier matchdays.</p>}
        <p className="payroll-note">Charged includes recorded obligations for current and former players, including unpaid costs. Prepaid salaries are not refunded after a transfer. Club shows the unpaid balance. Wages follow {PAYROLL_INSTALLMENTS} matchday installments per season. Midseason arrivals are charged from their registration matchday only. Injuries and missed games do not reduce wages.</p>
      </section>
      <p className="payroll-model-note">{season.employment.enabledSince ? 'Player wages follow signed employment contracts. Renewals are on Squad > Contracts and recruitment in Transfers.' : (season.world?.economy ? 'Wages estimated from published 2025-27 salary reports; fixed squad terms continue annually.' : 'Fictional wage estimates; fixed squad terms continue annually.')} Save season keeps changes before the next automatic checkpoint.</p>
    </>}
    {selected && quote && <WageSettlement name={selected.name} quote={quote} cash={balance.cash} busy={busy} onClose={() => setReviewId(null)} onConfirm={() => { onPrepay(selected.id); setReviewId(null) }} />}
  </div>
}

function WageSettlement({ name, quote, cash, busy, onClose, onConfirm }: { name: string; quote: WagePrepaymentQuote; cash: number; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!element.open) element.showModal()
    cancel.current?.focus({ preventScroll: true })
    return () => {
      element.close()
      if (previous?.isConnected && !previous.matches(':disabled')) previous.focus({ preventScroll: true })
      else document.getElementById('payroll-heading')?.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={dialog} id="payroll-settlement" className="payroll-settlement" aria-labelledby="payroll-settlement-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header className="payroll-heading"><div><h2 id="payroll-settlement-title">Settle {name}’s wages</h2><span>Matchdays {quote.fromRound}–{quote.throughRound}</span></div></header>
    <div className="payroll-settlement-body"><dl><div><dt>Remaining gross wages</dt><dd>{money(quote.gross)}</dd></div><div><dt>{PREPAYMENT_DISCOUNT_PERCENT}% discount</dt><dd>{money(quote.discount)}</dd></div><div className="payroll-settlement-total"><dt>Pay now</dt><dd data-payroll-quote={quote.amount}>{money(quote.amount)}</dd></div><div><dt>{cash >= quote.amount ? 'Cash after settlement' : 'Cash shortfall'}</dt><dd>{money(Math.abs(cash - quote.amount))}</dd></div><div><dt>Other future wages reserved</dt><dd>{money(quote.otherCommitments)}</dd></div><div><dt>Cash required, including reserve</dt><dd>{money(quote.requiredCash)}</dd></div></dl><p>This settles the remaining season installments immediately. Other players’ future wage commitments stay reserved.</p>{quote.reason && <p id="payroll-settlement-reason" role="status">{quote.reason}</p>}</div>
    <footer><button ref={cancel} id="cancel-payroll-settlement" className="button" onClick={onClose} disabled={busy}>Cancel</button><button id="confirm-payroll-settlement" className="button primary" onClick={onConfirm} disabled={busy || !quote.canPrepay} aria-describedby={quote.reason ? 'payroll-settlement-reason' : undefined}>Confirm settlement · {money(quote.amount)}</button></footer>
  </dialog>
}

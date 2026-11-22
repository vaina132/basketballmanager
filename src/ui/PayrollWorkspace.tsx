import { useState } from 'react'
import type { SeasonState } from '../domain/season'
import { getFinanceBalance } from '../world/finance'
import { getClubPayrollSummary, getPlayerPayroll } from '../world/payroll'
import { seasonLabel } from '../world/season'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import './payroll-workspace.css'
import { formatEuros } from './money-format'

interface PayrollWorkspaceProps {
  season: SeasonState
  busy?: boolean
  onEnable: () => void
  onOpenClub: () => void
  onSelectPlayer: (id: string) => void
}

const moneyFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const money = (cents: number) => Math.abs(cents) >= 100_000_000 ? formatEuros(cents) : moneyFormatter.format(cents / 100)

/**
 * Owner feedback (18 November 2026): wages are paid automatically every week, so this page only shows what each
 * player earns, what has been paid and what is still to pay. Early settlement (the "Settle now" and "Saving" columns
 * and the Manual/Automatic settlement policy) is no longer offered here; the rules behind it are unchanged.
 */
export function PayrollWorkspace({ season, busy = false, onEnable, onOpenClub, onSelectPlayer }: PayrollWorkspaceProps) {
  const [query, setQuery] = useState('')
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const enabled = season.payroll.enabledSince !== null
  const financeEnabled = season.finance.enabledSince !== null
  const balance = getFinanceBalance(season.finance, club.id)
  const summary = getClubPayrollSummary(season, club.id)
  const startedThisSeason = season.payroll.enabledSince?.seasonNumber === season.seasonNumber ? season.payroll.enabledSince.round : null
  const players = club.players.filter(player => player.name.toLowerCase().includes(query.trim().toLowerCase()))
  const enableReason = !financeEnabled ? 'Enable club finances in Club before starting player payroll.' : season.status === 'complete' ? 'Start next season before enabling player payroll.' : null

  return <div className={`payroll-workspace${enabled ? ' payroll-enabled' : ''}`}>
    <section className="payroll-overview panel" aria-label="Wage commitments">
      <header className="payroll-heading"><div><h2 id="payroll-heading" tabIndex={-1}>Player wages</h2><span>{seasonLabel(season.seasonNumber)}</span></div><button className="button small" onClick={onOpenClub} disabled={busy}>Open Club<Icon name="chevron" size={14} /></button></header>
      {enabled && <dl className="payroll-summary"><div><dt>Cash</dt><dd data-payroll-cash={balance.cash}>{money(balance.cash)}</dd></div><div><dt>Wages still to pay</dt><dd data-payroll-reserve={summary.futureCommitted}>{money(summary.futureCommitted)}</dd></div><div><dt>Next weekly wages</dt><dd data-payroll-next={summary.nextInstallment}>{money(summary.nextInstallment)}</dd></div></dl>}
    </section>

    {!enabled ? <section className="payroll-enable panel" aria-labelledby="payroll-enable-title"><header className="payroll-heading"><h2 id="payroll-enable-title">Player payroll</h2><span>Not enabled</span></header><div><p>Start paying wages automatically every week from now, with no charges for earlier weeks. Existing squad terms continue.</p>{enableReason && <p id="payroll-enable-reason">{enableReason}</p>}<button id="enable-payroll" className="button primary" onClick={onEnable} disabled={busy || !!enableReason} aria-describedby={enableReason ? 'payroll-enable-reason' : undefined}>Enable player payroll<Icon name="people" size={16} /></button></div></section> : <>

      {balance.unpaid > 0 && <p className="payroll-unpaid panel">Club costs of {money(balance.unpaid)} are unpaid. <button className="text-button" onClick={onOpenClub} disabled={busy}>View club activity<Icon name="chevron" size={13} /></button></p>}

      <section className="payroll-roster panel" aria-labelledby="payroll-roster-title"><header className="payroll-heading"><h2 id="payroll-roster-title">Squad wage schedule</h2><label className="payroll-search" htmlFor="payroll-search">Find player<input id="payroll-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search squad" disabled={busy} /></label></header>
        <div className="payroll-table-scroll" tabIndex={0} role="region" aria-label="Squad wage agreements"><table className="payroll-table"><thead><tr><th scope="col">Player</th><th scope="col">Annual salary</th><th scope="col">Paid so far</th><th scope="col">Still to pay</th></tr></thead><tbody>{players.map(player => {
          const payroll = getPlayerPayroll(season, player.id)
          if (!payroll) return null
          return <tr key={player.id} data-payroll-player={player.id}>
            <th scope="row"><button className="payroll-player" data-payroll-profile={player.id} onClick={() => onSelectPlayer(player.id)} aria-label={`View ${player.name}`} disabled={busy}><span aria-hidden="true"><Avatar player={player} color={club.color} size={28} /></span><span><strong>{player.name}</strong><small>{player.position} · #{player.number}</small></span></button></th>
            <td>{money(payroll.seasonWages)}{payroll.agreement.startsRound > 1 && <small className="payroll-salary-start" data-payroll-starts-round={payroll.agreement.startsRound}>Wages from Matchday {payroll.agreement.startsRound}</small>}</td><td data-player-wages-charged={payroll.charged}>{money(payroll.charged)}</td><td data-player-wages-remaining={payroll.futureCommitted}>{money(payroll.futureCommitted)}</td>
          </tr>
        })}{!players.length && <tr><td colSpan={4} className="payroll-empty">No players match this search.</td></tr>}</tbody></table></div>
        <div className="payroll-totals"><span>Annual salaries <strong>{money(summary.seasonWages)}</strong></span><span>Paid so far <strong data-payroll-charged={summary.charged}>{money(summary.charged)}</strong></span></div>
        {startedThisSeason !== null && startedThisSeason > 1 && <p className="payroll-note">Wages started on Matchday {startedThisSeason}; nothing was charged for earlier weeks.</p>}
        <p className="payroll-note" data-payroll-automatic="true">Wages are paid automatically every week. New players are paid from the week they join. Injuries do not change wages.</p>
      </section>
      <p className="payroll-model-note">{season.employment.enabledSince ? 'Player wages follow signed employment contracts. Renewals are on Squad > Contracts and recruitment in Transfers.' : (season.world?.economy ? 'Wages estimated from published 2025-27 salary reports; fixed squad terms continue annually.' : 'Fictional wage estimates; fixed squad terms continue annually.')}</p>
    </>}
  </div>
}


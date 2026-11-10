import { useState } from 'react'
import type { FinanceEntry, FinancePlan } from '../domain/finance'
import type { SeasonState } from '../domain/season'
import { COACHES } from '../data/development-coaches'
import { getDevelopmentPlayer } from '../data/development-players'
import { coachingCommitted } from '../world/coaching'
import { ANNUAL_SPONSORSHIP, financeLedgerRows, forecastGate, getClubFinanceDefinition, getFinanceBalance, MAX_TICKET_PRICE, OPENING_CASH, recommendTicketPrice, ROUND_OPERATING_COST, TICKET_PRICE_STEP } from '../world/finance'
import { dateForRound, seasonLabel } from '../world/season'
import { getPayrollReserve, getSpendableCash } from '../world/payroll'
import { getReservedTransferFees } from '../world/market-policy'
import { Icon } from './Icon'
import './club-workspace.css'

interface ClubWorkspaceProps {
  season: SeasonState
  onEnable: () => void
  onPlanChange: (plan: FinancePlan) => void
  onOpenStaff: () => void
  onOpenPayroll: () => void
  busy?: boolean
}

const moneyFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const money = (cents: number) => moneyFormatter.format(cents / 100)
const movement = (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents))}`
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const count = (value: number) => value.toLocaleString('en-GB')
const kinds: Record<FinanceEntry['kind'], string> = { opening: 'Opening cash', sponsor: 'Sponsorship', operations: 'Operating costs', tickets: 'Ticket income', coaching: 'Coaching fee', payroll: 'Player wages', transfer: 'Player transfer' }

export function ClubWorkspace({ season, onEnable, onPlanChange, onOpenStaff, onOpenPayroll, busy = false }: ClubWorkspaceProps) {
  const [kind, setKind] = useState<FinanceEntry['kind'] | 'all'>('all')
  const [period, setPeriod] = useState<'current' | 'all'>('current')
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const definition = getClubFinanceDefinition(club.id)
  const enabled = season.finance.enabledSince !== null
  const balance = getFinanceBalance(season.finance, club.id)
  const committed = coachingCommitted(season.coaching, club.id)
  const payrollEnabled = season.payroll.enabledSince !== null
  const wageReserve = getPayrollReserve(season, club.id)
  const spendable = getSpendableCash(season, club.id)
  const transferReserve = getReservedTransferFees(season, club.id)
  const plan = season.finance.plans[club.id]!
  const home = season.status === 'active' ? season.fixtures.find(fixture => fixture.homeClubId === club.id && fixture.round >= season.round && !fixture.result) : undefined
  const laterHome = season.fixtures.find(fixture => fixture.homeClubId === club.id && fixture.round > season.round && !fixture.result)
  const recommendationFixture = laterHome ?? home
  const recommendation = recommendationFixture ? recommendTicketPrice(season, recommendationFixture) : null
  const plannedPrice = plan.delegated && recommendation !== null ? recommendation : plan.price
  const locked = home?.round === season.round
  const forecastPrice = home ? locked ? season.finance.roundPrices[club.id]! : plan.delegated ? recommendTicketPrice(season, home) : plan.price : null
  const forecast = home && forecastPrice !== null ? forecastGate(season, home, forecastPrice) : null
  const opponent = home ? season.clubs.find(team => team.id === home.awayClubId)! : null
  const ledger = financeLedgerRows(season.finance, club.id).filter(entry => (kind === 'all' || entry.kind === kind) && (period === 'all' || entry.seasonNumber === season.seasonNumber))

  function entryDetail(entry: FinanceEntry): string {
    if (entry.kind === 'transfer') {
      const transfer = season.employment.transfers.find(item => item.id === entry.sourceId)
      if (!transfer) return 'Transfer fee'
      const buying = transfer.toClubId === club.id
      const counterpart = season.clubs.find(team => team.id === (buying ? transfer.fromClubId : transfer.toClubId))
      return `${getDevelopmentPlayer(transfer.playerId).name} · ${buying ? 'From' : 'To'} ${counterpart?.name ?? 'another club'}`
    }
    if (entry.payroll) {
      const charge = entry.payroll
      const rounds = charge.fromRound === charge.throughRound ? `Matchday ${charge.fromRound}` : `Matchdays ${charge.fromRound}–${charge.throughRound}`
      const saving = charge.items.reduce((total, item) => total + item.discount, 0)
      return charge.type === 'prepayment' ? `${getDevelopmentPlayer(charge.items[0]!.playerId).name} · ${rounds} · ${money(saving)} saved` : `${charge.items.length} players · ${rounds}`
    }
    if (entry.ticket) {
      const fixtures = entry.seasonNumber === season.seasonNumber ? season.fixtures : season.history.find(archive => archive.seasonNumber === entry.seasonNumber)?.fixtures
      const fixture = fixtures?.find(fixture => fixture.id === entry.ticket!.fixtureId)
      const visitor = fixture ? season.clubs.find(team => team.id === fixture.awayClubId) : null
      return `${visitor ? `Home vs ${visitor.name} · ` : ''}${count(entry.ticket.attendance)} / ${count(definition.capacity)} attendance · ${money(entry.ticket.price)} per ticket`
    }
    if (entry.coach) return COACHES.find(coach => coach.id === entry.coach!.coachId)!.name
    if (entry.kind === 'sponsor') return `${definition.sponsor} · ${seasonLabel(entry.seasonNumber)}`
    if (entry.kind === 'operations') return `Matchday ${entry.round} club operations`
    return 'Club finances activated'
  }

  return <div className={`club-workspace${enabled ? ' club-finances-active' : ''}`}>
    <section className="club-finance-overview panel" aria-label="Club finances">
      <header className="club-heading"><div><h2>{club.name}</h2><span>{seasonLabel(season.seasonNumber)} · <time dateTime={season.date}>{formatDate(season.date)}</time></span></div><div className="club-heading-actions"><button className="button small" onClick={onOpenPayroll} disabled={busy}>Player wages<Icon name="chevron" size={14} /></button><button className="button small" onClick={onOpenStaff} disabled={busy}>Open staff<Icon name="chevron" size={14} /></button></div></header>
      {enabled && <details className="game-disclosure club-account-details"><summary><Icon name="wallet" size={16} />Accounts & commitments</summary><dl className="club-finance-summary"><div><dt>Bank balance</dt><dd data-finance-cash={balance.cash}>{money(balance.cash)}</dd></div><div><dt>Unpaid costs</dt><dd className={balance.unpaid > 0 ? 'club-finance-cost' : ''} data-finance-unpaid={balance.unpaid}>{money(balance.unpaid)}</dd></div><div><dt>Coaching committed</dt><dd>{money(committed)}</dd></div></dl>{payrollEnabled && <p className="club-payroll-summary"><span>Wages reserved <strong data-finance-wage-reserve={wageReserve}>{money(wageReserve)}</strong></span>{transferReserve > 0 && <span>Transfer fees reserved <strong data-finance-transfer-reserve={transferReserve}>{money(transferReserve)}</strong></span>}<span>Remaining budget <strong data-finance-spendable={spendable}>{money(spendable)}</strong></span></p>}</details>}
    </section>

    {!enabled ? <section className="club-finance-enable panel" aria-labelledby="club-finance-enable-title">
      <header className="club-heading"><h2 id="club-finance-enable-title">Club finances</h2><span>Not enabled</span></header>
      <div><p>Start every club with {money(OPENING_CASH)} in opening cash, sponsorship for the remaining season, and charges for existing coaching commitments. Ticket income and operating costs begin from the current matchday.</p>{season.status === 'complete' && <p id="finance-enable-reason">Start next season before enabling club finances.</p>}<button id="enable-finance" className="button primary" onClick={onEnable} disabled={busy || season.status === 'complete'} aria-describedby={season.status === 'complete' ? 'finance-enable-reason' : undefined}>Enable club finances<Icon name="building" size={16} /></button></div>
    </section> : <>
      {balance.unpaid > 0 && <p className="club-unpaid-note panel">{money(balance.unpaid)} of costs remain unpaid. New income clears unpaid costs first; coach recruitment requires these costs to be settled.</p>}

      <section className="club-venue panel" aria-labelledby="club-venue-title">
        <header className="club-heading"><h2 id="club-venue-title">Venue &amp; sponsorship</h2></header>
        <dl><div><dt>Venue</dt><dd>{definition.venue}</dd></div><div><dt>Capacity</dt><dd>{count(definition.capacity)}</dd></div><div><dt>Sponsor</dt><dd>{definition.sponsor}</dd></div><div><dt>Full-season sponsorship</dt><dd>{money(ANNUAL_SPONSORSHIP)}</dd></div><div><dt>Operating cost / matchday</dt><dd>{money(ROUND_OPERATING_COST)}</dd></div></dl>
      </section>

      <section className="club-ticket-plan panel" aria-labelledby="club-ticket-plan-title" data-finance-locked-price={season.finance.roundPrices[club.id]}>
        <header className="club-heading"><h2 id="club-ticket-plan-title"><Icon name="wallet" size={18} />Ticket price</h2><span>{season.status === 'complete' ? 'Next season' : 'Next matchday'}</span></header>
        <div className="club-ticket-controls">
          <div className="club-ticket-control"><div><label htmlFor="ticket-control">Pricing control</label><output htmlFor="ticket-control">{plan.delegated ? 'Automatic' : 'Manual'}</output></div><input type="range" id="ticket-control" min={0} max={1} step={1} value={plan.delegated ? 1 : 0} aria-valuetext={plan.delegated ? 'Automatic' : 'Manual'} onChange={event => onPlanChange({ ...plan, delegated: event.target.value === '1' })} disabled={busy} /><div className="club-range-labels"><span>Manual</span><span>Automatic</span></div></div>
          <div className="club-ticket-control"><div><label htmlFor="ticket-price">Ticket price</label><output htmlFor="ticket-price">{plan.delegated && recommendation === null ? 'Automatic' : money(plannedPrice)}{plan.delegated && recommendation !== null && <small>recommended</small>}</output></div><input type="range" id="ticket-price" min={0} max={MAX_TICKET_PRICE / 100} step={TICKET_PRICE_STEP / 100} value={plannedPrice / 100} aria-valuetext={`${money(plannedPrice)} per ticket${plan.delegated ? ', automatic pricing' : ''}`} aria-describedby="ticket-plan-help" onChange={event => onPlanChange({ ...plan, price: Number(event.target.value) * 100 })} disabled={busy || plan.delegated} /><div className="club-range-labels"><span>{money(0)}</span><span>{money(MAX_TICKET_PRICE)}</span></div></div>
        </div>
        <details className="game-disclosure"><summary><Icon name="clock" size={15} />When prices change</summary><div className="club-note" id="ticket-plan-help"><p>This matchday’s price stays locked. Automatic prices are set before each matchday.</p>{plan.delegated && recommendationFixture && <p>Recommendation: {recommendationFixture.round === season.round ? 'current home demand' : `home fixture ${formatDate(recommendationFixture.date)}`} · may change with results.</p>}</div></details>
      </section>

      <section className="club-gate-forecast panel" aria-labelledby="club-gate-forecast-title" data-finance-gate-fixture={home?.id}>
        <header className="club-heading"><h2 id="club-gate-forecast-title"><Icon name="people" size={18} />Next home crowd</h2><span>{home ? locked ? 'Current matchday · price locked' : 'Future fixture · price not locked' : 'No remaining home fixtures'}</span></header>
        {home && forecast && opponent ? <><div className="club-gate-fixture"><strong>{club.name} vs {opponent.name}</strong><span><time dateTime={home.date}>{formatDate(home.date)}</time> · Matchday {home.round}</span></div><progress className="club-crowd-meter" value={forecast.attendance} max={forecast.capacity} aria-label={`${forecast.attendance} of ${forecast.capacity} seats forecast to be filled`} /><dl className="club-gate-values"><div><dt>{locked ? 'Locked ticket price' : 'Planned ticket price'}</dt><dd data-gate-price={forecast.price}>{money(forecast.price)}</dd></div><div><dt>Forecast attendance</dt><dd data-gate-attendance={forecast.attendance}>{count(forecast.attendance)} <small>/ {count(forecast.capacity)}</small></dd></div><div><dt>Forecast ticket income</dt><dd data-gate-revenue={forecast.revenue}>{money(forecast.revenue)}</dd></div></dl><p className="club-note">This is a forecast. {locked ? 'Income is recorded when the matchday is completed.' : 'Future demand and automatic pricing may change before this matchday is prepared.'}</p></> : <p className="club-empty">No further home fixtures are scheduled this season. Your ticket plan carries into the next season.</p>}
      </section>

      <details className="club-ledger panel game-disclosure">
        <summary><Icon name="wallet" size={17} />Financial activity · {ledger.length} entries</summary>
        <header className="club-heading"><h2 id="club-ledger-title">Financial activity</h2><span>{ledger.length} entries · newest first</span></header>
        <div className="club-ledger-filters"><label htmlFor="finance-kind">Activity<select id="finance-kind" value={kind} onChange={event => setKind(event.target.value as FinanceEntry['kind'] | 'all')} disabled={busy}><option value="all">All activity</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label htmlFor="finance-season">Period<select id="finance-season" value={period} onChange={event => setPeriod(event.target.value as 'current' | 'all')} disabled={busy}><option value="current">Current season · {seasonLabel(season.seasonNumber)}</option><option value="all">All seasons</option></select></label></div>
        <div className="club-ledger-scroll" tabIndex={0} role="region" aria-label="Club financial activity"><table className="club-finance-ledger"><thead><tr><th scope="col">Date</th><th scope="col">Activity</th><th scope="col">Income / cost</th><th scope="col">Cash change</th><th scope="col">Unpaid change</th></tr></thead><tbody>{ledger.map(entry => {
          const transfer = entry.kind === 'transfer' ? season.employment.transfers.find(item => item.id === entry.sourceId) : null
          const date = transfer?.completedOn ?? dateForRound(entry.round, entry.seasonNumber)
          return <tr key={entry.id} data-finance-entry={entry.id} data-finance-kind={entry.kind}>
            <td><time dateTime={date}>{formatDate(date)}</time><small>{transfer ? 'Offseason transfer' : `Matchday ${entry.round}`}</small></td><th scope="row">{kinds[entry.kind]}<small>{entryDetail(entry)}</small>{entry.payroll && <details className="club-payroll-breakdown" data-payroll-ledger={entry.id}><summary>Player charges</summary><ul>{entry.payroll.items.map(item => <li key={item.agreementId}><span>{getDevelopmentPlayer(item.playerId).name}</span><strong>{money(item.amount)}</strong>{item.discount > 0 && <small>Gross {money(item.gross)} · discount {money(item.discount)}</small>}</li>)}</ul></details>}</th>
            <td className={entry.amount < 0 ? 'club-finance-cost' : entry.amount > 0 ? 'club-finance-income' : ''}>{movement(entry.amount)}</td>
            <td><span className={entry.cashDelta < 0 ? 'club-finance-cost' : entry.cashDelta > 0 ? 'club-finance-income' : ''}>{movement(entry.cashDelta)}</span><small>Balance {money(entry.cashAfter)}</small></td>
            <td><span className={entry.unpaidDelta > 0 ? 'club-finance-cost' : entry.unpaidDelta < 0 ? 'club-finance-income' : ''}>{movement(entry.unpaidDelta)}</span><small>Balance {money(entry.unpaidAfter)}</small></td>
          </tr>
        })}{!ledger.length && <tr><td colSpan={5} className="club-empty">No financial activity matches this view.</td></tr>}</tbody></table></div>
        <p className="club-note">Income clears unpaid costs before adding to cash. Balances include all earlier activity, even when filtered. Coaching commitments track season allocation separately from cash.</p>
      </details>
    </>}
    <p className="club-model-note">Fictional development finances. {payrollEnabled ? season.employment.enabledSince ? 'Player wages follow signed employment contracts.' : 'Player wages follow the fixed squad terms.' : 'Player payroll is not enabled.'}</p>
  </div>
}

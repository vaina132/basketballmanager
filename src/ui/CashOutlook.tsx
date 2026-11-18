import { useEffect, useMemo, useRef, useState } from 'react'
import type { CashOutlookRow } from '../domain/finance-outlook'
import type { SeasonState } from '../domain/season'
import { getClubCashOutlook } from '../world/finance-outlook'
import { Icon } from './Icon'
import { scoutingDate } from './ScoutingKnowledge'
import { transferMoney as money } from './TransferPaymentTerms'
import './cash-outlook.css'

type View = 'expected' | 'cautious'
const cost = (row: CashOutlookRow) => row.wages + row.operations + row.unpaidCosts + row.transferOut
const income = (row: CashOutlookRow, view: View) => view === 'expected' ? row.tickets + row.transferIn : row.adverseTickets
const balance = (row: CashOutlookRow, view: View) => view === 'expected' ? row.baselineBalance : row.adverseBalance
const projected = (amount: number) => amount < 0 ? `Funding gap ${money(-amount)}` : money(amount)
const dateValue = (date: string) => Date.parse(`${date}T00:00:00Z`)
const shortDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
const axisMoney = (amount: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(amount / 100)
const costItems = (row: CashOutlookRow): [string, number][] => [['Player wages', row.wages], ['Club operations', row.operations], ['Unpaid costs', row.unpaidCosts], ['Transfer payments', row.transferOut]]
const incomeItems = (row: CashOutlookRow, view: View): [string, number][] => [['Ticket income', view === 'expected' ? row.tickets : row.adverseTickets], ['Player sale income', view === 'expected' ? row.transferIn : 0]]
const itemsText = (items: [string, number][]) => items.filter(([, amount]) => amount > 0).map(([label, amount]) => `${label} ${money(amount)}`).join(' · ')

export function CashOutlook({ season, busy, onOpenPayroll, onOpenTransfers }: { season: SeasonState; busy: boolean; onOpenPayroll: () => void; onOpenTransfers: () => void }) {
  const outlook = useMemo(() => getClubCashOutlook(season), [season])
  const [view, setView] = useState<View>('expected')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const chart = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  useEffect(() => {
    if (!chart.current) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, Math.round(entries[0]!.contentRect.width))))
    observer.observe(chart.current)
    return () => observer.disconnect()
  }, [outlook.enabled])
  if (!outlook.enabled) return null
  const scenario = view === 'expected' ? outlook.baseline : outlook.adverse
  const rows = outlook.rows
  const nextPayment = rows.find(row => cost(row) > 0)
  const selectedIndex = Math.max(0, rows.findIndex(row => row.id === (selectedId ?? nextPayment?.id)))
  const selected = rows[selectedIndex]
  const selectedBalance = selected ? balance(selected, view) : outlook.startCash
  const selectedDate = selected?.date ?? outlook.asOf
  const paymentsLater = outlook.laterOutgoing.reduce((sum, item) => sum + item.amount, 0)
  const receiptsLater = outlook.laterIncoming.reduce((sum, item) => sum + item.amount, 0)
  const overdueReceipts = outlook.overdueIncoming.reduce((sum, item) => sum + item.amount, 0)
  const hasFuture = outlook.horizon > outlook.asOf
  const chartValues = [outlook.startCash, ...rows.flatMap(row => [row.baselineBalance, row.adverseBalance])]
  const floor = Math.min(0, ...chartValues), ceiling = Math.max(10_000, ...chartValues)
  const spread = Math.max(10_000, ceiling - floor), top = ceiling + spread * .07, bottom = floor - spread * .05
  const left = width < 400 ? 52 : 66, right = width - 18, plotTop = 13, plotBottom = 136
  const firstDay = dateValue(outlook.asOf), duration = Math.max(1, dateValue(outlook.horizon) - firstDay)
  const x = (date: string) => left + (dateValue(date) - firstDay) / duration * (right - left)
  const y = (amount: number) => plotTop + (top - amount) / (top - bottom) * (plotBottom - plotTop)
  const points = [{ date: outlook.asOf, value: outlook.startCash }, ...rows.map(row => ({ date: row.date, value: balance(row, view) }))]
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.date)} ${y(point.value)}`).join(' ')
  const zero = y(0)
  const selectionText = `${scoutingDate(selectedDate)}: ${projected(selectedBalance)}${selected ? `; income ${money(income(selected, view))}; payments ${money(cost(selected))}` : ''}`

  function selectFromPointer(clientX: number, clientY: number) {
    if (busy || !rows.length || !chart.current) return
    const bounds = chart.current.getBoundingClientRect()
    const position = (clientX - bounds.left) / bounds.width * width
    const positionY = clientY - bounds.top
    const distance = (row: CashOutlookRow) => Math.hypot(x(row.date) - position, y(balance(row, view)) - positionY)
    const nearest = rows.reduce((best, row, index) => distance(row) < distance(rows[best]!) ? index : best, 0)
    setSelectedId(rows[nearest]!.id)
  }

  return <section className="cash-outlook" aria-labelledby="cash-outlook-title" data-cash-view={view}>
    <header className="cash-outlook-heading"><div><h3 id="cash-outlook-title"><Icon name="wallet" size={17} />Cash outlook</h3><span>{hasFuture ? <>Through <time dateTime={outlook.horizon}>{scoutingDate(outlook.horizon)}</time></> : season.status === 'complete' ? 'Current season complete' : 'Final matchday'}</span></div><div className="segmented" role="group" aria-label="Cash outlook scenario"><button id="cash-outlook-expected" className={view === 'expected' ? 'selected' : ''} aria-pressed={view === 'expected'} onClick={() => setView('expected')} disabled={busy}>Expected</button><button id="cash-outlook-cautious" className={view === 'cautious' ? 'selected' : ''} aria-pressed={view === 'cautious'} onClick={() => setView('cautious')} disabled={busy}>Cautious</button></div></header>
    <dl className="cash-outlook-summary"><div><dt>Lowest projection</dt><dd className={scenario.lowBalance < 0 ? 'cash-outlook-gap' : ''} data-cash-low={scenario.lowBalance}>{projected(scenario.lowBalance)}</dd><small><time dateTime={scenario.lowOn}>{scoutingDate(scenario.lowOn)}</time></small></div><div><dt>{hasFuture ? 'Season-end projection' : 'After current payments'}</dt><dd className={scenario.endBalance < 0 ? 'cash-outlook-gap' : ''} data-cash-end={scenario.endBalance}>{projected(scenario.endBalance)}</dd><small>{view === 'expected' ? 'Estimated income included' : 'Lower ticket income; no sale income'}</small></div><div><dt>{nextPayment?.kind === 'due-now' ? 'Payment due now' : 'Next scheduled payment'}</dt><dd data-cash-next-payment={nextPayment ? cost(nextPayment) : 0}>{nextPayment ? money(cost(nextPayment)) : 'None this season'}</dd><small>{nextPayment ? <><time dateTime={nextPayment.date}>{scoutingDate(nextPayment.date)}</time>{nextPayment.round !== null && <> &middot; Matchday {nextPayment.round}</>}</> : 'Later fees are shown below'}</small></div></dl>
    <div className="cash-outlook-visual">
      <div ref={chart} className="cash-outlook-chart" role="slider" tabIndex={busy || !rows.length ? -1 : 0} aria-label="Select a cash outlook date" aria-valuemin={0} aria-valuemax={Math.max(0, rows.length - 1)} aria-valuenow={selectedIndex} aria-valuetext={selectionText} aria-disabled={busy || !rows.length} aria-describedby="cash-outlook-chart-help" data-cash-selected-date={selectedDate} onPointerDown={event => selectFromPointer(event.clientX, event.clientY)} onPointerMove={event => { if (event.buttons === 1) selectFromPointer(event.clientX, event.clientY) }} onKeyDown={event => {
        if (busy || !rows.length) return
        const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.min(rows.length - 1, selectedIndex + 1) : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(0, selectedIndex - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null
        if (next !== null) { event.preventDefault(); setSelectedId(rows[next]!.id) }
      }}>
        <svg width="100%" height="168" viewBox={`0 0 ${width} 168`} aria-hidden="true">
          {floor < 0 && <rect x={left} y={zero} width={right - left} height={plotBottom - zero} className="cash-chart-gap-area" />}
          {[ceiling, 0, ...(floor < 0 && Math.abs(y(floor) - zero) >= 22 ? [floor] : [])].map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className={value === 0 ? 'cash-chart-zero' : 'cash-chart-grid'} /><text x={left - 8} y={y(value) + 4} textAnchor="end">{axisMoney(value)}</text></g>)}
          <path d={line} fill="none" className={`cash-chart-line${view === 'cautious' ? ' cash-chart-cautious' : ''}`} />
          {rows.map(row => <circle key={row.id} cx={x(row.date)} cy={y(balance(row, view))} r={row.id === selected?.id ? 5 : 3} className={row.id === selected?.id ? 'cash-chart-point selected' : 'cash-chart-point'} />)}
          {selected && <line x1={x(selectedDate)} x2={x(selectedDate)} y1={plotTop} y2={plotBottom} className="cash-chart-selected-line" />}
          <text x={left} y={160}>{shortDate(outlook.asOf)}</text>{hasFuture && <text x={right} y={160} textAnchor="end">{shortDate(outlook.horizon)}</text>}
        </svg>
      </div>
      <div className="cash-outlook-selection" aria-live="polite" aria-atomic="true"><div className="cash-outlook-date-controls"><button className="icon-button" aria-label="Previous outlook date" onClick={() => setSelectedId(rows[selectedIndex - 1]!.id)} disabled={busy || selectedIndex === 0}><Icon name="chevron" size={17} style={{ transform: 'rotate(180deg)' }} /></button><span><time dateTime={selectedDate}>{scoutingDate(selectedDate)}</time><small>{selected?.kind === 'due-now' ? 'Due now' : selected?.round !== null && selected?.round !== undefined ? `Matchday ${selected.round}` : selected ? 'Payment date' : 'Current balance'}</small></span><button className="icon-button" aria-label="Next outlook date" onClick={() => setSelectedId(rows[selectedIndex + 1]!.id)} disabled={busy || selectedIndex >= rows.length - 1}><Icon name="chevron" size={17} /></button></div><div className="cash-outlook-selected-values"><strong className={selectedBalance < 0 ? 'cash-outlook-gap' : ''} data-cash-selected-balance={selectedBalance}>{selectedBalance < 0 ? projected(selectedBalance) : <>Projected {money(selectedBalance)}</>}</strong><span>Income <b data-cash-selected-income={selected ? income(selected, view) : 0}>{money(selected ? income(selected, view) : 0)}</b><span aria-hidden="true"> &middot; </span>Payments <b data-cash-selected-cost={selected ? cost(selected) : 0}>{money(selected ? cost(selected) : 0)}</b></span></div></div>
      <p id="cash-outlook-chart-help">Select a date on the line, or use the arrow keys. Projections do not increase your Spending left.</p>
    </div>
    {outlook.pendingHolds.total > 0 && <p className="cash-outlook-pending" data-cash-pending-visible={outlook.pendingHolds.total}><Icon name="clock" size={15} /><span>Pending offers: <strong>{money(outlook.pendingHolds.total)}</strong> reserved &middot; excluded until signed</span></p>}
    <div className="cash-outlook-actions"><span>{scenario.fundingGap > 0 ? <><Icon name="wallet" size={15} />{view === 'cautious' ? 'Cautious view' : 'Expected view'} shows a funding gap.</> : <><Icon name="check" size={15} />Scheduled costs covered in this view.</>}</span><button className="button small" onClick={onOpenPayroll} disabled={busy}>Player wages<Icon name="chevron" size={13} /></button><button className="button small" onClick={onOpenTransfers} disabled={busy}>Transfers<Icon name="swap" size={14} /></button></div>
    <details className="game-disclosure cash-outlook-details"><summary><Icon name="calendar" size={15} />Dates, payments &amp; assumptions</summary>
      <div className="cash-outlook-table-scroll" role="region" tabIndex={0} aria-label={`${view === 'expected' ? 'Expected' : 'Cautious'} cash outlook by date`}><table className="cash-outlook-table"><caption className="sr-only">Projected cash after each date. Negative projections are funding gaps.</caption><thead><tr><th scope="col">Date</th><th scope="col">Income</th><th scope="col">Payments</th><th scope="col">Projection</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-cash-row={row.id}><th scope="row"><time dateTime={row.date}>{scoutingDate(row.date)}</time><small>{row.kind === 'due-now' ? 'Due now' : row.round !== null ? `Matchday ${row.round}` : 'Transfer payment date'}</small></th><td data-cash-income={income(row, view)}>{money(income(row, view))}<small>{itemsText(incomeItems(row, view))}</small></td><td data-cash-cost={cost(row)}>{money(cost(row))}<small>{itemsText(costItems(row))}</small></td><td className={balance(row, view) < 0 ? 'cash-outlook-gap' : ''} data-cash-balance={balance(row, view)}>{projected(balance(row, view))}</td></tr>)}{!rows.length && <tr><td colSpan={4}>No remaining cash movements scheduled this season.</td></tr>}</tbody></table></div>
      <div className="cash-outlook-assumptions"><p>Starting bank balance <strong>{money(outlook.startCash)}</strong> &middot; Unpaid costs <strong>{money(outlook.startUnpaid)}</strong>. These projections are estimates, not spending money.</p>{outlook.pendingHolds.total > 0 && <p data-cash-pending-holds={outlook.pendingHolds.total}>Pending offers hold <strong>{money(outlook.pendingHolds.total)}</strong> in your current budget. They are excluded from projected payments until signed.</p>}{overdueReceipts > 0 && <p data-cash-overdue-receipts={overdueReceipts}><strong>{money(overdueReceipts)}</strong> of sale income is overdue. Neither view assumes a receipt date.</p>}{(paymentsLater > 0 || receiptsLater > 0) && <p data-cash-later-outgoing={paymentsLater} data-cash-later-incoming={receiptsLater}>Beyond this season: <strong>{money(paymentsLater)}</strong> in transfer payments and <strong>{money(receiptsLater)}</strong> in expected sale income. <a href="#club-transfer-payments-title">See transfer payment dates below</a>.</p>}<ul>{outlook.assumptions.slice(1).map(assumption => <li key={assumption}>{assumption}</li>)}</ul></div>
    </details>
  </section>
}

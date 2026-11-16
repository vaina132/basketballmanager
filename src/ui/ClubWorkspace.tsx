import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth'
import { getCareerPlayer } from '../world/player-catalog'
import { useState } from 'react'
import type { FinanceEntry, FinancePlan } from '../domain/finance'
import type { SeasonState } from '../domain/season'
import { COACH_DIRECTORY as COACHES } from '../data/staff-directory'
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts'
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness'
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios'
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants'
import { financeLedgerRows, forecastGate, fundingSourceId, getFinanceBalance, maxTicketPriceFor, openingCashFor, recommendTicketPrice, roundOperatingCostFor, TICKET_PRICE_STEP } from '../world/finance'
import { clubEconomy } from '../world/economy'
import { formatEuros, formatExactEuros } from './money-format'
import { dateForRound, seasonLabel } from '../world/season'
import { getTransferPayments } from '../world/transfer-payments'
import { TransferPaymentsPanel } from './TransferPaymentsPanel'
import { DebtsPanel } from './DebtsPanel'
import { ratePercent } from './FacilityFinancing'
import { debtSchedule, FACILITY_FINANCING_RULES } from '../world/facility-debt'
import { seasonRounds } from '../world/career-world'
import { Icon } from './Icon'
import { FACILITY_LABELS, FacilitiesPanel, type FacilitiesActions } from './FacilitiesPanel'
import { SponsorshipPanel, type SponsorshipActions } from './SponsorshipPanel'
import { NamingRightsPanel } from './NamingRightsPanel'
import { arenaNameFor } from '../world/commercial'
import { arenaComfortPercent, getClubFacilities } from '../world/facilities-policy'
import { getDevelopmentSponsor } from '../data/development-sponsors'
import { governingDerby, RIVALRY_CROWD_PERCENT } from '../world/rivalries'
import './club-workspace.css'
import { clubFinanceDefinition, worldOf } from '../world/career-world'
import { ASSISTANT_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY } from '../data/staff-directory'

interface ClubWorkspaceProps extends FacilitiesActions, SponsorshipActions {
  season: SeasonState
  onEnable: () => void
  onPlanChange: (plan: FinancePlan) => void
  busy?: boolean
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const money = (cents: number) => formatEuros(cents, true)
/** Ledger rows keep exact amounts so detailed accounting reconciles to the cent. */
const exact = formatExactEuros
const movement = (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${exact(Math.abs(cents))}`
const BAND_LABELS = { 'euroleague-top': 'EuroLeague top group', euroleague: 'EuroLeague', 'top-upper': 'top division, upper half', 'top-lower': 'top division, lower half', second: 'second division', third: 'third division' } as const
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const count = (value: number) => value.toLocaleString('en-GB')
const kinds: Record<FinanceEntry['kind'], string> = { opening: 'Opening cash', sponsor: 'Sponsorship', operations: 'Operating costs', tickets: 'Ticket income', coaching: 'Coaching fee', scouting: 'Scout fee', fitness: 'Fitness coach fee', physio: 'Physio fee', assistant: 'Assistant coach fee', youth: 'Youth coach fee', payroll: 'Player wages', transfer: 'Player transfer', buyout: 'Contract buyout', facility: 'Facility upgrade', 'facility-upkeep': 'Facilities upkeep', 'board-capital': 'Board capital', 'naming-rights': 'Arena naming rights', 'sponsor-exit': 'Sponsor exit', loan: 'Bank loan', 'loan-repayment': 'Loan repayment', lease: 'Facility lease' }

export function ClubWorkspace({ season, onEnable, onPlanChange, onEnableFacilities, onFacilityUpgrade, onCancelFacilityUpgrade, onFacilityDelegation, onRequestBoardFunding, onEnableMaintenance, onMaintenancePlan, onFacilityRepair, onFacilityLoan, onFacilityLease, onRepayLoan, onEndLease, onEnableSponsorship, onAcceptSponsorship, onDeclineSponsorship, onRequestSponsorship, onSponsorshipDelegation, onAcceptNaming, onDeclineNaming, onRequestNaming, onNamingDelegation, onTerminateSponsorship, busy = false }: ClubWorkspaceProps) {
  const [kind, setKind] = useState<FinanceEntry['kind'] | 'all'>('all')
  const [period, setPeriod] = useState<'current' | 'all'>('current')
  const club = season.clubs.find(team => team.id === season.managedClubId)!
  const definition = clubFinanceDefinition(worldOf(season), club.id)
  const economy = clubEconomy(season, club.id)
  const facilities = getClubFacilities(season)
  const enabled = season.finance.enabledSince !== null
  const balance = getFinanceBalance(season.finance, club.id)
  const payrollEnabled = season.payroll.enabledSince !== null
  const plan = season.finance.plans[club.id]!
  const home = season.status === 'active' ? season.fixtures.find(fixture => fixture.homeClubId === club.id && fixture.round >= season.round && !fixture.result) : undefined
  // Format 65: a worn arena draws fewer spectators to the next home game.
  const comfort = home ? arenaComfortPercent(season, season.managedClubId, home.date) : 100
  const laterHome = season.fixtures.find(fixture => fixture.homeClubId === club.id && fixture.round > season.round && !fixture.result)
  const recommendationFixture = laterHome ?? home
  const recommendation = recommendationFixture ? recommendTicketPrice(season, recommendationFixture) : null
  const plannedPrice = plan.delegated && recommendation !== null ? recommendation : plan.price
  const locked = home?.round === season.round
  const forecastPrice = home ? locked ? season.finance.roundPrices[club.id]! : plan.delegated ? recommendTicketPrice(season, home) : plan.price : null
  const forecast = home && forecastPrice !== null ? forecastGate(season, home, forecastPrice) : null
  // A European visitor may be a club outside the full world (step 3.5b): its identity is in the world.
  const opponent = home ? season.clubs.find(team => team.id === home.awayClubId) ?? worldOf(season).clubs.find(team => team.id === home.awayClubId)! : null
  const derby = home ? governingDerby(season.rivalries, home.homeClubId, home.awayClubId, season.seasonNumber, home.round, worldOf(season)) : null
  const arenaName = arenaNameFor(season, club.id)
  const ledger = financeLedgerRows(season.finance, club.id).filter(entry => (kind === 'all' || entry.kind === kind) && (period === 'all' || entry.seasonNumber === season.seasonNumber))

  function entryDetail(entry: FinanceEntry): string {
    // Format 71: loans and leases in plain English.
    if (entry.debt) {
      const debt = season.facilities.debts?.find(item => item.id === entry.debt!.debtId)
      if (!debt) return 'Facility financing'
      const project = season.facilities.projects.find(item => item.id === debt.projectId)
      const what = `${FACILITY_LABELS[debt.facilityType]} ${project?.kind === 'repair' ? 'repair' : `level ${project?.toLevel ?? ''}`}`
      const count = debtSchedule(debt, seasonRounds(season)).length, payment = entry.debt.payment
      if (debt.kind === 'loan') return payment === 'start' ? `${what} · Loan received: ${debt.seasons} seasons at ${ratePercent(debt.rateBasisPoints)} a year, ${count} payments of ${money(debt.payment)}` : payment === 'settle' ? `${what} · Loan repaid early: the principal still owed plus a ${FACILITY_FINANCING_RULES.earlyRepaymentFeePercent}% fee` : `${what} · Loan payment ${payment} of ${count}${entry.amount < 0 ? ' (interest and principal)' : ''}`
      return payment === 'start' ? `${what} · Lease agreed for ${debt.seasons} seasons, nothing paid upfront: ${count} payments of ${money(debt.payment)}` : payment === 'settle' ? `${what} · Lease ended early: level handed back, penalty of ${FACILITY_FINANCING_RULES.leaseEndPenaltyPercent}% of the payments still to come` : `${what} · Lease payment ${payment} of ${count}`
    }
    if (entry.facility) {
      const project = season.facilities.projects.find(item => item.id === entry.facility!.projectId)
      if (project?.kind === 'repair') return `${FACILITY_LABELS[entry.facility.type]} · Repair, condition ${project.conditionBefore} → 100 · Paid upfront`
      return `${FACILITY_LABELS[entry.facility.type]}${project ? ` · Level ${project.fromLevel} → ${project.toLevel}` : ''} · Construction paid upfront`
    }
    if (entry.boardCapital) return `${FACILITY_LABELS[entry.boardCapital.facilityType]} ${season.facilities.projects.find(item => item.id === entry.boardCapital!.projectId)?.kind === 'repair' ? 'repair' : 'upgrade'} · Owner capital from the board`
    if (entry.facilityUpkeep) return (Object.entries(entry.facilityUpkeep) as [keyof typeof FACILITY_LABELS, number][]).filter(([, cost]) => cost > 0).map(([type, cost]) => `${FACILITY_LABELS[type]} ${money(cost)}`).join(' · ')
    if (entry.kind === 'buyout') {
      const buyout = season.employment.buyouts.find(item => item.id === entry.sourceId)
      return buyout ? `${getCareerPlayer(season, buyout.playerId).name} · Released from ${seasonLabel(buyout.startsSeason)}` : 'Player compensation'
    }
    if (entry.kind === 'transfer') {
      const transfer = season.employment.transfers.find(item => getTransferPayments(item).some(payment => payment.id === entry.sourceId))
      if (!transfer) return 'Transfer fee'
      const buying = transfer.toClubId === club.id
      const counterpart = season.clubs.find(team => team.id === (buying ? transfer.fromClubId : transfer.toClubId))
      return `${getCareerPlayer(season, transfer.playerId).name} · ${buying ? 'From' : 'To'} ${counterpart?.name ?? 'another club'}`
    }
    if (entry.payroll) {
      const charge = entry.payroll
      const rounds = charge.fromRound === charge.throughRound ? `Matchday ${charge.fromRound}` : `Matchdays ${charge.fromRound}–${charge.throughRound}`
      const saving = charge.items.reduce((total, item) => total + item.discount, 0)
      return charge.type === 'prepayment' ? `${getCareerPlayer(season, charge.items[0]!.playerId).name} · ${rounds} · ${money(saving)} saved` : `${charge.items.length} players · ${rounds}`
    }
    if (entry.ticket) {
      const fixtures = entry.seasonNumber === season.seasonNumber ? season.fixtures : season.history.find(archive => archive.seasonNumber === entry.seasonNumber)?.fixtures
      const fixture = fixtures?.find(fixture => fixture.id === entry.ticket!.fixtureId)
      const visitor = fixture ? season.clubs.find(team => team.id === fixture.awayClubId) ?? worldOf(season).clubs.find(team => team.id === fixture.awayClubId) : null
      return `${visitor ? `Home vs ${visitor.name} · ` : ''}${count(entry.ticket.attendance)} / ${count(entry.ticket.capacity ?? definition.capacity)} attendance · ${money(entry.ticket.price)} per ticket`
    }
    if (entry.youth) return YOUTH_COACH_DIRECTORY.find(coach => coach.id === entry.youth!.coachId)?.name ?? 'Youth coach fee'
    if (entry.assistant) return ASSISTANT_DIRECTORY.find(coach => coach.id === entry.assistant!.assistantId)?.name ?? 'Assistant coach fee'
    if (entry.physio) return PHYSIO_DIRECTORY.find(physio => physio.id === entry.physio!.physioId)?.name ?? 'Physio fee'
    if (entry.fitness) return FITNESS_DIRECTORY.find(coach => coach.id === entry.fitness!.coachId)?.name ?? 'Fitness coach fee'
    if (entry.scout) return SCOUT_DIRECTORY.find(scout => scout.id === entry.scout!.scoutId)?.name ?? 'Scout fee'
    if (entry.coach) return COACHES.find(coach => coach.id === entry.coach!.coachId)!.name
    if (entry.namingRights) { const agreement = season.commercial.naming?.agreements.find(item => item.id === entry.namingRights!.agreementId); return `${agreement?.arenaName ?? getDevelopmentSponsor(entry.namingRights.sponsorId).name} · ${seasonLabel(entry.seasonNumber)} · ${entry.namingRights.installment === 1 ? 'Matchday 6 installment' : 'Final matchday installment'}` }
    if (entry.sponsorExit) return `${getDevelopmentSponsor(entry.sponsorExit.sponsorId).name} · ${entry.sponsorExit.contract === 'naming' ? 'Arena naming rights' : 'Main sponsor'} · ${entry.sponsorExit.by === 'sponsor' ? 'Exit payment after the sponsor ended the agreement early' : 'Termination fee for ending the agreement early'}`
    if (entry.sponsorship) return `${getDevelopmentSponsor(entry.sponsorship.sponsorId).name} · ${seasonLabel(entry.seasonNumber)} · ${entry.sponsorship.installment === 'bonus' ? 'Top-half bonus' : entry.sponsorship.installment === 1 ? 'Opening installment' : 'Matchday 6 installment'}`
    if (entry.kind === 'sponsor' && entry.sourceId === fundingSourceId(entry.seasonNumber)) return `Season funding: league and European distributions, public money and the owner's contribution · ${seasonLabel(entry.seasonNumber)}`
    if (entry.kind === 'sponsor') return `${definition.sponsor} · ${seasonLabel(entry.seasonNumber)}`
    if (entry.kind === 'operations') return `Matchday ${entry.round} club operations`
    return 'Club finances activated'
  }

  return <div className={`club-workspace${enabled ? ' club-finances-active' : ''}`}>

    {!enabled ? <section className="club-finance-enable panel" aria-labelledby="club-finance-enable-title">
      <header className="club-heading"><h2 id="club-finance-enable-title">Club finances</h2><span>Not enabled</span></header>
      <div><p>Start every club with its opening cash ({money(openingCashFor(season, club.id))} here), sponsorship{economy ? ' and season funding' : ''} for the remaining season, and charges for existing staff commitments. Ticket income and operating costs begin from the current matchday.</p>{season.status === 'complete' && <p id="finance-enable-reason">Start next season before enabling club finances.</p>}<button id="enable-finance" className="button primary" onClick={onEnable} disabled={busy || season.status === 'complete'} aria-describedby={season.status === 'complete' ? 'finance-enable-reason' : undefined}>Enable club finances<Icon name="building" size={16} /></button></div>
    </section> : <>
      {balance.unpaid > 0 && <p className="club-unpaid-note panel">{money(balance.unpaid)} of costs remain unpaid. New income clears unpaid costs first; staff recruitment requires these costs to be settled.</p>}

      <FacilitiesPanel season={season} busy={busy} onEnableFacilities={onEnableFacilities} onFacilityUpgrade={onFacilityUpgrade} onCancelFacilityUpgrade={onCancelFacilityUpgrade} onFacilityDelegation={onFacilityDelegation} onRequestBoardFunding={onRequestBoardFunding} onEnableMaintenance={onEnableMaintenance} onMaintenancePlan={onMaintenancePlan} onFacilityRepair={onFacilityRepair} onFacilityLoan={onFacilityLoan} onFacilityLease={onFacilityLease} />

      <section className="club-venue panel" aria-labelledby="club-venue-title">
        <header className="club-heading"><h2 id="club-venue-title">Venue</h2></header>
        <dl>{arenaName && arenaName !== definition.venue ? <><div><dt>Arena name</dt><dd data-arena-name={arenaName}>{arenaName}</dd></div><div><dt>Official venue</dt><dd>{definition.venue}</dd></div></> : <div><dt>Venue</dt><dd data-arena-name={definition.venue}>{definition.venue}</dd></div>}<div><dt>{facilities.arenaCapacity === facilities.arenaFullCapacity ? 'Capacity' : 'Capacity this matchday'}</dt><dd>{count(facilities.arenaCapacity)}</dd></div><div><dt>Operating cost / matchday</dt><dd>{money(roundOperatingCostFor(season, club.id) + facilities.upkeepPerRound)}</dd></div></dl>
      </section>

      <SponsorshipPanel season={season} busy={busy} onEnableSponsorship={onEnableSponsorship} onAcceptSponsorship={onAcceptSponsorship} onDeclineSponsorship={onDeclineSponsorship} onRequestSponsorship={onRequestSponsorship} onSponsorshipDelegation={onSponsorshipDelegation} onTerminateSponsorship={onTerminateSponsorship} />
      <NamingRightsPanel season={season} busy={busy} onAcceptNaming={onAcceptNaming} onDeclineNaming={onDeclineNaming} onRequestNaming={onRequestNaming} onNamingDelegation={onNamingDelegation} onTerminateSponsorship={onTerminateSponsorship} />

      <section className="club-ticket-plan panel" aria-labelledby="club-ticket-plan-title" data-finance-locked-price={season.finance.roundPrices[club.id]}>
        <header className="club-heading"><h2 id="club-ticket-plan-title"><Icon name="wallet" size={18} />Ticket price</h2><span>{season.status === 'complete' ? 'Next season' : 'Next matchday'}</span></header>
        <div className="club-ticket-controls">
          <div className="club-ticket-control"><div><label htmlFor="ticket-control">Pricing control</label><output htmlFor="ticket-control">{plan.delegated ? 'Automatic' : 'Manual'}</output></div><input type="range" id="ticket-control" min={0} max={1} step={1} value={plan.delegated ? 1 : 0} aria-valuetext={plan.delegated ? 'Automatic' : 'Manual'} onChange={event => onPlanChange({ ...plan, delegated: event.target.value === '1' })} disabled={busy} /><div className="club-range-labels"><span>Manual</span><span>Automatic</span></div></div>
          <div className="club-ticket-control"><div><label htmlFor="ticket-price">Ticket price</label><output htmlFor="ticket-price">{plan.delegated && recommendation === null ? 'Automatic' : money(plannedPrice)}{plan.delegated && recommendation !== null && <small>recommended</small>}</output></div><input type="range" id="ticket-price" min={0} max={maxTicketPriceFor(season, club.id) / 100} step={TICKET_PRICE_STEP / 100} value={plannedPrice / 100} aria-valuetext={`${money(plannedPrice)} per ticket${plan.delegated ? ', automatic pricing' : ''}`} aria-describedby="ticket-plan-help" onChange={event => onPlanChange({ ...plan, price: Number(event.target.value) * 100 })} disabled={busy || plan.delegated} /><div className="club-range-labels"><span>{money(0)}</span><span>{money(maxTicketPriceFor(season, club.id))}</span></div></div>
        </div>
        <details className="game-disclosure"><summary><Icon name="clock" size={15} />When prices change</summary><div className="club-note" id="ticket-plan-help"><p>This matchday’s price stays locked. Automatic prices are set before each matchday.</p>{plan.delegated && recommendationFixture && <p>Recommendation: {recommendationFixture.round === season.round ? 'current home demand' : `home fixture ${formatDate(recommendationFixture.date)}`} · may change with results.</p>}</div></details>
      </section>

      <section className="club-gate-forecast panel" aria-labelledby="club-gate-forecast-title" data-finance-gate-fixture={home?.id}>
        <header className="club-heading"><h2 id="club-gate-forecast-title"><Icon name="people" size={18} />Next home crowd</h2><span>{home ? locked ? 'Current matchday · price locked' : 'Future fixture · price not locked' : 'No remaining home fixtures'}</span></header>
        {home && forecast && opponent ? <><div className="club-gate-fixture"><strong>{club.name} vs {opponent.name}{derby && <span className="club-derby" data-derby={derby.id}> · {derby.name}, crowd demand +{RIVALRY_CROWD_PERCENT * derby.intensity}%</span>}{comfort < 100 && <span className="club-derby" data-arena-comfort={Math.round(comfort)}> · Worn arena, crowd demand −{Math.round(100 - comfort)}%</span>}</strong><span><time dateTime={home.date}>{formatDate(home.date)}</time> · Matchday {home.round}</span></div><progress className="club-crowd-meter" value={forecast.attendance} max={forecast.capacity} aria-label={`${forecast.attendance} of ${forecast.capacity} seats forecast to be filled`} /><dl className="club-gate-values"><div><dt>{locked ? 'Locked ticket price' : 'Planned ticket price'}</dt><dd data-gate-price={forecast.price}>{money(forecast.price)}</dd></div><div><dt>Forecast attendance</dt><dd data-gate-attendance={forecast.attendance}>{count(forecast.attendance)} <small>/ {count(forecast.capacity)}</small></dd></div><div><dt>Forecast ticket income</dt><dd data-gate-revenue={forecast.revenue}>{money(forecast.revenue)}</dd></div></dl><p className="club-note">This is a forecast. {locked ? 'Income is recorded when the matchday is completed.' : 'Future demand, pricing and facility work may change before this matchday is prepared.'}</p></> : <p className="club-empty">No further home fixtures are scheduled this season. Your ticket plan carries into the next season.</p>}
      </section>

      <TransferPaymentsPanel season={season} />
      <DebtsPanel season={season} busy={busy} onRepayLoan={onRepayLoan} onEndLease={onEndLease} />

      <details className="club-ledger panel game-disclosure">
        <summary><Icon name="wallet" size={17} />Financial activity · {ledger.length} entries</summary>
        <header className="club-heading"><h2 id="club-ledger-title">Financial activity</h2><span>{ledger.length} entries · newest first</span></header>
        <div className="club-ledger-filters"><label htmlFor="finance-kind">Activity<select id="finance-kind" value={kind} onChange={event => setKind(event.target.value as FinanceEntry['kind'] | 'all')} disabled={busy}><option value="all">All activity</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label htmlFor="finance-season">Period<select id="finance-season" value={period} onChange={event => setPeriod(event.target.value as 'current' | 'all')} disabled={busy}><option value="current">Current season · {seasonLabel(season.seasonNumber)}</option><option value="all">All seasons</option></select></label></div>
        <div className="club-ledger-scroll" tabIndex={0} role="region" aria-label="Club financial activity"><table className="club-finance-ledger"><thead><tr><th scope="col">Date</th><th scope="col">Activity</th><th scope="col">Income / cost</th><th scope="col">Cash change</th><th scope="col">Unpaid change</th></tr></thead><tbody>{ledger.map(entry => {
          const transfer = entry.kind === 'transfer' ? season.employment.transfers.find(item => getTransferPayments(item).some(payment => payment.id === entry.sourceId)) : null
          const payment = transfer ? getTransferPayments(transfer).find(item => item.id === entry.sourceId) : null
          const buyout = entry.kind === 'buyout' ? season.employment.buyouts.find(item => item.id === entry.sourceId) : null
          const facilityProject = entry.facility ? season.facilities.projects.find(item => item.id === entry.facility!.projectId) : null
          const date = facilityProject?.startedOn ?? buyout?.completedOn ?? payment?.paidOn ?? dateForRound(entry.round, entry.seasonNumber)
          return <tr key={entry.id} data-finance-entry={entry.id} data-finance-kind={entry.kind}>
            <td><time dateTime={date}>{formatDate(date)}</time><small>{buyout ? 'Player compensation' : transfer && payment ? `Transfer payment ${payment.installmentIndex + 1}/${transfer.installments.length}` : `Matchday ${entry.round}`}</small></td><th scope="row">{kinds[entry.kind]}<small>{entryDetail(entry)}</small>{entry.payroll && <details className="club-payroll-breakdown" data-payroll-ledger={entry.id}><summary>Player charges</summary><ul>{entry.payroll.items.map(item => <li key={item.agreementId}><span>{getCareerPlayer(season, item.playerId).name}</span><strong>{money(item.amount)}</strong>{item.discount > 0 && <small>Gross {money(item.gross)} · discount {money(item.discount)}</small>}</li>)}</ul></details>}</th>
            <td className={entry.amount < 0 ? 'club-finance-cost' : entry.amount > 0 ? 'club-finance-income' : ''}>{movement(entry.amount)}</td>
            <td><span className={entry.cashDelta < 0 ? 'club-finance-cost' : entry.cashDelta > 0 ? 'club-finance-income' : ''}>{movement(entry.cashDelta)}</span><small>Balance {exact(entry.cashAfter)}</small></td>
            <td><span className={entry.unpaidDelta > 0 ? 'club-finance-cost' : entry.unpaidDelta < 0 ? 'club-finance-income' : ''}>{movement(entry.unpaidDelta)}</span><small>Balance {exact(entry.unpaidAfter)}</small></td>
          </tr>
        })}{!ledger.length && <tr><td colSpan={5} className="club-empty">No financial activity matches this view.</td></tr>}</tbody></table></div>
        <p className="club-note">Income clears unpaid costs before adding to cash. Balances include all earlier activity, even when filtered. Staff commitments track season allocation separately from cash.</p>
      </details>
    </>}
    <p className="club-model-note">{economy ? `Estimated from published 2025-27 club budgets, salary and attendance reports: about ${formatEuros(economy.budget)} a season (${BAND_LABELS[economy.band]}). ` : 'Fictional development finances. '}{payrollEnabled ? season.employment.enabledSince ? 'Player wages follow signed employment contracts.' : 'Player wages follow the fixed squad terms.' : 'Player payroll is not enabled.'}</p>
  </div>
}

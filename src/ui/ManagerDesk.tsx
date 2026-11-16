import { getPlayerRetirement } from '../world/lifecycle-policy'
import { getSquadRelationships } from '../world/relationships'
import { getBoardSummary } from '../world/board'
import { getPressQuestion } from '../world/press-policy'
import { FACILITY_TYPES, getFacilityCondition, getFacilityLevel } from '../world/facilities-policy'
import { governingDerby, RIVALRY_CROWD_PERCENT } from '../world/rivalries'
import { rivalryNote } from './rivalry-text'
import { BOARD_VERDICT_EFFECTS, seasonVerdict, verdictBudgets } from '../world/board-consequences'
import { getClubSponsorship } from '../world/commercial'
import { MAX_SEASON_NUMBER, seasonLabel } from '../world/season'
import { getCareerPlayer } from '../world/player-catalog'
import { recentClubRetirements } from './PlayerLifecycle'
import { careerMoveText } from './career-text'
import { careerMovesGovern } from '../world/career'
import type { AssistantCoach } from '../domain/assistant'
import { AssistantPortrait } from './AssistantPortrait'
import type { SeasonState } from '../domain/season'
import { getPlayerHealth, getPlayerMedicalSummary } from '../world/health'
import { injuryLabel } from '../domain/injuries'
import { getFinanceBalance } from '../world/finance'
import { getPayrollReserve } from '../world/payroll'
import { getTransferPaymentSummary } from '../world/transfer-payments'
import { getInSeasonOffers } from '../world/recruitment-policy'
import { getLiveMarketOffers, getMarketOffers, getMarketWindow, getNextMarketDate, isMarketActive } from '../world/market-policy'
import { contractForSeason, getClubContractSummary, MIN_ROSTER_SIZE } from '../world/employment-policy'
import { medicalDate } from './SeasonMedicalReport'
import type { MatchState, Side } from '../domain/types'
import { isPlayerEligible } from '../engine/match'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { StaminaMeter } from './StaminaMeter'
import { TeamInstructions } from './TeamInstructions'
import './manager-desk.css'
import { seasonRounds, worldOf } from '../world/career-world'
import { formatEuros } from './money-format'

interface ManagerDeskProps {
  match: MatchState
  assistant?: AssistantCoach
  onOpenAssistantAdvice?: () => void
  season?: SeasonState | null
  managedSide?: Side
  fixtureLabel?: string
  apply: (action: (state: MatchState) => MatchState) => void
  onOpenMatch: () => void
  onOpenSquad: () => void
  onOpenMedical: () => void
  onSelectPlayer: (id: string) => void
  onOpenCoaching: () => void
  onOpenClub: () => void
  onOpenPayroll: () => void
  onOpenTransfers: () => void
  onOpenScouting: () => void
  onOpenRelationships?: (playerId?: string) => void
  onOpenBoard?: () => void
  onOpenInbox?: () => void
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const period = (value: number) => value <= 4 ? `Q${value}` : `OT${value - 4}`
const money = (cents: number) => formatEuros(cents)

export function ManagerDesk({ match, assistant, onOpenAssistantAdvice, season, managedSide = 'home', fixtureLabel = 'EXHIBITION', apply, onOpenMatch, onOpenSquad, onOpenMedical, onSelectPlayer, onOpenCoaching, onOpenClub, onOpenPayroll, onOpenTransfers, onOpenScouting, onOpenRelationships, onOpenBoard, onOpenInbox }: ManagerDeskProps) {
  const team = match[managedSide]
  const market = season && isMarketActive(season) ? getMarketWindow(season) : null
  const marketOffers = market && season ? getMarketOffers(season, season.managedClubId, true) : []
  const nextDecision = market && season ? getNextMarketDate(season) : null
  const complete = match.status === 'finished'
  const ready = match.status === 'ready'
  const needsReplacement = !complete && match.requiredSubstitutions.length > 0
  const score = match.result?.officialScore ?? match.score
  const active = match.lineups[managedSide].flatMap(id => team.players.filter(player => player.id === id))
  const eligible = team.players.filter(player => isPlayerEligible(match, player.id))
  const availableBench = eligible.filter(player => !match.lineups[managedSide].includes(player.id))
  const injured = team.players.filter(player => complete && season ? getPlayerHealth(season, player.id) : match.injuries[player.id])
  const foulTrouble = active.filter(player => match.stats[player.id].fouls === 4)
  const tired = active.filter(player => match.stats[player.id].condition < 75 && isPlayerEligible(match, player.id))
  const lineupEnergy = active.length ? Math.round(active.reduce((sum, player) => sum + match.stats[player.id].condition, 0) / active.length) : null
  const playerName = (id: string, side: Side = managedSide) => match[side].players.find(player => player.id === id)?.name ?? id
  const status = complete ? 'FULL TIME' : needsReplacement ? 'REPLACEMENT REQUIRED' : ready ? 'PRE-MATCH' : 'MATCH PAUSED'
  const notices: { key: string; title: string; detail: string; urgent?: boolean; action: string; open: () => void }[] = []
  const finances = season?.finance.enabledSince ? getFinanceBalance(season.finance, season.managedClubId) : null
  const wageReserve = season?.payroll.enabledSince ? getPayrollReserve(season, season.managedClubId) : null

  const derbyFixture = season?.status === 'active' ? season.fixtures.find(fixture => fixture.id === season.activeFixtureId && !fixture.result) : undefined
  const derby = season && derbyFixture ? governingDerby(season.rivalries, derbyFixture.homeClubId, derbyFixture.awayClubId, season.seasonNumber, derbyFixture.round, worldOf(season)) : null
  if (season && derbyFixture && derby && onOpenBoard) {
    const home = derbyFixture.homeClubId === season.managedClubId, rival = season.clubs.find(club => club.id === (home ? derbyFixture.awayClubId : derbyFixture.homeClubId))!
    notices.push({ key: 'derby', title: `Derby next · ${derby.name}`, detail: `${home ? 'Home' : 'Away'} against ${rival.name}. ${home ? `Crowd demand +${RIVALRY_CROWD_PERCENT * derby.intensity}%. ` : ''}The board and the squad weigh this result more than usual.${rivalryNote(season, rival.id)}`, action: 'View rivalry', open: onOpenBoard })
  }
  const worn = season?.facilities.maintenanceSince ? FACILITY_TYPES.filter(type => getFacilityLevel(season, type, season.managedClubId) > 1).map(type => ({ type, condition: getFacilityCondition(season, type, season.managedClubId) })).filter(item => item.condition < 60) : []
  const move = season?.status === 'complete' ? season.career?.moves.find(item => item.seasonNumber === season.seasonNumber) : undefined
  const jobBoard = season?.status === 'active' && careerMovesGovern(season.career, season.seasonNumber) ? getBoardSummary(season) : null
  if (season && jobBoard?.enabled && jobBoard.latest && jobBoard.confidence < 30) notices.push({ key: 'career-risk', title: 'Job at risk', detail: `Board confidence is ${jobBoard.confidence}/100. If the season ends Under pressure (below 30), the board will dismiss you; clubs that need a coach will then offer you a job.`, urgent: true, action: 'View board', open: onOpenBoard ?? onOpenClub })
  if (season && move) { const text = careerMoveText(season, move); notices.push({ key: 'career', title: text.title, detail: text.detail, urgent: move.reason === 'dismissed', action: 'View board', open: onOpenBoard ?? onOpenClub }) }
  if (season && worn.length) notices.push({ key: 'facilities-worn', title: 'Facilities wearing', detail: `${worn.map(item => `${({ arena: 'Arena', training: 'Training facilities', youth: 'Youth infrastructure' })[item.type]} ${item.condition}/100`).join(', ')}. Their benefit shrinks while condition is low; full upkeep restores it.`, action: 'Review facilities', open: onOpenClub })
  const press = season && onOpenInbox ? getPressQuestion(season) : null
  if (press && !press.answered && onOpenInbox) notices.push({ key: 'press', title: 'Press conference', detail: `${press.question} Answer in the Inbox before the next match, or your assistant ${press.subjectIds ? 'gives no comment' : 'keeps it routine'}.`, action: 'Open inbox', open: onOpenInbox })

  if (season?.board.enabledSince && onOpenBoard) {
    const board = getBoardSummary(season)
    // Once the final review has given the season verdict, it replaces the latest-review notice until the new season.
    const verdict = season.board.consequencesSince && season.seasonNumber < MAX_SEASON_NUMBER ? seasonVerdict(season.board, season.managedClubId, season.seasonNumber, seasonRounds(season)) : null
    if (verdict) {
      const budgets = verdictBudgets(season.managedClubId, verdict.verdict, worldOf(season))
      notices.push({ key: 'board', title: `Season verdict · ${BOARD_VERDICT_EFFECTS[verdict.verdict].label}`, detail: `Final confidence ${verdict.confidence}/100. ${seasonLabel(season.seasonNumber + 1)}: ${money(budgets.staff)} staff budget and ${money(budgets.capital)} owner capital for facility upgrades.`, urgent: verdict.verdict === 'concerned' || verdict.verdict === 'pressure', action: 'Review board', open: onOpenBoard })
    } else if (board.latest) notices.push({ key: 'board', title: `Board review · ${board.confidenceLabel}`, detail: `${medicalDate(board.latest.date)}: confidence ${board.confidence}/100. ${board.latest.club.wins} ${board.latest.club.wins === 1 ? 'win' : 'wins'} in ${board.latest.club.played} counted games.${board.financeStatus === 'behind' ? ' Unpaid costs are above the agreed starting balance.' : ''}`, urgent: board.confidence < 40 || board.financeStatus === 'behind', action: 'Review board', open: onOpenBoard })
    else if (board.objective && board.objective.games > 0) notices.push({ key: 'board', title: 'Board objectives set', detail: `Win ${board.objective.targetWins} of ${board.objective.games} counted games.${board.objective.startingUnpaid !== null ? ` Keep unpaid costs at or below ${money(board.objective.startingUnpaid)}.` : ''}`, action: 'View objectives', open: onOpenBoard })
  }

  if (season?.commercial.enabledSince) {
    const sponsorship = getClubSponsorship(season), next = seasonLabel(Math.min(season.seasonNumber + 1, MAX_SEASON_NUMBER))
    if (sponsorship.open.length) notices.push({ key: 'sponsorship', title: 'Sponsor offers waiting', detail: `${sponsorship.open.length} ${sponsorship.open.length === 1 ? 'offer' : 'offers'} for ${next}. Unsigned offers expire on ${medicalDate(sponsorship.open[0]!.expiresOn)}.`, urgent: season.status === 'complete', action: 'Review offers', open: onOpenClub })
    else if (season.status === 'complete' && !sponsorship.next && season.seasonNumber < MAX_SEASON_NUMBER) notices.push({ key: 'sponsorship', title: 'No sponsor for next season', detail: `${next} will start without main-sponsor income.`, urgent: true, action: 'Review sponsorship', open: onOpenClub })
  }

  if (season?.relationships.enabledSince && onOpenRelationships) {
    const relationships = getSquadRelationships(season)
    const concerns = relationships.filter(row => row.concern)
    const promises = relationships.filter(row => row.promise?.status === 'active')
    const roleMinutes = relationships.reduce((sum, row) => sum + row.minMinutes, 0)
    const first = concerns[0] ?? promises[0]
    if (first) notices.push({ key: 'relationships', title: concerns.length ? `${concerns.length} playing-time ${concerns.length === 1 ? 'concern' : 'concerns'}` : `${promises.length} playing-time ${promises.length === 1 ? 'promise' : 'promises'}`, detail: concerns.length ? concerns.map(row => `${row.player.name}: ${row.concern}`).join(' ') : promises.map(row => `${row.player.name}: ${row.promise!.eligibleGames} of 3 eligible games reviewed, ${row.promise!.remainingClubGames} club games remaining.`).join(' '), urgent: concerns.some(row => row.morale < 40) || promises.some(row => row.promise!.remainingClubGames <= 1), action: 'Review dynamics', open: () => onOpenRelationships(first.player.id) })
    else if (roleMinutes > 200) notices.push({ key: 'relationship-roles', title: 'Playing-time commitments exceed available minutes', detail: `The squad's agreed roles require ${roleMinutes} minutes per game; a regulation game has 200. Discuss a lower role to bring the plan within available minutes.`, urgent: true, action: 'Review dynamics', open: () => onOpenRelationships() })
  }

  if (season?.employment.enabledSince) {
    const nextSquad = getClubContractSummary(season, season.managedClubId)
    const expiring = team.players.filter(player => (getPlayerRetirement(season, player.id).notice?.lastSeason ?? Infinity) > season.seasonNumber && !contractForSeason(season.employment, player.id, season.seasonNumber + 1)).length
    if (season.status === 'complete') notices.push({ key: 'offseason', title: 'Prepare next season’s squad', detail: `${nextSquad.rosterSize} players signed for next season. ${Math.max(0, MIN_ROSTER_SIZE - nextSquad.rosterSize)} more needed to reach the minimum squad.`, urgent: nextSquad.rosterSize < MIN_ROSTER_SIZE, action: 'Review offseason', open: onOpenTransfers })
    else if (expiring) notices.push({ key: 'contracts', title: `${expiring} contracts awaiting renewal`, detail: 'Unrenewed players leave at the end of this season. Renewals take effect next season.', action: 'Review contracts', open: onOpenTransfers })
  }
  if (season?.lifecycle.enabledSince) {
    const retirements = team.players.flatMap(player => { const retirement = getPlayerRetirement(season, player.id); return retirement.status === 'announced' && retirement.notice ? [{ player, notice: retirement.notice }] : [] })
    if (retirements.length) notices.push({ key: 'retirements', title: retirements.length === 1 ? 'Retirement announced' : retirements.length + ' retirements announced', detail: retirements.map(({ player, notice }) => player.name + ': final season ' + seasonLabel(notice.lastSeason) + ', retiring ' + medicalDate(notice.retiredOn)).join('; '), urgent: retirements.some(({ notice }) => notice.lastSeason === season.seasonNumber), action: 'Plan replacements', open: onOpenTransfers })
    const retired = recentClubRetirements(season)
    if (retired.length) notices.push({ key: 'retired', title: retired.length === 1 ? 'A player has retired' : `${retired.length} players have retired`, detail: retired.map(notice => getCareerPlayer(season, notice.playerId).name).join(', ') + '. Their playing records remain in Season statistics.', action: 'Review squad', open: onOpenSquad })
  }
  if (season?.scouting.enabledSince) {
    const latestRound = season.status === 'complete' ? season.round : season.round - 1
    const reports = season.scouting.clubs[season.managedClubId]!.reviews.filter(report => report.seasonNumber === season.seasonNumber && report.round === latestRound)
    if (reports.length) notices.push({ key: 'scouting', title: 'Scouting reviews available', detail: `${reports.filter(report => report.outcome === 'observed').length} skill reports from matchday ${latestRound}.${reports.some(report => report.outcome === 'no-minutes') ? ' Some targets did not play.' : ''}`, action: 'Review scouting', open: onOpenScouting })
  }
  if (season?.recruitment.enabledSince && season.status === 'active') {
    const latestOffers = [...new Map(getInSeasonOffers(season, season.managedClubId).map(offer => [offer.playerId, offer])).values()]
    const arrivals = latestOffers.filter(offer => offer.status === 'accepted' && offer.respondedOn === season.date)
    const replies = latestOffers.filter(offer => ['countered', 'rejected', 'cancelled', 'lost', 'expired'].includes(offer.status) && (offer.respondedOn ?? offer.closedOn) === season.date)
    const incoming = getInSeasonOffers(season).filter(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === season.managedClubId)
    if (incoming.length) notices.push({ key: 'inseason-incoming', title: `${incoming.length} incoming transfer ${incoming.length === 1 ? 'offer' : 'offers'}`, detail: 'Approve the fee, ask for your price or reject before advancing to the next matchday.', urgent: true, action: 'Review incoming offers', open: onOpenTransfers })
    const departures = season.employment.transfers.filter(transfer => transfer.fromClubId === season.managedClubId && transfer.startsSeason === season.seasonNumber && transfer.completedOn === season.date)
    if (departures.length) notices.push({ key: 'inseason-departures', title: `${departures.length} player ${departures.length === 1 ? 'has' : 'have'} left the squad`, detail: 'Transfers are complete. Review your lineup and available replacements.', action: 'Review squad', open: onOpenSquad })
    if (arrivals.length) notices.push({ key: 'new-registrations', title: `${arrivals.length} ${arrivals.length === 1 ? 'player has' : 'players have'} joined the squad`, detail: arrivals.map(offer => team.players.find(player => player.id === offer.playerId)?.name ?? offer.playerId).join(', '), action: 'Review squad', open: onOpenSquad })
    if (replies.length) notices.push({ key: 'inseason-replies', title: `${replies.length} recruitment ${replies.length === 1 ? 'reply' : 'replies'}`, detail: 'Review the latest decisions and any revised salary requests.', action: 'Review offers', open: onOpenTransfers })
  }
  if (season?.negotiations.enabledSince) {
    const latest = new Map(season.negotiations.records.filter(record => record.clubId === season.managedClubId && record.startsSeason === season.seasonNumber + 1).map(record => [record.playerId, record]))
    const counters = market ? marketOffers.filter(offer => offer.status === 'countered' && (!offer.transfer || offer.transfer.clubStatus === 'accepted')).length : [...latest.values()].filter(record => record.outcome === 'countered' && !contractForSeason(season.employment, record.playerId, season.seasonNumber + 1)).length
    if (counters) notices.push({ key: 'negotiations', title: `${counters} player ${counters === 1 ? 'counteroffer' : 'counteroffers'}`, detail: market ? 'Review the proposed salary and contract length. Your original offer still reserves salary budget and a squad place until its deadline.' : 'Review the proposed salary and contract length. These replies have not committed salaries or reserved players.', action: 'Review offers', open: onOpenTransfers })
    const lost = market ? getMarketOffers(season).filter(offer => offer.status === 'lost' && offer.closedOn === season.date).length : 0
    if (lost) notices.push({ key: 'rival-offers', title: `${lost} ${lost === 1 ? 'player chose' : 'players chose'} another club`, detail: 'Your reserved salary budget and squad places have been released. Review the decisions and choose your next targets.', action: 'Review decisions', open: onOpenTransfers })
    const clubCounters = marketOffers.filter(offer => offer.transfer?.clubStatus === 'countered').length
    if (clubCounters) notices.push({ key: 'club-counteroffers', title: `${clubCounters} club ${clubCounters === 1 ? 'counteroffer' : 'counteroffers'}`, detail: 'The selling club has asked for a higher transfer fee. Review its price or withdraw your offer.', action: 'Review fees', open: onOpenTransfers })
    const incoming = market ? getLiveMarketOffers(season).filter(offer => offer.transfer?.sellerClubId === season.managedClubId && offer.status === 'club-review').length : 0
    if (incoming) notices.push({ key: 'incoming-transfers', title: `${incoming} incoming transfer ${incoming === 1 ? 'offer' : 'offers'}`, detail: 'Decide whether to accept the fee, reject the approach or ask for your club’s price. The sale completes only if the player also agrees.', urgent: true, action: 'Review incoming offers', open: onOpenTransfers })
  }

  if (needsReplacement) notices.push({ key: 'replacement', title: 'Replace an unavailable player', detail: match.requiredSubstitutions.map(item => `${playerName(item.playerId, item.side)}: ${item.reason === 'injured' ? 'injured' : 'five fouls'}`).join('; '), urgent: true, action: 'Choose replacement', open: onOpenCoaching })
  if (finances?.unpaid) notices.push({ key: 'unpaid', title: 'Outstanding club costs', detail: `${money(finances.unpaid)} unpaid. New staff appointments are blocked until these costs are covered.`, urgent: true, action: 'Review finances', open: onOpenClub })
  if (season) {
    const payments = getTransferPaymentSummary(season, season.managedClubId)
    if (payments.overdue > 0) notices.push({ key: 'transfer-arrears', title: 'Transfer payment overdue', detail: `${money(payments.overdue)} remains due. Payments are collected automatically when funds are available after protecting player salaries. Staff hires, new player offers and contract buyouts are blocked.`, urgent: true, action: 'Review payments', open: onOpenClub })
    if (payments.incomingOverdue > 0) notices.push({ key: 'transfer-receipts', title: 'Transfer income overdue', detail: `${money(payments.incomingOverdue)} is still owed by other clubs. It becomes available only when received.`, action: 'Review payments', open: onOpenClub })

  }
  if (finances && wageReserve !== null && wageReserve > finances.cash) notices.push({ key: 'wage-commitments', title: 'Wage commitments exceed cash', detail: `${money(wageReserve - finances.cash)} more is needed to cover remaining scheduled wages. Future income may reduce this shortfall.`, urgent: true, action: 'Review wages', open: onOpenPayroll })
  if (injured.length) notices.push({ key: 'injuries', title: `${injured.length} injured ${injured.length === 1 ? 'player' : 'players'}`, detail: injured.map(player => { const health = season ? getPlayerMedicalSummary(season, player.id) : null, kind = health?.injury.kind ?? match.injuries[player.id]?.kind; const name = kind ? `${player.name} (${injuryLabel(kind)})` : player.name; return health ? `${name}: expected ${medicalDate(health.effectiveReturnOn)}` : name }).join('; '), action: season ? 'Open medical' : 'Review squad', open: season ? onOpenMedical : onOpenSquad })
  if (!complete && foulTrouble.length) notices.push({ key: 'fouls', title: 'Foul trouble', detail: foulTrouble.map(player => `${player.name} · 4 fouls`).join('; '), action: 'Manage rotation', open: onOpenCoaching })
  if (tired.length) notices.push({ key: 'fatigue', title: complete ? 'Post-match fatigue' : 'Players tiring', detail: tired.map(player => `${player.name} · ${Math.round(match.stats[player.id].condition)}%`).join('; '), action: complete ? 'Review squad' : 'Manage rotation', open: complete ? onOpenSquad : onOpenCoaching })
  if (!complete && match.pendingSubstitutions[managedSide].length) notices.push({ key: 'queued', title: 'Substitutions queued', detail: match.pendingSubstitutions[managedSide].map(change => `${playerName(change.outId)} → ${playerName(change.inId)}`).join('; '), action: 'Review changes', open: onOpenCoaching })
  if (!complete && match.timeoutRequested[managedSide]) notices.push({ key: 'timeout', title: 'Timeout requested', detail: 'Waiting for the next permitted stoppage.', action: 'Review request', open: onOpenCoaching })

  const activity = match.events.filter(event => event.type !== 'tipoff' && !(event.type === 'command' && event.scene?.kind === 'setup')).slice(-5).reverse()
  const displayName = complete ? 'Final lineup' : ready ? 'Starting five' : 'On the floor'

  return <div className="manager-desk">
    {market && <section className="desk-market panel" aria-label="Offseason recruitment"><Icon name="calendar" size={25} /><div><h2>Build next season's squad</h2><p>{marketOffers.length} outstanding {marketOffers.length === 1 ? 'offer' : 'offers'}{nextDecision ? ` ? Next decision ${medicalDate(nextDecision)}` : ' ? Recruitment closed'}</p></div><button className="button primary" onClick={onOpenTransfers}>Review recruitment<Icon name="chevron" size={15} /></button></section>}
    <section className="desk-fixture panel" aria-label="Current fixture">
      <div className="desk-fixture-label"><span>{complete ? 'Last match \u00b7 ' : ''}{fixtureLabel}</span><strong className={needsReplacement ? 'desk-status-urgent' : ''}>{status}</strong></div>
      <div className="desk-fixture-content">
        <div className="desk-fixture-team"><span className="desk-club-code" style={{ color: match.home.color }}>{match.home.shortName}</span><div><strong>{match.home.name}</strong><span>{managedSide === 'home' ? 'Home · Your team' : 'Home'}</span></div></div>
        <div className="desk-fixture-score"><strong aria-label={`Score: ${score.home} to ${score.away}`}>{score.home}<span>:</span>{score.away}</strong><span>{ready ? 'Awaiting tipoff' : complete ? match.result?.kind === 'default' ? 'Awarded by default' : `${period(match.period)} · Final` : `${period(match.period)} · ${clock(match.clockSeconds)}`}</span></div>
        <div className="desk-fixture-team desk-fixture-away"><span className="desk-club-code" style={{ color: match.away.color }}>{match.away.shortName}</span><div><strong>{match.away.name}</strong><span>{managedSide === 'away' ? 'Away · Your team' : 'Away'}</span></div></div>
        <button className="button primary desk-match-action" onClick={needsReplacement ? onOpenCoaching : onOpenMatch}>{complete ? 'View result' : needsReplacement ? 'Resolve replacement' : 'Go to match'}<Icon name="arrow" size={16} /></button>
      </div>
    </section>

    <dl className="desk-squad-status" aria-label="Squad status">
      <div><dt>{complete ? 'Eligible at final whistle' : 'Eligible players'}</dt><dd>{eligible.length}<small> / {team.players.length}</small></dd></div>
      <div><dt>{complete ? 'Final reserves' : 'Available reserves'}</dt><dd>{availableBench.length}</dd></div>
      <div><dt>{complete ? 'Final lineup stamina' : 'Lineup stamina'}</dt><dd>{lineupEnergy === null ? '—' : `${lineupEnergy}%`}</dd></div>
      <div><dt>Substitutions</dt><dd className="desk-policy-value">{match.autoSubstitutions[managedSide] ? 'Assistant' : 'Manual'}</dd></div>
    </dl>

    <div className="desk-columns">
      <div className="desk-main-column">
        <section className="desk-lineup panel" aria-labelledby="desk-lineup-heading">
          <div className="desk-panel-heading"><h2 id="desk-lineup-heading"><Icon name="people" size={16} />{displayName}</h2><button className="text-button" onClick={onOpenSquad}>Full squad<Icon name="chevron" size={15} /></button></div>
          <div className="desk-table-scroll"><table className="desk-lineup-table"><thead><tr><th>Player</th><th>Position</th><th>Stamina</th><th>Fouls</th></tr></thead><tbody>{active.map(player => {
            const unavailable = match.injuries[player.id] ? 'Injured' : match.stats[player.id].fouls >= 5 ? 'Fouled out' : null
            return <tr key={player.id} data-player-id={player.id}><td><button className="desk-player" onClick={() => onSelectPlayer(player.id)} aria-label={`View ${player.name}`}><Avatar player={player} color={team.color} size={31} /><span><strong>{player.name}</strong><small>#{player.number}{unavailable && <em>{unavailable}</em>}</small></span></button></td><td>{player.position}</td><td><StaminaMeter value={match.stats[player.id].condition} label={`${player.name} stamina`} compact /></td><td className={match.stats[player.id].fouls >= 4 ? 'desk-warning-value' : ''}>{match.stats[player.id].fouls}</td></tr>
          })}</tbody></table></div>
          {!active.length && <p className="desk-empty">No players on court.</p>}
          <div className="desk-reserves"><span>Available bench</span><div>{availableBench.map(player => <button key={player.id} onClick={() => onSelectPlayer(player.id)} title={`${player.name} · ${player.position} · ${Math.round(match.stats[player.id].condition)}% stamina`}>{player.name.split(' ').at(-1)}<small>{Math.round(match.stats[player.id].condition)}%</small></button>)}{!availableBench.length && <span>No eligible reserves</span>}</div></div>
        </section>

        <section className="desk-activity panel" aria-labelledby="desk-activity-heading">
          <div className="desk-panel-heading"><h2 id="desk-activity-heading"><Icon name="clock" size={16} />Recent activity</h2><span className="desk-section-note">Current match</span></div>
          {activity.length ? <ol>{activity.map(event => <li key={event.id}><time>{period(event.period)}<span>{clock(event.clockSeconds)}</span></time><p>{event.text}</p><span className="desk-activity-score">{event.score.home}–{event.score.away}</span></li>)}</ol> : <p className="desk-empty">No match actions yet. Review your lineup and instructions before tipoff.</p>}
        </section>
      </div>

      <div className="desk-side-column">
        <section className="desk-attention panel" aria-labelledby="desk-attention-heading">
          <div className="desk-panel-heading"><h2 id="desk-attention-heading">{complete ? 'Match review' : 'Attention'}</h2><span className="desk-count">{notices.length}</span></div>
          {notices.length ? <ul className="desk-notices">{notices.map(notice => <li key={notice.key} className={notice.urgent ? 'desk-notice-urgent' : ''}><div><strong className="desk-notice-title"><Icon name={notice.key === 'career' || notice.key === 'career-risk' ? 'shield' : notice.key === 'facilities-worn' ? 'building' : notice.key === 'derby' ? 'target' : notice.key === 'press' ? 'mail' : notice.key === 'board' ? 'shield' : notice.key === 'scouting' ? 'search' : ['contracts', 'offseason', 'negotiations', 'unpaid', 'wage-commitments'].includes(notice.key) ? 'wallet' : notice.key === 'timeout' ? 'clock' : 'people'} size={15} />{notice.title}</strong>{notice.urgent || ['injuries', 'fatigue', 'fouls', 'queued'].includes(notice.key) ? <p>{notice.detail}</p> : <details className="desk-notice-detail"><summary>Details</summary><p>{notice.detail}</p></details>}</div><button className="text-button" onClick={notice.open}>{notice.action}<Icon name="chevron" size={14} /></button></li>)}</ul> : <div className="desk-clear"><Icon name="check" size={18} /><div><strong>{complete ? 'Match complete' : 'No urgent decisions'}</strong><p>{complete ? 'The result and player statistics are ready to review.' : `${eligible.length} eligible players. Your current lineup is available.`}</p></div></div>}
        </section>

        {assistant && !complete && <section className="assistant-desk panel" aria-label="Assistant coach"><AssistantPortrait coach={assistant} size={36} /><div><strong>{assistant.name}</strong><span>Assistant coach</span></div><button className="text-button" onClick={onOpenAssistantAdvice}>Match advice<Icon name="chevron" size={14} /></button></section>}

        <section className="desk-instructions panel" aria-labelledby="desk-instructions-heading">
          <div className="desk-panel-heading"><h2 id="desk-instructions-heading"><Icon name="target" size={16} />Team instructions</h2><button className="text-button" onClick={onOpenCoaching}>Match coaching<Icon name="chevron" size={15} /></button></div>
          <TeamInstructions match={match} managedSide={managedSide} apply={apply} idPrefix="desk-" includeRotation />
        </section>
      </div>
    </div>
  </div>
}

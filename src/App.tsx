import { MatchdaySquad } from './ui/MatchdaySquad'
import { SquadStartingFive } from './ui/SquadStartingFive'
import { usesFullClubRoster } from './world/club-roster-policy'
import { canSelectMatchday } from './world/matchday-selection'
import { setMatchdaySelection } from './world/season'
import { PositionLabel } from './ui/PositionLabel'
import { GeneratedTag } from './ui/GeneratedTag'
import { enableBoard, enableBoardConsequences } from './world/board'
import { agreeSquadRole, answerPress, enableRelationships, getContractRequest, replyToContractRequest, talkToPlayer } from './world/relationships'
import type { ContractRequestReply } from './domain/relationships'
import { ContractRequestCard } from './ui/ContractRequestCard'
import { CONTRACT_REQUEST_TEXT } from './world/relationship-rules'
import { RelationshipsPanel } from './ui/RelationshipsPanel'
import { roleChangeMessage, SquadRoleCell } from './ui/SquadRoleCell'
import { simpleFacilityActions } from './ui/facility-actions'
import { enableBoardFunding, enableFacilities, enableFacilityMaintenance, endFacilityLease, leaseFacility, repayFacilityLoan, requestBoardFunding, setMaintenancePlan, startFacilityRepair, startFacilityUpgrade, takeFacilityLoan, cancelFacilityUpgrade, setFacilityDelegation } from './world/facilities'
import { PRESS_ANSWER_TEXT } from './world/press-policy'
import { enableRivalries } from './world/rivalries'
import { enableCareerMoves, managedClubLabel } from './world/career'
import type { SeasonEndOutlook } from './world/career-policy'
import type { SeasonEndDecision } from './domain/career'
import type { ContractOfferOptions } from './domain/employment'
import type { TransferPaymentPlan } from './domain/transfer-payments'
import { boardFundingRefusal } from './world/board-funding-policy'
import { acceptNamingOffer, acceptSponsorshipOffer, arenaNameFor, declineNamingOffer, declineSponsorshipOffer, enableCommercial, requestNamingImprovement, requestSponsorshipImprovement, setNamingDelegation, setSponsorshipDelegation, terminateSponsorship } from './world/commercial'
import { getDevelopmentSponsor } from './data/development-sponsors'
import { lazy, Suspense, useCallback, useMemo, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { MatchEvent, MatchState, Player, Side, Team } from './domain/types'
import type { ManagerProfile } from './domain/manager'
import { managerAge, setManagerProfile } from './world/manager'
import type { CareerSetup } from './ui/CareerStart'
import { createFixtureMatch, createMatch, isPlayerEligible, remainingTimeouts, simulateToEnd, simulateToQuarterEnd, stepMatch } from './engine/match'
import type { DataPack } from './world/data-pack'
import { loadLocalMatch, MAX_SAVE_BYTES, parseMatch, saveLocalMatch, serializeMatch } from './storage/match-storage'
import { Avatar } from './ui/Avatar'
import { Icon } from './ui/Icon'
import { MainNavigation, mainNavigation, PAGE_NAMES as pageNames, showsBudgetBar, unemployedNavigation, type Page } from './ui/navigation'
import { Court } from './viewer/Court'
import type { ScoreBug } from './viewer/Court'
import { buildAnimation, presentationDuration, rosterOf } from './viewer/choreography'
import { describePlay } from './viewer/play-text'
import { useCourtPlayback } from './viewer/useCourtPlayback'
import { MatchCoaching, RequiredDecision } from './ui/MatchCoaching'
import { MatchLineup } from './ui/MatchLineup'
import { MatchBoxScore } from './ui/MatchBoxScore'
import { MatchMvpCard } from './ui/MatchMvpCard'
import { getMatchMvp } from './world/performance-rating'
import { DEVELOPMENT_ASSISTANTS } from './data/development-assistants'
import { getClubAssistant } from './world/assistant-policy'
import { enableAssistant, hireAssistant, releaseAssistant, setAssistantRenewal } from './world/assistant'
import { AssistantAdvice } from './ui/AssistantAdvice'
import { automaticChoiceLabels } from './ui/automatic-choice'
import { ClubBudgetBar } from './ui/ClubBudgetBar'
import { getPlayerHealth } from './world/health'
import { EXTRA_ATTRIBUTE_LABELS, EXTRA_ATTRIBUTES } from './world/extra-attributes'
import { getMatchPlayerKnowledge, getPlayerKnowledge, getPotentialKnowledge } from './world/scouting-policy'
import { POTENTIAL_RATING_DESCRIPTION } from './world/potential'
import { PlayerRating } from './ui/PlayerRating'
import { getCareerPlayerAge } from './world/player-catalog'
import { enableLifecycle } from './world/lifecycle'
import { PlayerCareerStatus, PlayerAgeDevelopment } from './ui/PlayerLifecycle'
import { enableAcademy, setAcademyFocus, offerAcademyPromotion, cancelAcademyPromotion } from './world/academy'
import { enableYouthCompetition } from './world/youth-competition'
import { enableYouth, hireYouthCoach, releaseYouthCoach, setYouthCoachRenewal } from './world/youth'
import { StaminaMeter } from './ui/StaminaMeter'
import { ManagerDesk } from './ui/ManagerDesk'
import type { SeasonState } from './domain/season'
import { RestWeek } from './ui/RestWeek'
import { acceptJob, careerPresentationMatch, createSeason, getStandings, managedSide as seasonManagedSide, NEW_CAREER_SYSTEMS, resignManager, seasonLabel } from './world/season'
import { isUnemployed } from './world/career-rules'
import { careerDay, careerPointLabel, careerToday, gameDate, worldSeasonName } from './ui/career-text'
import { continueNotice, continueStatus, continueStepView, continueStop, remainingSteps, stoppedRun, type ContinueStop } from './ui/continue-run'
import { continueAction } from './world/continue-step'
import { ContinueControl, ContinueProgress, isContinueShortcut, type ContinueRunView } from './ui/ContinueControl'
import { closeWarning, SaveStatus, type SaveProgress } from './ui/SaveStatus'
import { MAX_SEASON_SAVE_BYTES } from './storage/season-storage'
import { createCheckpointQueue, readCareerSaves, readCurrentCareer, loadCareerCheckpoint } from './storage/career-saves'
import type { CareerSaveList } from './storage/career-saves'
import { createWorkerSeasonCodec } from './storage/season-codec'
import { readSeasonJournal, SeasonSaveConflictError } from './storage/season-indexed-db'
import type { CheckpointReason } from './storage/season-indexed-db'
import { CareerSaveHistory } from './ui/CareerSaveHistory'
import { isWorkerLoadFailure, PageError, PageErrorBoundary } from './ui/PageErrorBoundary'
import { SeasonEndChoice } from './ui/SeasonEndChoice'
const RealClubFriendly = lazy(() => import('./ui/RealClubFriendly').then(module => ({ default: module.RealClubFriendly })))
import { fetchBuiltInPack } from './world/built-in-pack'
import { SeasonCalendar } from './ui/SeasonCalendar'
import { EuropeWorkspace } from './ui/EuropeWorkspace'
import { playsEurope } from './world/europe'
import { SeasonWorkspace } from './ui/SeasonWorkspace'
import { TrainingWorkspace } from './ui/TrainingWorkspace'
import { SquadPerformance } from './ui/SquadPerformance'
import { enablePayroll } from './world/payroll'
import { enableEmployment, offerPlayerContract, setEmploymentDelegation } from './world/employment'
import { enableNegotiations } from './world/negotiations'
import { buyoutPlayerContract, decideClubTransfer, enableMarket, submitTransferOffer, withdrawMarketOffer } from './world/market'
import { contractForSeason } from './world/employment-policy'
import { decideInSeasonTransfer, enableInSeasonRecruitment, enableInSeasonTransfers, submitInSeasonOffer, submitInSeasonTransferOffer, withdrawInSeasonOffer } from './world/recruitment'
import { getMarketOffers, isMarketActive } from './world/market-policy'
import { assignScouting, cancelScoutingAssignment, enableScouting, setScoutingDelegation, setShortlisted } from './world/scouting'
import { enableFinance, setTicketPlan } from './world/finance'
import { enableScouts, hireScout, releaseScout, setScoutRenewal } from './world/scouts'
import { enableFitness, hireFitnessCoach, releaseFitnessCoach, setFitnessRenewal } from './world/fitness'
import { releaseStaff, replaceStaff, staffChangeNoticeAfter } from './world/staff-roster'
import { enablePhysio, hirePhysio, releasePhysio, setPhysioRenewal } from './world/physio'
import { enableCoaching, hireCoach, releaseCoach, setCoachAssignment, setCoachRenewal } from './world/coaching'
import { enableTraining, setTrainingPlan } from './world/training'
import type { TrainingPlan } from './domain/training'
import { PlayerHealthSummary, SeasonMedicalReport } from './ui/SeasonMedicalReport'
import type { SeasonReply } from './world/season.worker'
import './ui/season-progress.css'
import { seasonRounds, worldOf } from './world/career-world'
import { seasonLeagues } from './world/divisions'
import { ASSISTANT_DIRECTORY } from './data/staff-directory'

const MedicalWorkspace = lazy(() => import('./ui/MedicalWorkspace').then(module => ({ default: module.MedicalWorkspace })))
const AcademyWorkspace = lazy(() => import('./ui/AcademyWorkspace').then(module => ({ default: module.AcademyWorkspace })))
const StaffWorkspace = lazy(() => import('./ui/StaffWorkspace').then(module => ({ default: module.StaffWorkspace })))
const BoardWorkspace = lazy(() => import('./ui/BoardPanel').then(module => ({ default: module.BoardWorkspace })))
const InboxWorkspace = lazy(() => import('./ui/InboxWorkspace').then(module => ({ default: module.InboxWorkspace })))
const ClubWorkspace = lazy(() => import('./ui/ClubWorkspace').then(module => ({ default: module.ClubWorkspace })))
const PayrollWorkspace = lazy(() => import('./ui/PayrollWorkspace').then(module => ({ default: module.PayrollWorkspace })))
const TransfersWorkspace = lazy(() => import('./ui/TransfersWorkspace').then(module => ({ default: module.TransfersWorkspace })))
const SquadContracts = lazy(() => import('./ui/SquadContracts').then(module => ({ default: module.SquadContracts })))
const ScoutingWorkspace = lazy(() => import('./ui/ScoutingWorkspace').then(module => ({ default: module.ScoutingWorkspace })))
const CareerStart = lazy(() => import('./ui/CareerStart').then(module => ({ default: module.CareerStart })))
const UnemployedDesk = lazy(() => import('./ui/UnemployedDesk').then(module => ({ default: module.UnemployedDesk })))

type GameSession = { kind: 'exhibition'; match: MatchState } | { kind: 'season'; season: SeasonState }
type Notice = { message: string; error?: boolean }
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const periodLabel = (period: number) => period <= 4 ? `Q${period}` : `OT${period - 4}`
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
/** Save validation and conversion run in a background worker (started on first use) so saving never freezes play. */
const saveCodec = createWorkerSeasonCodec()

function ClubMark({ name, color, large = false }: { name: string; color: string; large?: boolean }) {
  return <div className={`club-mark ${large ? 'club-mark-large' : ''}`} style={{ color }} aria-hidden="true"><Icon name="ball" size={large ? 30 : 21} /><span>{name.slice(0, 3).toUpperCase()}</span></div>
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className="stat"><span className="eyebrow">{label}</span><strong>{value}</strong>{detail && <span className="muted">{detail}</span>}</div>
}

export default function App() {
  const [entryView, setEntryView] = useState<'menu' | 'new-career' | 'profile' | null>('menu')
  const [hasSession, setHasSession] = useState(false)
  const [entryError, setEntryError] = useState<string | null>(null)
  const [session, setSession] = useState<GameSession>(() => ({ kind: 'exhibition', match: createMatch(42) }))
  const sessionRef = useRef(session)
  const season = session.kind === 'season' ? session.season : null
  const restWeek = !!season && !season.activeMatch
  // One label for a day without the manager's match (or the offseason) on the top bar, page heading and desk panel.
  const deskDay = season && (restWeek || season.status === 'complete') ? careerDay(season) : null
  const match = useMemo(() => session.kind === 'season' ? careerPresentationMatch(session.season) : session.match, [session])
  const matchRef = useRef(match)
  const managedSide = season ? restWeek ? match.home.id === season.managedClubId ? 'home' : 'away' : seasonManagedSide(season) : 'home'
  // After a move at a season end, the final match still belongs to the former club; identity and squad follow the new one.
  // Format 69: without a club (career-3), the presentation match's side stands in; those screens are not shown then.
  const managedTeam = season && match[managedSide].id !== season.managedClubId ? season.clubs.find(club => club.id === season.managedClubId) ?? match[managedSide] : match[managedSide]
  // Format 64: the home arena's name this season (a naming partner's name while its agreement runs).
  const matchVenue = season ? arenaNameFor(season, match.home.id) : null
  const [advancing, setAdvancing] = useState(false)
  // The one Continue (owner request, 16 November 2026): the run in progress, and the manager's request to stop it.
  const [continueRun, setContinueRun] = useState<ContinueRunView | null>(null)
  const continueStopRequested = useRef(false)
  const [creatingCareer, setCreatingCareer] = useState(false)
  // The board's season-end decision and job offers, shown before the final matchday is committed.
  const [seasonEnd, setSeasonEnd] = useState<SeasonEndOutlook | null>(null)
  // A private real-data pack loaded from this computer for friendlies; it stays in memory only.
  const [realPack, setRealPack] = useState<DataPack | null>(null)
  // Owner decision (15 November 2026): real clubs are the default; the game reads the real-club data shipped with it.
  const [builtInPack, setBuiltInPack] = useState<{ status: 'idle' | 'loading' | 'loaded' | 'missing' } | { status: 'failed'; message: string }>({ status: 'idle' })
  const [friendlyOpen, setFriendlyOpen] = useState(false)
  const [leavingSeason, setLeavingSeason] = useState(false)
  const seasonWorker = useRef<Worker | null>(null)
  const seasonJob = useRef(0)
  const replacementRequest = useRef(0)
  const [presentationBase, setPresentationBase] = useState<MatchState | null>(null)
  const [page, setPage] = useState<Page>('home')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null)
  const [textOnly, setTextOnly] = useState(false)
  const [visible, setVisible] = useState(!document.hidden)
  const reducedMotion = motionOverride ?? systemReduced
  // Each play is shown for its own animation length (presentation only; the match clock is unrelated).
  const playDuration = useCallback((event: MatchEvent) => presentationDuration(event, rosterOf(matchRef.current)), [])
  const playback = useCourtPlayback(playing, speed, reducedMotion || textOnly, playDuration)
  const { present, reset: resetPlayback, settle: settlePlayback } = playback
  const [seedInput, setSeedInput] = useState('42')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [saving, setSaving] = useState(false)
  const persistenceBusy = useRef(false)
  const savedRevision = useRef<number | null>(null)
  const revisionRead = useRef<Promise<number> | null>(null)
  // Checkpoints get the full career check in the save worker while play goes on. The top bar names the career point of
  // the last save written and of the newest one waiting (browser play-through, 16 November 2026: from about matchday 12
  // a check takes longer than a week of play, so "Saving..." alone never cleared).
  const [savingInBackground, setSavingInBackground] = useState(false)
  const [lastSave, setLastSave] = useState<SaveProgress['saved']>(null)
  const [pendingSave, setPendingSave] = useState<string | null>(null)
  const [checkpoints] = useState(() => createCheckpointQueue({ codec: saveCodec, revision: ensureSaveRevision, written: (checkpoint, state) => { savedRevision.current = checkpoint.revision; setLastSave({ label: careerPointLabel(state), at: Date.now() }) }, busy: setSavingInBackground }))
  const saveProgress: SaveProgress = { saving: savingInBackground, pending: pendingSave, saved: lastSave }
  // A season worker that could not be downloaded (a new version went live while the game was open): only a reload helps.
  const [workerFailure, setWorkerFailure] = useState<{ title: string; failed: string; error: unknown } | null>(null)
  const [checkpointIssue, setCheckpointIssue] = useState<string | null>(null)
  const [saveHistoryOpen, setSaveHistoryOpen] = useState(false)
  const [saveHistory, setSaveHistory] = useState<CareerSaveList | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const historyRequest = useRef(0)
  const [boxSide, setBoxSide] = useState<Side>('home')
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [rosterFilter, setRosterFilter] = useState('all')
  const [rosterQuery, setRosterQuery] = useState('')
  const [relationshipPlayer, setRelationshipPlayer] = useState<string | null>(null)
  const [squadView, setSquadView] = useState<'selection' | 'performance' | 'payroll' | 'relationships' | 'contracts'>('selection')
  const [performancePlayer, setPerformancePlayer] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<'coaches' | 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth'>('coaches')
  const [scoutingPlayer, setScoutingPlayer] = useState<string | null>(null)
  const [transferPlayer, setTransferPlayer] = useState<string | null>(null)
  const [contractsPlayer, setContractsPlayer] = useState<string | null>(null)
  const [navigationTarget, setNavigationTarget] = useState<{ selector: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const setupRef = useRef<HTMLDetailsElement>(null)

  const replaceSession = useCallback((next: GameSession) => {
    replacementRequest.current += 1
    sessionRef.current = next
    matchRef.current = next.kind === 'season' ? careerPresentationMatch(next.season) : next.match
    setSession(next)
  }, [])
  const replaceMatch = useCallback((next: MatchState) => {
    const current = sessionRef.current
    if (current.kind === 'season' && !current.season.activeMatch) return
    replaceSession(current.kind === 'season' ? { kind: 'season', season: { ...current.season, activeMatch: next } } : { kind: 'exhibition', match: next })
  }, [replaceSession])
  const apply = useCallback((action: (current: MatchState) => MatchState, animate = false, progression = false) => {
    if (seasonWorker.current || persistenceBusy.current) return
    try {
      if (sessionRef.current.kind === 'season' && !sessionRef.current.season.activeMatch) return
      const before = matchRef.current
      const next = action(before)
      const newEvents = next.events.slice(before.events.length)
      const critical = next.requiredSubstitutions.length > 0
      if (progression && !animate || critical) settlePlayback()
      if (newEvents.some(event => event.scene)) setPresentationBase(animate && !critical ? before : null)
      present(newEvents, before.score, animate && !critical)
      replaceMatch(next)
      if (critical || next.status === 'finished' && (!animate || !newEvents.some(event => event.scene))) setPlaying(false)
    } catch (error) { setPlaying(false); setNotice({ message: messageOf(error), error: true }) }
  }, [replaceMatch, present, settlePlayback])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motion = () => setSystemReduced(media.matches)
    const visibility = () => setVisible(!document.hidden)
    media.addEventListener('change', motion)
    document.addEventListener('visibilitychange', visibility)
    return () => { media.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility) }
  }, [])

  useEffect(() => {
    if (!playing || !visible || playback.busy || match.status === 'finished' || match.requiredSubstitutions.length) return
    const timer = window.setTimeout(() => apply(stepMatch, true, true), 220 / speed)
    return () => window.clearTimeout(timer)
  }, [playing, speed, visible, playback.busy, match.status, match.requiredSubstitutions.length, match.events.length, apply])

  useEffect(() => {
    if (match.status === 'finished' && !playback.busy) setPlaying(false)
  }, [match.status, playback.busy])

  useEffect(() => {
    if (!notice || notice.error) return
    const timer = window.setTimeout(() => setNotice(null), 5500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const latestEvent = match.events.at(-1)
  const presentedEvent = playback.event ?? [...match.events].reverse().find(event => event.scene) ?? match.events.at(-1)
  const presentedProgress = playback.event ? playback.progress : 1
  const captionEvent = playback.busy ? presentedEvent : latestEvent ?? presentedEvent
  const visibleEvents = playback.busy && presentedEvent ? match.events.filter(event => event.id < presentedEvent.id || presentedProgress >= 1 && event.id === presentedEvent.id) : match.events
  const complete = match.status === 'finished'
  const needsReplacement = match.requiredSubstitutions.length > 0
  const displayScore = match.result?.kind === 'default' ? match.result.officialScore : playback.busy && playback.visibleScore ? playback.visibleScore : match.score
  const resolvedStats = playback.busy && presentationBase ? presentationBase : match
  const sceneActors = playback.busy ? presentedEvent?.scene?.start : undefined
  const statsSnapshot = sceneActors ? {
    ...resolvedStats,
    lineups: {
      home: sceneActors.filter(actor => match.home.players.some(player => player.id === actor.playerId)).map(actor => actor.playerId),
      away: sceneActors.filter(actor => match.away.players.some(player => player.id === actor.playerId)).map(actor => actor.playerId),
    },
  } : resolvedStats
  const matchRoster = useMemo(() => rosterOf(match), [match.home.players, match.away.players]) // eslint-disable-line react-hooks/exhaustive-deps
  const bugEvent = playback.busy ? presentedEvent : undefined
  const bugTeam = (side: Side) => ({ name: match[side].shortName, color: match[side].color, score: displayScore[side], fouls: resolvedStats.teamFouls?.[side] ?? 0, timeouts: resolvedStats.timeoutUsage ? remainingTimeouts(resolvedStats, side) : 0 })
  const scoreBug: ScoreBug = { home: bugTeam('home'), away: bugTeam('away'), period: periodLabel(bugEvent?.period ?? match.period), clock: clock(bugEvent?.clockSeconds ?? match.clockSeconds) }
  const captionIndex = captionEvent ? match.events.findIndex(event => event.id === captionEvent.id) : -1
  const playLine = captionEvent ? describePlay(captionEvent, matchRoster, captionIndex > 0 ? match.events[captionIndex - 1] : undefined) : 'Ready for tipoff.'
  const playKind = captionEvent?.scene ? buildAnimation(captionEvent, matchRoster)?.kind : undefined
  const inFlight = playback.busy && presentedProgress < 1 && (presentedEvent?.shot || presentedEvent?.scene?.kind === 'free-throw')
  const shooterName = presentedEvent?.playerId ? matchRoster.get(presentedEvent.playerId)?.name.split(' ').at(-1) : undefined

  const assistantContract = season ? getClubAssistant(season) : null
  const assistantCoach = assistantContract ? ASSISTANT_DIRECTORY.find(coach => coach.id === assistantContract.assistantId) : undefined

  const squadTeam = season?.clubs.find(club => club.id === season.managedClubId) ?? managedTeam
  const fullRoster = !!season && usesFullClubRoster(season)
  const matchdayIds = match[managedSide].players.map(player => player.id)
  const selectedSquadPlayer = squadTeam.players.find(player => player.id === selectedPlayer) ?? squadTeam.players[0]
  const chosenPlayer = selectedSquadPlayer && season ? { ...selectedSquadPlayer, attributes: getPlayerKnowledge(season, selectedSquadPlayer.id).attributes ?? selectedSquadPlayer.attributes } : selectedSquadPlayer

  const offseason = season?.status === 'complete'
  const squadEligible = (id: string) => offseason || !match.stats[id] ? !!season && !getPlayerHealth(season, id) : isPlayerEligible(match, id)
  const squadCondition = (id: string) => offseason ? season!.conditions[id]! : match.stats[id]?.condition ?? season?.conditions[id] ?? 100
  const eligiblePlayers = squadTeam.players.filter(player => squadEligible(player.id))
  const averageCondition = Math.round(squadTeam.players.reduce((sum, player) => sum + squadCondition(player.id), 0) / squadTeam.players.length)
  const rosterPlayers = squadTeam.players.filter(player => {
    const active = match.lineups[managedSide].includes(player.id)
    const included = rosterFilter === 'all' || rosterFilter === 'court' && active || rosterFilter === 'bench' && !active && !!match.stats[player.id] || rosterFilter === 'unavailable' && !squadEligible(player.id)
    return included && player.name.toLowerCase().includes(rosterQuery.trim().toLowerCase())
  })

  function navigate(nextPage: Page, selector = '#main') {
    setPlaying(false)
    settlePlayback()
    if (nextPage === 'squad' && selector === '.player-profile') setSquadView('selection')
    setPage(nextPage)
    setNavigationTarget({ selector })
    if (setupRef.current) setupRef.current.open = false
  }
  function openPayroll() {
    setSquadView('payroll')
    navigate('squad')
  }
  function openScouting(playerId: string | null = null) {
    setScoutingPlayer(playerId)
    navigate('scouting', playerId ? '#scouting-player-report' : '#main')
  }
  function openContracts(playerId: string | null = null) {
    setContractsPlayer(playerId)
    setSquadView('contracts')
    navigate('squad', '#squad-contracts')
  }
  function openTransfers(playerId: string) {
    const current = sessionRef.current
    if (current.kind === 'season' && current.season.clubs.find(club => club.id === current.season.managedClubId)?.players.some(player => player.id === playerId)) { openContracts(playerId); return }
    setTransferPlayer(playerId)
    navigate('transfers', '#transfer-player-review')
  }
  /** Contract actions shared by Transfers and Squad > Contracts (owner, 16 November 2026: own contracts moved to Squad). */
  const enableContracts = () => updateCareer(enableEmployment, 'Player contracts enabled. Review expiring agreements and next season’s squad.', true)
  const delegateContracts = (delegated: boolean) => updateCareer(state => setEmploymentDelegation(state, delegated), delegated ? !!season && isMarketActive(season) ? 'Assistant recruitment enabled. New offers await player replies on the recruitment calendar.' : 'Assistant recruitment enabled. Affordable renewals and signings have been reviewed for next season.' : 'You now manage renewals and recruitment. Signed contracts remain binding.', true)
  const offerContract = (playerId: string, seasonWage: number, seasons: number, transferFee?: number, paymentPlan?: TransferPaymentPlan, options?: ContractOfferOptions) => updateCareer(state => transferFee === undefined ? offerPlayerContract(state, playerId, seasonWage, seasons, options) : submitTransferOffer(state, playerId, seasonWage, seasons, transferFee, state.managedClubId, paymentPlan, options), next => isMarketActive(next) && getMarketOffers(next, next.managedClubId, true).some(offer => offer.playerId === playerId) ? transferFee === undefined ? 'Offer sent. Wages budget and a squad place are reserved until the player decides.' : options?.transferMode === 'release-clause' ? 'Release clause triggered. The full fee and wages budget are reserved until the player decides.' : 'Transfer offer sent. The fee, wages budget and a squad place are reserved. The selling club replies first.' : contractForSeason(next.employment, playerId, next.seasonNumber + 1)?.clubId === next.managedClubId ? 'Contract signed for next season. Current registrations stay in place until opening day.' : 'Player response recorded. Review the reply before submitting revised terms.', true)
  const withdrawContractOffer = (offerId: string) => updateCareer(state => withdrawMarketOffer(state, offerId), 'Offer withdrawn. Reserved wages budget and squad place released.', true)
  const buyoutContract = (playerId: string) => updateCareer(state => buyoutPlayerContract(state, playerId), 'Contract bought out. Compensation paid and future wages budget released. Find a replacement in Transfers.', true)
  /** Format 66: answer a contract request; opening talks continues to the player's contract offer. */
  function replyToContract(playerId: string, reply: ContractRequestReply) {
    updateCareer(state => replyToContractRequest(state, playerId, reply), reply === 'talks' ? `Renewal talks opened. Make him an offer within ${CONTRACT_REQUEST_TEXT.talksWindow}.` : reply === 'promise' ? 'Talks promised at season end. Make him an offer before next season starts.' : 'Contract request declined. Morale and trust fell; he will ask more to re-sign.', true)
    if (reply === 'talks') openTransfers(playerId)
  }
  function updateShortlist(playerId: string, shortlisted: boolean) {
    updateCareer(state => setShortlisted(state, playerId, shortlisted), shortlisted ? 'Player added to your shortlist.' : 'Player removed from your shortlist.', true)
  }
  useEffect(() => {
    if (!navigationTarget) return
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(navigationTarget.selector)
      target?.focus({ preventScroll: true })
      if (navigationTarget.selector === '#main') window.scrollTo({ top: 0 })
      else target?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  }, [page, navigationTarget])

  // Read once per tab. Browsing history must never silently accept a newer writer.
  function ensureSaveRevision(): Promise<number> {
    if (savedRevision.current !== null) return Promise.resolve(savedRevision.current)
    if (!revisionRead.current) revisionRead.current = readSeasonJournal().then(journal => {
      savedRevision.current ??= journal.revision
      return savedRevision.current
    }).finally(() => { revisionRead.current = null })
    return revisionRead.current
  }
  useEffect(() => { void ensureSaveRevision().catch(() => { /* A save/load action reports unavailable storage. */ }) }, [])

  /** Play continues while a checkpoint is checked; `wait` locks the game until it is written (when leaving the career). */
  async function persistSeason(state: SeasonState, reason: Exclude<CheckpointReason, 'legacy'>, wait = false): Promise<boolean> {
    if (persistenceBusy.current) return false
    if (wait) { persistenceBusy.current = true; setSaving(true); setPlaying(false); settlePlayback() }
    // The queue writes the newest state next, so the save in progress is named after it.
    setPendingSave(careerPointLabel(state))
    try {
      await checkpoints.save(state, reason)
      setCheckpointIssue(null)
      return true
    } catch (error) {
      const detail = messageOf(error)
      setCheckpointIssue(error instanceof SeasonSaveConflictError ? detail : `${detail} Your game is still open. Save season to retry, or Export to keep a file backup.`)
      setNotice({ message: reason === 'manual' ? 'Season was not saved. Your current game is still open.' : 'Automatic save failed. Your current game is still open.', error: true })
      return false
    } finally { if (wait) { persistenceBusy.current = false; setSaving(false) } }
  }
  // Owner feedback (16 November 2026): closing or reloading during "Saving..." returned the career to the previous week.
  // Browsers show their own fixed leave text; the save status in the top bar says how far back the career would return.
  const leaveWarning = closeWarning(saveProgress)
  useEffect(() => {
    if (!saving && !savingInBackground) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = leaveWarning }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saving, savingInBackground, leaveWarning])
  /** A page that could not be opened offers a reload; a career is saved first so that nothing is lost. */
  async function saveAndReload() {
    const current = sessionRef.current
    if (current.kind === 'season' && !await persistSeason(current.season, 'manual')) return
    window.location.reload()
  }
  async function refreshSaveHistory() {
    const request = ++historyRequest.current
    setHistoryLoading(true); setHistoryError(null)
    try {
      await checkpoints.idle()
      const history = await readCareerSaves(saveCodec)
      if (request !== historyRequest.current) return
      setSaveHistory(history); setHistoryError(history.currentError)
    } catch (error) { if (request === historyRequest.current) setHistoryError(messageOf(error)) }
    finally { if (request === historyRequest.current) setHistoryLoading(false) }
  }
  // The menu shows only the current career; checkpoints are read when Save history opens.
  async function refreshSavedCareer() {
    const request = ++historyRequest.current
    setHistoryLoading(true); setHistoryError(null)
    try {
      const saved = await readCurrentCareer(saveCodec)
      if (request !== historyRequest.current) return
      setSaveHistory({ ...saved, entries: [] }); setHistoryError(saved.currentError)
    } catch (error) { if (request === historyRequest.current) setHistoryError(messageOf(error)) }
    finally { if (request === historyRequest.current) setHistoryLoading(false) }
  }
  useEffect(() => { if (entryView === 'menu') void refreshSavedCareer() }, [entryView])
  function openSaveHistory() {
    if (seasonWorker.current || persistenceBusy.current) return
    replacementRequest.current += 1
    setPlaying(false); settlePlayback(); setSaveHistoryOpen(true)
    void refreshSaveHistory()
  }
  function closeSaveHistory() {
    if (persistenceBusy.current) return
    historyRequest.current += 1; setSaveHistoryOpen(false); setHistoryLoading(false)
  }
  async function restoreCheckpoint(revision: number) {
    if (seasonWorker.current || persistenceBusy.current) return
    const request = ++replacementRequest.current
    persistenceBusy.current = true; setSaving(true); setPlaying(false); settlePlayback()
    try {
      await checkpoints.idle()
      const restored = await loadCareerCheckpoint(revision, saveCodec)
      if (request !== replacementRequest.current) return
      savedRevision.current = restored.revision
      install({ kind: 'season', season: restored.state })
      // The newest save is still the current one until the next save writes this checkpoint again.
      setLastSave(null); setPendingSave(null)
      historyRequest.current += 1; setSaveHistoryOpen(false); setCheckpointIssue(null)
      navigate('home'); setNotice({ message: 'Checkpoint restored. Your next save will create a new checkpoint.' })
    } catch (error) { if (request === replacementRequest.current) setHistoryError(messageOf(error)) }
    finally { persistenceBusy.current = false; setSaving(false) }
  }
  function updateTraining(plan?: TrainingPlan) {
    if (seasonWorker.current || persistenceBusy.current) return
    const current = sessionRef.current
    if (current.kind !== 'season') return
    try {
      const next = plan ? setTrainingPlan(current.season, plan) : enableTraining(current.season)
      setPlaying(false); settlePlayback()
      replaceSession({ kind: 'season', season: next })
      if (!plan) setNotice({ message: 'Training enabled. Your plans will apply between matchdays.' })
    } catch (error) { setNotice({ message: messageOf(error), error: true }) }
  }
  function updateCareer(action: (state: SeasonState) => SeasonState, message?: string | ((next: SeasonState) => string), checkpoint = false) {
    if (seasonWorker.current || persistenceBusy.current) return
    const current = sessionRef.current
    if (current.kind !== 'season') return
    try {
      const next = action(current.season)
      setPlaying(false); settlePlayback()
      replaceSession({ kind: 'season', season: next })
      if (message) setNotice({ message: typeof message === 'function' ? message(next) : message })
      if (checkpoint) void persistSeason(next, 'manual')
    } catch (error) { setNotice({ message: messageOf(error), error: true }) }
  }
  function install(next: GameSession) {
    seasonJob.current += 1; seasonWorker.current?.terminate(); seasonWorker.current = null; setAdvancing(false)
    setPlaying(false); resetPlayback(); setPresentationBase(null); setCheckpointIssue(null); replaceSession(next)
    if (next.kind === 'exhibition') setPage(current => current === 'training' || current === 'staff' || current === 'club' || current === 'board' || current === 'transfers' || current === 'scouting' || current === 'inbox' ? 'home' : current)
    const active = next.kind === 'season' ? careerPresentationMatch(next.season) : next.match
    setSeedInput(String(active.seed)); setBoxSide(next.kind === 'season' ? active.home.id === next.season.managedClubId ? 'home' : 'away' : 'home')
    setSelectedPlayer(null); setRosterFilter('all'); setRosterQuery(''); setSquadView('selection'); setPerformancePlayer(null); setRelationshipPlayer(null)
    setScoutingPlayer(null); setTransferPlayer(null)
    setHasSession(true); setEntryView(null); setEntryError(null)
  }
  async function save() {
    if (seasonWorker.current || persistenceBusy.current) return
    replacementRequest.current += 1
    const current = sessionRef.current
    if (current.kind === 'season') {
      if (await persistSeason(current.season, 'manual')) setNotice({ message: 'Season saved on this device.' })
      return
    }
    persistenceBusy.current = true; setSaving(true); setPlaying(false); settlePlayback()
    try { await saveLocalMatch(current.match); setNotice({ message: 'Match saved on this device.' }) }
    catch (error) { setNotice({ message: messageOf(error), error: true }) }
    finally { persistenceBusy.current = false; setSaving(false) }
  }
  async function loadSeason() {
    if (seasonWorker.current || persistenceBusy.current) return
    const request = ++replacementRequest.current
    persistenceBusy.current = true; setSaving(true); setPlaying(false); settlePlayback()
    try {
      await checkpoints.idle()
      const saved = await readCurrentCareer(saveCodec, saveHistory?.current ? { revision: saveHistory.revision, state: saveHistory.current } : undefined)
      if (request !== replacementRequest.current) return
      if (saved.currentError) {
        // A damaged current save opens recovery history, which then lists the checkpoints.
        setSaveHistoryOpen(true); void refreshSaveHistory()
        return
      }
      if (!saved.current) { setNotice({ message: 'No saved season yet. Start a season to create one.' }); return }
      savedRevision.current = saved.revision
      install({ kind: 'season', season: saved.current }); setCheckpointIssue(null)
      setLastSave({ label: careerPointLabel(saved.current), at: null }); setPendingSave(null)
      setNotice({ message: 'Saved season restored.' }); navigate('home')
    } catch (error) { if (request !== replacementRequest.current) return; setNotice({ message: messageOf(error), error: true }) }
    finally { persistenceBusy.current = false; setSaving(false) }
  }
  async function load() {
    if (seasonWorker.current || persistenceBusy.current) return
    if (sessionRef.current.kind === 'season') return loadSeason()
    const request = ++replacementRequest.current
    setPlaying(false)
    try { const saved = await loadLocalMatch(); if (request !== replacementRequest.current) return; if (!saved) { setNotice({ message: 'No saved match yet. Save this match to create one.' }); return }; install({ kind: 'exhibition', match: saved }); setNotice({ message: saved.engineVersion === 'rules-2' ? 'Saved match restored with its original simulation.' : 'Saved match restored.' }) }
    catch (error) { if (request !== replacementRequest.current) return; setNotice({ message: messageOf(error), error: true }) }
  }
  async function exportSave() {
    if (seasonWorker.current || persistenceBusy.current) return
    const current = sessionRef.current
    if (current.kind === 'season') { persistenceBusy.current = true; setSaving(true) }
    try {
      const text = current.kind === 'season' ? await saveCodec.serialize(current.season) : serializeMatch(current.match)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = current.kind === 'season' ? `courtside-season-${current.season.seed}-year-${current.season.seasonNumber}.json` : `courtside-match-${current.match.seed}.json`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice({ message: current.kind === 'season' ? 'Season exported. Keep the file to resume on another device.' : 'Match exported. Keep the file to resume on another device.' })
    } catch (error) { setNotice({ message: messageOf(error), error: true }) }
    finally { if (current.kind === 'season') { persistenceBusy.current = false; setSaving(false) } }
  }
  async function importSave(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || seasonWorker.current || persistenceBusy.current) return
    const request = ++replacementRequest.current
    setPlaying(false)
    try {
      if (file.size > MAX_SEASON_SAVE_BYTES) throw new Error(`This file is too large. Choose a save under ${MAX_SEASON_SAVE_BYTES / 1024 / 1024} MB.`)
      const text = await file.text()
      if (request !== replacementRequest.current) return
      if (JSON.parse(text)?.format === 'basketball-manager-season') {
        const season = await saveCodec.parse(text)
        if (request !== replacementRequest.current) return
        install({ kind: 'season', season }); navigate('home'); setNotice({ message: 'Season imported successfully. Save season to keep it on this device.' })
      } else {
        if (file.size > MAX_SAVE_BYTES) throw new Error(`Choose a match save under ${MAX_SAVE_BYTES / 1024 / 1024} MB.`)
        const imported = parseMatch(text); install({ kind: 'exhibition', match: imported })
        setNotice({ message: imported.engineVersion === 'rules-2' ? 'Match imported successfully. Its original simulation is preserved.' : 'Match imported successfully.' })
      }
    } catch (error) { if (request !== replacementRequest.current) return; setNotice({ message: `Could not import save: ${messageOf(error)}`, error: true }) }
  }
  async function restart() {
    if (seasonWorker.current || persistenceBusy.current) return
    const requestedSeed = entryView === 'menu' ? '42' : seedInput
    const seed = Number(requestedSeed)
    if (requestedSeed.trim() === '' || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) { setNotice({ message: 'Choose a whole-number seed between 0 and 4,294,967,295.', error: true }); return }
    const current = sessionRef.current
    const request = ++replacementRequest.current
    setPlaying(false); settlePlayback()
    if (current.kind === 'season') {
      setLeavingSeason(true)
      const saved = await persistSeason(current.season, 'manual', true)
      setLeavingSeason(false)
      if (!saved) return
      if (request !== replacementRequest.current) return
    }
    install({ kind: 'exhibition', match: createMatch(seed) }); if (entryView) navigate('match'); setNotice({ message: current.kind === 'season' ? 'Season saved. New exhibition ready.' : 'New exhibition ready.' }); if (setupRef.current) setupRef.current.open = false
  }
  /** A friendly between two real clubs from the loaded pack, played on the normal match screen with the chosen replay code. */
  function startFriendly(home: Team, away: Team, pack: DataPack) {
    if (seasonWorker.current || persistenceBusy.current || sessionRef.current.kind === 'season') return
    const seed = Number(seedInput)
    if (seedInput.trim() === '' || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) { setNotice({ message: 'Choose a whole-number replay code between 0 and 4,294,967,295.', error: true }); return }
    try {
      replacementRequest.current += 1
      setPlaying(false); settlePlayback()
      install({ kind: 'exhibition', match: createFixtureMatch(seed, home, away) })
      setFriendlyOpen(false); if (setupRef.current) setupRef.current.open = false
      navigate('match'); setNotice({ message: `Friendly ready: ${home.name} vs ${away.name} (data pack ${pack.version}).` })
    } catch (error) { setNotice({ message: messageOf(error), error: true }) }
  }
  function startSeason({ seed, world, clubId, injuryMode, manager }: CareerSetup) {
    if (seasonWorker.current || persistenceBusy.current || creatingCareer) return
    // Careers use real clubs only (owner, 13 November 2026): the league comes from the loaded data pack.
    const options = { seed, world, managedClubId: clubId, injuryMode, manager, ...NEW_CAREER_SYSTEMS }
    const finished = (created: SeasonState) => {
      setCreatingCareer(false)
      install({ kind: 'season', season: created }); navigate('home')
      setNotice({ message: 'Season ready. Review your lineup before the opening match.' })
      setLastSave(null)
      void persistSeason(created, 'new-game')
    }
    const failed = (error: unknown) => { setCreatingCareer(false); setEntryError(messageOf(error)) }
    setEntryError(null); setCreatingCareer(true)
    // Built in the background worker (owner request, 15 November 2026): large worlds take a while, and the setup
    // screen shows that progress instead of freezing. Without workers, it is built here after the screen updates.
    if (typeof Worker === 'undefined') { setTimeout(() => { try { finished(createSeason(options)) } catch (error) { failed(error) } }, 50); return }
    const worker = new Worker(new URL('./world/season.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<SeasonReply>) => { worker.terminate(); if ('error' in data) failed(new Error(data.error)); else if ('state' in data) finished(data.state) }
    worker.onerror = () => { worker.terminate(); try { finished(createSeason(options)) } catch (error) { failed(error) } }
    worker.postMessage({ requestId: 1, action: 'create', options })
  }
  useEffect(() => {
    if (realPack || builtInPack.status !== 'idle' || entryView !== 'new-career' && !friendlyOpen) return
    setBuiltInPack({ status: 'loading' })
    void fetchBuiltInPack().then(result => {
      if (result.status === 'loaded') { setRealPack(current => current ?? result.pack); setBuiltInPack({ status: 'loaded' }) }
      else setBuiltInPack(result.status === 'missing' ? { status: 'missing' } : { status: 'failed', message: result.message })
    })
  }, [realPack, builtInPack.status, entryView, friendlyOpen])
  const packSource = realPack ? undefined : builtInPack.status === 'loading' ? { status: 'loading' as const } : builtInPack.status === 'failed' ? { status: 'failed' as const, message: builtInPack.message, retry: () => setBuiltInPack({ status: 'idle' }) } : undefined
  async function openEntry(view: 'menu' | 'new-career') {
    if (seasonWorker.current || persistenceBusy.current) return
    const request = ++replacementRequest.current
    setPlaying(false); settlePlayback(); setEntryError(null); setNotice(null)
    const current = sessionRef.current
    if (hasSession && current.kind === 'season' && entryView === null) {
      if (!await persistSeason(current.season, 'manual', true) || request !== replacementRequest.current) return
    }
    setEntryView(view)
  }
  function resumeSession() {
    if (seasonWorker.current || persistenceBusy.current || !hasSession) return
    replacementRequest.current += 1
    setEntryView(null); setEntryError(null); navigate(page)
  }
  function openManagerProfile() {
    if (seasonWorker.current || persistenceBusy.current || sessionRef.current.kind !== 'season') return
    replacementRequest.current += 1
    setPlaying(false); settlePlayback(); setEntryError(null); setEntryView('profile')
  }
  async function saveManagerProfile(profile: ManagerProfile) {
    if (seasonWorker.current || persistenceBusy.current) return
    const current = sessionRef.current
    if (current.kind !== 'season') return
    try {
      const next = setManagerProfile(current.season, profile)
      replaceSession({ kind: 'season', season: next })
      setEntryView(null); setEntryError(null); navigate(page)
      if (await persistSeason(next, 'manual')) setNotice({ message: 'Manager profile saved.' })
    } catch (error) { setEntryError(messageOf(error)) }
  }
  function cancelEntry() {
    if (persistenceBusy.current) return
    replacementRequest.current += 1
    setEntryError(null)
    if (entryView === 'profile') { setEntryView(null); navigate(page) }
    else setEntryView('menu')
  }
  /**
   * Format 63: resign and take over the chosen club at once; its match this week, if any, is prepared for the manager.
   * Format 69 (career-3): an empty club id resigns without a new job.
   */
  async function resign(clubId: string) {
    const current = sessionRef.current
    if (seasonWorker.current || persistenceBusy.current || current.kind !== 'season') return
    try {
      const next = resignManager(current.season, clubId)
      install({ kind: 'season', season: next })
      setNotice({ message: clubId ? `You resigned and now manage ${next.clubs.find(club => club.id === clubId)!.name}. Its board starts afresh, and your first season there is protected.` : 'You resigned and are now without a club. Every club is run automatically; jobs that open appear on your desk.' })
      navigate('home')
      await persistSeason(next, 'manual')
    } catch (error) { setNotice({ message: messageOf(error), error: true }) }
  }
  /** Format 69 (career-3): a manager without a club takes a job from the job market; the club starts afresh. */
  async function takeJob(clubId: string) {
    const current = sessionRef.current
    if (seasonWorker.current || persistenceBusy.current || current.kind !== 'season') return
    try {
      const next = acceptJob(current.season, clubId)
      install({ kind: 'season', season: next })
      setNotice({ message: `You are the new coach of ${next.clubs.find(club => club.id === clubId)!.name}. Its board starts afresh at confidence 57, and your first season there is protected.` })
      navigate('home')
      await persistSeason(next, 'manual')
    } catch (error) { setNotice({ message: messageOf(error), error: true }) }
  }
  /**
   * The one Continue (owner request, 16 November 2026: "like in Football Manager"). It moves the career day by day through
   * the existing processing in the season worker (game days, the week's club business, recruitment days, the next season)
   * and stops where the manager is needed (`continueStop`): the manager's match, a decision, new inbox items, a season
   * boundary, or the manager's Stop. Each day's state is installed and saved as it comes, so the date ticks and the page
   * stays usable. `choice` answers the board's season-end decision (no decision: stay).
   */
  function continueCareer(choice?: { decision?: SeasonEndDecision }) {
    const current = sessionRef.current
    if (seasonWorker.current || persistenceBusy.current || current.kind !== 'season') return
    const start = current.season, action = continueAction(start)
    // The manager's match opens first; on the match screen it is watched or simulated as before.
    if (action.kind === 'match') {
      if (page !== 'match') navigate('match')
      else setNotice({ message: start.activeMatch?.requiredSubstitutions.length ? 'Make the required substitution, then Continue.' : 'Watch or simulate your match, then Continue.' })
      return
    }
    if (action.kind === 'blocked') { setNotice({ message: action.reason }); return }
    replacementRequest.current += 1
    setPlaying(false); settlePlayback()
    let worker: Worker
    try { worker = new Worker(new URL('./world/season.worker.ts', import.meta.url), { type: 'module' }) }
    catch (error) { setNotice({ message: messageOf(error), error: true }); return }
    const requestId = ++seasonJob.current
    seasonWorker.current = worker; continueStopRequested.current = false
    setAdvancing(true); setNotice(null)
    let previous = start, steps = 0
    const view = (state: SeasonState): ContinueRunView => ({ ...continueStepView(state), steps, total: steps + remainingSteps(state), stopping: continueStopRequested.current })
    setContinueRun(view(start))
    // The career stays at the last day processed (already installed) when a run ends early.
    const end = () => { worker.terminate(); if (seasonWorker.current === worker) seasonWorker.current = null; setAdvancing(false); setContinueRun(null) }
    const finish = (state: SeasonState, stop: ContinueStop) => {
      end(); setWorkerFailure(null)
      install({ kind: 'season', season: state })
      setNotice({ message: continueNotice(start, state, stop), error: stop.kind === 'error' })
      if (stop.page) navigate(stop.page)
    }
    worker.onmessage = ({ data }: MessageEvent<SeasonReply>) => {
      if (data.requestId !== seasonJob.current || seasonWorker.current !== worker) return
      if ('error' in data) { end(); setNotice({ message: data.error, error: true }); return }
      // Format 63: the board's decision (a dismissal or job offers) is answered before the week is committed.
      if ('outlook' in data) { end(); setWorkerFailure(null); if (data.outlook) setSeasonEnd(data.outlook); return }
      steps += 1
      const stop = continueStop(previous, data.state) ?? (continueStopRequested.current ? stoppedRun(data.state) : null)
      previous = data.state
      void persistSeason(data.state, data.step === 'market' ? 'manual' : data.step === 'rollover' ? 'rollover' : 'matchday')
      if (stop) { finish(data.state, stop); return }
      replaceSession({ kind: 'season', season: data.state })
      setContinueRun(view(data.state))
      worker.postMessage({ requestId, action: 'next' })
    }
    worker.onerror = event => {
      if (seasonWorker.current !== worker) return
      end()
      // A worker file that cannot be downloaded fails every retry: offer Save and reload, as for a page.
      if (isWorkerLoadFailure(event)) {
        event.preventDefault()
        setNotice(null)
        setWorkerFailure({ title: 'The next day', failed: 'could not be processed', error: new Error(`The season worker could not be loaded${event instanceof ErrorEvent && event.message ? `: ${event.message}` : '.'}`) })
        return
      }
      setNotice({ message: 'Could not continue. Your career stays at the last day processed; try Continue again.', error: true })
    }
    worker.postMessage({ requestId, action: 'continue', state: start, ...(choice ? { decided: true, ...(choice.decision ? { decision: choice.decision } : {}) } : {}) })
  }
  /** The manager's Stop: the run ends after the day in progress. */
  function stopContinue() {
    if (!seasonWorker.current || continueStopRequested.current) return
    continueStopRequested.current = true
    setContinueRun(run => run && { ...run, stopping: true })
  }
  // Space presses Continue when no field or control has focus and no dialog is open (AGENTS.md: keyboard access).
  const continueShortcut = useRef<(() => void) | null>(null)
  continueShortcut.current = season && !entryView && !saveHistoryOpen && !seasonEnd && !friendlyOpen ? () => continueCareer() : null
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (!continueShortcut.current || !isContinueShortcut(event) || seasonWorker.current || document.querySelector('dialog[open]')) return
      event.preventDefault()
      continueShortcut.current()
    }
    window.addEventListener('keydown', press)
    return () => window.removeEventListener('keydown', press)
  }, [])
  useEffect(() => () => { seasonWorker.current?.terminate() }, [])

  const savedCareer = saveHistory?.current
  const careerSummary = (state: SeasonState) => ({ managerName: state.manager?.name ?? 'Manager profile not set', clubName: managedClubLabel(state), date: state.date })
  const overlays = <>
    <input ref={importRef} type="file" accept=".json,application/json,text/plain,application/octet-stream" onChange={importSave} className="visually-hidden" aria-label="Import game save" />
    {friendlyOpen && !season && <Suspense fallback={null}><RealClubFriendly pack={realPack} busy={saving || advancing} onPackLoaded={setRealPack} onStart={startFriendly} onClose={() => setFriendlyOpen(false)} /></Suspense>}
    {seasonEnd && season && <SeasonEndChoice season={season} outlook={seasonEnd} busy={advancing || saving} onChoose={clubId => { setSeasonEnd(null); continueCareer({ decision: clubId !== null ? { moveTo: clubId } : undefined }) }} onClose={() => setSeasonEnd(null)} />}
    {saveHistoryOpen && <CareerSaveHistory entries={saveHistory?.entries ?? []} loading={historyLoading} error={historyError} busy={saving} onRefresh={() => { void refreshSaveHistory() }} onRestore={revision => { void restoreCheckpoint(revision) }} onClose={closeSaveHistory} />}
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}><Icon name={notice.error ? 'close' : 'check'} size={19} /><span>{notice.message}</span><button aria-label="Dismiss message" className="icon-button" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}
  </>
  if (entryView) return <><PageErrorBoundary key={entryView} title={entryView === 'menu' ? 'The main menu' : entryView === 'profile' ? 'Manager profile' : 'New career'} savesFirst={false} onReload={() => window.location.reload()} fullScreen><Suspense fallback={<main className="career-entry-loading" role="status">Opening game menu…</main>}><CareerStart key={entryView} view={entryView} busy={saving || advancing || creatingCareer} starting={creatingCareer} error={entryError ?? (entryView === 'menu' ? historyError : null)} hasSession={hasSession} currentCareer={hasSession && season ? careerSummary(season) : null} savedCareer={savedCareer ? careerSummary(savedCareer) : null} savesLoading={historyLoading} initialManager={entryView === 'profile' ? season?.manager : null} onContinue={() => { void loadSeason() }} onResume={resumeSession} onNewCareer={() => { void openEntry('new-career') }} onLoad={openSaveHistory} onImport={() => importRef.current?.click()} onExhibition={() => { void restart() }} onCancel={cancelEntry} onStart={startSeason} pack={realPack} onPackLoaded={setRealPack} packSource={packSource} onSaveProfile={profile => { void saveManagerProfile(profile) }} onExport={exportSave} /></Suspense></PageErrorBoundary>{overlays}</>

  // Format 69 (career-3): a manager without a club sees the unemployed desk, the inbox and the world's competitions only.
  if (season && isUnemployed(season)) {
    const unemployedGroups = unemployedNavigation({ europe: !!(playsEurope(worldOf(season)) || worldOf(season).backgroundLeagues?.length) })
    const unemployedPages = unemployedGroups.flat()
    const view: Page = unemployedPages.some(item => item.id === page) ? page : 'home'
    return <div className="app-shell game-shell" data-unemployed>
      <aside className="sidebar">
        <a href="#main" className="skip-link">Skip to content</a>
        <div className="brand"><div className="brand-symbol"><Icon name="ball" size={29} /></div><div>COURTSIDE<small>BASKETBALL MANAGER</small></div></div>
        <div className="club-context"><div className="club-mark" aria-hidden="true"><Icon name="shield" size={21} /></div><div><strong>Without a club</strong><span>Head coach · available</span></div></div>
        <MainNavigation groups={unemployedGroups} current={view} disabled={saving || leavingSeason} onNavigate={navigate} />
        <div className="sidebar-bottom"><div className="session-mode"><span className="status-dot" />Season</div><p>{worldOf(season).source === 'real-data-pack' ? 'Real clubs' : 'Fictional squads'}</p><button id="manager-profile" className="manager manager-profile-button" onClick={openManagerProfile} disabled={saving || advancing} aria-label={season.manager ? 'Edit manager profile' : 'Set manager profile'}><span className="manager-avatar">{season.manager ? season.manager.name.split(/\s+/u).map(part => Array.from(part)[0]).slice(0, 2).join('').toUpperCase() : 'YOU'}</span><span className="manager-identity"><strong data-manager-name>{season.manager?.name ?? 'Set manager profile'}</strong><small>Without a club</small></span></button></div>
      </aside>
      <div className="main-shell">
        <header className="topbar"><div className="game-context"><strong>Without a club</strong><span>/</span><span>{view === 'home' ? 'Unemployed desk' : pageNames[view]}</span></div><div className="topbar-actions"><SaveStatus progress={saveProgress} /><button id="game-main-menu" className="button small" onClick={() => { void openEntry('menu') }} disabled={saving || advancing}><Icon name="home" size={16} />Main menu</button><button className="button small" onClick={save} disabled={saving || advancing}><Icon name="save" size={16} />{saving ? 'Saving...' : 'Save season'}</button><ContinueControl day={careerToday(season)} status={continueStatus(season, '')} busy={saving || leavingSeason} run={continueRun} onContinue={() => continueCareer()} onStop={stopContinue} /></div></header>
        {continueRun && <ContinueProgress run={continueRun} />}
        {checkpointIssue && <div className="career-save-issue" role="alert"><span>{checkpointIssue}</span><button className="text-button" onClick={openSaveHistory} disabled={saving || advancing}>Save history</button><button className="text-button" onClick={exportSave} disabled={saving || advancing}>Export current</button></div>}
        <main id="main" tabIndex={-1} inert={leavingSeason || saving}>
          <div className="page-heading"><h1>{view === 'home' ? 'Unemployed desk' : pageNames[view]}</h1><div className="heading-meta"><span className="pill">{worldSeasonName(season).toUpperCase()}</span><span className="muted"><time dateTime={careerToday(season)}>{gameDate(careerToday(season), true)}</time></span></div></div>
          {workerFailure && <PageError title={workerFailure.title} error={workerFailure.error} step={{ failed: workerFailure.failed, part: 'the file that runs this step' }} savesFirst onReload={() => { void saveAndReload() }} />}
          <PageErrorBoundary key={view} title={view === 'home' ? 'Unemployed desk' : pageNames[view]} savesFirst onReload={() => { void saveAndReload() }}><Suspense fallback={<p className="panel" style={{ padding: 16 }} role="status">Opening workspace…</p>}>
            {view === 'home' && <UnemployedDesk season={season} busy={advancing || saving} onAccept={clubId => { void takeJob(clubId) }} onOpenCompetitions={() => navigate('season')} onOpenCalendar={() => navigate('calendar')} />}
            {view === 'inbox' && <InboxWorkspace season={season} busy={advancing || saving} onAnswerPress={() => {}} onOpen={() => navigate('home')} />}
            {view === 'season' && <SeasonWorkspace season={season} onNewCareer={() => { void openEntry('new-career') }} onOpenMatch={() => navigate('home')} onLoad={loadSeason} busy={advancing || saving} />}
            {view === 'calendar' && <SeasonCalendar season={season} />}
            {view === 'europe' && <EuropeWorkspace season={season} />}
          </Suspense></PageErrorBoundary>
          <footer className="workspace-footer"><div className="game-session-actions"><button className="text-button" onClick={restart} disabled={saving || advancing}><Icon name="restart" size={14} />Save &amp; open exhibition</button><button className="text-button" onClick={openManagerProfile} disabled={saving || advancing}>Manager profile</button></div><div className="save-tools"><button className="text-button" onClick={openSaveHistory}>Save history</button><button className="text-button" onClick={load}>Load saved</button><button className="text-button" onClick={exportSave}><Icon name="download" size={14} />Export</button><button className="text-button" onClick={() => importRef.current?.click()}><Icon name="upload" size={14} />Import</button></div></footer>
        </main>
      </div>
      {overlays}
    </div>
  }
  return <div className={`app-shell game-shell ${page === 'match' ? 'match-screen' : ''}`}>
    <aside className="sidebar">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="brand"><div className="brand-symbol"><Icon name="ball" size={29} /></div><div>COURTSIDE<small>BASKETBALL MANAGER</small></div></div>
      <div className="club-context"><ClubMark name={managedTeam.shortName} color={managedTeam.color} /><div><strong>{managedTeam.name}</strong><span>First team</span></div></div>
      <MainNavigation groups={mainNavigation({ career: !!season, europe: !!season && !!(playsEurope(worldOf(season)) || worldOf(season).backgroundLeagues?.length) })} current={page} disabled={saving || leavingSeason} onNavigate={navigate} />
      <div className="sidebar-bottom"><div className="session-mode"><span className="status-dot" />{season ? 'Season' : 'Exhibition'}</div><p>{season ? worldOf(season).source === 'real-data-pack' ? 'Real clubs' : 'Fictional squads' : match.home.id.startsWith('club-') ? 'Real clubs · private pack' : 'Fictional squads'}</p>{season ? <button id="manager-profile" className="manager manager-profile-button" onClick={openManagerProfile} disabled={saving || advancing} aria-label={season.manager ? 'Edit manager profile' : 'Set manager profile'}><span className="manager-avatar">{season.manager ? season.manager.name.split(/\s+/u).map(part => Array.from(part)[0]).slice(0, 2).join('').toUpperCase() : 'YOU'}</span><span className="manager-identity"><strong data-manager-name>{season.manager?.name ?? 'Set manager profile'}</strong><small>Head coach</small>{season.manager && <small data-manager-details>{managerAge(season.manager, season.date)} years · {season.manager.nationality}</small>}</span></button> : <div className="manager"><span className="manager-avatar">YOU</span><div>Head coach<small>{managedTeam.name}</small></div></div>}</div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="game-context"><strong>{managedTeam.name}</strong><span>/</span><span>{pageNames[page]}</span></div><div className="topbar-actions">{!season && <span className="session-status"><span className="status-dot" />{complete ? 'Full time' : needsReplacement ? 'Decision required' : playing ? 'Match in progress' : match.status === 'ready' ? 'Pre-match' : 'Match paused'}</span>}{season && <SaveStatus progress={saveProgress} />}<button id="game-main-menu" className="button small" onClick={() => { void openEntry('menu') }} disabled={saving || advancing}><Icon name="home" size={16} />Main menu</button><button className="button small" onClick={save} disabled={saving || advancing}><Icon name="save" size={16} />{saving ? 'Saving...' : season ? 'Save season' : 'Save match'}</button>{season && <ContinueControl day={careerToday(season)} status={continueStatus(season, complete ? 'Full time' : needsReplacement ? 'Decision required' : playing ? 'Match in progress' : match.status === 'ready' ? 'Pre-match' : 'Match paused')} busy={saving || leavingSeason} run={continueRun} onContinue={() => continueCareer()} onStop={stopContinue} />}</div></header>
      {continueRun && <ContinueProgress run={continueRun} />}
      {checkpointIssue && <div className="career-save-issue" role="alert"><span>{checkpointIssue}</span><button className="text-button" onClick={openSaveHistory} disabled={saving || advancing}>Save history</button><button className="text-button" onClick={exportSave} disabled={saving || advancing}>Export current</button></div>}
      <main id="main" tabIndex={-1} inert={leavingSeason || saving}>
        {season && showsBudgetBar(page, squadView) && <ClubBudgetBar season={season} disabled={saving || advancing} onOpenClub={() => navigate('club')} onOpenStaff={() => navigate('staff')} onOpenTransfers={() => navigate('transfers')} />}
        <div className={page === 'match' ? 'sr-only' : 'page-heading'}><h1>{pageNames[page]}</h1><div className="heading-meta"><span className="pill">{season || page === 'season' ? (season ? worldSeasonName(season) : 'Development league').toUpperCase() : 'EXHIBITION'}</span><span className="muted">{page === 'season' ? season ? <time dateTime={careerToday(season)}>{gameDate(careerToday(season), true)}</time> : 'Club selection' : deskDay ? deskDay.label : `${match.home.shortName} vs ${match.away.shortName}`}</span></div></div>
        {workerFailure && <PageError title={workerFailure.title} error={workerFailure.error} step={{ failed: workerFailure.failed, part: 'the file that runs this step' }} savesFirst onReload={() => { void saveAndReload() }} />}

        {season && page !== 'season' && page !== 'match' && <SeasonProgress season={season} onCompetition={() => navigate('season')} />}
        <PageErrorBoundary key={page} title={pageNames[page]} savesFirst={!!season} onReload={() => { void saveAndReload() }}><Suspense fallback={<p className="panel" style={{ padding: 16 }} role="status">Opening workspace…</p>}>
        {page === 'calendar' && season && <SeasonCalendar season={season} />}
        {page === 'europe' && season && <EuropeWorkspace season={season} />}
        {page === 'season' && <SeasonWorkspace season={season} onNewCareer={() => { void openEntry('new-career') }} onOpenMatch={() => navigate('match')} onLoad={loadSeason} busy={advancing || saving} />}

        {page === 'transfers' && season && <TransfersWorkspace onOpenAcademy={() => navigate('academy')} key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}`} season={season} disabled={advancing || saving} onEnableNegotiations={() => updateCareer(enableNegotiations, 'Contract negotiations enabled. Player responses and agreed terms will be saved.', true)} onEnableMarket={() => updateCareer(enableMarket, 'Offseason calendar enabled. New offseason offers will await a dated player reply.', true)} onClubDecision={(offerId, response) => updateCareer(state => decideClubTransfer(state, offerId, response), response === 'accept' ? 'Fee agreed. The player will decide on the proposed contract next.' : response === 'counter' ? 'Club counteroffer sent.' : 'Transfer offer rejected.', true)} onEnableInSeason={() => updateCareer(enableInSeasonRecruitment, 'In-season recruitment enabled. Free agents can join before the next matchday.', true)} onEnableInSeasonTransfers={() => updateCareer(enableInSeasonTransfers, 'Midseason transfers enabled. Approach a club to negotiate a fee before the player decides.', true)} onInSeasonTransferOffer={(playerId, seasonWage, seasons, fee, paymentPlan, options) => updateCareer(state => submitInSeasonTransferOffer(state, playerId, seasonWage, seasons, fee, state.managedClubId, paymentPlan, options), options?.transferMode === 'release-clause' ? 'Release clause triggered. The full fee and remaining salary are reserved until the player decides next matchday.' : 'Transfer proposal reviewed. Check the club response and next player reply in Transfers.', true)} onInSeasonClubDecision={(offerId, response) => updateCareer(state => decideInSeasonTransfer(state, offerId, response), response === 'accept' ? 'Fee approved. The player can agree to join before the next matchday.' : response === 'counter' ? 'Club counteroffer sent. The buyer can submit revised terms.' : 'Transfer offer rejected. Reservations released.', true)} onInSeasonOffer={(playerId, seasonWage, options) => updateCareer(state => submitInSeasonOffer(state, playerId, seasonWage, state.managedClubId, options), 'Offer sent. Remaining-season salary and a squad place are reserved until the next matchday reply.', true)} onWithdrawInSeasonOffer={offerId => updateCareer(state => withdrawInSeasonOffer(state, offerId), 'Offer withdrawn. Fee, salary and squad reservations released.', true)} onOpenMatch={() => navigate('match')} focusedPlayerId={transferPlayer} onClearFocusedPlayer={() => setTransferPlayer(null)} onOpenScouting={openScouting} onShortlist={updateShortlist} onEnable={enableContracts} onWithdrawOffer={withdrawContractOffer} onDelegation={delegateContracts} onOffer={offerContract} onOpenContracts={() => openContracts()} onOpenScoutingPage={() => openScouting()} />}

        {page === 'medical' && season && <MedicalWorkspace season={season} busy={advancing || saving} onSelectPlayer={id => { setSelectedPlayer(id); setRosterFilter('all'); setRosterQuery(''); navigate('squad', '.player-profile') }} onOpenPhysio={() => { setStaffRole('physio'); navigate('staff') }} onOpenTraining={() => navigate('training')} />}

        {page === 'academy' && season && <AcademyWorkspace key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}`} season={season} busy={advancing || saving} onEnableYouthCompetition={() => updateCareer(enableYouthCompetition, 'Youth matches enabled. Review your expanded academy squad and upcoming fixtures.', true)} onEnableAcademy={() => updateCareer(enableAcademy, 'Academy opened. Choose a development focus for your prospects.', true)} onAcademyFocus={(id, focus) => updateCareer(state => setAcademyFocus(state, id, focus), 'Development focus updated for future academy weeks.', true)} onPromoteAcademy={(id, wage) => updateCareer(state => offerAcademyPromotion(state, id, wage), 'Senior contract offered. The player replies before the next matchday; salary and a squad place are reserved.', true)} onWithdrawPromotion={id => updateCareer(state => cancelAcademyPromotion(state, id), 'Promotion offer withdrawn. The player remains in your academy.', true)} onOpenYouthCoach={() => { setStaffRole('youth'); navigate('staff') }} onOpenPlayer={id => { if (managedTeam.players.some(player => player.id === id)) { setSelectedPlayer(id); setRosterFilter('all'); setRosterQuery(''); navigate('squad', '.player-profile') } else openScouting(id) }} />}

        {page === 'training' && season && <TrainingWorkspace onEnableLifecycle={() => updateCareer(enableLifecycle, 'Player aging and retirement enabled for future career dates. Existing contracts and match records are preserved.', true)} onOpenMedical={() => navigate('medical')} onOpenFitness={() => { setStaffRole('fitness'); navigate('staff') }} season={season} onEnable={() => updateTraining()} onPlanChange={updateTraining} busy={advancing || saving} onSelectPlayer={id => { setSelectedPlayer(id); setRosterFilter('all'); setRosterQuery(''); navigate('squad', '.player-profile') }} />}

        {page === 'scouting' && season && <ScoutingWorkspace key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}`} season={season} disabled={advancing || saving} selectedPlayerId={scoutingPlayer} onSelectPlayer={setScoutingPlayer} onEnable={() => updateCareer(enableScouting, 'Scouting enabled. Assign players to observe at the next committed matchday.', true)} onAssign={(playerId, scoutContractId) => updateCareer(state => assignScouting(state, playerId, scoutContractId), 'Observation assigned. Continue after the matchday to receive the report.', true)} onCancel={playerId => updateCareer(state => cancelScoutingAssignment(state, playerId), 'Scouting assignment cancelled.', true)} onShortlist={updateShortlist} onDelegation={delegated => updateCareer(state => setScoutingDelegation(state, delegated), delegated ? 'Scouting delegated. Your assistant has reviewed the available assignment slots.' : 'Scouting is now manual. Existing assignments remain scheduled.', true)} onOpenTransfers={openTransfers} onOpenScouts={() => { setStaffRole('scouts'); navigate('staff') }} />}

        {page === 'staff' && season && <StaffWorkspace onEnableYouth={() => updateCareer(enableYouth, 'Youth-coach recruitment enabled. Review available coaches before appointing one.', true)} onHireYouthCoach={id => updateCareer(state => hireYouthCoach(state, id), 'Youth coach appointed. Extra practice starts with the next academy week.', true)} onReleaseYouthCoach={id => updateCareer(state => releaseYouthCoach(state, id), 'Youth coach released. The paid season fee and completed development are retained.', true)} onYouthCoachRenewal={(id, renew) => updateCareer(state => setYouthCoachRenewal(state, id, renew), renew ? 'Youth-coach renewal selected.' : 'Youth-coach renewal cancelled.', true)} onOpenAcademy={() => navigate('academy')} onEnableAssistant={() => updateCareer(enableAssistant, 'Assistant-coach recruitment enabled. Existing instructions and rotation choices are unchanged.', true)} onHireAssistant={id => updateCareer(state => hireAssistant(state, id), 'Assistant coach appointed. Review advice in Match coaching.', true)} onReleaseAssistant={id => updateCareer(state => releaseAssistant(state, id), 'Assistant coach released. The paid fee remains committed this season.', true)} onAssistantRenewal={(id, renew) => updateCareer(state => setAssistantRenewal(state, id, renew), renew ? 'Assistant-coach renewal selected.' : 'Assistant-coach renewal cancelled.', true)} onOpenAssistantAdvice={() => navigate('match', '#assistant-advice-toggle')} key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}`} season={season} busy={advancing || saving} role={staffRole} onRoleChange={setStaffRole} onEnablePhysio={() => updateCareer(enablePhysio, 'Physio recruitment enabled. Review available staff before appointing your club physio.', true)} onHirePhysio={physioId => updateCareer(state => hirePhysio(state, physioId), 'Physio hired. Injury rehabilitation begins after Continue, between matchdays.', true)} onReleasePhysio={contractId => updateCareer(state => releasePhysio(state, contractId), 'Physio released. The season fee, recovery already earned and treatment records are retained.', true)} onPhysioRenewal={(contractId, renew) => updateCareer(state => setPhysioRenewal(state, contractId, renew), renew ? 'Physio renewal selected for next season.' : 'Physio will leave when this season ends.', true)} onOpenMedical={() => navigate('medical')} onEnableFitness={() => updateCareer(enableFitness, 'Fitness staff enabled. Review available coaches in Staff.', true)} onHireFitness={coachId => updateCareer(state => hireFitnessCoach(state, coachId), 'Fitness coach hired. Recovery and workload support starts with the next training week.', true)} onReleaseFitness={contractId => updateCareer(state => releaseFitnessCoach(state, contractId), 'Fitness coach released. The season fee is retained and completed weekly reports remain.', true)} onFitnessRenewal={(contractId, renew) => updateCareer(state => setFitnessRenewal(state, contractId, renew), renew ? 'Fitness coach renewal selected for next season.' : 'Fitness coach will leave when this season ends.', true)} onOpenScouting={() => openScouting()} onEnableScouts={() => updateCareer(enableScouts, 'Scout recruitment enabled. Review available scouts in Staff.', true)} onHireScout={scoutId => updateCareer(state => hireScout(state, scoutId), 'Scout hired. One extra observation is available; assign a player in Scouting.', true)} onReleaseScout={contractId => updateCareer(state => releaseScout(state, contractId), 'Scout released. Any pending observation by this scout was cancelled. Completed reports remain; the season fee is retained.', true)} onScoutRenewal={(contractId, renew) => updateCareer(state => setScoutRenewal(state, contractId, renew), renew ? 'Scout renewal selected for next season.' : 'Scout will leave when this season ends.', true)} onOpenTraining={() => navigate('training')} onEnable={() => updateCareer(enableCoaching, 'Coaching enabled for all clubs. Assignments will apply to future training weeks.')} onHire={(coachId, focus) => updateCareer(state => hireCoach(state, coachId, focus), 'Coach recruited. The season fee is now committed.')} onRelease={contractId => updateCareer(state => releaseCoach(state, contractId), 'Coach released. This season’s fee remains committed.')} onReplaceStaff={(role, contractId, personId) => updateCareer(state => replaceStaff(state, role, contractId, personId), next => staffChangeNoticeAfter(next, role, contractId, personId), true)} onSackStaff={(role, contractId) => updateCareer(state => releaseStaff(state, role, contractId), next => staffChangeNoticeAfter(next, role, contractId), true)} onAssignment={(contractId, focus) => updateCareer(state => setCoachAssignment(state, contractId, focus))} onRenewal={(contractId, renew) => updateCareer(state => setCoachRenewal(state, contractId, renew))} />}

        {page === 'club' && season && <ClubWorkspace key={`${season.seed}:${season.managedClubId}`} {...simpleFacilityActions(updateCareer)} onEnableFacilities={() => updateCareer(enableFacilities, 'Club facilities enabled. Review upgrades and choose manual or automatic management.', true)} onFacilityUpgrade={type => updateCareer(state => startFacilityUpgrade(state, type), 'Construction funded. Track its completion date in Club.', true)} onCancelFacilityUpgrade={projectId => updateCareer(state => cancelFacilityUpgrade(state, projectId), 'Construction cancelled. The money already paid remains spent.', true)} onFacilityDelegation={delegated => updateCareer(state => setFacilityDelegation(state, delegated), delegated ? 'Automatic facilities management enabled. Affordable projects may start within the cash reserve policy.' : 'You now choose facility upgrades. Existing construction continues.', true)} onEnableMaintenance={() => updateCareer(enableFacilityMaintenance, 'Upkeep choices enabled. Facilities stay on full upkeep until you choose otherwise.', true)} onMaintenancePlan={plan => updateCareer(state => setMaintenancePlan(state, plan), plan === 'reduced' ? 'Reduced upkeep from the next matchday: half the cost, and upgraded facilities will wear.' : 'Full upkeep from the next matchday: facilities recover condition.', true)} onFacilityRepair={type => updateCareer(state => startFacilityRepair(state, type), 'Repair funded. Track its completion date in Club.', true)} onFacilityLoan={(type, project, seasons, principal) => updateCareer(state => takeFacilityLoan(state, type, project, seasons, principal), project === 'repair' ? 'Loan received and the repair has started. Repayments are listed under Loans & leases.' : 'Loan received and construction has started. Repayments are listed under Loans & leases.', true)} onFacilityLease={(type, seasons) => updateCareer(state => leaseFacility(state, type, seasons), 'Lease signed. The new level is installed for the next matchday; payments are listed under Loans & leases.', true)} onRepayLoan={debtId => updateCareer(state => repayFacilityLoan(state, debtId), 'Loan repaid early. No further payments are due.', true)} onEndLease={debtId => updateCareer(state => endFacilityLease(state, debtId), 'Lease ended. The penalty is paid and the level is handed back after today.', true)} onRequestBoardFunding={(type, project) => updateCareer(state => requestBoardFunding(state, type, project), next => { const decision = [...next.facilities.events].reverse().find(event => event.type === 'funding'); return decision?.type === 'funding' && decision.approved ? project === 'repair' ? 'The board approved the capital. The repair has started.' : 'The board approved the capital. Construction has started.' : `Request refused. ${decision?.type === 'funding' ? boardFundingRefusal(decision) : ''} You can ask again after two matchdays.` }, true)} onEnableSponsorship={() => updateCareer(enableCommercial, 'Sponsorship negotiations enabled. This season stays as it is; offers for next season arrive on matchday 6.', true)} onAcceptSponsorship={offerId => updateCareer(state => acceptSponsorshipOffer(state, offerId), next => `${getDevelopmentSponsor(next.commercial.agreements.at(-1)!.sponsorId).name} signed as your main sponsor.`, true)} onDeclineSponsorship={offerId => updateCareer(state => declineSponsorshipOffer(state, offerId), 'Offer declined.', true)} onRequestSponsorship={offerId => updateCareer(state => requestSponsorshipImprovement(state, offerId), next => { const offer = next.commercial.offers.find(item => item.id === offerId)!; return offer.request?.response === 'accepted' ? 'The sponsor agreed to your request.' : offer.request?.response === 'withdrawn' ? 'The sponsor withdrew its offer.' : 'The sponsor answered with its final terms.' }, true)} onSponsorshipDelegation={delegated => updateCareer(state => setSponsorshipDelegation(state, delegated), delegated ? 'Automatic sponsorship enabled. The best guaranteed offer is signed when offers arrive.' : 'You now choose sponsor offers.', true)} onAcceptNaming={offerId => updateCareer(state => acceptNamingOffer(state, offerId), next => `Naming rights signed: the arena becomes ${next.commercial.naming!.agreements.at(-1)!.arenaName} from ${seasonLabel(next.commercial.naming!.agreements.at(-1)!.startsSeason)}.`, true)} onDeclineNaming={offerId => updateCareer(state => declineNamingOffer(state, offerId), 'Naming offer declined.', true)} onRequestNaming={offerId => updateCareer(state => requestNamingImprovement(state, offerId), next => { const offer = next.commercial.naming!.offers.find(item => item.id === offerId)!; return offer.request?.response === 'accepted' ? 'The sponsor agreed to your request.' : offer.request?.response === 'withdrawn' ? 'The sponsor withdrew its naming offer.' : 'The sponsor answered with its final terms.' }, true)} onNamingDelegation={delegated => updateCareer(state => setNamingDelegation(state, delegated), delegated ? 'Automatic naming rights enabled. The best guaranteed naming offer is signed when offers arrive.' : 'You now choose naming-rights offers.', true)} onTerminateSponsorship={(contract, agreementId) => updateCareer(state => terminateSponsorship(state, contract, agreementId), 'Agreement ended early. The termination fee is paid and new offers arrive at the next sponsorship window.', true)} season={season} busy={advancing || saving} onEnable={() => updateCareer(enableFinance, 'Club finances enabled. Opening funds and existing coaching fees are recorded in the ledger.')} onPlanChange={plan => updateCareer(state => setTicketPlan(state, plan))} />}
        {page === 'board' && season && <BoardWorkspace key={`${season.seed}:${season.managedClubId}`} season={season} busy={advancing || saving} onEnable={() => updateCareer(enableBoard, 'Board expectations enabled. Review your objectives and when assessment begins.', true)} onEnableRivalries={() => updateCareer(state => enableRivalries(state), 'Rivalries enabled. Derbies count from the next matchday.', true)} onEnableCareerMoves={() => updateCareer(state => enableCareerMoves(state), 'Dismissal and job offers enabled. They apply from the end of next season.', true)} onResign={clubId => { void resign(clubId) }} onEnableConsequences={() => updateCareer(enableBoardConsequences, 'Season verdicts enabled. From next season, the board\'s final confidence sets your staff budget and the owner\'s capital.', true)} onEnableFunding={() => updateCareer(enableBoardFunding, 'Board funding requests enabled. When an upgrade costs more than your club can spend, you can ask the board for the difference.', true)} />}

        {page === 'inbox' && season && <InboxWorkspace season={season} busy={advancing || saving} onAnswerPress={answer => updateCareer(state => answerPress(state, answer), `Press answer given: ${PRESS_ANSWER_TEXT[answer].label}. Morale effects apply from the next prepared match.`, true)} onOpen={(target, playerId) => {
          if (target === 'jobs') navigate('home')
          else if (target === 'board') navigate('board')
          else if (target === 'club') navigate('club')
          else if (target === 'dynamics') { setRelationshipPlayer(playerId ?? null); setSquadView('relationships'); navigate('squad') }
          else if (target === 'contract' && playerId) openTransfers(playerId)
          else { if (playerId) setSelectedPlayer(playerId); setRosterFilter('all'); setRosterQuery(''); navigate('squad', playerId ? '.player-profile' : '#main') }
        }} onContractReply={replyToContract} />}

        {restWeek && season && (page === 'home' || page === 'match') && <RestWeek season={season} busy={advancing || saving} onTraining={() => navigate('training')} />}
        {page === 'home' && !restWeek && <ManagerDesk onOpenInbox={() => navigate('inbox', '#press-conference')} onOpenBoard={() => navigate('board')} onOpenRelationships={id => { setRelationshipPlayer(id ?? null); setSquadView('relationships'); navigate('squad') }} assistant={assistantCoach} onOpenAssistantAdvice={() => navigate('match', '#assistant-advice-toggle')} onOpenMedical={() => navigate('medical')} season={season} match={match} managedSide={managedSide} apply={apply} fixtureLabel={season ? `${season.world?.domesticLeagues?.find(league => league.clubIds.includes(season.managedClubId))?.name ?? worldOf(season).name} / Week ${season.round}${matchVenue ? ` / ${matchVenue}` : ''}` : undefined} onOpenMatch={() => navigate('match')} onOpenSquad={() => navigate('squad')} onSelectPlayer={id => { setSelectedPlayer(id); setRosterFilter('all'); setRosterQuery(''); navigate('squad', '.player-profile') }} onOpenCoaching={() => navigate('match', needsReplacement ? '#match-rotation' : complete ? '.coaching-workbench' : '#tempo')} onOpenClub={() => navigate('club')} onOpenPayroll={openPayroll} onOpenTransfers={() => navigate('transfers')} onOpenContracts={() => openContracts()} onOpenScouting={() => openScouting()} />}

        {page === 'match' && !restWeek && <>
          <section className="scoreboard panel" aria-label="Match scoreboard"><div className="score-team home-team"><ClubMark name={match.home.shortName} color={match.home.color} large /><div><span className="eyebrow">{managedSide === 'home' ? 'YOUR TEAM / HOME' : 'OPPOSITION / HOME'}</span><h2>{match.home.name}</h2></div></div><div className="score-middle"><div className={`match-status ${playing ? 'is-playing' : ''}`}><span className="status-dot" />{complete && !playback.busy ? 'FULL TIME' : complete && playback.busy ? playing ? 'FINAL PLAY' : 'REPLAY PAUSED' : needsReplacement ? 'REPLACEMENT NEEDED' : playing ? 'IN PLAY' : match.stepCount === 0 ? 'READY FOR TIPOFF' : 'PAUSED'}</div><div className="score-digits" aria-live="off"><span>{displayScore.home}</span><span className="score-divider">:</span><span>{displayScore.away}</span></div><div className="match-clock">{periodLabel(match.period)}<span />{clock(match.clockSeconds)}</div>{matchVenue && <div className="match-venue" data-arena-name={matchVenue}>{matchVenue}</div>}</div><div className="score-team away-team"><div><span className="eyebrow">{managedSide === 'away' ? 'YOUR TEAM / AWAY' : 'OPPOSITION / AWAY'}</span><h2>{match.away.name}</h2></div><ClubMark name={match.away.shortName} color={match.away.color} large /></div></section>
          <section className="court-panel panel" aria-label="Courtside match view"><div className="court-top"><div className="court-title"><span className="live-dot" /><h2>Courtside</h2><span className="court-view-label">{textOnly ? 'MATCH COMMENTARY' : 'LIVE COURT'}</span></div><div className="viewer-options"><div className="segmented" aria-label="Match presentation"><button aria-pressed={!textOnly} className={!textOnly ? 'selected' : ''} onClick={() => setTextOnly(false)}>Court</button><button aria-pressed={textOnly} className={textOnly ? 'selected' : ''} onClick={() => setTextOnly(true)}>Text only</button></div><label className="motion-option"><input type="checkbox" checked={reducedMotion} onChange={event => setMotionOverride(event.target.checked)} />Reduced motion</label></div></div>{textOnly ? <div className="text-match-view" role="log" aria-label="Text match presentation"><span className="eyebrow">FROM THE FLOOR</span>{visibleEvents.slice(-5).map(event => <p key={event.id}><time>{periodLabel(event.period)} / {clock(event.clockSeconds)}</time>{event.text}</p>)}</div> : <Court match={match} event={presentedEvent} progress={presentedProgress} clock={playback.clock} reducedMotion={reducedMotion} bug={scoreBug} />}{textOnly ? <div className="court-caption"><span className="event-chip">{(captionEvent?.scene?.kind ?? captionEvent?.type)?.replace('-', ' ').toUpperCase() ?? 'COURTSIDE'}</span><p>{inFlight ? presentedEvent?.scene?.kind === 'free-throw' ? 'Free throw in flight...' : 'Shot in flight...' : captionEvent?.text ?? 'Ready for tipoff.'}</p></div> : <div className="court-caption play-line" aria-live="off"><span className="event-chip">{(playKind ?? captionEvent?.type)?.replace(/-/g, ' ').toUpperCase() ?? 'COURTSIDE'}</span><p title={captionEvent?.text}>{inFlight ? presentedEvent?.scene?.kind === 'free-throw' ? `${shooterName ?? 'The shooter'} at the line...` : `${shooterName ?? 'The shooter'} shoots...` : playLine}</p></div>}
          <RequiredDecision match={match} managedSide={managedSide} apply={apply} assistantName={assistantCoach?.name} />
          {match.result?.kind === 'default' && <p className="result-note" role="status">Game awarded by default: a team had fewer than two eligible players. The official result is shown above; the box score retains statistics earned on court.</p>}
          <div className="playback"><div className="playback-main"><button className="button primary watch-button" onClick={() => setPlaying(value => !value)} disabled={complete && !playback.busy || needsReplacement}><Icon name={playing ? 'pause' : 'play'} size={18} />{playing ? 'Pause' : playback.busy ? 'Resume play' : match.stepCount === 0 ? 'Start match' : complete ? 'Full time' : 'Watch match'}</button><button className="icon-button" title="Next action" aria-label="Simulate next action" onClick={() => { setPlaying(false); apply(stepMatch, false, true) }} disabled={complete || needsReplacement}><Icon name="next" size={19} /></button><div className="speed-control" aria-label="Playback speed">{[1, 2, 4].map(value => <button key={value} aria-pressed={speed === value} className={speed === value ? 'selected' : ''} onClick={() => setSpeed(value)}>{value}×</button>)}</div></div><div className="playback-skip"><button className="text-button" onClick={() => { setPlaying(false); apply(simulateToQuarterEnd, false, true) }} disabled={complete || needsReplacement}>Skip {match.period <= 4 ? 'quarter' : 'overtime'}<Icon name="next" size={15} /></button><button className="text-button" onClick={() => { setPlaying(false); apply(simulateToEnd, false, true) }} disabled={complete || needsReplacement}>Simulate rest<Icon name="skip" size={15} /></button></div></div><MatchLineup courtPicture={!!season} knowledgeForPlayer={season ? id => getMatchPlayerKnowledge(season, id) : undefined} match={match} displayMatch={statsSnapshot} managedSide={managedSide} disabled={advancing || saving} apply={apply} onInteractionStart={() => { setPlaying(false); settlePlayback(); setPresentationBase(null) }} />
          </section>
          {complete && !playback.busy && <MatchMvpCard mvp={getMatchMvp(match)} />}
          <MatchCoaching match={match} managedSide={managedSide} apply={apply} assistantName={assistantCoach?.name} advice={assistantCoach ? <AssistantAdvice key={assistantContract!.id} coach={assistantCoach} match={match} side={managedSide} settled={!playing && !playback.busy} onPrepare={() => { setPlaying(false); settlePlayback(); setPresentationBase(null) }} apply={apply} /> : undefined} />
          <div className="match-lower"><MatchBoxScore match={statsSnapshot} side={boxSide} onSideChange={setBoxSide} knowledgeForPlayer={season ? id => getMatchPlayerKnowledge(season, id) : undefined} /><section className="panel feed-panel"><div className="section-heading"><h2>From the floor</h2><span className="muted">PLAY BY PLAY</span></div><div className="event-feed">{visibleEvents.slice(-7).reverse().map(event => <div className={`feed-event ${event.type === 'shot' && event.shot?.made ? 'scoring-event' : ''}`} key={event.id}><div className="feed-time">{periodLabel(event.period)}<span>{clock(event.clockSeconds)}</span></div><div><p>{event.text}</p><span className="feed-score">{match.home.shortName} {event.score.home} — {event.score.away} {match.away.shortName}</span></div></div>)}{!latestEvent && <p className="empty-state">No match events yet.</p>}</div></section></div>
        </>}

        {page === 'squad' && <>
          <div className="squad-summary panel"><div><ClubMark name={managedTeam.shortName} color={managedTeam.color} /><h2>{managedTeam.name}</h2><span className="pill">FIRST TEAM</span></div><div><Stat label="AVAILABLE" value={`${eligiblePlayers.length}/${squadTeam.players.length}`} /><Stat label={offseason ? "LAST LINEUP" : "ON COURT"} value={match.lineups[managedSide].length} /><Stat label="AVG. STAMINA" value={`${averageCondition}%`} /></div></div>
          {season && <div className="squad-view-controls"><div className="segmented" role="group" aria-label="Squad view"><button aria-pressed={squadView === 'selection'} className={squadView === 'selection' ? 'selected' : ''} onClick={() => setSquadView('selection')}>Selection</button><button aria-pressed={squadView === 'performance'} className={squadView === 'performance' ? 'selected' : ''} onClick={() => { setSquadView('performance'); setPerformancePlayer(null) }}>Season statistics</button><button aria-pressed={squadView === 'relationships'} className={squadView === 'relationships' ? 'selected' : ''} onClick={() => setSquadView('relationships')}>Dynamics</button><button aria-pressed={squadView === 'payroll'} className={squadView === 'payroll' ? 'selected' : ''} onClick={() => setSquadView('payroll')}>Wages</button><button id="squad-view-contracts" aria-pressed={squadView === 'contracts'} className={squadView === 'contracts' ? 'selected' : ''} onClick={() => setSquadView('contracts')}>Contracts</button></div><span>{squadView === 'contracts' ? 'Renewals, contract ends and requests' : squadView === 'relationships' ? 'Roles, morale and promises' : squadView === 'selection' ? 'Current fixture and availability' : squadView === 'payroll' ? 'Player wage commitments' : 'Committed match results'}</span></div>}
          {season && squadView === 'contracts' ? <SquadContracts key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}`} season={season} disabled={advancing || saving} onEnable={enableContracts} onDelegation={delegateContracts} onOffer={offerContract} onWithdrawOffer={withdrawContractOffer} onBuyout={buyoutContract} onContractReply={replyToContract} onOpenScouting={openScouting} onShortlist={updateShortlist} onOpenTransfers={() => navigate('transfers')} focusedPlayerId={contractsPlayer} onClearFocusedPlayer={() => setContractsPlayer(null)} /> : season && squadView === 'relationships' ? <RelationshipsPanel key={`${season.seed}:${season.managedClubId}`} season={season} busy={advancing || saving} selectedPlayerId={relationshipPlayer} onSelectPlayer={setRelationshipPlayer} onEnable={() => updateCareer(enableRelationships, 'Squad dynamics enabled. Agreed roles and future match focus now have a recorded history.', true)} onRole={(playerId, role) => updateCareer(state => agreeSquadRole(state, playerId, role), 'Playing-time role agreed. Review the expectation in Dynamics.', true)} onTalk={(playerId, choice) => updateCareer(state => talkToPlayer(state, playerId, choice), 'Conversation recorded. Review the response and any commitment in Dynamics.', true)} onContractReply={replyToContract} /> : season && squadView === 'payroll' ? <PayrollWorkspace key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}`} season={season} busy={advancing || saving} onEnable={() => updateCareer(enablePayroll, 'Player payroll enabled. Wage schedules start from this matchday.')} onOpenClub={() => navigate('club')} onSelectPlayer={id => { setSelectedPlayer(id); setRosterFilter('all'); setRosterQuery(''); navigate('squad', '.player-profile') }} /> : season && squadView === 'performance' ? <SquadPerformance key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}`} season={season} selectedPlayerId={performancePlayer} onSelectPlayer={setPerformancePlayer} busy={advancing || saving} /> : <>
          {fullRoster && season && !restWeek && <MatchdaySquad season={season} busy={advancing || saving} assistantName={assistantCoach?.name} onAutomatic={() => updateCareer(state => setMatchdaySelection(state, null), automaticChoiceLabels(assistantCoach?.name).selected, true)} />}
          {season && <SquadStartingFive season={season} busy={advancing || saving} onUpdate={action => updateCareer(action, undefined, true)} onOpenMatch={() => navigate('match', '#match-rotation')} />}
          <div className="squad-layout"><section className="panel roster-panel">
            <div className="section-heading"><h2>Players</h2><button className="text-button" onClick={() => navigate('match', '#match-rotation')}>Manage rotation <Icon name="swap" size={15} /></button></div>
            <div className="roster-toolbar"><div className="roster-filters" aria-label="Filter squad">{[{id:'all',label:'All'},{id:'court',label:offseason ? 'Last lineup' : 'On court'},{id:'bench',label:offseason ? 'Last bench' : 'Bench'},{id:'unavailable',label:'Unavailable'}].map(filter => <button key={filter.id} aria-pressed={rosterFilter === filter.id} onClick={() => setRosterFilter(filter.id)}>{filter.label}</button>)}</div><label className="roster-search"><Icon name="search" size={15}/><input type="search" placeholder="Find player" aria-label="Search squad" value={rosterQuery} onChange={event => setRosterQuery(event.target.value)}/></label></div>
            <div className="table-scroll"><table className="roster"><thead><tr>{fullRoster && <th scope="col">MATCHDAY</th>}<th>PLAYER</th><th className="squad-role-head">ROLE</th><th>STATUS</th><th>AGE</th><th>HEIGHT</th><th>STAMINA</th><th>{offseason ? 'LAST PTS' : 'PTS'}</th><th>{offseason ? 'LAST PF' : 'PF'}</th></tr></thead><tbody>{rosterPlayers.map(player => <tr key={player.id} data-player-id={player.id} className={chosenPlayer.id === player.id ? 'selected-row' : ''}>
              {fullRoster && season && <td><label className="matchday-check"><input type="checkbox" aria-label={`Select ${player.name} for matchday`} checked={matchdayIds.includes(player.id)} disabled={saving || advancing || !canSelectMatchday(season) || (matchdayIds.includes(player.id) ? matchdayIds.length <= 5 : matchdayIds.length >= 12)} onChange={event => { const ids = event.target.checked ? [...matchdayIds, player.id] : matchdayIds.filter(id => id !== player.id); updateCareer(state => setMatchdaySelection(state, ids), 'Matchday squad updated.', true) }} /></label></td>}
              <td><button className="roster-player" onClick={() => setSelectedPlayer(player.id)} aria-pressed={chosenPlayer.id === player.id}><Avatar player={player} color={managedTeam.color} size={34} /><span><strong>{player.name}</strong><GeneratedTag season={season} playerId={player.id} /><small>#{player.number} / <PositionLabel position={player.position} profile={season ? worldOf(season).playerProfiles[player.id] : undefined} /></small></span></button></td>
              <td className="squad-role-cell">{season ? <SquadRoleCell season={season} playerId={player.id} busy={advancing || saving} onRole={(playerId, role) => updateCareer(state => agreeSquadRole(state, playerId, role), roleChangeMessage(season, playerId, role), true)} /> : '—'}</td>
              <td><span className={`roster-role ${match.lineups[managedSide].includes(player.id) ? 'on-court' : ''}`}>{offseason ? squadEligible(player.id) ? 'Available' : 'Recovering' : !match.stats[player.id] ? squadEligible(player.id) ? 'Not selected' : 'Injured' : !isPlayerEligible(match, player.id) ? match.injuries[player.id] ? 'Injured' : 'Fouled out' : match.lineups[managedSide].includes(player.id) ? 'On court' : 'Bench'}</span></td><td>{season ? getCareerPlayerAge(season, player.id, season.date) ?? '—' : '—'}</td><td>{player.heightCm} <span className="muted">cm</span></td><td><StaminaMeter value={squadCondition(player.id)} label={`${player.name} stamina`} compact /></td><td>{match.stats[player.id]?.points ?? '—'}</td><td>{match.stats[player.id]?.fouls ?? '—'}</td>
            </tr>)}</tbody></table>{rosterPlayers.length === 0 && <p className="roster-empty">No players match this filter.</p>}</div>
          </section><PlayerProfile onOpenMedical={() => navigate('medical')} player={chosenPlayer} match={match} managedSide={managedSide} season={season} onPerformance={() => { setPerformancePlayer(chosenPlayer.id); setSquadView('performance'); navigate('squad', '#player-performance-report') }} onContractReply={replyToContract} busy={advancing || saving} /></div>
          {season && <SeasonMedicalReport onOpenMedical={() => navigate('medical')} season={season} onSelectPlayer={id => { setSelectedPlayer(id); document.querySelector<HTMLElement>('.player-profile')?.focus() }} />}
          </>}
        </>}
        </Suspense></PageErrorBoundary>

        <footer className="workspace-footer"><div className="game-session-actions"><button className="text-button" onClick={restart} disabled={saving || advancing}><Icon name="restart" size={14} />{season ? 'Save & open exhibition' : 'New exhibition'}</button>{season && <button className="text-button" onClick={openManagerProfile} disabled={saving || advancing}>Manager profile</button>}<details ref={setupRef} className="simulation-options" hidden={!!season}><summary>Match setup</summary><div className="seed-controls"><label htmlFor="match-seed">Replay code</label><input id="match-seed" inputMode="numeric" value={seedInput} onChange={event => setSeedInput(event.target.value)} aria-label="Exhibition replay code" /><p>Same code and choices repeat the same match. This does not change difficulty.</p><button id="open-real-friendly" className="text-button real-friendly-open" onClick={() => setFriendlyOpen(true)} disabled={saving || advancing}>Real-club friendly…</button></div></details></div><div className="save-tools"><button className="text-button" onClick={openSaveHistory}>Save history</button><button className="text-button" onClick={load}>Load saved</button><button className="text-button" onClick={exportSave}><Icon name="download" size={14} />Export</button><button className="text-button" onClick={() => importRef.current?.click()}><Icon name="upload" size={14} />Import</button></div></footer>
      </main>
    </div>
    {overlays}
  </div>
}


function PlayerProfile({ player, match, managedSide, season, onPerformance, onOpenMedical, onContractReply, busy }: { player: Player; match: MatchState; managedSide: Side; season: SeasonState | null; onPerformance: () => void; onOpenMedical: () => void; onContractReply: (playerId: string, reply: ContractRequestReply) => void; busy: boolean }) {
  const contractRequest = season ? getContractRequest(season, player.id) : null
  const attributes = [['Two-point shooting', player.attributes.twoPoint], ['Three-point shooting', player.attributes.threePoint], ['Free throws', player.attributes.freeThrow], ['Passing', player.attributes.passing], ['Defense', player.attributes.defense], ['Rebounding', player.attributes.rebounding], ['Stamina', player.attributes.stamina], ...EXTRA_ATTRIBUTES.flatMap(key => player.attributes[key] === undefined ? [] : [[EXTRA_ATTRIBUTE_LABELS[key], player.attributes[key]!] as const])] as const
  return <aside className="panel player-profile" tabIndex={-1} aria-label={`${player.name} profile`}><div className="profile-portrait"><Avatar player={player} color={match[managedSide].color} size={108} /><span className="profile-number">{player.number}</span></div><span className="eyebrow accent"><PositionLabel position={player.position} profile={season ? worldOf(season).playerProfiles[player.id] : undefined} /> · {match[managedSide].name}</span><h2>{player.name}<GeneratedTag season={season} playerId={player.id} /></h2>{season && <PlayerCareerStatus season={season} playerId={player.id} />}<p className="muted">{season && getCareerPlayerAge(season, player.id, season.date) !== null && <>{getCareerPlayerAge(season, player.id, season.date)} years{worldOf(season).playerProfiles[player.id]?.source === 'estimated-from-age' ? ' (est.)' : ''} · </>}{player.heightCm} cm · {player.weightKg} kg</p>{season && <PlayerHealthSummary onOpenMedical={onOpenMedical} season={season} playerId={player.id} />}{season && contractRequest && contractRequest.seasonNumber === season.seasonNumber && <ContractRequestCard season={season} request={contractRequest} busy={busy} onReply={onContractReply} headingLevel={3} />}{season && <PlayerAgeDevelopment season={season} playerId={player.id} />}<div className="profile-divider" /><div className="section-heading"><h3>Player attributes</h3><span className="muted">1—20</span></div><div className="attribute-list">{attributes.map(([name, rating]) => <div className="attribute" key={name}><span>{name}</span><div className="attribute-track"><span style={{ width: `${rating * 5}%` }} /></div><strong>{rating}</strong></div>)}</div>{season && <div className="profile-potential" data-player-potential={player.id}><span>Potential</span><PlayerRating knowledge={getPotentialKnowledge(season, player.id)} position={player.position} label="Potential" description={POTENTIAL_RATING_DESCRIPTION} /></div>}<div className="profile-condition"><span>Current stamina</span><StaminaMeter value={season?.status === 'complete' ? season.conditions[player.id]! : match.stats[player.id]?.condition ?? season?.conditions[player.id] ?? 100} label={`${player.name} current stamina`} /></div>{season && <button className="text-button profile-performance-link" onClick={onPerformance}>Season performance<Icon name="chevron" size={14} /></button>}</aside>
}



/** Where the season stands; the one Continue on the top bar moves it on (owner request, 16 November 2026). */
function SeasonProgress({ season, onCompetition }: { season: SeasonState; onCompetition: () => void }) {
  const fixture = season.fixtures.find(item => item.id === season.activeFixtureId)
  const standing = getStandings(season).find(row => row.clubId === season.managedClubId)!
  // The day the career stands on (a midweek game day included), in the same words as the desk panel and the notices.
  const today = careerToday(season), date = gameDate(today, true)
  return <section className="season-progress panel" aria-label="Season progress">
    <div><time dateTime={today}>{date}</time><span>{season.status === 'complete' ? isMarketActive(season) ? 'Offseason recruitment' : `Season ${season.seasonNumber} complete` : `Season ${season.seasonNumber} / Matchday ${fixture?.round ?? season.round} / ${seasonRounds(season)}`}</span></div>
    <div className="season-record"><strong>{standing.played ? `${standing.position} / ${(season.world ? seasonLeagues(season.world, season.divisions) : []).find(league => league.clubIds.includes(season.managedClubId))?.clubIds.length ?? season.clubs.length}` : 'Unplayed'}</strong><span>{standing.wins} W / {standing.losses} L</span></div>
    <button className="text-button" onClick={onCompetition}>League table<Icon name="chevron" size={14} /></button>
  </section>
}

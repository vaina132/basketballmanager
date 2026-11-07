import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { InjuryMode, MatchState, Player, Side } from './domain/types'
import { createMatch, isPlayerEligible, simulateToEnd, simulateToQuarterEnd, stepMatch } from './engine/match'
import { loadLocalMatch, MAX_SAVE_BYTES, parseMatch, saveLocalMatch, serializeMatch } from './storage/match-storage'
import { Avatar } from './ui/Avatar'
import { Icon } from './ui/Icon'
import type { IconName } from './ui/Icon'
import { Court } from './viewer/Court'
import { useCourtPlayback } from './viewer/useCourtPlayback'
import { MatchCoaching, RequiredDecision } from './ui/MatchCoaching'
import { MatchLineup } from './ui/MatchLineup'
import { StaminaMeter } from './ui/StaminaMeter'
import { ManagerDesk } from './ui/ManagerDesk'
import type { SeasonState } from './domain/season'
import { createSeason, getActiveFixture, getStandings, managedSide as seasonManagedSide } from './world/season'
import { MAX_SEASON_SAVE_BYTES, parseSeason, serializeSeason } from './storage/season-storage'
import { readCareerSaves, loadCareerCheckpoint, saveCareerCheckpoint } from './storage/career-saves'
import type { CareerSaveList } from './storage/career-saves'
import { readSeasonJournal, SeasonSaveConflictError } from './storage/season-indexed-db'
import type { CheckpointReason } from './storage/season-indexed-db'
import { CareerSaveHistory } from './ui/CareerSaveHistory'
import { SeasonWorkspace } from './ui/SeasonWorkspace'
import { TrainingWorkspace } from './ui/TrainingWorkspace'
import { SquadPerformance } from './ui/SquadPerformance'
import { StaffWorkspace } from './ui/StaffWorkspace'
import { ClubWorkspace } from './ui/ClubWorkspace'
import { enableFinance, setTicketPlan } from './world/finance'
import { enableCoaching, hireCoach, releaseCoach, setCoachAssignment, setCoachRenewal } from './world/coaching'
import { enableTraining, setTrainingPlan } from './world/training'
import type { TrainingPlan } from './domain/training'
import { PlayerHealthSummary, SeasonMedicalReport } from './ui/SeasonMedicalReport'
import type { SeasonReply } from './world/season.worker'
import './ui/season-progress.css'


type Page = 'home' | 'squad' | 'match' | 'season' | 'training' | 'staff' | 'club'
type GameSession = { kind: 'exhibition'; match: MatchState } | { kind: 'season'; season: SeasonState }
type Notice = { message: string; error?: boolean }
const pageNames: Record<Page, string> = { home: "Manager's desk", squad: 'Squad', match: 'Match center', season: 'Competitions', training: 'Training', staff: 'Coaching staff', club: 'Club finances' }
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const periodLabel = (period: number) => period <= 4 ? `Q${period}` : `OT${period - 4}`
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'

function ClubMark({ name, color, large = false }: { name: string; color: string; large?: boolean }) {
  return <div className={`club-mark ${large ? 'club-mark-large' : ''}`} style={{ color }} aria-hidden="true"><Icon name="ball" size={large ? 30 : 21} /><span>{name.slice(0, 3).toUpperCase()}</span></div>
}

function Stat({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className="stat"><span className="eyebrow">{label}</span><strong>{value}</strong>{detail && <span className="muted">{detail}</span>}</div>
}

export default function App() {
  const [session, setSession] = useState<GameSession>(() => ({ kind: 'exhibition', match: createMatch(42) }))
  const sessionRef = useRef(session)
  const season = session.kind === 'season' ? session.season : null
  const match = session.kind === 'season' ? session.season.activeMatch : session.match
  const matchRef = useRef(match)
  const managedSide = season ? seasonManagedSide(season) : 'home'
  const managedTeam = match[managedSide]
  const [advancing, setAdvancing] = useState(false)
  const [seasonOperation, setSeasonOperation] = useState<'round' | 'rollover'>('round')
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
  const playback = useCourtPlayback(playing, speed, reducedMotion || textOnly)
  const { present, reset: resetPlayback, settle: settlePlayback } = playback
  const [seedInput, setSeedInput] = useState('42')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [saving, setSaving] = useState(false)
  const persistenceBusy = useRef(false)
  const savedRevision = useRef<number | null>(null)
  const revisionRead = useRef<Promise<number> | null>(null)
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
  const [squadView, setSquadView] = useState<'selection' | 'performance'>('selection')
  const [performancePlayer, setPerformancePlayer] = useState<string | null>(null)
  const [navigationTarget, setNavigationTarget] = useState<{ selector: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const setupRef = useRef<HTMLDetailsElement>(null)

  const replaceSession = useCallback((next: GameSession) => {
    replacementRequest.current += 1
    sessionRef.current = next
    matchRef.current = next.kind === 'season' ? next.season.activeMatch : next.match
    setSession(next)
  }, [])
  const replaceMatch = useCallback((next: MatchState) => {
    const current = sessionRef.current
    replaceSession(current.kind === 'season' ? { kind: 'season', season: { ...current.season, activeMatch: next } } : { kind: 'exhibition', match: next })
  }, [replaceSession])
  const apply = useCallback((action: (current: MatchState) => MatchState, animate = false, progression = false) => {
    if (seasonWorker.current || persistenceBusy.current) return
    try {
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

  const chosenPlayer = managedTeam.players.find(player => player.id === selectedPlayer) ?? managedTeam.players[0]

  const eligiblePlayers = managedTeam.players.filter(player => isPlayerEligible(match, player.id))
  const averageCondition = Math.round(managedTeam.players.reduce((sum, player) => sum + match.stats[player.id].condition, 0) / managedTeam.players.length)
  const rosterPlayers = managedTeam.players.filter(player => {
    const active = match.lineups[managedSide].includes(player.id)
    const included = rosterFilter === 'all' || rosterFilter === 'court' && active || rosterFilter === 'bench' && !active || rosterFilter === 'unavailable' && !isPlayerEligible(match, player.id)
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

  async function persistSeason(state: SeasonState, reason: Exclude<CheckpointReason, 'legacy'>): Promise<boolean> {
    if (persistenceBusy.current) return false
    persistenceBusy.current = true; setSaving(true); setPlaying(false); settlePlayback()
    try {
      const revision = await ensureSaveRevision()
      const checkpoint = await saveCareerCheckpoint(state, revision, reason)
      savedRevision.current = checkpoint.revision
      setCheckpointIssue(null)
      return true
    } catch (error) {
      const detail = messageOf(error)
      setCheckpointIssue(error instanceof SeasonSaveConflictError ? detail : `${detail} Your game is still open. Save season to retry, or Export to keep a file backup.`)
      setNotice({ message: reason === 'manual' ? 'Season was not saved. Your current game is still open.' : 'Automatic save failed. Your current game is still open.', error: true })
      return false
    } finally { persistenceBusy.current = false; setSaving(false) }
  }
  async function refreshSaveHistory() {
    const request = ++historyRequest.current
    setHistoryLoading(true); setHistoryError(null)
    try {
      const history = await readCareerSaves()
      if (request !== historyRequest.current) return
      setSaveHistory(history); setHistoryError(history.currentError)
    } catch (error) { if (request === historyRequest.current) setHistoryError(messageOf(error)) }
    finally { if (request === historyRequest.current) setHistoryLoading(false) }
  }
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
      const restored = await loadCareerCheckpoint(revision)
      if (request !== replacementRequest.current) return
      savedRevision.current = restored.revision
      install({ kind: 'season', season: restored.state })
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
  function updateCareer(action: (state: SeasonState) => SeasonState, message?: string) {
    if (seasonWorker.current || persistenceBusy.current) return
    const current = sessionRef.current
    if (current.kind !== 'season') return
    try {
      const next = action(current.season)
      setPlaying(false); settlePlayback()
      replaceSession({ kind: 'season', season: next })
      if (message) setNotice({ message })
    } catch (error) { setNotice({ message: messageOf(error), error: true }) }
  }
  function install(next: GameSession) {
    seasonJob.current += 1; seasonWorker.current?.terminate(); seasonWorker.current = null; setAdvancing(false)
    setPlaying(false); resetPlayback(); setPresentationBase(null); setCheckpointIssue(null); replaceSession(next)
    if (next.kind === 'exhibition') setPage(current => current === 'training' || current === 'staff' || current === 'club' ? 'home' : current)
    const active = next.kind === 'season' ? next.season.activeMatch : next.match
    setSeedInput(String(active.seed)); setBoxSide(next.kind === 'season' ? seasonManagedSide(next.season) : 'home')
    setSelectedPlayer(null); setRosterFilter('all'); setRosterQuery(''); setSquadView('selection'); setPerformancePlayer(null)
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
    setPlaying(false); settlePlayback()
    try {
      const saved = await readCareerSaves()
      if (request !== replacementRequest.current) return
      if (saved.currentError) {
        setSaveHistory(saved); setHistoryError(saved.currentError); setSaveHistoryOpen(true)
        return
      }
      if (!saved.current) { setNotice({ message: 'No saved season yet. Start a season to create one.' }); return }
      savedRevision.current = saved.revision
      install({ kind: 'season', season: saved.current }); setCheckpointIssue(null)
      setNotice({ message: 'Saved season restored.' }); navigate('home')
    } catch (error) { if (request !== replacementRequest.current) return; setNotice({ message: messageOf(error), error: true }) }
  }
  async function load() {
    if (seasonWorker.current || persistenceBusy.current) return
    if (sessionRef.current.kind === 'season') return loadSeason()
    const request = ++replacementRequest.current
    setPlaying(false)
    try { const saved = await loadLocalMatch(); if (request !== replacementRequest.current) return; if (!saved) { setNotice({ message: 'No saved match yet. Save this match to create one.' }); return }; install({ kind: 'exhibition', match: saved }); setNotice({ message: saved.engineVersion === 'rules-2' ? 'Saved match restored with its original simulation.' : 'Saved match restored.' }) }
    catch (error) { if (request !== replacementRequest.current) return; setNotice({ message: messageOf(error), error: true }) }
  }
  function exportSave() {
    if (seasonWorker.current || persistenceBusy.current) return
    try {
      const current = sessionRef.current
      const text = current.kind === 'season' ? serializeSeason(current.season) : serializeMatch(current.match)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = current.kind === 'season' ? `courtside-season-${current.season.seed}-year-${current.season.seasonNumber}.json` : `courtside-match-${current.match.seed}.json`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice({ message: current.kind === 'season' ? 'Season exported. Keep the file to resume on another device.' : 'Match exported. Keep the file to resume on another device.' })
    } catch (error) { setNotice({ message: messageOf(error), error: true }) }
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
        install({ kind: 'season', season: parseSeason(text) }); setNotice({ message: 'Season imported successfully.' })
      } else {
        if (file.size > MAX_SAVE_BYTES) throw new Error(`Choose a match save under ${MAX_SAVE_BYTES / 1024 / 1024} MB.`)
        const imported = parseMatch(text); install({ kind: 'exhibition', match: imported })
        setNotice({ message: imported.engineVersion === 'rules-2' ? 'Match imported successfully. Its original simulation is preserved.' : 'Match imported successfully.' })
      }
    } catch (error) { if (request !== replacementRequest.current) return; setNotice({ message: `Could not import save: ${messageOf(error)}`, error: true }) }
  }
  async function restart() {
    if (seasonWorker.current || persistenceBusy.current) return
    const seed = Number(seedInput)
    if (seedInput.trim() === '' || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) { setNotice({ message: 'Choose a whole-number seed between 0 and 4,294,967,295.', error: true }); return }
    const current = sessionRef.current
    const request = ++replacementRequest.current
    setPlaying(false); settlePlayback()
    if (current.kind === 'season') {
      setLeavingSeason(true)
      const saved = await persistSeason(current.season, 'manual')
      setLeavingSeason(false)
      if (!saved) return
      if (request !== replacementRequest.current) return
    }
    install({ kind: 'exhibition', match: createMatch(seed) }); setNotice({ message: current.kind === 'season' ? 'Season saved. New exhibition ready.' : 'New exhibition ready.' }); if (setupRef.current) setupRef.current.open = false
  }
  function startSeason(seed: number, clubId: string, injuryMode: InjuryMode) {
    if (seasonWorker.current || persistenceBusy.current) return
    try {
      const created = createSeason(seed, clubId, injuryMode)
      install({ kind: 'season', season: created }); navigate('home')
      setNotice({ message: 'Season ready. Review your lineup before the opening match.' })
      void persistSeason(created, 'new-game')
    }
    catch (error) { setNotice({ message: messageOf(error), error: true }) }
  }
  function cancelAdvance() {
    if (persistenceBusy.current || !seasonWorker.current) return
    seasonJob.current += 1; seasonWorker.current?.terminate(); seasonWorker.current = null; setAdvancing(false)
    setNotice({ message: seasonOperation === 'rollover' ? 'Season transition cancelled. Your completed season is preserved.' : 'Matchday processing cancelled. Your finished match is preserved.' })
  }
  function advance() { processSeason('round') }
  function rollover() { processSeason('rollover') }
  function processSeason(action: 'round' | 'rollover') {
    const current = sessionRef.current
    if (seasonWorker.current || persistenceBusy.current || current.kind !== 'season') return
    if (action === 'rollover' ? current.season.status !== 'complete' : current.season.status === 'complete') return
    if (current.season.activeMatch.status !== 'finished') { navigate('match'); return }
    replacementRequest.current += 1
    setPlaying(false); settlePlayback()
    try {
      const worker = new Worker(new URL('./world/season.worker.ts', import.meta.url), { type: 'module' })
      seasonWorker.current = worker; setSeasonOperation(action); setAdvancing(true)
      const requestId = ++seasonJob.current
      const finish = () => { worker.terminate(); seasonWorker.current = null; setAdvancing(false) }
      worker.onmessage = async ({ data }: MessageEvent<SeasonReply>) => {
        if (data.requestId !== seasonJob.current || seasonWorker.current !== worker) return
        finish()
        if ('error' in data) { setNotice({ message: data.error, error: true }); return }
        install({ kind: 'season', season: data.state })
        setNotice({ message: action === 'rollover' ? `Season ${data.state.seasonNumber} ready. Your previous results are in Competitions.` : data.state.status === 'complete' ? 'Season complete. Final standings and all results are available.' : `Matchday ${data.state.round - 1} recorded. Your next fixture is ready.` })
        navigate(data.state.status === 'complete' ? 'season' : 'home')
        await persistSeason(data.state, action === 'rollover' ? 'rollover' : 'matchday')
      }
      worker.onerror = () => { if (seasonWorker.current !== worker) return; finish(); setNotice({ message: action === 'rollover' ? 'Could not start the next season. Your completed season is preserved; try again.' : 'Could not process the matchday. Your match is preserved; try Continue again.', error: true }) }
      worker.postMessage({ requestId, state: current.season, action })
    } catch (error) { seasonWorker.current?.terminate(); seasonWorker.current = null; setAdvancing(false); setNotice({ message: messageOf(error), error: true }) }
  }
  useEffect(() => () => { seasonWorker.current?.terminate() }, [])

  return <div className={`app-shell game-shell ${page === 'match' ? 'match-screen' : ''}`}>
    <aside className="sidebar">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="brand"><div className="brand-symbol"><Icon name="ball" size={29} /></div><div>COURTSIDE<small>BASKETBALL MANAGER</small></div></div>
      <div className="club-context"><ClubMark name={managedTeam.shortName} color={managedTeam.color} /><div><strong>{managedTeam.name}</strong><span>First team</span></div></div>
      <nav aria-label="Main navigation" className="main-nav">
        {([{ id: 'home', label: 'Overview', icon: 'home' }, { id: 'squad', label: 'Squad', icon: 'people' }, ...(season ? [{ id: 'training', label: 'Training', icon: 'training' }, { id: 'staff', label: 'Staff', icon: 'staff' }, { id: 'club', label: 'Club', icon: 'building' }] : []), { id: 'match', label: 'Match center', icon: 'court' }, { id: 'season', label: 'Competitions', icon: 'ball' }] as { id: Page; label: string; icon: IconName }[]).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)} disabled={saving || leavingSeason} aria-label={item.label} title={item.label} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span>{page === item.id && <span className="nav-current-dot" />}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="session-mode"><span className="status-dot" />{season ? 'Season' : 'Exhibition'}</div><p>Fictional squads</p><div className="manager"><span className="manager-avatar">YOU</span><div>Head coach<small>{managedTeam.name}</small></div></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="game-context"><strong>{managedTeam.name}</strong><span>/</span><span>{pageNames[page]}</span></div><div className="topbar-actions"><span className="session-status"><span className="status-dot" />{complete ? 'Full time' : needsReplacement ? 'Decision required' : playing ? 'Match in progress' : match.status === 'ready' ? 'Pre-match' : 'Match paused'}</span><button className="button small" onClick={save} disabled={saving || advancing}><Icon name="save" size={16} />{saving ? 'Saving...' : season ? 'Save season' : 'Save match'}</button></div></header>
      {advancing && <div className="season-processing" role="status"><span>{seasonOperation === 'rollover' ? 'Preparing next season...' : 'Processing matchday results...'}</span><button className="text-button" onClick={cancelAdvance}>Cancel</button></div>}
      {checkpointIssue && <div className="career-save-issue" role="alert"><span>{checkpointIssue}</span><button className="text-button" onClick={openSaveHistory} disabled={saving || advancing}>Save history</button><button className="text-button" onClick={exportSave} disabled={saving || advancing}>Export current</button></div>}
      <main id="main" tabIndex={-1} inert={advancing || leavingSeason || saving}>
        <div className="page-heading"><h1>{pageNames[page]}</h1><div className="heading-meta"><span className="pill">{season || page === 'season' ? 'DEVELOPMENT LEAGUE' : 'EXHIBITION'}</span><span className="muted">{page === 'season' ? season ? season.date : 'Club selection' : `${match.home.shortName} vs ${match.away.shortName}`}</span></div></div>

        {season && page !== 'season' && <SeasonProgress season={season} showMatchAction={page === 'squad' || page === 'training' || page === 'staff' || page === 'club'} canContinue={complete && !playback.busy} onCompetition={() => navigate('season')} onOpenMatch={() => navigate('match')} onAdvance={advance} onRollover={rollover} />}
        {page === 'season' && <SeasonWorkspace season={season} onStart={startSeason} onOpenMatch={() => navigate('match')} onAdvance={advance} onRollover={rollover} onLoad={loadSeason} busy={advancing || saving} />}

        {page === 'training' && season && <TrainingWorkspace season={season} onEnable={() => updateTraining()} onPlanChange={updateTraining} busy={advancing || saving} onSelectPlayer={id => { setSelectedPlayer(id); setRosterFilter('all'); setRosterQuery(''); navigate('squad', '.player-profile') }} />}

        {page === 'staff' && season && <StaffWorkspace key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}`} season={season} busy={advancing || saving} onOpenTraining={() => navigate('training')} onEnable={() => updateCareer(enableCoaching, 'Coaching enabled for all clubs. Assignments will apply to future training weeks.')} onHire={(coachId, focus) => updateCareer(state => hireCoach(state, coachId, focus), 'Coach recruited. The season fee is now committed.')} onRelease={contractId => updateCareer(state => releaseCoach(state, contractId), 'Coach released. This season’s fee remains committed.')} onAssignment={(contractId, focus) => updateCareer(state => setCoachAssignment(state, contractId, focus))} onRenewal={(contractId, renew) => updateCareer(state => setCoachRenewal(state, contractId, renew))} />}

        {page === 'club' && season && <ClubWorkspace key={`${season.seed}:${season.managedClubId}`} season={season} busy={advancing || saving} onEnable={() => updateCareer(enableFinance, 'Club finances enabled. Opening funds and existing coaching fees are recorded in the ledger.')} onPlanChange={plan => updateCareer(state => setTicketPlan(state, plan))} onOpenStaff={() => navigate('staff')} />}

        {page === 'home' && <ManagerDesk season={season} match={match} managedSide={managedSide} apply={apply} fixtureLabel={season ? `Development League / Matchday ${season.round}` : undefined} onOpenMatch={() => navigate('match')} onOpenSquad={() => navigate('squad')} onSelectPlayer={id => { setSelectedPlayer(id); setRosterFilter('all'); setRosterQuery(''); navigate('squad', '.player-profile') }} onOpenCoaching={() => navigate('match', needsReplacement ? '#player-in' : complete ? '.coaching-workbench' : '#tempo')} onOpenClub={() => navigate('club')} />}

        {page === 'match' && <>
          <section className="scoreboard panel" aria-label="Match scoreboard"><div className="score-team home-team"><ClubMark name={match.home.shortName} color={match.home.color} large /><div><span className="eyebrow">{managedSide === 'home' ? 'YOUR TEAM / HOME' : 'OPPOSITION / HOME'}</span><h2>{match.home.name}</h2></div></div><div className="score-middle"><div className={`match-status ${playing ? 'is-playing' : ''}`}><span className="status-dot" />{complete && !playback.busy ? 'FULL TIME' : complete && playback.busy ? playing ? 'FINAL PLAY' : 'REPLAY PAUSED' : needsReplacement ? 'REPLACEMENT NEEDED' : playing ? 'IN PLAY' : match.stepCount === 0 ? 'READY FOR TIPOFF' : 'PAUSED'}</div><div className="score-digits" aria-live="off"><span>{displayScore.home}</span><span className="score-divider">:</span><span>{displayScore.away}</span></div><div className="match-clock">{periodLabel(match.period)}<span />{clock(match.clockSeconds)}</div></div><div className="score-team away-team"><div><span className="eyebrow">{managedSide === 'away' ? 'YOUR TEAM / AWAY' : 'OPPOSITION / AWAY'}</span><h2>{match.away.name}</h2></div><ClubMark name={match.away.shortName} color={match.away.color} large /></div></section>
          <section className="court-panel panel" aria-label="Courtside match view"><div className="court-top"><div className="court-title"><span className="live-dot" /><h2>Courtside</h2><span className="court-view-label">{textOnly ? 'MATCH COMMENTARY' : 'LIVE COURT'}</span></div><div className="viewer-options"><div className="segmented" aria-label="Match presentation"><button aria-pressed={!textOnly} className={!textOnly ? 'selected' : ''} onClick={() => setTextOnly(false)}>Court</button><button aria-pressed={textOnly} className={textOnly ? 'selected' : ''} onClick={() => setTextOnly(true)}>Text only</button></div><label className="motion-option"><input type="checkbox" checked={reducedMotion} onChange={event => setMotionOverride(event.target.checked)} />Reduced motion</label></div></div>{textOnly ? <div className="text-match-view" role="log" aria-label="Text match presentation"><span className="eyebrow">FROM THE FLOOR</span>{visibleEvents.slice(-5).map(event => <p key={event.id}><time>{periodLabel(event.period)} / {clock(event.clockSeconds)}</time>{event.text}</p>)}</div> : <Court match={match} event={presentedEvent} progress={presentedProgress} />}<div className="court-caption"><span className="event-chip">{(captionEvent?.scene?.kind ?? captionEvent?.type)?.replace('-', ' ').toUpperCase() ?? 'COURTSIDE'}</span><p>{playback.busy && presentedProgress < 1 && (presentedEvent?.shot || presentedEvent?.scene?.kind === 'free-throw') ? presentedEvent.scene?.kind === 'free-throw' ? 'Free throw in flight...' : 'Shot in flight...' : captionEvent?.text ?? 'Ready for tipoff.'}</p></div>
          <RequiredDecision match={match} managedSide={managedSide} apply={apply} />
          {match.result?.kind === 'default' && <p className="result-note" role="status">Game awarded by default: a team had fewer than two eligible players. The official result is shown above; the box score retains statistics earned on court.</p>}
          <div className="playback"><div className="playback-main"><button className="button primary watch-button" onClick={() => setPlaying(value => !value)} disabled={complete && !playback.busy || needsReplacement}><Icon name={playing ? 'pause' : 'play'} size={18} />{playing ? 'Pause' : playback.busy ? 'Resume play' : match.stepCount === 0 ? 'Start match' : complete ? 'Full time' : 'Watch match'}</button><button className="icon-button" title="Next action" aria-label="Simulate next action" onClick={() => { setPlaying(false); apply(stepMatch, false, true) }} disabled={complete || needsReplacement}><Icon name="next" size={19} /></button><div className="speed-control" aria-label="Playback speed">{[1, 2, 4].map(value => <button key={value} aria-pressed={speed === value} className={speed === value ? 'selected' : ''} onClick={() => setSpeed(value)}>{value}×</button>)}</div></div><div className="playback-skip"><button className="text-button" onClick={() => { setPlaying(false); apply(simulateToQuarterEnd, false, true) }} disabled={complete || needsReplacement}>Skip {match.period <= 4 ? 'quarter' : 'overtime'}<Icon name="next" size={15} /></button><button className="text-button" onClick={() => { setPlaying(false); apply(simulateToEnd, false, true) }} disabled={complete || needsReplacement}>Simulate rest<Icon name="skip" size={15} /></button></div></div><MatchLineup match={statsSnapshot} managedSide={managedSide} />
          </section>
          <MatchCoaching match={match} analysisMatch={statsSnapshot} managedSide={managedSide} lockInjuries={!!season} apply={apply} />
          <div className="match-lower"><section className="panel boxscore-panel"><div className="section-heading"><h2>Box score</h2><div className="segmented" aria-label="Box score team">{(['home', 'away'] as Side[]).map(side => <button key={side} aria-pressed={boxSide === side} className={boxSide === side ? 'selected' : ''} onClick={() => setBoxSide(side)}>{match[side].shortName}</button>)}</div></div><div className="table-scroll"><table className="boxscore"><thead><tr><th>PLAYER</th><th>STAMINA</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>PF</th></tr></thead><tbody>{match[boxSide].players.map(player => { const stats = statsSnapshot.stats[player.id]; const onCourt = statsSnapshot.lineups[boxSide].includes(player.id); return <tr key={player.id}><td><span className={`lineup-dot ${onCourt ? 'on' : ''}`} /><span className="jersey-number">{player.number}</span><span className="player-name">{player.name}</span><span className="position-label">{statsSnapshot.injuries[player.id] ? 'INJ' : stats.fouls >= 5 ? 'OUT' : player.position}</span></td><td className="stamina-cell"><StaminaMeter value={stats.condition} label={`${player.name} stamina`} compact /></td><td>{Math.floor(stats.secondsPlayed / 60)}</td><td className="points-cell">{stats.points}</td><td>{stats.rebounds}</td><td>{stats.assists}</td><td>{stats.fieldGoalsMade}/{stats.fieldGoalsAttempted}</td><td>{stats.fouls}</td></tr> })}</tbody></table></div><div className="table-legend"><span className="lineup-dot on" /> On the court</div></section><section className="panel feed-panel"><div className="section-heading"><h2>From the floor</h2><span className="muted">PLAY BY PLAY</span></div><div className="event-feed">{visibleEvents.slice(-7).reverse().map(event => <div className={`feed-event ${event.type === 'shot' && event.shot?.made ? 'scoring-event' : ''}`} key={event.id}><div className="feed-time">{periodLabel(event.period)}<span>{clock(event.clockSeconds)}</span></div><div><p>{event.text}</p><span className="feed-score">{match.home.shortName} {event.score.home} — {event.score.away} {match.away.shortName}</span></div></div>)}{!latestEvent && <p className="empty-state">No match events yet.</p>}</div></section></div>
        </>}

        {page === 'squad' && <>
          <div className="squad-summary panel"><div><ClubMark name={managedTeam.shortName} color={managedTeam.color} /><h2>{managedTeam.name}</h2><span className="pill">FIRST TEAM</span></div><div><Stat label="AVAILABLE" value={`${eligiblePlayers.length}/${managedTeam.players.length}`} /><Stat label="ON COURT" value={match.lineups[managedSide].length} /><Stat label="AVG. STAMINA" value={`${averageCondition}%`} /></div></div>
          {season && <div className="squad-view-controls"><div className="segmented" role="group" aria-label="Squad view"><button aria-pressed={squadView === 'selection'} className={squadView === 'selection' ? 'selected' : ''} onClick={() => setSquadView('selection')}>Selection</button><button aria-pressed={squadView === 'performance'} className={squadView === 'performance' ? 'selected' : ''} onClick={() => { setSquadView('performance'); setPerformancePlayer(null) }}>Season statistics</button></div><span>{squadView === 'selection' ? 'Current fixture and availability' : 'Committed match results'}</span></div>}
          {season && squadView === 'performance' ? <SquadPerformance key={`${season.seed}:${season.managedClubId}:${season.seasonNumber}`} season={season} selectedPlayerId={performancePlayer} onSelectPlayer={setPerformancePlayer} busy={advancing || saving} /> : <>
          <div className="squad-layout"><section className="panel roster-panel">
            <div className="section-heading"><h2>Players</h2><button className="text-button" onClick={() => navigate('match', '#player-out')}>Manage rotation <Icon name="swap" size={15} /></button></div>
            <div className="roster-toolbar"><div className="roster-filters" aria-label="Filter squad">{[{id:'all',label:'All'},{id:'court',label:'On court'},{id:'bench',label:'Bench'},{id:'unavailable',label:'Unavailable'}].map(filter => <button key={filter.id} aria-pressed={rosterFilter === filter.id} onClick={() => setRosterFilter(filter.id)}>{filter.label}</button>)}</div><label className="roster-search"><Icon name="search" size={15}/><input type="search" placeholder="Find player" aria-label="Search squad" value={rosterQuery} onChange={event => setRosterQuery(event.target.value)}/></label></div>
            <div className="table-scroll"><table className="roster"><thead><tr><th>PLAYER</th><th>STATUS</th><th>HEIGHT</th><th>STAMINA</th><th>PTS</th><th>PF</th></tr></thead><tbody>{rosterPlayers.map(player => <tr key={player.id} data-player-id={player.id} className={chosenPlayer.id === player.id ? 'selected-row' : ''}>
              <td><button className="roster-player" onClick={() => setSelectedPlayer(player.id)} aria-pressed={chosenPlayer.id === player.id}><Avatar player={player} color={managedTeam.color} size={34} /><span><strong>{player.name}</strong><small>#{player.number} / {player.position}</small></span></button></td>
              <td><span className={`roster-role ${match.lineups[managedSide].includes(player.id) ? 'on-court' : ''}`}>{!isPlayerEligible(match, player.id) ? match.injuries[player.id] ? 'Injured' : 'Fouled out' : match.lineups[managedSide].includes(player.id) ? 'On court' : 'Bench'}</span></td><td>{player.heightCm} <span className="muted">cm</span></td><td><StaminaMeter value={match.stats[player.id].condition} label={`${player.name} stamina`} compact /></td><td>{match.stats[player.id].points}</td><td>{match.stats[player.id].fouls}</td>
            </tr>)}</tbody></table>{rosterPlayers.length === 0 && <p className="roster-empty">No players match this filter.</p>}</div>
          </section><PlayerProfile player={chosenPlayer} match={match} managedSide={managedSide} season={season} onPerformance={() => { setPerformancePlayer(chosenPlayer.id); setSquadView('performance'); navigate('squad', '#player-performance-report') }} /></div>
          {season && <SeasonMedicalReport season={season} onSelectPlayer={id => { setSelectedPlayer(id); document.querySelector<HTMLElement>('.player-profile')?.focus() }} />}
          </>}
        </>}

        <footer className="workspace-footer"><div className="game-session-actions"><button className="text-button" onClick={restart} disabled={saving || advancing}><Icon name="restart" size={14} />{season ? 'Save & open exhibition' : 'New exhibition'}</button><details ref={setupRef} className="simulation-options" hidden={!!season}><summary>Match setup</summary><div className="seed-controls"><label htmlFor="match-seed">Simulation seed</label><input id="match-seed" inputMode="numeric" value={seedInput} onChange={event => setSeedInput(event.target.value)} aria-label="New match random seed" /><p>Use the same seed to replay the same starting conditions.</p></div></details></div><div className="save-tools"><button className="text-button" onClick={openSaveHistory}>Save history</button><button className="text-button" onClick={load}>Load saved</button><button className="text-button" onClick={exportSave}><Icon name="download" size={14} />Export</button><button className="text-button" onClick={() => importRef.current?.click()}><Icon name="upload" size={14} />Import</button><input ref={importRef} type="file" accept=".json,application/json" onChange={importSave} className="visually-hidden" aria-label="Import game save" /></div></footer>
      </main>
    </div>
    {saveHistoryOpen && <CareerSaveHistory entries={saveHistory?.entries ?? []} loading={historyLoading} error={historyError} busy={saving} onRefresh={() => { void refreshSaveHistory() }} onRestore={revision => { void restoreCheckpoint(revision) }} onClose={closeSaveHistory} />}
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}><Icon name={notice.error ? 'close' : 'check'} size={19} /><span>{notice.message}</span><button aria-label="Dismiss message" className="icon-button" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}
  </div>
}


function PlayerProfile({ player, match, managedSide, season, onPerformance }: { player: Player; match: MatchState; managedSide: Side; season: SeasonState | null; onPerformance: () => void }) {
  const attributes = [['Two-point shooting', player.attributes.twoPoint], ['Three-point shooting', player.attributes.threePoint], ['Free throws', player.attributes.freeThrow], ['Passing', player.attributes.passing], ['Defense', player.attributes.defense], ['Rebounding', player.attributes.rebounding], ['Stamina', player.attributes.stamina]] as const
  return <aside className="panel player-profile" tabIndex={-1} aria-label={`${player.name} profile`}><div className="profile-portrait"><Avatar player={player} color={match[managedSide].color} size={108} /><span className="profile-number">{player.number}</span></div><span className="eyebrow accent">{player.position} · {match[managedSide].name}</span><h2>{player.name}</h2><p className="muted">{player.heightCm} cm · {player.weightKg} kg</p>{season && <PlayerHealthSummary season={season} playerId={player.id} />}<div className="profile-divider" /><div className="section-heading"><h3>Player attributes</h3><span className="muted">1—20</span></div><div className="attribute-list">{attributes.map(([name, rating]) => <div className="attribute" key={name}><span>{name}</span><div className="attribute-track"><span style={{ width: `${rating * 5}%` }} /></div><strong>{rating}</strong></div>)}</div><div className="profile-condition"><span>Current stamina</span><StaminaMeter value={match.stats[player.id].condition} label={`${player.name} current stamina`} /></div>{season && <button className="text-button profile-performance-link" onClick={onPerformance}>Season performance<Icon name="chevron" size={14} /></button>}</aside>
}



function SeasonProgress({ season, showMatchAction, canContinue, onCompetition, onOpenMatch, onAdvance, onRollover }: { season: SeasonState; showMatchAction: boolean; canContinue: boolean; onCompetition: () => void; onOpenMatch: () => void; onAdvance: () => void; onRollover: () => void }) {
  const fixture = getActiveFixture(season)
  const standing = getStandings(season).find(row => row.clubId === season.managedClubId)!
  const date = new Date(`${season.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return <section className="season-progress panel" aria-label="Season progress">
    <div><time dateTime={season.date}>{date}</time><span>{season.status === 'complete' ? `Season ${season.seasonNumber} complete` : `Season ${season.seasonNumber} / Matchday ${fixture.round} / 10`}</span></div>
    <div className="season-record"><strong>{standing.played ? `${standing.position} / 6` : 'Unplayed'}</strong><span>{standing.wins} W / {standing.losses} L</span></div>
    <button className="text-button" onClick={onCompetition}>League table<Icon name="chevron" size={14} /></button>
    {season.status === 'complete' && <button className="button primary season-continue" onClick={onRollover}>Next season<Icon name="next" size={15} /></button>}
    {season.status !== 'complete' && (canContinue || showMatchAction) && <button className="button primary season-continue" onClick={canContinue ? onAdvance : onOpenMatch}>{canContinue ? season.round === 10 ? 'Finalize season' : 'Continue' : 'Go to match'}<Icon name="next" size={15} /></button>}
  </section>
}

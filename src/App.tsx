import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { MatchState, Player, Side } from './domain/types'
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

type Page = 'home' | 'squad' | 'match'
type Notice = { message: string; error?: boolean }
const pageNames: Record<Page, string> = { home: "Manager's desk", squad: 'Squad', match: 'Match center' }
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
  const [match, setMatch] = useState<MatchState>(() => createMatch(42))
  const matchRef = useRef(match)
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
  const [boxSide, setBoxSide] = useState<Side>('home')
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [rosterFilter, setRosterFilter] = useState('all')
  const [rosterQuery, setRosterQuery] = useState('')
  const [navigationTarget, setNavigationTarget] = useState<{ selector: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const setupRef = useRef<HTMLDetailsElement>(null)

  const replaceMatch = useCallback((next: MatchState) => { matchRef.current = next; setMatch(next) }, [])
  const apply = useCallback((action: (current: MatchState) => MatchState, animate = false, progression = false) => {
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

  const chosenPlayer = match.home.players.find(player => player.id === selectedPlayer) ?? match.home.players[0]

  const eligiblePlayers = match.home.players.filter(player => isPlayerEligible(match, player.id))
  const averageCondition = Math.round(match.home.players.reduce((sum, player) => sum + match.stats[player.id].condition, 0) / match.home.players.length)
  const rosterPlayers = match.home.players.filter(player => {
    const active = match.lineups.home.includes(player.id)
    const included = rosterFilter === 'all' || rosterFilter === 'court' && active || rosterFilter === 'bench' && !active || rosterFilter === 'unavailable' && !isPlayerEligible(match, player.id)
    return included && player.name.toLowerCase().includes(rosterQuery.trim().toLowerCase())
  })

  function navigate(nextPage: Page, selector = '#main') {
    setPlaying(false)
    settlePlayback()
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

  async function save() {
    setSaving(true)
    try { await saveLocalMatch(matchRef.current); setNotice({ message: 'Match saved on this device.' }) }
    catch (error) { setNotice({ message: messageOf(error), error: true }) }
    finally { setSaving(false) }
  }
  async function load() {
    setPlaying(false)
    try { const saved = await loadLocalMatch(); if (!saved) { setNotice({ message: 'No saved match yet. Save this match to create one.' }); return }; resetPlayback(); replaceMatch(saved); setSeedInput(String(saved.seed)); setNotice({ message: saved.engineVersion === 'rules-2' ? 'Saved match restored with its original simulation.' : 'Saved match restored.' }) }
    catch (error) { setNotice({ message: messageOf(error), error: true }) }
  }
  function exportSave() {
    try {
      const blob = new Blob([serializeMatch(matchRef.current)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `courtside-match-${matchRef.current.seed}.json`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice({ message: 'Match exported. Keep the file to resume on another device.' })
    } catch (error) { setNotice({ message: messageOf(error), error: true }) }
  }
  async function importSave(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPlaying(false)
    try { if (file.size > MAX_SAVE_BYTES) throw new Error(`This file is too large. Choose a Courtside match save under ${MAX_SAVE_BYTES / 1024 / 1024} MB.`); const imported = parseMatch(await file.text()); resetPlayback(); replaceMatch(imported); setSeedInput(String(imported.seed)); setNotice({ message: imported.engineVersion === 'rules-2' ? 'Match imported successfully. Its original simulation is preserved.' : 'Match imported successfully.' }) }
    catch (error) { setNotice({ message: `Could not import match: ${messageOf(error)}`, error: true }) }
  }
  function restart() {
    const seed = Number(seedInput)
    if (seedInput.trim() === '' || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) { setNotice({ message: 'Choose a whole-number seed between 0 and 4,294,967,295.', error: true }); return }
    setPlaying(false); resetPlayback(); replaceMatch(createMatch(seed)); setNotice({ message: 'New exhibition ready.' }); if (setupRef.current) setupRef.current.open = false
  }

  return <div className={`app-shell game-shell ${page === 'match' ? 'match-screen' : ''}`}>
    <aside className="sidebar">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="brand"><div className="brand-symbol"><Icon name="ball" size={29} /></div><div>COURTSIDE<small>BASKETBALL MANAGER</small></div></div>
      <div className="club-context"><ClubMark name={match.home.shortName} color={match.home.color} /><div><strong>{match.home.name}</strong><span>First team</span></div></div>
      <nav aria-label="Main navigation" className="main-nav">
        {([{ id: 'home', label: 'Overview', icon: 'home' }, { id: 'squad', label: 'Squad', icon: 'people' }, { id: 'match', label: 'Match center', icon: 'court' }] as { id: Page; label: string; icon: IconName }[]).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)} aria-label={item.label} title={item.label} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span>{page === item.id && <span className="nav-current-dot" />}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="session-mode"><span className="status-dot" />Exhibition</div><p>Fictional squads</p><div className="manager"><span className="manager-avatar">YOU</span><div>Head coach<small>{match.home.name}</small></div></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="game-context"><strong>{match.home.name}</strong><span>/</span><span>{pageNames[page]}</span></div><div className="topbar-actions"><span className="session-status"><span className="status-dot" />{complete ? 'Full time' : needsReplacement ? 'Decision required' : playing ? 'Match in progress' : match.status === 'ready' ? 'Pre-match' : 'Match paused'}</span><button className="button small" onClick={save} disabled={saving}><Icon name="save" size={16} />{saving ? 'Saving...' : 'Save match'}</button></div></header>
      <main id="main" tabIndex={-1}>
        <div className="page-heading"><h1>{pageNames[page]}</h1><div className="heading-meta"><span className="pill">EXHIBITION</span><span className="muted">{match.home.shortName} vs {match.away.shortName}</span></div></div>

        {page === 'home' && <ManagerDesk match={match} onOpenMatch={() => navigate('match')} onOpenSquad={() => navigate('squad')} onSelectPlayer={id => { setSelectedPlayer(id); setRosterFilter('all'); setRosterQuery(''); navigate('squad', '.player-profile') }} onOpenCoaching={() => navigate('match', needsReplacement ? '#player-in' : complete ? '.coaching-workbench' : '#tempo')} />}

        {page === 'match' && <>
          <section className="scoreboard panel" aria-label="Match scoreboard"><div className="score-team home-team"><ClubMark name={match.home.shortName} color={match.home.color} large /><div><span className="eyebrow">YOUR TEAM · HOME</span><h2>{match.home.name}</h2></div></div><div className="score-middle"><div className={`match-status ${playing ? 'is-playing' : ''}`}><span className="status-dot" />{complete && !playback.busy ? 'FULL TIME' : complete && playback.busy ? playing ? 'FINAL PLAY' : 'REPLAY PAUSED' : needsReplacement ? 'REPLACEMENT NEEDED' : playing ? 'IN PLAY' : match.stepCount === 0 ? 'READY FOR TIPOFF' : 'PAUSED'}</div><div className="score-digits" aria-live="off"><span>{displayScore.home}</span><span className="score-divider">:</span><span>{displayScore.away}</span></div><div className="match-clock">{periodLabel(match.period)}<span />{clock(match.clockSeconds)}</div></div><div className="score-team away-team"><div><span className="eyebrow">OPPOSITION · AWAY</span><h2>{match.away.name}</h2></div><ClubMark name={match.away.shortName} color={match.away.color} large /></div></section>
          <section className="court-panel panel" aria-label="Courtside match view"><div className="court-top"><div className="court-title"><span className="live-dot" /><h2>Courtside</h2><span className="court-view-label">{textOnly ? 'MATCH COMMENTARY' : 'LIVE COURT'}</span></div><div className="viewer-options"><div className="segmented" aria-label="Match presentation"><button aria-pressed={!textOnly} className={!textOnly ? 'selected' : ''} onClick={() => setTextOnly(false)}>Court</button><button aria-pressed={textOnly} className={textOnly ? 'selected' : ''} onClick={() => setTextOnly(true)}>Text only</button></div><label className="motion-option"><input type="checkbox" checked={reducedMotion} onChange={event => setMotionOverride(event.target.checked)} />Reduced motion</label></div></div>{textOnly ? <div className="text-match-view" role="log" aria-label="Text match presentation"><span className="eyebrow">FROM THE FLOOR</span>{visibleEvents.slice(-5).map(event => <p key={event.id}><time>{periodLabel(event.period)} / {clock(event.clockSeconds)}</time>{event.text}</p>)}</div> : <Court match={match} event={presentedEvent} progress={presentedProgress} />}<div className="court-caption"><span className="event-chip">{(captionEvent?.scene?.kind ?? captionEvent?.type)?.replace('-', ' ').toUpperCase() ?? 'COURTSIDE'}</span><p>{playback.busy && presentedProgress < 1 && (presentedEvent?.shot || presentedEvent?.scene?.kind === 'free-throw') ? presentedEvent.scene?.kind === 'free-throw' ? 'Free throw in flight...' : 'Shot in flight...' : captionEvent?.text ?? 'Ready for tipoff.'}</p></div>
          <RequiredDecision match={match} apply={apply} />
          {match.result?.kind === 'default' && <p className="result-note" role="status">Game awarded by default: a team had fewer than two eligible players. The official result is shown above; the box score retains statistics earned on court.</p>}
          <div className="playback"><div className="playback-main"><button className="button primary watch-button" onClick={() => setPlaying(value => !value)} disabled={complete && !playback.busy || needsReplacement}><Icon name={playing ? 'pause' : 'play'} size={18} />{playing ? 'Pause' : playback.busy ? 'Resume play' : match.stepCount === 0 ? 'Start match' : complete ? 'Full time' : 'Watch match'}</button><button className="icon-button" title="Next action" aria-label="Simulate next action" onClick={() => { setPlaying(false); apply(stepMatch, false, true) }} disabled={complete || needsReplacement}><Icon name="next" size={19} /></button><div className="speed-control" aria-label="Playback speed">{[1, 2, 4].map(value => <button key={value} aria-pressed={speed === value} className={speed === value ? 'selected' : ''} onClick={() => setSpeed(value)}>{value}×</button>)}</div></div><div className="playback-skip"><button className="text-button" onClick={() => { setPlaying(false); apply(simulateToQuarterEnd, false, true) }} disabled={complete || needsReplacement}>Skip {match.period <= 4 ? 'quarter' : 'overtime'}<Icon name="next" size={15} /></button><button className="text-button" onClick={() => { setPlaying(false); apply(simulateToEnd, false, true) }} disabled={complete || needsReplacement}>Simulate rest<Icon name="skip" size={15} /></button></div></div><MatchLineup match={statsSnapshot} />
          </section>
          <MatchCoaching match={match} analysisMatch={statsSnapshot} apply={apply} />
          <div className="match-lower"><section className="panel boxscore-panel"><div className="section-heading"><h2>Box score</h2><div className="segmented" aria-label="Box score team">{(['home', 'away'] as Side[]).map(side => <button key={side} aria-pressed={boxSide === side} className={boxSide === side ? 'selected' : ''} onClick={() => setBoxSide(side)}>{match[side].shortName}</button>)}</div></div><div className="table-scroll"><table className="boxscore"><thead><tr><th>PLAYER</th><th>STAMINA</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>PF</th></tr></thead><tbody>{match[boxSide].players.map(player => { const stats = statsSnapshot.stats[player.id]; const onCourt = statsSnapshot.lineups[boxSide].includes(player.id); return <tr key={player.id}><td><span className={`lineup-dot ${onCourt ? 'on' : ''}`} /><span className="jersey-number">{player.number}</span><span className="player-name">{player.name}</span><span className="position-label">{statsSnapshot.injuries[player.id] ? 'INJ' : stats.fouls >= 5 ? 'OUT' : player.position}</span></td><td className="stamina-cell"><StaminaMeter value={stats.condition} label={`${player.name} stamina`} compact /></td><td>{Math.floor(stats.secondsPlayed / 60)}</td><td className="points-cell">{stats.points}</td><td>{stats.rebounds}</td><td>{stats.assists}</td><td>{stats.fieldGoalsMade}/{stats.fieldGoalsAttempted}</td><td>{stats.fouls}</td></tr> })}</tbody></table></div><div className="table-legend"><span className="lineup-dot on" /> On the court</div></section><section className="panel feed-panel"><div className="section-heading"><h2>From the floor</h2><span className="muted">PLAY BY PLAY</span></div><div className="event-feed">{visibleEvents.slice(-7).reverse().map(event => <div className={`feed-event ${event.type === 'shot' && event.shot?.made ? 'scoring-event' : ''}`} key={event.id}><div className="feed-time">{periodLabel(event.period)}<span>{clock(event.clockSeconds)}</span></div><div><p>{event.text}</p><span className="feed-score">{match.home.shortName} {event.score.home} — {event.score.away} {match.away.shortName}</span></div></div>)}{!latestEvent && <p className="empty-state">No match events yet.</p>}</div></section></div>
        </>}

        {page === 'squad' && <>
          <div className="squad-summary panel"><div><ClubMark name={match.home.shortName} color={match.home.color} /><h2>{match.home.name}</h2><span className="pill">FIRST TEAM</span></div><div><Stat label="AVAILABLE" value={`${eligiblePlayers.length}/${match.home.players.length}`} /><Stat label="ON COURT" value={match.lineups.home.length} /><Stat label="AVG. STAMINA" value={`${averageCondition}%`} /></div></div>
          <div className="squad-layout"><section className="panel roster-panel">
            <div className="section-heading"><h2>Players</h2><button className="text-button" onClick={() => navigate('match', '#player-out')}>Manage rotation <Icon name="swap" size={15} /></button></div>
            <div className="roster-toolbar"><div className="roster-filters" aria-label="Filter squad">{[{id:'all',label:'All'},{id:'court',label:'On court'},{id:'bench',label:'Bench'},{id:'unavailable',label:'Unavailable'}].map(filter => <button key={filter.id} aria-pressed={rosterFilter === filter.id} onClick={() => setRosterFilter(filter.id)}>{filter.label}</button>)}</div><label className="roster-search"><Icon name="search" size={15}/><input type="search" placeholder="Find player" aria-label="Search squad" value={rosterQuery} onChange={event => setRosterQuery(event.target.value)}/></label></div>
            <div className="table-scroll"><table className="roster"><thead><tr><th>PLAYER</th><th>STATUS</th><th>HEIGHT</th><th>STAMINA</th><th>PTS</th><th>PF</th></tr></thead><tbody>{rosterPlayers.map(player => <tr key={player.id} data-player-id={player.id} className={chosenPlayer.id === player.id ? 'selected-row' : ''}>
              <td><button className="roster-player" onClick={() => setSelectedPlayer(player.id)} aria-pressed={chosenPlayer.id === player.id}><Avatar player={player} color={match.home.color} size={34} /><span><strong>{player.name}</strong><small>#{player.number} / {player.position}</small></span></button></td>
              <td><span className={`roster-role ${match.lineups.home.includes(player.id) ? 'on-court' : ''}`}>{!isPlayerEligible(match, player.id) ? match.injuries[player.id] ? 'Injured' : 'Fouled out' : match.lineups.home.includes(player.id) ? 'On court' : 'Bench'}</span></td><td>{player.heightCm} <span className="muted">cm</span></td><td><StaminaMeter value={match.stats[player.id].condition} label={`${player.name} stamina`} compact /></td><td>{match.stats[player.id].points}</td><td>{match.stats[player.id].fouls}</td>
            </tr>)}</tbody></table>{rosterPlayers.length === 0 && <p className="roster-empty">No players match this filter.</p>}</div>
          </section><PlayerProfile player={chosenPlayer} match={match} /></div>
        </>}

        <footer className="workspace-footer"><div className="game-session-actions"><button className="text-button" onClick={restart}><Icon name="restart" size={14} />New exhibition</button><details ref={setupRef} className="simulation-options"><summary>Match setup</summary><div className="seed-controls"><label htmlFor="match-seed">Simulation seed</label><input id="match-seed" inputMode="numeric" value={seedInput} onChange={event => setSeedInput(event.target.value)} aria-label="New match random seed" /><p>Use the same seed to replay the same starting conditions.</p></div></details></div><div className="save-tools"><button className="text-button" onClick={load}>Load saved</button><button className="text-button" onClick={exportSave}><Icon name="download" size={14} />Export</button><button className="text-button" onClick={() => importRef.current?.click()}><Icon name="upload" size={14} />Import</button><input ref={importRef} type="file" accept=".json,application/json" onChange={importSave} className="visually-hidden" aria-label="Import match save" /></div></footer>
      </main>
    </div>
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}><Icon name={notice.error ? 'close' : 'check'} size={19} /><span>{notice.message}</span><button aria-label="Dismiss message" className="icon-button" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}
  </div>
}


function PlayerProfile({ player, match }: { player: Player; match: MatchState }) {
  const attributes = [['Two-point shooting', player.attributes.twoPoint], ['Three-point shooting', player.attributes.threePoint], ['Free throws', player.attributes.freeThrow], ['Passing', player.attributes.passing], ['Defense', player.attributes.defense], ['Rebounding', player.attributes.rebounding], ['Stamina', player.attributes.stamina]] as const
  return <aside className="panel player-profile" tabIndex={-1} aria-label={`${player.name} profile`}><div className="profile-portrait"><Avatar player={player} color={match.home.color} size={108} /><span className="profile-number">{player.number}</span></div><span className="eyebrow accent">{player.position} · {match.home.name}</span><h2>{player.name}</h2><p className="muted">{player.heightCm} cm · {player.weightKg} kg</p><div className="profile-divider" /><div className="section-heading"><h3>Player attributes</h3><span className="muted">1—20</span></div><div className="attribute-list">{attributes.map(([name, rating]) => <div className="attribute" key={name}><span>{name}</span><div className="attribute-track"><span style={{ width: `${rating * 5}%` }} /></div><strong>{rating}</strong></div>)}</div><div className="profile-condition"><span>Current stamina</span><StaminaMeter value={match.stats[player.id].condition} label={`${player.name} current stamina`} /></div></aside>
}



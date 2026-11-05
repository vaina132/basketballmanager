import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { MatchState, Player, Side } from './domain/types'
import { createMatch, isPlayerEligible, simulateToEnd, simulateToQuarterEnd, stepMatch } from './engine/match'
import { loadLocalMatch, MAX_SAVE_BYTES, parseMatch, saveLocalMatch, serializeMatch } from './storage/match-storage'
import { Avatar } from './ui/Avatar'
import { Icon } from './ui/Icon'
import type { IconName } from './ui/Icon'
import { Court } from './viewer/Court'
import { MatchCoaching, MatchPolicies, RequiredDecision, RuleSummary } from './ui/MatchCoaching'

type Page = 'home' | 'squad' | 'match'
type Notice = { message: string; error?: boolean }
const pageNames: Record<Page, string> = { home: "Coach’s desk", squad: 'Your squad', match: 'Match center' }
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
  const [page, setPage] = useState<Page>('match')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [seedInput, setSeedInput] = useState('42')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [saving, setSaving] = useState(false)
  const [boxSide, setBoxSide] = useState<Side>('home')
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const replaceMatch = useCallback((next: MatchState) => { matchRef.current = next; setMatch(next) }, [])
  const apply = useCallback((action: (current: MatchState) => MatchState) => {
    try { const next = action(matchRef.current); replaceMatch(next); if (next.status === 'finished' || next.requiredSubstitutions.length > 0) setPlaying(false) }
    catch (error) { setPlaying(false); setNotice({ message: messageOf(error), error: true }) }
  }, [replaceMatch])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => apply(stepMatch), 1450 / speed)
    return () => window.clearInterval(timer)
  }, [playing, speed, apply])

  useEffect(() => {
    if (!notice || notice.error) return
    const timer = window.setTimeout(() => setNotice(null), 5500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const latestEvent = match.events.at(-1)
  const latestShot = [...match.events].reverse().find(event => event.shot)
  const complete = match.status === 'finished'
  const needsReplacement = match.requiredSubstitutions.length > 0
  const displayScore = match.result?.officialScore ?? match.score
  const homeStats = match.home.players.reduce((total, player) => { const stats = match.stats[player.id]; return { rebounds: total.rebounds + stats.rebounds, assists: total.assists + stats.assists, made: total.made + stats.fieldGoalsMade, attempted: total.attempted + stats.fieldGoalsAttempted } }, { rebounds: 0, assists: 0, made: 0, attempted: 0 })
  const chosenPlayer = match.home.players.find(player => player.id === selectedPlayer) ?? match.home.players[0]

  async function save() {
    setSaving(true)
    try { await saveLocalMatch(matchRef.current); setNotice({ message: 'Match saved on this device.' }) }
    catch (error) { setNotice({ message: messageOf(error), error: true }) }
    finally { setSaving(false) }
  }
  async function load() {
    setPlaying(false)
    try { const saved = await loadLocalMatch(); if (!saved) { setNotice({ message: 'No saved match yet. Save this match to create one.' }); return }; replaceMatch(saved); setSeedInput(String(saved.seed)); setNotice({ message: 'Saved match restored.' }) }
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
    try { if (file.size > MAX_SAVE_BYTES) throw new Error(`This file is too large. Choose a Courtside match save under ${MAX_SAVE_BYTES / 1024 / 1024} MB.`); const imported = parseMatch(await file.text()); replaceMatch(imported); setSeedInput(String(imported.seed)); setNotice({ message: 'Match imported successfully.' }) }
    catch (error) { setNotice({ message: `Could not import match: ${messageOf(error)}`, error: true }) }
  }
  function restart() {
    const seed = Number(seedInput)
    if (seedInput.trim() === '' || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) { setNotice({ message: 'Choose a whole-number seed between 0 and 4,294,967,295.', error: true }); return }
    setPlaying(false); replaceMatch(createMatch(seed)); setNotice({ message: `New exhibition ready. Seed ${seed}.` })
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="brand"><div className="brand-symbol"><Icon name="ball" size={29} /></div><div>COURTSIDE<small>BASKETBALL MANAGER</small></div></div>
      <div className="workspace-label"><span className="status-dot" /> THE COACH’S WORKSPACE</div>
      <nav aria-label="Main navigation" className="main-nav">
        {([{ id: 'home', label: 'Overview', icon: 'home' }, { id: 'squad', label: 'Squad', icon: 'people' }, { id: 'match', label: 'Match center', icon: 'court' }] as { id: Page; label: string; icon: IconName }[]).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)} aria-label={item.label} title={item.label} aria-current={page === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span>{page === item.id && <span className="nav-current-dot" />}</button>)}
      </nav>
      <div className="planned-nav"><span className="eyebrow">THE CAREER AHEAD</span>{([{ label: 'Training & academy', icon: 'training' }, { label: 'Scouting & transfers', icon: 'search' }, { label: 'Staff', icon: 'people' }, { label: 'Club & facilities', icon: 'building' }, { label: 'Inbox', icon: 'mail' }] as { label: string; icon: IconName }[]).map(item => <div className="nav-item planned" key={item.label}><Icon name={item.icon} /><span>{item.label}</span><span className="planned-label">Planned</span></div>)}</div>
      <div className="sidebar-bottom"><div className="exhibition-label">EXHIBITION LAB <span>01</span></div><p>A first look at the game.<br />Fictional clubs. Real decisions.</p><div className="manager"><span className="manager-avatar">YOU</span><div>Your touchline<small>Full control of the home team</small></div></div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">WORKSPACE <span>/</span> <strong>{pageNames[page]}</strong></div><div className="topbar-actions"><span className="local-label"><span className="status-dot" /> LOCAL SINGLE PLAYER</span><button className="button small" onClick={save} disabled={saving}><Icon name="save" size={16} />{saving ? 'Saving…' : 'Save match'}</button></div></header>
      <main id="main" tabIndex={-1}>
        <div className="page-heading"><div><p className="eyebrow">{page === 'match' ? 'THE SIDELINE IS YOURS' : page === 'squad' ? 'KNOW YOUR FIVE' : 'A NEW BASKETBALL STORY'}</p><h1>{pageNames[page]}</h1></div><div className="heading-meta"><span className="pill">EXHIBITION</span><span className="muted">{match.home.shortName} vs {match.away.shortName}</span></div></div>

        {page === 'home' && <>
          <section className="home-hero panel"><div><span className="eyebrow accent">EVERY POSSESSION MATTERS</span><h2>Make your mark<br />from the sideline.</h2><p>Find your five. Set the tempo. Make the change that turns a game. Your first exhibition is ready.</p><button className="button primary" onClick={() => setPage('match')}>Take the touchline <Icon name="arrow" size={18} /></button></div><div className="home-graphic"><Icon name="ball" size={210} /><span>01<span>THE FIRST POSSESSION</span></span></div></section>
          <div className="home-grid"><section className="panel next-fixture"><div className="section-heading"><h2>{complete ? 'Last result' : 'Your exhibition'}</h2><Icon name="court" /></div><div className="fixture-clubs"><ClubMark name={match.home.shortName} color={match.home.color} large /><strong>{match.home.shortName}<span>{displayScore.home} — {displayScore.away}</span>{match.away.shortName}</strong><ClubMark name={match.away.shortName} color={match.away.color} large /></div><p className="muted">{complete ? 'Full time' : `${periodLabel(match.period)} · ${clock(match.clockSeconds)} remaining`} · Fictional showcase clubs</p><button className="text-button" onClick={() => setPage('match')}>Open match center <Icon name="arrow" size={16} /></button></section><section className="panel"><div className="section-heading"><h2>Meet your squad</h2><Icon name="people" /></div><div className="avatar-stack">{match.home.players.slice(0, 5).map(player => <Avatar key={player.id} player={player} color={match.home.color} size={52} />)}</div><p className="muted">{match.home.players.length} players. Five places on the floor. Explore their strengths and build your rotation.</p><button className="text-button" onClick={() => setPage('squad')}>Explore the squad <Icon name="arrow" size={16} /></button></section></div>
          <section className="panel scope-panel"><span className="eyebrow accent">BUILDING THE LONG GAME</span><h2>A match foundation, with a bigger career ahead.</h2><p>This exhibition uses one action engine for watching, quarter skips and instant play. Manage foul trouble, queued substitutions, timeouts and injuries, with an assistant available to rotate your team. The court illustrates recorded actions. Continuous movement, competition-specific rules, statistical calibration and career systems remain in development.</p><div className="roadmap"><span><b>01</b> Match rules <em>Now playing</em></span><span><b>02</b> Season & club simulation</span><span><b>03</b> European basketball world</span></div></section>
        </>}

        {page === 'match' && <>
          <section className="scoreboard panel" aria-label="Match scoreboard"><div className="score-team home-team"><ClubMark name={match.home.shortName} color={match.home.color} large /><div><span className="eyebrow">YOUR TEAM · HOME</span><h2>{match.home.name}</h2><span className="team-caption">Your decisions. Your game.</span></div></div><div className="score-middle"><div className={`match-status ${playing ? 'is-playing' : ''}`}><span className="status-dot" />{complete ? 'FULL TIME' : needsReplacement ? 'REPLACEMENT NEEDED' : playing ? 'IN PLAY' : match.stepCount === 0 ? 'READY FOR TIPOFF' : 'PAUSED'}</div><div className="score-digits" aria-live="off"><span>{displayScore.home}</span><span className="score-divider">:</span><span>{displayScore.away}</span></div><div className="match-clock">{periodLabel(match.period)}<span />{clock(match.clockSeconds)}</div></div><div className="score-team away-team"><div><span className="eyebrow">OPPOSITION · AWAY</span><h2>{match.away.name}</h2><span className="team-caption">AI managed</span></div><ClubMark name={match.away.shortName} color={match.away.color} large /></div></section>
          <RuleSummary match={match} />
          <MatchPolicies match={match} apply={apply} />
          <RequiredDecision match={match} apply={apply} />
          {match.result?.kind === 'default' && <p className="result-note" role="status">Game awarded by default: a team had fewer than two eligible players. The official result is shown above; the box score retains statistics earned on court.</p>}
          <div className="match-layout"><section className="court-panel panel"><div className="court-top"><span className="eyebrow"><span className="live-dot" /> COURTSIDE VIEW</span><span className="court-view-label">DIAGONAL · 2.5D</span></div><Court match={match} /><div className="court-caption"><span className="event-chip">{latestShot?.shot ? `${latestShot.shot.made ? 'MADE' : 'MISSED'} ${latestShot.shot.value}PT` : 'TIPOFF'}</span><p>{latestShot?.text ?? 'Two teams. One court. The first possession is yours to start.'}</p></div><div className="playback"><div className="playback-main"><button className="button primary watch-button" onClick={() => setPlaying(value => !value)} disabled={complete || needsReplacement}><Icon name={playing ? 'pause' : 'play'} size={18} />{playing ? 'Pause' : match.stepCount === 0 ? 'Start match' : complete ? 'Full time' : 'Watch match'}</button><button className="icon-button" title="Next action" aria-label="Simulate next action" onClick={() => { setPlaying(false); apply(stepMatch) }} disabled={complete || needsReplacement}><Icon name="next" size={19} /></button><div className="speed-control" aria-label="Playback speed">{[1, 2, 4].map(value => <button key={value} aria-pressed={speed === value} className={speed === value ? 'selected' : ''} onClick={() => setSpeed(value)}>{value}×</button>)}</div></div><div className="playback-skip"><button className="text-button" onClick={() => { setPlaying(false); apply(simulateToQuarterEnd) }} disabled={complete || needsReplacement}>Skip {match.period <= 4 ? 'quarter' : 'overtime'}<Icon name="next" size={15} /></button><button className="text-button" onClick={() => { setPlaying(false); apply(simulateToEnd) }} disabled={complete || needsReplacement}>Simulate rest<Icon name="skip" size={15} /></button></div></div><div className="court-footnote"><span>Action-by-action playback</span><span>Same engine at every speed</span></div></section>
            <MatchCoaching match={match} apply={apply} />
          </div>
          <div className="match-lower"><section className="panel boxscore-panel"><div className="section-heading"><h2>Box score</h2><div className="segmented" aria-label="Box score team">{(['home', 'away'] as Side[]).map(side => <button key={side} aria-pressed={boxSide === side} className={boxSide === side ? 'selected' : ''} onClick={() => setBoxSide(side)}>{match[side].shortName}</button>)}</div></div><div className="table-scroll"><table className="boxscore"><thead><tr><th>PLAYER</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>PF</th></tr></thead><tbody>{match[boxSide].players.map(player => { const stats = match.stats[player.id]; const onCourt = match.lineups[boxSide].includes(player.id); return <tr key={player.id}><td><span className={`lineup-dot ${onCourt ? 'on' : ''}`} /><span className="jersey-number">{player.number}</span><span className="player-name">{player.name}</span><span className="position-label">{match.injuries[player.id] ? 'INJ' : stats.fouls >= 5 ? 'OUT' : player.position}</span></td><td>{Math.floor(stats.secondsPlayed / 60)}</td><td className="points-cell">{stats.points}</td><td>{stats.rebounds}</td><td>{stats.assists}</td><td>{stats.fieldGoalsMade}/{stats.fieldGoalsAttempted}</td><td>{stats.fouls}</td></tr> })}</tbody></table></div><div className="table-legend"><span className="lineup-dot on" /> On the court</div></section><section className="panel feed-panel"><div className="section-heading"><h2>From the floor</h2><span className="muted">PLAY BY PLAY</span></div><div className="event-feed">{match.events.slice(-7).reverse().map(event => <div className={`feed-event ${event.type === 'shot' && event.shot?.made ? 'scoring-event' : ''}`} key={event.id}><div className="feed-time">{periodLabel(event.period)}<span>{clock(event.clockSeconds)}</span></div><div><p>{event.text}</p><span className="feed-score">{match.home.shortName} {event.score.home} — {event.score.away} {match.away.shortName}</span></div></div>)}{!latestEvent && <p className="empty-state">The story starts at tipoff.</p>}</div></section></div>
        </>}

        {page === 'squad' && <><div className="squad-summary panel"><div><ClubMark name={match.home.shortName} color={match.home.color} /><h2>{match.home.name}</h2><span className="pill">{match.home.players.length} PLAYERS</span></div><div><Stat label="POINTS" value={displayScore.home} /><Stat label="REBOUNDS" value={homeStats.rebounds} /><Stat label="ASSISTS" value={homeStats.assists} /><Stat label="FIELD GOALS" value={`${homeStats.made}/${homeStats.attempted}`} /></div></div><div className="squad-layout"><section className="panel roster-panel"><div className="section-heading"><h2>The rotation</h2><span className="muted">Select a player to explore</span></div><div className="table-scroll"><table className="roster"><thead><tr><th>PLAYER</th><th>ROLE</th><th>HEIGHT</th><th>CONDITION</th></tr></thead><tbody>{match.home.players.map(player => <tr key={player.id} className={chosenPlayer.id === player.id ? 'selected-row' : ''}><td><button className="roster-player" onClick={() => setSelectedPlayer(player.id)} aria-pressed={chosenPlayer.id === player.id}><Avatar player={player} color={match.home.color} size={40} /><span><strong>{player.name}</strong><small>#{player.number} · {player.position}</small></span></button></td><td><span className={`roster-role ${match.lineups.home.includes(player.id) ? 'on-court' : ''}`}>{!isPlayerEligible(match, player.id) ? match.injuries[player.id] ? 'Injured' : 'Fouled out' : match.lineups.home.includes(player.id) ? 'On court' : 'Bench'}</span></td><td>{player.heightCm} <span className="muted">cm</span></td><td><div className="condition-value">{Math.round(match.stats[player.id].condition)}%<span className="condition-track"><span style={{ width: `${match.stats[player.id].condition}%` }} /></span></div></td></tr>)}</tbody></table></div></section><PlayerProfile player={chosenPlayer} match={match} /></div></>}

        <footer className="workspace-footer"><div className="seed-controls"><label htmlFor="match-seed">MATCH SEED</label><input id="match-seed" inputMode="numeric" value={seedInput} onChange={event => setSeedInput(event.target.value)} aria-label="New match random seed" /><button className="text-button" onClick={restart}><Icon name="restart" size={14} />New exhibition</button></div><div className="save-tools"><button className="text-button" onClick={load}>Load saved</button><button className="text-button" onClick={exportSave}><Icon name="download" size={14} />Export</button><button className="text-button" onClick={() => importRef.current?.click()}><Icon name="upload" size={14} />Import</button><input ref={importRef} type="file" accept=".json,application/json" onChange={importSave} className="visually-hidden" aria-label="Import match save" /></div></footer>
      </main>
    </div>
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}><Icon name={notice.error ? 'close' : 'check'} size={19} /><span>{notice.message}</span><button aria-label="Dismiss message" className="icon-button" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}
  </div>
}


function PlayerProfile({ player, match }: { player: Player; match: MatchState }) {
  const attributes = [['Two-point shooting', player.attributes.twoPoint], ['Three-point shooting', player.attributes.threePoint], ['Free throws', player.attributes.freeThrow], ['Passing', player.attributes.passing], ['Defense', player.attributes.defense], ['Rebounding', player.attributes.rebounding], ['Stamina', player.attributes.stamina]] as const
  return <aside className="panel player-profile"><div className="profile-portrait"><Avatar player={player} color={match.home.color} size={108} /><span className="profile-number">{player.number}</span></div><span className="eyebrow accent">{player.position} · {match.home.name}</span><h2>{player.name}</h2><p className="muted">{player.heightCm} cm · {player.weightKg} kg</p><div className="profile-divider" /><div className="section-heading"><h3>Player attributes</h3><span className="muted">1—20</span></div><div className="attribute-list">{attributes.map(([name, rating]) => <div className="attribute" key={name}><span>{name}</span><div className="attribute-track"><span style={{ width: `${rating * 5}%` }} /></div><strong>{rating}</strong></div>)}</div><p className="profile-note">Known skills for your own squad. Scouting uncertainty and player morale arrive with the career simulation.</p></aside>
}



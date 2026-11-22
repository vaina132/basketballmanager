import { memo, useMemo, useSyncExternalStore } from 'react'
import type { MatchEvent, MatchState, Player, Side } from '../domain/types'
import { attackingDirection } from '../engine/match'
import { frameAt, pathAt, rosterOf } from './choreography'
import type { Frame, Pose } from './choreography'
import { beatProgress } from './playback'
import { broadcastOf, clockAt, shotClockAt } from './flow'
import type { Beat } from './flow'
import type { PlaybackClock } from './useCourtPlayback'
import { buildCrowd, crowdCheer } from './crowd'
import type { Gate } from './crowd'
import { CrowdLayers } from './CrowdStands'
import { COURT_VIEW_BOX, project, rgb } from './projection'
/** Pixels per metre of height (the rim, at 3.05 m, is drawn 36 px above the floor). */
const LIFT = 12

export interface ScoreBugTeam { name: string; color: string; score: number; fouls: number; timeouts: number }
export interface ScoreBug { home: ScoreBugTeam; away: ScoreBugTeam; period: string; clock: string }

export interface Jersey { fill: string; text: string; trim: string }
/** Teams in similar colours (or without verified colours) stay apart: the away side then wears light jerseys with its colour as trim. */
export function jerseys(home: string, away: string): Record<Side, Jersey> {
  const a = rgb(home), b = rgb(away)
  const close = !a || !b || Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 110
  return {
    home: { fill: home, text: '#fff', trim: '#fff' },
    away: close ? { fill: '#eef0ea', text: '#1c2521', trim: away } : { fill: away, text: '#fff', trim: '#fff' },
  }
}

const HANDS: Record<Pose, [number, number, number, number]> = {
  stand: [-11, -13, 11, -13], run: [-11, -14, 11, -14], dribble: [-10, -15, 12, -9], shoot: [-3, -46, 3, -48],
  block: [-8, -49, 8, -49], reach: [-6, -48, 9, -45], 'box-out': [-16, -15, 16, -15], screen: [-3, -20, 3, -21],
  defend: [-16, -21, 16, -21], catch: [-6, -23, 6, -23], 'hand-up': [-11, -13, 3, -52], down: [-11, -13, 11, -13], walk: [-10, -13, 10, -13],
}

function CourtPlayer({ player, jersey, x, y, pose, lift, stride, active }: { player: Player; jersey: Jersey; x: number; y: number; pose: Pose; lift: number; stride: number; active: boolean }) {
  const p = project(x, y)
  const heightScale = Math.max(.9, Math.min(1.1, player.heightCm / 200))
  const wide = pose === 'defend' || pose === 'box-out' || pose === 'screen' ? 8 : 5
  const swing = pose === 'run' ? stride * 4 : 0
  const [lx, ly, rx, ry] = HANDS[pose]
  const air = lift > .05
  if (pose === 'down') {
    // A player down on the floor (an injury): lying across the court, the number still readable.
    return <g transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} className="court-player" data-player-id={player.id} data-pose={pose}>
      <title>{player.name}, number {player.number}, down injured</title>
      <ellipse cx="0" cy="2" rx="20" ry="6" fill="#17201d" opacity=".25" />
      <path d="M-22 0h9M-22-4h9" stroke="#24302b" strokeWidth="4" strokeLinecap="round" />
      <path d="M-13-8h18l2 9H-13Z" fill={jersey.fill} stroke={jersey.trim} strokeOpacity={jersey.trim === '#fff' ? .4 : 1} strokeWidth="1" />
      <circle cx="12" cy="-4" r="6" fill={player.skinTone} />
      <text x="-4" y="-1" textAnchor="middle" fontSize="7" fontWeight="800" fill={jersey.text}>{player.number}</text>
    </g>
  }
  return <g transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`} className="court-player" data-player-id={player.id} data-pose={pose}>
    <title>{player.name}, number {player.number}, {player.heightCm} cm</title>
    <ellipse cx="0" cy="3" rx={Math.max(7, 13 - lift * 6)} ry="5" fill="#17201d" opacity=".25" />
    {active && <ellipse cx="0" cy="2" rx="17" ry="7" fill="none" stroke="#faf6e8" strokeWidth="2" />}
    <g transform={`translate(0 ${(-lift * LIFT * 1.6).toFixed(1)}) scale(1 ${heightScale})`}>
      <path d={`M-4-9 ${-wide + stride * 4} ${air ? -3 : 0}M4-9 ${wide - stride * 4} ${air ? -3 : 0}`} stroke="#24302b" strokeWidth="4" strokeLinecap="round" />
      <path d={`M-8-25 ${lx - swing} ${ly}M8-25 ${rx + swing} ${ry}`} stroke={player.skinTone} strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M-7-28h14l2 18H-9Z" fill={jersey.fill} stroke={jersey.trim} strokeOpacity={jersey.trim === '#fff' ? .4 : 1} strokeWidth={jersey.trim === '#fff' ? .8 : 1.6} />
      <circle cx="0" cy="-35" r="6.5" fill={player.skinTone} />
      <path d="M-6-37q0-9 12 0v-2q-6-8-12 0Z" fill={player.hairColor} />
      <text x="0" y="-16" textAnchor="middle" fontSize="8" fontWeight="800" fill={jersey.text}>{player.number}</text>
    </g>
  </g>
}

/** A referee: grey and black striped shirt, black trousers; the one making a call raises his arm. */
function Referee({ x, y, signal, index }: { x: number; y: number; signal: boolean; index: number }) {
  const p = project(x, y)
  return <g transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(.92)`} className="court-referee" data-referee={index}>
    <ellipse cx="0" cy="3" rx="11" ry="4.5" fill="#17201d" opacity=".22" />
    <path d="M-4-9-5 0M4-9l1 9" stroke="#15191a" strokeWidth="4" strokeLinecap="round" />
    <path d={signal ? 'M-8-25-11-13M8-25l3-27' : 'M-8-25-11-13M8-25l3 12'} stroke="#8b6d5c" strokeWidth="3.6" strokeLinecap="round" fill="none" />
    <path d="M-7-28h14l2 18H-9Z" fill="#d9dcdc" stroke="#2a2f30" strokeWidth=".8" />
    <path d="M-4-28v18M0-28v18M4-28v18" stroke="#1d2224" strokeWidth="1.5" />
    <circle cx="0" cy="-35" r="6" fill="#8b6d5c" /><path d="M-6-37q0-8 12 0v-2q-6-7-12 0Z" fill="#2b2420" />
  </g>
}

/** The floor never changes, so it is drawn once and skipped on every animation frame. */
const CourtFloor = memo(function CourtFloor() {
  return <>
    <defs>
      <linearGradient id="court-floor" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#dfcbaa" /><stop offset="1" stopColor="#bba683" /></linearGradient>
      <pattern id="wood-grain" width=".07" height=".16" patternUnits="userSpaceOnUse"><rect width=".07" height=".16" fill="none" stroke="#826d4e" strokeWidth=".0008" opacity=".25" /><path d="M0 .08h.07" stroke="#faf1dc" strokeWidth=".001" opacity=".5" /></pattern>
    </defs>
    <ellipse cx="430" cy="341" rx="321" ry="34" fill="#000" opacity=".13" />
    <path d="m74 244 484 102 224-172v15L558 361 74 259Z" fill="#71674f" />
    <g transform="matrix(484 102 224 -172 74 244)">
      <rect x="-.025" y="-.045" width="1.05" height="1.09" fill="#4d6055" stroke="#829083" strokeWidth=".002" />
      <rect width="1" height="1" fill="url(#court-floor)" />
      <rect width="1" height="1" fill="url(#wood-grain)" />
      <g fill="none" stroke="#f8f1dc" strokeWidth=".0035">
        <rect width="1" height="1" /><path d="M.5 0v1" /><ellipse cx=".5" cy=".5" rx=".0643" ry=".12" />
        <path d="M0 .337h.207v.326H0m1-.326H.793v.326H1" />
        <ellipse cx=".207" cy=".5" rx=".0643" ry=".12" /><ellipse cx=".793" cy=".5" rx=".0643" ry=".12" />
        <path d="M0 .06h.107a.24 .448 0 0 1 0 .88H0m1-.88H.893a.24 .448 0 0 0 0 .88H1" />
        <path d="M.035 .44v.12m.93-.12v.12" />
      </g>
      <rect x=".001" y=".339" width=".204" height=".322" fill="#657568" opacity=".35" /><rect x=".795" y=".339" width=".204" height=".322" fill="#657568" opacity=".35" />
      {/* The scorer's table and the team benches beside the near sideline (FIBA: home bench left of the table). */}
      <rect x=".44" y="-.072" width=".12" height=".03" fill="#2c3833" stroke="#7d8a80" strokeWidth=".002" />
      <rect x=".2" y="-.105" width=".2" height=".022" fill="#3b4a43" opacity=".9" /><rect x=".6" y="-.105" width=".2" height=".022" fill="#3b4a43" opacity=".9" />
      <path d="M.5 0v-.04" stroke="#f8f1dc" strokeWidth=".0025" opacity=".5" />
    </g>
    <text x="433" y="213" textAnchor="middle" transform="rotate(12 433 213)" fill="#5c624e" opacity=".5" fontSize="20" letterSpacing="5" fontWeight="800">COURTSIDE</text>
  </>
})

const HOOP_X = [.043, .957]
const hoopDepth = (x: number) => project(x, .5).y
/** One basket; drawn in depth order with the players so nobody in front of it disappears behind the post. */
function Hoop({ x, swish }: { x: number; swish: number | null }) {
  return <>{[x].map(x => {
    const p = project(x, .5), rim = x < .5 ? 7 : -7
    const flash = swish !== null && Math.abs((swish < .5 ? .043 : .957) - x) < .01
    return <g key={x} transform={`translate(${p.x} ${p.y})`}>
      <path d="M0 0v-45" stroke="#aab4aa" strokeWidth="3" />
      <path d="M-13-55 12-50v17l-25-5Z" fill="#c3d1c5" fillOpacity=".45" stroke="#e5e9df" strokeWidth="1.5" />
      <path d={`M${rim - 7}-36l2 9h10l2-9`} fill="none" stroke="#f4f1e8" strokeWidth="1" opacity={flash ? 1 : .55} />
      <ellipse cx={rim} cy="-36" rx="8" ry="3" fill="none" stroke={flash ? '#ffcf70' : '#ed916c'} strokeWidth={flash ? 3 : 2} />
    </g>
  })}</>
}

const MARK_COLORS: Record<Frame['marks'][number]['kind'], string> = { score: '#f2b84b', miss: '#c9ccc4', block: '#ff7a6b', steal: '#6fc3ff', screen: '#e6dcc3', turnover: '#ff9d6b', call: '#ffe066', info: '#dfe9f2' }

/** The scoreboard's game clock: minutes and seconds, tenths in the last minute. */
export function scoreboardClock(seconds: number): string {
  const s = Math.max(0, seconds)
  if (s < 60) return (Math.floor(s * 10) / 10).toFixed(1)
  const whole = Math.ceil(s - 1e-6)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
/** The 24-second clock: whole seconds, tenths under five. */
export function shotClockText(seconds: number): string {
  const s = Math.max(0, seconds)
  return s < 5 ? (Math.floor(s * 10) / 10).toFixed(1) : String(Math.ceil(s - 1e-6))
}

const count = new Intl.NumberFormat('en-GB')
function ScoreBugView({ bug, kits, gate, shot }: { bug: ScoreBug; kits: Record<Side, Jersey>; gate?: Gate | null; shot?: string | null }) {
  const row = (team: ScoreBugTeam, side: Side) => <div className="bug-row" data-side={side}>
    <i style={{ background: kits[side].fill, boxShadow: `inset 0 0 0 1px ${kits[side].trim}` }} aria-hidden="true" /><b>{team.name}</b><span className="bug-score">{team.score}</span>
    <span className="bug-meta" title={`${team.fouls} team fouls this quarter, ${team.timeouts} timeouts left`}>F{team.fouls}{team.fouls >= 5 ? '+' : ''} · TO{team.timeouts}</span>
  </div>
  const attendance = gate ? `Attendance ${count.format(gate.attendance)} / ${count.format(gate.capacity)}` : null
  return <div className="score-bug" aria-label={`${bug.home.name} ${bug.home.score}, ${bug.away.name} ${bug.away.score}, ${bug.period} ${bug.clock}${attendance ? `. ${attendance}` : ''}`}>
    {row(bug.home, 'home')}{row(bug.away, 'away')}
    <div className="bug-clock"><span>{bug.period}</span><span>{bug.clock}</span>{shot !== undefined && <span className={`bug-shot${shot === null ? ' off' : Number(shot) < 5 ? ' low' : ''}`} title="Shot clock" aria-label={shot === null ? 'Shot clock off' : `Shot clock ${shot}`}>{shot ?? '--'}</span>}</div>
    {attendance && <div className="bug-crowd">{attendance}</div>}
  </div>
}

function legacyFrame(match: MatchState): Frame {
  const shotEvent = [...match.events].reverse().find(item => item.shot)
  const attacking: Side = shotEvent?.side ?? match.possession
  const direction = attackingDirection({ period: shotEvent?.period ?? match.period }, attacking)
  const spots = [[.63, .5], [.72, .14], [.72, .86], [.84, .33], [.87, .68]]
  const players = (['home', 'away'] as Side[]).flatMap(side => match.lineups[side].map((playerId, index) => {
    let [x, y] = spots[index] ?? [.5, .5]
    if (direction === -1) x = 1 - x
    if (side !== attacking) x += direction * .045
    if (playerId === shotEvent?.playerId && shotEvent.shot) { x = shotEvent.shot.x; y = shotEvent.shot.y }
    return { playerId, side, x: x!, y: y!, pose: (side === attacking ? 'stand' : 'defend') as Pose, lift: 0, stride: 0 }
  }))
  return { players, ball: { x: shotEvent?.shot?.x ?? .5, y: shotEvent?.shot?.y ?? .5, height: 2 }, marks: [] }
}

export function Court({ match, event, progress = 1, clock, reducedMotion = false, bug, gate }: { match: MatchState; event?: MatchEvent; progress?: number; clock?: PlaybackClock; reducedMotion?: boolean; bug?: ScoreBug; gate?: Gate | null }) {
  const snapshot = useSyncExternalStore(clock?.subscribe ?? noSubscribe, clock?.getSnapshot ?? noSnapshot, clock?.getSnapshot ?? noSnapshot)
  const roster = useMemo(() => rosterOf(match), [match.home.players, match.away.players]) // eslint-disable-line react-hooks/exhaustive-deps
  // The continuous broadcast (src/viewer/flow.ts): the beat on screen, or the latest one when playback rests.
  const broadcast = broadcastOf(match.events, roster)
  const live: Beat | undefined = snapshot?.beats[snapshot.index]
  const resting = event ? [...broadcast.beats].reverse().find(item => item.event.id <= event.id) : broadcast.beats.at(-1)
  const beat = live ?? resting
  const current = beat?.event ?? event
  // Before tip-off the teams wait around the centre circle for the jump ball.
  const shownProgress = live && snapshot ? beatProgress(snapshot) : match.stepCount === 0 && match.status !== 'finished' ? 0 : progress
  const animation = beat?.animation ?? null
  const frame = animation ? frameAt(animation, shownProgress, reducedMotion) : legacyFrame(match)
  const liveClock = beat && (live || match.status !== 'finished') ? scoreboardClock(clockAt(beat, shownProgress)) : null
  const liveShot = beat ? shotClockAt(beat, shownProgress) : null
  const shownBug = bug && liveClock && live ? { ...bug, clock: liveClock } : bug
  const shotText = bug ? match.status === 'finished' && !live ? undefined : liveShot === null ? null : shotClockText(liveShot) : undefined
  const players = useMemo(() => new Map((['home', 'away'] as Side[]).flatMap(side => match[side].players.map(player => [player.id, player] as const))), [match.home.players, match.away.players]) // eslint-disable-line react-hooks/exhaustive-deps
  const kits = useMemo(() => jerseys(match.home.color, match.away.color), [match.home.color, match.away.color])
  const crowd = useMemo(() => buildCrowd({ homeId: match.home.id, awayId: match.away.id, homeColor: match.home.color, awayColor: match.away.color, gate: gate ? { attendance: gate.attendance, capacity: gate.capacity } : null }),
    [match.home.id, match.away.id, match.home.color, match.away.color, gate?.attendance, gate?.capacity]) // eslint-disable-line react-hooks/exhaustive-deps
  const cheer = crowdCheer({ event: current, animation, progress: shownProgress, sideOf: id => players.get(id) ? match.home.players.some(player => player.id === id) ? 'home' : 'away' : undefined,
    finished: match.status === 'finished' && (!snapshot || snapshot.done), winner: match.result?.winner })
  // Names for the players the play is about (not the contesting defender), kept from overlapping one another.
  const roles = new Set(animation?.actors.filter(actor => actor.role !== 'contest').map(actor => actor.playerId))
  const ordered = frame.players.filter(pose => players.has(pose.playerId)).sort((a, b) => project(a.x, a.y).y - project(b.x, b.y).y)
  const ball = frame.ball
  const labels: { id: string; name: string; x: number; y: number }[] = []
  for (const pose of ordered) {
    if (!roles.has(pose.playerId) && pose.playerId !== ball.holderId) continue
    const p = project(pose.x, pose.y), name = players.get(pose.playerId)!.name.split(' ').at(-1)!
    let y = p.y + 21
    while (labels.some(other => Math.abs(other.y - y) < 13 && Math.abs(other.x - p.x) < (other.name.length + name.length) * 3.6)) y += 13
    labels.push({ id: pose.playerId, name, x: p.x, y })
  }
  const ground = project(ball.x, ball.y)
  const holderPose = ball.holderId ? frame.players.find(item => item.playerId === ball.holderId) : undefined
  // A dribbled ball drops beside the right hand; at hand height it sits in front of the body.
  const dribbleOffset = holderPose ? 10 * Math.max(0, Math.min(1, (1.25 - ball.height) / 1.1)) : 0
  const ballLift = (holderPose?.lift ?? 0) * LIFT * 1.6
  const flight = frame.flight
  let arcPath: string | null = null
  if (flight && (flight.kind === 'shot' || flight.kind === 'pass' || flight.kind === 'deflect')) {
    const a = project(flight.from.x, flight.from.y), b = project(flight.to.x, flight.to.y)
    const control = (flight.from.height + flight.to.height) / 2 + 2 * flight.arc
    arcPath = `M${a.x.toFixed(1)} ${(a.y - flight.from.height * LIFT).toFixed(1)} Q${((a.x + b.x) / 2).toFixed(1)} ${((a.y + b.y) / 2 - control * LIFT).toFixed(1)} ${b.x.toFixed(1)} ${(b.y - flight.to.height * LIFT).toFixed(1)}`
  }
  const swish = frame.marks.find(mark => mark.kind === 'score')?.x ?? null
  const referees = animation?.refs?.map(item => pathAt(item.path, reducedMotion ? 1 : Math.max(0, Math.min(1, shownProgress)))) ?? []
  const description = current?.text ?? 'Both teams are ready for the opening possession.'
  return <div className="court-presentation" data-scene-kind={current?.scene?.kind ?? 'legacy'} data-play={animation?.kind ?? 'legacy'} data-event-id={current?.id ?? 0} data-beat={beat?.key ?? ''} data-progress={shownProgress.toFixed(3)}>
    {shownBug && <ScoreBugView bug={shownBug} kits={kits} gate={gate} shot={shotText} />}
    <div className="court-stage">
    <CrowdLayers crowd={crowd} cheer={cheer} reducedMotion={reducedMotion} />
    <svg viewBox={COURT_VIEW_BOX} className="court-svg" role="img" aria-label={`Diagonal basketball court. ${description}`}>
      <CourtFloor />
      {arcPath && <path d={arcPath} fill="none" stroke={flight!.kind === 'shot' ? '#b5541f' : '#4f5d55'} strokeWidth="1.8" strokeDasharray="4 5" opacity=".7" />}
      {[...ordered.map(pose => ({ depth: project(pose.x, pose.y).y, pose })), ...HOOP_X.map(x => ({ depth: hoopDepth(x) + .5, hoop: x })), ...referees.map((point, index) => ({ depth: project(point.x, point.y).y, referee: index }))].sort((a, b) => a.depth - b.depth).map(item => {
        if ('hoop' in item) return <Hoop key={`hoop-${item.hoop}`} x={item.hoop!} swish={swish} />
        if ('referee' in item) { const point = referees[item.referee!]!; return <Referee key={`referee-${item.referee}`} index={item.referee!} x={point.x} y={point.y} signal={animation?.signal === item.referee && shownProgress > .08} /> }
        const pose = item.pose!, player = players.get(pose.playerId)!
        return <CourtPlayer key={pose.playerId} player={player} jersey={kits[pose.side]} x={pose.x} y={pose.y} pose={pose.pose} lift={pose.lift} stride={pose.stride}
          active={pose.playerId === ball.holderId} />
      })}
      {labels.map(item => <text key={item.id} className="court-name" x={item.x.toFixed(1)} y={item.y.toFixed(1)} textAnchor="middle" fill="#f2efe4" stroke="#1c2521" strokeWidth="3" paintOrder="stroke" fontSize="12" fontWeight="600">{item.name}</text>)}
      <ellipse cx={ground.x + dribbleOffset} cy={ground.y + 2} rx={Math.max(2, 6 - ball.height * .6)} ry="2" fill="#17201d" opacity=".2" />
      <g className="court-ball" transform={`translate(${(ground.x + dribbleOffset).toFixed(1)} ${(ground.y - ball.height * LIFT - ballLift).toFixed(1)})`}><circle r="5" fill="#eea361" stroke="#433225" strokeWidth="1" /><path d="M-5 0h10M0-5v10" stroke="#60422b" strokeWidth=".7" /></g>
      {frame.marks.map((mark, index) => {
        const p = project(mark.x, mark.y), above = mark.kind === 'score' || mark.kind === 'miss' ? 62 : mark.kind === 'info' ? 18 : 66
        const big = mark.kind === 'score' || mark.kind === 'info' && /END|FINAL|QUARTER|OVERTIME|TIMEOUT/.test(mark.label)
        return <g key={`${mark.kind}-${index}`} className={`court-mark court-mark-${mark.kind}`} opacity={mark.alpha.toFixed(2)}>
          {mark.kind === 'call' && <g transform={`translate(${(p.x - mark.label.length * 4.1 - 11).toFixed(1)} ${(p.y - above - 4).toFixed(1)})`} aria-hidden="true"><circle r="5.2" fill="#ffe066" stroke="#1c2521" strokeWidth="1.5" /><path d="M-2-1h5" stroke="#1c2521" strokeWidth="1.4" strokeLinecap="round" /></g>}
          <text x={p.x.toFixed(1)} y={(p.y - above).toFixed(1)} textAnchor="middle" fill={MARK_COLORS[mark.kind]} stroke="#1c2521" strokeWidth="3" paintOrder="stroke" fontSize={big ? 18 : 12} fontWeight="800" letterSpacing=".5">{mark.label}</text>
        </g>
      })}
    </svg>
    </div>
  </div>
}
const noSubscribe = () => () => {}
const noSnapshot = () => null

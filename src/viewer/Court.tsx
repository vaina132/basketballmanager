import type { MatchState, Player, Side } from '../domain/types'
import { attackingDirection } from '../engine/match'

function project(x: number, y: number) { return { x: 74 + x * 484 + y * 224, y: 244 + x * 102 - y * 172 } }

function CourtPlayer({ player, color, x, y, active }: { player: Player; color: string; x: number; y: number; active: boolean }) {
  const p = project(x, y)
  const heightScale = Math.max(.9, Math.min(1.1, player.heightCm / 200))
  return <g transform={`translate(${p.x} ${p.y}) scale(1 ${heightScale})`} className="court-player">
    <title>{player.name}, number {player.number}, {player.heightCm} cm</title>
    <ellipse cx="0" cy="3" rx="13" ry="5" fill="#17201d" opacity=".25" />
    {active && <ellipse cx="0" cy="2" rx="17" ry="7" fill="none" stroke="#faf6e8" strokeWidth="2" />}
    <path d="M-4-9-6 0M4-9 6 0" stroke="#24302b" strokeWidth="4" strokeLinecap="round" />
    <path d="M-8-25-12-14m20-11 4 11" stroke={player.skinTone} strokeWidth="4" strokeLinecap="round" />
    <path d="M-7-28h14l2 18H-9Z" fill={color} stroke="#fff" strokeOpacity=".4" strokeWidth=".8" />
    <circle cx="0" cy="-35" r="6.5" fill={player.skinTone} />
    <path d="M-6-37q0-9 12 0v-2q-6-8-12 0Z" fill={player.hairColor} />
    <text x="0" y="-16" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff">{player.number}</text>
    {active && <text x="0" y="21" textAnchor="middle" fill="#f2efe4" stroke="#1c2521" strokeWidth="3" paintOrder="stroke" fontSize="12" fontWeight="600">{player.name.split(' ').at(-1)}</text>}
  </g>
}

export function Court({ match }: { match: MatchState }) {
  const shotEvent = [...match.events].reverse().find(event => event.shot)
  const shot = shotEvent?.shot
  const attacking: Side = shotEvent?.side ?? match.possession
  const direction = attackingDirection({ ...match, period: shotEvent?.period ?? match.period }, attacking)
  const positions = [[.63, .5], [.72, .14], [.72, .86], [.84, .33], [.87, .68]]
  const players = (['home', 'away'] as Side[]).flatMap(side => match.lineups[side].map((id, index) => {
    const player = match[side].players.find(item => item.id === id)!
    let [x, y] = positions[index] ?? [.5, .5]
    if (direction === -1) x = 1 - x
    if (side !== attacking) x += direction * .045
    if (id === shotEvent?.playerId && shot) { x = shot.x; y = shot.y }
    return { player, side, x, y, active: id === shotEvent?.playerId }
  })).sort((a, b) => project(a.x, a.y).y - project(b.x, b.y).y)
  const ball = shot ? project(shot.x, shot.y) : project(.5, .5)
  const basket = project(direction === 1 ? .943 : .057, .5)
  return <svg viewBox="0 0 850 430" className="court-svg" role="img" aria-label={`Diagonal basketball court. ${shotEvent ? `Latest shot: ${shotEvent.text}` : 'Both teams are ready for the opening possession.'}`}>
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
    </g>
    <text x="433" y="213" textAnchor="middle" transform="rotate(12 433 213)" fill="#5c624e" opacity=".5" fontSize="20" letterSpacing="5" fontWeight="800">COURTSIDE</text>
    {shot && <path d={`M${ball.x} ${ball.y - 38} Q${(ball.x + basket.x) / 2} ${Math.min(ball.y, basket.y) - 100} ${basket.x} ${basket.y - 43}`} fill="none" stroke={shot.made ? '#edb178' : '#e5e0cf'} strokeWidth="1.5" strokeDasharray="4 6" opacity=".6" />}
    {players.map(({ player, side, x, y, active }) => <CourtPlayer key={player.id} player={player} color={match[side].color} x={x} y={y} active={active} />)}
    {[.043, .957].map(x => { const p = project(x, .5); return <g key={x} transform={`translate(${p.x} ${p.y})`}><path d="M0 0v-45" stroke="#aab4aa" strokeWidth="3" /><path d="M-13-55 12-50v17l-25-5Z" fill="#c3d1c5" fillOpacity=".45" stroke="#e5e9df" strokeWidth="1.5" /><ellipse cx={x < .5 ? 7 : -7} cy="-36" rx="8" ry="3" fill="none" stroke="#ed916c" strokeWidth="2" /></g> })}
    <g transform={`translate(${ball.x + 10} ${ball.y - 29})`}><circle r="5" fill="#eea361" stroke="#433225" strokeWidth="1" /><path d="M-5 0h10M0-5v10" stroke="#60422b" strokeWidth=".7" /></g>
  </svg>
}

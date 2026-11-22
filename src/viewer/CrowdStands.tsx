import { memo, useMemo, useState } from 'react'
import type { Side } from '../domain/types'
import { SKIN_TONES } from './crowd'
import type { Cheer, Crowd, Fan } from './crowd'
import { COURT_VIEW_BOX } from './projection'

const f = (value: number) => value.toFixed(1)

/** Fans as a handful of paths (one per shirt colour and skin tone), so a full arena costs a few shapes, not hundreds. */
function FanShapes({ fans, standing }: { fans: readonly Fan[]; standing: boolean }) {
  const bodies = new Map<string, string>(), arms = new Map<string, string>(), heads = SKIN_TONES.map(() => '')
  const lift = standing ? 2 : 0
  for (const fan of fans) {
    const x = fan.x, y = fan.y - lift
    bodies.set(fan.color, (bodies.get(fan.color) ?? '') + `M${f(x - 3)} ${f(y)}h6v-4a3 2.4 0 0 0-6 0Z`)
    if (standing) arms.set(fan.color, (arms.get(fan.color) ?? '') + `M${f(x - 2.6)} ${f(y - 6)}l-1.8-5.5M${f(x + 2.6)} ${f(y - 6)}l1.8-5.5`)
    heads[fan.skin] += `M${f(x - 2.1)} ${f(y - 8.4)}a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0-4.2 0`
  }
  return <>
    {[...arms].map(([color, d]) => <path key={`a${color}`} d={d} stroke={color} strokeWidth="1.6" strokeLinecap="round" fill="none" />)}
    {[...bodies].map(([color, d]) => <path key={`b${color}`} d={d} fill={color} />)}
    {heads.map((d, index) => d && <path key={`h${index}`} d={d} fill={SKIN_TONES[index]} />)}
  </>
}

/** The stands never change during a match: drawn once, on their own layer behind the court. */
const Stands = memo(function Stands({ crowd }: { crowd: Crowd }) {
  return <svg viewBox={COURT_VIEW_BOX} className="crowd-layer crowd-stands" aria-hidden="true" focusable="false">
    {crowd.stands.map(d => <path key={d} d={d} fill="#252f2b" stroke="#34413b" strokeWidth="1" />)}
    <FanShapes fans={crowd.fans} standing={false} />
  </svg>
})

function CheerLayer({ fans, delay, strength }: { fans: readonly Fan[]; delay: number; strength: Cheer['strength'] }) {
  return <svg viewBox={COURT_VIEW_BOX} className="crowd-layer crowd-cheer" data-strength={strength} style={{ animationDelay: `${delay}s` }} aria-hidden="true" focusable="false">
    <FanShapes fans={fans} standing />
  </svg>
}

/**
 * The crowd behind the court. A cheer stands up a few fans of the cheering side on separate layers that only move and
 * fade (cheap to animate); home fans rise in a wave from left to right and a home basket brightens the stands. Reduced
 * motion shows the seated crowd only.
 */
export const CrowdLayers = memo(function CrowdLayers({ crowd, cheer, reducedMotion }: { crowd: Crowd; cheer: Cheer | null; reducedMotion: boolean }) {
  // The last cheer stays shown (its layers simply finish their animation) until the next one starts.
  const [shown, setShown] = useState(cheer)
  if (cheer && cheer.key !== shown?.key) setShown(cheer)
  const groups = useMemo(() => {
    const cheering = crowd.fans.filter(fan => fan.cheers)
    const home = [0, 1, 2].map(wave => cheering.filter(fan => fan.side === 'home' && fan.wave === wave))
    return { home, away: cheering.filter(fan => fan.side === 'away') }
  }, [crowd])
  const active = !reducedMotion && shown ? shown : null
  const layers = (side: Side, cheerKey: string, strength: Cheer['strength']) => side === 'away'
    ? [<CheerLayer key={`${cheerKey}-away`} fans={groups.away} delay={0} strength={strength} />]
    : (strength === 'small' ? [1] : [0, 1, 2]).map((wave, index) => <CheerLayer key={`${cheerKey}-${wave}`} fans={groups.home[wave]!} delay={index * .14} strength={strength} />)
  return <div className="crowd" data-crowd-motion={reducedMotion ? 'off' : 'on'} data-crowd-density={crowd.density.toFixed(2)} data-cheer={active ? `${active.side}-${active.strength}` : 'none'}>
    <Stands crowd={crowd} />
    {active?.flash && <svg key={`${active.key}-flash`} viewBox={COURT_VIEW_BOX} className="crowd-layer crowd-flash" aria-hidden="true" focusable="false">{crowd.stands.map(d => <path key={d} d={d} fill="#fff6dc" />)}</svg>}
    {active && layers(active.side, active.key, active.strength)}
  </div>
}, (a, b) => a.crowd === b.crowd && a.reducedMotion === b.reducedMotion && a.cheer?.key === b.cheer?.key)

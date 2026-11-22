import { useEffect, useRef } from 'react'
import { COACH_ATTRIBUTES, COACH_ATTRIBUTE_LABELS, type CoachAttributes, type CoachStyle, type HeadCoach } from '../domain/coaches'
import type { SeasonState } from '../domain/season'
import { coachAge, coachOverall, styleWords } from '../world/coach-ratings'
import { coachPlaces, headCoach } from '../world/head-coaches'
import { Nationality } from './Nationality'
import './coach-profile.css'

/** Eight 1-20 coaching attributes as labelled bars (owner, 22 November 2026: "from 1 to 20, like players"). */
export function CoachAttributeBars({ attributes, changes }: { attributes: CoachAttributes; changes?: Partial<Record<keyof CoachAttributes, number>> }) {
  return <dl className="coach-attributes">
    {COACH_ATTRIBUTES.map(key => <div key={key} className="coach-attribute" data-coach-attribute={key} data-value={attributes[key]}>
      <dt>{COACH_ATTRIBUTE_LABELS[key]}</dt>
      <dd>
        <span className="coach-attribute-bar" aria-hidden="true"><span style={{ width: `${attributes[key] * 5}%` }} /></span>
        <strong>{attributes[key]}</strong>
        {changes?.[key] ? <small className={changes[key]! > 0 ? 'coach-change-up' : 'coach-change-down'} aria-label={changes[key]! > 0 ? 'up one this season' : 'down one this season'}>{changes[key]! > 0 ? '▲' : '▼'}</small> : null}
      </dd>
    </div>)}
  </dl>
}

/** A coach's style in plain words. */
export function CoachStyleList({ style }: { style: CoachStyle }) {
  const words = styleWords(style)
  return <dl className="coach-style" data-coach-style>
    <div><dt>Pace</dt><dd>{words.pace}</dd></div>
    <div><dt>Shooting</dt><dd>{words.shooting}</dd></div>
    <div><dt>Defence</dt><dd>{words.pressure}</dd></div>
    <div><dt>Young players</dt><dd>{words.youthTrust}</dd></div>
  </dl>
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00.000Z`))

function titlesText(coach: HeadCoach): string[] {
  const t = coach.titles, lines: string[] = []
  if (t.euroleague) lines.push(`${t.euroleague} EuroLeague title${t.euroleague > 1 ? 's' : ''}`)
  if (t.europe) lines.push(`${t.europe} other European title${t.europe > 1 ? 's' : ''}`)
  if (t.league) lines.push(`${t.league} league title${t.league > 1 ? 's' : ''}`)
  if (t.cup) lines.push(`${t.cup} cup${t.cup > 1 ? 's' : ''}`)
  if (t.national) lines.push('National-team medals')
  if (t.awards) lines.push(`${t.awards} coach of the year award${t.awards > 1 ? 's' : ''}`)
  return lines
}

/** A coach's card (dialog): job, age, nationality, attributes, style, record and his spells in this career. */
export function CoachProfileDialog({ season, coachId, onClose }: { season: SeasonState; coachId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal?.() }, [])
  const coach = headCoach(season, coachId)
  if (!coach) return null
  const places = coachPlaces(season), clubName = (id: string) => season.clubs.find(club => club.id === id)?.name ?? (season.world?.clubs.find(club => club.id === id)?.name ?? 'a club')
  const clubId = Object.entries(places.clubs).find(([, id]) => id === coachId)?.[0]
  const national = season.national?.coaches.find(entry => !entry.manager && entry.name === coach.name)
  const job = clubId ? `Head coach of ${clubName(clubId)}` : places.free.includes(coachId) ? 'Free agent' : 'Not coaching a club'
  const age = coachAge(coach.born, season.date), spells = places.spells[coachId] ?? [], titles = titlesText(coach)
  const lastFree = [...spells].reverse().find(spell => spell.clubId === null)
  return <dialog ref={ref} className="coach-profile" aria-labelledby="coach-profile-title" onClose={onClose} onCancel={onClose} data-coach-profile={coachId}>
    <header>
      <div>
        <h2 id="coach-profile-title">{coach.name}</h2>
        <p data-coach-job>{job}{!clubId && lastFree && places.free.includes(coachId) ? ` since ${formatDate(lastFree.from)}` : ''}{national ? ` · ${season.national!.teams.find(team => team.id === national.teamId)?.name ?? ''} national team` : ''}</p>
      </div>
      <button type="button" className="ghost" onClick={() => { ref.current?.close(); onClose() }} aria-label="Close coach profile">Close</button>
    </header>
    <p className="coach-profile-facts">
      {age !== null ? <span>{age} years</span> : <span>Age unknown</span>}
      {coach.nationality ? <Nationality country={coach.nationality} /> : null}
      <span>Overall <strong data-coach-overall>{coachOverall(coach.attributes)}</strong>/20</span>
      <span>Reputation {coach.reputation}</span>
      {coach.generated ? <small className="generated-tag" title="Generated coach: no free source names this club's head coach, so the game created him">Generated</small> : null}
    </p>
    <section aria-label="Attributes"><h3>Attributes</h3><CoachAttributeBars attributes={coach.attributes} /></section>
    <section aria-label="Style"><h3>Style</h3><CoachStyleList style={coach.style} /></section>
    <section aria-label="Record">
      <h3>Record</h3>
      {titles.length ? <ul className="coach-titles">{titles.map(line => <li key={line}>{line}</li>)}</ul> : <p className="coach-empty">No major titles listed.</p>}
      {coach.since ? <p className="coach-empty">Head coach since {coach.since}.</p> : null}
    </section>
    {spells.length ? <section aria-label="This career"><h3>This career</h3><ol className="coach-spells">{spells.map((spell, index) => <li key={index}><time dateTime={spell.from}>{formatDate(spell.from)}</time> {spell.clubId ? `${spell.reason === 'opening' ? 'Coach of' : 'Appointed by'} ${clubName(spell.clubId)}` : spell.reason === 'displaced' ? 'Left his club: you took over' : spell.reason === 'sacked' ? 'Sacked' : 'Looking for a club'}</li>)}</ol></section> : null}
    <p className="coach-source">{coach.generated ? 'Attributes and style are the game\'s estimate.' : <>Attributes and style are the game's estimate from his record{coach.source ? <> (<a href={coach.source} target="_blank" rel="noreferrer">source</a>)</> : null}.</>}</p>
  </dialog>
}

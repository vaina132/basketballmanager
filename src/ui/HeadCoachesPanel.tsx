import { useMemo, useState } from 'react'
import type { SeasonState } from '../domain/season'
import { worldOf } from '../world/career-world'
import { seasonLeagues } from '../world/divisions'
import { headCoach, headCoachLists, type CoachListRow } from '../world/head-coaches'
import { nationalCoachPerson } from '../world/national'
import { coachOverall } from '../world/coach-ratings'
import { lastManagedClub } from '../world/career'
import { CoachProfileDialog } from './CoachProfile'
import { Nationality } from './Nationality'
import './coach-profile.css'

/**
 * Format 82 (owner, 22 November 2026, item E): the head coaches of the manager's league and the free coaches (the real
 * coach of the manager's club among them). Each name opens the coach's profile. Head coaches are not hired by the
 * manager: he is the head coach; computer clubs hire from the free coaches when their board makes a change.
 */
export function HeadCoachesPanel({ season }: { season: SeasonState }) {
  const [open, setOpen] = useState<string | null>(null)
  const clubId = lastManagedClub(season)
  const league = useMemo(() => worldOf(season).domesticLeagues ? seasonLeagues(worldOf(season), season.divisions).find(item => item.clubIds.includes(clubId)) : undefined, [season, clubId])
  const lists = useMemo(() => headCoachLists(season, league?.clubIds ?? season.clubs.map(club => club.id)), [season, league])
  if (!season.coaches) return null
  const clubName = (id: string) => season.clubs.find(club => club.id === id)?.name ?? worldOf(season).clubs.find(club => club.id === id)?.name ?? id
  const nameCell = (row: CoachListRow) => <button type="button" className="link" onClick={() => setOpen(row.coachId)} data-coach-link={row.coachId}>{row.name}</button>
  return <section className="panel head-coaches" aria-labelledby="head-coaches-title" data-head-coaches>
    <header className="panel-heading"><h2 id="head-coaches-title">Head coaches{league ? ` · ${league.name}` : ''}</h2></header>
    <table className="coach-list" data-coach-list="league">
      <thead><tr><th>Club</th><th>Head coach</th><th className="number hide-narrow">Age</th><th className="hide-narrow">From</th><th className="number">Overall</th></tr></thead>
      <tbody>
        {league?.clubIds.includes(clubId) || season.clubs.some(club => club.id === clubId) ? <tr data-coach-row="manager"><td>{clubName(clubId)}</td><td>{season.manager?.name ?? 'You'} <small>(you)</small></td><td className="number hide-narrow" /><td className="hide-narrow" /><td className="number" /></tr> : null}
        {lists.clubs.filter(row => row.clubId !== clubId).map(row => <tr key={row.clubId} data-coach-row={row.coachId}><td>{clubName(row.clubId)}</td><td>{nameCell(row)}{row.generated ? <small className="generated-tag">Generated</small> : null}</td><td className="number hide-narrow">{row.age ?? '—'}</td><td className="hide-narrow"><Nationality country={row.nationality} compact /></td><td className="number">{row.overall}</td></tr>)}
      </tbody>
    </table>
    <h3 className="coach-list-free" id="free-coaches-title">Free head coaches</h3>
    {lists.free.length ? <table className="coach-list" aria-labelledby="free-coaches-title" data-coach-list="free">
      <thead><tr><th>Head coach</th><th className="number hide-narrow">Age</th><th className="hide-narrow">From</th><th className="number">Reputation</th><th className="number">Overall</th></tr></thead>
      <tbody>{lists.free.slice(0, 12).map(row => <tr key={row.coachId} data-coach-row={row.coachId}><td>{nameCell(row)}{row.generated ? <small className="generated-tag">Generated</small> : null}</td><td className="number hide-narrow">{row.age ?? '—'}</td><td className="hide-narrow"><Nationality country={row.nationality} compact /></td><td className="number">{row.reputation}</td><td className="number">{row.overall}</td></tr>)}</tbody>
    </table> : <p className="coach-empty">No free head coaches.</p>}
    {season.national ? <>
      <h3 className="coach-list-free" id="national-coaches-title">National team head coaches</h3>
      <table className="coach-list" aria-labelledby="national-coaches-title" data-coach-list="national">
        <thead><tr><th>Team</th><th>Head coach</th><th className="number">Overall</th></tr></thead>
        <tbody>{season.national.coaches.map(entry => {
          const team = season.national!.teams.find(item => item.id === entry.teamId)!, personId = nationalCoachPerson(season, entry.teamId), person = personId ? headCoach(season, personId) : undefined
          return <tr key={entry.teamId} data-coach-row={personId ?? entry.teamId}><td><Nationality country={team.country} /></td><td>{entry.manager ? <>{season.manager?.name ?? 'You'} <small>(you)</small></> : personId ? <button type="button" className="link" onClick={() => setOpen(personId)} data-coach-link={personId}>{entry.name}</button> : <>{entry.name} <small className="generated-tag">Generated</small></>}</td><td className="number">{person ? coachOverall(person.attributes) : ''}</td></tr>
        })}</tbody>
      </table>
    </> : null}
    <p className="coach-empty">Clubs hire a free head coach when their board replaces theirs. Attributes and styles are the game's estimate from each head coach's record.</p>
    {open && <CoachProfileDialog season={season} coachId={open} onClose={() => setOpen(null)} />}
  </section>
}

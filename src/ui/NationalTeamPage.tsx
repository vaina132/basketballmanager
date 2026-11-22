import { useMemo, useState } from 'react'
import type { SeasonState } from '../domain/season'
import { worldOf } from '../world/career-world'
import { isUnemployed } from '../world/career-rules'
import { careerEarnings, nationalCoach, nationalPlayerPool, nationalTeam, pickNationalSquad, type NationalCandidate } from '../world/national'
import { NATIONAL_RULES, nationalTournamentName, nationalWindowSaturday } from '../world/national-calendar'
import { formatEuros } from './money-format'
import { MoreInfo } from './MoreInfo'
import { Nationality } from './Nationality'
import { federationMood } from './national-inbox'
import { nationalDate } from './NationalWorkspace'
/** A summer tournament's name without its host. */
const tournamentShort = (seasonNumber: number) => nationalTournamentName(seasonNumber).replace(/ [(].*[)]$/u, '')
import './season-workspace.css'
import './national-workspace.css'

interface NationalTeamPageProps {
  season: SeasonState
  busy: boolean
  onSelect: (playerIds: string[]) => void
  onResign: () => void
  onOpenCompetitions: () => void
}

/**
 * Format 80 (owner feedback item 13, 22 November 2026): the manager's national team, in the menu only while he has the
 * job. The next games, the squad he picks from the eligible players (the rest is picked automatically), the
 * federation's confidence, the contract and the season's results.
 */
export function NationalTeamPage({ season, busy, onSelect, onResign, onOpenCompetitions }: NationalTeamPageProps) {
  const national = season.national!, job = national.job!, team = nationalTeam(national, job.teamId), coach = nationalCoach(national, job.teamId), earnings = careerEarnings(season)
  const games = national.competitions.filter(item => item.seasonNumber === season.seasonNumber).flatMap(item => item.fixtures).filter(fixture => fixture.homeTeamId === team.id || fixture.awayTeamId === team.id).sort((a, b) => a.date < b.date ? -1 : 1)
  const next = games.find(fixture => !fixture.result)
  // The pool of the next window (club conflicts and injuries as they stand now), or the summer's.
  const window = next && next.window !== 3 ? next.window : null
  const saturday = window ? nationalWindowSaturday(season.seasonNumber, window) : null
  const pool = useMemo(() => nationalPlayerPool(season, saturday ?? season.date, saturday ? { saturday } : null).get(team.country) ?? [], [season, saturday, team.country])
  const squad = useMemo(() => pickNationalSquad(team, pool, season.seed, job.selection), [team, pool, season.seed, job.selection])
  const inSquad = new Set(squad.map(item => item.player.id)), picked = new Set(job.selection)
  const [showAll, setShowAll] = useState(false)
  const world = worldOf(season)
  const clubName = (clubId: string | null) => clubId ? season.clubs.find(club => club.id === clubId)?.name ?? world.clubs.find(club => club.id === clubId)?.name ?? '—' : 'Generated player'
  const toggle = (id: string) => {
    const chosen = picked.has(id) ? job.selection.filter(item => item !== id) : [...job.selection, id]
    if (chosen.length <= NATIONAL_RULES.squadSize) onSelect(chosen)
  }
  const rows: NationalCandidate[] = [...squad.filter(item => item.generated), ...pool].filter((item, index, list) => list.findIndex(other => other.player.id === item.player.id) === index)
  const shown = showAll ? rows : rows.filter(item => inSquad.has(item.player.id))
  const opponent = (fixture: typeof games[number]) => nationalTeam(national, fixture.homeTeamId === team.id ? fixture.awayTeamId : fixture.homeTeamId)
  const resultText = (fixture: typeof games[number]) => {
    if (!fixture.result) return '–'
    const own = fixture.homeTeamId === team.id ? fixture.result.home : fixture.result.away, other = fixture.homeTeamId === team.id ? fixture.result.away : fixture.result.home
    return `${own > other ? 'W' : 'L'} ${own}–${other}`
  }

  return <div className="national-page" data-national-page={team.id}>
    <section className="panel" aria-labelledby="national-team-title">
      <header className="season-panel-heading"><h2 id="national-team-title"><Nationality country={team.country} /> national team</h2><button className="text-button" onClick={onOpenCompetitions}>Groups and results</button></header>
      <div className="national-facts">
        <div><span>Federation</span><strong data-national-confidence={coach.confidence}>{federationMood(coach.confidence)} · {coach.confidence}/100</strong></div>
        <div><span>Next game</span><strong>{next ? `${nationalDate(next.date)} · ${next.homeTeamId === team.id ? 'v' : 'at'} ${opponent(next).name}` : 'None this season'}</strong></div>
        <div><span>Contract</span><strong>To the {tournamentShort(job.untilSeason)}</strong></div>
        <div><span>Salary</span><strong>{formatEuros(job.salary)} a season · paid monthly</strong></div>
        <div><span>Career earnings</span><strong data-national-earnings={earnings?.total ?? 0}>{formatEuros(earnings?.total ?? 0)}</strong></div>
      </div>
      {isUnemployed(season) && <p className="muted national-panel-body">Without a club, you still coach your national games: Continue stops for them and they open in the Match center.</p>}
      <div className="national-actions"><button className="button small" onClick={() => { if (globalThis.confirm?.(`Resign as head coach of ${team.name}? Your club job is not affected.`) ?? true) onResign() }} disabled={busy}>Resign</button></div>
    </section>

    <section className="panel" aria-labelledby="national-squad-title">
      <header className="season-panel-heading"><h2 id="national-squad-title">Squad {next ? `for ${nationalDate(next.date)}` : ''}</h2><span>{picked.size}/{NATIONAL_RULES.squadSize} picked by you · the rest automatic</span></header>
      <div className="national-actions" style={{ paddingTop: 10 }}>
        <button className="button small" onClick={() => onSelect([])} disabled={busy || !picked.size}>Auto pick all</button>
        <label className="season-own-filter"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Show every eligible player ({pool.length})</label>
      </div>
      <div className="season-table-scroll"><table className="season-standings-table national-squad-table"><thead><tr><th scope="col">Pick</th><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">OVR</th><th scope="col">Club</th><th scope="col">Squad</th></tr></thead>
        <tbody>{shown.map(item => <tr key={item.player.id} className={inSquad.has(item.player.id) ? 'season-managed-row' : ''} data-national-player={item.player.id}>
          <td>{item.generated ? '' : <input type="checkbox" aria-label={`Pick ${item.player.name}`} checked={picked.has(item.player.id)} disabled={busy || !picked.has(item.player.id) && picked.size >= NATIONAL_RULES.squadSize} onChange={() => toggle(item.player.id)} />}</td>
          <th scope="row">{item.player.name}{item.generated && <small className="muted"> · Generated</small>}</th><td>{item.player.position}</td><td>{item.ovr}</td><td>{clubName(item.clubId)}</td>
          <td>{inSquad.has(item.player.id) ? picked.has(item.player.id) ? 'Your pick' : 'Automatic' : '—'}</td></tr>)}</tbody></table></div>
      <MoreInfo label="Who can be picked">
        <p>Players of {team.country} in the game's world. For a window, players whose club plays a game that week stay with their club, and injured players cannot travel. When fewer than twelve can be picked, generated players fill the squad.</p>
      </MoreInfo>
    </section>

    <section className="season-fixtures panel" aria-labelledby="national-games-title">
      <header className="season-panel-heading"><h2 id="national-games-title">This season's games</h2></header>
      <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Date</th><th scope="col">Opponent</th><th scope="col">Result</th></tr></thead>
        <tbody>{games.map(fixture => <tr key={fixture.id} data-national-game={fixture.id}><td><time dateTime={fixture.date}>{nationalDate(fixture.date)}</time></td><td>{fixture.homeTeamId === team.id ? 'v' : 'at'} <Nationality country={opponent(fixture).country} compact /> {opponent(fixture).name}</td><td className="season-fixture-score">{resultText(fixture)}</td></tr>)}</tbody></table></div>
    </section>
  </div>
}

/** The unemployed desk's card for a national job kept without a club (format 80). */
export function NationalJobCard({ season, onOpen }: { season: SeasonState; onOpen: () => void }) {
  const national = season.national, job = national?.job
  if (!national || !job) return null
  const team = nationalTeam(national, job.teamId), coach = nationalCoach(national, job.teamId)
  const next = national.competitions.filter(item => item.seasonNumber === season.seasonNumber).flatMap(item => item.fixtures).filter(fixture => !fixture.result && (fixture.homeTeamId === team.id || fixture.awayTeamId === team.id)).sort((a, b) => a.date < b.date ? -1 : 1)[0]
  return <section className="panel national-job-card" aria-labelledby="national-job-card-title" data-national-job-card={team.id}>
    <header className="season-panel-heading"><h2 id="national-job-card-title">You still coach <Nationality country={team.country} /></h2><button className="text-button" onClick={onOpen}>Open national team</button></header>
    <div className="national-facts">
      <div><span>Federation</span><strong>{federationMood(coach.confidence)} · {coach.confidence}/100</strong></div>
      <div><span>Next game</span><strong>{next ? nationalDate(next.date) : 'None this season'}</strong></div>
      <div><span>Contract</span><strong>To the {tournamentShort(job.untilSeason)}</strong></div>
    </div>
  </section>
}

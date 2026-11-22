import { useMemo, useState } from 'react'
import type { NationalCompetition, NationalFixture } from '../domain/national'
import type { SeasonState } from '../domain/season'
import { clubWindowCallUps, nationalPlayerInfo, nationalPodium, nationalTable, nationalTeam, upcomingNationalWindow, type ClubCallUps } from '../world/national'
import { nationalWindowDays } from '../world/national-calendar'
import { seasonLabel } from '../world/season'
import { isUnemployed } from '../world/career-rules'
import { MoreInfo } from './MoreInfo'
import { Nationality } from './Nationality'
import './season-workspace.css'
import './national-workspace.css'

const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const nationalDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const WINDOWS: Record<number, string> = { 1: 'November window', 2: 'February window', 3: 'Summer tournament' }
const STAGES: Record<string, string> = { semi: 'Semi-final', third: 'Third place', final: 'Final' }
const signed = (value: number) => value > 0 ? `+${value}` : String(value)

function TeamName({ season, teamId, yours = false }: { season: SeasonState; teamId: string; yours?: boolean }) {
  const team = nationalTeam(season.national!, teamId)
  return <span className="national-team-name"><Nationality country={team.country} compact /><span>{team.name}{yours && <small>Your team</small>}</span></span>
}

/** Who scored most for each side, from the stored points. */
function topScorers(season: SeasonState, fixture: NationalFixture): string {
  if (!fixture.result) return ''
  const best = (ids: readonly string[]) => { const id = [...ids].sort((a, b) => (fixture.result!.points[b] ?? 0) - (fixture.result!.points[a] ?? 0))[0]; return id ? `${nationalPlayerInfo(season, id).name} ${fixture.result!.points[id] ?? 0}` : '' }
  return `${best(fixture.result.squads.home)} · ${best(fixture.result.squads.away)}`
}

/** The managed club's players in a window's squads, as a short list. */
export function CallUpList({ season, callUps }: { season: SeasonState; callUps: ClubCallUps }) {
  if (!callUps.players.length) return <p className="muted">None of your players {callUps.played ? 'was' : 'is'} called up.</p>
  return <ul className="national-callups">{callUps.players.map(item => <li key={item.playerId}><strong>{nationalPlayerInfo(season, item.playerId).name}</strong><TeamName season={season} teamId={item.teamId} />{item.minutes !== null && <span className="muted">{item.minutes} min</span>}</li>)}</ul>
}

/**
 * Format 80 (owner feedback item 13, 22 November 2026): Competitions > National teams. The season's qualifier groups and
 * games by window, the summer tournament, and the managed club's players on national duty. Everything shown comes
 * from the career's national records.
 */
export function NationalWorkspace({ season }: { season: SeasonState }) {
  const national = season.national!
  const competitions = useMemo(() => [...national.competitions].sort((a, b) => b.seasonNumber - a.seasonNumber || (a.kind === 'qualifiers' ? 1 : -1)), [national.competitions])
  const current = competitions.find(item => item.seasonNumber === season.seasonNumber && item.kind === 'qualifiers') ?? competitions[0]!
  const [selected, setSelected] = useState(current.id)
  const competition: NationalCompetition = competitions.find(item => item.id === selected) ?? current
  const yours = national.job?.teamId ?? null
  const [ownOnly, setOwnOnly] = useState(false)
  const unemployed = isUnemployed(season)
  const window = upcomingNationalWindow(season)
  const callUps = useMemo(() => {
    if (unemployed) return null
    if (window) return clubWindowCallUps(season, season.managedClubId, window.seasonNumber, window.window)
    const played = ([2, 1] as const).find(item => national.competitions.find(entry => entry.seasonNumber === season.seasonNumber && entry.kind === 'qualifiers')?.fixtures.some(fixture => fixture.window === item && fixture.result))
    return played ? clubWindowCallUps(season, season.managedClubId, season.seasonNumber, played) : null
  }, [season, window, unemployed, national.competitions])
  const podium = competition.kind === 'tournament' ? nationalPodium(competition) : null
  const unplayed = competition.fixtures.filter(fixture => !fixture.result).map(fixture => fixture.date).sort()
  const games = competition.fixtures.filter(fixture => !ownOnly || fixture.homeTeamId === yours || fixture.awayTeamId === yours).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  const knockouts = competition.fixtures.filter(fixture => fixture.stage !== 'group')

  return <div className="season-workspace national-workspace" data-national-workspace>
    <section className="season-matchday panel" aria-label="National competition">
      <div className="season-matchday-identity">
        <div className="season-year-filter"><label htmlFor="national-competition">Competition</label><select id="national-competition" aria-label="National competition" value={competition.id} onChange={event => setSelected(event.target.value)}>
          {competitions.map(item => <option key={item.id} value={item.id}>{item.name} · {seasonLabel(item.seasonNumber)}</option>)}
        </select></div>
      </div>
      <div className="season-matchday-action"><p data-national-status>{podium ? <><TeamName season={season} teamId={podium[0]!} yours={podium[0] === yours} /> won the {competition.name}.</> : unplayed.length ? `Next games: ${[...new Set(unplayed)].slice(0, 2).map(nationalDate).join(' and ')}.` : competition.kind === 'qualifiers' ? 'All games played. The top three of each group play the summer tournament.' : ''}</p></div>
    </section>

    {callUps && <section className="season-standings panel" aria-labelledby="national-callups-title" data-national-callups>
      <header className="season-panel-heading"><h2 id="national-callups-title">{callUps.played ? 'Your players on national duty' : 'Your players called up'}</h2><span>{WINDOWS[callUps.window]} · {nationalWindowDays(callUps.seasonNumber, callUps.window).map(nationalDate).join(' and ')}</span></header>
      <div className="national-panel-body"><CallUpList season={season} callUps={callUps} /></div>
    </section>}

    <section className="season-standings panel" aria-labelledby="national-tables-title">
      <header className="season-panel-heading"><h2 id="national-tables-title">Groups</h2>{competition.kind === 'qualifiers' && <span>Top three of each group qualify</span>}</header>
      <div className="national-groups">{competition.groups.map(group => <div key={group.id}><h3 className="europe-group-title">{group.name}</h3><div className="season-table-scroll"><table className="season-standings-table"><caption className="sr-only">{group.name}</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">L</th><th scope="col">+/−</th><th scope="col">Pts</th></tr></thead>
        <tbody>{nationalTable(national, competition, group.id).map((row, index) => <tr key={row.teamId} className={row.teamId === yours ? 'season-managed-row' : ''} data-national-row={row.teamId}><td>{index + 1}</td><th scope="row"><TeamName season={season} teamId={row.teamId} yours={row.teamId === yours} /></th><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{signed(row.pointsFor - row.pointsAgainst)}</td><td>{row.points}</td></tr>)}</tbody></table></div></div>)}</div>
    </section>

    {knockouts.length > 0 && <section className="season-standings panel" aria-labelledby="national-knockouts-title">
      <header className="season-panel-heading"><h2 id="national-knockouts-title">Semi-finals and final</h2></header>
      <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Round</th><th scope="col">Home</th><th scope="col">Score</th><th scope="col">Away</th></tr></thead>
        <tbody>{knockouts.map(fixture => <tr key={fixture.id}><td>{STAGES[fixture.stage]}</td><td><TeamName season={season} teamId={fixture.homeTeamId} /></td><td className="season-fixture-score">{fixture.result ? `${fixture.result.home}–${fixture.result.away}` : '–'}</td><td><TeamName season={season} teamId={fixture.awayTeamId} /></td></tr>)}</tbody></table></div>
    </section>}

    <section className="season-fixtures panel" aria-labelledby="national-fixtures-title">
      <header className="season-panel-heading season-fixtures-heading"><h2 id="national-fixtures-title">Games &amp; results</h2>{yours && <label className="season-own-filter"><input type="checkbox" checked={ownOnly} onChange={event => setOwnOnly(event.target.checked)} /> Your team only</label>}</header>
      <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Date</th><th scope="col">Home</th><th scope="col">Score</th><th scope="col">Away</th><th scope="col">Stage</th><th scope="col">Top scorers</th></tr></thead>
        <tbody>{games.map(fixture => <tr key={fixture.id} className={fixture.homeTeamId === yours || fixture.awayTeamId === yours ? 'season-managed-row' : ''} data-national-fixture={fixture.id}>
          <td><time dateTime={fixture.date}>{nationalDate(fixture.date)}</time></td><td><TeamName season={season} teamId={fixture.homeTeamId} /></td>
          <td className="season-fixture-score">{fixture.result ? `${fixture.result.home}–${fixture.result.away}` : '–'}</td><td><TeamName season={season} teamId={fixture.awayTeamId} /></td>
          <td>{fixture.stage === 'group' ? `${competition.groups.find(group => group.id === fixture.groupId)?.name ?? ''} · ${WINDOWS[fixture.window]}` : STAGES[fixture.stage]}</td><td className="muted">{topScorers(season, fixture)}</td></tr>)}</tbody></table></div>
    </section>

    <MoreInfo label="How national teams work">
      <p>National teams play in FIBA windows in late November and late February: on the Thursday and the Saturday. Leagues with room in their calendar do not play that weekend.</p>
      <p>Head coaches pick twelve players of their country. Players whose club plays a game that week stay with their club, as EuroLeague clubs do. Called-up players miss club training from Wednesday to Saturday and come back tired.</p>
      <p>Tables: 2 points for a win, 1 for a loss, then point difference. The top three of each group play the summer tournament. {seasonLabel(1)}: the game plays the last two windows of the real second round; its table starts at zero.</p>
      <p>When a country has fewer than twelve players in the game, generated players fill the squad.</p>
    </MoreInfo>
  </div>
}

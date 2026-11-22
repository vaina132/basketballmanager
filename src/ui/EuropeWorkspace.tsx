import { useMemo, useState } from 'react'
import type { ArchivedFixture, SeasonFixture, SeasonState, Standing } from '../domain/season'
import type { Team } from '../domain/types'
import type { BackgroundLeague } from '../domain/world'
import { worldOf } from '../world/career-world'
import { managedClubFor } from '../world/career'
import { isUnemployed } from '../world/career-rules'
import { seasonLeagues, type DomesticLeague } from '../world/divisions'
import { europeanEntrants, getEuropeanCompetitions } from '../world/europe'
import { playedEuropeanCompetitions } from '../world/european-formats'
import { estimatedTable } from '../world/european-places'
import { seasonLabel } from '../world/season'
import { NOT_PLAYED_LEAGUE } from './career-text'
import { ClubBadge, InlineLogo } from './ClubLogo'
import { CountryFlag } from './CountryFlag'
import { SeasonWorkspace } from './SeasonWorkspace'
import './season-workspace.css'
import { EuropeanPlacesPanel } from './EuropeanPlacesPanel'

const STAGES: Record<string, string> = { qualifying: 'Qualification', 'play-in': 'Play-in', 'round-of-16': 'Round of 16', 'quarter-final': 'Quarter-finals', 'semi-final': 'Semi-finals', 'third-place': 'Third place', final: 'Final' }
const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00Z`))
const signed = (value: number) => value > 0 ? `+${value}` : String(value)

function ClubName({ club, yours = false }: { club: Team; yours?: boolean }) {
  return <span className="season-club-name"><ClubBadge club={club} className="season-club-code" /><span>{club.name}{yours && <small>Your club</small>}</span></span>
}

/** A season's European places: the current season's, or an archived season's. */
function seasonEurope(season: SeasonState, seasonNumber: number) {
  return seasonNumber === season.seasonNumber ? season.europe : season.history.find(entry => entry.seasonNumber === seasonNumber)?.europe
}

/**
 * The European competitions a club plays in a season (owner, 22 November 2026, evening: International lists only
 * these), from the season's entrant lists.
 */
export function clubEuropeanCompetitions(season: SeasonState, clubId: string, seasonNumber = season.seasonNumber): string[] {
  if (!clubId) return []
  const europe = seasonEurope(season, seasonNumber)
  return playedEuropeanCompetitions(worldOf(season)).filter(competition => europeanEntrants(competition, europe).includes(clubId)).map(competition => competition.id)
}

function SeasonPicker({ id, season, value, onChange }: { id: string; season: SeasonState; value: number; onChange: (seasonNumber: number) => void }) {
  return <div className="season-year-filter"><label htmlFor={id}>Season</label><select id={id} value={value} onChange={event => onChange(Number(event.target.value))}>
    <option value={season.seasonNumber}>{seasonLabel(season.seasonNumber)} · Current</option>
    {[...season.history].reverse().map(item => <option key={item.seasonNumber} value={item.seasonNumber}>{seasonLabel(item.seasonNumber)} · Archived</option>)}
  </select></div>
}

/**
 * Competitions > International (owner, 22 November 2026, evening; step 3.5g before): the European competitions the
 * manager's club plays in the season shown, with their tables or groups, knockout rounds, games and results; the other
 * European competitions stay a click away in a smaller set of buttons (a EuroCup club can still follow the EuroLeague).
 * A manager without a club sees every competition. Everything shown comes from the career's games and records.
 */
export function InternationalWorkspace({ season, competitionId, onCompetitionChange }: { season: SeasonState; competitionId?: string | null; onCompetitionChange?: (id: string) => void }) {
  const world = worldOf(season)
  const [selectedSeason, setSelectedSeason] = useState(season.seasonNumber)
  const archive = season.history.find(entry => entry.seasonNumber === selectedSeason)
  const fixtures: readonly (SeasonFixture | ArchivedFixture)[] = archive?.fixtures ?? season.fixtures
  const europe = archive ? archive.europe : season.europe
  const competitions = useMemo(() => getEuropeanCompetitions({ world, seed: season.seed, fixtures, ...(europe ? { europe } : {}) }, selectedSeason), [world, season.seed, fixtures, europe, selectedSeason])
  // The club the manager ran in the season shown ('' without a club: then every competition is listed).
  const managedId = managedClubFor(season, selectedSeason, false)
  const own = useMemo(() => new Set(clubEuropeanCompetitions(season, managedId, selectedSeason)), [season, managedId, selectedSeason])
  const shown = managedId ? competitions.filter(item => own.has(item.competition.id) || fixtures.some(fixture => fixture.competition === item.competition.id && (fixture.homeClubId === managedId || fixture.awayClubId === managedId))) : competitions
  // The competitions the club does not play, behind smaller buttons; never opened by default.
  const others = managedId ? competitions.filter(item => !shown.includes(item)) : []
  const [chosen, setChosen] = useState<string | null>(competitionId ?? null)
  const entry = competitions.find(item => item.competition.id === chosen) ?? shown[0]
  const ownEntry = !!entry && shown.includes(entry)
  const [ownOnly, setOwnOnly] = useState(false)
  const club = (id: string) => season.clubs.find(team => team.id === id) ?? world.clubs.find(team => team.id === id)!
  const choose = (id: string) => { setChosen(id); onCompetitionChange?.(id) }
  const current = selectedSeason === season.seasonNumber

  const table = (rows: readonly Standing[], caption: string) => <div className="season-table-scroll"><table className="season-standings-table"><caption className="sr-only">{caption}</caption><thead><tr><th scope="col">#</th><th scope="col">Club</th><th scope="col" title="Played">P</th><th scope="col" title="Wins">W</th><th scope="col" title="Losses">L</th><th scope="col" title="Points scored">PF</th><th scope="col" title="Points conceded">PA</th><th scope="col" title="Point difference">+/-</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.clubId} className={row.clubId === managedId ? 'season-managed-row' : ''}><td>{row.position}</td><th scope="row"><ClubName club={club(row.clubId)} yours={row.clubId === managedId} /></th><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.pointsFor}</td><td>{row.pointsAgainst}</td><td>{signed(row.difference)}</td></tr>)}</tbody></table></div>

  const games = entry ? fixtures.filter(fixture => fixture.competition === entry.competition.id && (!ownOnly || fixture.homeClubId === managedId || fixture.awayClubId === managedId)) : []
  const label = (fixture: SeasonFixture | ArchivedFixture) => fixture.stage ? `${STAGES[fixture.stage] ?? fixture.stage}${fixture.stage === 'round-of-16' ? ` · Group ${fixture.seriesId?.replace('r16-', '')}` : fixture.game && entry?.series.find(series => series.id === fixture.seriesId)?.bestOf !== 1 ? ` · Game ${fixture.game}` : ''}` : 'Regular season'
  const champion = entry?.outcome.champion ? club(entry.outcome.champion) : null

  return <div className="season-workspace europe-workspace" data-competitions-view="international">
    <section className="season-matchday panel" aria-label="European competition">
      <div className="season-matchday-identity">
        {shown.length > 1 || shown.length === 1 && others.length > 0 ? <div className="segmented competition-choice" role="group" aria-label={managedId ? 'Your European competitions' : 'European competition'}>{shown.map(item => <button key={item.competition.id} type="button" data-competition-option={item.competition.id} aria-pressed={entry?.competition.id === item.competition.id} className={entry?.competition.id === item.competition.id ? 'selected' : ''} onClick={() => choose(item.competition.id)}><InlineLogo kind="competition" id={item.competition.id} name={item.competition.name} size={18} decorative />{item.competition.name}</button>)}</div>
          : entry && !others.length ? <h2 className="season-club-name season-league-name"><InlineLogo kind="competition" id={entry.competition.id} name={entry.competition.name} size={26} decorative /><span>{entry.competition.name}</span></h2> : null}
        {others.length > 0 && <div className="competition-others" role="group" aria-labelledby="competition-others-label"><span id="competition-others-label">Other European competitions</span><div>{others.map(item => <button key={item.competition.id} type="button" data-other-competition={item.competition.id} aria-pressed={entry?.competition.id === item.competition.id} className={entry?.competition.id === item.competition.id ? 'selected' : ''} onClick={() => choose(item.competition.id)}><InlineLogo kind="competition" id={item.competition.id} name={item.competition.name} size={14} decorative />{item.competition.name}</button>)}</div></div>}
        <SeasonPicker id="europe-season" season={season} value={selectedSeason} onChange={value => { setSelectedSeason(value); setChosen(null) }} />
      </div>
      <div className="season-matchday-action"><p data-international-status>{managedId && !shown.length && competitions.length > 0 && <>{current ? 'Your club plays no European competition this season.' : `Your club played no European competition in ${seasonLabel(selectedSeason)}.`}{entry && ' '}</>}{entry ? champion ? <><strong>{champion.name}</strong> win the {entry.competition.name}.</> : `${entry.format.label}: ${entry.table.length || europeanEntrants(entry.competition, europe).length} clubs.` : !competitions.length ? 'No European competition is played in this career.' : null}</p></div>
    </section>

    {entry && <>
      {entry.tables.filter(group => group.rows.length).length > 0 && <section className="season-standings panel" aria-labelledby="europe-tables-title">
        <header className="season-panel-heading"><h2 id="europe-tables-title">{entry.tables.length > 1 ? 'Groups' : 'Regular-season table'}</h2></header>
        {entry.tables.filter(group => group.rows.length).map(group => <div key={group.id ?? 'table'}>{group.id && <h3 className="europe-group-title">Group {group.id}</h3>}{table(group.rows, group.id ? `Group ${group.id}` : entry.competition.name)}</div>)}
        <details className="season-table-rules"><summary>Table rules <span>FIBA default · Classification points</span></summary><p>The competition's own tie-break text has not been checked, so the game uses the FIBA Official Basketball Rules 2026, Appendix D: 2 points for a win, 1 for a loss, then the games between tied clubs.</p></details>
      </section>}
      {entry.roundOf16.some(group => group.rows.length) && <section className="season-standings panel" aria-labelledby="europe-r16-title">
        <header className="season-panel-heading"><h2 id="europe-r16-title">Round of 16</h2></header>
        {entry.roundOf16.filter(group => group.rows.length).map(group => <div key={group.id ?? 'r16'}><h3 className="europe-group-title">Group {group.id}</h3>{table(group.rows, `Round of 16 group ${group.id}`)}</div>)}
      </section>}
      {entry.series.some(series => series.higher) && <section className="season-standings panel" aria-labelledby="europe-series-title">
        <header className="season-panel-heading"><h2 id="europe-series-title">Knockout rounds</h2></header>
        <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Round</th><th scope="col">Better seed</th><th scope="col">Wins</th><th scope="col">Opponent</th><th scope="col">Format</th></tr></thead>
          <tbody>{entry.series.filter(series => series.higher && series.lower).map(series => <tr key={series.id} className={[series.higher!.clubId, series.lower!.clubId].includes(managedId) ? 'season-managed-row' : ''}>
            <td>{STAGES[series.stage] ?? series.stage}</td><td><ClubName club={club(series.higher!.clubId)} yours={series.higher!.clubId === managedId} />{series.winner === series.higher!.clubId && <small> · through</small>}</td>
            <td>{series.wins[series.higher!.clubId]}–{series.wins[series.lower!.clubId]}</td><td><ClubName club={club(series.lower!.clubId)} yours={series.lower!.clubId === managedId} />{series.winner === series.lower!.clubId && <small> · through</small>}</td>
            <td>{series.bestOf === 1 ? 'Single game' : `Best of ${series.bestOf}`}{series.neutral ? ' · one venue' : ''}</td></tr>)}</tbody></table></div>
      </section>}
      <section className="season-fixtures panel" aria-labelledby="europe-fixtures-title">
        <header className="season-panel-heading season-fixtures-heading"><h2 id="europe-fixtures-title">Games &amp; results</h2>{managedId && ownEntry && <label className="season-own-filter"><input type="checkbox" checked={ownOnly} onChange={event => setOwnOnly(event.target.checked)} /> Your club only</label>}</header>
        <div className="season-table-scroll"><table className="season-fixtures-table"><thead><tr><th scope="col">Date</th><th scope="col">Home</th><th scope="col">Score</th><th scope="col">Away</th><th scope="col">Stage</th></tr></thead>
          <tbody>{games.map(fixture => <tr key={fixture.id} className={fixture.homeClubId === managedId || fixture.awayClubId === managedId ? 'season-managed-row' : ''}>
            <td><time dateTime={fixture.date}>{formatDate(fixture.date)}</time></td><td><ClubName club={club(fixture.homeClubId)} /></td>
            <td className="season-fixture-score">{fixture.result ? `${fixture.result.officialScore.home}–${fixture.result.officialScore.away}` : '–'}</td><td><ClubName club={club(fixture.awayClubId)} /></td><td>{label(fixture)}</td></tr>)}</tbody></table></div>
        {!games.length && <p className="muted">No games yet.</p>}
      </section>
    </>}
    {/* Format 83: how European places work, your club's status and next season's places (careers with European entry rules). */}
    <EuropeanPlacesPanel season={season} />
  </div>
}

/** A league of European Leagues: another played domestic league, or a country's league with a simulated table. */
interface LeagueChoice { id: string; name: string; country: string; tier: number; played: boolean }
const TIERS: Record<number, string> = { 1: 'Top division', 2: 'Second division', 3: 'Third division' }

/**
 * Every domestic league besides the manager's own, by country (his own country first, then A-Z), top division first:
 * the played leagues, then the leagues of countries not chosen at career start (simulated tables).
 */
export function otherLeagues(season: SeasonState): { country: string; leagues: LeagueChoice[] }[] {
  const world = worldOf(season)
  const played: readonly DomesticLeague[] = world.domesticLeagues ? seasonLeagues(world, season.divisions) : []
  const own = isUnemployed(season) ? undefined : played.find(league => league.clubIds.includes(season.managedClubId))
  const choices: LeagueChoice[] = [
    ...played.filter(league => league.id !== own?.id).map(league => ({ id: league.id, name: league.name, country: league.country, tier: league.tier, played: true })),
    ...(world.backgroundLeagues ?? []).map((league: BackgroundLeague) => ({ id: league.id, name: league.name, country: league.country, tier: league.tier, played: false })),
  ]
  const countries = [...new Set(choices.map(choice => choice.country))].sort((a, b) => (a === own?.country ? -1 : b === own?.country ? 1 : a.localeCompare(b, 'en')))
  return countries.map(country => ({ country, leagues: choices.filter(choice => choice.country === country).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'en')) }))
}

/** The league European Leagues opens on: the first top division listed, else the first league. */
export function defaultOtherLeague(groups: readonly { leagues: readonly LeagueChoice[] }[]): string | null {
  const all = groups.flatMap(group => group.leagues)
  return (all.find(league => league.tier === 1) ?? all[0])?.id ?? null
}

/**
 * Competitions > European Leagues (owner, 22 November 2026, evening: it replaces the Europe page's drop-down list):
 * every other domestic league, picked from a list of buttons grouped by country. A played league shows its table,
 * playoffs, statistics and games; a league of a country not chosen shows its simulated final table.
 */
export function EuropeanLeaguesWorkspace({ season, leagueId, onLeagueChange, onOpenMatch, onNewCareer, onLoad, busy = false }: { season: SeasonState; leagueId?: string | null; onLeagueChange?: (id: string) => void; onOpenMatch: () => void; onNewCareer: () => void; onLoad: () => void; busy?: boolean }) {
  const groups = useMemo(() => otherLeagues(season), [season])
  const [chosen, setChosen] = useState<string | null>(leagueId ?? null)
  const all = groups.flatMap(group => group.leagues)
  const selected = all.find(league => league.id === chosen) ?? all.find(league => league.id === defaultOtherLeague(groups))
  const choose = (id: string) => { setChosen(id); onLeagueChange?.(id) }
  if (!selected) return <div className="season-workspace"><section className="panel season-intro"><p>No other league is in this career.</p></section></div>
  return <div className="season-workspace european-leagues" data-competitions-view="leagues">
    <section className="panel league-picker" aria-labelledby="league-picker-title">
      <header className="season-panel-heading"><h2 id="league-picker-title">Choose a league</h2><span>{all.length} {all.length === 1 ? 'league' : 'leagues'}</span></header>
      <div className="league-picker-countries">{groups.map(group => {
        const titleId = `league-country-${group.country.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        return <div key={group.country} className="league-picker-country" role="group" aria-labelledby={titleId}>
          <h3 id={titleId}><CountryFlag country={group.country} decorative />{group.country}</h3>
          <div className="league-picker-options">{group.leagues.map(league => <button key={league.id} type="button" className={`league-option${league.id === selected.id ? ' selected' : ''}`} aria-pressed={league.id === selected.id} data-league-option={league.id} onClick={() => choose(league.id)}>
            <span className="league-option-logo"><InlineLogo kind="competition" id={league.id} name={league.name} size={22} decorative /></span>
            <span><strong>{league.name}</strong><small>{league.played ? TIERS[league.tier] ?? `Division ${league.tier}` : NOT_PLAYED_LEAGUE.tag}</small></span>
          </button>)}</div>
        </div>
      })}</div>
    </section>
    {selected.played
      ? <SeasonWorkspace season={season} leagueId={selected.id} onOpenMatch={onOpenMatch} onNewCareer={onNewCareer} onLoad={onLoad} busy={busy} />
      : <SimulatedLeague key={selected.id} season={season} league={(worldOf(season).backgroundLeagues ?? []).find(league => league.id === selected.id)!} />}
  </div>
}

/** A league of a country not chosen at career start: its simulated final table for the season shown. */
function SimulatedLeague({ season, league }: { season: SeasonState; league: BackgroundLeague }) {
  const world = worldOf(season)
  const [selectedSeason, setSelectedSeason] = useState(season.seasonNumber)
  const club = (id: string) => season.clubs.find(team => team.id === id) ?? world.clubs.find(team => team.id === id)!
  return <>
    <section className="season-matchday panel" aria-label={`${league.name} season`} data-season-league={league.id}>
      <div className="season-matchday-identity">
        <span className="season-club-name season-league-name"><InlineLogo kind="competition" id={league.id} name={league.name} size={26} decorative /><span>{league.name}<small>{league.country}</small></span></span>
        <SeasonPicker id="simulated-league-season" season={season} value={selectedSeason} onChange={setSelectedSeason} />
      </div>
      <div className="season-matchday-action"><p>{league.name} is not played game by game in this career: {NOT_PLAYED_LEAGUE.table}</p></div>
    </section>
    <section className="season-standings panel" aria-labelledby="europe-estimated-title">
      <header className="season-panel-heading"><h2 id="europe-estimated-title">{league.name} · Simulated final table</h2></header>
      <div className="season-table-scroll"><table className="season-standings-table simulated-table"><thead><tr><th scope="col">#</th><th scope="col">Club</th><th scope="col" title="Strength of the best eight players plus the season's random element">Strength</th></tr></thead>
        <tbody>{estimatedTable(season, league, selectedSeason).map((row, index) => <tr key={row.clubId}><td>{index + 1}</td><th scope="row"><ClubName club={club(row.clubId)} /></th><td>{row.estimate.toFixed(1)}</td></tr>)}</tbody></table></div>
      <p className="muted">Not played game by game: clubs are ranked by the strength of their best eight players plus a random element. The order only decides who plays in Europe next season.</p>
    </section>
  </>
}

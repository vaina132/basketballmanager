import type { SeasonState } from '../domain/season'
import { worldOf } from '../world/career-world'
import { governingDerby, RIVALRY_BOARD_CAP, RIVALRY_BOARD_POINTS, RIVALRY_CROWD_PERCENT } from '../world/rivalries'
import { grownRivalriesOf, RIVALRY_GROWTH_RULES } from '../world/rivalry-growth'
import { seasonLabel } from '../world/season'
import { Icon } from './Icon'
import { medicalDate } from './SeasonMedicalReport'
import { rivalClubName, rivalryLevelText, rivalryReasonText } from './rivalry-text'
import './grown-rivalries.css'
import { MoreInfo } from './MoreInfo'

const effects = (crowd: number) => `Home derbies draw ${crowd}% more crowd demand. Each derby win adds ${RIVALRY_BOARD_POINTS} to the board's assessment and each loss takes ${RIVALRY_BOARD_POINTS} away (at most ${RIVALRY_BOARD_CAP} either way), and a derby result counts double in the recent-results part of squad morale.`
const GROWTH = `Rivalries grow from recorded results: playoff and European knockout series (finals and series that go the distance most), title and division races decided between two clubs, close or overtime games, repeated meetings, European games between clubs of the same country, and you or a star player moving between clubs. Without such games they fade each season. ${RIVALRY_GROWTH_RULES.levels.rivalry}/100 makes a rivalry and ${RIVALRY_GROWTH_RULES.levels.fierce}/100 a fierce one; stronger rivalries draw bigger crowds (5% per step, up to 15%). Rivalries change only between seasons.`

/** Format 68 careers: the managed club's rivalries grown from results, with intensity, reasons and this season's games. */
export function GrownRivalrySection({ season, busy, onEnableRivalries }: { season: SeasonState; busy: boolean; onEnableRivalries: () => void }) {
  const clubId = season.managedClubId, world = worldOf(season)
  const entries = grownRivalriesOf(season.rivalries, clubId, season.seasonNumber, world)
  const enabled = !!season.rivalries.enabledSince, first = entries[0]
  const heading = (entry: typeof first) => entry!.rivalry.origin === 'fictional-development-league' ? entry!.rivalry.name : rivalClubName(season, entry!.rivalId)
  return <>
    <h3 className="board-section-heading"><Icon name="target" size={16} />{entries.length === 1 ? `Rivalry · ${heading(first)}` : `Rivalries · ${seasonLabel(season.seasonNumber)}`}</h3>
    {!enabled && <div className="board-enable board-rivalry-enable"><Icon name="target" size={24} /><div>
      <strong>{first ? `Play the ${first.rivalry.name.toLowerCase()} against ${rivalClubName(season, first.rivalId)}` : 'Let rivalries grow from results'}</strong>
      <p>{first ? effects(RIVALRY_CROWD_PERCENT * first.rivalry.intensity) : GROWTH} This starts with the next matchday.</p>
    </div><button id="enable-rivalries" className="button" onClick={onEnableRivalries} disabled={busy}>Enable rivalries</button></div>}
    {enabled && !entries.length && <><p className="board-empty board-rivalry-none">No rivalries yet.</p><MoreInfo label="How rivalries grow"><p>{GROWTH}</p></MoreInfo></>}
    {entries.map(({ entry, rivalry, rivalId }) => {
      const games = season.fixtures.filter(fixture => [fixture.homeClubId, fixture.awayClubId].includes(clubId) && [fixture.homeClubId, fixture.awayClubId].includes(rivalId)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
      const name = rivalClubName(season, rivalId)
      return <div key={rivalId} className="board-rivalry" data-board-rival={rivalId} data-rivalry-intensity={entry.intensity}>
        <div className="board-president-identity">
          <strong>{name}</strong>
          <span>{rivalryLevelText(entry)}{rivalry.origin === 'fictional-development-league' ? ' · fictional league rivals' : ''}</span>
          <meter className="rivalry-meter" min={0} max={RIVALRY_GROWTH_RULES.max} value={entry.intensity} aria-label={`Rivalry intensity with ${name}: ${entry.intensity} of ${RIVALRY_GROWTH_RULES.max}`} />
          <ul className="rivalry-reasons" aria-label={`Why ${name} are rivals`}>{entry.reasons.map((reason, index) => <li key={index} data-rivalry-reason={reason.kind}>{rivalryReasonText(season, reason)}<small>{reason.kind === 'base' ? `base ${reason.points}` : `+${reason.points}`}</small></li>)}</ul>
        </div>
        {enabled ? <ul className="board-derbies" aria-label={`Games against ${name} ${seasonLabel(season.seasonNumber)}`}>{games.length ? games.map(fixture => {
          const home = fixture.homeClubId === clubId, counted = !!governingDerby(season.rivalries, fixture.homeClubId, fixture.awayClubId, season.seasonNumber, fixture.round, world)
          const result = fixture.result, won = result?.winnerClubId === clubId
          const competition = fixture.competition ? `${world.europeanCompetitions?.find(item => item.id === fixture.competition)?.name ?? 'Europe'} · ` : ''
          return <li key={fixture.id} data-derby-fixture={fixture.id} data-derby-result={result ? (won ? 'won' : 'lost') : 'upcoming'}><span><strong>{competition}Matchday {fixture.round} · {home ? 'Home' : 'Away'}</strong><small><time dateTime={fixture.date}>{medicalDate(fixture.date)}</time>{!counted ? ' · before rivalries began' : ''}</small></span><span className="board-objective-status" data-state={result ? (won ? 'good' : 'concern') : 'waiting'}><Icon name={result ? (won ? 'check' : 'target') : 'clock'} size={15} />{result ? `${won ? 'Won' : 'Lost'} ${result.score[home ? 'home' : 'away']}–${result.score[home ? 'away' : 'home']}` : 'Upcoming'}</span></li>
        }) : <li><span><small>No games between the clubs are scheduled this season.</small></span></li>}</ul> : null}
        {enabled && <MoreInfo label="What a rivalry does"><p className="board-rivalry-effects">{effects(RIVALRY_CROWD_PERCENT * rivalry.intensity)}</p></MoreInfo>}
      </div>
    })}
    {entries.length > 0 && <details className="board-rules rivalry-rules"><summary><Icon name="settings" size={15} />How rivalries grow</summary><p>{GROWTH}</p></details>}
  </>
}

import type { SeasonState } from '../domain/season';
import { Icon } from './Icon';
import { StaminaMeter } from './StaminaMeter';
import { Avatar } from './Avatar';
import './rest-week.css';
import { getPlayerHealth } from '../world/health';
import { PositionLabel } from './PositionLabel';
import { careerDay, gameDate, gamesText, nextGameText } from './career-text';

/**
 * A day without the manager's match: a real calendar gap ("Rest week") or another game day of a week the club plays in
 * ("No game today": midweek European games, or a playoff day). No match score, appearance or simulated opponent.
 */
export function RestWeek({ season, busy, onContinue, onTraining }: { season: SeasonState; busy: boolean; onContinue: () => void; onTraining: () => void }) {
  const club = season.clubs.find(club => club.id === season.managedClubId)!;
  const day = careerDay(season);
  const complete = season.status === 'complete';
  const headline = complete ? day.label : day.label === 'Rest week' ? `No game for ${club.name} this week` : `No game for ${club.name} today`;
  const detail = complete ? 'Review the final table and prepare for next season.'
    : day.gamesToday ? `${gamesText(day.gamesToday, day.kind)} ${day.gamesToday === 1 ? 'is' : 'are'} played on ${gameDate(day.day)}${day.label === 'Rest week' ? '' : ' without your club'}. Continue plays ${day.gamesToday === 1 ? 'it' : 'them'}.`
      : 'No games are played on this day. Continue completes the week.';
  return <>
    <section className="panel rest-week" aria-labelledby="rest-week-title">
      <div className="rest-week-label"><span><Icon name="calendar" size={13} />{day.label}</span><time dateTime={day.day}>{gameDate(day.day, true)}</time></div>
      <div className="rest-week-content">
        <div className="rest-week-message">
          <h2 id="rest-week-title">{headline}</h2>
          <p>{detail}</p>
          {!complete && day.playedThisWeek && <p>Your game this week: {nextGameText(season, day.playedThisWeek)}, played.</p>}
          {day.next && <p className="rest-week-next">Your next game: <strong>{nextGameText(season, day.next)}</strong></p>}
        </div>
        {season.status === 'active' && <div className="rest-week-actions"><button className="button primary" disabled={busy} onClick={onContinue}>Continue<Icon name="next" size={16} /></button><button className="button" disabled={busy} onClick={onTraining}>Training<Icon name="training" size={16} /></button></div>}
      </div>
    </section>
    <section className="panel rest-week-squad" aria-labelledby="rest-week-squad-title">
      <header className="rest-week-heading"><h2 id="rest-week-squad-title">Squad condition</h2><span>{club.players.length} players</span></header>
      <div className="rest-week-scroll"><table><thead><tr><th scope="col">Player</th><th scope="col">Position</th><th scope="col">Current stamina</th></tr></thead><tbody>{club.players.map(player => <tr key={player.id}><th scope="row"><span className="rest-week-player"><Avatar player={player} color={club.color} size={26} />{player.name}{getPlayerHealth(season, player.id) && <small>Injured</small>}</span></th><td><PositionLabel position={player.position} profile={season.world?.playerProfiles[player.id]} /></td><td><StaminaMeter value={season.conditions[player.id]!} label={`${player.name} current stamina`} /></td></tr>)}</tbody></table></div>
    </section>
  </>;
}

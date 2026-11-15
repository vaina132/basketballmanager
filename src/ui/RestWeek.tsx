import type { SeasonState } from '../domain/season';
import { Icon } from './Icon';
import { StaminaMeter } from './StaminaMeter';
import { Avatar } from './Avatar';
import './rest-week.css';
import { getPlayerHealth } from '../world/health';
import { PositionLabel } from './PositionLabel';

/** A real calendar gap, with no match score, appearance or simulated opponent. */
export function RestWeek({ season, busy, onContinue, onTraining }: { season: SeasonState; busy: boolean; onContinue: () => void; onTraining: () => void }) {
  const club = season.clubs.find(club => club.id === season.managedClubId)!;
  const next = season.fixtures.find(fixture => fixture.round > season.round && [fixture.homeClubId, fixture.awayClubId].includes(club.id));
  const opponent = next && season.clubs.find(team => team.id === (next.homeClubId === club.id ? next.awayClubId : next.homeClubId));
  const games = season.fixtures.filter(fixture => fixture.round === season.round).length;
  return <section className="panel rest-week" aria-label="Rest week">
    <header className="section-heading"><h2><Icon name="calendar" /> {season.status === 'complete' ? 'Season complete' : 'Rest week'}</h2><time dateTime={season.date}>{season.date}</time></header>
    <p>{season.status === 'complete' ? 'Review the final table and prepare for next season.' : `No match for ${club.name} this week. ${games} other games are scheduled.`}</p>
    {opponent && next && <p>Next match: <strong>{opponent.name}</strong> · <time dateTime={next.date}>{next.date}</time> · {next.homeClubId === club.id ? 'Home' : 'Away'}</p>}
    {season.status === 'active' && <div className="season-result-actions"><button className="button primary" disabled={busy} onClick={onContinue}>Continue<Icon name="next" size={16} /></button><button className="button" disabled={busy} onClick={onTraining}>Training<Icon name="training" size={16} /></button></div>}
    <table><thead><tr><th scope="col">Player</th><th scope="col">Position</th><th scope="col">Current stamina</th></tr></thead><tbody>{club.players.map(player => <tr key={player.id}><th scope="row"><span className="rest-week-player"><Avatar player={player} color={club.color} size={28} />{player.name}{getPlayerHealth(season, player.id) && <small>Injured</small>}</span></th><td><PositionLabel position={player.position} profile={season.world?.playerProfiles[player.id]} /></td><td><StaminaMeter value={season.conditions[player.id]!} label={`${player.name} current stamina`} /></td></tr>)}</tbody></table>
  </section>;
}

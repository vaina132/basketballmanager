import type { MatchState, Team } from '../../src/domain/types';
import { createFixtureMatch, simulateToEnd } from '../../src/engine/match';
import { calibrationSummary, calibrationTeam, gameLine, type GameLine } from './match-calibration';

/**
 * NBA-strength squads for the NBA calibration (NBA step 3): the calibration generator 2.5 to 4 skill points above the
 * European regulars (about their top quarter and above), with NBA heights (2-4 cm taller by position).
 */
export function nbaTeam(index: number, strength: number): Team {
  const team = calibrationTeam(40 + index, strength);
  const taller = { PG: 3, SG: 3, SF: 3, PF: 3, C: 3 } as const;
  return { ...team, id: `nba-${index}`, name: `NBA ${index}`, shortName: `NBA${index}`, players: team.players.map(player => ({ ...player, id: `nba-${index}-${player.id}`, heightCm: player.heightCm + taller[player.position] })) };
}
export const NBA_STRENGTHS = [2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 2.6, 2.9, 3.4, 3.6, 3.9];

/** Every pair of NBA squads home and away (`rounds` times), with the play model and match flow, as NBA careers play. */
export function nbaGames(rounds = 1, firstSeed = 12_000): { games: GameLine[]; ends: MatchState[]; summary: ReturnType<typeof calibrationSummary> } {
  const teams = NBA_STRENGTHS.map((strength, index) => nbaTeam(index, strength));
  const games: GameLine[] = [], ends: MatchState[] = [];
  let seed = firstSeed;
  for (let round = 0; round < rounds; round += 1) for (const home of teams) for (const away of teams) {
    if (home === away) continue;
    const match = createFixtureMatch(seed++, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', playModel: 'plays-3', computerCoach: ['home', 'away'], ruleset: 'nba-2026' });
    const end = simulateToEnd(match);
    if (ends.length < 40) ends.push(end);
    games.push(gameLine(end, { home: match.lineups.home, away: match.lineups.away }));
  }
  return { games, ends, summary: calibrationSummary(games) };
}

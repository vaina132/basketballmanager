import type { MatchState, PlayerAttributes, Position, Team } from '../../src/domain/types';
import { createFixtureMatch, simulateToEnd } from '../../src/engine/match';
import { calibrationSummary, calibrationTeam, gameLine, type GameLine } from './match-calibration';

/**
 * NBA squads for the NBA calibration: the calibration generator on the mean skill profile of each position over the
 * real NBA rotations (each club's nine best players in the world-14 preview, rating-4 with the plus-minus, 24 November
 * 2026: more defense and three-point shooting than European regulars, similar free throws), with NBA heights (3 cm
 * taller) and a spread of -0.25 to +1.25 skill points between the squads.
 */
export const NBA_POSITION_MEANS: Readonly<Record<Position, PlayerAttributes>> = {
  PG: { twoPoint: 11.5, threePoint: 14.3, freeThrow: 13.4, passing: 16.1, defense: 16.3, rebounding: 9, stamina: 13.6 },
  SG: { twoPoint: 12.5, threePoint: 16, freeThrow: 14.7, passing: 13.1, defense: 15.9, rebounding: 10.8, stamina: 14.4 },
  SF: { twoPoint: 13.5, threePoint: 15.2, freeThrow: 13.5, passing: 12.5, defense: 17, rebounding: 12.6, stamina: 15.1 },
  PF: { twoPoint: 14.4, threePoint: 14, freeThrow: 11.4, passing: 11.6, defense: 15.3, rebounding: 14.9, stamina: 13.2 },
  C: { twoPoint: 14.9, threePoint: 9, freeThrow: 7.8, passing: 9.6, defense: 14.8, rebounding: 18, stamina: 10.7 },
};
export function nbaTeam(index: number, strength: number): Team {
  const team = calibrationTeam(40 + index, strength, NBA_POSITION_MEANS);
  const taller = { PG: 3, SG: 3, SF: 3, PF: 3, C: 3 } as const;
  return { ...team, id: `nba-${index}`, name: `NBA ${index}`, shortName: `NBA${index}`, players: team.players.map(player => ({ ...player, id: `nba-${index}-${player.id}`, heightCm: player.heightCm + taller[player.position] })) };
}
export const NBA_STRENGTHS = [-0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, -0.15, 0.15, 0.65, 0.85, 1.15];

/** Every pair of NBA squads home and away (`rounds` times), with the play model and match flow, as NBA careers play (format 96 careers: `nba-2026b`). */
export function nbaGames(rounds = 1, firstSeed = 12_000, ruleset: 'nba-2026' | 'nba-2026b' = 'nba-2026', strengths: readonly number[] = NBA_STRENGTHS): { games: GameLine[]; ends: MatchState[]; summary: ReturnType<typeof calibrationSummary> } {
  const teams = strengths.map((strength, index) => nbaTeam(index, strength));
  const games: GameLine[] = [], ends: MatchState[] = [];
  let seed = firstSeed;
  for (let round = 0; round < rounds; round += 1) for (const home of teams) for (const away of teams) {
    if (home === away) continue;
    const match = createFixtureMatch(seed++, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', playModel: 'plays-3', computerCoach: ['home', 'away'], ruleset });
    const end = simulateToEnd(match);
    if (ends.length < 40) ends.push(end);
    games.push(gameLine(end, { home: match.lineups.home, away: match.lineups.away }));
  }
  return { games, ends, summary: calibrationSummary(games) };
}

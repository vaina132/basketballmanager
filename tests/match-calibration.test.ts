import { describe, expect, it } from 'vitest';
import type { Player, PlayerAttributes, Position, Team } from '../src/domain/types';
import { createFixtureMatch, simulateToEnd } from '../src/engine/match';
import { calibrationSummary, gameLine, type GameLine } from './helpers/match-calibration';

/**
 * Sprint 4 match calibration: a few hundred games between generated twelve-player squads whose attributes follow the
 * real-data regulars of the six domestic top divisions (mean by position, minutes of 600 or more). The bands sit around
 * the 2025-26 regular-season targets (per team per game, mean of nine European competitions) in src/engine/calibration.ts.
 */
const POSITION_MEANS: Readonly<Record<Position, PlayerAttributes>> = {
  PG: { twoPoint: 10.3, threePoint: 12.8, freeThrow: 14, passing: 16.8, defense: 13.7, rebounding: 9.4, stamina: 13.3 },
  SG: { twoPoint: 10.4, threePoint: 13.9, freeThrow: 13.9, passing: 12, defense: 12.6, rebounding: 9.9, stamina: 13.1 },
  SF: { twoPoint: 11.7, threePoint: 12.8, freeThrow: 12, passing: 10.3, defense: 12.4, rebounding: 11.7, stamina: 13.1 },
  PF: { twoPoint: 14.8, threePoint: 10.1, freeThrow: 10, passing: 9.7, defense: 12.6, rebounding: 16.1, stamina: 12.4 },
  C: { twoPoint: 16.3, threePoint: 7.8, freeThrow: 9, passing: 9.7, defense: 11.9, rebounding: 17, stamina: 11.6 },
};
const HEIGHTS: Readonly<Record<Position, number>> = { PG: 188, SG: 194, SF: 200, PF: 206, C: 211 };
/** Starters first (about one forward-centre pair in five, as in the real data), then the bench, a little below the regulars. */
const SQUAD: readonly Position[] = ['PG', 'SG', 'SF', 'SF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SF', 'PF'];

function generatedTeam(index: number, strength: number): Team {
  let state = 0x9e3779b9 ^ (index + 1) * 2654435761;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
  const players: Player[] = SQUAD.map((position, slot) => {
    const depth = slot < 5 ? 0 : slot < 9 ? -1 : -2;
    const attributes = Object.fromEntries(Object.entries(POSITION_MEANS[position]).map(([key, mean]) => [key, Math.max(1, Math.min(20, Math.round(mean + strength + depth + (random() - .5) * 4)))])) as unknown as PlayerAttributes;
    return { id: `cal-${index}-${slot}`, name: `Player ${index}-${slot}`, number: slot + 4, position, heightCm: HEIGHTS[position], weightKg: 95, skinTone: '#9aa0a8', hairColor: '#3b3f45', attributes };
  });
  return { id: `cal-${index}`, name: `Calibration ${index}`, shortName: `CAL${index}`, color: '#6b7280', players };
}

describe('match calibration against 2025-26 European regular-season statistics', () => {
  // Twelve squads from one and a half points of skill below the regulars' mean to as much above, each meeting all others four times.
  const strengths = [-1.5, -1.25, -1, -.75, -.5, -.25, 0, .25, .5, .75, 1, 1.5];
  const teams = strengths.map((strength, index) => generatedTeam(index, strength));
  const games: GameLine[] = [], wins = new Map(teams.map(team => [team.id, 0]));
  let seed = 4100;
  for (let round = 0; round < 2; round += 1) for (const home of teams) for (const away of teams) {
    if (home === away) continue;
    const match = createFixtureMatch(seed++, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off' });
    const end = simulateToEnd(match);
    games.push(gameLine(end, { home: match.lineups.home, away: match.lineups.away }));
    const winner = end.score.home > end.score.away ? home.id : away.id;
    wins.set(winner, wins.get(winner)! + 1);
  }
  const summary = calibrationSummary(games);

  it('scores, shoots and paces games like European professional basketball', () => {
    expect(summary.games).toBe(264);
    expect(summary.points).toBeGreaterThanOrEqual(78); expect(summary.points).toBeLessThanOrEqual(92);
    expect(summary.possessions).toBeGreaterThanOrEqual(71); expect(summary.possessions).toBeLessThanOrEqual(81);
    expect(summary.fgPct).toBeGreaterThanOrEqual(42); expect(summary.fgPct).toBeLessThanOrEqual(50);
    expect(summary.threeShare).toBeGreaterThanOrEqual(36); expect(summary.threeShare).toBeLessThanOrEqual(48);
    expect(summary.ftPct).toBeGreaterThanOrEqual(70); expect(summary.ftPct).toBeLessThanOrEqual(80);
    expect(summary.ftaPerFga).toBeGreaterThanOrEqual(.26); expect(summary.ftaPerFga).toBeLessThanOrEqual(.42);
  });

  it('keeps the box score in proportion, with team rebounds', () => {
    expect(summary.turnovers).toBeGreaterThanOrEqual(11); expect(summary.turnovers).toBeLessThanOrEqual(16);
    expect(summary.steals).toBeGreaterThanOrEqual(5); expect(summary.steals).toBeLessThanOrEqual(9);
    expect(summary.blocks).toBeGreaterThanOrEqual(1.5); expect(summary.blocks).toBeLessThanOrEqual(4);
    expect(summary.fouls).toBeGreaterThanOrEqual(18); expect(summary.fouls).toBeLessThanOrEqual(26);
    expect(summary.assists).toBeGreaterThanOrEqual(14); expect(summary.assists).toBeLessThanOrEqual(23);
    expect(summary.assistedPct).toBeGreaterThanOrEqual(52); expect(summary.assistedPct).toBeLessThanOrEqual(72);
    expect(summary.rebounds).toBeGreaterThanOrEqual(28); expect(summary.rebounds).toBeLessThanOrEqual(37);
    expect(summary.teamOrb + summary.teamDrb).toBeGreaterThanOrEqual(2); expect(summary.teamOrb + summary.teamDrb).toBeLessThanOrEqual(6);
  });

  it('produces realistic margins, overtimes and home advantage', () => {
    expect(summary.margin).toBeGreaterThanOrEqual(8); expect(summary.margin).toBeLessThanOrEqual(15);
    expect(summary.overtimePct).toBeGreaterThanOrEqual(1); expect(summary.overtimePct).toBeLessThanOrEqual(10);
    expect(summary.homeWinPct).toBeGreaterThanOrEqual(50); expect(summary.homeWinPct).toBeLessThanOrEqual(70);
  });

  it('rotates like a coach: starters play most, about ten players get minutes', () => {
    expect(summary.starterMinutes).toBeGreaterThanOrEqual(20); expect(summary.starterMinutes).toBeLessThanOrEqual(28);
    expect(summary.starterMinuteShare).toBeGreaterThanOrEqual(52); expect(summary.starterMinuteShare).toBeLessThanOrEqual(64);
    expect(summary.benchUsed).toBeGreaterThanOrEqual(4.5); expect(summary.benchUsed).toBeLessThanOrEqual(6.5);
    expect(summary.topFiveMinuteShare).toBeGreaterThanOrEqual(58); expect(summary.topFiveMinuteShare).toBeLessThanOrEqual(70);
  });

  it('lets stronger squads win more often without deciding every game', () => {
    const pct = (index: number) => wins.get(teams[index]!.id)! / 44;
    const strongest = (pct(11) + pct(10) + pct(9)) / 3, weakest = (pct(0) + pct(1) + pct(2)) / 3;
    expect(strongest).toBeGreaterThan(weakest + .25);
    expect(strongest).toBeLessThan(.95); expect(weakest).toBeGreaterThan(.05);
  });
});

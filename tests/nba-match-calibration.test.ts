import { describe, expect, it } from 'vitest';
import { nbaGames } from './helpers/nba-calibration';

/**
 * NBA step 3: NBA match calibration on NBA-strength squads (tests/helpers/nba-calibration.ts: twelve squads 2.5-4 skill
 * points above the European regulars, every pair home and away twice, play model with match flow, NBA rules). Targets
 * per team per game (src/engine/calibration.ts, NBA_CALIBRATION): points 114, pace 99, FG 47%, 37 three-point attempts
 * at 36% (42% of shots), 21.5 free throws at 78%, 44 rebounds (11 offensive), 26.5 assists, 14 turnovers, 8 steals,
 * 5 blocks, 19 fouls, 6% overtime, home teams win 54-55%, starters 30-34 minutes.
 */
const { summary } = nbaGames(2);
const band = (value: number, low: number, high: number) => { expect(value).toBeGreaterThanOrEqual(low); expect(value).toBeLessThanOrEqual(high); };

describe('NBA match calibration', () => {
  it('reports the measured table', () => {
    const rows: [string, number, string][] = [
      ['points', summary.points, '114'], ['pace', summary.possessions, '99'], ['FG%', summary.fgPct, '47'],
      ['3PA', summary.threePa, '37'], ['3P%', summary.threePct, '36'], ['3PA share', summary.threeShare, '42'],
      ['FTA', summary.fta, '21.5'], ['FT%', summary.ftPct, '78'], ['rebounds', summary.rebounds, '44'], ['offensive rebounds', summary.orb, '11'],
      ['assists', summary.assists, '26.5'], ['turnovers', summary.turnovers, '14'], ['steals', summary.steals, '8'], ['blocks', summary.blocks, '5'],
      ['fouls', summary.fouls, '19'], ['overtime %', summary.overtimePct, '6'], ['home wins %', summary.homeWinPct, '54-55'], ['starter minutes', summary.starterMinutes, '30-34'],
    ];
    console.info(`NBA calibration, ${summary.games} games (measured / target):\n${rows.map(([name, value, target]) => `  ${name}: ${value} / ${target}`).join('\n')}`);
    expect(summary.games).toBe(264);
  });

  it('scores and paces games like the NBA', () => {
    band(summary.points, 108, 120);
    band(summary.possessions, 95, 103);
    band(summary.fgPct, 45, 49);
    band(summary.threePa, 33, 42);
    band(summary.threePct, 34, 38);
    band(summary.threeShare, 38, 46);
    band(summary.fta, 18, 25);
    band(summary.ftPct, 75, 81);
  });

  it('keeps the NBA box score in proportion', () => {
    band(summary.rebounds, 40, 47);
    band(summary.orb, 9, 12.5);
    band(summary.assists, 23.5, 30);
    band(summary.turnovers, 12, 16);
    band(summary.steals, 6.5, 9.5);
    band(summary.blocks, 4, 6.5);
    band(summary.fouls, 17, 21.5);
  });

  it('gives NBA overtimes, home advantage and starters\' minutes', () => {
    band(summary.overtimePct, 1, 10);
    band(summary.homeWinPct, 48, 62);
    band(summary.starterMinutes, 29, 34);
  });
});

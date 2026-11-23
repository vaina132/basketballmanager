import { describe, expect, it } from 'vitest';
import { nbaPack } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { nbaCompetitionTables, competitionTable } from '../src/world/competition-table';
import { standingsRuleAllowed, standingsRuleFor, STANDINGS_RULE_FORMAT } from '../src/domain/competition';

const world = worldFromPack(nbaPack(), 'nba');
const nba = world.nba!;
const clubIds = world.domesticLeagues![0]!.clubIds;
const id = (short: string) => `nba-${short}`;
type Game = [home: string, away: string, homeScore: number, awayScore: number] | [home: string, away: string];

function tables(list: readonly Game[]) {
  const games = list.map(([home, away], index) => ({ id: `g${index + 1}`, competitionId: 'nba', stage: 'regular' as const, stageRound: 1, groupId: null, seriesId: null, date: '2026-10-20', homeClubId: id(home), awayClubId: id(away), neutral: false }));
  const results = list.flatMap((game, index) => game.length === 4 ? [{ fixtureId: `g${index + 1}`, home: game[2], away: game[3], winnerClubId: id(game[2] > game[3] ? game[0] : game[1]) }] : []);
  return nbaCompetitionTables({ competitionId: 'nba', clubIds, nba: nba.conferences, games, results });
}
const order = (rows: readonly { clubId: string }[], ...shorts: string[]) => rows.map(row => row.clubId).filter(clubId => shorts.map(id).includes(clubId));

describe('NBA standings (nba-2026)', () => {
  it('is the USA\'s rule from format 90', () => {
    expect(standingsRuleFor('USA', 1)).toBe('nba-2026');
    expect(standingsRuleAllowed('nba-2026', 'USA', 1)).toBe(true);
    expect(standingsRuleAllowed('nba-2026', 'Spain', 1)).toBe(false);
    expect(STANDINGS_RULE_FORMAT['nba-2026']).toBe(90);
    expect(world.domesticLeagues![0]!.standingsRule).toBe('nba-2026');
    expect(() => competitionTable({ competitionId: 'nba', clubIds, games: [], results: [], rule: 'nba-2026' })).toThrow(/conferences/);
  });

  it('ranks by winning percentage, with tables per conference and division', () => {
    // BOS 3-1 (.750) ranks above NYK 5-2 (.714) despite fewer wins.
    const result = tables([['bos', 'atl', 100, 90], ['bos', 'cha', 100, 90], ['bos', 'mia', 100, 90], ['bos', 'orl', 90, 100],
      ['nyk', 'atl', 100, 90], ['nyk', 'cha', 100, 90], ['nyk', 'mia', 100, 90], ['nyk', 'was', 100, 90], ['nyk', 'chi', 100, 90], ['nyk', 'cle', 90, 100], ['nyk', 'det', 90, 100]]);
    expect(order(result.league, 'bos', 'nyk')).toEqual([id('bos'), id('nyk')]);
    expect(Object.keys(result.conferences)).toEqual(nba.conferences.map(conference => conference.id));
    expect(Object.values(result.conferences).map(rows => rows.length)).toEqual([15, 15]);
    expect(Object.values(result.divisions).map(rows => rows.length)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(result.divisions['atlantic']!.slice(0, 2).map(row => row.clubId)).toEqual([id('bos'), id('nyk')]);
  });

  it('breaks a two-club tie by their games, then by division leader', () => {
    // BOS and BKN (one division) are 1-1; BOS won their game.
    const direct = tables([['bos', 'bkn', 100, 90], ['bos', 'det', 90, 100], ['bkn', 'atl', 100, 90]]);
    expect(order(direct.conferences['east']!, 'bos', 'bkn')).toEqual([id('bos'), id('bkn')]);
    // BOS (leads the Atlantic) and CHI (behind CLE in the Central) are 1-1 and never met: the division leader first.
    const leader = tables([['atl', 'bos', 90, 100], ['det', 'bos', 100, 90], ['chi', 'mia', 100, 90], ['cle', 'chi', 100, 90]]);
    expect(order(leader.conferences['east']!, 'bos', 'chi')).toEqual([id('bos'), id('chi')]);
    expect(leader.divisions['central']![0]!.clubId).not.toBe(id('chi'));
  });

  it('puts a division leader first in a tie of three, then restarts with the two-club rules', () => {
    // BOS (Atlantic leader), CLE and MIA are 2-2. Among them CLE won both, MIA one, BOS none.
    const result = tables([['bos', 'atl', 100, 90], ['bos', 'cha', 100, 90], ['cle', 'bos', 100, 90], ['mia', 'bos', 100, 90], ['cle', 'mia', 100, 90],
      ['det', 'cle', 100, 90], ['ind', 'cle', 100, 90], ['mia', 'orl', 100, 90], ['was', 'mia', 100, 90]]);
    expect(order(result.conferences['east']!, 'bos', 'cle', 'mia')).toEqual([id('bos'), id('cle'), id('mia')]);
  });

  it('marks a tie left after every step unresolved during the season and draws it once the season is complete', () => {
    const level: Game[] = [['bos', 'den', 100, 90], ['den', 'bos', 100, 90]];
    const open = tables([...level, ['lal', 'gsw']]);
    expect(open.league.filter(row => [id('bos'), id('den')].includes(row.clubId)).map(row => row.rankingTie)).toEqual(['unresolved', 'unresolved']);
    const complete = tables(level);
    expect(complete.league.filter(row => [id('bos'), id('den')].includes(row.clubId)).map(row => row.rankingTie)).toEqual(['draw', 'draw']);
    expect(tables(level).league.map(row => row.clubId)).toEqual(complete.league.map(row => row.clubId));
  });
});

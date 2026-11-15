import { describe, expect, it } from 'vitest';
import { estimatedLowerDivisionOrder, generateLowerDivisionSquad, LOWER_DIVISION_RULES, lowerDivisionExchanges, squadStrength } from '../src/world/lower-division';
import { checkPlayerShape } from '../src/world/career-world';
import { playerAgeOnDate } from '../src/data/development-player-profiles';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';

const lower = (country, tier, count) => ({ country, tier, name: `${country} next division`, clubs: Array.from({ length: count }, (_, index) => ({ id: `${country.toLowerCase()}-n${index + 1}`, name: `N${index + 1}`, shortName: `N${index + 1}`, color: '#123456' })) });
const league = (id, country, tier, clubIds) => ({ id, name: id, country, tier, clubIds });
const background = (id, country, since = 2) => ({ id, name: id, shortName: id.slice(0, 3), color: '#654321', country, origin: 'relegated', since, players: DEVELOPMENT_WORLD.clubs[0].players });
const exchange = overrides => lowerDivisionExchanges({ seed: 7, seasonNumber: 1, leagues: [], relegated: new Map(), lowerDivisions: [], background: [], returningStrength: club => squadStrength(club.players), generatedStrength: () => 40, ...overrides });

describe('the estimated next-division table (step 3.4d-2, work in progress)', () => {
  it('ranks by squad strength plus a seeded random element, independent of input order and match randomness', () => {
    const candidates = [{ clubId: 'a', strength: 50 }, { clubId: 'b', strength: 49 }, { clubId: 'c', strength: 30 }];
    const order = estimatedLowerDivisionOrder(11, 1, 'Testland', candidates);
    expect(estimatedLowerDivisionOrder(11, 1, 'Testland', [...candidates].reverse())).toEqual(order);
    // A gap wider than the random element always decides; a narrow one may go either way across seeds.
    expect(order.at(-1).clubId).toBe('c');
    const leaders = new Set(Array.from({ length: 40 }, (_, seed) => estimatedLowerDivisionOrder(seed, 1, 'Testland', candidates)[0].clubId));
    expect(leaders).toEqual(new Set(['a', 'b']));
    for (const entry of order) expect(entry.score - entry.strength).toBeGreaterThanOrEqual(0), expect(entry.score - entry.strength).toBeLessThan(LOWER_DIVISION_RULES.tableSpread);
    expect(() => estimatedLowerDivisionOrder(1, 1, 'Testland', [candidates[0], candidates[0]])).toThrow(/once/);
  });
});

describe('leaving and joining at a season end (step 3.4d-2, work in progress)', () => {
  it('exchanges a single-division country\'s relegated clubs with the same number from its next division', () => {
    const top = league('bbl', 'Germany', 1, ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']);
    const [result] = exchange({ leagues: [top], relegated: new Map([['bbl', ['g5', 'g6']]]), lowerDivisions: [lower('Germany', 2, 5)] });
    expect(result).toMatchObject({ country: 'Germany', leagueId: 'bbl', leaving: ['g5', 'g6'] });
    expect(result.joining).toHaveLength(2);
    expect(result.joining.every(entry => entry.clubId.startsWith('germany-n') && !entry.returning)).toBe(true);
  });

  it('uses the lowest full division of a two-division country, lets clubs that left earlier return, and never brings back a club leaving now', () => {
    const leagues = [league('acb', 'Spain', 1, ['s1', 's2', 's3', 's4']), league('feb', 'Spain', 2, ['f1', 'f2', 'f3', 'f4'])];
    // A strong returning club beats generated first-time clubs (40) by more than the random element.
    const strong = background('old-club', 'Spain');
    const [result] = exchange({ leagues, relegated: new Map([['acb', ['s4']], ['feb', ['f4']]]), lowerDivisions: [lower('Spain', 3, 3)], background: [strong, background('f3', 'Spain')], returningStrength: club => club.id === 'old-club' ? 70 : 10 });
    expect(result.leagueId).toBe('feb');
    expect(result.leaving).toEqual(['f4']);
    expect(result.joining).toEqual([{ clubId: 'old-club', returning: true }]);
    // A club relegated now is not a candidate, even if a record of it exists.
    const [again] = exchange({ leagues, relegated: new Map([['feb', ['f4']]]), lowerDivisions: [lower('Spain', 3, 3)], background: [background('f4', 'Spain')], returningStrength: () => 99 });
    expect(again.joining.map(entry => entry.clubId)).not.toContain('f4');
  });

  it('leaves countries without a list alone, refuses Italy and France, a misplaced division and too few candidates', () => {
    const leagues = [league('gbl', 'Greece', 1, ['h1', 'h2', 'h3', 'h4'])];
    expect(exchange({ leagues, relegated: new Map([['gbl', ['h4']]]) })).toEqual([]);
    expect(exchange({ leagues, relegated: new Map([['gbl', []]]), lowerDivisions: [lower('Greece', 2, 3)] })).toEqual([]);
    expect(() => exchange({ leagues: [league('lba', 'Italy', 1, ['i1', 'i2', 'i3', 'i4'])], relegated: new Map([['lba', ['i4']]]), lowerDivisions: [lower('Italy', 2, 3)] })).toThrow(/no relegation out of the full world/);
    expect(() => exchange({ leagues, relegated: new Map([['gbl', ['h4']]]), lowerDivisions: [lower('Greece', 3, 3)] })).toThrow(/directly below/);
    expect(() => exchange({ leagues, relegated: new Map([['gbl', ['h3', 'h4']]]), lowerDivisions: [lower('Greece', 2, 1)] })).toThrow(/too few/);
    expect(() => exchange({ leagues, relegated: new Map([['gbl', ['x9']]]), lowerDivisions: [lower('Greece', 2, 3)] })).toThrow(/own clubs/);
  });
});

describe('generated squads for first-time clubs (step 3.4d-2, work in progress)', () => {
  it('makes twelve valid, labelled fictional players rated around the target, reproducibly', () => {
    for (const target of [35, 48, 60]) {
      const squad = generateLowerDivisionSquad(42, 'new-club', 2, '2027-09-04', target);
      expect(squad).toEqual(generateLowerDivisionSquad(42, 'new-club', 2, '2027-09-04', target));
      expect(squad.players).toHaveLength(12);
      const ids = new Set(), numbers = new Set();
      for (const [index, player] of squad.players.entries()) {
        checkPlayerShape(player, `players[${index}]`, ids, numbers);
        expect(player.id).toMatch(/^new-club-generated-s2-\d+$/);
        expect(squad.profiles[player.id].source).toBe('generated');
        const age = playerAgeOnDate(squad.profiles[player.id].dateOfBirth, '2027-09-04');
        expect(age).toBeGreaterThanOrEqual(LOWER_DIVISION_RULES.ages.youngest);
        expect(age).toBeLessThanOrEqual(LOWER_DIVISION_RULES.ages.oldest);
        expect(squad.wages[player.id]).toBeGreaterThan(0);
        expect([1, 2, 3]).toContain(squad.contracts[player.id]);
      }
      expect(Object.entries(LOWER_DIVISION_RULES.squadShape).every(([position, count]) => squad.players.filter(player => player.position === position).length === count)).toBe(true);
      expect(Math.abs(squadStrength(squad.players) - target)).toBeLessThanOrEqual(1.5);
    }
    expect(generateLowerDivisionSquad(43, 'new-club', 2, '2027-09-04', 48)).not.toEqual(generateLowerDivisionSquad(42, 'new-club', 2, '2027-09-04', 48));
  });
});

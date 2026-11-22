import { describe, expect, it } from 'vitest';
import { BALANCE_POSITIONS, BALANCE_SKILLS, RATING_BALANCE_RULES, balanceRatings, roundProfile, statisticsWeight, weightedLevel, type BalanceAttributes, type BalancePlayer, type BalancePosition } from '../supabase/functions/publish-starter-pack/rating-balance';
import { OVR_POSITION_WEIGHTS, overallRating } from '../src/world/overall-rating';
import { parseDataPack } from '../src/world/data-pack';

/** Shared-scale position profiles like the real data's regulars (tests/match-calibration.test.ts): centres own two-point shooting and rebounding, point guards passing. */
const PROFILES: Record<BalancePosition, BalanceAttributes> = {
  PG: { twoPoint: 10, threePoint: 13, freeThrow: 14, passing: 17, defense: 13, rebounding: 9, stamina: 13 },
  SG: { twoPoint: 10, threePoint: 14, freeThrow: 14, passing: 12, defense: 12, rebounding: 10, stamina: 13 },
  SF: { twoPoint: 11, threePoint: 12, freeThrow: 12, passing: 10, defense: 12, rebounding: 12, stamina: 13 },
  PF: { twoPoint: 14, threePoint: 10, freeThrow: 10, passing: 10, defense: 12, rebounding: 15, stamina: 12 },
  C: { twoPoint: 16, threePoint: 8, freeThrow: 9, passing: 10, defense: 12, rebounding: 17, stamina: 12 },
};
type TestPlayer = BalancePlayer & { name: string };

/** Two leagues of eight clubs (the second a level lower), twelve players a club, the same talent spread at every position. */
function world(seed = 7) {
  let state = seed >>> 0 || 1;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
  const players: TestPlayer[] = [];
  const competitions = [{ id: 'top', name: 'Top League', kind: 'domestic', tier: 1, clubIds: [] as string[] }, { id: 'second', name: 'Second League', kind: 'domestic', tier: 2, clubIds: [] as string[] }];
  for (const [index, competition] of competitions.entries()) for (let club = 0; club < 8; club += 1) {
    const clubId = `club-${competition.id}-${club}`;
    competition.clubIds.push(clubId);
    for (let slot = 0; slot < 12; slot += 1) {
      const position = BALANCE_POSITIONS[slot % 5]!, talent = (random() - .5) * 6 - index * 2.5;
      const attributes = Object.fromEntries(BALANCE_SKILLS.map(key => [key, Math.max(1, Math.min(20, Math.round(PROFILES[position][key] + talent + (random() - .5) * 2)))])) as BalanceAttributes;
      players.push({ id: `p-${clubId}-${slot}`, name: `Player ${clubId} ${slot}`, clubId, position, attributes, estimated: ['defense'], ratingMinutes: 900 + Math.round(random() * 900) });
    }
  }
  return { players, competitions };
}
const ovr = (player: BalancePlayer) => overallRating(player.attributes, player.position);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const byPosition = (players: BalancePlayer[], pick: (player: BalancePlayer) => number, filter: (player: BalancePlayer) => boolean = () => true) => Object.fromEntries(BALANCE_POSITIONS.map(position => [position, mean(players.filter(player => player.position === position && filter(player)).map(pick))])) as Record<BalancePosition, number>;
const spreadOf = (values: Record<BalancePosition, number>) => Math.max(...Object.values(values)) - Math.min(...Object.values(values));

describe('rating balance by position (owner decision, 22 November 2026)', () => {
  it('uses the overall rating\'s own position weights', () => {
    for (const position of BALANCE_POSITIONS) for (const key of BALANCE_SKILLS) expect(RATING_BALANCE_RULES.weights[position][key]).toBe(OVR_POSITION_WEIGHTS[position][key]);
    const attributes = PROFILES.C;
    expect(Math.round(8 * weightedLevel(attributes, 'C') - 36)).toBe(overallRating(attributes, 'C'));
  });

  it('gives every position the same average and top-end overall, while each skill keeps its position\'s real profile', () => {
    const { players, competitions } = world();
    const top = (player: BalancePlayer) => player.clubId.includes('-top-');
    const before = byPosition(players, ovr, top);
    expect(before.C - before.SF).toBeGreaterThan(8);
    const { players: after, summary } = balanceRatings(players, competitions);
    const balanced = byPosition(after, ovr, top);
    expect(spreadOf(balanced)).toBeLessThanOrEqual(2);
    // The best fifth of each position reaches about the same overall.
    const topFifth = Object.fromEntries(BALANCE_POSITIONS.map(position => { const values = after.filter(player => top(player) && player.position === position).map(ovr).sort((a, b) => b - a); return [position, mean(values.slice(0, Math.ceil(values.length / 5)))]; })) as Record<BalancePosition, number>;
    expect(spreadOf(topFifth)).toBeLessThanOrEqual(4);
    // The match engine's differences stay: centres rebound and finish inside, point guards pass.
    const skill = (key: keyof BalanceAttributes) => byPosition(after, player => player.attributes[key], top);
    expect(skill('rebounding').C - skill('rebounding').PG).toBeGreaterThanOrEqual(6);
    expect(skill('twoPoint').C - skill('twoPoint').SG).toBeGreaterThanOrEqual(4);
    expect(skill('passing').PG - skill('passing').C).toBeGreaterThanOrEqual(5);
    expect(skill('threePoint').SG - skill('threePoint').C).toBeGreaterThanOrEqual(4);
    // The pool's overall level stays where it was.
    expect(Math.abs(mean(after.filter(top).map(ovr)) - mean(players.filter(top).map(ovr)))).toBeLessThanOrEqual(1);
    expect(summary.model).toBe('position-balance-1');
    expect(summary.positions.C.level).toBeGreaterThan(summary.positions.SF.level);
  });

  it('keeps the order of players within a position and moves each player\'s whole profile', () => {
    const { players, competitions } = world(11);
    const { players: after } = balanceRatings(players, competitions);
    for (const position of BALANCE_POSITIONS) {
      const pairs = players.map((player, index) => [player, after[index]!] as const).filter(([player]) => player.position === position).sort((a, b) => weightedLevel(a[0].attributes, position) - weightedLevel(b[0].attributes, position));
      for (let index = 1; index < pairs.length; index += 1) expect(ovr(pairs[index]![1])).toBeGreaterThanOrEqual(ovr(pairs[index - 1]![1]) - 1);
    }
    // A centre's profile shape survives: his best skill is still rebounding or inside shooting.
    for (const [index, player] of players.entries()) if (player.position === 'C') expect(['rebounding', 'twoPoint']).toContain(BALANCE_SKILLS.reduce((best, key) => after[index]!.attributes[key] > after[index]!.attributes[best] ? key : best, 'twoPoint' as keyof BalanceAttributes));
  });
});

describe('rating balance for few minutes', () => {
  it('weighs a player\'s own statistics by his minutes, in full from 900', () => {
    expect(statisticsWeight(0)).toBe(0);
    expect(statisticsWeight(300)).toBeCloseTo(2 / 3, 6);
    expect(statisticsWeight(900)).toBe(1);
    expect(statisticsWeight(2500)).toBe(1);
    for (let minutes = 0; minutes < 900; minutes += 50) expect(statisticsWeight(minutes + 50)).toBeGreaterThan(statisticsWeight(minutes));
  });

  it('pulls a small sample towards the average player of his position in his league', () => {
    const { players, competitions } = world();
    const star = (id: string, clubId: string, ratingMinutes: number): TestPlayer => ({ id, name: id, clubId, position: 'C', estimated: [], ratingMinutes, attributes: { twoPoint: 20, threePoint: 11, freeThrow: 9, passing: 11, defense: 15, rebounding: 20, stamina: 12 } });
    const test = [star('full', 'club-top-0', 1500), star('few', 'club-top-1', 240), star('none', 'club-top-2', 0), star('second', 'club-second-0', 0)];
    const { players: after } = balanceRatings([...players, ...test], competitions);
    const rated = (id: string) => after.find(player => player.id === id)!;
    const centres = after.filter(player => player.position === 'C' && player.clubId.includes('-top-') && !player.id.startsWith('f') && player.id !== 'none' && player.id !== 'second');
    const average = mean(centres.map(ovr));
    expect(ovr(rated('full'))).toBeGreaterThan(ovr(rated('few')));
    expect(ovr(rated('few'))).toBeGreaterThan(average + 2);
    // No minutes at all: the league's average centre, profile included.
    expect(Math.abs(ovr(rated('none')) - average)).toBeLessThanOrEqual(3);
    expect(rated('none').attributes.rebounding).toBeGreaterThan(rated('none').attributes.passing);
    // The prior follows the league: the same empty sample is rated lower in the second division.
    expect(ovr(rated('second'))).toBeLessThan(ovr(rated('none')) - 8);
  });

  it('leaves players without statistics untouched and keeps every other field', () => {
    const { players, competitions } = world();
    const unrated: TestPlayer = { id: 'new', name: 'New', clubId: 'club-top-0', position: 'SF', estimated: ['all-abilities'], attributes: { twoPoint: 9, threePoint: 9, freeThrow: 9, passing: 9, defense: 9, rebounding: 9, stamina: 9 } };
    const input = [...players, unrated];
    const { players: after } = balanceRatings(input, competitions);
    expect(after.at(-1)).toBe(unrated);
    expect(after.map(player => [player.id, player.clubId, player.position, player.ratingMinutes, player.name])).toEqual(input.map(player => [player.id, player.clubId, player.position, player.ratingMinutes, player.name]));
    for (const player of after) for (const key of BALANCE_SKILLS) { expect(Number.isInteger(player.attributes[key])).toBe(true); expect(player.attributes[key]).toBeGreaterThanOrEqual(1); expect(player.attributes[key]).toBeLessThanOrEqual(20); }
    expect(balanceRatings(input, competitions)).toEqual(balanceRatings(input, competitions));
  });
});

describe('whole skills that keep the overall level', () => {
  it('rounds each skill down or up so the weighted level stays close, instead of moving every skill a whole point', () => {
    const base = PROFILES.SF, moved = Object.fromEntries(BALANCE_SKILLS.map(key => [key, base[key] + .4])) as BalanceAttributes;
    const rounded = roundProfile(moved, 'SF');
    expect(Math.abs(weightedLevel(rounded, 'SF') - weightedLevel(moved, 'SF'))).toBeLessThan(.05);
    expect(BALANCE_SKILLS.some(key => rounded[key] !== base[key])).toBe(true);
    expect(BALANCE_SKILLS.some(key => rounded[key] === base[key])).toBe(true);
    for (const key of BALANCE_SKILLS) expect(Math.abs(rounded[key] - moved[key])).toBeLessThan(1);
    expect(roundProfile({ ...PROFILES.C, rebounding: 21.3 }, 'C').rebounding).toBe(20);
    expect(roundProfile(PROFILES.PG, 'PG')).toEqual(PROFILES.PG);
  });
});

describe('offline preview pack (scripts/real-data-rating-balance.mjs)', () => {
  it('writes a pack the game accepts, with the balance recorded after the existing source fields', async () => {
    const { balancedPack } = await import('../scripts/real-data-rating-balance.mjs' as string);
    const { players, competitions } = world();
    const pack = {
      format: 'basketball-manager-data-pack', formatVersion: 1, version: 'old', season: '2026-27', source: { provider: 'test', profileCorrections: { players: 0 } }, notice: 'Test pack.',
      competitions: competitions.map(competition => ({ ...competition, country: null, season: '2026-27' })),
      clubs: competitions.flatMap(competition => competition.clubIds).map(id => ({ id, name: id, shortName: id.slice(-6).toUpperCase(), country: null, city: null, arena: null, color: null, secondaryColor: null, identitySource: null, playerIds: players.filter(player => player.clubId === id).map(player => player.id) })),
      players: players.map(player => ({ id: player.id, name: player.name, clubId: player.clubId, number: null, position: player.position, nationality: null, age: 25, heightCm: 200, weightKg: 95, attributes: player.attributes, ratingMinutes: player.ratingMinutes, estimated: player.estimated })),
    };
    const balanced = balancedPack(pack, 'new');
    expect(balanced.version).toBe('new');
    expect(Object.keys(balanced.source)).toEqual(['provider', 'profileCorrections', 'ratingBalance']);
    expect(Object.keys(balanced.players[0].attributes)).toEqual(BALANCE_SKILLS);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(balanced)));
    const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const parsed = await parseDataPack(JSON.stringify({ checksum, writtenAt: '2026-11-22T00:00:00.000Z', pack: balanced }));
    expect(parsed.players).toHaveLength(players.length);
    expect(() => balancedPack(balanced, 'again')).toThrow(/already balanced/);
  });
});

import { describe, expect, it } from 'vitest';
import { BALANCE_POSITIONS, BALANCE_SKILLS, RATING_BALANCE_RULES, balanceRatings, roundProfile, shrunkMinutesPerGame, statisticsWeight, weightedLevel, type BalanceAttributes, type BalancePlayer, type BalancePosition } from '../supabase/functions/publish-starter-pack/rating-balance';
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
    expect(summary.model).toBe('position-balance-2');
    expect(summary.positions.C.level).toBeGreaterThan(summary.positions.SF.level);
  });

  it('keeps the order of players within a position and moves each player\'s whole profile', () => {
    const { players, competitions } = world(11);
    const { players: after } = balanceRatings(players, competitions, { roleWeight: 0 });
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

/** Minutes per game by squad slot: five starters, three rotation players, four bench players. */
const SLOT_MINUTES = [31, 30, 29, 28, 27, 21, 19, 17, 13, 11, 9, 7];
/** The test world with games behind every rating; centres play six minutes a game fewer than the others in every slot. */
function timedWorld(seed = 7) {
  const { players, competitions } = world(seed);
  const timed = players.map(player => {
    const slot = Number(player.id.split('-').at(-1)), perGame = SLOT_MINUTES[slot]! - (player.position === 'C' ? 6 : 0);
    return { ...player, ratingGames: Math.round(player.ratingMinutes! / perGame * 10) / 10 };
  });
  return { players: timed, competitions };
}
const slotOf = (player: BalancePlayer) => Number(player.id.split('-').at(-1));

describe('rating balance by role (position-balance-2, owner approved 22 November 2026)', () => {
  it('pulls minutes per game towards the position average over the first ten games', () => {
    expect(shrunkMinutesPerGame(300, 10, 20)).toBe(25);
    expect(shrunkMinutesPerGame(0, 0, 20)).toBe(20);
    expect(shrunkMinutesPerGame(3000, 100, 20)).toBeCloseTo((3000 + 200) / 110, 9);
    expect(RATING_BALANCE_RULES.id).toBe('position-balance-2');
  });

  it('with role weight 0, or without games, is exactly the position balance of world-11 and world-12', () => {
    const { players, competitions } = timedWorld();
    const plain = players.map(({ ratingGames: _games, ...player }) => player);
    const withoutGames = balanceRatings(plain, competitions).players.map(player => player.attributes);
    expect(balanceRatings(players, competitions, { roleWeight: 0 }).players.map(player => player.attributes)).toEqual(withoutGames);
    expect(balanceRatings(players, competitions, { gamesOf: () => undefined }).players.map(player => player.attributes)).toEqual(withoutGames);
    expect(balanceRatings(plain, competitions).summary.role.playersWithGames).toBe(0);
  });

  it('rates a starter above an equally efficient bench player, and leaves starters as they were', () => {
    const { players, competitions } = timedWorld();
    const efficient = (id: string, slot: number, perGame: number): TestPlayer => ({ id: `${id}-${slot}`, name: id, clubId: 'club-top-3', position: 'PG', estimated: [], ratingMinutes: 1200, ratingGames: Math.round(1200 / perGame * 10) / 10, attributes: { twoPoint: 13, threePoint: 17, freeThrow: 17, passing: 19, defense: 15, rebounding: 9, stamina: 14 } });
    const input = [...players, efficient('starter', 0, 30), efficient('bench', 9, 9)];
    const { players: after } = balanceRatings(input, competitions);
    const { players: neutral } = balanceRatings(input, competitions, { roleWeight: 0 });
    const rated = (list: BalancePlayer[], id: string) => ovr(list.find(player => player.id === id)!);
    expect(rated(neutral, 'starter-0')).toBe(rated(neutral, 'bench-9'));
    expect(rated(after, 'starter-0')).toBe(rated(neutral, 'starter-0'));
    expect(rated(after, 'bench-9')).toBeLessThanOrEqual(rated(after, 'starter-0') - 4);
    // The cost is capped: a few points, never a collapse.
    const cap = Math.round(8 * RATING_BALANCE_RULES.roleWeight * RATING_BALANCE_RULES.roleLimit * balanceRatings(input, competitions).summary.commonSpread);
    expect(rated(after, 'bench-9')).toBeGreaterThanOrEqual(rated(after, 'starter-0') - cap - 1);
  });

  it('costs only bench roles: starters with long minutes gain nothing, bench players lose a few points', () => {
    const { players, competitions } = timedWorld(13);
    const { players: after, summary } = balanceRatings(players, competitions);
    const { players: neutral } = balanceRatings(players, competitions, { roleWeight: 0 });
    const change = (slots: (slot: number) => boolean) => players.map((player, index) => [player, ovr(after[index]!) - ovr(neutral[index]!)] as const).filter(([player]) => slots(slotOf(player))).map(([, value]) => value);
    for (const value of change(slot => slot < 5)) expect(value).toBe(0);
    const bench = change(slot => slot >= 8);
    expect(Math.max(...bench)).toBeLessThanOrEqual(0);
    expect(mean(bench)).toBeLessThan(-2);
    expect(Math.min(...bench)).toBeGreaterThanOrEqual(-Math.ceil(8 * RATING_BALANCE_RULES.roleWeight * RATING_BALANCE_RULES.roleLimit * summary.commonSpread) - 1);
    expect(summary.role.clubsWithStarters).toBe(16);
    expect(summary.rules.roleWeight).toBe(RATING_BALANCE_RULES.roleWeight);
  });

  it('compares roles within a position, so centres playing fewer minutes everywhere keep level with the other positions', () => {
    const { players, competitions } = timedWorld();
    const top = (player: BalancePlayer) => player.clubId.includes('-top-');
    const { players: after, summary } = balanceRatings(players, competitions);
    expect(spreadOf(byPosition(after, ovr, top))).toBeLessThanOrEqual(2);
    expect(summary.positions.C.minutesPerGame).toBeLessThan(summary.positions.PG.minutesPerGame - 4);
    const costs = BALANCE_POSITIONS.map(position => summary.positions[position].roleCost);
    expect(Math.max(...costs) - Math.min(...costs)).toBeLessThan(0.15);
  });

  it('gives no role cost at clubs with fewer than five players with games, or to a player without games', () => {
    const { players, competitions } = timedWorld();
    const sparse = players.map(player => player.clubId === 'club-top-5' && slotOf(player) >= 4 ? { ...player, ratingGames: undefined } : player);
    const { players: after } = balanceRatings(sparse, competitions);
    const { players: neutral } = balanceRatings(sparse, competitions, { roleWeight: 0 });
    sparse.forEach((player, index) => { if (player.clubId === 'club-top-5') expect(after[index]!.attributes).toEqual(neutral[index]!.attributes); });
  });
});

describe('offline preview pack (scripts/real-data-rating-balance.mjs)', () => {
  /** A pack built without the balance, as the function's player objects (no games: the live packs up to world-12). */
  const unbalancedPack = () => {
    const { players, competitions } = timedWorld();
    return {
      games: Object.fromEntries(players.map(player => [player.id, player.ratingGames! + 0.04])) as Record<string, number>,
      pack: {
        format: 'basketball-manager-data-pack', formatVersion: 1, version: 'old', season: '2026-27', source: { provider: 'test', profileCorrections: { players: 0 } }, notice: 'Test pack.',
        competitions: competitions.map(competition => ({ ...competition, country: null, season: '2026-27' })),
        clubs: competitions.flatMap(competition => competition.clubIds).map(id => ({ id, name: id, shortName: id.slice(-6).toUpperCase(), country: null, city: null, arena: null, color: null, secondaryColor: null, identitySource: null, playerIds: players.filter(player => player.clubId === id).map(player => player.id) })),
        players: players.map(player => ({ id: player.id, name: player.name, clubId: player.clubId, number: null, position: player.position, nationality: null, age: 25, heightCm: 200, weightKg: 95, attributes: { ...player.attributes, stamina: Math.max(1, Math.min(20, Math.round(8 + SLOT_MINUTES[slotOf(player)]! / 3))) }, ratingMinutes: player.ratingMinutes, estimated: player.estimated })),
      },
    };
  };
  const checksumOf = async (pack: unknown) => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(pack))))].map(byte => byte.toString(16).padStart(2, '0')).join('');

  it('writes a pack the game accepts, with the games where the function writes them and the balance after the existing source fields', async () => {
    const { balancedPack, packGames } = await import('../scripts/real-data-rating-balance.mjs' as string);
    const { pack, games } = unbalancedPack();
    const balanced = balancedPack(pack, 'new', { games });
    expect(balanced.version).toBe('new');
    expect(Object.keys(balanced.source)).toEqual(['provider', 'profileCorrections', 'ratingBalance']);
    expect(balanced.source.ratingBalance.model).toBe('position-balance-2');
    expect(balanced.source.ratingBalance.role.playersWithGames).toBe(pack.players.length);
    expect(Object.keys(balanced.players[0].attributes)).toEqual(BALANCE_SKILLS);
    // The function's key order: ratingGames right after ratingMinutes, one decimal.
    expect(Object.keys(balanced.players[0])).toEqual(['id', 'name', 'clubId', 'number', 'position', 'nationality', 'age', 'heightCm', 'weightKg', 'attributes', 'ratingMinutes', 'ratingGames', 'estimated']);
    expect(balanced.players[0].ratingGames).toBe(packGames(games[balanced.players[0].id]!));
    expect(packGames(34.66)).toBe(34.7);
    const parsed = await parseDataPack(JSON.stringify({ checksum: await checksumOf(balanced), writtenAt: '2026-11-22T00:00:00.000Z', pack: balanced }));
    expect(parsed.players).toHaveLength(pack.players.length);
    expect(() => balancedPack(balanced, 'again', { games })).toThrow(/already balanced/);
    // Rebuilding from a pack that already carries the games (as the function builds it) gives the same pack.
    const carried = { ...pack, players: balanced.players.map((player: Record<string, unknown>, index: number) => ({ ...player, attributes: pack.players[index]!.attributes })) };
    expect(await checksumOf(balancedPack(carried, 'new'))).toBe(await checksumOf(balanced));
  });

  it('refuses a pack without games unless asked to estimate them from stamina, and never writes estimates', async () => {
    const { balancedPack, estimatedGames } = await import('../scripts/real-data-rating-balance.mjs' as string);
    const { pack } = unbalancedPack();
    expect(() => balancedPack(pack, 'new')).toThrow(/no games per player/);
    const estimated = balancedPack(pack, 'new', { estimate: true });
    expect(estimated.source.ratingBalance.role.gamesSource).toMatch(/estimated/);
    expect(estimated.players.some((player: Record<string, unknown>) => 'ratingGames' in player)).toBe(false);
    // More stamina reads as more minutes a game; a year above 32 gives one stamina point back.
    const player = { ratingMinutes: 1000, age: 28, attributes: { ...PROFILES.SF, stamina: 12 } };
    const perGame = (value: typeof player) => value.ratingMinutes / estimatedGames(value);
    expect(perGame(player)).toBeCloseTo(20, 6);
    expect(perGame({ ...player, attributes: { ...player.attributes, stamina: 16 } })).toBeGreaterThan(perGame(player) + 6);
    expect(perGame({ ...player, age: 34, attributes: { ...player.attributes, stamina: 10 } })).toBeCloseTo(20, 6);
    expect(estimatedGames({ ...player, ratingMinutes: 0 })).toBeUndefined();
  });
});

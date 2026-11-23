import { afterAll, describe, expect, it } from 'vitest';
import type { DataPack } from '../src/world/data-pack';
import { requireWorldContexts, validateWorld } from '../src/world/career-world';
import { careerCompetitions, worldFromPack } from '../src/world/real-world';
import { balanceBySeparateCountry, balanceRatings } from '../supabase/functions/publish-starter-pack/rating-balance';
import { economyPack } from './helpers/economy-pack';

/**
 * docs/nba-plan.md step 2: a published pack with the 30-club NBA (country USA, tier 1, conferences and divisions,
 * arena capacities) must not change European careers. The game offers leagues of 4-20 clubs, and since 23 November
 * 2026 only such leagues become the unchosen top divisions of a world that plays Europe.
 */
const spain = { id: 'acb', name: 'Liga ACB', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9] };
const germany = { id: 'bbl', name: 'Basketball Bundesliga', country: 'Germany', tier: 1 as const, levels: [14, 13, 12, 11, 10, 9] };
const nba = { id: 'nba', name: 'NBA', country: 'USA', tier: 1 as const, levels: Array.from({ length: 30 }, (_, index) => 18 - (index % 6)) };
const euroleague = { members: ['acb-1', 'acb-2', 'acb-3', 'acb-4', 'bbl-1', 'bbl-2', 'bbl-3', 'bbl-4', 'bbl-5', 'bbl-6'] };
function withNba(): DataPack {
  const pack = economyPack([spain, germany, nba], euroleague, 13);
  const conferences = [{ id: 'nba-east', name: 'Eastern Conference', clubIds: pack.competitions.find(item => item.id === 'nba')!.clubIds.slice(0, 15) }, { id: 'nba-west', name: 'Western Conference', clubIds: pack.competitions.find(item => item.id === 'nba')!.clubIds.slice(15) }];
  const divisions = conferences.flatMap(conference => [0, 1, 2].map(index => ({ id: `${conference.id}-${index}`, name: `Division ${index}`, parentId: conference.id, clubIds: conference.clubIds.slice(index * 5, index * 5 + 5) })));
  return {
    ...pack,
    competitions: pack.competitions.map(item => item.id === 'nba' ? { ...item, groups: [...conferences, ...divisions] } as typeof item : item),
    clubs: pack.clubs.map(club => club.country === 'USA' ? { ...club, capacity: 19000 } as typeof club : club),
  };
}

describe('a pack with the NBA', () => {
  afterAll(() => requireWorldContexts(false));

  it('is not offered as a career league (30 clubs)', () => {
    expect(careerCompetitions(withNba()).map(item => item.id)).toEqual(['acb', 'bbl']);
    expect(() => worldFromPack(withNba(), 'nba')).toThrow(/supported domestic leagues/);
  });

  it('leaves a European career exactly as without it: no NBA club joins as an unchosen top division', () => {
    const plain = economyPack([spain, germany], euroleague, 13);
    const world = worldFromPack(withNba(), 'acb'), before = worldFromPack(plain, 'acb');
    expect(() => validateWorld(world)).not.toThrow();
    expect(world.backgroundLeagues?.map(league => league.id)).toEqual(['bbl']);
    expect(world.clubs.some(club => club.id.startsWith('nba-'))).toBe(false);
    expect(JSON.stringify(world)).toBe(JSON.stringify(before));
  });

  it('balances the USA on its own, so every other player keeps the ratings of a pack without it', () => {
    const pack = withNba(), plain = economyPack([spain, germany], euroleague, 13);
    const rated = (players: DataPack['players']) => players.map(player => ({ ...player, ratingMinutes: 300 + (player.number ?? 0) * 40, ratingGames: 20 }));
    const separate = balanceBySeparateCountry(rated(pack.players), pack.competitions, 'USA');
    const alone = balanceRatings(rated(plain.players), plain.competitions);
    const europe = separate.players.filter(player => !player.clubId.startsWith('nba-'));
    expect(europe).toEqual(alone.players);
    expect(separate.summary).toEqual(alone.summary);
    expect(separate.usa?.poolPlayers).toBe(30 * 13);
    // Without USA clubs it is exactly the whole-pack balance.
    expect(balanceBySeparateCountry(rated(plain.players), plain.competitions, 'USA')).toEqual({ ...alone, usa: null });
  });
});

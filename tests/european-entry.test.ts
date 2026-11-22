import { describe, expect, it } from 'vitest';
import type { EuropeanPlace, SeasonEurope } from '../src/domain/season';
import type { EuropeanCompetition } from '../src/domain/world';
import { decidePlaces, EUROPEAN_ENTRY_RULES, licenceFailure, wildCardScore, type ClubFacts, type PlacesDayInput } from '../src/world/european-entry';
import { finalRanking } from '../src/world/european-entry-day';

/**
 * Format 83: the places day's rules on small, hand-made worlds (real examples: Bourg's refusal, a relegated licence club,
 * an ending multi-year place, the EuroCup route, the manager's answer). Countries A, B and C have league data; X is
 * outside the world's leagues. EuroLeague of 6, EuroCup of 8, BCL of 6.
 */
const M = 100_000_000; // EUR 1 million in cents
type Seed = { type: EuropeanPlace['type']; until: number | null; route?: number };

function scenario() {
  const facts = new Map<string, ClubFacts>();
  const club = (clubId: string, country: string | null, more: Partial<ClubFacts> = {}) => facts.set(clubId, {
    clubId, country, data: country !== 'X' && country !== null, topNow: true, topNext: true, rank: null, rankSize: null, seats: 12_000, budget: 20 * M, unpaid: 0,
    europe: null, euroleagueSeasons: [], eurocupSeasons: [], ...more,
  });
  // Countries' clubs in final-ranking order.
  const rankings = new Map<string, string[]>([
    ['A', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']],
    ['B', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']],
    ['C', ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']],
  ]);
  for (const [country, order] of rankings) order.forEach((clubId, index) => club(clubId, country, { rank: index + 1, rankSize: order.length, seats: 6_000 + 1_000 * (order.length - index), budget: (30 - 3 * index) * M }));
  club('x1', 'X'); club('x2', 'X'); club('x3', 'X', { seats: 4_000, budget: 6 * M });
  const el: [string, Seed][] = [['a1', { type: 'licence', until: null }], ['b1', { type: 'licence', until: null }], ['c1', { type: 'multi-year', until: 1 }], ['x1', { type: 'multi-year', until: 3 }], ['x2', { type: 'route', until: 1, route: 2 }], ['a2', { type: 'wild-card', until: 1 }]];
  const ec: [string, Seed][] = [['a3', { type: 'multi-year', until: 5 }], ['b2', { type: 'multi-year', until: 5 }], ['c2', { type: 'multi-year', until: 5 }], ['x3', { type: 'multi-year', until: 5 }], ['a4', { type: 'one-year', until: 1 }], ['a5', { type: 'one-year', until: 1 }], ['b3', { type: 'one-year', until: 1 }], ['b4', { type: 'one-year', until: 1 }]];
  const bcl: [string, Seed][] = [['a6', { type: 'league', until: 1 }], ['a7', { type: 'league', until: 1 }], ['b5', { type: 'league', until: 1 }], ['b6', { type: 'league', until: 1 }], ['c3', { type: 'league', until: 1 }], ['c4', { type: 'league', until: 1 }]];
  const competition = (id: string, kind: EuropeanCompetition['kind'], list: [string, Seed][]): EuropeanCompetition => ({ id, name: id, kind, season: '2026-27', clubIds: list.map(([clubId]) => clubId), format: kind === 'euroleague' ? 'euroleague-2026-1' : kind === 'eurocup' ? 'eurocup-2026-1' : 'bcl-2026-1' });
  const competitions = [competition('el', 'euroleague', el), competition('ec', 'eurocup', ec), competition('bcl', 'bcl', bcl)];
  const europe: SeasonEurope = { model: 'places-2', oneYear: ['x2', 'a2'], held: [], entrants: [['el', el], ['ec', ec], ['bcl', bcl]].map(([competitionId, list]) => ({ competitionId: competitionId as string, clubIds: (list as [string, Seed][]).map(([clubId]) => clubId), places: (list as [string, Seed][]).map(([, seed]) => ({ ...seed, reason: 'opening' as const })) })) };
  for (const [clubId] of el) facts.get(clubId)!.euroleagueSeasons = [1] as never;
  for (const [clubId] of ec) facts.get(clubId)!.eurocupSeasons = [1] as never;
  for (const [clubId] of el) facts.get(clubId)!.europe = { kind: 'euroleague', stage: 'other' };
  for (const [clubId] of ec) facts.get(clubId)!.europe = { kind: 'eurocup', stage: 'other' };
  for (const [clubId] of bcl) facts.get(clubId)!.europe = { kind: 'bcl', stage: 'other' };
  const input: PlacesDayInput = {
    seasonNumber: 1, date: '2027-06-26', competitions, europe, opening: structuredClone(europe), facts, rankings, euroleaguePlayoffs: new Set(),
    eurocupFinal: { winner: null, loser: null }, bclChampion: null, europeanOnly: ['x1', 'x2', 'x3'], managedClubId: '', answers: [], strength: () => 50,
  };
  return input;
}
const listOf = (europe: SeasonEurope, id: string) => europe.entrants.find(entry => entry.competitionId === id)!.clubIds;
const placeOf = (europe: SeasonEurope, clubId: string) => { for (const entry of europe.entrants) { const index = entry.clubIds.indexOf(clubId); if (index >= 0) return { competitionId: entry.competitionId, ...entry.places![index]! }; } return null; };
const sizesValid = (europe: SeasonEurope) => {
  expect(listOf(europe, 'el')).toHaveLength(6); expect(listOf(europe, 'ec')).toHaveLength(8); expect(listOf(europe, 'bcl')).toHaveLength(6);
  const all = europe.entrants.flatMap(entry => entry.clubIds);
  expect(new Set(all).size).toBe(all.length);
  for (const entry of europe.entrants) expect(entry.places).toHaveLength(entry.clubIds.length);
};

describe('the licence check and the wild-card score (format 83)', () => {
  it('stops relegated clubs and clubs with unpaid costs above 10% of the budget', () => {
    const input = scenario(), a3 = input.facts.get('a3')!;
    expect(licenceFailure(a3)).toBeNull();
    expect(licenceFailure({ ...a3, topNext: false })).toBe('relegated');
    expect(licenceFailure({ ...a3, unpaid: 2.1 * M, budget: 20 * M })).toBe('unpaid');
    expect(licenceFailure({ ...a3, unpaid: 2 * M, budget: 20 * M })).toBeNull();
    expect(licenceFailure({ ...a3, unpaid: null })).toBeNull();
  });

  it('scores European results, the final ranking, arena, budget, market and past seasons', () => {
    const facts: ClubFacts = { clubId: 'z', country: 'A', data: true, topNow: true, topNext: true, rank: 1, rankSize: 18, seats: 15_000, budget: 30 * M, unpaid: 0, europe: { kind: 'eurocup', stage: 'champion' }, euroleagueSeasons: [], eurocupSeasons: [1] };
    expect(wildCardScore(facts, 1, () => 0)).toEqual({ clubId: 'z', total: 1000 - 70, europe: 300, domestic: 200, arena: 150, budget: 150, market: 100, history: 30 });
    const small = wildCardScore({ ...facts, rank: 18, seats: 8_000, budget: 5 * M, europe: null, eurocupSeasons: [] }, 1, () => 3);
    expect(small.total).toBe(0);
    expect(wildCardScore({ ...facts, rank: 10, europe: { kind: 'euroleague', stage: 'play-in' }, euroleagueSeasons: [1] }, 1, () => 1)).toMatchObject({ europe: 180, domestic: Math.round(200 * 8 / 17), market: 60, history: 100 });
  });

  it('ranks a league by its playoffs: champion, finalist, semi-finalists, then the regular season', () => {
    const series = [
      { stage: 'quarter-final', higher: { clubId: 'p1' }, lower: { clubId: 'p8' }, winner: 'p8' }, { stage: 'quarter-final', higher: { clubId: 'p2' }, lower: { clubId: 'p7' }, winner: 'p2' },
      { stage: 'semi-final', higher: { clubId: 'p2' }, lower: { clubId: 'p8' }, winner: 'p8' }, { stage: 'final', higher: { clubId: 'p3' }, lower: { clubId: 'p8' }, winner: 'p8' },
    ] as never;
    expect(finalRanking(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'], series, 'p8')).toEqual(['p8', 'p3', 'p2', 'p1', 'p7', 'p4', 'p5', 'p6', 'p9']);
  });
});

describe('the places day (format 83)', () => {
  it('keeps licences, renews or ends multi-year places, fills the route and gives wild cards by score at valid sizes', () => {
    const input = scenario();
    Object.assign(input.facts.get('c1')!, { seats: 8_000, budget: 5 * M });
    const next = decidePlaces(input);
    sizesValid(next);
    expect(placeOf(next, 'a1')).toMatchObject({ competitionId: 'el', type: 'licence', until: null });
    expect(placeOf(next, 'x1')).toMatchObject({ competitionId: 'el', type: 'multi-year', until: 3 });
    // c1's three-season place ended: a renewal review below the bar of 60 sends it to the EuroCup.
    expect(next.decision!.wildCards.find(item => item.clubId === 'c1')!.total).toBeLessThan(EUROPEAN_ENTRY_RULES.renewalBar);
    expect(placeOf(next, 'c1')).toMatchObject({ competitionId: 'ec', type: 'drop-down' });
    expect(next.decision!.lost).toEqual(expect.arrayContaining([{ clubId: 'c1', competitionId: 'el', reason: 'ended' }, { clubId: 'x2', competitionId: 'el', reason: 'route-playoffs' }]));
    // Wild cards (no EuroCup final this time): the best scores among clubs with 10,000 seats (5,000 for EuroLeague clubs).
    expect(next.decision!.chosen.length).toBe(3);
    for (const clubId of next.decision!.chosen) expect(placeOf(next, clubId)).toMatchObject({ competitionId: 'el', type: 'wild-card', until: 2 });
    const scores = next.decision!.wildCards.filter(item => !['c1'].includes(item.clubId)).map(item => item.total);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(next.oneYear.sort()).toEqual([...next.decision!.chosen].sort());
    // EuroCup: licences kept, country quotas from the final ranking (A 2, B 2).
    for (const clubId of ['a3', 'b2', 'c2', 'x3']) {
      const place = placeOf(next, clubId)!;
      if (place.competitionId === 'ec') expect(place).toMatchObject({ type: 'multi-year', until: 5 });
      else expect(next.held).toContainEqual({ clubId, competitionId: 'ec', type: 'multi-year', until: 5, reason: 'higher' });
    }
    const quota = listOf(next, 'ec').filter(clubId => placeOf(next, clubId)!.reason === 'country-quota');
    expect(quota.filter(clubId => clubId.startsWith('a')).length).toBeLessThanOrEqual(2);
    expect(quota.filter(clubId => clubId.startsWith('b')).length).toBeLessThanOrEqual(2);
    expect(quota.some(clubId => clubId.startsWith('c'))).toBe(false);
    // Country places go down each country's final ranking, skipping clubs placed higher.
    for (const country of ['a', 'b']) {
      const ranks = quota.filter(clubId => clubId.startsWith(country)).map(clubId => placeOf(next, clubId)!.rank!);
      expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    }
  });

  it('a EuroCup champion with a small arena refuses (Bourg 2026): its place becomes a wild card, the runner-up is not moved up', () => {
    const input = scenario();
    input.euroleaguePlayoffs = new Set(['x2']); // the route holder keeps its place: one route place open
    input.facts.get('a3')!.seats = 3_548; input.facts.get('a3')!.europe = { kind: 'eurocup', stage: 'champion' };
    input.facts.get('b2')!.europe = { kind: 'eurocup', stage: 'final' };
    input.eurocupFinal = { winner: 'a3', loser: 'b2' };
    const next = decidePlaces(input);
    sizesValid(next);
    expect(next.decision!.offers).toContainEqual({ clubId: 'a3', competitionId: 'el', type: 'route', outcome: 'declined', by: 'arena' });
    expect(placeOf(next, 'a3')).toMatchObject({ competitionId: 'ec', type: 'multi-year' });
    expect(placeOf(next, 'x2')).toMatchObject({ competitionId: 'el', type: 'route', route: 3 });
    // The runner-up only takes a route place when both are open; here it can still win a wild card on its score (EuroCup final).
    expect(placeOf(next, 'b2')!.type === 'route').toBe(false);
    expect(next.decision!.wildCards[0]!.clubId === 'b2' || next.decision!.chosen.includes('b2') || placeOf(next, 'b2')!.competitionId === 'ec').toBe(true);
  });

  it('with both route places open the champion and the runner-up go up; a holder stops after three route seasons', () => {
    const input = scenario();
    input.facts.get('a3')!.europe = { kind: 'eurocup', stage: 'champion' }; input.facts.get('b2')!.europe = { kind: 'eurocup', stage: 'final' };
    input.eurocupFinal = { winner: 'a3', loser: 'b2' };
    const next = decidePlaces(input);
    expect(placeOf(next, 'a3')).toMatchObject({ competitionId: 'el', type: 'route', route: 1, reason: 'route-champion' });
    expect(placeOf(next, 'b2')).toMatchObject({ competitionId: 'el', type: 'route', route: 1, reason: 'route-runner-up' });
    // Their EuroCup licences wait while they play the EuroLeague.
    expect(next.held).toEqual(expect.arrayContaining([{ clubId: 'a3', competitionId: 'ec', type: 'multi-year', until: 5, reason: 'higher' }]));
    sizesValid(next);
    const capped = scenario();
    capped.europe.entrants[0]!.places![4] = { type: 'route', until: 1, route: 3, reason: 'route-kept' };
    capped.euroleaguePlayoffs = new Set(['x2']);
    const after = decidePlaces(capped);
    expect(after.decision!.lost).toContainEqual({ clubId: 'x2', competitionId: 'el', reason: 'route-limit' });
    expect(placeOf(after, 'x2')).toMatchObject({ competitionId: 'ec', type: 'drop-down' });
  });

  it('a relegated licence club sits out one season and comes back once it is in the top division again', () => {
    const input = scenario();
    input.facts.get('b1')!.topNext = false;
    const next = decidePlaces(input);
    sizesValid(next);
    expect(placeOf(next, 'b1')).toBeNull();
    expect(next.held).toContainEqual({ clubId: 'b1', competitionId: 'el', type: 'licence', until: null, reason: 'relegated' });
    expect(next.decision!.lost).toContainEqual({ clubId: 'b1', competitionId: 'el', reason: 'relegated' });
    // A season later b1 is promoted back (in the top division next season, though it played the second division).
    const later = scenario();
    later.seasonNumber = 2; later.europe = next;
    later.facts.get('b1')!.topNow = false; later.facts.get('b1')!.rank = null;
    const back = decidePlaces(later);
    sizesValid(back);
    expect(placeOf(back, 'b1')).toMatchObject({ competitionId: 'el', type: 'licence', until: null, reason: 'licence-back' });
    expect(back.held!.some(item => item.clubId === 'b1')).toBe(false);
  });

  it('a multi-year place counts down while its club sits out and ends; a strong club is renewed for three seasons', () => {
    const input = scenario();
    input.facts.get('x1')!.unpaid = 3 * M; input.facts.get('x1')!.budget = 20 * M;
    // x1 is outside the full world here only by country; give it accounts to fail the money check.
    const next = decidePlaces(input);
    expect(next.held).toContainEqual({ clubId: 'x1', competitionId: 'el', type: 'multi-year', until: 3, reason: 'unpaid' });
    sizesValid(next);
    const strong = scenario();
    Object.assign(strong.facts.get('c1')!, { europe: { kind: 'euroleague', stage: 'playoffs' }, seats: 15_000, budget: 30 * M });
    const renewed = decidePlaces(strong);
    expect(placeOf(renewed, 'c1')).toMatchObject({ competitionId: 'el', type: 'multi-year', until: 4, reason: 'renewed' });
  });

  it('computer clubs refuse a new EuroLeague place with a budget under EUR 8 million; the next score takes it', () => {
    const input = scenario();
    Object.assign(input.facts.get('a4')!, { seats: 16_000, budget: 7 * M, europe: { kind: 'eurocup', stage: 'champion' } });
    const next = decidePlaces(input);
    expect(next.decision!.offers).toContainEqual({ clubId: 'a4', competitionId: 'el', type: 'wild-card', outcome: 'declined', by: 'budget' });
    expect(placeOf(next, 'a4')!.competitionId).not.toBe('el');
    sizesValid(next);
  });

  it('the manager may decline: the club keeps its own EuroCup licence and the next club takes the place', () => {
    const input = scenario();
    input.facts.get('a3')!.europe = { kind: 'eurocup', stage: 'champion' }; input.facts.get('b2')!.europe = { kind: 'eurocup', stage: 'final' };
    input.eurocupFinal = { winner: 'a3', loser: 'b2' };
    input.managedClubId = 'a3';
    const offered = decidePlaces(input);
    expect(offered.decision!.offers).toContainEqual({ clubId: 'a3', competitionId: 'el', type: 'route', outcome: 'accepted', answered: false });
    input.answers = [{ clubId: 'a3', competitionId: 'el', accept: false }];
    const declined = decidePlaces(input);
    sizesValid(declined);
    expect(declined.decision!.offers).toContainEqual({ clubId: 'a3', competitionId: 'el', type: 'route', outcome: 'declined', by: 'manager', answered: true });
    expect(placeOf(declined, 'a3')).toMatchObject({ competitionId: 'ec', type: 'multi-year', until: 5 });
    // The refused route place is a wild card now: one more wild card than with the champion accepting.
    expect(declined.decision!.chosen.length).toBe(offered.decision!.chosen.length + 1);
    // Declining every place is allowed.
    input.answers = [{ clubId: 'a3', competitionId: 'el', accept: false }, { clubId: 'a3', competitionId: 'ec', accept: false }, { clubId: 'a3', competitionId: 'bcl', accept: false }];
    const none = decidePlaces(input);
    sizesValid(none);
    expect(placeOf(none, 'a3')).toBeNull();
    expect(none.held).toContainEqual({ clubId: 'a3', competitionId: 'ec', type: 'multi-year', until: 5, reason: 'declined' });
  });

  it('gives the BCL title holder a place, country places by final ranking and up to four invitations', () => {
    const input = scenario();
    input.bclChampion = 'c3';
    input.facts.get('a6')!.topNext = false; // relegated: its country's next club takes the place
    const next = decidePlaces(input);
    sizesValid(next);
    expect(placeOf(next, 'c3')).toMatchObject({ competitionId: 'bcl', type: 'title-holder' });
    expect(placeOf(next, 'a6')).toBeNull();
    const invitations = listOf(next, 'bcl').filter(clubId => placeOf(next, clubId)!.type === 'invitation');
    expect(invitations.length).toBeLessThanOrEqual(EUROPEAN_ENTRY_RULES.bclInvitations);
  });

  it('always ends at the opening sizes, whatever the season brings', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const input = scenario();
      let value = seed * 7919;
      const random = () => { value = (value * 48271) % 2147483647; return value / 2147483647; };
      for (const facts of input.facts.values()) {
        if (random() < 0.15) facts.topNext = false;
        if (random() < 0.1) facts.unpaid = 5 * M;
        facts.seats = Math.round(2_000 + random() * 15_000);
        facts.budget = Math.round((3 + random() * 30) * M);
      }
      const clubs = [...input.facts.keys()];
      input.eurocupFinal = { winner: clubs[Math.floor(random() * clubs.length)]!, loser: clubs[Math.floor(random() * clubs.length)]! };
      input.bclChampion = clubs[Math.floor(random() * clubs.length)]!;
      input.euroleaguePlayoffs = new Set(clubs.filter(() => random() < 0.3));
      input.managedClubId = clubs[seed % clubs.length]!;
      input.answers = random() < 0.5 ? [{ clubId: input.managedClubId, competitionId: 'el', accept: false }] : [];
      let europe = decidePlaces(input);
      sizesValid(europe);
      // A second season from the first one's places.
      europe = decidePlaces({ ...input, seasonNumber: 2, europe });
      sizesValid(europe);
    }
  });
});

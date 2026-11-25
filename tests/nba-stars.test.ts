import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, dateForRound, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { addMarketDays, getMarketStartReason } from '../src/world/market-policy';
import { seasonRounds } from '../src/world/career-world';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { contractForSeason } from '../src/world/employment-policy';
import { contractAskingWage } from '../src/world/contract-roles';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getActiveCareerPlayers, getCareerPlayerAge } from '../src/world/player-catalog';
import { isPlayerRetired } from '../src/world/lifecycle-policy';
import { NBA_MID_LEVEL, nbaMaximumWage, nbaMinimumWage } from '../src/world/nba-cap';
import { nbaValue } from '../src/world/nba-moves';
import { NBA_FREE_AGENCY_RULES, nbaBirdStar, nbaLevelWage, nbaUnsignedLeaves, usesNbaFreeAgency } from '../src/world/nba-free-agency';

/**
 * Format 103 (`world.nbaFreeAgency`): NBA stars stay in the league. Measured before on the live pack (NBA alone, seed 7):
 * 12 of the 17 players rated 86+ whose contracts ended after season 1 asked more than the most an NBA contract may pay
 * them (their wage plus the Star role's 15%, plus 5% for two seasons), the others did not fit their owners' ceilings, so
 * every renewal request was declined, no club could sign them in the offseason, and all 17 left the world at the next
 * opening (15 rated 88+, two of them 99s). The rules on the synthetic NBA (asks within the maximum, Bird rights for
 * stars, asks falling in free agency, departures only of players nobody would sign), then one automatic season,
 * offseason and opening in which every good player stays in the league and nearly all keep a club.
 */
const world = worldFromPack(nbaPack(), 'nba');
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const players = NBA_CLUB_IDS.flatMap(clubId => world.clubs.find(club => club.id === clubId)!.players.map(player => ({ id: player.id, clubId })));

describe('the format-103 NBA free agency rules', () => {
  const fresh = createSeason({ seed: 21, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
  const older = createSeason({ seed: 21, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS, nbaFreeAgency: false });
  const maximum = (state: SeasonState, id: string) => nbaMaximumWage(getCareerPlayerAge(state, id, state.date));

  it('marks new careers in worlds with the NBA\'s money rules only, and refuses the marker before format 103', () => {
    expect(fresh.world!.nbaFreeAgency).toBe(true);
    expect(usesNbaFreeAgency(fresh)).toBe(true);
    expect(older.world!.nbaFreeAgency).toBeUndefined();
    expect(usesNbaFreeAgency(older)).toBe(false);
    const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };
    const europe = worldFromPack(economyPack([SPAIN]), 'acb');
    expect(createSeason({ seed: 3, world: europe, managedClubId: europe.clubs[0]!.id, ...NEW_CAREER_SYSTEMS }).world!.nbaFreeAgency).toBeUndefined();
    const envelope = JSON.parse(serializeSeason(fresh));
    expect(parseSeason(JSON.stringify(envelope)).world!.nbaFreeAgency).toBe(true);
    envelope.formatVersion = 102; envelope.state.schemaVersion = 102;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/world\.nbaFreeAgency.*format 103 or later/);
  });

  it('never lets a player ask an NBA club more than his maximum contract or his level (before, the best-paid asked more than any club may pay)', () => {
    const asks = (state: SeasonState, id: string, clubId: string) => [contractAskingWage(state, clubId, id, 'star'), requiredNegotiationWage(id, 2, undefined, state, 'star', clubId), requiredNegotiationWage(id, 3, undefined, state, 'star', clubId)];
    const cap = (id: string) => Math.min(maximum(fresh, id), nbaLevelWage(fresh, id)!);
    for (const { id, clubId } of players) for (const ask of asks(fresh, id, clubId)) expect(ask).toBeLessThanOrEqual(Math.max(cap(id), nbaMinimumWage(getCareerPlayerAge(fresh, id, fresh.date))));
    const overMaximum = players.filter(({ id, clubId }) => asks(older, id, clubId).some(ask => ask > maximum(older, id)));
    expect(overMaximum.length).toBeGreaterThan(0);
    // The same players ask at most their maximum now, and players below both limits ask as before.
    for (const { id, clubId } of overMaximum) expect(contractAskingWage(fresh, clubId, id, 'star')).toBe(Math.min(cap(id), contractAskingWage(older, clubId, id, 'star')));
    const below = players.find(({ id, clubId }) => !overMaximum.some(item => item.id === id) && asks(older, id, clubId)[2]! < cap(id))!;
    expect(asks(fresh, below.id, below.clubId)).toEqual(asks(older, below.id, below.clubId));
  });

  it('gives Bird rights past the owner\'s ceiling for a club\'s best players only', () => {
    const ranked = [...players].sort((left, right) => nbaValue(fresh, right.id) - nbaValue(fresh, left.id));
    expect(nbaBirdStar(fresh, ranked[0]!.id)).toBe(true);
    expect(nbaBirdStar(older, ranked[0]!.id)).toBe(false);
    for (const { id } of players) expect(nbaBirdStar(fresh, id)).toBe(nbaValue(fresh, id) >= NBA_FREE_AGENCY_RULES.birdStarLevel);
  });

  it('asks other NBA clubs at most the mid-level exception in the offseason, then his minimum salary; his own club his full ask', () => {
    const offseason = { ...fresh, status: 'complete' as const }, opens = dateForRound(seasonRounds(fresh), 1);
    const later = { ...offseason, date: addMarketDays(opens, NBA_FREE_AGENCY_RULES.minimumAfterDays) };
    const expensive = players.filter(({ id, clubId }) => contractForSeason(fresh.employment, id, 1)?.endsSeason === 1 && contractAskingWage(older, clubId, id) > NBA_MID_LEVEL);
    expect(expensive.length).toBeGreaterThan(0);
    for (const { id, clubId } of expensive) {
      const other = NBA_CLUB_IDS.find(item => item !== clubId)!;
      const early = contractAskingWage(offseason, other, id);
      expect(early).toBeLessThanOrEqual(NBA_MID_LEVEL);
      expect(early % 50_000).toBe(0);
      expect(contractAskingWage(later, other, id)).toBe(nbaMinimumWage(getCareerPlayerAge(later, id, later.date)));
      expect(contractAskingWage(offseason, clubId, id)).toBeGreaterThan(NBA_MID_LEVEL);
      expect(contractAskingWage(later, clubId, id)).toBeGreaterThan(NBA_MID_LEVEL);
      // In season, and in older careers, his ask is the same at every club.
      expect(contractAskingWage(fresh, other, id)).toBeGreaterThan(NBA_MID_LEVEL);
      expect(contractAskingWage({ ...older, status: 'complete' as const }, other, id)).toBeGreaterThan(NBA_MID_LEVEL);
    }
  });

  it('lets only players nobody would sign leave the NBA-only world unsigned', () => {
    // At the second season's opening every opening player had a contract the season before.
    const opening = { ...fresh, seasonNumber: 2 };
    for (const { id } of players) {
      const value = nbaValue(opening, id), age = getCareerPlayerAge(opening, id, opening.date)!;
      expect(nbaUnsignedLeaves(opening, id)).toBe(value < NBA_FREE_AGENCY_RULES.keepLevel || age >= NBA_FREE_AGENCY_RULES.keepMaxAge && value < NBA_FREE_AGENCY_RULES.keepVeteranLevel);
      // A player unsigned all last season leaves, as does everyone in older careers.
      expect(nbaUnsignedLeaves(fresh, id)).toBe(true);
      expect(nbaUnsignedLeaves({ ...older, seasonNumber: 2 }, id)).toBe(true);
    }
  });
});

describe('one automatic NBA season, offseason and opening with format 103', () => {
  let complete: SeasonState, next: SeasonState;
  beforeAll(() => {
    let state = setEmploymentDelegation(createSeason({ seed: 21, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS }), true);
    while (state.status === 'active') state = play(state);
    complete = state;
    for (let steps = 0; steps < 200 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    next = rolloverSeason(parseSeason(serializeSeasonCompact(state)));
    parseSeason(serializeSeasonCompact(next));
  }, 3_400_000);

  it('keeps every good player in the league: nobody rated 80+ leaves except by retiring at his age, nearly all keep a club', () => {
    const good = getActiveCareerPlayers(complete).filter(player => nbaValue(complete, player.id) >= 80);
    expect(good.length).toBeGreaterThan(30);
    const active = new Set(getActiveCareerPlayers(next).map(player => player.id));
    const departed = (id: string) => next.lifecycle.notices.some(notice => notice.playerId === id && notice.clubId === null && notice.announcedSeason === 2 && notice.lastSeason === 1);
    const unsigned = good.filter(player => active.has(player.id) && !contractForSeason(next.employment, player.id, 2));
    console.log(`Rated 80+: ${good.length}; unsigned at the opening (free agents): ${unsigned.map(player => `${player.id} ${nbaValue(next, player.id)} (${getCareerPlayerAge(next, player.id, next.date)})`).join(', ') || 'none'}`);
    for (const player of good) if (!active.has(player.id)) expect(isPlayerRetired(next, player.id) && !departed(player.id)).toBe(true);
    expect(unsigned.length).toBeLessThanOrEqual(2);
  });

  it('keeps every NBA club at 13-15 players for the new season', () => {
    for (const clubId of NBA_CLUB_IDS) {
      const size = getActiveCareerPlayers(next).filter(player => contractForSeason(next.employment, player.id, 2)?.clubId === clubId).length;
      expect(size).toBeGreaterThanOrEqual(13);
      expect(size).toBeLessThanOrEqual(15);
    }
  });
});

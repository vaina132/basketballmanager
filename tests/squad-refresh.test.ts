import { describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason, getMarketWindow } from '../src/world/market-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { setFacilityDelegation } from '../src/world/facilities';
import { setPayrollDelegation } from '../src/world/payroll';
import { setSponsorshipDelegation } from '../src/world/commercial';
import { withRealEconomy } from '../src/world/economy';
import { getFinanceBalance } from '../src/world/finance';
import { financeLedgerEntries } from '../src/world/finance-ledger';
import { fullWorldClubsIn, requireWorldContexts, validateWorld } from '../src/world/career-world';
import { withLowerDivisions } from '../src/world/lower-division';
import { contractForSeason, getClubContractSummary } from '../src/world/employment-policy';
import { getCareerPlayers } from '../src/world/player-catalog';
import { protectedProspect, refreshLimit, refreshesThisWindow, releaseCandidates, SQUAD_REFRESH_RULES, usesSquadRefresh } from '../src/world/squad-refresh';
import type { EmploymentContract } from '../src/domain/employment';

/**
 * Format 102 (owner decision 24 November 2026, `world.squadRefresh`): a rich club run automatically with a full squad
 * releases a weak player (the existing contract buyout) to sign a clearly better one of the same position. Worlds without
 * the marker keep their rules.
 */
const RICH = 'w0-harbor-hawks';
/** The club's oldest player (never a protected prospect). */
const oldest = (world: CareerWorld, clubId: string) => [...world.clubs.find(club => club.id === clubId)!.players].sort((a, b) => world.playerProfiles[a.id]!.dateOfBirth.localeCompare(world.playerProfiles[b.id]!.dateOfBirth))[0]!;
/** One country, two divisions of six and a third of four, researched money; the rich club opens with 150% of its budget in cash, a full squad on three-season terms and one weak guard. */
function refreshWorld(): CareerWorld {
  const base = testWorld(12);
  const rich = base.clubs.find(club => club.id === RICH) ? RICH : base.clubs[2]!.id;
  const weak = oldest(base, rich);
  // Other clubs' players of the weak player's position leave as free agents after season 1.
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, club.id === rich ? 3 : player.position === weak.position ? 1 : 1 + (index % 3)])));
  const clubs = base.clubs.map(club => club.id !== rich ? club : { ...club, players: club.players.map(player => player.id !== weak.id ? player : { ...player, attributes: Object.fromEntries(Object.entries(player.attributes).map(([key, value]) => [key, typeof value === 'number' ? Math.max(1, Math.min(value, 4)) : value])) as typeof player.attributes }) });
  const presidents = base.presidents.map(president => president.clubId === rich ? { ...president, generosity: 5 as const, traits: { ...president.traits!, ambition: 5 as const } } : president);
  const world = withRealEconomy(withLowerDivisions({ ...base, clubs, presidents, id: 'squad-refresh-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
  return { ...world, finances: world.finances.map(item => item.clubId === rich && item.economy ? { ...item, economy: { ...item.economy, openingCash: Math.round(item.economy.budget * 1.5 / 10_000) * 10_000 } } : item) };
}
const WORLD = refreshWorld();
const RICH_ID = WORLD.clubs.find(club => club.id === RICH) ? RICH : WORLD.clubs[2]!.id;
const MANAGED = WORLD.clubs[0]!.id;
const play = (state: SeasonState) => state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state;
const delegate = (state: SeasonState) => setSponsorshipDelegation(setPayrollDelegation(setFacilityDelegation(setEmploymentDelegation(state, true), true), true), true);
const career = (squadRefresh = true) => createSeason({ seed: 4, world: WORLD, managedClubId: MANAGED, ...NEW_CAREER_SYSTEMS, squadRefresh });
/** Season 1 played automatically, then its whole offseason window. */
function offseason(squadRefresh = true): { before: SeasonState; after: SeasonState } {
  let state = delegate(career(squadRefresh));
  while (state.status === 'active') state = advanceSeason(play(state));
  const before = state;
  for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
  return { before, after: state };
}
const buyoutsOf = (state: SeasonState) => (getMarketWindow(state)?.events ?? []).filter(event => event.type === 'buyout') as { clubId: string; playerId: string }[];

describe('the squad refresh marker (format 102)', () => {
  it('marks new careers with the spending balance only, and older formats refuse the marker', () => {
    const state = career();
    expect(state.world!.squadRefresh).toBe(true);
    expect(usesSquadRefresh(state)).toBe(true);
    expect(career(false).world!.squadRefresh).toBeUndefined();
    expect(createSeason({ seed: 4, world: WORLD, managedClubId: MANAGED, ...NEW_CAREER_SYSTEMS, spendingBalance: false }).world!.squadRefresh).toBeUndefined();
    expect(createSeason({ seed: 4, ...NEW_CAREER_SYSTEMS }).world?.squadRefresh).toBeUndefined();
    expect(() => createSeason({ seed: 4, world: WORLD, squadRefresh: 'yes' as unknown as boolean })).toThrow(/squad refresh setting/);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 101; envelope.state.schemaVersion = 101;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/squadRefresh.*format 102/);
    // A career without the marker still loads as an older format.
    const older = JSON.parse(serializeSeason(createSeason({ seed: 4, world: WORLD, managedClubId: MANAGED, ...NEW_CAREER_SYSTEMS, squadRefresh: false, managerOfferWithdrawal: false })));
    older.formatVersion = 99; older.state.schemaVersion = 99;
    expect(parseSeason(JSON.stringify(older)).world!.squadRefresh).toBeUndefined();
    expect(() => validateWorld({ ...WORLD, squadRefresh: true })).toThrow(/squadRefresh.*spending balance/);
  });
});

describe('who may be released', () => {
  const state = career();
  const contract = (playerId: string, extra: Partial<EmploymentContract> = {}): EmploymentContract => ({ id: `c-${playerId}`, playerId, clubId: RICH_ID, startsSeason: 1, startsRound: 1, endsSeason: 3, seasonWage: 100_000, signedSeason: 1, signedRound: 1, kind: 'initial', ...extra });
  const squad = WORLD.clubs.find(club => club.id === RICH_ID)!.players.map(player => player.id);
  const ratings = new Map(squad.map((id, index) => [id, 100 - index]));
  const rating = (id: string) => ratings.get(id)!;

  it('looks at the weakest few, cheaper first on equal ratings, and keeps young prospects', () => {
    const contracts = squad.map(id => contract(id));
    const picked = releaseCandidates(state, RICH_ID, contracts, rating, new Set(), () => 0);
    expect(picked.length).toBeLessThanOrEqual(SQUAD_REFRESH_RULES.weakestConsidered);
    for (const id of picked) expect(protectedProspect(state, id)).toBe(false);
    const eligible = squad.filter(id => !protectedProspect(state, id));
    expect(picked).toEqual([...eligible].sort((a, b) => rating(a) - rating(b)).slice(0, SQUAD_REFRESH_RULES.weakestConsidered));
    // Players with open offers, this season's signings and drafted rookies are never released.
    const [first] = picked;
    expect(releaseCandidates(state, RICH_ID, contracts, rating, new Set([first!]), () => 0)).not.toContain(first);
    expect(releaseCandidates(state, RICH_ID, contracts.map(item => item.playerId === first ? { ...item, kind: 'free-agent' as const, signedSeason: 1 } : item), rating, new Set(), () => 0)).not.toContain(first);
    expect(releaseCandidates(state, RICH_ID, contracts.map(item => item.playerId === first ? { ...item, kind: 'drafted' as const } : item), rating, new Set(), () => 0)).not.toContain(first);
  });

  it('never takes the squad below its minimum', () => {
    expect(releaseCandidates(state, RICH_ID, squad.slice(0, 8).map(id => contract(id)), rating, new Set(), () => 0)).toEqual([]);
    expect(releaseCandidates(state, RICH_ID, squad.slice(0, 9).map(id => contract(id)), rating, new Set(), () => 0).length).toBeGreaterThan(0);
  });
});

describe('a rich club with a full squad refreshes it', () => {
  const { before, after } = offseason();

  it('releases its weak player through the buyout and signs a clearly better one of the same position', () => {
    expect(refreshLimit(before, RICH_ID)).toBe(2);
    const own = buyoutsOf(after).filter(event => event.clubId === RICH_ID);
    expect(own.length).toBeGreaterThanOrEqual(1);
    expect(own.length).toBeLessThanOrEqual(2);
    expect(refreshesThisWindow(after, RICH_ID)).toBe(own.length);
    const players = getCareerPlayers(after);
    const weak = oldest(WORLD, RICH_ID).id;
    expect(own.map(event => event.playerId)).toContain(weak);
    // The release paid the buyout (every remaining wage) from the club's money.
    const buyouts = [...financeLedgerEntries(after.finance)].filter(entry => entry.kind === 'buyout' && entry.clubId === RICH_ID);
    expect(buyouts).toHaveLength(own.length);
    for (const entry of buyouts) expect(entry.amount).toBeLessThan(0);
    // Each release was followed at once by an offer to a player of the same position.
    const window = getMarketWindow(after)!;
    for (const event of own) {
      const index = window.events.indexOf(event as never), next = window.events[index + 1] as { type: string; clubId?: string; playerId?: string };
      expect(next.type).toBe('offer');
      expect(next.clubId).toBe(RICH_ID);
      expect(players.find(player => player.id === next.playerId)!.position).toBe(players.find(player => player.id === event.playerId)!.position);
    }
    // The released players are free agents (any club may sign them), and the squad stays full and above the minimum.
    for (const event of own) expect(contractForSeason(after.employment, event.playerId, 2)?.clubId).not.toBe(RICH_ID);
    expect(getClubContractSummary(after, RICH_ID).rosterSize).toBeGreaterThanOrEqual(8);
  });

  it('keeps every club out of unpaid costs, and the save check replays the window exactly', () => {
    for (const club of fullWorldClubsIn(after, 1)) expect(getFinanceBalance(after.finance, club.id).unpaid).toBe(0);
    requireWorldContexts(true);
    try {
      const back = parseSeason(serializeSeasonCompact(after));
      expect(JSON.stringify(back)).toBe(JSON.stringify(after));
      const next = rolloverSeason(back);
      expect(JSON.stringify(parseSeason(serializeSeasonCompact(next)))).toBe(JSON.stringify(next));
    } finally { requireWorldContexts(false); }
  }, 900_000);

  it('changes nothing in careers without the marker', () => {
    const { after: older } = offseason(false);
    expect(older.world!.squadRefresh).toBeUndefined();
    expect(buyoutsOf(older)).toEqual([]);
  }, 900_000);
});

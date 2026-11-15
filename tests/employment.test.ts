import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { DEVELOPMENT_PLAYERS, getDevelopmentPlayer } from '../src/data/development-players';
import { getSeasonWage } from '../src/data/development-wages';
import { createEmployment, enableEmployment, finalizeEmploymentMarket, offerPlayerContract, prepareEmploymentMarket, setEmploymentDelegation } from '../src/world/employment';
import { contractForSeason, EMPLOYMENT_BUDGET, getAvailablePlayers, getClubContractSummary, getContractedClubs, MAX_CONTRACT_WAGE, MAX_ROSTER_SIZE, MIN_ROSTER_SIZE, quotePlayerContract } from '../src/world/employment-policy';
import { createSeason } from '../src/world/season';

const clubId = DEVELOPMENT_CLUBS[0]!.id;
const ownPlayers = DEVELOPMENT_CLUBS[0]!.players;
const ownId = ownPlayers[0]!.id;
const otherId = DEVELOPMENT_CLUBS[1]!.players[0]!.id;
const create = () => enableEmployment(createSeason(29, clubId, 'off'));
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Isolated command-policy boundary; real completed seasons are covered by rollover integration tests. */
const offseason = (state = create()): SeasonState => prepareEmploymentMarket({ ...state, status: 'complete', round: 10 });

describe('employment activation and prospective terms', () => {
  it('keeps legacy careers disabled and leaves current matches and money untouched on activation', () => {
    const original = freeze(createSeason(29, clubId, 'off'));
    expect(original.employment).toEqual(createEmployment());
    const state = enableEmployment(original);
    expect(state.employment.contracts).toHaveLength(60);
    expect(state.employment.enabledSince).toEqual({ seasonNumber: 1, round: 1 });
    expect(state.activeMatch!).toBe(original.activeMatch!);
    expect(state.finance).toBe(original.finance);
    expect(state.payroll).toBe(original.payroll);
    expect(state.clubs).toBe(original.clubs);
    expect(state.employment.contracts.map(contract => contract.playerId)).toEqual(DEVELOPMENT_PLAYERS.map(player => player.id));
    for (const [index, contract] of state.employment.contracts.entries()) expect(contract).toMatchObject({ id: `employment-contract-${index + 1}`, kind: 'initial', startsSeason: 1, endsSeason: 1, signedSeason: 1, signedRound: 1, seasonWage: getSeasonWage(contract.playerId) });
    expect(enableEmployment(state)).toBe(state);
  });

  it('requires both finance and payroll, including for an explicitly opted-in new career', () => {
    expect(() => enableEmployment(createSeason(29, clubId, 'off', true, true, false))).toThrow(/finances and player payroll/);
    expect(() => enableEmployment(createSeason(29, clubId, 'off', true, true, true, false))).toThrow(/finances and player payroll/);
    expect(createSeason(29, clubId, 'off', true, true, true, true, null, true).employment.contracts).toHaveLength(60);
  });

  it('signs a three-year renewal without changing current registration, payroll, or sporting state', () => {
    const state = freeze(create());
    const next = offerPlayerContract(state, ownId, 2_000_000, 3);
    expect(contractForSeason(next.employment, ownId, 1)).toEqual(contractForSeason(state.employment, ownId, 1));
    const contract = contractForSeason(next.employment, ownId, 2);
    expect(contract).toMatchObject({ playerId: ownId, clubId, kind: 'renewal', startsSeason: 2, endsSeason: 4, seasonWage: 2_000_000 });
    expect(contractForSeason(next.employment, ownId, 4)).toBe(contract);
    expect(contractForSeason(next.employment, ownId, 5)).toBeNull();
    expect(next.clubs).toBe(state.clubs);
    expect(next.rosters).toBe(state.rosters);
    expect(next.activeMatch!).toBe(state.activeMatch!);
    expect(next.finance).toBe(state.finance);
    expect(next.payroll).toBe(state.payroll);
    expect(() => offerPlayerContract(next, ownId, 2_000_000, 1)).toThrow(/already has a contract/);
  });

  it('rejects outside recruitment during the season and invalid or below-asking terms', () => {
    const state = create();
    expect(quotePlayerContract(state, otherId, getSeasonWage(otherId), 1)).toMatchObject({ canOffer: false, reason: expect.stringMatching(/own players/) });
    expect(getAvailablePlayers(state)).toEqual([]);
    for (const wage of [NaN, Infinity, 0, 499_999, MAX_CONTRACT_WAGE + 50_000, 1_800_001]) expect(quotePlayerContract(state, ownId, wage, 1).canOffer).toBe(false);
    for (const years of [0, -1, 1.5, 4, NaN]) expect(quotePlayerContract(state, ownId, 1_800_000, years).canOffer).toBe(false);
    expect(quotePlayerContract(state, ownId, 1_750_000, 1).reason).toMatch(/asking wage/);
    expect(quotePlayerContract(state, 'missing', 1_800_000, 1).canOffer).toBe(false);
    expect(() => getDevelopmentPlayer('missing')).toThrow(/catalog/);
    expect(quotePlayerContract({ ...state, seasonNumber: 7974 }, ownId, 1_800_000, 1).canOffer).toBe(false);
    const lastSeason: SeasonState = { ...state, seasonNumber: 7974, status: 'complete', round: 10 };
    expect(prepareEmploymentMarket(lastSeason)).toBe(lastSeason);
    expect(() => finalizeEmploymentMarket(lastSeason)).toThrow(/last supported season/);
  });
});

describe('annual wage budget and viable squad size', () => {
  it('protects the cost of completing an eight-player squad in every contracted year', () => {
    let state = create();
    for (const player of ownPlayers.slice(0, 3)) state = offerPlayerContract(state, player.id, MAX_CONTRACT_WAGE, 3);
    for (const year of [2, 3, 4]) expect(getClubContractSummary(state, clubId, year)).toMatchObject({ rosterSize: 3, seasonWages: 15_000_000, remainingBudget: 9_000_000, minimumReserve: 9_000_000, spendableBudget: 0 });
    expect(() => offerPlayerContract(state, ownPlayers[3]!.id, MAX_CONTRACT_WAGE, 1)).toThrow(/protecting space for eight/);
    for (const player of ownPlayers.slice(3, 8)) state = offerPlayerContract(state, player.id, getSeasonWage(player.id), 3);
    for (const year of [2, 3, 4]) {
      const summary = getClubContractSummary(state, clubId, year);
      expect(summary.rosterSize).toBe(8);
      expect(summary.minimumReserve).toBe(0);
      expect(summary.seasonWages).toBeLessThanOrEqual(EMPLOYMENT_BUDGET);
    }
  });

  it('checks later annual commitments instead of looking only at the opening contract year', () => {
    let state = create();
    for (const player of ownPlayers.slice(0, 3)) state = offerPlayerContract(state, player.id, MAX_CONTRACT_WAGE, 3);
    for (const player of ownPlayers.slice(5)) state = offerPlayerContract(state, player.id, getSeasonWage(player.id), 1);
    // Season two has its eight players; season three must still reserve five places.
    expect(quotePlayerContract(state, ownPlayers[3]!.id, 2_000_000, 1).canOffer).toBe(true);
    expect(quotePlayerContract(state, ownPlayers[3]!.id, 2_000_000, 2).reason).toMatch(/season 3 wage budget/);
  });

  it('caps squads at twelve and never reserves one player for two clubs', () => {
    let state = create();
    for (const player of ownPlayers) state = offerPlayerContract(state, player.id, getSeasonWage(player.id), 1);
    state = offseason(state);
    const incoming = getAvailablePlayers(state).filter(player => !ownPlayers.some(own => own.id === player.id));
    for (const player of incoming.slice(0, 2)) state = offerPlayerContract(state, player.id, getSeasonWage(player.id), 1);
    expect(getClubContractSummary(state, clubId).rosterSize).toBe(MAX_ROSTER_SIZE);
    expect(quotePlayerContract(state, incoming[2]!.id, getSeasonWage(incoming[2]!.id), 1).reason).toMatch(/twelve/);
    expect(quotePlayerContract(state, incoming[0]!.id, getSeasonWage(incoming[0]!.id), 1, DEVELOPMENT_CLUBS[1]!.id).reason).toMatch(/already has a contract/);
    const registered = finalizeEmploymentMarket(state).clubs;
    expect(registered.every(club => club.players.length >= MIN_ROSTER_SIZE && club.players.length <= MAX_ROSTER_SIZE)).toBe(true);
    const ids = registered.flatMap(club => club.players.map(player => player.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('offseason recruitment and roster reconstruction', () => {
  it('prepares AI retention once without altering completed rosters and blocks an understaffed human club', () => {
    const original = freeze(create());
    const state = offseason(original);
    expect(state.clubs).toBe(original.clubs);
    expect(state.activeMatch!).toBe(original.activeMatch!);
    expect(state.rosters).toBe(original.rosters);
    for (const club of state.clubs.filter(club => club.id !== clubId)) expect(getClubContractSummary(state, club.id).rosterSize).toBe(8);
    expect(prepareEmploymentMarket(state)).toBe(state);
    expect(getAvailablePlayers(state)).toHaveLength(20);
    const frozen = freeze(state);
    expect(() => finalizeEmploymentMarket(frozen)).toThrow(/at least eight/);
    expect(frozen.employment.contracts).toHaveLength(100);
  });

  it('applies real departures and signings with deterministic jerseys and stable player identities', () => {
    let state = create();
    for (const player of ownPlayers.slice(0, 7)) state = offerPlayerContract(state, player.id, getSeasonWage(player.id), 2);
    state = offseason(state);
    const incoming = getAvailablePlayers(state).find(player => !ownPlayers.some(own => own.id === player.id) && ownPlayers.slice(0, 7).some(own => own.number === player.number))!;
    expect(incoming).toBeDefined();
    const pending = offerPlayerContract(state, incoming.id, getSeasonWage(incoming.id), 2);
    expect(pending.clubs).toBe(state.clubs);
    expect(contractForSeason(pending.employment, incoming.id, 2)?.kind).toBe('free-agent');
    const result = finalizeEmploymentMarket(freeze(pending));
    const club = result.clubs.find(club => club.id === clubId)!;
    expect(club.players.map(player => player.id)).toContain(incoming.id);
    expect(club.players.map(player => player.id)).not.toContain(ownPlayers[7]!.id);
    expect(club.players).toHaveLength(8);
    expect(new Set(club.players.map(player => player.number)).size).toBe(club.players.length);
    for (const player of club.players) expect({ ...player, number: getDevelopmentPlayer(player.id).number }).toEqual(getDevelopmentPlayer(player.id));
    expect(result.clubs).toEqual(getContractedClubs(result, 2));
    expect(result.employment.market).toBeNull();
    expect(result.activeMatch!).toBe(state.activeMatch!);
    expect(finalizeEmploymentMarket(pending)).toEqual(result);
    expect(getContractedClubs(result, 1)).toEqual(DEVELOPMENT_CLUBS);
  });

  it('uses the same guards for delegation and preserves binding contracts when delegation is disabled', () => {
    const state = setEmploymentDelegation(create(), true);
    expect(getClubContractSummary(state, clubId).rosterSize).toBe(10);
    const manual = setEmploymentDelegation(state, false);
    expect(manual.employment.contracts).toBe(state.employment.contracts);
    expect(manual.employment.delegated).toBe(false);
    const completed = finalizeEmploymentMarket(offseason(state));
    expect(completed.clubs.every(club => club.players.length === 10)).toBe(true);
    for (const club of completed.clubs) expect(getClubContractSummary(completed, club.id).seasonWages).toBeLessThanOrEqual(EMPLOYMENT_BUDGET);
    expect(() => setEmploymentDelegation(createSeason(29), true)).toThrow(/Enable player contracts/);
    expect(() => finalizeEmploymentMarket(state)).toThrow(/Finish the season/);
  });

  it('can delegate a previously unplanned offseason and retains canonical rosters for legacy history', () => {
    const state = setEmploymentDelegation(offseason(), true);
    expect(getClubContractSummary(state, clubId).rosterSize).toBe(10);
    expect(finalizeEmploymentMarket(state).clubs.every(club => club.players.length === 10)).toBe(true);
    expect(getContractedClubs({ ...state, employment: { ...state.employment, enabledSince: { seasonNumber: 3, round: 2 } } }, 2)).toEqual(DEVELOPMENT_CLUBS);
    const disabled = createSeason(29);
    expect(prepareEmploymentMarket(disabled)).toBe(disabled);
    expect(finalizeEmploymentMarket(disabled)).toBe(disabled);
  });
});

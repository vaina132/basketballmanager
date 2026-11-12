import { stripInSeasonRecruitment } from './helpers/legacy-season';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_PLAYERS } from '../src/data/development-players';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { enableEmployment, offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { contractForSeason, getAvailablePlayers } from '../src/world/employment-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const clubId = 'atlantic-pilots';
const finish = (state: SeasonState): SeasonState => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function complete(state: SeasonState): SeasonState { while (state.status !== 'complete') state = advanceSeason(finish(state)); return state; }
const envelope = (state: unknown, formatVersion = 30) => JSON.stringify({ format: 'basketball-manager-season', formatVersion, engineVersion: 'possession-3', state });

let initial: SeasonState, offseason: SeasonState, recruited: SeasonState, second: SeasonState, secondWeek: SeasonState;
let incomingId: string, renewedId: string;
beforeAll(() => {
  initial = createSeason(9, clubId, 'standard', true, true, true, true, null, true);
  offseason = complete(initial);
  const own = initial.clubs.find(club => club.id === clubId)!.players;
  renewedId = own[0]!.id;
  recruited = offerPlayerContract(offseason, renewedId, 2_000_000, 3);
  for (const player of own.slice(1, 7)) recruited = offerPlayerContract(recruited, player.id, getSeasonWage(player.id), 1);
  incomingId = getAvailablePlayers(recruited).find(player => !own.some(member => member.id === player.id))!.id;
  recruited = offerPlayerContract(recruited, incomingId, getSeasonWage(incomingId), 2);
  second = rolloverSeason(recruited);
  secondWeek = advanceSeason(finish(second));
}, 60_000);

describe('employment persistence across registrations', () => {
  it('round-trips an active renewal, open market, accepted offers, opening day and developed week', () => {
    const early = offerPlayerContract(initial, renewedId, 2_000_000, 3);
    for (const state of [initial, early, offseason, recruited, second, secondWeek]) {
      const restored = parseSeason(serializeSeason(state));
      expect(restored).toEqual(state);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(state.activeMatch));
    }
  });

  it('retains original box scores and wages after changing club membership', () => {
    const own = second.clubs.find(club => club.id === clubId)!;
    expect(own.players).toHaveLength(8);
    expect(own.players.some(player => player.id === incomingId)).toBe(true);
    expect(new Set(own.players.map(player => player.number)).size).toBe(own.players.length);
    expect(second.history[0]!.rosters).toEqual(offseason.rosters);
    expect(second.history[0]!.fixtures.map(fixture => fixture.result)).toEqual(offseason.fixtures.map(fixture => fixture.result));
    const before = second.payroll.agreements.find(agreement => agreement.playerId === renewedId && agreement.seasonNumber === 1)!;
    const after = second.payroll.agreements.find(agreement => agreement.playerId === renewedId && agreement.seasonNumber === 2)!;
    expect(before.seasonWage).toBe(getSeasonWage(renewedId));
    expect(after.seasonWage).toBe(2_000_000);
    expect(second.payroll.agreements.find(agreement => agreement.playerId === incomingId && agreement.seasonNumber === 1)!.clubId).not.toBe(clubId);
    expect(second.payroll.agreements.find(agreement => agreement.playerId === incomingId && agreement.seasonNumber === 2)!.clubId).toBe(clubId);
    expect(parseSeason(serializeSeason(secondWeek))).toEqual(secondWeek);
  });

  it('retains dormant free agents development and conditions without including them in a training report', () => {
    const free = DEVELOPMENT_PLAYERS.filter(player => !contractForSeason(second.employment, player.id, 2));
    expect(free.length).toBeGreaterThan(0);
    for (const player of free) {
      expect(secondWeek.training.points[player.id]).toEqual(second.training.points[player.id]);
      expect(secondWeek.training.lastWeek!.players[player.id]).toBeUndefined();
      expect(secondWeek.conditions[player.id]).toBe(second.conditions[player.id]);
    }
    expect(parseSeason(serializeSeason(secondWeek))).toEqual(secondWeek);
  });

  it('preserves multiyear terms and old membership through a second rollover', () => {
    const next = rolloverSeason(complete(setEmploymentDelegation(secondWeek, true)));
    expect(contractForSeason(next.employment, renewedId, 3)).toEqual(contractForSeason(second.employment, renewedId, 2));
    expect(next.history[0]!.rosters).toEqual(offseason.rosters);
    expect(next.history[1]!.rosters).toEqual(second.rosters);
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  });

  it('migrates actual format 9 with full historical statistics and employment disabled', () => {
    const legacy = complete(createSeason(9, clubId, 'off'));
    const previous = rolloverSeason(legacy);
    const old = structuredClone(previous) as unknown as Record<string, unknown>;
    stripInSeasonRecruitment(old); delete old.market; delete old.employment; delete old.scouting; delete old.negotiations; old.schemaVersion = 9;
    const restored = parseSeason(envelope(old, 9));
    expect(restored).toEqual(previous);
    expect(restored.employment.enabledSince).toBeNull();
    expect(restored.history[0]!.fixtures[0]!.result.stats).not.toBeNull();
    const enabled = enableEmployment(restored);
    expect(enabled.employment.enabledSince).toEqual({ seasonNumber: 2, round: 1 });
    expect(parseSeason(serializeSeason(enabled))).toEqual(enabled);
  });

  it('supports opt-in activation in a completed legacy career without changing its final game', () => {
    const legacy = complete(createSeason(12, clubId, 'off'));
    const enabled = enableEmployment(legacy);
    expect(enabled.activeMatch).toEqual(legacy.activeMatch);
    expect(enabled.employment.market).toEqual({ seasonNumber: 2 });
    expect(parseSeason(serializeSeason(enabled))).toEqual(enabled);
  });
});

describe('employment save accounting rejects tampering', () => {
  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['missing employment record', state => { delete (state as Partial<SeasonState>).employment; }],
    ['unknown model', state => { Object.assign(state.employment, { model: 'other' }); }],
    ['future activation', state => { state.employment.enabledSince!.seasonNumber = 3; }],
    ['missing initial term', state => { state.employment.contracts.shift(); }],
    ['changed initial owner', state => { state.employment.contracts[0]!.clubId = clubId; }],
    ['rewritten first wage', state => { state.employment.contracts[0]!.seasonWage += 50_000; }],
    ['missing contract identity', state => { state.employment.contracts.at(-1)!.id = 'invented'; }],
    ['unknown employee', state => { state.employment.contracts.at(-1)!.playerId = 'unknown'; }],
    ['unknown employer', state => { state.employment.contracts.at(-1)!.clubId = 'unknown'; }],
    ['signing in the future', state => { state.employment.contracts.at(-1)!.signedSeason = 3; }],
    ['out-of-order signing', state => { state.employment.contracts.at(-1)!.signedRound = 1; }],
    ['overlapping employment', state => { const c = { ...state.employment.contracts.at(-1)!, id: `employment-contract-${state.employment.contracts.length + 1}` }; state.employment.contracts.push(c); }],
    ['five year term', state => { state.employment.contracts.at(-1)!.endsSeason += 5; }],
    ['midseason free-agent signing', state => { state.employment.contracts.at(-1)!.signedRound = 9; }],
    ['incorrect renewal kind', state => { state.employment.contracts.at(-1)!.kind = 'renewal'; }],
    ['below asking wage', state => { state.employment.contracts.at(-1)!.seasonWage = 500_000; }],
    ['fractional wage', state => { state.employment.contracts.at(-1)!.seasonWage += 1; }],
    ['overdue recruitment window', state => { state.employment.market = { seasonNumber: 2 }; }],
    ['stale annual payroll', state => { state.payroll.agreements.find(agreement => agreement.playerId === renewedId && agreement.seasonNumber === 2)!.seasonWage = getSeasonWage(renewedId); }],
    ['rewritten historical owner', state => { state.history[0]!.rosters.find(roster => roster.clubId === clubId)!.players = state.clubs.find(club => club.id === clubId)!.players; }],
    ['changed current jersey', state => { const player = state.clubs.find(club => club.id === clubId)!.players[0]!; Object.assign(player, { number: player.number === 99 ? 98 : 99 }); }],
    ['missing free-agent development', state => { const free = DEVELOPMENT_PLAYERS.find(player => !contractForSeason(state.employment, player.id, 2))!; delete state.training.points[free.id]; }],
    ['invalid free-agent condition', state => { const free = DEVELOPMENT_PLAYERS.find(player => !contractForSeason(state.employment, player.id, 2))!; state.conditions[free.id] = NaN; }],
    ['invented free-agent fatigue', state => { const free = DEVELOPMENT_PLAYERS.find(player => !contractForSeason(state.employment, player.id, 2))!; state.conditions[free.id] = 70; }],
  ];
  it.each(mutations)('rejects %s before replacing the live career', (_name, mutate) => {
    const state = structuredClone(secondWeek); mutate(state);
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(envelope(state))).toThrow();
  });

  it('rejects disabling an employment system that already changed ownership', () => {
    const state = structuredClone(secondWeek);
    state.employment = createSeason().employment;
    expect(() => validateSeasonState(state)).toThrow();
  });

  it('rejects an unprepared offseason market and a finance-free employment anchor', () => {
    const missing = structuredClone(offseason); missing.employment.market = null;
    expect(() => validateSeasonState(missing)).toThrow(/employment.market/);
    const unbacked = structuredClone(initial); unbacked.payroll = createSeason(9, clubId, 'off', true, true, true, false).payroll;
    expect(() => validateSeasonState(unbacked)).toThrow(/payroll/);
  });

  it('rejects future salary promises that consume the minimum-roster reserve', () => {
    const state = structuredClone(recruited);
    const renewals = state.employment.contracts.filter(contract => contract.clubId === clubId && contract.startsSeason === 2);
    for (const contract of renewals.slice(0, 4)) contract.seasonWage = 5_000_000;
    expect(() => validateSeasonState(state)).toThrow(/annual wage allocation/);
  });

  it('requires AI clubs to retain a legal minimum before exposing the market', () => {
    const state = structuredClone(offseason);
    const removed = [...state.employment.contracts].reverse().find(contract => contract.kind === 'renewal')!;
    state.employment.contracts = state.employment.contracts.filter(contract => contract.id !== removed.id).map((contract, index) => ({ ...contract, id: `employment-contract-${index + 1}` }));
    expect(() => validateSeasonState(state)).toThrow(/automatic minimum squad/);
  });
});

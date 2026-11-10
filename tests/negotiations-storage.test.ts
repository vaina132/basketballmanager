import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { NegotiationRecord } from '../src/domain/negotiations';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { getAvailablePlayers } from '../src/world/employment-policy';
import { enableNegotiations } from '../src/world/negotiations';
import { evaluateNegotiation, requiredNegotiationWage } from '../src/world/negotiations-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';

const clubId = 'rhine-falcons';
const play = (state: SeasonState): SeasonState => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function complete(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }
const envelope = (state: unknown, formatVersion = 16) => JSON.stringify({ format: 'basketball-manager-season', formatVersion, engineVersion: 'possession-3', state });
const accepted = (state: SeasonState): NegotiationRecord => state.negotiations.records.find(record => record.outcome === 'accepted')!;
const countered = (state: SeasonState): NegotiationRecord => state.negotiations.records.find(record => record.outcome === 'countered')!;

let initial: SeasonState, rejected: SeasonState, counter: SeasonState, signed: SeasonState, completed: SeasonState, recruited: SeasonState, second: SeasonState, secondWeek: SeasonState;
let playerId: string, incomingId: string;
beforeAll(() => {
  initial = createSeason(31, clubId, 'standard', true, true, true, true, null, true, true, true);
  const own = initial.clubs.find(club => club.id === clubId)!.players;
  playerId = own[0]!.id;
  rejected = offerPlayerContract(initial, playerId, 500_000, 3);
  counter = offerPlayerContract(rejected, playerId, getSeasonWage(playerId), 3);
  signed = offerPlayerContract(counter, playerId, getSeasonWage(playerId), 1);
  signed = offerPlayerContract(signed, own[1]!.id, requiredNegotiationWage(own[1]!.id, 3), 3);
  completed = complete(signed);
  recruited = completed;
  for (const player of own.slice(2, 7)) recruited = offerPlayerContract(recruited, player.id, getSeasonWage(player.id), 1);
  incomingId = getAvailablePlayers(recruited).find(player => !own.some(member => member.id === player.id))!.id;
  recruited = offerPlayerContract(recruited, incomingId, getSeasonWage(incomingId), 2);
  recruited = offerPlayerContract(recruited, incomingId, requiredNegotiationWage(incomingId, 2), 2);
  second = rolloverSeason(recruited);
  secondWeek = play(second);
}, 60_000);

describe('negotiation journal persistence', () => {
  it('round-trips rejections, counteroffers, alternative acceptance, AI offers and offseason signings', () => {
    for (const state of [initial, rejected, counter, signed, completed, recruited, second, secondWeek]) {
      const text = serializeSeason(state), restored = parseSeason(text);
      expect(JSON.parse(text).formatVersion).toBe(16);
      expect(restored).toEqual(state);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(state.activeMatch));
    }
  });

  it('keeps unaccepted offers outside roster, payroll and finance commitments', () => {
    const restored = parseSeason(serializeSeason(counter));
    expect(restored.employment).toEqual(initial.employment);
    expect(restored.payroll).toEqual(initial.payroll);
    expect(restored.finance).toEqual(initial.finance);
    expect(restored.clubs).toEqual(initial.clubs);
    expect(restored.negotiations.records.map(record => record.outcome)).toEqual(['rejected', 'countered']);
    expect(restored.negotiations.records.every(record => record.contractId === null)).toBe(true);
  });

  it('binds every post-activation employment agreement to one accepted reply', () => {
    const acceptedRecords = second.negotiations.records.filter(record => record.outcome === 'accepted');
    const newContracts = second.employment.contracts.slice(second.negotiations.enabledSince!.contractCount);
    expect(acceptedRecords.map(record => record.contractId)).toEqual(newContracts.map(contract => contract.id));
    expect(acceptedRecords.some(record => record.clubId !== clubId)).toBe(true);
    expect(second.payroll.agreements.find(agreement => agreement.playerId === incomingId && agreement.seasonNumber === 2)!.seasonWage).toBe(requiredNegotiationWage(incomingId, 2));
    expect(second.history[0]!.fixtures.map(fixture => fixture.result)).toEqual(completed.fixtures.map(fixture => fixture.result));
  });

  it('persists counteroffers repeated on a later matchday without duplicating the same-boundary response', () => {
    expect(offerPlayerContract(counter, playerId, getSeasonWage(playerId), 3)).toBe(counter);
    const later = offerPlayerContract(play(counter), playerId, getSeasonWage(playerId), 3);
    expect(later.negotiations.records.map(record => record.round)).toEqual([1, 1, 2]);
    expect(parseSeason(serializeSeason(later))).toEqual(later);
  });

  it('permits same-round contracts agreed before activation without inventing conversations for them', () => {
    let state = createSeason(31, clubId, 'off', true, true, true, true, null, true, true, false);
    state = offerPlayerContract(state, playerId, getSeasonWage(playerId), 3);
    const count = state.employment.contracts.length;
    state = enableNegotiations(state);
    expect(state.negotiations.enabledSince).toEqual({ seasonNumber: 1, round: 1, contractCount: count });
    const other = state.clubs.find(club => club.id === clubId)!.players[1]!;
    state = offerPlayerContract(state, other.id, requiredNegotiationWage(other.id, 2), 2);
    expect(state.negotiations.records).toHaveLength(1);
    expect(state.negotiations.records[0]!.contractCountBefore).toBe(count);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  });

  it('migrates actual format 11 with transferred squads and scouting history intact, leaving negotiations disabled', () => {
    const previous = structuredClone(secondWeek) as unknown as Record<string, unknown>;
    delete (previous.employment as Record<string, unknown>).transfers; delete previous.market; delete previous.negotiations; previous.schemaVersion = 11;
    const restored = parseSeason(envelope(previous, 11));
    expect(restored.negotiations).toEqual({ model: 'negotiations-1', enabledSince: null, records: [] });
    expect(restored.scouting).toEqual(secondWeek.scouting);
    expect(restored.employment).toEqual(secondWeek.employment);
    expect(restored.history).toEqual(secondWeek.history);
    expect(restored.activeMatch).toEqual(secondWeek.activeMatch);
    const enabled = enableNegotiations(restored);
    expect(enabled.negotiations.enabledSince!.contractCount).toBe(restored.employment.contracts.length);
    expect(parseSeason(serializeSeason(enabled))).toEqual(enabled);
  });

  it('retains the journal through another full season while every club uses delegated recruitment', () => {
    const next = rolloverSeason(complete(setEmploymentDelegation(secondWeek, true)));
    expect(next.negotiations.records.slice(0, secondWeek.negotiations.records.length)).toEqual(secondWeek.negotiations.records);
    expect(next.history[0]!.rosters).toEqual(completed.rosters);
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  });
});

describe('negotiation save validation', () => {
  const mutations: Array<[string, (state: SeasonState) => void]> = [
    ['missing negotiation system', state => { delete (state as Partial<SeasonState>).negotiations; }],
    ['unknown negotiation model', state => { Object.assign(state.negotiations, { model: 'unknown' }); }],
    ['false disabled marker', state => { state.negotiations.enabledSince = null; }],
    ['future activation', state => { state.negotiations.enabledSince!.seasonNumber = 3; }],
    ['activation before initial employment', state => { state.negotiations.enabledSince!.contractCount = 0; }],
    ['activation hides later contracts', state => { state.negotiations.enabledSince!.contractCount = state.employment.contracts.length; }],
    ['missing journal record', state => { state.negotiations.records.pop(); }],
    ['invalid offer identity', state => { state.negotiations.records[0]!.id = 'invented'; }],
    ['unknown player', state => { state.negotiations.records[0]!.playerId = 'unknown'; }],
    ['unknown club', state => { state.negotiations.records[0]!.clubId = 'unknown'; }],
    ['false offer date', state => { state.negotiations.records[0]!.date = '2026-09-06'; }],
    ['false offseason phase', state => { state.negotiations.records[0]!.status = 'complete'; }],
    ['future offer season', state => { state.negotiations.records[0]!.seasonNumber = 3; }],
    ['wrong start season', state => { state.negotiations.records[0]!.startsSeason = 3; }],
    ['unsupported term', state => { state.negotiations.records[0]!.offeredSeasons = 4; }],
    ['fractional wage', state => { state.negotiations.records[0]!.offeredWage += 1; }],
    ['wrong historical employment prefix', state => { state.negotiations.records[0]!.contractCountBefore += 1; }],
    ['fabricated acceptance', state => { state.negotiations.records[0]!.outcome = 'accepted'; }],
    ['changed rejection reason', state => { state.negotiations.records[0]!.reason = 'terms-met'; }],
    ['missing counteroffer', state => { countered(state).counterOffer = null; }],
    ['reduced counteroffer wage', state => { countered(state).counterOffer!.seasonWage -= 50_000; }],
    ['changed alternative duration', state => { countered(state).alternativeOffer!.seasons = 3; }],
    ['false player demand', state => { countered(state).requiredWage += 50_000; }],
    ['contract attached to counteroffer', state => { countered(state).contractId = accepted(state).contractId; }],
    ['accepted reply missing contract', state => { accepted(state).contractId = null; }],
    ['accepted reply uses initial contract', state => { accepted(state).contractId = state.employment.contracts[0]!.id; }],
    ['accepted reply changes wage', state => { accepted(state).offeredWage += 50_000; }],
    ['accepted reply changes duration', state => { accepted(state).offeredSeasons = 2; }],
    ['accepted reply changes employer', state => { accepted(state).clubId = state.clubs[1]!.id; }],
  ];
  it.each(mutations)('rejects %s before replacing the live career', (_name, mutate) => {
    const state = structuredClone(secondWeek); mutate(state);
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(envelope(state))).toThrow();
  });

  it('rejects repeated identical offers at the same boundary even with a fresh sequential identity', () => {
    const state = structuredClone(counter);
    state.negotiations.records.push({ ...structuredClone(state.negotiations.records.at(-1)!), id: `negotiation-${state.negotiations.records.length + 1}` });
    expect(() => validateSeasonState(state)).toThrow(/duplicates/);
  });

  it('rejects unlogged employment agreements after activation', () => {
    const state = structuredClone(signed);
    state.negotiations.records.pop();
    expect(() => validateSeasonState(state)).toThrow(/every employment agreement/);
  });

  it('rejects retrying a historical counteroffer after another club already signed the player', () => {
    const state = structuredClone(second);
    const original = state.negotiations.records.find(record => record.playerId === incomingId && record.outcome === 'countered')!;
    state.negotiations.records.push({ ...structuredClone(original), id: `negotiation-${state.negotiations.records.length + 1}`, clubId: state.clubs.find(club => club.id !== clubId)!.id, contractCountBefore: state.employment.contracts.length });
    expect(() => validateSeasonState(state)).toThrow(/ownership|overlap/);
  });

  it('rejects a canonical counteroffer that could not legally be submitted within the club budget', () => {
    let state = structuredClone(initial);
    const own = state.clubs.find(club => club.id === clubId)!.players;
    for (const player of own.slice(1, 4)) state = offerPlayerContract(state, player.id, 5_000_000, 1);
    for (const player of own.slice(4, 9)) state = offerPlayerContract(state, player.id, getSeasonWage(player.id), 1);
    const offeredWage = 1_950_000, offeredSeasons = 3;
    const decision = evaluateNegotiation(own[0]!.id, offeredWage, offeredSeasons);
    expect(decision.outcome).toBe('countered');
    state.negotiations.records.push({ id: `negotiation-${state.negotiations.records.length + 1}`, playerId: own[0]!.id, clubId, seasonNumber: 1, round: 1, date: state.date, status: 'active', startsSeason: 2, offeredWage, offeredSeasons, contractCountBefore: state.employment.contracts.length, contractId: null, ...decision });
    expect(() => validateSeasonState(state)).toThrow(/budget rules/);
  });
});

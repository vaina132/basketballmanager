import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { offerPlayerContract } from '../src/world/employment';
import { enableNegotiations } from '../src/world/negotiations';
import { enableInSeasonRecruitment, submitInSeasonOffer, withdrawInSeasonOffer } from '../src/world/recruitment';
import { getInSeasonCandidates } from '../src/world/recruitment-policy';
import { rosterForRound } from '../src/world/rosters';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { stripInSeasonRecruitment, stripInSeasonTransfers } from './helpers/legacy-season';

const clubId = 'rhine-falcons';
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const encode = (state: unknown, formatVersion = 28) => JSON.stringify({ format: 'basketball-manager-season', formatVersion, engineVersion: 'possession-3', state });
let opening: SeasonState, pending: SeasonState, accepted: SeasonState, paid: SeasonState, competition: SeasonState, withdrawn: SeasonState;
let playerId: string;

beforeAll(() => {
  let state = createSeason(63, clubId, 'off', true, true, true, true, null, true, true);
  while (state.status === 'active') state = play(state);
  for (const player of state.clubs.find(club => club.id === clubId)!.players.slice(0, 8)) state = offerPlayerContract(state, player.id, getSeasonWage(player.id), 1);
  opening = enableInSeasonRecruitment(enableNegotiations(rolloverSeason(state)));
  playerId = getInSeasonCandidates(opening)[0]!.id;
  pending = submitInSeasonOffer(opening, playerId, getSeasonWage(playerId));
  withdrawn = withdrawInSeasonOffer(pending, pending.recruitment.offers.at(-1)!.id);
  accepted = play(pending);
  paid = play(accepted);
  const rival = opening.clubs.find(club => club.id !== clubId)!.id;
  competition = play(submitInSeasonOffer(pending, playerId, getSeasonWage(playerId) + 50_000, rival));
}, 60_000);

describe('in-season recruitment persistence', () => {
  it('migrates genuine format18 arrivals and their payroll while keeping paid transfers disabled', () => {
    const previous = structuredClone(accepted) as unknown as Record<string, unknown>;
    stripInSeasonTransfers(previous); previous.schemaVersion = 18;
    const restored = parseSeason(encode(previous, 18));
    expect(restored).toEqual(accepted);
    expect(restored.employment.contracts.find(contract => contract.kind === 'midseason')!.startsRound).toBe(2);
    expect(restored.recruitment.transfersEnabledSince).toBeNull();
    const forged = structuredClone(previous);
    (forged.recruitment as Record<string, unknown>).transfersEnabledSince = null;
    expect(() => parseSeason(encode(forged, 18))).toThrow();
  });
  it('round-trips pending, withdrawn, accepted, paid and rival-choice states without changing the next sporting action', () => {
    for (const state of [opening, pending, withdrawn, accepted, paid, competition]) {
      const restored = parseSeason(serializeSeason(state));
      expect(restored).toEqual(state);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(state.activeMatch));
    }
  });

  it('keeps completed appearances and training tied to their old squad while registering only the next matchday', () => {
    const oldRoster = rosterForRound(accepted.rosters, clubId, 1), newRoster = rosterForRound(accepted.rosters, clubId, 2);
    expect(oldRoster.players.some(player => player.id === playerId)).toBe(false);
    expect(newRoster.players.some(player => player.id === playerId)).toBe(true);
    expect(newRoster.players.slice(0, oldRoster.players.length)).toEqual(oldRoster.players);
    expect(accepted.training.lastWeek!.players[playerId]).toBeUndefined();
    expect(accepted.training.points[playerId]).toEqual(opening.training.points[playerId]);
    expect(accepted.conditions[playerId]).toBe(opening.conditions[playerId]);
    expect(accepted.payroll.agreements.find(agreement => agreement.playerId === playerId && agreement.seasonNumber === 2)?.startsRound).toBe(2);
    expect(accepted.finance.ledger.filter(entry => entry.seasonNumber === 2 && entry.round === 1 && entry.payroll?.items.some(item => item.playerId === playerId))).toEqual([]);
    expect(paid.training.lastWeek!.players[playerId]).toBeDefined();
  });

  it('validates format17 before adding disabled recruitment and round-one contract metadata', () => {
    const legacy = structuredClone(opening) as unknown as Record<string, unknown>;
    stripInSeasonRecruitment(legacy); legacy.schemaVersion = 17;
    const restored = parseSeason(encode(legacy, 17));
    expect(restored).toEqual({ ...opening, recruitment: { model: 'recruitment-1', enabledSince: null, transfersEnabledSince: null, events: [], offers: [] } });
    expect(restored.employment.contracts.every(contract => contract.startsRound === 1)).toBe(true);
    const forged = structuredClone(legacy);
    (forged.employment as { contracts: Array<Record<string, unknown>> }).contracts[0]!.startsRound = 1;
    expect(() => parseSeason(encode(forged, 17))).toThrow();
  });

  it.each<[string, (state: SeasonState) => void]>([
    ['missing response boundary', state => { state.recruitment.events = state.recruitment.events.filter(event => event.type !== 'resolve'); }],
    ['response date', state => { state.recruitment.offers[0]!.responseOn = state.recruitment.offers[0]!.offeredOn; }],
    ['remaining wages', state => { state.recruitment.offers[0]!.remainingWages += 1; }],
    ['reply link', state => { state.recruitment.offers[0]!.negotiationId = null; }],
    ['contract start', state => { state.employment.contracts.find(contract => contract.kind === 'midseason')!.startsRound = 1; }],
    ['past roster', state => { state.rosters.find(roster => roster.clubId === clubId && roster.fromRound === 1)!.players = [...rosterForRound(state.rosters, clubId, 2).players]; }],
    ['missing arrival snapshot', state => { state.rosters = state.rosters.filter(roster => roster.fromRound === 1); }],
    ['future payroll', state => { state.payroll.agreements.find(agreement => agreement.seasonNumber === 2 && agreement.playerId === playerId)!.startsRound = 1; }],
    ['cash anchor', state => { state.recruitment.events.find(event => event.type === 'resolve')!.ledgerIndexBefore -= 1; }],
    ['contract anchor', state => { state.recruitment.events.find(event => event.type === 'resolve')!.contractCountBefore += 1; }],
    ['late training', state => { state.training.lastWeek!.players[playerId] = structuredClone(Object.values(state.training.lastWeek!.players)[0]!); }],
    ['disabled journal', state => { state.recruitment = { model: 'recruitment-1', enabledSince: null, transfersEnabledSince: null, events: [], offers: [] }; }],
  ])('rejects forged %s', (_label, change) => {
    const state = structuredClone(accepted); change(state);
    expect(() => validateSeasonState(state)).toThrow();
  });

  it('rejects a forged competing winner or loser response', () => {
    const state = structuredClone(competition);
    state.recruitment.offers.find(offer => offer.status === 'lost')!.chosenOfferId = state.recruitment.offers.find(offer => offer.status === 'lost')!.id;
    expect(() => validateSeasonState(state)).toThrow();
  });
});

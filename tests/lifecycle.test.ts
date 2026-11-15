import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { MarketOffer } from '../src/domain/market';
import { createSeason, dateForRound, seasonStartDate } from '../src/world/season';
import { createLifecycle, enableLifecycle, lifecycleAtBoundary, prepareLifecycleSeason } from '../src/world/lifecycle';
import { ageTrainingRate, applyAgingAttributes, getPlayerAging, getPlayerRetirement, isPlayerRetired, lifecycleDateOfBirth, retirementContractReason, retirementTargetAge } from '../src/world/lifecycle-policy';
import { developClub, processTrainingWeek, TRAINING_ATTRIBUTES } from '../src/world/training';
import { getCareerPlayers } from '../src/world/player-catalog';
import { prepareAcademySeason } from '../src/world/academy';

const create = (enabled = false) => createSeason(227, 'rhine-falcons', 'off', true, false, true, true, null, true, true, true, false, false, false, false, false, true, false, enabled);
const freeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function ageWorld(state: SeasonState, seasonNumber = 20): SeasonState {
  let next = state;
  // Policy fixture: canonical first three academy openings supply six real age-outs.
  for (let year = 2; year <= 4; year += 1) next = prepareAcademySeason({ ...next, seasonNumber: year, round: 1, date: seasonStartDate(year) });
  return { ...next, seasonNumber, round: 1, date: seasonStartDate(seasonNumber) };
}
function trainingInput(state: SeasonState) {
  return { training: state.training, clubs: state.clubs, conditions: state.conditions, injuries: state.injuries, seasonNumber: state.seasonNumber, afterRound: state.round, fromDate: state.date, toDate: dateForRound(state.round + 1, state.seasonNumber), lifecycle: state.lifecycle, academy: state.academy, rosters: state.rosters };
}

describe('prospective senior aging and real practice', () => {
  let base: SeasonState;
  beforeAll(() => { base = freeze(create()); });

  it('leaves prepared matches, RNG, authored skills and old training unchanged on activation', () => {
    expect(base.lifecycle).toEqual(createLifecycle());
    const enabled = enableLifecycle(base);
    expect(enabled.activeMatch!).toBe(base.activeMatch!);
    expect(enabled.training).toBe(base.training);
    expect(enabled.clubs).toBe(base.clubs);
    expect(enabled.lifecycle.reviews).toHaveLength(1);
    expect(enabled.lifecycle.notices).toHaveLength(0); // all sixty seniors are protected until the academy replenishes them.
    expect(enableLifecycle(enabled)).toBe(enabled);
    expect(developClub(base.clubs[0]!, base.training, base)).toEqual(developClub(base.clubs[0]!, base.training));
    expect(processTrainingWeek(trainingInput(base))).toEqual(processTrainingWeek({ ...trainingInput(base), lifecycle: undefined, academy: undefined }));
    expect(() => enableLifecycle({ ...base, status: 'complete' })).toThrow(/active season/);
    expect(() => enableLifecycle({ ...base, academy: { ...base.academy, enabledSince: null } })).toThrow(/academy/);
  });

  it('accrues calendar losses prospectively, never as a birthday or annual award, and clamps projected skills', () => {
    const state = enableLifecycle(base), id = 'adr-3', player = getCareerPlayers(state).find(player => player.id === id)!;
    expect(getPlayerAging(state, id, state.date).lossPoints.stamina).toBe(0);
    expect(getPlayerAging(state, id, '2027-09-05').lossPoints.stamina).toBe(39);
    expect(getPlayerAging(state, id, '2029-09-05').lossPoints.stamina).toBe(120);
    expect(getPlayerAging(state, id, '2029-09-05').skillLoss.stamina).toBe(1);
    expect(applyAgingAttributes(state, id, player.attributes, '2029-09-05').stamina).toBe(player.attributes.stamina - 1);
    expect(applyAgingAttributes(state, id, player.attributes, '2026-09-04')).toEqual(player.attributes);
    expect(Object.values(applyAgingAttributes(state, id, player.attributes, '2200-09-05'))).toEqual(TRAINING_ATTRIBUTES.map(() => 1));
    expect(state.clubs.flatMap(club => club.players).find(player => player.id === id)).toEqual(player);
  });

  it('uses smooth calendar-age practice rates, including the displayed leap-day birthday convention', () => {
    const state = enableLifecycle(base), id = 'aeg-7'; // 2004-02-29
    expect(ageTrainingRate(state, id, '2027-02-28')).toBeGreaterThan(10_000);
    expect(ageTrainingRate(state, id, '2027-03-01')).toBe(10_000);
    expect(ageTrainingRate(state, id, '2033-03-01')).toBe(10_000);
    expect(ageTrainingRate(state, id, '2043-03-01')).toBe(5_000);
    expect(ageTrainingRate(state, 'alp-10', state.date)).toBeGreaterThan(11_000);
    expect(Math.abs(ageTrainingRate(state, 'alp-10', '2027-03-17') - ageTrainingRate(state, 'alp-10', '2027-03-18'))).toBeLessThanOrEqual(1);
    const leapThreshold = getPlayerAging(state, id, '2034-02-28').lossPoints.stamina;
    expect(getPlayerAging(state, id, '2034-03-01').lossPoints.stamina).toBe(leapThreshold);
    expect(getPlayerAging(state, id, '2034-03-11').lossPoints.stamina).toBe(1);
  });

  it('weights actual available practice once before coaching while preserving condition and capped training points', () => {
    const enabled = enableLifecycle(base), original = processTrainingWeek(trainingInput(base)), aged = processTrainingWeek(trainingInput(enabled));
    expect(aged.conditions).toEqual(original.conditions);
    const young = aged.training.lastWeek!.players['alp-10']!, old = aged.training.lastWeek!.players['adr-3']!;
    expect(young.aging!.ordinaryPracticePoints).toBe(28);
    expect(young.aging!.adjustedPracticePoints).toBeGreaterThan(28);
    expect(old.aging!.adjustedPracticePoints).toBeLessThan(28);
    expect(Object.values(young.gains).reduce((sum, gain) => sum + gain, 0)).toBe(young.aging!.adjustedPracticePoints);
    const id = 'rhf-1';
    const injured = processTrainingWeek({ ...trainingInput(enabled), injuries: [{ id: 'test-injury', playerId: id, clubId: 'rhine-falcons', kind: 'ankle-sprain', fixtureId: 'test', occurredOn: base.date, returnOn: '2026-10-01' }] });
    expect(injured.training.lastWeek!.players[id]!.aging).toMatchObject({ ordinaryPracticePoints: 0, adjustedPracticePoints: 0 });
    expect(injured.training.lastWeek!.players[id]!.availableDays).toBe(0);
    const allCapped = { ...enabled.training, points: Object.fromEntries(Object.entries(enabled.training.points).map(([playerId, points]) => [playerId, Object.fromEntries(Object.keys(points).map(key => [key, 200]))])) } as typeof enabled.training;
    const capped = processTrainingWeek({ ...trainingInput(enabled), training: allCapped });
    expect(Object.values(capped.training.lastWeek!.players['alp-10']!.gains).every(gain => gain === 0)).toBe(true);
  });

  it('starts a graduate at his senior arrival and excludes private academy players from senior aging', () => {
    const state = enableLifecycle(base), prospect = state.academy.prospects[0]!;
    expect(getPlayerAging(state, prospect.player.id, '2030-09-07').active).toBe(false);
    const graduated = ageWorld(state, 4), graduate = graduated.academy.graduates[0]!;
    expect(getPlayerAging(graduated, graduate.player.id, graduate.graduatedOn).startedOn).toBe(graduate.graduatedOn);
    expect(getPlayerAging(graduated, graduate.player.id, graduate.graduatedOn).lossPoints.stamina).toBe(0);
  });
});

describe('immutable retirement plans and population safeguards', () => {
  let aged: SeasonState;
  beforeAll(() => { aged = freeze(ageWorld(create())); });

  it('plans oldest first while retaining sixty unannounced seniors and at most two upcoming departures per club', () => {
    const catalog = aged.clubs.flatMap(club => club.players).sort((a, b) => lifecycleDateOfBirth(aged, a.id)!.localeCompare(lifecycleDateOfBirth(aged, b.id)!));
    const grouped = { ...aged, clubs: aged.clubs.map((club, index) => ({ ...club, players: catalog.slice(index * 10, index * 10 + 10) })) };
    const state = enableLifecycle(grouped), notices = state.lifecycle.notices;
    expect(getCareerPlayers(aged)).toHaveLength(66);
    expect(notices).toHaveLength(6);
    expect(notices.slice(0, 2).map(notice => notice.playerId)).toEqual(catalog.slice(0, 2).map(player => player.id));
    for (const club of state.clubs) expect(notices.filter(notice => club.players.some(player => player.id === notice.playerId)).length).toBeLessThanOrEqual(2);
    expect(notices.every(notice => notice.lastSeason >= aged.seasonNumber + 1)).toBe(true);
    expect(notices.map(notice => notice.id)).toEqual(Array.from({ length: 6 }, (_, index) => `retirement-${index + 1}`));
    expect(enableLifecycle(grouped).lifecycle).toEqual(state.lifecycle);
    expect([0, 1, 42, 227].map(seed => retirementTargetAge(seed, 'adr-3')).every(age => age >= 37 && age <= 40)).toBe(true);
  });

  it('allows an eight-player club to replace veterans while respecting its two outstanding announcements', () => {
    const catalog = aged.clubs.flatMap(club => club.players).sort((a, b) => lifecycleDateOfBirth(aged, a.id)!.localeCompare(lifecycleDateOfBirth(aged, b.id)!));
    const smallest = { ...aged, clubs: aged.clubs.map((club, index) => ({ ...club, players: index === 0 ? catalog.slice(0, 8) : catalog.slice(8 + (index - 1) * 10, index === 5 ? 60 : 8 + index * 10) })) };
    const enabled = enableLifecycle(smallest), clubId = smallest.clubs[0]!.id;
    expect(smallest.clubs[0]!.players).toHaveLength(8);
    expect(enabled.lifecycle.notices.filter(notice => notice.clubId === clubId).map(notice => notice.playerId)).toEqual(catalog.slice(0, 2).map(player => player.id));
    expect(enabled.lifecycle.notices.every(notice => notice.lastSeason >= aged.seasonNumber + 1)).toBe(true);
    const replenished = prepareAcademySeason({ ...enabled, seasonNumber: 21, round: 1, date: seasonStartDate(21) });
    const next = prepareLifecycleSeason(replenished), newNotices = next.lifecycle.notices.slice(enabled.lifecycle.notices.length);
    expect(getCareerPlayers(replenished).length).toBeGreaterThan(66);
    expect(newNotices.some(notice => notice.clubId === clubId)).toBe(false);
    for (const club of next.clubs) expect(newNotices.filter(notice => notice.clubId === club.id).length).toBeLessThanOrEqual(2);
    expect(next.lifecycle.notices.filter(notice => notice.retiredOn > next.date && next.clubs[0]!.players.some(player => player.id === notice.playerId))).toHaveLength(2);
  });

  it('honors effective future employment and every live pending or countered market term', () => {
    const contract = { ...aged.employment.contracts.find(contract => contract.playerId === 'adr-3')!, id: 'employment-contract-61', kind: 'renewal' as const, signedSeason: 20, signedRound: 1, startsSeason: 21, endsSeason: 23 };
    const offer: MarketOffer = { id: 'market-offer-test', playerId: 'alp-3', clubId: aged.managedClubId, seasonNumber: 20, offeredOn: aged.date, responseOn: aged.date, expiresOn: aged.date, seasonWage: 1_000_000, seasons: 3, status: 'countered', respondedOn: null, closedOn: null, negotiationId: null, chosenOfferId: null, transfer: null };
    const state = enableLifecycle({ ...aged, employment: { ...aged.employment, contracts: [...aged.employment.contracts, contract] }, market: { ...aged.market, windows: [{ seasonNumber: 20, openedOn: aged.date, closesOn: aged.date, date: aged.date, contractCountBefore: 60, negotiationCountBefore: 0, closed: false, competitionFromEvent: 0, events: [], offers: [offer] }] } });
    expect(state.lifecycle.notices.find(notice => notice.playerId === 'adr-3')!.lastSeason).toBe(23);
    expect(state.lifecycle.notices.find(notice => notice.playerId === 'alp-3')!.lastSeason).toBe(23);
    expect(retirementContractReason(state, 'adr-3', 23)).toBeNull();
    expect(retirementContractReason(state, 'adr-3', 24)).toMatch(/cannot extend/);
  });

  it('retains notices through subsequent reviews and derives retirement only at the recorded future opening', () => {
    const enabled = enableLifecycle(aged), notice = enabled.lifecycle.notices[0]!;
    const next = prepareLifecycleSeason({ ...enabled, seasonNumber: 21, round: 1, date: seasonStartDate(21) });
    expect(next.lifecycle.notices).toEqual(enabled.lifecycle.notices);
    expect(next.lifecycle.reviews).toHaveLength(2);
    expect(next.lifecycle.reviews[1]!.noticeIds).toEqual([]);
    expect(prepareLifecycleSeason(next)).toBe(next);
    expect(() => prepareLifecycleSeason({ ...next, seasonNumber: 23 })).toThrow(/calendar order/);
    expect(getPlayerRetirement(next, notice.playerId).status).toBe('announced');
    expect(getPlayerRetirement(next, notice.playerId, notice.retiredOn).status).toBe('retired');
    expect(isPlayerRetired(next, notice.playerId, notice.lastSeason, 10)).toBe(false);
    expect(isPlayerRetired(next, notice.playerId, notice.retirementSeason, 1)).toBe(true);
    const retired = { ...next, seasonNumber: notice.retirementSeason, date: notice.retiredOn };
    expect(retirementContractReason(retired, notice.playerId, notice.lastSeason)).toMatch(/retired/);
    expect(getCareerPlayers(retired).some(player => player.id === notice.playerId)).toBe(true);
  });

  it('hides later same-day announcements from earlier offer and financial prefixes', () => {
    const event = { type: 'resolve' as const, seasonNumber: aged.seasonNumber, round: aged.round, date: aged.date, ledgerIndexBefore: 0, contractCountBefore: 60, negotiationCountBefore: 0 };
    const enabled = enableLifecycle({ ...aged, recruitment: { ...aged.recruitment, events: [...aged.recruitment.events, event] } });
    const anchor = enabled.lifecycle.enabledSince!;
    expect(lifecycleAtBoundary(enabled.lifecycle, aged.seasonNumber, aged.round, anchor.contractCount, anchor.recruitmentEventCount - 1)).toEqual(createLifecycle());
    expect(lifecycleAtBoundary(enabled.lifecycle, aged.seasonNumber, aged.round, anchor.contractCount, anchor.recruitmentEventCount)).toEqual(enabled.lifecycle);
    expect(lifecycleAtBoundary(enabled.lifecycle, aged.seasonNumber, aged.round, anchor.contractCount, anchor.recruitmentEventCount, anchor.marketEventCount, anchor.ledgerIndex - 1)).toEqual(createLifecycle());
    expect(lifecycleAtBoundary(enabled.lifecycle, aged.seasonNumber - 1, 10)).toEqual(createLifecycle());
  });
});

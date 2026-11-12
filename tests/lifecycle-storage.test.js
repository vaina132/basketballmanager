import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { stepMatch } from '../src/engine/match';
import { MAX_SEASON_SAVE_BYTES, parseSeason, serializeSeason } from '../src/storage/season-storage';
import { enableLifecycle } from '../src/world/lifecycle';
import { getPlayerAging, getPlayerRetirement } from '../src/world/lifecycle-policy';
import { getCareerPlayer, getActiveCareerPlayers } from '../src/world/player-catalog';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { requiredInSeasonTransferFee } from '../src/world/midseason-transfer-policy';
import { submitInSeasonTransferOffer, withdrawInSeasonOffer } from '../src/world/recruitment';
import { rolloverSeason } from '../src/world/season';
import { advanceAcademyCareer as advance } from './helpers/academy-careers';
import { currentSeasonFile, expectedMigration } from './helpers/season-format';

const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const restore = state => parseSeason(serializeSeason(state));
const upgrade = state => expectedMigration(state, 25);
const notice = state => state.lifecycle.notices.find(item => item.playerId === 'adr-3');
const changed = (state, mutate) => { const copy = structuredClone(state); mutate(copy); return currentSeasonFile(copy); };
let original, migrated, enabled, next, yearFour, pending, protectedState, withdrawnBefore, accepted, retired, retiredNext;

beforeAll(() => {
  original = JSON.parse(fixture('season25-academy-career'));
  migrated = parseSeason(JSON.stringify(original));
  enabled = enableLifecycle(migrated);
  next = advance(enabled);
  yearFour = parseSeason(fixture('season25-academy-year4'));
  pending = submitInSeasonTransferOffer(yearFour, 'adr-3', requiredNegotiationWage('adr-3', 3, undefined, yearFour), 3, requiredInSeasonTransferFee(yearFour, 'adr-3'));
  protectedState = enableLifecycle(pending);
  const offer = pending.recruitment.offers.findLast(item => item.playerId === 'adr-3' && item.clubId === yearFour.managedClubId);
  withdrawnBefore = enableLifecycle(withdrawInSeasonOffer(pending, offer.id));
  accepted = advance(protectedState);
  retired = parseSeason(fixture('season26-retirement-year6'));
  retiredNext = advance(retired);
}, 30_000);

describe('dated senior development and retirement persistence', () => {
  it('migrates a genuine format25 career without rewriting its match, academy, staff or reports', () => {
    expect(original.formatVersion).toBe(25);
    expect(original.state.academy.graduates).toHaveLength(1);
    for (const role of ['coaching', 'scouts', 'fitness', 'physio', 'assistant', 'youth']) expect(original.state[role].contracts.length).toBeGreaterThan(0);
    expect(migrated).toEqual(upgrade(original.state));
    expect(stepMatch(migrated.activeMatch)).toEqual(stepMatch(original.state.activeMatch));
    expect(restore(migrated)).toEqual(migrated);
  });

  it('reproduces the independently captured format25 next week exactly while disabled', () => {
    const expected = JSON.parse(fixture('season25-academy-career-next'));
    expect(expected.formatVersion).toBe(25);
    expect(advance(migrated)).toEqual(upgrade(expected.state));
    expect(Object.values(migrated.training.lastWeek.players).every(player => !Object.hasOwn(player, 'aging'))).toBe(true);
  });

  it('reproduces the independently captured format25 rollover without new notices or altered registration', () => {
    const complete = parseSeason(fixture('season25-academy-season-complete'));
    const expected = JSON.parse(fixture('season25-academy-next-season'));
    expect(expected.formatVersion).toBe(25);
    expect(rolloverSeason(complete)).toEqual(upgrade(expected.state));
    expect(restore(rolloverSeason(complete))).toEqual(upgrade(expected.state));
  });

  it('activates prospectively and retains a pre-activation latest week unchanged', () => {
    for (const key of ['activeMatch', 'clubs', 'training', 'academy', 'conditions', 'finance', 'employment', 'injuries', 'physio', 'scouting']) expect(enabled[key]).toEqual(migrated[key]);
    expect(enabled.lifecycle.enabledSince.date).toBe(migrated.date);
    expect(restore(enabled)).toEqual(enabled);
    expect(restore(next)).toEqual(next);
    expect(advance(restore(enabled))).toEqual(next);
  });

  it('retains actual age-weighted practice without altering immutable source attributes', () => {
    const young = next.training.lastWeek.players['academy-rhine-falcons-s1-p1'];
    const old = next.training.lastWeek.players['adr-3'];
    expect(young.aging.rateBasisPoints).toBeGreaterThan(10_000);
    expect(old.aging.rateBasisPoints).toBeLessThan(10_000);
    expect(young.aging.adjustedPracticePoints).toBeGreaterThanOrEqual(young.aging.ordinaryPracticePoints);
    expect(old.aging.adjustedPracticePoints).toBeLessThanOrEqual(old.aging.ordinaryPracticePoints);
    expect(next.clubs).toEqual(enabled.clubs);
    expect(next.academy.graduates[0].player).toEqual(enabled.academy.graduates[0].player);
  });

  it('protects a real three-season pending offer when announcing retirement', () => {
    expect(notice(protectedState)).toMatchObject({ lastSeason: 6, retirementSeason: 7 });
    expect(notice(withdrawnBefore)).toMatchObject({ lastSeason: 5, retirementSeason: 6 });
    for (const state of [protectedState, withdrawnBefore, accepted]) expect(restore(state)).toEqual(state);
    expect(accepted.employment.contracts.at(-1)).toMatchObject({ playerId: 'adr-3', startsSeason: 4, endsSeason: 6 });
    expect(accepted.clubs.find(club => club.id === accepted.managedClubId).players.some(player => player.id === 'adr-3')).toBe(true);
    expect(notice(accepted)).toEqual(notice(protectedState));
  });

  it('does not shorten an announced date when the protected offer is subsequently withdrawn', () => {
    const offer = protectedState.recruitment.offers.findLast(item => item.playerId === 'adr-3' && item.clubId === yearFour.managedClubId);
    const after = withdrawInSeasonOffer(protectedState, offer.id);
    expect(notice(after)).toEqual(notice(protectedState));
    expect(restore(after)).toEqual(after);
  });

  it('preserves six seasons of actual careers, final registered rosters and retired identities', () => {
    expect(getPlayerRetirement(retired, 'adr-3').status).toBe('retired');
    expect(getActiveCareerPlayers(retired).some(player => player.id === 'adr-3')).toBe(false);
    expect(retired.clubs.every(club => club.players.every(player => player.id !== 'adr-3'))).toBe(true);
    expect(retired.history[4].rosters.some(roster => roster.players.some(player => player.id === 'adr-3'))).toBe(true);
    expect(getCareerPlayer(retired, 'adr-3').attributes).toEqual(getCareerPlayer(migrated, 'adr-3').attributes);
    expect(getPlayerAging(retired, 'adr-3').skillLoss.stamina).toBeGreaterThan(0);
    expect(restore(retiredNext)).toEqual(retiredNext);
    expect(advance(restore(retired))).toEqual(retiredNext);
  });

  it('allows bounded 32 MiB careers and enforces the byte limit for multibyte input', () => {
    expect(MAX_SEASON_SAVE_BYTES).toBe(32 * 1024 * 1024);
    expect(() => parseSeason('é'.repeat(MAX_SEASON_SAVE_BYTES / 2 + 1))).toThrow(/too large.*32 MB/);
  });

  const corruptions = [
    ['disabled history', () => enabled, state => { state.lifecycle.enabledSince = null; }],
    ['wrong activation date', () => enabled, state => { state.lifecycle.enabledSince.date = '2026-09-01'; }],
    ['activation before required contracts', () => enabled, state => { state.lifecycle.enabledSince.contractCount -= 1; }],
    ['invented decline override', () => enabled, state => { state.lifecycle.lossPoints = {}; }],
    ['missing opening review', () => retired, state => { state.lifecycle.reviews.splice(2, 1); }],
    ['duplicated opening review', () => retired, state => { state.lifecycle.reviews.push(state.lifecycle.reviews.at(-1)); }],
    ['opening after sponsorship', () => retired, state => { state.lifecycle.reviews[1].ledgerIndex += 1; }],
    ['rewritten target retirement age', () => retired, state => { state.lifecycle.notices[0].targetAge += 1; }],
    ['rewritten final season', () => retired, state => { state.lifecycle.notices[0].lastSeason += 1; }],
    ['rewritten retirement date', () => retired, state => { state.lifecycle.notices[0].retiredOn = '2031-09-07'; }],
    ['rewritten announcement owner', () => retired, state => { state.lifecycle.notices[0].clubId = state.managedClubId; }],
    ['removed retirement', () => retired, state => { state.lifecycle.notices.splice(0, 1); }],
    ['wrong notice ordering', () => retired, state => { state.lifecycle.notices.reverse(); }],
    ['pending terms forgotten', () => protectedState, state => { const item = notice(state); item.lastSeason = 5; item.retirementSeason = 6; item.retiredOn = '2031-09-06'; }],
    ['pending command prefix erased', () => protectedState, state => { state.lifecycle.enabledSince.recruitmentEventCount = yearFour.recruitment.events.length; state.lifecycle.reviews[0].recruitmentEventCount = yearFour.recruitment.events.length; }],
    ['false practice source', () => next, state => { state.training.lastWeek.players['adr-3'].aging.ordinaryPracticePoints += 1; }],
    ['false adjusted practice', () => next, state => { state.training.lastWeek.players['adr-3'].aging.adjustedPracticePoints += 1; }],
    ['false practice age rate', () => next, state => { state.training.lastWeek.players['adr-3'].aging.rateBasisPoints += 1; }],
    ['missing active practice evidence', () => next, state => { delete state.training.lastWeek.players['adr-3'].aging; }],
    ['retroactive practice evidence', () => enabled, state => { state.training.lastWeek.players['adr-3'].aging = { ordinaryPracticePoints: 28, adjustedPracticePoints: 28, rateBasisPoints: 10_000 }; }],
    ['changed base skill', () => next, state => { state.clubs[0].players[0].attributes.stamina -= 1; }],
  ];
  it.each(corruptions)('rejects %s', (_name, source, mutate) => {
    expect(() => parseSeason(changed(source(), mutate))).toThrow();
  });
});

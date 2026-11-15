import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { InjuryMode } from '../src/domain/types';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { offerAcademyPromotion } from '../src/world/academy';
import { getClubAcademy, quoteAcademyPromotion } from '../src/world/academy-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { enableYouthCompetition, getYouthFixtures, getYouthFixtureTeams, getYouthPlayerStatus } from '../src/world/youth-competition';
import { isYouthOutcome } from '../src/world/youth-history';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';

const create = (seed = 227, mode: InjuryMode = 'off', youthMatches = true) => createSeason(seed, 'rhine-falcons', mode, true, true, true, true, null, true, true, true, true, true, true, true, true, true, true, true, youthMatches);
const advance = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });

describe('youth matches in the actual career calendar', () => {
  it('activates prospectively without rewriting senior matches, finances or previous academy work', () => {
    let old = create(227, 'off', false);
    old = advance(advance(old));
    const started = enableYouthCompetition(old);
    expect(started.activeMatch!).toBe(old.activeMatch!);
    expect(started.fixtures).toBe(old.fixtures);
    expect(started.finance).toBe(old.finance);
    expect(started.academy.weeks).toBe(old.academy.weeks);
    expect(getYouthFixtures(started)).toHaveLength(24);
    expect(getYouthFixtures(started).every(fixture => fixture.round >= 3 && fixture.result === null)).toBe(true);
    expect(getClubAcademy(started)).toHaveLength(8);
    expect(started.academy.prospects.slice(0, old.academy.prospects.length)).toEqual(old.academy.prospects);
    expect(enableYouthCompetition(started)).toBe(started);
  });

  it('settles every youth fixture once with the matchday and preserves independent senior match randomness', () => {
    const before = create(), withoutYouth = create(227, 'off', false);
    const snapshot = structuredClone(before);
    const after = advance(before), comparison = advance(withoutYouth);
    expect(before).toEqual(snapshot);
    expect(after.round).toBe(2);
    const committed = getYouthFixtures(after).filter(fixture => fixture.result);
    expect(committed).toHaveLength(3);
    expect(committed.every(fixture => fixture.round === 1 && fixture.date === before.date)).toBe(true);
    expect(committed.every(fixture => fixture.result!.played && Object.keys(fixture.result!.stats).length === 16)).toBe(true);
    expect(after.fixtures.filter(fixture => fixture.result)).toEqual(comparison.fixtures.filter(fixture => fixture.result));
    const later = advance(after);
    expect(getYouthFixtures(later).filter(fixture => fixture.result)).toHaveLength(6);
    expect(getYouthFixtures(later).slice(0, 3)).toEqual(committed);
  });

  it('lets a pending prospect play once before promotion and carries actual condition into his senior registration', () => {
    const initial = create(), prospect = getClubAcademy(initial)[0]!;
    const offered = offerAcademyPromotion(initial, prospect.player.id, prospect.prospect.seasonWage);
    const promoted = advance(offered), id = prospect.player.id;
    const offer = promoted.recruitment.offers.find(offer => offer.academyProspectId === id)!;
    expect(offer.status).toBe('accepted');
    const youthFixture = getYouthFixtures(promoted).find(fixture => fixture.result?.stats[id]);
    expect(youthFixture?.round).toBe(1);
    expect(promoted.fixtures.filter(fixture => fixture.result).every(fixture => !fixture.result!.stats[id])).toBe(true);
    const side = managedSide(promoted);
    expect(promoted.activeMatch![side].players.some(player => player.id === id)).toBe(true);
    const graduate = promoted.academy.graduates.find(graduate => graduate.player.id === id)!;
    expect(graduate.condition).toBe(getYouthPlayerStatus(promoted, id, promoted.date).condition);
    expect(promoted.conditions[id]).toBe(graduate.condition);
    expect(promoted.activeMatch!.stats[id]!.condition).toBe(graduate.condition);
    expect(getClubAcademy(promoted)).toHaveLength(7);
    const later = advance(promoted);
    expect(getYouthFixtures(later).filter(fixture => fixture.round === 2).every(fixture => !fixture.result!.stats[id])).toBe(true);
    expect(getYouthFixtures(later).find(fixture => fixture.id === youthFixture!.id)).toEqual(youthFixture);
  });

  it('rechecks a pending promotion after a genuine youth injury and releases the offer instead of erasing the injury', () => {
    // The first youth matchday of this genuine seed with a new home academy injury.
    const newlyInjured = (before: typeof initial, after: typeof initial) => getClubAcademy(after).find(row => getYouthPlayerStatus(after, row.player.id).injury && getYouthPlayerStatus(before, row.player.id).available);
    let initial = create(227, 'standard'), injured = advance(initial);
    while (!newlyInjured(initial, injured) && injured.round < 10) { initial = injured; injured = advance(initial); }
    const casualty = newlyInjured(initial, injured);
    expect(casualty).toBeDefined();
    const id = casualty!.player.id;
    const row = getClubAcademy(initial).find(row => row.player.id === id)!;
    expect(quoteAcademyPromotion(injured, id, row.prospect.seasonWage).reason).toMatch(/recovering/);
    const offered = offerAcademyPromotion(initial, id, row.prospect.seasonWage);
    const resolved = advance(offered);
    const proposal = resolved.recruitment.offers.find(offer => offer.academyProspectId === id)!;
    expect(proposal.status).toBe('cancelled');
    expect(proposal.reason).toMatch(/recovering/);
    expect(resolved.academy.graduates.some(graduate => graduate.player.id === id)).toBe(false);
    expect(resolved.employment.contracts.some(contract => contract.playerId === id)).toBe(false);
    expect(getYouthPlayerStatus(resolved, id).injury).toEqual(getYouthPlayerStatus(injured, id).injury);
  });

  it('retains completed youth seasons while replenishing only at the new opening day', () => {
    let state = setEmploymentDelegation(create(), true);
    while (state.status === 'active') state = advance(state);
    const oldFixtures = structuredClone(getYouthFixtures(state));
    expect(oldFixtures).toHaveLength(30);
    expect(oldFixtures.every(fixture => fixture.result)).toBe(true);
    for (let step = 0; getMarketStartReason(state) && step < 60; step += 1) state = advanceMarket(state);
    expect(getMarketStartReason(state)).toBeNull();
    const next = rolloverSeason(state);
    const retained = getYouthFixtures(next, 1), latestByClub = new Map<string, string>();
    for (const fixture of oldFixtures) for (const id of [fixture.homeClubId, fixture.awayClubId]) latestByClub.set(id, fixture.id);
    expect(retained.map(fixture => fixture.id)).toEqual(oldFixtures.map(fixture => fixture.id));
    let outcomes = 0;
    for (const [index, fixture] of retained.entries()) {
      const original = oldFixtures[index]!;
      expect(getYouthFixtureTeams(fixture, next)).toEqual({ home: original.home, away: original.away });
      if (isYouthOutcome(fixture)) {
        expect([fixture.homeClubId, fixture.awayClubId]).not.toContain(state.managedClubId);
        expect([fixture.homeClubId, fixture.awayClubId].some(id => latestByClub.get(id) === fixture.id)).toBe(false);
        expect(fixture).toEqual({ ...original, home: null, away: null, startingConditions: null, detail: 'outcome', playerIds: { home: original.home!.players.map(player => player.id), away: original.away!.players.map(player => player.id) } });
        outcomes += 1;
      } else expect(fixture).toEqual(original);
    }
    expect(outcomes).toBeGreaterThan(0);
    expect(getYouthFixtures(next, 2)).toHaveLength(30);
    expect(getYouthFixtures(next, 2).every(fixture => fixture.result === null)).toBe(true);
    for (const club of next.clubs) expect(getClubAcademy(next, club.id)).toHaveLength(8);
    expect(next.academy.intakes.filter(intake => intake.source === 'youth-squad').every(intake => intake.round === 1)).toBe(true);
  });
});

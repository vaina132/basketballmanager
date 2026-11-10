import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_SCOUTS } from '../src/data/development-scouts';
import { DEVELOPMENT_COACHES } from '../src/data/development-coaches';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { availableCoaches, enableCoaching, hireCoach } from '../src/world/coaching';
import { getFinanceBalance } from '../src/world/finance';
import { getClubCashOutlook } from '../src/world/finance-outlook';
import { availableScouts, getClubScouts, quoteScoutHire } from '../src/world/scout-policy';
import { hireScout, releaseScout, setScoutRenewal } from '../src/world/scouts';
import { assignScouting } from '../src/world/scouting';
import { getPlayerKnowledge } from '../src/world/scouting-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { remainingStaffBudget, STAFF_BUDGET, staffCommitted } from '../src/world/staff-policy';

const club = 'rhine-falcons', target = 'aeg-1';
const restore = (state: SeasonState) => parseSeason(serializeSeason(state));
const opening = (coaching = true) => createSeason(731, club, 'off', true, coaching, true, true, null, false, true, false, false, true);
const advance = (state: SeasonState): SeasonState => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const fee = (id: string) => DEVELOPMENT_SCOUTS.find(scout => scout.id === id)!.fee;
let initial: SeasonState, hired: SeasonState, assigned: SeasonState, reported: SeasonState, released: SeasonState, nextYear: SeasonState;
const boundaries: SeasonState[] = [];

beforeAll(() => {
  initial = opening();
  hired = hireScout(initial, 'scout-19');
  assigned = assignScouting(hired, target, getClubScouts(hired)[0]!.id);
  reported = advance(assigned);
  released = releaseScout(reported, getClubScouts(reported)[0]!.id);
  let state = hireScout(released, availableScouts(released).find(scout => scout.fee === 2_000_000)!.id);
  boundaries.push(initial, assigned, reported, state);
  while (state.status === 'active') { state = advance(state); boundaries.push(state); }
  nextYear = rolloverSeason(state);
  boundaries.push(nextYear);
  state = nextYear;
  while (state.status === 'active') { state = advance(state); boundaries.push(state); }
}, 120_000);

describe('recruitable scouts in actual careers', () => {
  it('uses one staff allocation for both roles and keeps released fees committed', () => {
    const expensive = availableCoaches(hired.coaching).find(coach => coach.fee > remainingStaffBudget(hired) && coach.fee <= STAFF_BUDGET - staffCommitted(initial, club))!;
    expect(expensive).toBeDefined();
    expect(() => hireCoach(hired, expensive.id)).toThrow(/staff|budget|allocation/i);
    const affordable = availableCoaches(hired.coaching).filter(coach => coach.fee <= remainingStaffBudget(hired)).sort((a, b) => a.fee - b.fee)[0]!;
    const mixed = hireCoach(hired, affordable.id);
    const scout = availableScouts(mixed).find(scout => scout.fee > remainingStaffBudget(mixed))!;
    expect(quoteScoutHire(mixed, scout.id).canHire).toBe(false);
    expect(() => hireScout(mixed, scout.id)).toThrow(/staff|budget|allocation/i);
    expect(staffCommitted(released, club)).toBe(staffCommitted(reported, club));
    expect(getFinanceBalance(released.finance, club)).toEqual(getFinanceBalance(reported.finance, club));
  });

  it('posts the fee once and immediately lowers the cash outlook without creating another future payment', () => {
    const before = getClubCashOutlook(initial), after = getClubCashOutlook(hired);
    expect(before.startCash - after.startCash).toBe(fee('scout-19'));
    expect(hired.finance.ledger.slice(initial.finance.ledger.length)).toMatchObject([{ kind: 'scouting', clubId: club, amount: -fee('scout-19'), scout: { scoutId: 'scout-19' } }]);
    expect(after.baseline.endBalance).toBe(before.baseline.endBalance - fee('scout-19'));
    expect(after.rows.map(row => [row.wages, row.operations, row.transferOut])).toEqual(before.rows.map(row => [row.wages, row.operations, row.transferOut]));
    expect(hired.activeMatch).toEqual(initial.activeMatch);
  });

  it('cancels only a released scout\'s queued visit, with no report or refund', () => {
    const baseline = assignScouting(assigned, 'aeg-2', null);
    const cancelled = releaseScout(baseline, getClubScouts(baseline)[0]!.id);
    expect(cancelled.scouting.clubs[club]!.assignments.map(item => item.playerId)).toEqual(['aeg-2']);
    expect(cancelled.scouting.clubs[club]!.reviews).toEqual(baseline.scouting.clubs[club]!.reviews);
    expect(cancelled.finance).toEqual(baseline.finance);
    expect(restore(cancelled)).toEqual(cancelled);
  });

  it('keeps named reports after release and reveals ranges rather than outsider attributes', () => {
    const report = reported.scouting.clubs[club]!.reviews.find(review => review.playerId === target)!;
    expect(report).toMatchObject({ outcome: 'observed', observer: { scoutId: 'scout-19', evidence: 200 } });
    expect(released.scouting.clubs[club]!.reviews).toEqual(reported.scouting.clubs[club]!.reviews);
    const knowledge = getPlayerKnowledge(released, target);
    expect(knowledge).toMatchObject({ kind: 'report', level: 2, attributes: null, observations: 1 });
    expect(Object.values(knowledge.ranges!).every(range => range.min < range.max)).toBe(true);
    expect(restore(released)).toEqual(released);
  });

  it('charges three scouts against the same limit when coaching is enabled later', () => {
    let state = opening(false);
    for (const id of ['scout-19', 'scout-20', 'scout-21']) state = hireScout(state, id);
    expect(getClubScouts(state)).toHaveLength(3);
    expect(remainingStaffBudget(state)).toBe(0);
    const enabled = enableCoaching(state);
    expect(enabled.coaching.contracts.filter(contract => contract.clubId === club)).toHaveLength(0);
    expect(staffCommitted(enabled, club)).toBe(STAFF_BUDGET);
    expect(restore(enabled)).toEqual(enabled);
  });

  it('starts a fresh annual allocation while retaining the old scout and report history', () => {
    const previousContract = hired.scouts.contracts.find(contract => contract.clubId === club)!;
    expect(nextYear.scouts.contracts.find(contract => contract.id === previousContract.id)?.releasedRound).toBe(2);
    expect(getClubScouts(nextYear)).toHaveLength(1);
    expect(getClubScouts(nextYear)[0]!.seasonNumber).toBe(2);
    expect(nextYear.scouting.clubs[club]!.reviews).toEqual(released.scouting.clubs[club]!.reviews);
    expect(staffCommitted(nextYear, club)).toBe(6_000_000);
    expect(restore(nextYear)).toEqual(nextYear);
  });

  it('applies caps, availability and the annual allocation equally at every human and AI boundary', () => {
    for (const state of boundaries) {
      const active = state.clubs.flatMap(team => getClubScouts(state, team.id));
      expect(new Set(active.map(contract => contract.scoutId)).size).toBe(active.length);
      for (const team of state.clubs) {
        expect(getClubScouts(state, team.id).length).toBeLessThanOrEqual(3);
        expect(staffCommitted(state, team.id)).toBeLessThanOrEqual(STAFF_BUDGET);
        const expected = state.coaching.contracts.filter(contract => contract.clubId === team.id).reduce((sum, contract) => sum + DEVELOPMENT_COACHES.find(coach => coach.id === contract.coachId)!.fee, 0)
          + state.scouts.contracts.filter(contract => contract.clubId === team.id && contract.seasonNumber === state.seasonNumber).reduce((sum, contract) => sum + fee(contract.scoutId), 0);
        expect(staffCommitted(state, team.id)).toBe(expected);
      }
    }
    expect(initial.clubs.filter(team => team.id !== club).every(team => getClubScouts(initial, team.id).length === 1)).toBe(true);
    expect(restore(boundaries.at(-1)!)).toEqual(boundaries.at(-1));
  });

  it('preserves the next match action and world transition through save/load', () => {
    const loaded = restore(assigned);
    expect(stepMatch(loaded.activeMatch)).toEqual(stepMatch(assigned.activeMatch));
    expect(advance(loaded)).toEqual(reported);
    expect(getClubScouts(setScoutRenewal(hired, getClubScouts(hired)[0]!.id, false))[0]!.renew).toBe(false);
    expect(getClubScouts(hired)[0]!.renew).toBe(true);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import type { FinanceEntry } from '../src/domain/finance';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_SCOUTS } from '../src/data/development-scouts';
import { createFixtureMatch } from '../src/engine/match';
import { enableCoaching, hireCoach, releaseCoach } from '../src/world/coaching';
import { getFinanceBalance } from '../src/world/finance';
import { getSpendableCash } from '../src/world/payroll-policy';
import { availableScouts, getClubScouts, quoteScoutHire, scoutEvidence, scoutRating } from '../src/world/scout-policy';
import { createScouts, enableScouts, hireScout, recruitAiScouts, releaseScout, setScoutRenewal } from '../src/world/scouts';
import { assignScouting, cancelScoutingAssignment, processScoutingRound } from '../src/world/scouting';
import { getPlayerKnowledge, getScoutingCapacity, getScoutingEvidence, getScoutingObservers, quoteScoutingAssignment } from '../src/world/scouting-policy';
import { createSeason, dateForRound } from '../src/world/season';
import { remainingStaffBudget, STAFF_BUDGET, staffCommitted } from '../src/world/staff-policy';

const clubId = 'rhine-falcons', otherId = 'aegean-waves';
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const create = (scouts = true) => createSeason(71, clubId, 'off', true, true, true, true, null, true, true, true, true, scouts);
/** Controlled exposure fixture isolates report policy, not a portable saved matchday. */
function committed(state: SeasonState, unavailable: string[] = []): SeasonState {
  return { ...state, fixtures: state.fixtures.map(fixture => {
    if (fixture.round !== state.round) return fixture;
    const home = state.clubs.find(club => club.id === fixture.homeClubId)!, away = state.clubs.find(club => club.id === fixture.awayClubId)!;
    const match = createFixtureMatch(1, home, away);
    const stats = Object.fromEntries(Object.entries(match.stats).map(([id, stats]) => [id, { ...stats, secondsPlayed: unavailable.includes(id) ? 0 : 1200 }]));
    return { ...fixture, result: { score: { home: 0, away: 0 }, officialScore: { home: 0, away: 0 }, winnerClubId: home.id, kind: 'normal' as const, periods: 4, stats, injuries: {}, rosterIds: { home: state.rosters.find(roster => roster.clubId === home.id)!.id, away: state.rosters.find(roster => roster.clubId === away.id)!.id } } };
  }) };
}
function observe(state: SeasonState, playerId: string, observer?: string | null, unavailable: string[] = []): SeasonState { return processScoutingRound(committed(assignScouting(state, playerId, observer), unavailable)); }
function expense(state: SeasonState, amount: number): SeasonState {
  const entry: FinanceEntry = { id: `test-${state.finance.ledger.length}`, clubId, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount: -amount, sourceId: 'isolated-test-obligation', ticket: null, coach: null, payroll: null };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, entry] } };
}

describe('recruitable scouts and shared staff allocation', () => {
  let initial: SeasonState, targets: string[];
  beforeAll(() => { initial = freeze(create()); targets = initial.clubs.find(club => club.id === otherId)!.players.map(player => player.id); });

  it('keeps legacy staff and pending baseline observations unchanged until prospective activation', () => {
    const legacy = freeze(assignScouting(create(false), targets[0]!));
    expect(legacy.scouts).toEqual(createScouts());
    const activated = enableScouts(legacy);
    expect(activated.scouts.enabledSince).toEqual({ seasonNumber: 1, round: 1, ledgerIndex: legacy.finance.ledger.length });
    expect(activated.scouting.clubs[clubId]!.assignments).toBe(legacy.scouting.clubs[clubId]!.assignments);
    expect(activated.scouting.clubs[clubId]!.assignments[0]).not.toHaveProperty('observer');
    expect(activated.activeMatch).toBe(legacy.activeMatch);
    expect(getClubScouts(activated)).toHaveLength(0);
    expect(enableScouts(activated)).toBe(activated);
    expect(() => enableScouts(createSeason())).toThrow(/scouting/i);
    expect(() => createSeason(1, clubId, 'off', true, true, false, false, null, false, true, false, false, true)).toThrow(/finances/i);
  });

  it('offers a frozen fictional catalog with honest half-star ratings and bounded evidence', () => {
    expect(DEVELOPMENT_SCOUTS).toHaveLength(24);
    expect(new Set(DEVELOPMENT_SCOUTS.map(scout => scout.id)).size).toBe(24);
    for (const scout of DEVELOPMENT_SCOUTS) {
      expect(Object.isFrozen(scout)).toBe(true);
      expect(Object.isFrozen(scout.skills)).toBe(true);
      expect(scoutRating(scout)).toBe(Math.round((scout.skills.evaluation + scout.skills.reporting) / 2));
      expect(scoutEvidence(scout)).toBeGreaterThan(100);
      expect(scoutEvidence(scout)).toBeLessThanOrEqual(200);
    }
  });

  it('books the fee once and enforces the shared allocation in both recruitment directions', () => {
    const hire = hireScout(initial, 'scout-06'), contract = getClubScouts(hire)[0]!;
    expect(contract).toMatchObject({ scoutId: 'scout-06', hiredLedgerIndex: initial.finance.ledger.length, releasedRound: null, renew: true });
    expect(hire.finance.ledger.at(-1)).toMatchObject({ kind: 'scouting', amount: -2_000_000, sourceId: `scouting-${contract.id}`, scout: { contractId: contract.id, scoutId: 'scout-06' }, ticket: null, coach: null, payroll: null });
    expect(getFinanceBalance(initial.finance, clubId).cash - getFinanceBalance(hire.finance, clubId).cash).toBe(2_000_000);
    expect(staffCommitted(hire, clubId)).toBe(6_000_000);
    expect(remainingStaffBudget(hire)).toBe(Math.min(9_000_000, getSpendableCash(hire, clubId)));
    expect(() => hireCoach(hireScout(hire, 'scout-07'), 'coach-07')).toThrow(/shared staff/i);
    const full = hireScout(hireCoach(initial, 'coach-07'), 'scout-13');
    expect(staffCommitted(full, clubId)).toBe(STAFF_BUDGET);
    expect(quoteScoutHire(full, 'scout-06')).toMatchObject({ canHire: false, remainingAllocation: 0, remainingBudget: 0 });
    expect(full.activeMatch).toBe(initial.activeMatch);
  });

  it('limits every club to three unique scouts and retains full fees after release', () => {
    let state = hireScout(hireScout(hireScout(initial, 'scout-06'), 'scout-07'), 'scout-08');
    expect(getClubScouts(state)).toHaveLength(3);
    expect(getScoutingCapacity(state)).toBe(5);
    expect(() => hireScout(state, 'scout-09')).toThrow(/three scout/i);
    const contract = getClubScouts(state)[0]!, beforeCash = getFinanceBalance(state.finance, clubId), beforeFee = staffCommitted(state, clubId);
    state = releaseScout(state, contract.id);
    expect(getClubScouts(state)).toHaveLength(2);
    expect(state.scouts.contracts.find(item => item.id === contract.id)).toMatchObject({ releasedRound: 1, releasedLedgerIndex: state.finance.ledger.length });
    expect(getFinanceBalance(state.finance, clubId)).toEqual(beforeCash);
    expect(staffCommitted(state, clubId)).toBe(beforeFee);
    expect(availableScouts(state).some(scout => scout.id === contract.scoutId)).toBe(true);
    expect(() => releaseScout(state, contract.id)).toThrow(/active scout/i);
  });

  it('applies cash, protected commitments and unpaid-cost guards without mutation', () => {
    const poor = freeze(expense(initial, getSpendableCash(initial, clubId) - 1_000_000));
    expect(quoteScoutHire(poor, 'scout-06').reason).toMatch(/protected|remaining budget/i);
    expect(remainingStaffBudget(poor)).toBe(1_000_000);
    expect(() => hireScout(poor, 'scout-06')).toThrow(/budget/i);
    const overdue = freeze(expense(initial, getFinanceBalance(initial.finance, clubId).cash + 100));
    expect(quoteScoutHire(overdue, 'scout-06').reason).toMatch(/unpaid/i);
    expect(remainingStaffBudget(overdue)).toBe(0);
    expect(getClubScouts(overdue)).toHaveLength(0);
    expect(() => hireScout({ ...initial, status: 'complete' }, 'scout-06')).toThrow(/next season/i);
  });

  it('keeps AI recruitment deterministic and within the same limits and unique-person rules', () => {
    expect(getClubScouts(initial)).toHaveLength(0);
    expect(recruitAiScouts(initial)).toBe(initial);
    const ids = initial.scouts.contracts.map(contract => contract.scoutId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const club of initial.clubs) {
      expect(getClubScouts(initial, club.id)).toHaveLength(club.id === clubId ? 0 : 1);
      expect(staffCommitted(initial, club.id)).toBeLessThanOrEqual(STAFF_BUDGET);
    }
    expect(create()).toEqual(initial);
    expect(recruitAiScouts(create(false)).scouts).toEqual(createScouts());
  });

  it('counts scouts when coaching is later enabled and renew policy changes do not alter past fees', () => {
    const withoutCoaches = createSeason(71, clubId, 'off', true, false, true, true, null, true, true, true, true, true);
    const scouts = hireScout(hireScout(hireScout(withoutCoaches, 'scout-19'), 'scout-20'), 'scout-21');
    expect(staffCommitted(scouts, clubId)).toBe(STAFF_BUDGET);
    const coached = enableCoaching(scouts);
    expect(coached.coaching.contracts.filter(contract => contract.clubId === clubId)).toEqual([]);
    expect(staffCommitted(coached, clubId)).toBe(STAFF_BUDGET);
    const contract = getClubScouts(scouts)[0]!;
    const manual = setScoutRenewal(scouts, contract.id, false);
    expect(manual.finance).toBe(scouts.finance);
    expect(manual.scouts.contracts.find(item => item.id === contract.id)?.renew).toBe(false);
    expect(() => setScoutRenewal(scouts, contract.id, 'yes' as never)).toThrow(/renew/i);
    const releasedCoach = releaseCoach(hireScout(initial, 'scout-06'), initial.coaching.contracts.find(item => item.clubId === clubId)!.id);
    expect(staffCommitted(releasedCoach, clubId)).toBe(6_000_000);
  });
});

describe('named observations and frozen report quality', () => {
  let initial: SeasonState, target: string, targets: string[];
  beforeAll(() => { initial = freeze(create()); targets = initial.clubs.find(club => club.id === otherId)!.players.map(player => player.id); target = targets[0]!; });

  it('retains two baseline slots and adds one distinct named slot per hired scout', () => {
    let state = hireScout(hireScout(hireScout(initial, 'scout-06'), 'scout-07'), 'scout-08');
    const contracts = getClubScouts(state);
    state = assignScouting(assignScouting(state, targets[0]!, null), targets[1]!, null);
    for (const [index, contract] of contracts.entries()) state = assignScouting(state, targets[index + 2]!, contract.id);
    expect(state.scouting.clubs[clubId]!.assignments).toHaveLength(5);
    expect(getScoutingObservers(state).every(observer => !observer.available)).toBe(true);
    expect(quoteScoutingAssignment(state, targets[5]!).canAssign).toBe(false);
    expect(quoteScoutingAssignment(state, targets[5]!, clubId, contracts[0]!.id).reason).toMatch(/already has/i);
    const reopened = cancelScoutingAssignment(state, targets[2]!);
    expect(quoteScoutingAssignment(reopened, targets[5]!, clubId, contracts[0]!.id).canAssign).toBe(true);
    expect(quoteScoutingAssignment(reopened, targets[5]!, clubId, 'not-my-scout').canAssign).toBe(false);
  });

  it('chooses the strongest available scout by default and freezes provenance at allocation', () => {
    const staffed = hireScout(initial, 'scout-19'), contract = getClubScouts(staffed)[0]!;
    const assigned = assignScouting(staffed, target);
    expect(assigned.scouting.clubs[clubId]!.assignments[0]?.observer).toEqual({ contractId: contract.id, scoutId: 'scout-19', evidence: 200, assignedLedgerIndex: staffed.finance.ledger.length });
    const second = assignScouting(assigned, targets[1]!);
    expect(second.scouting.clubs[clubId]!.assignments[1]?.observer).toMatchObject({ contractId: null, scoutId: null, evidence: 100 });
    expect(second.activeMatch).toBe(initial.activeMatch);
  });

  it('improves evidence only with actual minutes while ranges remain uncertain and old reports keep their quality', () => {
    const staffed = freeze(hireScout(initial, 'scout-19')), contract = getClubScouts(staffed)[0]!;
    const base = observe(staffed, target, null), skilled = observe(staffed, target, contract.id), absent = observe(staffed, target, contract.id, [target]);
    expect(getPlayerKnowledge(base, target).level).toBe(1);
    expect(getPlayerKnowledge(skilled, target).level).toBe(2);
    expect(getPlayerKnowledge(skilled, target).attributes).toBeNull();
    expect(getScoutingEvidence(skilled.scouting.clubs[clubId]!.reviews[0]!)).toBe(200);
    expect(getScoutingEvidence(absent.scouting.clubs[clubId]!.reviews[0]!)).toBe(0);
    expect(getPlayerKnowledge(absent, target).kind).toBe('unknown');
    expect(Object.values(getPlayerKnowledge(skilled, target).ranges!).every(range => range.max - range.min >= 2)).toBe(true);
    const released = releaseScout(skilled, contract.id);
    expect(getPlayerKnowledge(released, target)).toEqual(getPlayerKnowledge(skilled, target));
    expect(released.scouting.clubs[clubId]!.reviews).toBe(skilled.scouting.clubs[clubId]!.reviews);
    const next = { ...skilled, round: 2, date: dateForRound(2) };
    expect(getPlayerKnowledge(observe(next, target, contract.id), target).level).toBe(3);
    expect(getPlayerKnowledge({ ...base, scouts: staffed.scouts }, target)).toEqual(getPlayerKnowledge(base, target));
  });

  it('cancels only the released scout pending job without silently downgrading it to baseline', () => {
    const staffed = hireScout(initial, 'scout-06'), contract = getClubScouts(staffed)[0]!;
    const assigned = assignScouting(assignScouting(staffed, target, contract.id), targets[1]!, null);
    const released = releaseScout(assigned, contract.id);
    expect(released.scouting.clubs[clubId]!.assignments).toEqual([assigned.scouting.clubs[clubId]!.assignments[1]]);
    expect(released.finance).toBe(assigned.finance);
    expect(getScoutingCapacity(released)).toBe(2);
    expect(processScoutingRound(committed(released)).scouting.clubs[clubId]!.reviews.some(review => review.playerId === target)).toBe(false);
  });
});

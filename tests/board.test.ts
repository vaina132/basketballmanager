import { describe, expect, it } from 'vitest';
import type { BoardReview } from '../src/domain/board';
import type { EmploymentTransfer } from '../src/domain/employment';
import type { FinanceEntry } from '../src/domain/finance';
import type { RehabilitationRecord } from '../src/domain/physio';
import type { FixtureResult, SeasonState } from '../src/domain/season';
import { boardConfidenceLabel, boardUnpaidCosts, buildBoardMandate, buildBoardReview, createBoard, enableBoard, getBoardSummary, prepareBoardSeason, processBoardRound } from '../src/world/board';
import { createRosterSnapshots, rosterForRound } from '../src/world/rosters';
import { createSchedule, createSeason, dateForRound } from '../src/world/season';

const clubId = 'rhine-falcons';
const initial = () => createSeason(227, clubId, 'off', false, false, false, false);
const freeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

/** Controlled policy evidence, not an exportable career or a fabricated browser fixture. */
function committed(state: SeasonState, round: number, wins = 0): SeasonState {
  return { ...state, round, date: dateForRound(round, state.seasonNumber), status: round === 10 ? 'complete' : 'active', fixtures: state.fixtures.map(fixture => {
    if (fixture.round > round) return { ...fixture, result: null };
    const home = rosterForRound(state.rosters, fixture.homeClubId, fixture.round), away = rosterForRound(state.rosters, fixture.awayClubId, fixture.round);
    const managed = [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId);
    const winnerClubId = managed ? fixture.round <= wins ? state.managedClubId : fixture.homeClubId === state.managedClubId ? fixture.awayClubId : fixture.homeClubId : fixture.homeClubId;
    const result: FixtureResult = { score: { home: 70, away: 60 }, officialScore: { home: 70, away: 60 }, winnerClubId, kind: 'normal', periods: 4, rosterIds: { home: home.id, away: away.id }, injuries: fixture.result?.injuries ?? {}, stats: {} };
    return { ...fixture, result };
  }) };
}
function reviewThrough(state: SeasonState, round: number, wins = 0): SeasonState {
  let next = state;
  for (let at = 1; at <= round; at += 1) next = processBoardRound(committed(next, at, wins));
  return next;
}
function entry(id: number, amount: number, kind: FinanceEntry['kind'] = 'operations', sourceId = `source-${id}`): FinanceEntry {
  return { id: `finance-${id}`, clubId, seasonNumber: 1, round: 1, kind, amount, sourceId, ticket: null, coach: null, payroll: null };
}

describe('communicated board mandates and evidence-based confidence', () => {
  it('opts in prospectively without altering prepared gameplay and waits until next season after round ten', () => {
    const before = freeze(initial()), enabled = enableBoard(before);
    expect(before.board).toEqual(createBoard());
    expect(enabled.activeMatch).toBe(before.activeMatch);
    expect(enabled.board.enabledSince?.includeCurrentRound).toBe(false);
    expect(enabled.board.mandates[0]).toMatchObject({ startsRound: 2, deadlineDate: dateForRound(10) });
    expect(enabled.board.mandates[0]!.clubs[clubId]!.games).toBe(9);
    expect(enableBoard(enabled)).toBe(enabled);
    expect(processBoardRound(committed(enabled, 1))).toEqual(committed(enabled, 1));
    expect(() => enableBoard({ ...before, activeMatch: { ...before.activeMatch, stepCount: 1 } }, 'career')).toThrow(/untouched/);
    const late = enableBoard(committed(initial(), 10));
    expect(late.board.mandates).toHaveLength(0);
    expect(getBoardSummary(late)).toMatchObject({ enabled: true, confidence: 50, mandate: null, latest: null, nextReviewDate: null });
    expect(prepareBoardSeason(initial())).toEqual(initial());
  });

  it('freezes meaningful resource ranks and proportionate targets without later moving the goalposts', () => {
    const state = enableBoard(initial(), 'career'), mandate = state.board.mandates[0]!;
    expect(new Set(Object.values(mandate.clubs).map(club => club.resourceRank)).size).toBeGreaterThan(3);
    expect(Object.values(mandate.clubs).map(club => club.targetWins).sort()).toEqual([4, 4, 5, 5, 6, 6]);
    const changed = { ...state, clubs: state.clubs.map(club => ({ ...club, players: club.players.map(player => ({ ...player, attributes: Object.fromEntries(Object.keys(player.attributes).map(key => [key, 20])) as unknown as typeof player.attributes })) })) };
    expect(getBoardSummary(changed).mandate).toBe(mandate);
    expect(buildBoardMandate(changed, 1).clubs).toEqual(mandate.clubs);
    const atFive = { ...initial(), round: 5, date: dateForRound(5) }, partial = enableBoard(atFive).board.mandates[0]!;
    expect(partial.startsRound).toBe(6);
    expect(Object.values(partial.clubs).every(club => club.games === 5 && club.targetWins >= 2 && club.targetWins <= 3)).toBe(true);
    expect(() => buildBoardMandate(state, 0)).toThrow(/prospective/);
  });

  it('treats equal registered resources equally regardless of club order or manager ownership', () => {
    const state = initial(), attributes = state.clubs[0]!.players[0]!.attributes;
    const clubs = state.clubs.map(club => ({ ...club, players: club.players.map(player => ({ ...player, attributes })) }));
    const equal = enableBoard({ ...state, clubs, rosters: createRosterSnapshots(clubs, 1) }, 'career');
    expect(new Set(Object.values(equal.board.mandates[0]!.clubs).map(club => `${club.resourceRank}:${club.targetWins}`))).toEqual(new Set(['1:6']));
    const evidence = committed(equal, 3, 0), first = buildBoardReview(evidence, equal.board.mandates[0]!);
    const other = buildBoardReview({ ...evidence, managedClubId: clubs[1]!.id, clubs: [...clubs].reverse() }, equal.board.mandates[0]!);
    expect(other.clubs).toEqual(first.clubs);
  });

  it('reviews committed matchdays once, gives a three-game grace period and exposes bounded components', () => {
    const state = enableBoard(initial(), 'career');
    expect(() => processBoardRound(state)).toThrow(/Commit every fixture/);
    const first = processBoardRound(freeze(committed(state, 1)));
    expect(first.board.reviews[0]!.clubs[clubId]).toMatchObject({ played: 1, wins: 0, resultsImpact: 0, confidence: 50 });
    expect(processBoardRound(first)).toBe(first);
    expect(getBoardSummary(first).sportingStatus).toBe('building');
    const losing = reviewThrough(state, 10), summary = getBoardSummary(losing);
    expect(losing.board.reviews).toHaveLength(10);
    expect(summary.sportingStatus).toBe('missed');
    expect(summary.confidence).toBe(20);
    expect(summary.latest!.club.resultsImpact).toBe(-30);
    expect(summary.latest!.club.fixtureIds).toHaveLength(10);
    for (const review of losing.board.reviews) for (const result of Object.values(review.clubs)) {
      expect(Math.abs(result.confidence - result.previousConfidence)).toBeLessThanOrEqual(8);
      expect(result.assessment).toBe(50 + result.resultsImpact + result.injuryRelief + result.financeImpact);
    }
    expect(getBoardSummary(reviewThrough(state, 10, 10)).sportingStatus).toBe('met');
    expect(getBoardSummary(reviewThrough(state, 10, 10)).confidence).toBeGreaterThan(65);
  });

  it('does not count the known current game in an existing-career assessment window', () => {
    const atFour = { ...committed(initial(), 3, 3), round: 4, date: dateForRound(4) };
    const enabled = enableBoard(atFour);
    expect(enabled.board.mandates[0]!.startsRound).toBe(5);
    expect(processBoardRound(committed(enabled, 4, 4)).board.reviews).toHaveLength(0);
    const first = processBoardRound(committed(enabled, 5, 4));
    expect(first.board.reviews[0]!.clubs[clubId]).toMatchObject({ played: 1, wins: 0, confidence: 50 });
    expect(first.board.reviews[0]!.clubs[clubId]!.fixtureIds.every(id => first.fixtures.find(fixture => fixture.id === id)!.round === 5)).toBe(true);
  });

  it('credits actual carried absences, excludes new injuries and honors earlier rehabilitation clearance', () => {
    let state = committed(enableBoard(initial(), 'career'), 4);
    const player = state.clubs.find(club => club.id === clubId)!.players[0]!, first = state.fixtures.find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(clubId))!;
    const injury = { id: 'policy-injury', playerId: player.id, clubId, kind: 'ankle' as const, fixtureId: first.id, occurredOn: first.date, returnOn: dateForRound(5) };
    state = { ...state, injuries: [injury], fixtures: state.fixtures.map(fixture => fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(clubId) ? { ...fixture, result: { ...fixture.result, injuries: { [player.id]: 'ankle' } } } : fixture) };
    const review = buildBoardReview(state, state.board.mandates[0]!);
    expect(review.clubs[clubId]).toMatchObject({ carriedAbsences: 3, rosterPlaces: 40, injuryRelief: 2 });
    const rehab = { injuryId: injury.id, toDate: dateForRound(3), returnAfter: dateForRound(3) } as RehabilitationRecord;
    const treated = buildBoardReview({ ...state, physio: { ...state.physio, rehabilitation: [rehab] } }, state.board.mandates[0]!);
    expect(treated.clubs[clubId]!.carriedAbsences).toBe(1);
    const absentEvidence = buildBoardReview({ ...state, fixtures: state.fixtures.map(fixture => fixture.result ? { ...fixture, result: { ...fixture.result, injuries: {} } } : fixture) }, state.board.mandates[0]!);
    expect(absentEvidence.clubs[clubId]!.carriedAbsences).toBe(0);
    const winning = { ...state, fixtures: state.fixtures.map(fixture => fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(clubId) ? { ...fixture, result: { ...fixture.result, winnerClubId: clubId } } : fixture) };
    expect(buildBoardReview(winning, state.board.mandates[0]!).clubs[clubId]!.injuryRelief).toBe(0);
  });

  it('judges changes to starting unpaid costs, not spending or inherited debt itself', () => {
    const base = initial(), ledger = [entry(1, 100, 'opening'), entry(2, -2_000_100)];
    const enabled = enableBoard({ ...base, finance: { ...base.finance, ledger } }, 'career');
    expect(enabled.board.mandates[0]!.clubs[clubId]!.startingUnpaid).toBe(2_000_000);
    const same = committed(enabled, 1);
    expect(buildBoardReview(same, enabled.board.mandates[0]!).clubs[clubId]).toMatchObject({ unpaid: 2_000_000, financeImpact: 0 });
    const repaid = { ...same, finance: { ...same.finance, ledger: [...ledger, entry(3, 2_000_000, 'sponsor')] } };
    expect(buildBoardReview(repaid, enabled.board.mandates[0]!).clubs[clubId]!.financeImpact).toBe(10);
    const worse = { ...same, finance: { ...same.finance, ledger: [...ledger, entry(3, -10_000_000)] } };
    expect(buildBoardReview(worse, enabled.board.mandates[0]!).clubs[clubId]).toMatchObject({ financeImpact: -25, confidence: 42 });
    const spent = { ...same, finance: { ...same.finance, ledger: [entry(1, 100_000_000, 'opening'), entry(2, -90_000_000, 'facility')] } };
    expect(boardUnpaidCosts(spent, clubId)).toBe(0);
    const withoutFinance = enableBoard(initial(), 'career');
    const laterFinance = committed({ ...withoutFinance, finance: spent.finance }, 3);
    expect(buildBoardReview(laterFinance, withoutFinance.board.mandates[0]!).clubs[clubId]).toMatchObject({ unpaid: null, financeImpact: 0 });
    expect(getBoardSummary(processBoardRound(laterFinance)).financeStatus).toBe('unassessed');
  });

  it('includes overdue transfer installments using only payments present in the finance prefix', () => {
    const state = initial();
    const transfer: EmploymentTransfer = { id: 'transfer-1', offerId: 'offer-1', playerId: 'aeg-1', fromClubId: 'aegean-waves', toClubId: clubId, seasonNumber: 1, completedOn: state.date, startsSeason: 1, startsRound: 1, fee: 3_000_000, releasedContractIds: [], contractId: 'contract-1', paymentPlan: 'two-payments', installments: [{ dueOn: state.date, amount: 1_500_000 }, { dueOn: dateForRound(3), amount: 1_500_000 }], payments: [{ id: 'transfer-1', installmentIndex: 0, paidOn: state.date, seasonNumber: 1, round: 1, amount: 1_500_000 }, { id: 'transfer-1-payment-2', installmentIndex: 1, paidOn: dateForRound(3), seasonNumber: 1, round: 3, amount: 1_500_000 }] };
    const before = { ...state, date: dateForRound(3), employment: { ...state.employment, transfers: [transfer] }, finance: { ...state.finance, ledger: [entry(1, 10_000_000, 'opening')] } };
    expect(boardUnpaidCosts(before, clubId)).toBe(0);
    const first = { ...before, finance: { ...before.finance, ledger: [...before.finance.ledger, entry(2, -1_500_000, 'transfer', transfer.id)] } };
    expect(boardUnpaidCosts(first, clubId)).toBe(1_500_000);
    const paid = { ...first, finance: { ...first.finance, ledger: [...first.finance.ledger, entry(3, -1_500_000, 'transfer', 'transfer-1-payment-2')] } };
    expect(boardUnpaidCosts(paid, clubId)).toBe(0);
  });

  it('keeps dated old reviews and confidence across the new season without showing old results as current', () => {
    const ended = reviewThrough(enableBoard(initial(), 'career'), 10), confidence = getBoardSummary(ended).confidence;
    const fresh = { ...ended, seasonNumber: 2, round: 1, date: dateForRound(1, 2), status: 'active' as const, fixtures: createSchedule(ended.clubs, 2), rosters: createRosterSnapshots(ended.clubs, 2) };
    const next = prepareBoardSeason(freeze(fresh)), summary = getBoardSummary(next);
    expect(summary).toMatchObject({ confidence, latest: null, sportingStatus: 'waiting', nextReviewDate: dateForRound(1, 2) });
    expect(summary.history).toHaveLength(10);
    expect(next.board.mandates).toHaveLength(2);
    expect(prepareBoardSeason(next)).toBe(next);
    const first = processBoardRound(committed(next, 1));
    expect(first.board.reviews.at(-1)!.clubs[clubId]!.previousConfidence).toBe(confidence);
    expect(first.board.reviews.at(-1)!.clubs[clubId]!.confidence).toBe(confidence + 8);
    expect(getBoardSummary(first).history[1]!.seasonNumber).toBe(1);
  });

  it('remains a pure explanatory layer with readable labels and no sporting or financial effects', () => {
    const before = freeze(committed(enableBoard(initial(), 'career'), 3));
    const next = processBoardRound(before), { board: _old, ...oldRest } = before, { board: _next, ...newRest } = next;
    expect(newRest).toEqual(oldRest);
    expect(getBoardSummary(next)).toEqual(getBoardSummary(next));
    expect([20, 35, 50, 70].map(boardConfidenceLabel)).toEqual(['Under pressure', 'Concerned', 'Steady', 'Confident']);
    expect(() => getBoardSummary(next, 'missing')).toThrow(/club/);
    expect(next.board.reviews[0] as BoardReview).not.toBe(before.board.reviews[0]);
  });
});

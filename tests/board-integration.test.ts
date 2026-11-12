import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { enableBoard, getBoardSummary } from '../src/world/board';
import { setEmploymentDelegation } from '../src/world/employment';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { submitInSeasonTransferOffer } from '../src/world/recruitment';
import { requiredInSeasonTransferFee } from '../src/world/recruitment-policy';
import { advanceSeason, createSeason, dateForRound, managedSide, rolloverSeason } from '../src/world/season';

const initial = (enabled = true) => createSeason(227, 'rhine-falcons', 'off', true, false, true, true, null, true, false, true, false, false, false, false, false, true, false, false, false, false, true, enabled);
const finish = (state: SeasonState): SeasonState => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const advance = (state: SeasonState) => advanceSeason(finish(state));
const withoutBoard = (state: SeasonState) => { const { board: _board, ...rest } = state; return rest; };

describe('board expectations in the actual career calendar', () => {
  it('records all clubs equally without changing match outcomes, money or other game state', () => {
    let enabled = initial(), disabled = initial(false);
    expect(withoutBoard(enabled)).toEqual(withoutBoard(disabled));
    expect(enabled.board.mandates[0]!.startsRound).toBe(1);
    for (let round = 1; round <= 4; round += 1) {
      enabled = advance(enabled); disabled = advance(disabled);
      expect(withoutBoard(enabled)).toEqual(withoutBoard(disabled));
      expect(enabled.board.reviews).toHaveLength(round);
      const review = enabled.board.reviews.at(-1)!;
      expect(review.round).toBe(round);
      expect(review.date).toBe(dateForRound(round));
      expect(Object.keys(review.clubs).sort()).toEqual(enabled.clubs.map(club => club.id).sort());
      for (const club of enabled.clubs) {
        const assessed = review.clubs[club.id]!;
        expect(assessed.played).toBe(round);
        expect(assessed.fixtureIds).toHaveLength(round);
        expect(assessed.wins).toBe(enabled.fixtures.filter(fixture => fixture.result?.winnerClubId === club.id).length);
        expect(Math.abs(assessed.confidence - assessed.previousConfidence)).toBeLessThanOrEqual(8);
      }
    }
    expect(parseSeason(serializeSeason(enabled))).toEqual(enabled);
  });

  it('keeps a known, uncommitted match outside a newly enabled assessment', () => {
    let before = initial(false);
    for (let i = 0; i < 3; i += 1) before = advance(before);
    before = finish(before);
    const enabled = enableBoard(before), mandate = enabled.board.mandates[0]!;
    expect(enabled.activeMatch).toBe(before.activeMatch);
    expect(mandate.startsRound).toBe(5);
    expect(enabled.board.reviews).toHaveLength(0);
    const next = advanceSeason(enabled);
    expect(next.board.reviews).toHaveLength(0);
    expect(getBoardSummary(next).nextReviewDate).toBe(dateForRound(5));
    const reviewed = advance(next);
    expect(reviewed.board.reviews).toHaveLength(1);
    expect(reviewed.board.reviews[0]!.round).toBe(5);
    expect(reviewed.board.reviews[0]!.clubs[reviewed.managedClubId]!.played).toBe(1);
    expect(parseSeason(serializeSeason(reviewed))).toEqual(reviewed);
  });

  it('keeps agreed expectations fixed after an actual paid signing and records reviews only on Continue', () => {
    let state = initial();
    const playerId = state.clubs.find(club => club.id === 'aegean-waves')!.players[0]!.id;
    const mandate = structuredClone(state.board.mandates[0]!);
    state = submitInSeasonTransferOffer(state, playerId, requiredNegotiationWage(playerId, 1), 1, requiredInSeasonTransferFee(state, playerId));
    const finished = finish(state);
    expect(finished.board.reviews).toHaveLength(0);
    expect(parseSeason(serializeSeason(finished))).toEqual(finished);
    state = advanceSeason(finished);
    expect(state.clubs.find(club => club.id === state.managedClubId)!.players.some(player => player.id === playerId)).toBe(true);
    expect(state.board.mandates[0]).toEqual(mandate);
    expect(state.board.reviews).toHaveLength(1);
    expect(advance(parseSeason(serializeSeason(state)))).toEqual(advance(state));
  });

  it('retains dated final reviews across rollover and carries confidence into the next assessment', () => {
    let state = setEmploymentDelegation(initial(), true);
    while (state.status === 'active') state = advance(state);
    const archivedReviews = structuredClone(state.board.reviews);
    const finalConfidence = getBoardSummary(state).confidence;
    expect(archivedReviews).toHaveLength(10);
    expect(getBoardSummary(state).nextReviewDate).toBeNull();
    state = rolloverSeason(state);
    expect(state.board.reviews).toEqual(archivedReviews);
    expect(state.board.mandates).toHaveLength(2);
    expect(state.board.mandates[1]!.startsRound).toBe(1);
    expect(getBoardSummary(state).confidence).toBe(finalConfidence);
    const loaded = parseSeason(serializeSeason(state));
    expect(loaded).toEqual(state);
    const next = advance(loaded);
    expect(next.board.reviews.at(-1)!.clubs[next.managedClubId]!.previousConfidence).toBe(finalConfidence);
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  });

  it('waits for the new season when enabled after the final match and supports finance-free careers', () => {
    let state = createSeason(15, 'aegean-waves', 'off', false, false, false, false);
    while (state.status === 'active') state = advance(state);
    const enabled = enableBoard(state);
    expect(enabled.board.mandates).toHaveLength(0);
    expect(enabled.board.reviews).toHaveLength(0);
    const opening = rolloverSeason(enabled);
    const assessed = advance(opening);
    expect(assessed.board.mandates[0]!.clubs[assessed.managedClubId]!.startingUnpaid).toBeNull();
    expect(assessed.board.reviews[0]!.clubs[assessed.managedClubId]!.financeImpact).toBe(0);
    expect(getBoardSummary(assessed).financeStatus).toBe('unassessed');
    expect(parseSeason(serializeSeason(assessed))).toEqual(assessed);
  });
});

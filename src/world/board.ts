import type { BoardAnchor, BoardClubReview, BoardMandate, BoardReview, BoardSummary, SeasonBoard } from '../domain/board';
import type { SeasonState } from '../domain/season';
import { getFinanceBalance } from './finance';
import { isRecovering } from './health';
import { rosterForRound } from './rosters';
import { dateForRound } from './season';
import { getTransferPaymentSummary } from './transfer-payments';

export const BOARD_REVIEW_STEP = 8;
export const BOARD_SPORTING_GRACE_GAMES = 3;
export const BOARD_WIN_TOLERANCE = 0.5;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const ordinal = (year: number, round: number) => (year - 1) * 10 + round;
const rounded = (n: number) => Math.round(n * 1000) / 1000;

export function createBoard(): SeasonBoard { return { model: 'board-1', enabledSince: null, mandates: [], reviews: [] }; }

export function boardEventAnchor(state: SeasonState): BoardAnchor {
  const completed = state.fixtures.filter(fixture => fixture.result).reduce((round, fixture) => Math.max(round, fixture.round), 0);
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, completedRounds: ordinal(state.seasonNumber, completed), ledgerCount: state.finance.ledger.length, rosterCount: state.rosters.length };
}

/** Restrict transfer evidence to receipts in this ledger prefix, including same-day decisions. */
export function boardUnpaidCosts(state: SeasonState, clubId: string): number | null {
  if (!state.finance.ledger.some(entry => entry.clubId === clubId && entry.kind === 'opening')) return null;
  const receipts = new Set(state.finance.ledger.filter(entry => entry.kind === 'transfer' && entry.amount < 0).map(entry => entry.sourceId));
  const transfers = state.employment.transfers.filter(transfer => receipts.has(transfer.id)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => receipts.has(payment.id)) }));
  return getFinanceBalance(state.finance, clubId).unpaid + getTransferPaymentSummary({ date: state.date, employment: { ...state.employment, transfers } }, clubId).overdue;
}

/** The mandate uses immutable registration snapshots, never later skill growth or arrivals. */
export function buildBoardMandate(state: SeasonState, startsRound: number): BoardMandate {
  if (!Number.isInteger(startsRound) || startsRound < 1 || startsRound > 11) throw new Error('Choose an actual prospective board assessment window.');
  const resources = state.clubs.map(club => {
    const roster = rosterForRound(state.rosters, club.id, state.round);
    const top = roster.players.map(player => Object.values(player.attributes).reduce((sum, value) => sum + value, 0) / 7).sort((a, b) => b - a).slice(0, 8);
    return { clubId: club.id, rosterId: roster.id, strength: top.reduce((sum, value) => sum + value, 0) / 8 };
  });
  const games = Math.max(0, 11 - startsRound);
  return { ...boardEventAnchor(state), id: `board-mandate-${state.board.mandates.length + 1}`, startsRound, deadlineDate: dateForRound(10, state.seasonNumber), clubs: Object.fromEntries(resources.map(resource => {
    const resourceRank = 1 + resources.filter(other => other.strength > resource.strength).length;
    const rate = resourceRank <= Math.ceil(resources.length / 3) ? 0.6 : resourceRank <= Math.ceil(resources.length * 2 / 3) ? 0.5 : 0.4;
    return [resource.clubId, { rosterId: resource.rosterId, resourceRank, targetWins: Math.ceil(games * rate), games, startingUnpaid: boardUnpaidCosts(state, resource.clubId) }];
  })) };
}

/** New-career initialization is separate from existing-career opt-in, which excludes today's match. */
export function enableBoard(state: SeasonState, mode: 'career' | 'prospective' = 'prospective'): SeasonState {
  if (state.board.enabledSince) return state;
  if (mode !== 'career' && mode !== 'prospective') throw new Error('Choose a supported board activation mode.');
  if (mode === 'career' && (state.seasonNumber !== 1 || state.round !== 1 || state.status !== 'active' || state.history.length || state.fixtures.some(fixture => fixture.result) || state.activeMatch.status !== 'ready' || state.activeMatch.stepCount !== 0)) throw new Error('Initial board expectations must be set at the untouched first career opening.');
  const board: SeasonBoard = { ...createBoard(), enabledSince: { ...boardEventAnchor(state), includeCurrentRound: mode === 'career' } };
  const enabled = { ...state, board };
  if (mode === 'prospective' && state.round === 10) return enabled;
  return { ...enabled, board: { ...board, mandates: [buildBoardMandate(enabled, mode === 'career' ? 1 : state.round + 1)] } };
}

/** Called after new-year registrations and opening finances, before that year's first fixture. */
export function prepareBoardSeason(state: SeasonState): SeasonState {
  if (!state.board.enabledSince || state.board.mandates.some(mandate => mandate.seasonNumber === state.seasonNumber)) return state;
  if (state.round !== 1 || state.status !== 'active' || state.fixtures.some(fixture => fixture.result)) throw new Error('Set the new board mandate before the opening matchday.');
  return { ...state, board: { ...state.board, mandates: [...state.board.mandates, buildBoardMandate(state, 1)] } };
}

/** Pure review builder: only committed results, original registrations and booked costs count. */
export function buildBoardReview(state: SeasonState, mandate: BoardMandate): BoardReview {
  if (mandate.seasonNumber !== state.seasonNumber || state.round < mandate.startsRound || state.date !== dateForRound(state.round, state.seasonNumber)) throw new Error('Review only an eligible committed matchday of this mandate.');
  const fixtures = state.fixtures.filter(fixture => fixture.round >= mandate.startsRound && fixture.round <= state.round);
  if (!fixtures.length || fixtures.some(fixture => !fixture.result)) throw new Error('Commit every fixture in the board review window first.');
  const clubs: Record<string, BoardClubReview> = {};
  for (const club of state.clubs) {
    const objective = mandate.clubs[club.id];
    if (!objective || !objective.games) throw new Error('Review a club with a communicated sporting objective.');
    const games = fixtures.filter(fixture => [fixture.homeClubId, fixture.awayClubId].includes(club.id));
    const played = games.length, wins = games.filter(fixture => fixture.result!.winnerClubId === club.id).length;
    const targetPace = objective.targetWins * played / objective.games;
    const difference = wins - targetPace;
    const sportingDelta = Math.sign(difference) * Math.max(0, Math.abs(difference) - BOARD_WIN_TOLERANCE);
    const resultsImpact = played < BOARD_SPORTING_GRACE_GAMES ? 0 : Math.round(clamp(sportingDelta * 10, -30, 30)) || 0;
    let carriedAbsences = 0, rosterPlaces = 0;
    for (const fixture of games) {
      const roster = rosterForRound(state.rosters, club.id, fixture.round);
      rosterPlaces += roster.players.length;
      carriedAbsences += roster.players.filter(player => fixture.result!.injuries[player.id] && state.injuries.some(injury => injury.playerId === player.id && injury.occurredOn < fixture.date && isRecovering(injury, fixture.date, state.physio))).length;
    }
    const injuryRelief = Math.max(0, Math.min(-Math.min(0, resultsImpact), Math.round(Math.min(6, rosterPlaces ? carriedAbsences / rosterPlaces * 30 : 0))));
    const unpaid = objective.startingUnpaid === null ? null : boardUnpaidCosts(state, club.id);
    const financeImpact = unpaid === null || objective.startingUnpaid === null ? 0 : Math.round(clamp((objective.startingUnpaid - unpaid) / 200_000, -25, 10)) || 0;
    const assessment = clamp(50 + resultsImpact + injuryRelief + financeImpact, 0, 100);
    const previousConfidence = state.board.reviews.at(-1)?.clubs[club.id]?.confidence ?? 50;
    const confidence = previousConfidence + clamp(assessment - previousConfidence, -BOARD_REVIEW_STEP, BOARD_REVIEW_STEP);
    clubs[club.id] = { fixtureIds: games.map(fixture => fixture.id), played, wins, targetPace: rounded(targetPace), carriedAbsences, rosterPlaces, unpaid, resultsImpact, injuryRelief, financeImpact, assessment, previousConfidence, confidence };
  }
  return { ...boardEventAnchor(state), id: `board-review-${state.board.reviews.length + 1}`, mandateId: mandate.id, clubs };
}

/** One automatic dated review follows each eligible complete league matchday. */
export function processBoardRound(state: SeasonState): SeasonState {
  if (!state.board.enabledSince) return state;
  const mandate = state.board.mandates.find(mandate => mandate.seasonNumber === state.seasonNumber);
  if (!mandate || state.round < mandate.startsRound || state.board.reviews.some(review => review.seasonNumber === state.seasonNumber && review.round === state.round)) return state;
  const review = buildBoardReview(state, mandate);
  return { ...state, board: { ...state.board, reviews: [...state.board.reviews, review] } };
}

export function boardConfidenceLabel(confidence: number): string {
  return confidence >= 65 ? 'Confident' : confidence >= 45 ? 'Steady' : confidence >= 30 ? 'Concerned' : 'Under pressure';
}

export function getBoardSummary(state: SeasonState, clubId = state.managedClubId): BoardSummary {
  if (!state.clubs.some(club => club.id === clubId)) throw new Error('Choose a club in this career.');
  const history = state.board.reviews.slice().reverse().map(review => ({ ...review, club: review.clubs[clubId]! }));
  const mandate = state.board.mandates.find(mandate => mandate.seasonNumber === state.seasonNumber) ?? null;
  const objective = mandate?.clubs[clubId] ?? null;
  const latest = history.find(review => review.mandateId === mandate?.id) ?? null;
  const confidence = history[0]?.club.confidence ?? 50;
  const nextFixture = mandate ? state.fixtures.find(fixture => fixture.round >= mandate.startsRound && !fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(clubId)) : undefined;
  let sportingStatus: BoardSummary['sportingStatus'] = 'waiting';
  if (latest && objective) {
    const result = latest.club;
    sportingStatus = result.played === objective.games ? result.wins >= objective.targetWins ? 'met' : 'missed' : result.played < BOARD_SPORTING_GRACE_GAMES ? 'building' : result.wins + BOARD_WIN_TOLERANCE >= result.targetPace ? 'on-track' : 'behind';
  }
  const financeStatus: BoardSummary['financeStatus'] = !objective || objective.startingUnpaid === null ? 'unassessed' : !latest ? 'waiting' : latest.club.unpaid !== null && latest.club.unpaid > objective.startingUnpaid ? 'behind' : 'on-track';
  return { enabled: state.board.enabledSince !== null, confidence, confidenceLabel: boardConfidenceLabel(confidence), mandate, objective, latest, history, nextReviewDate: nextFixture?.date ?? null, sportingStatus, financeStatus };
}

import { financeLedgerCount, financeLedgerEntries } from './finance-ledger';
import type { BoardAnchor, BoardClubReview, BoardMandate, BoardReview, BoardSummary, SeasonBoard } from '../domain/board';
import type { SeasonState } from '../domain/season';
import { getFinanceBalance } from './finance';
import { isRecovering } from './health';
import { rosterForRound } from './rosters';
import { dateForRound, isRegularFixture } from './season';
import { getTransferPaymentSummary } from './transfer-payments';
import { BOARD_VERDICT_EFFECTS, verdictForConfidence } from './board-consequences';
import { governingDerby, RIVALRY_BOARD_CAP, RIVALRY_BOARD_POINTS } from './rivalries';
import { roundKey, roundOrdinal, seasonRounds, worldOf, lastCommittedWeek } from './career-world';
import { seasonLeagues } from './divisions';
import { scaledMoney } from './economy';
import { boardMediaEvidence, type BoardMediaEvidence } from './media';
import { startingConfidence } from './career-rules';
import { boardDebtImpacts } from './facility-debt';

export const BOARD_REVIEW_STEP = 8;
export const BOARD_SPORTING_GRACE_GAMES = 3;
export const BOARD_WIN_TOLERANCE = 0.5;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
/** Matchdays as one sequence across seasons; stored in anchors and counted forward, so it uses the season length. */
const ordinal = (year: number, round: number, rounds: number) => roundOrdinal(year, round, rounds);
const rounded = (n: number) => Math.round(n * 1000) / 1000;
/** Explicit dependency boundary for historical objectives and reviews. */
export type BoardCalculationContext = Pick<SeasonState, 'world' | 'dataPackId' | 'rosters' | 'seasonNumber' | 'round' | 'date' | 'fixtures' | 'finance' | 'board' | 'injuries' | 'physio' | 'rivalries'> & {
  clubs: readonly Pick<SeasonState['clubs'][number], 'id'>[];
  employment: Pick<SeasonState['employment'], 'transfers'>;
  /** Format 67, careers with media: the board's media assessment of the manager's club at this review (`media.ts`). */
  pressMedia?: BoardMediaEvidence;
  /** Format 71, careers with facility financing: each club's debt effect at this review (nonzero only, `facility-debt.ts`). */
  debtImpacts?: Readonly<Record<string, number>>;
};

export function createBoard(): SeasonBoard { return { model: 'board-1', enabledSince: null, mandates: [], reviews: [], consequencesSince: null }; }

export function boardEventAnchor(state: Pick<BoardCalculationContext, 'world' | 'dataPackId' | 'fixtures' | 'seasonNumber' | 'round' | 'date' | 'finance' | 'rosters'>): BoardAnchor {
  const completed = lastCommittedWeek(state);
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, completedRounds: ordinal(state.seasonNumber, completed, seasonRounds(state)), ledgerCount: financeLedgerCount(state.finance), rosterCount: state.rosters.length };
}

/** Restrict transfer evidence to receipts in this ledger prefix, including same-day decisions. */
export function boardUnpaidCosts(state: Pick<BoardCalculationContext, 'finance' | 'employment' | 'date'>, clubId: string): number | null {
  let opened = false;
  const receipts = new Set<string>();
  for (const entry of financeLedgerEntries(state.finance)) {
    if (entry.clubId === clubId && entry.kind === 'opening') opened = true;
    if (entry.kind === 'transfer' && entry.amount < 0) receipts.add(entry.sourceId);
  }
  if (!opened) return null;
  const transfers = state.employment.transfers.filter(transfer => receipts.has(transfer.id)).map(transfer => ({ ...transfer, payments: transfer.payments.filter(payment => receipts.has(payment.id)) }));
  return getFinanceBalance(state.finance, clubId).unpaid + getTransferPaymentSummary({ date: state.date, employment: { ...state.employment, transfers } }, clubId).overdue;
}

/** The mandate uses immutable registration snapshots, never later skill growth or arrivals. */
export function buildBoardMandate<T extends BoardCalculationContext>(state: T, startsRound: number): BoardMandate {
  if (!Number.isInteger(startsRound) || startsRound < 1 || startsRound > seasonRounds(state) + 1) throw new Error('Choose an actual prospective board assessment window.');
  const resources = state.clubs.map(club => {
    const roster = rosterForRound(state.rosters, club.id, state.round);
    const top = roster.players.map(player => Object.values(player.attributes).reduce((sum, value) => sum + value, 0) / 7).sort((a, b) => b - a).slice(0, 8);
    return { clubId: club.id, rosterId: roster.id, strength: top.reduce((sum, value) => sum + value, 0) / 8 };
  });
  const legacyGames = Math.max(0, seasonRounds(state) + 1 - startsRound);
  return { ...boardEventAnchor(state), id: `board-mandate-${state.board.mandates.length + 1}`, startsRound, deadlineDate: dateForRound(seasonRounds(state), state.seasonNumber), clubs: Object.fromEntries(resources.map(resource => {
    const league = worldOf(state).domesticLeagues ? seasonLeagues(worldOf(state), (state as { divisions?: SeasonState['divisions'] }).divisions).find(league => league.clubIds.includes(resource.clubId)) : undefined;
    const rivals = league ? resources.filter(other => league.clubIds.includes(other.clubId)) : resources;
    const games = league ? state.fixtures.filter(fixture => isRegularFixture(fixture) && fixture.round >= startsRound && [fixture.homeClubId, fixture.awayClubId].includes(resource.clubId)).length : legacyGames;
    const resourceRank = 1 + rivals.filter(other => other.strength > resource.strength).length;
    const rate = resourceRank <= Math.ceil(rivals.length / 3) ? 0.6 : resourceRank <= Math.ceil(rivals.length * 2 / 3) ? 0.5 : 0.4;
    return [resource.clubId, { rosterId: resource.rosterId, resourceRank, targetWins: Math.ceil(games * rate), games, startingUnpaid: boardUnpaidCosts(state, resource.clubId) }];
  })) };
}

/** New-career initialization is separate from existing-career opt-in, which excludes today's match. */
export function enableBoard(state: SeasonState, mode: 'career' | 'prospective' = 'prospective'): SeasonState {
  if (state.board.enabledSince) return state;
  if (mode !== 'career' && mode !== 'prospective') throw new Error('Choose a supported board activation mode.');
  if (mode === 'career' && (state.seasonNumber !== 1 || state.round !== 1 || state.status !== 'active' || state.history.length || state.fixtures.some(fixture => fixture.result) || state.activeMatch && (state.activeMatch.status !== 'ready' || state.activeMatch.stepCount !== 0))) throw new Error('Initial board expectations must be set at the untouched first career opening.');
  const board: SeasonBoard = { ...createBoard(), enabledSince: { ...boardEventAnchor(state), includeCurrentRound: mode === 'career' } };
  const enabled = { ...state, board };
  if (mode === 'prospective' && state.round === seasonRounds(state)) return enabled;
  return { ...enabled, board: { ...board, mandates: [buildBoardMandate(enabled, mode === 'career' ? 1 : state.round + 1)] } };
}

/** Older careers opt in; the verdict at the end of the current season sets the following season's budgets. */
export function enableBoardConsequences(state: SeasonState): SeasonState {
  if (state.board.consequencesSince) return state;
  if (!state.board.enabledSince) throw new Error('Enable board reviews before board verdicts can affect budgets.');
  return { ...state, board: { ...state.board, consequencesSince: boardEventAnchor(state) } };
}

/** Called after new-year registrations and opening finances, before that year's first fixture. */
export function prepareBoardSeason(state: SeasonState): SeasonState {
  if (!state.board.enabledSince || state.board.mandates.some(mandate => mandate.seasonNumber === state.seasonNumber)) return state;
  if (state.round !== 1 || state.status !== 'active' || state.fixtures.some(fixture => fixture.result)) throw new Error('Set the new board mandate before the opening matchday.');
  return { ...state, board: { ...state.board, mandates: [...state.board.mandates, buildBoardMandate(state, 1)] } };
}

/** Pure review builder: only committed results, original registrations and booked costs count. */
export function buildBoardReview<T extends BoardCalculationContext>(state: T, mandate: BoardMandate): BoardReview {
  if (mandate.seasonNumber !== state.seasonNumber || state.round < mandate.startsRound || state.date !== dateForRound(state.round, state.seasonNumber)) throw new Error('Review only an eligible committed matchday of this mandate.');
  // Board targets are regular-season results: postseason games (step 3.4b) are not counted.
  const fixtures = state.fixtures.filter(fixture => isRegularFixture(fixture) && fixture.round >= mandate.startsRound && fixture.round <= state.round);
  if (!fixtures.length || fixtures.some(fixture => !fixture.result)) throw new Error('Commit every fixture in the board review window first.');
  const clubs: Record<string, BoardClubReview> = {};
  // Derbies count only once rivalries govern this review's matchday, so earlier reviews rebuild unchanged.
  const from = state.rivalries?.enabledSince?.effectiveFrom;
  const rivalriesCount = !!from && roundKey(state.seasonNumber, state.round) >= roundKey(from.seasonNumber, from.round);
  for (const club of state.clubs) {
    const objective = mandate.clubs[club.id];
    if (!objective) throw new Error('Review a club with a communicated sporting objective.');
    const games = fixtures.filter(fixture => [fixture.homeClubId, fixture.awayClubId].includes(club.id));
    const played = games.length, wins = games.filter(fixture => fixture.result!.winnerClubId === club.id).length;
    const targetPace = objective.games ? objective.targetWins * played / objective.games : 0;
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
    // One point per EUR 2,000 of unpaid costs cleared or added, at the club's money level (format 62).
    const financeImpact = unpaid === null || objective.startingUnpaid === null ? 0 : Math.round(clamp((objective.startingUnpaid - unpaid) / scaledMoney(state, club.id, 200_000, 100), -25, 10)) || 0;
    const derbies = rivalriesCount ? games.filter(fixture => governingDerby(state.rivalries, fixture.homeClubId, fixture.awayClubId, state.seasonNumber, fixture.round, worldOf(state))) : [];
    const derbyBalance = derbies.reduce((sum, fixture) => sum + (fixture.result!.winnerClubId === club.id ? 1 : -1), 0);
    const rivalryImpact = clamp(derbyBalance * RIVALRY_BOARD_POINTS, -RIVALRY_BOARD_CAP, RIVALRY_BOARD_CAP) || 0;
    const mediaImpact = state.pressMedia?.clubId === club.id ? state.pressMedia.impact : undefined;
    const debtImpact = state.debtImpacts?.[club.id] || undefined;
    const assessment = clamp(50 + resultsImpact + injuryRelief + financeImpact + rivalryImpact + (mediaImpact ?? 0) + (debtImpact ?? 0), 0, 100);
    // Format 63: a new coach's board starts from the fresh confidence recorded after the latest review.
    const previousConfidence = startingConfidence(state.board, club.id);
    const confidence = previousConfidence + clamp(assessment - previousConfidence, -BOARD_REVIEW_STEP, BOARD_REVIEW_STEP);
    clubs[club.id] = { fixtureIds: games.map(fixture => fixture.id), played, wins, targetPace: rounded(targetPace), carriedAbsences, rosterPlaces, unpaid, resultsImpact, injuryRelief, financeImpact, ...(rivalriesCount ? { rivalryImpact } : {}), ...(mediaImpact !== undefined ? { mediaImpact } : {}), ...(debtImpact !== undefined ? { debtImpact } : {}), assessment, previousConfidence, confidence };
  }
  // A review follows its week's commit, so that week counts as completed even when it had no game (format 57).
  return { ...boardEventAnchor(state), completedRounds: roundOrdinal(state.seasonNumber, state.round, seasonRounds(state)), id: `board-review-${state.board.reviews.length + 1}`, mandateId: mandate.id, clubs };
}

/** One automatic dated review follows each eligible complete league matchday. */
export function processBoardRound(state: SeasonState): SeasonState {
  if (!state.board.enabledSince) return state;
  const mandate = state.board.mandates.find(mandate => mandate.seasonNumber === state.seasonNumber);
  if (!mandate || state.round < mandate.startsRound || state.board.reviews.some(review => review.seasonNumber === state.seasonNumber && review.round === state.round)) return state;
  const pressMedia = boardMediaEvidence(state, state.seasonNumber, state.round, state.date);
  // Format 71: each club's debt at this review, in careers with facility financing.
  const debtImpacts = boardDebtImpacts(state);
  const review = buildBoardReview({ ...state, ...(pressMedia ? { pressMedia } : {}), ...(debtImpacts ? { debtImpacts } : {}) }, mandate);
  return { ...state, board: { ...state.board, reviews: [...state.board.reviews, review] } };
}

export function boardConfidenceLabel(confidence: number): string {
  return BOARD_VERDICT_EFFECTS[verdictForConfidence(confidence)].label;
}

export function getBoardSummary(state: SeasonState, clubId = state.managedClubId): BoardSummary {
  if (!state.clubs.some(club => club.id === clubId)) throw new Error('Choose a club in this career.');
  const history = state.board.reviews.slice().reverse().map(review => ({ ...review, club: review.clubs[clubId]! }));
  const mandate = state.board.mandates.find(mandate => mandate.seasonNumber === state.seasonNumber) ?? null;
  const objective = mandate?.clubs[clubId] ?? null;
  const latest = history.find(review => review.mandateId === mandate?.id) ?? null;
  const confidence = startingConfidence(state.board, clubId);
  const nextFixture = mandate ? state.fixtures.find(fixture => fixture.round >= mandate.startsRound && !fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(clubId)) : undefined;
  let sportingStatus: BoardSummary['sportingStatus'] = 'waiting';
  if (latest && objective) {
    const result = latest.club;
    sportingStatus = result.played === objective.games ? result.wins >= objective.targetWins ? 'met' : 'missed' : result.played < BOARD_SPORTING_GRACE_GAMES ? 'building' : result.wins + BOARD_WIN_TOLERANCE >= result.targetPace ? 'on-track' : 'behind';
  }
  const financeStatus: BoardSummary['financeStatus'] = !objective || objective.startingUnpaid === null ? 'unassessed' : !latest ? 'waiting' : latest.club.unpaid !== null && latest.club.unpaid > objective.startingUnpaid ? 'behind' : 'on-track';
  const restarts = (state.board.restarts ?? []).filter(restart => restart.clubId === clubId);
  return { enabled: state.board.enabledSince !== null, confidence, confidenceLabel: boardConfidenceLabel(confidence), mandate, objective, latest, history, nextReviewDate: nextFixture?.date ?? null, sportingStatus, financeStatus, restarts };
}

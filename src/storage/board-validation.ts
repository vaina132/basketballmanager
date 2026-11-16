import type { BoardAnchor, BoardMandate, BoardRestart, SeasonBoard } from '../domain/board';
import { usesCareerRules } from '../world/career-rules';
import type { SeasonFixture, SeasonState } from '../domain/season';
import { buildBoardMandate, buildBoardReview, createBoard, type BoardCalculationContext } from '../world/board';
import { boardMediaEvidence } from '../world/media';
import { validationReplayCache } from './replay-cache';
import { dateForRound } from '../world/season';
import { openingSponsorshipClubs } from '../world/commercial-policy';
import { fundingSourceId } from '../world/finance';
import { fullWorldClubsIn, roundOrdinal, seasonRounds } from '../world/career-world';
import { financeAtLedgerBoundary, financeLedgerCount, financeLedgerEntry, financeLedgerSlice } from '../world/finance-ledger';
import { boardDebtImpacts } from '../world/facility-debt';

const ANCHOR_KEYS = ['seasonNumber', 'round', 'date', 'completedRounds', 'ledgerCount', 'rosterCount'] as const;
/** Matchdays as one sequence across seasons, as stored in anchors; it uses the career's season length. */
const ordinal = (year: number, round: number, rounds: number) => roundOrdinal(year, round, rounds);
function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const fields = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !keys.includes(key))) fail(path, 'has missing or unsupported fields');
  return fields;
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(path, `must be an integer between ${min} and ${max}`);
  return value;
}
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.hasOwn(right, key) && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
function seasonRecords(state: SeasonState, year: number) {
  const source = year === state.seasonNumber ? state : state.history.find(archive => archive.seasonNumber === year);
  if (!source) fail('board', 'requires the original registered squads and fixtures');
  return source;
}

/** Board assessments see only registrations, cash and results that existed at their recorded boundary. */
function contextAt(state: SeasonState, anchor: BoardAnchor, board: SeasonBoard): BoardCalculationContext {
  const source = seasonRecords(state, anchor.seasonNumber), rosters = source.rosters.slice(0, anchor.rosterCount);
  const completed = anchor.completedRounds - ordinal(anchor.seasonNumber, 0, seasonRounds(state));
  const fixtures = source.fixtures.map(fixture => ({ ...fixture, result: fixture.round <= completed ? fixture.result : null })) as SeasonFixture[];
  const history = state.history.filter(archive => archive.seasonNumber < anchor.seasonNumber);
  const committed = new Set([...history.flatMap(archive => archive.fixtures), ...fixtures].filter(fixture => fixture.result).map(fixture => fixture.id));
  const finance = financeAtLedgerBoundary(state.finance, anchor.ledgerCount), ledger = finance.ledger;
  return {
    ...(state.world ? { world: state.world } : {}), dataPackId: state.dataPackId, seasonNumber: anchor.seasonNumber, round: anchor.round, date: anchor.date,
    // Format 72: that season's club money figures.
    ...(state.economySeasons ? { economySeasons: state.economySeasons } : {}),
    // That season's own divisions (step 3.4c).
    ...({ divisions: anchor.seasonNumber === state.seasonNumber ? state.divisions : state.history.find(archive => archive.seasonNumber === anchor.seasonNumber)?.divisions } as object),
    rosters, fixtures, board, employment: { transfers: state.employment.transfers }, physio: state.physio, rivalries: state.rivalries,
    // That season's own full-world clubs (step 3.4d-2).
    clubs: fullWorldClubsIn(state, anchor.seasonNumber).map(({ id }) => ({ id })),
    injuries: state.injuries.filter(injury => committed.has(injury.fixtureId)),
    finance: { ...finance, enabledSince: ledger.some(entry => entry.kind === 'opening') ? state.finance.enabledSince : null },
  };
}

/** The review follows mandatory costs and due fees, before later AI hires or offseason decisions. */
function reviewLedgerCount(state: SeasonState, year: number, round: number): number {
  const ledger = state.finance.ledger;
  let count = 0;
  for (const [index, entry] of ledger.entries()) {
    // Format 71: a scheduled loan or lease payment belongs to the matchday's mandatory costs.
    if (entry.seasonNumber < year || entry.seasonNumber === year && entry.round < round || entry.seasonNumber === year && entry.round === round && (['tickets', 'operations', 'facility-upkeep', 'payroll'].includes(entry.kind) || typeof entry.debt?.payment === 'number')) count = index + 1;
  }
  const initial = new Set(financeLedgerSlice(state.finance, 0, count).filter(entry => entry.kind === 'transfer').map(entry => entry.sourceId));
  const existingPayments = new Set(state.employment.transfers.filter(transfer => initial.has(transfer.id)).flatMap(transfer => transfer.payments.map(payment => payment.id)));
  while (count < financeLedgerCount({ ledger })) {
    const entry = financeLedgerEntry(state.finance, count)!;
    if (entry.seasonNumber !== year || entry.round !== round || entry.kind !== 'transfer' || !existingPayments.has(entry.sourceId)) break;
    count += 1;
  }
  return count;
}

/** Validate immutable objectives and every mandatory review by rebuilding them from retained evidence. */
export function validateBoard(state: SeasonState, version: number): void {
  if (version < 30) return;
  // Format 33 adds the anchor from which season verdicts set later budgets.
  const consequences = version >= 33;
  const { consequencesSince: _unused, ...legacyEmpty } = createBoard();
  const empty: SeasonBoard = consequences ? createBoard() : legacyEmpty;
  // Format 63: career-2 careers record each new coach's fresh start (checked against the career's decisions later).
  const fresh = version >= 63 && usesCareerRules(state.career);
  const fields = record(state.board, 'board', ['model', 'enabledSince', 'mandates', 'reviews', ...(consequences ? ['consequencesSince'] : []), ...(fresh ? ['restarts'] : [])]);
  if (fields.model !== 'board-1') fail('board.model', 'is unsupported');
  if (fresh && (!Array.isArray(fields.restarts) || fields.restarts.length > state.clubs.length * (seasonRounds(state) + 2) * state.seasonNumber + 1)) fail('board.restarts', 'must be a bounded list of fresh starts');
  const restarts = fresh ? fields.restarts as BoardRestart[] : undefined;
  if (!Array.isArray(fields.mandates) || fields.mandates.length > state.seasonNumber || !Array.isArray(fields.reviews) || fields.reviews.length > seasonRounds(state) * state.seasonNumber) fail('board', 'must retain bounded chronological objectives and reviews');
  if (fields.enabledSince === null) {
    if (fresh || !equal(fields, empty)) fail('board', 'must remain empty while disabled');
    return;
  }
  const completedNow = ordinal(state.seasonNumber, state.status === 'complete' ? state.round : state.round - 1, seasonRounds(state));
  const checkAnchor = (raw: unknown, path: string, kind: 'activation' | 'mandate' | 'review'): BoardAnchor => {
    const anchor = record(raw, path, ANCHOR_KEYS);
    const year = integer(anchor.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
    const round = integer(anchor.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : seasonRounds(state));
    const at = ordinal(year, round, seasonRounds(state)), completed = integer(anchor.completedRounds, `${path}.completedRounds`, 0, completedNow);
    if (kind === 'review' ? completed !== at : completed !== at - 1 && !(round === seasonRounds(state) && completed === at)) fail(path, 'must identify the actual committed result boundary');
    const source = seasonRecords(state, year), requiredRosters = source.rosters.filter(roster => roster.fromRound <= round);
    const rosterCount = integer(anchor.rosterCount, `${path}.rosterCount`, 0, source.rosters.length);
    if (rosterCount !== requiredRosters.length || !equal(source.rosters.slice(0, rosterCount), requiredRosters)) fail(path, 'must retain the exact registrations already applied at this matchday');
    const dates = new Set([dateForRound(round, year)]);
    if (kind !== 'review' && completed === at && round === seasonRounds(state)) for (const event of state.market.windows.find(window => window.seasonNumber === year)?.events ?? []) if (event.type === 'advance') dates.add(event.date);
    if (typeof anchor.date !== 'string' || !dates.has(anchor.date) || anchor.date > state.date) fail(`${path}.date`, 'must identify an actual calendar boundary');
    const ledgerCount = integer(anchor.ledgerCount, `${path}.ledgerCount`, 0, financeLedgerCount(state.finance));
    if (kind === 'review') {
      if (ledgerCount !== reviewLedgerCount(state, year, round)) fail(path, 'must review the complete mandatory payment boundary before later hiring and offseason choices');
    } else {
      // The career's opening funds (a club joining the full world later books `opening-s<season>`, step 3.4d-2).
      const openings = state.finance.ledger.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === 'opening' && entry.sourceId === 'opening');
      if (openings.some(({ index }) => index < ledgerCount)) {
        const funding = state.finance.ledger.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === 'opening' && entry.sourceId === 'opening' || entry.kind === 'sponsor' && entry.seasonNumber === openings[0]!.entry.seasonNumber);
        if (funding.some(({ index }) => index >= ledgerCount)) fail(path, 'cannot split the atomic opening cash and sponsorship registration');
      }
      for (const [index, entry] of state.finance.ledger.entries()) {
        const entryAt = ordinal(entry.seasonNumber, entry.round, seasonRounds(state));
        if (index < ledgerCount ? entryAt > at || entryAt === at && completed < at && ['tickets', 'operations', 'facility-upkeep'].includes(entry.kind) : entryAt < at) fail(path, 'must retain the chronological finance prefix without future results or payments');
      }
    }
    return anchor as unknown as BoardAnchor;
  };
  const activation = record(fields.enabledSince, 'board.enabledSince', [...ANCHOR_KEYS, 'includeCurrentRound']);
  if (typeof activation.includeCurrentRound !== 'boolean') fail('board.enabledSince.includeCurrentRound', 'must be boolean');
  const enabled = checkAnchor(Object.fromEntries(ANCHOR_KEYS.map(key => [key, activation[key]])), 'board.enabledSince', 'activation');
  if (activation.includeCurrentRound && (enabled.seasonNumber !== 1 || enabled.round !== 1 || enabled.completedRounds !== 0 || enabled.date !== dateForRound(1, 1))) fail('board.enabledSince', 'can include the current matchday only at initial career creation');
  const source = fields as unknown as SeasonBoard;
  let board: SeasonBoard = { ...empty, enabledSince: source.enabledSince };
  let mandateIndex = 0, reviewIndex = 0, previous = enabled;
  const chronological = (anchor: BoardAnchor, path: string) => {
    if (anchor.date < previous.date || anchor.completedRounds < previous.completedRounds || anchor.ledgerCount < previous.ledgerCount || ordinal(anchor.seasonNumber, anchor.round, seasonRounds(state)) < ordinal(previous.seasonNumber, previous.round, seasonRounds(state))) fail(path, 'must preserve chronological results and cash evidence');
    previous = anchor;
  };
  for (let year = enabled.seasonNumber; year <= state.seasonNumber; year += 1) {
    const first = year === enabled.seasonNumber;
    const startsRound = first ? enabled.round + Number(!activation.includeCurrentRound) : 1;
    if (startsRound > seasonRounds(state)) continue;
    const path = `board.mandates[${mandateIndex}]`;
    const raw = record(source.mandates[mandateIndex], path, [...ANCHOR_KEYS, 'id', 'startsRound', 'deadlineDate', 'clubs']);
    const anchor = checkAnchor(Object.fromEntries(ANCHOR_KEYS.map(key => [key, raw[key]])), path, 'mandate');
    if (first ? !equal(anchor, enabled) : anchor.seasonNumber !== year || anchor.round !== 1 || anchor.completedRounds !== ordinal(year, 0, seasonRounds(state)) || anchor.date !== dateForRound(1, year)) fail(path, 'must freeze the objective at activation or the next season opening');
    if (!first && state.finance.enabledSince && ordinal(state.finance.enabledSince.seasonNumber, state.finance.enabledSince.round, seasonRounds(state)) < ordinal(year, 1, seasonRounds(state))) {
      // Opening sponsorship: every club under the fixed model, only covered clubs under negotiated agreements.
      // Format 62: season funding (`funding-s<season>`) is sponsorship-kind income booked after the sponsors.
      const opening = state.finance.ledger.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.seasonNumber === year && entry.kind === 'sponsor' && entry.round === 1);
      const sponsorship = opening.filter(({ entry }) => entry.sourceId !== fundingSourceId(year));
      if (sponsorship.length !== openingSponsorshipClubs(state.commercial, fullWorldClubsIn(state, year), year).length || opening.some(({ index }) => index >= anchor.ledgerCount)) fail(path, 'must include the new-season funding before setting expectations');
    }
    chronological(anchor, path);
    let expected: BoardMandate;
    try { expected = validationReplayCache.calculate('board-mandate', { state: contextAt(state, anchor, board), startsRound }, input => buildBoardMandate(input.state, input.startsRound)); } catch (error) { fail(path, `cannot rebuild objectives: ${error instanceof Error ? error.message : 'invalid evidence'}`); }
    if (!equal(raw, expected)) fail(path, 'must retain the exact objective and resources frozen from its original registrations and payment prefix');
    board = { ...board, mandates: [...board.mandates, expected] }; mandateIndex += 1;
    const through = year === state.seasonNumber ? state.status === 'complete' ? seasonRounds(state) : state.round - 1 : seasonRounds(state);
    for (let round = startsRound; round <= through; round += 1) {
      const reviewPath = `board.reviews[${reviewIndex}]`;
      const reviewRaw = record(source.reviews[reviewIndex], reviewPath, [...ANCHOR_KEYS, 'id', 'mandateId', 'clubs']);
      const reviewAnchor = checkAnchor(Object.fromEntries(ANCHOR_KEYS.map(key => [key, reviewRaw[key]])), reviewPath, 'review');
      if (reviewAnchor.seasonNumber !== year || reviewAnchor.round !== round) fail(reviewPath, 'must retain one review after every eligible committed matchday');
      chronological(reviewAnchor, reviewPath);
      let review;
      // A new coach's fresh start recorded before this review is where its confidence moves from (format 63).
      if (restarts) board = { ...board, restarts: restarts.filter(restart => restart.reviewCount <= reviewIndex) };
      // Format 67, careers with media: the media assessment from results and press answers before this review.
      const pressMedia = boardMediaEvidence(state, reviewAnchor.seasonNumber, reviewAnchor.round, reviewAnchor.date);
      const context = contextAt(state, reviewAnchor, board);
      // Format 71: each club's debt at the review's own payment boundary.
      const debtImpacts = boardDebtImpacts({ ...context, facilities: state.facilities });
      try { review = validationReplayCache.calculate('board-review', { state: { ...context, ...(pressMedia ? { pressMedia } : {}), ...(debtImpacts ? { debtImpacts } : {}) }, mandate: expected }, input => buildBoardReview(input.state, input.mandate)); } catch (error) { fail(reviewPath, `cannot rebuild review: ${error instanceof Error ? error.message : 'invalid evidence'}`); }
      if (!equal(reviewRaw, review)) fail(reviewPath, 'must exactly reproduce results, inherited costs, injury context and bounded confidence');
      board = { ...board, reviews: [...board.reviews, review] }; reviewIndex += 1;
    }
  }
  if (consequences && fields.consequencesSince !== null) {
    const since = checkAnchor(fields.consequencesSince, 'board.consequencesSince', 'activation');
    if (since.date < enabled.date || since.completedRounds < enabled.completedRounds || since.ledgerCount < enabled.ledgerCount || ordinal(since.seasonNumber, since.round, seasonRounds(state)) < ordinal(enabled.seasonNumber, enabled.round, seasonRounds(state))) fail('board.consequencesSince', 'cannot precede board reviews');
    board = { ...board, consequencesSince: since };
  }
  if (restarts) board = { ...board, restarts };
  if (!equal(board, source)) fail('board', 'must retain exactly the complete objective and review history without added or missing records');
}

import type { BoardAnchor, BoardMandate, BoardRequest, BoardRestart, SeasonBoard } from '../domain/board';
import { usesCareerRules } from '../world/career-rules';
import type { SeasonFixture, SeasonState } from '../domain/season';
import { buildBoardMandate, buildBoardReview, createBoard, type BoardCalculationContext } from '../world/board';
import { boardMediaEvidence } from '../world/media';
import { validationReplayCache } from './replay-cache';
import { dateForRound } from '../world/season';
import { openingSponsorshipClubs } from '../world/commercial-policy';
import { fundingSourceId } from '../world/finance';
import { fullWorldClubsIn, roundKey, roundOrdinal, seasonRounds, worldOf } from '../world/career-world';
import { prefixPlan, recall, remember } from './trusted-prefix';
import { financeAtLedgerBoundary, financeLedgerCount, financeLedgerEntry, financeLedgerSlice } from '../world/finance-ledger';
import { boardDebtImpacts } from '../world/facility-debt';
import { PRESIDENT_RULES, presidentTraits, usesPresidentBoard } from '../world/presidents';
import { REQUEST_KINDS, requestDraw, requestStatus, type RequestState, type RequestTerms } from '../world/board-requests';
import { managedClubAtRound } from '../world/career';
import { maxTicketPriceFor, TICKET_PRICE_STEP } from '../world/finance';
import { SEALED_HISTORY_FORMAT, withoutCountedGames } from '../world/sealed-history';
import { isNationalFixtureId } from '../world/national';

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
/**
 * `opening`: a mandate frozen at a season opening or at activation. It comes before every move of its own week, so the
 * club managed then is the one before them (a resignation on the first day kept the opening's objectives).
 */
function contextAt(state: SeasonState, anchor: BoardAnchor, board: SeasonBoard, opening = false): BoardCalculationContext {
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
    // Format 80: national games' injuries recorded by then (their games come before the week's business).
    injuries: state.injuries.filter(injury => committed.has(injury.fixtureId) || isNationalFixtureId(injury.fixtureId) && injury.occurredOn <= anchor.date),
    finance: { ...finance, enabledSince: ledger.some(entry => entry.kind === 'opening') ? state.finance.enabledSince : null },
    // Format 70 (board-2): the academy, the previous season's squads, the managed club and the president's requests.
    // Step 3.7: the club managed at the anchor's own week (a season opening before a mid-season dismissal kept the club).
    ...(usesPresidentBoard(board) ? { academy: state.academy, history: history.filter(archive => archive.seasonNumber === anchor.seasonNumber - 1), managedClubId: managedClubAtRound(state, anchor.seasonNumber, opening ? anchor.round - 1 : anchor.round), boardRequests: (state.board.requests ?? []) as BoardRequest[] } : {}),
  };
}

const REQUEST_KEYS = ['id', 'clubId', 'kind', 'seasonNumber', 'round', 'date', 'deadlineRound', 'outcome', 'resolvedRound'] as const;
const REQUEST_TERMS: Readonly<Record<BoardRequest['kind'], readonly string[]>> = { 'raise-ticket-price': ['ticketPrice'], 'sign-player': ['position'], 'play-player': ['playerId', 'minutes'] };

/** Format 70 (board-2): shape checks of the president's requests; the review replay then rebuilds them (`replayRequests`). */
function validateBoardRequests(state: SeasonState, raw: unknown): BoardRequest[] {
  if (!Array.isArray(raw) || raw.length > PRESIDENT_RULES.requests.maxPerSeason * state.seasonNumber) fail('board.requests', 'must be a bounded list');
  const rules = PRESIDENT_RULES.requests, rounds = seasonRounds(state);
  const lastReview = state.board.reviews.at(-1);
  let previous = 0, open = 0;
  const perSeason = new Map<string, number>();
  for (const [index, value] of raw.entries()) {
    const path = `board.requests[${index}]`;
    const kind = (value as { kind?: unknown } | null)?.kind as BoardRequest['kind'];
    if (!REQUEST_KINDS.includes(kind)) fail(`${path}.kind`, 'is unsupported');
    const entry = record(value, path, [...REQUEST_KEYS, ...REQUEST_TERMS[kind]]);
    if (entry.id !== `board-request-${index + 1}`) fail(`${path}.id`, 'must use sequential request identities');
    const year = integer(entry.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
    const round = integer(entry.round, `${path}.round`, rules.firstRound, rounds - rules.deadlineWeeks);
    if (entry.date !== dateForRound(round, year) || entry.deadlineRound !== round + rules.deadlineWeeks) fail(path, 'must record its review date and deadline');
    // Step 3.7: a request belongs to the club managed at its own review, so one made before a mid-season dismissal or move
    // names the former club (the season's final club, or none while unemployed, refused a real career in season five).
    if (entry.clubId !== managedClubAtRound(state, year, round)) fail(`${path}.clubId`, 'must be the club the manager ran that season');
    const at = ordinal(year, round, rounds);
    if (at < previous) fail(path, 'must keep chronological order');
    previous = at;
    const key = `${year}`;
    perSeason.set(key, (perSeason.get(key) ?? 0) + 1);
    if (perSeason.get(key)! > rules.maxPerSeason) fail(path, 'exceeds the requests allowed in a season');
    if (kind === 'raise-ticket-price') { const price = integer(entry.ticketPrice, `${path}.ticketPrice`, TICKET_PRICE_STEP, maxTicketPriceFor(state, entry.clubId as string)); if (price % TICKET_PRICE_STEP) fail(`${path}.ticketPrice`, 'must be whole euros'); }
    if (kind === 'sign-player' && !['PG', 'SG', 'SF', 'PF', 'C'].includes(entry.position as string)) fail(`${path}.position`, 'is unsupported');
    if (kind === 'play-player' && (typeof entry.playerId !== 'string' || entry.minutes !== rules.playMinutes)) fail(path, 'must name a player and the minutes asked');
    const deadline = entry.deadlineRound as number;
    if (entry.outcome === 'open') {
      open += 1;
      const reviewedDeadline = year < state.seasonNumber || !!lastReview && lastReview.seasonNumber === year && lastReview.round >= deadline;
      if (entry.resolvedRound !== null || reviewedDeadline) fail(path, 'must be settled by its deadline review');
    } else if (!['met', 'ignored', 'withdrawn'].includes(entry.outcome as string)) fail(`${path}.outcome`, 'is unsupported');
    else {
      const resolved = integer(entry.resolvedRound, `${path}.resolvedRound`, round + 1, deadline);
      if (entry.outcome === 'ignored' && resolved !== deadline) fail(path, 'is ignored only at its deadline review');
      if (!state.board.reviews.some(review => review.seasonNumber === year && review.round === resolved)) fail(path, 'must be settled at a recorded review');
    }
  }
  if (open > 1) fail('board.requests', 'can hold one open request at a time');
  return raw as BoardRequest[];
}

/**
 * Format 70 (exact since 22 November 2026): the president's requests at one rebuilt review, as `processBoardRound` makes
 * them. Open requests are settled first (met, withdrawn, or ignored at the deadline), then the seeded draw may ask the
 * manager's club for something. Everything is rebuilt from registrations, results and injuries, except what reads the
 * ticket plan of that moment, which the save does not journal: a ticket request's price and outcome stay as recorded
 * (bounded by `validateBoardRequests`), and the kind draw may count a ticket request or not.
 */
function replayRequests(state: SeasonState, asked: BoardRequest[], recorded: readonly BoardRequest[], context: BoardCalculationContext, round: number, mandate: BoardMandate): BoardRequest[] {
  const year = context.seasonNumber, since = state.recruitment?.enabledSince;
  const recruitment = since && roundKey(since.seasonNumber, since.round) <= roundKey(year, round) ? state.recruitment : undefined;
  const view = (list: BoardRequest[]): RequestState => ({ ...context, board: { ...context.board, requests: list }, seed: state.seed, ...(recruitment ? { recruitment } : {}) }) as unknown as RequestState;
  const settled = asked.map((request): BoardRequest => {
    if (request.outcome !== 'open' || request.seasonNumber !== year || round <= request.round) return request;
    if (request.kind === 'raise-ticket-price') {
      const stored = recorded.find(item => item.id === request.id);
      if (stored?.outcome === 'withdrawn') fail(`board.requests[${recorded.indexOf(stored)}]`, 'cannot be withdrawn: only a request for minutes ends when its player leaves');
      return stored && stored.outcome !== 'open' && stored.resolvedRound === round ? { ...request, outcome: stored.outcome, resolvedRound: round } : request;
    }
    const status = requestStatus(view(asked), request);
    if (status) return { ...request, outcome: status, resolvedRound: round };
    return round >= request.deadlineRound ? { ...request, outcome: 'ignored', resolvedRound: round } : request;
  });
  const clubId = managedClubAtRound(state, year, round);
  if (!mandate.clubs[clubId]?.games) return settled;
  const draw = requestDraw(view(settled), clubId, presidentTraits(worldOf(state), clubId).interference);
  const stored = recorded.find(item => item.seasonNumber === year && item.round === round);
  const path = stored ? `board.requests[${recorded.indexOf(stored)}]` : 'board.requests';
  if (!draw) { if (stored) fail(path, 'must follow the president\'s seeded draw at its review'); return settled; }
  const pick = (candidates: readonly RequestTerms[]) => candidates.length ? candidates[draw.kindHash % candidates.length]! : null;
  // Without a ticket request (finances off, or the price already at its maximum), or with one in first place. Every
  // full-world club has a ticket plan while finances are on (the final state's plans may have dropped a club since).
  const options = [pick(draw.squad), context.finance.enabledSince ? pick([{ kind: 'raise-ticket-price' }, ...draw.squad]) : null];
  if (!stored) {
    if (draw.squad.length) fail(path, `must record the president's request at the review of week ${round} of season ${year}`);
    return settled;
  }
  const same = (option: RequestTerms | null) => !!option && option.kind === stored.kind && (option.kind === 'raise-ticket-price' || (option.kind === 'sign-player' ? option.position === stored.position : option.playerId === stored.playerId && option.minutes === stored.minutes));
  if (!options.some(same)) fail(path, 'must ask what the president\'s seeded draw picks at its review');
  const terms: RequestTerms = stored.kind === 'raise-ticket-price' ? { kind: stored.kind, ticketPrice: stored.ticketPrice! } : stored.kind === 'sign-player' ? { kind: stored.kind, position: stored.position! } : { kind: stored.kind, playerId: stored.playerId!, minutes: stored.minutes! };
  return [...settled, { id: `board-request-${settled.length + 1}`, clubId, ...terms, seasonNumber: year, round, date: context.date, deadlineRound: draw.deadlineRound, outcome: 'open', resolvedRound: null }];
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
  // Format 70: careers created with president personalities use board-2 and record the president's requests (format guard in season-storage).
  const presidents = (state.board as { model?: unknown } | null)?.model === PRESIDENT_RULES.model;
  const { consequencesSince: _unused, ...legacyEmpty } = createBoard();
  const empty: SeasonBoard = presidents ? createBoard(PRESIDENT_RULES.model) : consequences ? createBoard() : legacyEmpty;
  // Format 63: career-2 careers record each new coach's fresh start (checked against the career's decisions later).
  const fresh = version >= 63 && usesCareerRules(state.career);
  const fields = record(state.board, 'board', ['model', 'enabledSince', 'mandates', 'reviews', ...(consequences ? ['consequencesSince'] : []), ...(fresh ? ['restarts'] : []), ...(presidents ? ['requests'] : [])]);
  if (fields.model !== 'board-1' && !presidents) fail('board.model', 'is unsupported');
  if (presidents && fields.enabledSince === null) fail('board', 'president personalities require board reviews');
  if (fresh && (!Array.isArray(fields.restarts) || fields.restarts.length > state.clubs.length * (seasonRounds(state) + 2) * state.seasonNumber + 1)) fail('board.restarts', 'must be a bounded list of fresh starts');
  const restarts = fresh ? fields.restarts as BoardRestart[] : undefined;
  const requests = presidents ? validateBoardRequests(state, fields.requests) : undefined;
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
  if (requests && activation.includeCurrentRound !== true) fail('board', 'president personalities start at the career opening');
  let mandateIndex = 0, reviewIndex = 0, previous = enabled;
  const chronological = (anchor: BoardAnchor, path: string) => {
    if (anchor.date < previous.date || anchor.completedRounds < previous.completedRounds || anchor.ledgerCount < previous.ledgerCount || ordinal(anchor.seasonNumber, anchor.round, seasonRounds(state)) < ordinal(previous.seasonNumber, previous.round, seasonRounds(state))) fail(path, 'must preserve chronological results and cash evidence');
    previous = anchor;
  };
  // Format 73: games of sealed seasons keep no per-player minutes, which objectives assess. Objectives, reviews and
  // requests of those seasons are kept as recorded (shape and order checked). The latest completed season keeps every
  // game's minutes (`seniorSealedThrough`), so since 22 November 2026 it is rebuilt with the current season; the
  // incremental checkpoint check resumes in the current season and skips both.
  const replayFrom = version >= SEALED_HISTORY_FORMAT && state.seasonNumber >= 3 ? state.seasonNumber - 1 : 0;
  const recordedAnchor = (raw: Record<string, unknown>, path: string): BoardAnchor => {
    integer(raw.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber); integer(raw.round, `${path}.round`, 1, seasonRounds(state));
    integer(raw.completedRounds, `${path}.completedRounds`, 0, completedNow); integer(raw.ledgerCount, `${path}.ledgerCount`, 0, financeLedgerCount(state.finance)); integer(raw.rosterCount, `${path}.rosterCount`, 0, 100_000);
    if (typeof raw.date !== 'string') fail(`${path}.date`, 'must identify an actual calendar boundary');
    return Object.fromEntries(ANCHOR_KEYS.map(key => [key, raw[key]])) as unknown as BoardAnchor;
  };
  // Incremental checkpoint checks (`trusted-prefix.ts`): reviews of matchdays before the trusted checkpoint's latest one
  // are unchanged (the latest is still rewritten, format 73), so the current season's replay resumes where the trusted
  // check reached it, with its objective; later reviews are rebuilt from contexts of this state, as in a full check.
  const plan = version >= SEALED_HISTORY_FORMAT ? prefixPlan('board.reviews', source.reviews, review => roundKey(review.seasonNumber, review.round + 1)) : { skip: 0, record: -1 };
  interface Resume { board: SeasonBoard; mandateIndex: number; reviewIndex: number; previous: BoardAnchor; expected: BoardMandate; round: number; asked: BoardRequest[] }
  const saved = plan.skip > 0 ? recall<Resume>('board.reviews', 'replay') : undefined;
  const resume = saved && saved.reviewIndex === plan.skip ? saved : undefined;
  if (resume) ({ board, mandateIndex, reviewIndex, previous } = resume);
  // Format 70: the president's requests rebuilt so far (`replayRequests`); earlier seasons' as recorded.
  let asked: BoardRequest[] = resume?.asked ?? [];
  for (let year = resume ? state.seasonNumber : enabled.seasonNumber; year <= state.seasonNumber; year += 1) {
    const first = year === enabled.seasonNumber;
    const startsRound = first ? enabled.round + Number(!activation.includeCurrentRound) : 1;
    if (startsRound > seasonRounds(state)) continue;
    const resumed = resume && year === state.seasonNumber ? resume : undefined;
    let expected: BoardMandate;
    if (resumed) expected = resumed.expected;
    else {
    const path = `board.mandates[${mandateIndex}]`;
    const raw = record(source.mandates[mandateIndex], path, [...ANCHOR_KEYS, 'id', 'startsRound', 'deadlineDate', 'clubs']);
    if (year < replayFrom) {
      const anchor = recordedAnchor(raw, path);
      if (first ? !equal(anchor, enabled) : anchor.seasonNumber !== year || anchor.round !== 1 || raw.startsRound !== startsRound) fail(path, 'must freeze the objective at activation or the next season opening');
      chronological(anchor, path);
      board = { ...board, mandates: [...board.mandates, raw as unknown as BoardMandate] }; mandateIndex += 1;
      const reviews: SeasonBoard['reviews'] = [];
      for (let round = startsRound; round <= seasonRounds(state); round += 1) {
        const reviewPath = `board.reviews[${reviewIndex}]`;
        const reviewRaw = record(source.reviews[reviewIndex], reviewPath, [...ANCHOR_KEYS, 'id', 'mandateId', 'clubs']);
        const reviewAnchor = recordedAnchor(reviewRaw, reviewPath);
        if (reviewAnchor.seasonNumber !== year || reviewAnchor.round !== round || reviewRaw.mandateId !== raw.id || reviewRaw.id !== `board-review-${reviewIndex + 1}`) fail(reviewPath, 'must retain one review after every eligible committed matchday');
        chronological(reviewAnchor, reviewPath);
        reviews.push(reviewRaw as unknown as SeasonBoard['reviews'][number]); reviewIndex += 1;
      }
      board = { ...board, reviews: [...board.reviews, ...reviews] };
      continue;
    }
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
    try { expected = validationReplayCache.calculate('board-mandate', { state: contextAt(state, anchor, board, true), startsRound }, input => buildBoardMandate(input.state, input.startsRound)); } catch (error) { fail(path, `cannot rebuild objectives: ${error instanceof Error ? error.message : 'invalid evidence'}`); }
    if (!equal(raw, expected)) fail(path, 'must retain the exact objective and resources frozen from its original registrations and payment prefix');
    board = { ...board, mandates: [...board.mandates, expected] }; mandateIndex += 1;
    }
    const through = year === state.seasonNumber ? state.status === 'complete' ? seasonRounds(state) : state.round - 1 : seasonRounds(state);
    if (requests && !resumed) asked = requests.filter(request => request.seasonNumber < year);
    for (let round = resumed ? resumed.round : startsRound; round <= through; round += 1) {
      if (year === state.seasonNumber && reviewIndex === plan.record) remember('board.reviews', 'replay', { board, mandateIndex, reviewIndex, previous, expected, round, asked } satisfies Resume);
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
      // Format 73: only the latest review keeps each club's list of counted games (a full earlier review stays valid; the
      // rest of the review is compared exactly in any format).
      if (Object.values(reviewRaw.clubs as Record<string, object>).every(club => !Object.hasOwn(club, 'fixtureIds'))) review = withoutCountedGames([review])[0]!;
      if (!equal(reviewRaw, review)) fail(reviewPath, 'must exactly reproduce results, inherited costs, injury context and bounded confidence');
      board = { ...board, reviews: [...board.reviews, review] }; reviewIndex += 1;
      if (requests) asked = replayRequests(state, asked, requests, context, round, expected);
    }
    if (requests && !equal(asked.filter(request => request.seasonNumber === year), requests.filter(request => request.seasonNumber === year))) fail('board.requests', `must exactly match the requests rebuilt from the reviews of season ${year}`);
  }
  if (consequences && fields.consequencesSince !== null) {
    const since = checkAnchor(fields.consequencesSince, 'board.consequencesSince', 'activation');
    if (since.date < enabled.date || since.completedRounds < enabled.completedRounds || since.ledgerCount < enabled.ledgerCount || ordinal(since.seasonNumber, since.round, seasonRounds(state)) < ordinal(enabled.seasonNumber, enabled.round, seasonRounds(state))) fail('board.consequencesSince', 'cannot precede board reviews');
    board = { ...board, consequencesSince: since };
  }
  if (restarts) board = { ...board, restarts };
  if (requests) board = { ...board, requests };
  if (!equal(board, source)) fail('board', 'must retain exactly the complete objective and review history without added or missing records');
}

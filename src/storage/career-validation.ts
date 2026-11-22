import type { SeasonState } from '../domain/season';
import { dateForRound } from '../world/season';
import { jobMarketAt, jobOfferRefusal, midSeasonChanges, resignationOutlook, seasonEndOutlook, unemployedSeasonEndVacancies } from '../world/career-policy';
import { managedClubFor } from '../world/career';
import type { CareerMove, CareerMovePhase, SeasonCareer } from '../domain/career';
import type { BoardRestart } from '../domain/board';
import { isWorldClub, roundOrdinal, seasonRounds, worldOf } from '../world/career-world';
import type { WorldContext } from '../domain/world';
import { financeLedgerCount, financeLedgerEntry, financeLedgerSlice } from '../world/finance-ledger';
import { allowsUnemployment, CAREER_2_MODEL, CAREER_MODEL, CAREER_RULES, careerPointKey, NO_CLUB, usesCareerRules } from '../world/career-rules';

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
const PHASES: readonly CareerMovePhase[] = ['season', 'end', 'offseason'];
/** Format 63: the reasons each career-2 move point allows. */
const PHASE_REASONS: Readonly<Record<CareerMovePhase, readonly string[]>> = { season: ['dismissed', 'resigned'], end: ['dismissed', 'moved'], offseason: ['resigned'] };
/** Format 69: career-3 careers also record an unemployed manager's appointment, before a week's games or in an offseason. */
const PHASE_REASONS_3: Readonly<Record<CareerMovePhase, readonly string[]>> = { season: ['dismissed', 'resigned', 'appointed'], end: ['dismissed', 'moved'], offseason: ['resigned', 'appointed'] };

/**
 * Format 37: the opt-in anchor is a calendar boundary actually visited, and each move happens at the end of a governed
 * season, from the club managed then to the club managed now. Every other system reads the same moves through
 * `managedClubFor`, so their replays attribute each decision to the club the manager ran at that time. Format 63
 * `career-2` careers start with a new career and may also move before a week's games and in an offseason.
 */
export function validateCareer(value: unknown, state: Pick<SeasonState, 'seasonNumber' | 'round' | 'status' | 'date' | 'market' | 'managedClubId' | 'board' | 'finance'> & WorldContext, version: number): void {
  const fields = record(value, 'career', ['model', 'enabledSince', 'moves']);
  const rules = fields.model === CAREER_2_MODEL || fields.model === CAREER_MODEL;
  if (fields.model !== 'career-1' && !(fields.model === CAREER_2_MODEL && version >= 63) && !(fields.model === CAREER_MODEL && version >= 69)) fail('career.model', 'is unsupported');
  const rounds = seasonRounds(state);
  if (!Array.isArray(fields.moves) || fields.moves.length > (rules ? state.seasonNumber * (rounds + 8) : state.seasonNumber)) fail('career.moves', 'must be a bounded list of club changes');
  if (fields.enabledSince === null) {
    if (rules) fail('career.model', 'requires dismissal and job changes from the start of the career');
    if (fields.moves.length) fail('career.moves', 'cannot record club changes while dismissal and job changes are off');
    return;
  }
  if (!state.board.enabledSince) fail('career.enabledSince', 'requires board reviews');
  const path = 'career.enabledSince';
  const anchor = record(fields.enabledSince, path, ['seasonNumber', 'round', 'date', 'completedRounds', 'effectiveFrom']);
  const year = integer(anchor.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
  const round = integer(anchor.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : rounds);
  const at = ordinal(year, round, rounds), completedNow = ordinal(state.seasonNumber, state.status === 'complete' ? state.round : state.round - 1, rounds);
  const completed = integer(anchor.completedRounds, `${path}.completedRounds`, 0, completedNow);
  if (completed !== at - 1 && !(round === rounds && completed === at)) fail(path, 'must identify an actual pre-match or completed-season boundary');
  const dates = new Set([dateForRound(round, year)]);
  if (completed === at) for (const event of state.market.windows.find(window => window.seasonNumber === year)?.events ?? []) if (event.type === 'advance') dates.add(event.date);
  if (typeof anchor.date !== 'string' || !dates.has(anchor.date) || anchor.date > state.date) fail(`${path}.date`, 'must identify a calendar date actually visited');
  const career = year === 1 && round === 1 && completed === 0;
  const effectiveFrom = integer(anchor.effectiveFrom, `${path}.effectiveFrom`, 1, state.seasonNumber + 1);
  // Format 38 also accepts a later start: careers migrated from format 37 are judged only from their next season end.
  const expected = career ? 1 : year + 1;
  if (version >= 38 ? effectiveFrom < expected : effectiveFrom !== expected) fail(`${path}.effectiveFrom`, 'must start with a new career or the season after activation');
  if (rules && (!career || effectiveFrom !== 1)) fail('career.model', 'applies only to careers that start with dismissal and job changes');
  // The career's own world (the built-in league for careers without one), not always the built-in league.
  const world = worldOf(state);
  const ledger = state.finance.ledger;
  if (rules) { validateCareer2Moves(fields.moves, state, world, fields.model === CAREER_MODEL, version); return; }
  let previous: { seasonNumber: number; toClubId: string; ledgerCount: number } | null = null;
  for (const [index, raw] of fields.moves.entries()) {
    const location = `career.moves[${index}]`;
    const move = record(raw, location, ['seasonNumber', 'date', 'fromClubId', 'toClubId', 'reason', 'ledgerCount']);
    const season = integer(move.seasonNumber, `${location}.seasonNumber`, effectiveFrom, state.seasonNumber);
    if (season === state.seasonNumber && state.status !== 'complete') fail(location, 'must follow a completed season');
    if (previous && season <= previous.seasonNumber) fail(location, 'must be in chronological order, at most one per season');
    if (move.date !== dateForRound(rounds, season)) fail(`${location}.date`, 'must be the final matchday of that season');
    if (!isWorldClub(world, move.fromClubId) || !isWorldClub(world, move.toClubId) || move.fromClubId === move.toClubId) fail(location, 'must move between two different clubs in this league');
    if (previous && move.fromClubId !== previous.toClubId) fail(`${location}.fromClubId`, 'must be the club managed after the previous move');
    if (move.reason !== 'moved' && (move.reason !== 'dismissed' || version < 38)) fail(`${location}.reason`, 'must record a supported reason');
    // The move follows the committed final matchday (its tickets and operating costs) and precedes later seasons.
    const ledgerCount = integer(move.ledgerCount, `${location}.ledgerCount`, previous?.ledgerCount ?? 0, financeLedgerCount({ ledger }));
    const matchdayEnd = ledger.reduce((end, entry, position) => entry.seasonNumber === season && entry.round === rounds && (entry.kind === 'tickets' || entry.kind === 'operations') ? position + 1 : end, 0);
    if (ledgerCount < matchdayEnd || financeLedgerSlice(state.finance, 0, ledgerCount).some(entry => entry.seasonNumber > season) || (financeLedgerEntry(state.finance, ledgerCount)?.seasonNumber ?? season + 1) < season) fail(`${location}.ledgerCount`, 'must mark the ledger position at the end of that season\'s final matchday');
    previous = { seasonNumber: season, toClubId: move.toClubId, ledgerCount };
  }
  if (previous && previous.toClubId !== state.managedClubId) fail('career.moves', 'must end at the club managed now');
}

/**
 * Format 63 (basic checks, development mode): career-2 moves are chronological career points between world clubs.
 * Format 69 (career-3): a dismissal or resignation may lead to no club, and only an appointment leaves no club again.
 */
function validateCareer2Moves(moves: unknown[], state: Pick<SeasonState, 'seasonNumber' | 'round' | 'status' | 'date' | 'managedClubId' | 'finance'> & WorldContext, world: ReturnType<typeof worldOf>, unemployment: boolean, version: number): void {
  const rounds = seasonRounds(state);
  let previous: { key: number; date: string; toClubId: string; ledgerCount: number } | null = null;
  for (const [index, raw] of moves.entries()) {
    const location = `career.moves[${index}]`;
    // Format 72: an appointment from unemployment may record the club the manager last left.
    const former = unemployment && raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).reason === 'appointed' && Object.hasOwn(raw, 'formerClubId');
    const move = record(raw, location, ['seasonNumber', 'date', 'fromClubId', 'toClubId', 'reason', 'ledgerCount', 'round', 'phase', ...(former ? ['formerClubId'] : [])]);
    if (former && version < 72) fail(`${location}.formerClubId`, 'requires format 72 or later');
    if (former && (!previous || previous.toClubId !== NO_CLUB || move.formerClubId !== (moves[index - 1] as { fromClubId?: unknown }).fromClubId)) fail(`${location}.formerClubId`, 'must be the club the manager last left');
    const season = integer(move.seasonNumber, `${location}.seasonNumber`, 1, state.seasonNumber);
    if (!PHASES.includes(move.phase as CareerMovePhase)) fail(`${location}.phase`, 'must record when the move happened');
    const phase = move.phase as CareerMovePhase;
    const round = phase === 'season' ? integer(move.round, `${location}.round`, 1, season === state.seasonNumber ? state.round : rounds) : integer(move.round, `${location}.round`, rounds, rounds);
    if (phase !== 'season' && season === state.seasonNumber && state.status !== 'complete') fail(location, 'must follow a completed season');
    if (phase === 'season' && season === state.seasonNumber && state.status !== 'complete' && round > state.round) fail(location, 'cannot precede a week still to come');
    if (typeof move.date !== 'string' || (phase === 'offseason' ? move.date < dateForRound(rounds, season) : move.date !== dateForRound(round, season)) || move.date > state.date) fail(`${location}.date`, 'must be the calendar date of the move');
    if (!(unemployment ? PHASE_REASONS_3 : PHASE_REASONS)[phase].includes(move.reason as string)) fail(`${location}.reason`, 'must record a supported reason for that point of the season');
    if (move.reason === 'appointed') {
      if (move.fromClubId !== NO_CLUB || !isWorldClub(world, move.toClubId)) fail(location, 'must appoint a manager without a club to a club in this league');
    } else if (!isWorldClub(world, move.fromClubId) || !(isWorldClub(world, move.toClubId) || unemployment && move.toClubId === NO_CLUB && (move.reason === 'dismissed' || move.reason === 'resigned')) || move.fromClubId === move.toClubId) fail(location, 'must move between two different clubs in this league');
    const key = careerPointKey(season, round, phase);
    if (previous && (key < previous.key || key === previous.key && (phase !== 'offseason' || move.date <= previous.date))) fail(location, 'must be in chronological order, at most one per point of the season');
    if (previous && move.fromClubId !== previous.toClubId) fail(`${location}.fromClubId`, 'must be the club managed after the previous move');
    const ledgerCount = integer(move.ledgerCount, `${location}.ledgerCount`, previous?.ledgerCount ?? 0, financeLedgerCount(state.finance));
    previous = { key, date: move.date, toClubId: move.toClubId as string, ledgerCount };
  }
  if (previous && previous.toClubId !== state.managedClubId) fail('career.moves', 'must end at the club managed now');
  if (!previous && state.managedClubId === NO_CLUB) fail('career.moves', 'must record how the manager left the last club');
}

/**
 * After the board history is validated: every governed season end is rebuilt from its final reviews and table. A
 * dismissed manager must have moved to a club that offered its job; otherwise a move must accept an offer.
 */
export function validateCareerDecisions(state: SeasonState): void {
  const career = state.career as SeasonCareer | undefined;
  if (!career?.enabledSince) return;
  if (usesCareerRules(career)) { validateCareer2Decisions(state); return; }
  const lastEnded = state.status === 'complete' ? state.seasonNumber : state.seasonNumber - 1;
  for (let season = career.enabledSince.effectiveFrom; season <= lastEnded; season += 1) {
    const move = career.moves.find(item => item.seasonNumber === season), index = career.moves.indexOf(move!);
    const outlook = seasonEndOutlook(state, season), path = move ? `career.moves[${index}]` : 'career.moves';
    if (!outlook) { if (move) fail(path, 'must follow a season end with a final board review'); continue; }
    if (outlook.dismissed && !move) fail(path, `must record the club joined after the dismissal at the end of season ${season}`);
    if (!move) continue;
    if (move.reason !== (outlook.dismissed ? 'dismissed' : 'moved')) fail(`${path}.reason`, 'must match the board\'s season verdict');
    if (!outlook.offers.some(offer => offer.clubId === move.toClubId)) fail(`${path}.toClubId`, 'must accept a job offered at that season end');
  }
}

/**
 * Format 63: rebuild every board decision of a career-2 career in order (in-season reviews, season ends and the
 * manager's resignations) and require exactly the recorded moves and fresh board starts.
 */
function validateCareer2Decisions(state: SeasonState): void {
  const career = state.career, rounds = seasonRounds(state), reviews = state.board.reviews;
  const restarts = state.board.restarts;
  if (!Array.isArray(restarts)) fail('board.restarts', 'must record each new coach\'s fresh start');
  const lastEnded = state.status === 'complete' ? state.seasonNumber : state.seasonNumber - 1;
  type Point = { key: number; order: number; date: string; run: () => void };
  const points: Point[] = [];
  const expected: BoardRestart[] = [{ clubId: career.moves[0]?.fromClubId ?? state.managedClubId, seasonNumber: 1, round: 1, phase: 'season', date: career.enabledSince!.date, reviewCount: 0, confidence: CAREER_RULES.freshConfidence, coach: 'manager' }];
  const used = new Set<CareerMove>();
  const reviewsBefore = (seasonNumber: number, round: number, phase: CareerMovePhase) => reviews.filter(review => review.seasonNumber < seasonNumber || review.seasonNumber === seasonNumber && (phase !== 'season' || review.round < round)).length;
  const restart = (clubId: string, seasonNumber: number, round: number, phase: CareerMovePhase, date: string, coach: BoardRestart['coach']) => expected.push({ clubId, seasonNumber, round, phase, date, reviewCount: reviewsBefore(seasonNumber, round, phase), confidence: CAREER_RULES.freshConfidence, coach });
  const moveAt = (seasonNumber: number, round: number, phase: CareerMovePhase, reasons: readonly string[]) => career.moves.find(move => !used.has(move) && move.seasonNumber === seasonNumber && move.round === round && move.phase === phase && reasons.includes(move.reason));
  const pathOf = (move: CareerMove | undefined) => move ? `career.moves[${career.moves.indexOf(move)}]` : 'career.moves';
  for (const [index, review] of reviews.entries()) {
    if (review.round >= rounds) continue;
    const seasonNumber = review.seasonNumber, round = review.round + 1, date = dateForRound(round, seasonNumber);
    points.push({ key: careerPointKey(seasonNumber, round, 'season'), order: 0, date, run: () => {
      const changes = midSeasonChanges(state, index);
      if (!changes) return;
      const move = changes.outlook ? moveAt(seasonNumber, round, 'season', ['dismissed']) : undefined;
      if (changes.outlook && !move) fail('career.moves', `must record the club joined after the dismissal in week ${round - 1} of season ${seasonNumber}`);
      // Career-3: a dismissed manager may decline every offer (or have none) and leave without a club.
      if (move && !(move.toClubId === NO_CLUB && changes.outlook!.unemployment) && !changes.outlook!.offers.some(offer => offer.clubId === move.toClubId)) fail(`${pathOf(move)}.toClubId`, 'must accept a job offered after the dismissal');
      for (const clubId of changes.replaced) if (clubId !== move?.toClubId) restart(clubId, seasonNumber, round, 'season', date, 'ai');
      if (move) { used.add(move); restart(move.fromClubId, seasonNumber, round, 'season', date, 'ai'); if (move.toClubId !== NO_CLUB) restart(move.toClubId, seasonNumber, round, 'season', date, 'manager'); }
    } });
  }
  for (let seasonNumber = 1; seasonNumber <= lastEnded; seasonNumber += 1) {
    const date = dateForRound(rounds, seasonNumber);
    points.push({ key: careerPointKey(seasonNumber, rounds, 'end'), order: 0, date, run: () => {
      const outlook = seasonEndOutlook(state, seasonNumber), move = moveAt(seasonNumber, rounds, 'end', ['dismissed', 'moved']);
      if (!outlook) {
        if (move) fail(pathOf(move), 'must follow a season end with a final board review');
        // Career-3: a season ended without a club still sees every board Under pressure replace its coach.
        if (allowsUnemployment(career) && managedClubFor(state, seasonNumber, false) === NO_CLUB) for (const vacancy of unemployedSeasonEndVacancies(state, seasonNumber)) restart(vacancy.clubId, seasonNumber, rounds, 'end', date, 'ai');
        return;
      }
      if (outlook.dismissed && !move) fail('career.moves', `must record the club joined after the dismissal at the end of season ${seasonNumber}`);
      if (move && move.reason !== (outlook.dismissed ? 'dismissed' : 'moved')) fail(`${pathOf(move)}.reason`, 'must match the board\'s season verdict');
      if (move && !(move.toClubId === NO_CLUB && outlook.unemployment) && !outlook.offers.some(offer => offer.clubId === move.toClubId)) fail(`${pathOf(move)}.toClubId`, 'must accept a job offered at that season end');
      for (const vacancy of outlook.vacancies) if (vacancy.clubId !== move?.toClubId) restart(vacancy.clubId, seasonNumber, rounds, 'end', date, 'ai');
      if (move) { used.add(move); restart(move.fromClubId, seasonNumber, rounds, 'end', date, 'ai'); if (move.toClubId !== NO_CLUB) restart(move.toClubId, seasonNumber, rounds, 'end', date, 'manager'); }
    } });
  }
  // Since 22 November 2026 a resignation must take a job offered at that point (or, career-3, no job), rebuilt from the
  // reviews, fresh starts, tables and moves before it (`resignationOutlook`).
  for (const [index, move] of career.moves.entries()) if (move.reason === 'resigned') points.push({ key: careerPointKey(move.seasonNumber, move.round!, move.phase!), order: 1, date: move.date, run: () => {
    used.add(move);
    if (jobOfferRefusal(resignationOutlook(resignationView(state, career.moves.slice(0, index), move, [...expected])), move.toClubId)) fail(`${pathOf(move)}.toClubId`, 'must take a job offered to the resigning manager at that point, or none where the career allows it');
    restart(move.fromClubId, move.seasonNumber, move.round!, move.phase!, move.date, 'ai');
    if (move.toClubId !== NO_CLUB) restart(move.toClubId, move.seasonNumber, move.round!, move.phase!, move.date, 'manager');
  } });
  // Career-3 (format 69): an unemployed manager's appointment takes a job open at that point, rebuilt from the evidence.
  for (const [index, move] of career.moves.entries()) if (move.reason === 'appointed') points.push({ key: careerPointKey(move.seasonNumber, move.round!, move.phase!), order: 1, date: move.date, run: () => {
    used.add(move);
    const prior = career.moves.slice(0, index);
    if (prior.at(-1)?.toClubId !== NO_CLUB || move.phase === 'end') fail(pathOf(move), 'must follow a period without a club');
    const market = jobMarketAt(state, prior, { seasonNumber: move.seasonNumber, round: move.round!, phase: move.phase as 'season' | 'offseason', date: move.date });
    if (!market.vacancies.some(vacancy => vacancy.clubId === move.toClubId && vacancy.offered)) fail(`${pathOf(move)}.toClubId`, 'must take a job open to the manager at that point');
    restart(move.toClubId, move.seasonNumber, move.round!, move.phase!, move.date, 'manager');
  } });
  points.sort((a, b) => a.key - b.key || a.order - b.order || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const point of points) point.run();
  const unexplained = career.moves.find(move => !used.has(move));
  if (unexplained) fail(pathOf(unexplained), 'must follow a board decision or a resignation');
  if (restarts.length !== expected.length) fail('board.restarts', 'must record exactly one fresh start for each new coach');
  for (const [index, item] of expected.entries()) {
    const actual = record(restarts[index], `board.restarts[${index}]`, ['clubId', 'seasonNumber', 'round', 'phase', 'date', 'reviewCount', 'confidence', 'coach']);
    if ((Object.keys(item) as (keyof BoardRestart)[]).some(key => actual[key] !== item[key])) fail(`board.restarts[${index}]`, 'must match the coach change at that point of the career');
  }
}

/**
 * The career as it stood when the manager resigned: that season's games with only the results recorded before the move
 * (all of them in the offseason), the board reviews and fresh starts made before it, the earlier moves, and the club the
 * manager left. `resignationOutlook` reads it as it read the live state.
 */
function resignationView(state: SeasonState, prior: CareerMove[], move: CareerMove, restarts: BoardRestart[]): SeasonState {
  const seasonNumber = move.seasonNumber, inSeason = move.phase === 'season', round = move.round!;
  const archive = seasonNumber === state.seasonNumber ? undefined : state.history.find(item => item.seasonNumber === seasonNumber);
  const games = (archive ? archive.fixtures : state.fixtures) as SeasonState['fixtures'];
  const fixtures = games.map(fixture => inSeason && fixture.round >= round ? { ...fixture, result: null } : fixture);
  const reviews = state.board.reviews.filter(review => review.seasonNumber < seasonNumber || review.seasonNumber === seasonNumber && (!inSeason || review.round < round));
  return {
    ...state, seasonNumber, round: inSeason ? round : seasonRounds(state), status: inSeason ? 'active' : 'complete', date: move.date, managedClubId: move.fromClubId, activeMatch: null, fixtures,
    divisions: archive ? archive.divisions : state.divisions, history: state.history.filter(item => item.seasonNumber < seasonNumber),
    board: { ...state.board, reviews, restarts }, career: { ...state.career, moves: prior },
  } as SeasonState;
}

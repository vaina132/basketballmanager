import type { SeasonState } from '../domain/season';
import { dateForRound } from '../world/season';
import { seasonEndOutlook } from '../world/career-policy';
import type { SeasonCareer } from '../domain/career';
import { isWorldClub, roundOrdinal, seasonRounds, worldOf } from '../world/career-world';
import type { WorldContext } from '../domain/world';
import { financeLedgerCount, financeLedgerEntry, financeLedgerSlice } from '../world/finance-ledger';

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

/**
 * Format 37: the opt-in anchor is a calendar boundary actually visited, and each move happens at the end of a governed
 * season, from the club managed then to the club managed now. Every other system reads the same moves through
 * `managedClubFor`, so their replays attribute each decision to the club the manager ran at that time.
 */
export function validateCareer(value: unknown, state: Pick<SeasonState, 'seasonNumber' | 'round' | 'status' | 'date' | 'market' | 'managedClubId' | 'board' | 'finance'> & WorldContext, version: number): void {
  const fields = record(value, 'career', ['model', 'enabledSince', 'moves']);
  if (fields.model !== 'career-1') fail('career.model', 'is unsupported');
  if (!Array.isArray(fields.moves) || fields.moves.length > state.seasonNumber) fail('career.moves', 'must be a bounded list of club changes');
  if (fields.enabledSince === null) {
    if (fields.moves.length) fail('career.moves', 'cannot record club changes while dismissal and job changes are off');
    return;
  }
  if (!state.board.enabledSince) fail('career.enabledSince', 'requires board reviews');
  const path = 'career.enabledSince';
  const anchor = record(fields.enabledSince, path, ['seasonNumber', 'round', 'date', 'completedRounds', 'effectiveFrom']);
  const year = integer(anchor.seasonNumber, `${path}.seasonNumber`, 1, state.seasonNumber);
  const round = integer(anchor.round, `${path}.round`, 1, year === state.seasonNumber ? state.round : seasonRounds(state));
  const at = ordinal(year, round, seasonRounds(state)), completedNow = ordinal(state.seasonNumber, state.status === 'complete' ? state.round : state.round - 1, seasonRounds(state));
  const completed = integer(anchor.completedRounds, `${path}.completedRounds`, 0, completedNow);
  if (completed !== at - 1 && !(round === seasonRounds(state) && completed === at)) fail(path, 'must identify an actual pre-match or completed-season boundary');
  const dates = new Set([dateForRound(round, year)]);
  if (completed === at) for (const event of state.market.windows.find(window => window.seasonNumber === year)?.events ?? []) if (event.type === 'advance') dates.add(event.date);
  if (typeof anchor.date !== 'string' || !dates.has(anchor.date) || anchor.date > state.date) fail(`${path}.date`, 'must identify a calendar date actually visited');
  const career = year === 1 && round === 1 && completed === 0;
  const effectiveFrom = integer(anchor.effectiveFrom, `${path}.effectiveFrom`, 1, state.seasonNumber + 1);
  // Format 38 also accepts a later start: careers migrated from format 37 are judged only from their next season end.
  const expected = career ? 1 : year + 1;
  if (version >= 38 ? effectiveFrom < expected : effectiveFrom !== expected) fail(`${path}.effectiveFrom`, 'must start with a new career or the season after activation');
  // The career's own world (the built-in league for careers without one), not always the built-in league.
  const world = worldOf(state);
  const ledger = state.finance.ledger;
  let previous: { seasonNumber: number; toClubId: string; ledgerCount: number } | null = null;
  for (const [index, raw] of fields.moves.entries()) {
    const location = `career.moves[${index}]`;
    const move = record(raw, location, ['seasonNumber', 'date', 'fromClubId', 'toClubId', 'reason', 'ledgerCount']);
    const season = integer(move.seasonNumber, `${location}.seasonNumber`, effectiveFrom, state.seasonNumber);
    if (season === state.seasonNumber && state.status !== 'complete') fail(location, 'must follow a completed season');
    if (previous && season <= previous.seasonNumber) fail(location, 'must be in chronological order, at most one per season');
    if (move.date !== dateForRound(seasonRounds(state), season)) fail(`${location}.date`, 'must be the final matchday of that season');
    if (!isWorldClub(world, move.fromClubId) || !isWorldClub(world, move.toClubId) || move.fromClubId === move.toClubId) fail(location, 'must move between two different clubs in this league');
    if (previous && move.fromClubId !== previous.toClubId) fail(`${location}.fromClubId`, 'must be the club managed after the previous move');
    if (move.reason !== 'moved' && (move.reason !== 'dismissed' || version < 38)) fail(`${location}.reason`, 'must record a supported reason');
    // The move follows the committed final matchday (its tickets and operating costs) and precedes later seasons.
    const ledgerCount = integer(move.ledgerCount, `${location}.ledgerCount`, previous?.ledgerCount ?? 0, financeLedgerCount({ ledger }));
    const matchdayEnd = ledger.reduce((end, entry, position) => entry.seasonNumber === season && entry.round === seasonRounds(state) && (entry.kind === 'tickets' || entry.kind === 'operations') ? position + 1 : end, 0);
    if (ledgerCount < matchdayEnd || financeLedgerSlice(state.finance, 0, ledgerCount).some(entry => entry.seasonNumber > season) || (financeLedgerEntry(state.finance, ledgerCount)?.seasonNumber ?? season + 1) < season) fail(`${location}.ledgerCount`, 'must mark the ledger position at the end of that season\'s final matchday');
    previous = { seasonNumber: season, toClubId: move.toClubId, ledgerCount };
  }
  if (previous && previous.toClubId !== state.managedClubId) fail('career.moves', 'must end at the club managed now');
}

/**
 * After the board history is validated: every governed season end is rebuilt from its final reviews and table. A
 * dismissed manager must have moved to a club that offered its job; otherwise a move must accept an offer.
 */
export function validateCareerDecisions(state: SeasonState): void {
  const career = state.career as SeasonCareer | undefined;
  if (!career?.enabledSince) return;
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

import type { FinanceArchiveBlock, FinanceArchiveRow, FinanceEntry } from '../domain/finance';
import { dateForRound } from '../world/season';
import { TRAINING_ATTRIBUTES, TRAINING_FOCUSES } from '../world/training';

/**
 * Format 73 (step 3.7, save size): a lossless packing of the bulkiest records, used only inside compact save files.
 *
 * A three-league world books about 12,500 transactions, 17,000 scouting reports, 1,500 injuries and rehabilitation
 * weeks and 24,000 academy reports a season. Much of their text repeats what the rest of the record already says, so
 * the file leaves it out and reading the file puts it back:
 * - finance: a source identity that follows from the transaction (`operations-s2-r5`, `facility-upkeep-s2-r5`,
 *   `payroll-s2-r5`, `prepay-<agreement>`, `tickets-<fixture>`) is written as `0`; a wage line
 *   `{ agreementId: 'wage-s<season>-<player>', playerId, gross, discount, amount: gross - discount }` as
 *   `[playerId, gross(, discount)]`; an archived transaction without details drops its empty `{}`; an active
 *   transaction becomes `[clubId, seasonNumber, round, kind, amount, sourceId, details]` (its identity
 *   `finance-<position + 1>` and empty ticket, coach and payroll fields follow from the rest);
 * - a scouting report becomes `[playerId, season, round, clubId, rosterFromRound, observed, attributes, observer?]`
 *   (its date is the matchday's Saturday, its roster `roster-s<season>-<club>-r<fromRound>`);
 * - an injury drops its identity `<fixture>:<player>`; a rehabilitation week becomes an array without its identity
 *   `rehab-<position + 1>`, its matchday dates, its roster identity and its credit after;
 * - a youth fixture's identity `youth-s<season>-r<round>-<senior fixture>` keeps only the senior fixture, and its
 *   diagnoses drop what the fixture says (identity, fixture, date);
 * - an academy outcome report becomes `[focus, ...points]` when its club is the prospect's;
 * - a game's player statistics (senior and youth box scores) and a summarized game's appearances, maps keyed by player,
 *   become one flat list `[playerId, ...values, playerId, ...values]` in the usual field order.
 * Packing happens only where unpacking gives back exactly the same text (same values, same key order); any other
 * record is written as it is. The game, its checks and plain (`serializeSeason`) files never see the packed form.
 */
export const SAVE_PACKING = 'save-pack-1';
export const PACKED_SAVE_FORMAT = 73;

type PackedItem = [playerId: string, gross: number] | [playerId: string, gross: number, discount: number];
type Details = Record<string, unknown>;
export type PackedArchiveRow = [string, number, FinanceEntry['kind'], number, string | 0] | [string, number, FinanceEntry['kind'], number, string | 0, Details];
export type PackedLedgerEntry = [string, number, number, FinanceEntry['kind'], number, string | 0, Details];
export interface PackedArchiveBlock extends Omit<FinanceArchiveBlock, 'rows'> { rows: PackedArchiveRow[] }

function fail(reason: string): never { throw new Error(`Invalid season save: packing ${reason}.`); }
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const wageAgreementId = (season: number, playerId: string) => `wage-s${season}-${playerId}`;

function packPayroll(payroll: unknown, season: number): unknown {
  if (!isObject(payroll) || !Array.isArray(payroll.items)) return payroll;
  let packed = false;
  const items = payroll.items.map(item => {
    if (!isObject(item) || typeof item.playerId !== 'string' || typeof item.gross !== 'number' || typeof item.discount !== 'number') return item;
    const line: PackedItem = item.discount === 0 ? [item.playerId, item.gross] : [item.playerId, item.gross, item.discount];
    if (JSON.stringify(unpackItem(line, season)) !== JSON.stringify(item)) return item;
    packed = true;
    return line;
  });
  return packed ? { ...payroll, items } : payroll;
}

function unpackItem(line: unknown[], season: number): Record<string, unknown> {
  const [playerId, gross, discount = 0] = line;
  if (line.length < 2 || line.length > 3 || typeof playerId !== 'string' || !Number.isSafeInteger(gross) || !Number.isSafeInteger(discount)) fail('has an invalid wage line');
  return { agreementId: wageAgreementId(season, playerId as string), playerId, gross, discount, amount: (gross as number) - (discount as number) };
}

function unpackPayroll(payroll: unknown, season: number): unknown {
  if (!isObject(payroll) || !Array.isArray(payroll.items) || !payroll.items.some(Array.isArray)) return payroll;
  return { ...payroll, items: payroll.items.map(item => Array.isArray(item) ? unpackItem(item, season) : item) };
}

function packDetails(details: Details, season: number): Details {
  return Object.hasOwn(details, 'payroll') ? { ...details, payroll: packPayroll(details.payroll, season) } : details;
}

function unpackDetails(details: Details, season: number): Details {
  return Object.hasOwn(details, 'payroll') ? { ...details, payroll: unpackPayroll(details.payroll, season) } : details;
}

/** The source identity a transaction's own fields imply, if any (on unpacked details). */
function impliedSourceId(kind: unknown, season: number, round: unknown, details: Details): string | undefined {
  if (kind === 'operations' || kind === 'facility-upkeep') return `${kind}-s${season}-r${round}`;
  if (kind === 'tickets') { const ticket = details.ticket; return isObject(ticket) && typeof ticket.fixtureId === 'string' ? `tickets-${ticket.fixtureId}` : undefined; }
  if (kind === 'payroll' && isObject(details.payroll)) {
    const payroll = details.payroll, items = Array.isArray(payroll.items) ? payroll.items : [];
    if (payroll.type === 'installment') return `payroll-s${season}-r${round}`;
    if (payroll.type === 'prepayment' && items.length === 1 && isObject(items[0]) && typeof items[0].agreementId === 'string') return `prepay-${items[0].agreementId}`;
  }
  return undefined;
}

// Archived blocks never change once written: each is packed once.
const packedBlocks = new WeakMap<FinanceArchiveBlock, PackedArchiveBlock>();

function packArchiveRow(row: FinanceArchiveRow, season: number): PackedArchiveRow | FinanceArchiveRow {
  const [clubId, round, kind, amount, sourceId, details] = row;
  if (row.length !== 6 || !isObject(details)) return row;
  const source = impliedSourceId(kind, season, round, details) === sourceId ? 0 : sourceId;
  const packedDetails = packDetails(details, season);
  const packed: PackedArchiveRow = Object.keys(packedDetails).length ? [clubId, round, kind, amount, source, packedDetails] : [clubId, round, kind, amount, source];
  return JSON.stringify(unpackArchiveRow(packed, season)) === JSON.stringify(row) ? packed : row;
}

function unpackArchiveRow(packed: unknown, season: number): FinanceArchiveRow {
  if (!Array.isArray(packed) || packed.length < 5 || packed.length > 6) fail('has an invalid archived transaction');
  const [clubId, round, kind, amount, source, packedDetails = {}] = packed;
  if (!isObject(packedDetails)) fail('has invalid transaction details');
  // A transaction that could not be packed is stored whole: its source identity is a text and its details unpacked.
  const details = unpackDetails(packedDetails, season);
  const sourceId = source === 0 ? impliedSourceId(kind, season, round, details) ?? fail('cannot restore a transaction source') : source;
  return [clubId, round, kind, amount, sourceId, details] as FinanceArchiveRow;
}

function packBlock(block: FinanceArchiveBlock): PackedArchiveBlock {
  let packed = packedBlocks.get(block);
  if (!packed) {
    packed = { ...block, rows: block.rows.map(row => packArchiveRow(row, block.seasonNumber) as PackedArchiveRow) };
    packedBlocks.set(block, packed);
  }
  return packed;
}

const NULL_PAYLOADS = ['ticket', 'coach', 'payroll'] as const;

// Transactions never change once booked either; a weekly checkpoint packs only the week's new ones.
const packedEntries = new WeakMap<FinanceEntry, PackedLedgerEntry | FinanceEntry>();

function packLedgerEntry(entry: FinanceEntry, position: number): PackedLedgerEntry | FinanceEntry {
  if (!isObject(entry) || typeof entry.seasonNumber !== 'number' || entry.id !== `finance-${position + 1}`) return entry;
  let packed = packedEntries.get(entry);
  if (!packed) { packed = packNewLedgerEntry(entry, position); packedEntries.set(entry, packed); }
  return packed;
}

function packNewLedgerEntry(entry: FinanceEntry, position: number): PackedLedgerEntry | FinanceEntry {
  const { id: _id, clubId, seasonNumber, round, kind, amount, sourceId, ...rest } = entry;
  const details: Details = {};
  for (const [key, value] of Object.entries(rest)) if (!(NULL_PAYLOADS as readonly string[]).includes(key) || value !== null) details[key] = value;
  const source = impliedSourceId(kind, seasonNumber, round, details) === sourceId ? 0 : sourceId;
  const packed: PackedLedgerEntry = [clubId, seasonNumber, round, kind, amount, source, packDetails(details, seasonNumber)];
  return JSON.stringify(unpackLedgerEntry(packed, position)) === JSON.stringify(entry) ? packed : entry;
}

/** Live transactions are written `{ clubId, kind, amount, sourceId, seasonNumber, round, ticket, coach, payroll, ...details, id }`. */
function unpackLedgerEntry(packed: unknown, position: number): FinanceEntry {
  if (!Array.isArray(packed)) return packed as FinanceEntry;
  if (packed.length !== 7) fail('has an invalid transaction');
  const [clubId, seasonNumber, round, kind, amount, source, packedDetails] = packed;
  if (!Number.isSafeInteger(seasonNumber) || !isObject(packedDetails)) fail('has an invalid transaction');
  const details = unpackDetails(packedDetails, seasonNumber as number);
  const sourceId = source === 0 ? impliedSourceId(kind, seasonNumber as number, round, details) ?? fail('cannot restore a transaction source') : source;
  const { ticket = null, coach = null, payroll = null, ...others } = details;
  return { clubId, kind, amount, sourceId, seasonNumber, round, ticket, coach, payroll, ...others, id: `finance-${position + 1}` } as FinanceEntry;
}

// ---- Records other than the ledger ----

type Json = Record<string, unknown>;
const text = (value: unknown) => JSON.stringify(value);
/** The packed form only when unpacking restores exactly the same text; otherwise the record as it is. */
function exact(item: unknown, pack: () => unknown, unpack: (packed: unknown) => unknown): unknown {
  try { const packed = pack(); return packed !== undefined && text(unpack(packed)) === text(item) ? packed : item; } catch { return item; }
}
function matchday(round: unknown, season: unknown): string {
  try { return dateForRound(round as number, season as number); } catch { return fail('has an invalid matchday'); }
}
/** The `fromRound` of a roster identity `roster-s<season>-<club>-r<fromRound>`, if it has that form. */
function rosterRound(rosterId: unknown, season: unknown, clubId: unknown): number | undefined {
  const prefix = `roster-s${season}-${clubId}-r`;
  if (typeof rosterId !== 'string' || !rosterId.startsWith(prefix)) return undefined;
  const round = Number(rosterId.slice(prefix.length));
  return Number.isSafeInteger(round) && rosterId === `${prefix}${round}` ? round : undefined;
}
const mapArray = (value: unknown, map: (item: unknown, index: number) => unknown) => Array.isArray(value) ? value.map(map) : value;

function packReview(review: unknown): unknown {
  if (!isObject(review)) return review;
  return exact(review, () => {
    const { playerId, seasonNumber, round, clubId, rosterId, outcome, attributes, observer } = review;
    const fromRound = rosterRound(rosterId, seasonNumber, clubId);
    if (fromRound === undefined || outcome !== 'observed' && outcome !== 'no-minutes' || attributes !== null && !isObject(attributes)) return undefined;
    const packedObserver = isObject(observer) ? [observer.contractId, observer.scoutId, observer.evidence, ...(Object.hasOwn(observer, 'assignedLedgerIndex') ? [observer.assignedLedgerIndex] : [])] : undefined;
    return [playerId, seasonNumber, round, clubId, fromRound, outcome === 'observed' ? 1 : 0, attributes === null ? null : TRAINING_ATTRIBUTES.map(key => attributes[key]), ...(packedObserver ? [packedObserver] : [])];
  }, unpackReview);
}
function unpackReview(packed: unknown): unknown {
  if (!Array.isArray(packed)) return packed;
  const [playerId, seasonNumber, round, clubId, fromRound, observed, attributes, observer] = packed;
  if (packed.length < 7 || packed.length > 8 || observed !== 0 && observed !== 1 || attributes !== null && (!Array.isArray(attributes) || attributes.length !== TRAINING_ATTRIBUTES.length) || packed.length === 8 && (!Array.isArray(observer) || observer.length < 3 || observer.length > 4)) fail('has an invalid scouting report');
  return {
    playerId, seasonNumber, round, date: matchday(round, seasonNumber), clubId, rosterId: `roster-s${seasonNumber}-${clubId}-r${fromRound}`, outcome: observed ? 'observed' : 'no-minutes',
    attributes: attributes === null ? null : Object.fromEntries(TRAINING_ATTRIBUTES.map((key, index) => [key, (attributes as unknown[])[index]])),
    ...(packed.length === 8 ? { observer: { contractId: (observer as unknown[])[0], scoutId: (observer as unknown[])[1], evidence: (observer as unknown[])[2], ...((observer as unknown[]).length === 4 ? { assignedLedgerIndex: (observer as unknown[])[3] } : {}) } } : {}),
  };
}

function packInjury(injury: unknown): unknown {
  if (!isObject(injury)) return injury;
  return exact(injury, () => injury.id === `${injury.fixtureId}:${injury.playerId}` ? [injury.playerId, injury.clubId, injury.kind, injury.fixtureId, injury.occurredOn, injury.returnOn] : undefined, unpackInjury);
}
function unpackInjury(packed: unknown): unknown {
  if (!Array.isArray(packed)) return packed;
  if (packed.length !== 6) fail('has an invalid injury');
  const [playerId, clubId, kind, fixtureId, occurredOn, returnOn] = packed;
  return { id: `${fixtureId}:${playerId}`, playerId, clubId, kind, fixtureId, occurredOn, returnOn };
}

function packRehab(entry: unknown, index: number): unknown {
  if (!isObject(entry)) return entry;
  return exact(entry, () => {
    const { injuryId, playerId, clubId, seasonNumber, afterRound, rosterId, contractId, physioId, eligibleDays, creditBefore, creditEarned, returnBefore, returnAfter } = entry;
    const fromRound = rosterRound(rosterId, seasonNumber, clubId), suffix = `:${playerId}`;
    if (fromRound === undefined || typeof injuryId !== 'string' || !injuryId.endsWith(suffix)) return undefined;
    return [injuryId.slice(0, -suffix.length), playerId, clubId, seasonNumber, afterRound, fromRound, contractId, physioId, eligibleDays, creditBefore, creditEarned, returnBefore, returnAfter];
  }, packed => unpackRehab(packed, index));
}
function unpackRehab(packed: unknown, index: number): unknown {
  if (!Array.isArray(packed)) return packed;
  if (packed.length !== 13 || typeof packed[9] !== 'number' || typeof packed[10] !== 'number') fail('has an invalid rehabilitation week');
  const [injury, playerId, clubId, seasonNumber, afterRound, fromRound, contractId, physioId, eligibleDays, creditBefore, creditEarned, returnBefore, returnAfter] = packed;
  return {
    id: `rehab-${index + 1}`, injuryId: `${injury}:${playerId}`, playerId, clubId, seasonNumber, afterRound, fromDate: matchday(afterRound, seasonNumber), toDate: matchday((afterRound as number) + 1, seasonNumber),
    rosterId: `roster-s${seasonNumber}-${clubId}-r${fromRound}`, contractId, physioId, eligibleDays, creditBefore, creditEarned, creditAfter: (creditBefore as number) + (creditEarned as number), returnBefore, returnAfter,
  };
}

const STAT_FIELDS = ['secondsPlayed', 'points', 'fieldGoalsMade', 'fieldGoalsAttempted', 'threePointersMade', 'threePointersAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fouls', 'condition'] as const;
const APPEARANCE_FIELDS = ['secondsPlayed', 'fouls', 'appeared'] as const;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** A nonempty map of records with exactly these fields, in this order, as `[key, ...values, key, ...values]`. */
function flatten(map: unknown, fields: readonly string[]): unknown {
  if (!isObject(map)) return map;
  const entries = Object.entries(map), flat: unknown[] = [];
  if (!entries.length) return map;
  for (const [key, value] of entries) {
    if (!isObject(value)) return map;
    const keys = Object.keys(value);
    if (keys.length !== fields.length || keys.some((name, index) => name !== fields[index])) return map;
    flat.push(key, ...fields.map(name => value[name]));
  }
  return flat;
}
function unflatten(flat: unknown, fields: readonly string[], what: string): unknown {
  if (!Array.isArray(flat)) return flat;
  const width = fields.length + 1, map: Json = {};
  if (flat.length % width) fail(`has invalid ${what}`);
  for (let index = 0; index < flat.length; index += width) {
    const key = flat[index];
    if (typeof key !== 'string' || UNSAFE_KEYS.has(key) || Object.hasOwn(map, key)) fail(`has invalid ${what}`);
    map[key] = Object.fromEntries(fields.map((name, offset) => [name, flat[index + 1 + offset]]));
  }
  return map;
}

/** A senior result with its box score and appearances flattened. */
function packResult(result: unknown): unknown {
  if (!isObject(result)) return result;
  return exact(result, () => {
    const stats = flatten(result.stats, STAT_FIELDS), appearances = Object.hasOwn(result, 'appearances') ? flatten(result.appearances, APPEARANCE_FIELDS) : undefined;
    if (stats === result.stats && appearances === result.appearances) return undefined;
    return { ...result, stats, ...(Object.hasOwn(result, 'appearances') ? { appearances } : {}) };
  }, unpackResult);
}
function unpackResult(result: unknown): unknown {
  if (!isObject(result) || !Array.isArray(result.stats) && !Array.isArray(result.appearances)) return result;
  return { ...result, stats: unflatten(result.stats, STAT_FIELDS, 'player statistics'), ...(Object.hasOwn(result, 'appearances') ? { appearances: unflatten(result.appearances, APPEARANCE_FIELDS, 'appearances') } : {}) };
}
const packFixtureResults = (fixtures: unknown) => mapArray(fixtures, fixture => isObject(fixture) && isObject(fixture.result) ? { ...fixture, result: cached(fixture.result, () => packResult(fixture.result)) } : fixture);
const unpackFixtureResults = (fixtures: unknown) => mapArray(fixtures, fixture => isObject(fixture) && isObject(fixture.result) ? { ...fixture, result: unpackResult(fixture.result) } : fixture);

function packYouthFixture(fixture: unknown): unknown {
  if (!isObject(fixture)) return fixture;
  return exact(fixture, () => {
    const prefix = `youth-s${fixture.seasonNumber}-r${fixture.round}-`;
    if (typeof fixture.id !== 'string' || !fixture.id.startsWith(prefix)) return undefined;
    const result = isObject(fixture.result) && Array.isArray(fixture.result.injuries)
      ? { ...fixture.result, stats: flatten(fixture.result.stats, STAT_FIELDS), injuries: fixture.result.injuries.map(injury => isObject(injury) && injury.id === `${fixture.id}:${injury.playerId}` && injury.fixtureId === fixture.id && injury.occurredOn === fixture.date ? [injury.playerId, injury.clubId, injury.kind, injury.returnOn] : injury) }
      : fixture.result;
    return { ...fixture, id: [fixture.id.slice(prefix.length)], result };
  }, unpackYouthFixture);
}
function unpackYouthFixture(packed: unknown): unknown {
  if (!isObject(packed) || !Array.isArray(packed.id)) return packed;
  if (packed.id.length !== 1 || typeof packed.id[0] !== 'string') fail('has an invalid youth fixture');
  const id = `youth-s${packed.seasonNumber}-r${packed.round}-${packed.id[0]}`;
  const result = isObject(packed.result) && Array.isArray(packed.result.injuries) ? { ...packed.result, stats: unflatten(packed.result.stats, STAT_FIELDS, 'youth statistics'), injuries: packed.result.injuries.map(injury => {
    if (!Array.isArray(injury)) return injury;
    if (injury.length !== 4) fail('has an invalid youth diagnosis');
    const [playerId, clubId, kind, returnOn] = injury;
    return { id: `${id}:${playerId}`, playerId, clubId, kind, fixtureId: id, occurredOn: packed.date, returnOn };
  }) } : packed.result;
  return { ...packed, id, result };
}

function packAcademyWeek(week: unknown, clubOf: ReadonlyMap<unknown, unknown>): unknown {
  if (!isObject(week) || !isObject(week.players)) return week;
  let changed = false;
  const players: Json = {};
  for (const [id, report] of Object.entries(week.players)) {
    players[id] = isObject(report) && report.detail === 'outcome' && clubOf.get(id) === report.clubId && isObject(report.pointsAfter)
      ? exact(report, () => [TRAINING_FOCUSES.indexOf(report.focus as never), ...TRAINING_ATTRIBUTES.map(key => (report.pointsAfter as Json)[key])], packed => unpackAcademyReport(packed, clubOf.get(id)))
      : report;
    changed ||= players[id] !== report;
  }
  return changed ? { ...week, players } : week;
}
function unpackAcademyReport(packed: unknown, clubId: unknown): unknown {
  if (!Array.isArray(packed)) return packed;
  const focus = TRAINING_FOCUSES[packed[0] as number];
  if (packed.length !== TRAINING_ATTRIBUTES.length + 1 || focus === undefined || clubId === undefined) fail('has an invalid academy report');
  return { detail: 'outcome', clubId, focus, pointsAfter: Object.fromEntries(TRAINING_ATTRIBUTES.map((key, index) => [key, packed[index + 1]])) };
}
function unpackAcademyWeek(week: unknown, clubOf: ReadonlyMap<unknown, unknown>): unknown {
  if (!isObject(week) || !isObject(week.players) || !Object.values(week.players).some(Array.isArray)) return week;
  return { ...week, players: Object.fromEntries(Object.entries(week.players).map(([id, report]) => [id, unpackAcademyReport(report, clubOf.get(id))])) };
}
const prospectClubs = (academy: Json): Map<unknown, unknown> => new Map(Array.isArray(academy.prospects) ? academy.prospects.filter(isObject).map(prospect => [isObject(prospect.player) ? prospect.player.id : undefined, prospect.clubId]) : []);

// Records of completed weeks and seasons never change: lists that only grow are packed once per record.
const packedRecords = new WeakMap<object, unknown>();
function cached(item: unknown, pack: () => unknown): unknown {
  if (!isObject(item) && !Array.isArray(item)) return pack();
  let packed = packedRecords.get(item as object);
  if (packed === undefined) { packed = pack(); packedRecords.set(item as object, packed); }
  return packed;
}

/** Each record kind's place in the state, as `[read, write]` over the state object. */
function packRecords(state: Json): Json {
  const next: Json = { ...state };
  if (isObject(state.scouting) && isObject(state.scouting.clubs)) next.scouting = { ...state.scouting, clubs: Object.fromEntries(Object.entries(state.scouting.clubs).map(([id, club]) => [id, isObject(club) ? { ...club, reviews: mapArray(club.reviews, review => cached(review, () => packReview(review))) } : club])) };
  if (Array.isArray(state.injuries)) next.injuries = state.injuries.map(injury => cached(injury, () => packInjury(injury)));
  if (isObject(state.physio) && Array.isArray(state.physio.rehabilitation)) next.physio = { ...state.physio, rehabilitation: state.physio.rehabilitation.map((entry, index) => isObject(entry) && entry.id === `rehab-${index + 1}` ? cached(entry, () => packRehab(entry, index)) : entry) };
  if (isObject(state.youthCompetition) && Array.isArray(state.youthCompetition.seasons)) next.youthCompetition = { ...state.youthCompetition, seasons: state.youthCompetition.seasons.map(season => isObject(season) ? { ...season, fixtures: mapArray(season.fixtures, fixture => cached(fixture, () => packYouthFixture(fixture))) } : season) };
  if (isObject(state.academy) && Array.isArray(state.academy.weeks)) { const clubOf = prospectClubs(state.academy); next.academy = { ...state.academy, weeks: state.academy.weeks.map(week => packAcademyWeek(week, clubOf)) }; }
  next.fixtures = packFixtureResults(state.fixtures);
  if (Array.isArray(state.history)) next.history = state.history.map(archive => isObject(archive) ? { ...archive, fixtures: packFixtureResults(archive.fixtures) } : archive);
  return next;
}

function unpackRecords(state: Json): Json {
  const next: Json = { ...state };
  if (isObject(state.scouting) && isObject(state.scouting.clubs)) next.scouting = { ...state.scouting, clubs: Object.fromEntries(Object.entries(state.scouting.clubs).map(([id, club]) => [id, isObject(club) ? { ...club, reviews: mapArray(club.reviews, unpackReview) } : club])) };
  if (Array.isArray(state.injuries)) next.injuries = state.injuries.map(unpackInjury);
  if (isObject(state.physio) && Array.isArray(state.physio.rehabilitation)) next.physio = { ...state.physio, rehabilitation: state.physio.rehabilitation.map(unpackRehab) };
  if (isObject(state.youthCompetition) && Array.isArray(state.youthCompetition.seasons)) next.youthCompetition = { ...state.youthCompetition, seasons: state.youthCompetition.seasons.map(season => isObject(season) ? { ...season, fixtures: mapArray(season.fixtures, unpackYouthFixture) } : season) };
  if (isObject(state.academy) && Array.isArray(state.academy.weeks)) { const clubOf = prospectClubs(state.academy); next.academy = { ...state.academy, weeks: state.academy.weeks.map(week => unpackAcademyWeek(week, clubOf)) }; }
  next.fixtures = unpackFixtureResults(state.fixtures);
  if (Array.isArray(state.history)) next.history = state.history.map(archive => isObject(archive) ? { ...archive, fixtures: unpackFixtureResults(archive.fixtures) } : archive);
  return next;
}

/** The state as written into a compact save: the same object with its bulkiest records packed. */
export function packSeasonForSave(state: { finance: { ledger: FinanceEntry[]; archives?: FinanceArchiveBlock[] } }): unknown {
  const finance = state.finance, archives = finance.archives ?? [];
  const start = archives.length ? archives.at(-1)!.firstIndex + archives.at(-1)!.rows.length : 0;
  return {
    ...packRecords(state as unknown as Json),
    finance: {
      ...finance,
      ledger: finance.ledger.map((entry, index) => packLedgerEntry(entry, start + index)),
      ...(finance.archives ? { archives: finance.archives.map(packBlock) } : {}),
    },
    packing: SAVE_PACKING,
  };
}

/** Reverse `packSeasonForSave` on a decoded compact save. */
export function unpackSavedSeason(state: unknown): unknown {
  // A compact file written without packing is left as it is for the save checks to judge.
  if (!isObject(state) || !Object.hasOwn(state, 'packing')) return state;
  const { packing, ...unpacked } = state;
  if (packing !== SAVE_PACKING) fail('uses an unsupported layout');
  if (!isObject(unpacked.finance) || !Array.isArray(unpacked.finance.ledger) || Object.hasOwn(unpacked.finance, 'archives') && !Array.isArray(unpacked.finance.archives)) fail('has an invalid ledger');
  const finance = unpacked.finance as Json & { ledger: unknown[] };
  const archives = (finance.archives ?? []) as unknown[];
  const blocks = archives.map(block => {
    if (!isObject(block) || !Array.isArray(block.rows) || !Number.isSafeInteger(block.seasonNumber)) return block;
    return { ...block, rows: block.rows.map(row => unpackArchiveRow(row, block.seasonNumber as number)) };
  });
  const last = blocks.at(-1) as Partial<FinanceArchiveBlock> | undefined;
  const start = last && Number.isSafeInteger(last.firstIndex) && Array.isArray(last.rows) ? last.firstIndex! + last.rows.length : 0;
  return {
    ...unpackRecords(unpacked),
    finance: {
      ...finance,
      ledger: finance.ledger.map((entry, index) => unpackLedgerEntry(entry, start + index)),
      ...(Object.hasOwn(finance, 'archives') ? { archives: blocks } : {}),
    },
  };
}

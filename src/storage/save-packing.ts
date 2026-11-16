import type { FinanceArchiveBlock, FinanceArchiveRow, FinanceEntry } from '../domain/finance';

/**
 * Format 73 (step 3.7, save size): a lossless packing of the finance ledger, used only inside compact save files.
 *
 * The ledger is the largest record that a career must keep in full ("keep original ledger receipts"): a three-league
 * world books about 12,500 transactions a season. Most of their text repeats what the rest of the transaction already
 * says, so the file leaves it out and reading the file puts it back:
 * - a source identity that follows from the transaction (`operations-s2-r5`, `facility-upkeep-s2-r5`,
 *   `payroll-s2-r5`, `prepay-<agreement>`, `tickets-<fixture>`) is written as `0`;
 * - a wage line `{ agreementId: 'wage-s<season>-<player>', playerId, gross, discount, amount: gross - discount }`
 *   is written as `[playerId, gross]`, or `[playerId, gross, discount]` with a discount;
 * - an archived transaction without details drops its empty `{}`;
 * - an active transaction becomes `[clubId, seasonNumber, round, kind, amount, sourceId, details]`; its identity
 *   (`finance-<position + 1>`) and empty ticket, coach and payroll fields follow from the rest.
 * Packing happens only where unpacking gives back exactly the same text (same values, same key order); any other
 * transaction is written as it is. The game, its checks and plain (`serializeSeason`) files never see the packed form.
 */
export const FINANCE_PACKING = 'finance-pack-1';
export const FINANCE_PACKING_FORMAT = 73;

type PackedItem = [playerId: string, gross: number] | [playerId: string, gross: number, discount: number];
type Details = Record<string, unknown>;
export type PackedArchiveRow = [string, number, FinanceEntry['kind'], number, string | 0] | [string, number, FinanceEntry['kind'], number, string | 0, Details];
export type PackedLedgerEntry = [string, number, number, FinanceEntry['kind'], number, string | 0, Details];
export interface PackedArchiveBlock extends Omit<FinanceArchiveBlock, 'rows'> { rows: PackedArchiveRow[] }

function fail(reason: string): never { throw new Error(`Invalid season save: finance packing ${reason}.`); }
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

/** The state as written into a compact save: the same object with its finance ledger packed. */
export function packSeasonForSave(state: { finance: { ledger: FinanceEntry[]; archives?: FinanceArchiveBlock[] } }): unknown {
  const finance = state.finance, archives = finance.archives ?? [];
  const start = archives.length ? archives.at(-1)!.firstIndex + archives.at(-1)!.rows.length : 0;
  return {
    ...state,
    finance: {
      ...finance,
      packing: FINANCE_PACKING,
      ledger: finance.ledger.map((entry, index) => packLedgerEntry(entry, start + index)),
      ...(finance.archives ? { archives: finance.archives.map(packBlock) } : {}),
    },
  };
}

/** Reverse `packSeasonForSave` on a decoded compact save. */
export function unpackSavedSeason(state: unknown): unknown {
  // A compact file written without packing (or damaged beyond it) is left for the save checks to judge.
  if (!isObject(state) || !isObject(state.finance) || !Object.hasOwn(state.finance, 'packing')) return state;
  if (state.finance.packing !== FINANCE_PACKING) fail('uses an unsupported layout');
  const { packing: _packing, ...finance } = state.finance;
  if (!Array.isArray(finance.ledger) || Object.hasOwn(finance, 'archives') && !Array.isArray(finance.archives)) fail('has an invalid ledger');
  const archives = (finance.archives ?? []) as unknown[];
  const blocks = archives.map(block => {
    if (!isObject(block) || !Array.isArray(block.rows) || !Number.isSafeInteger(block.seasonNumber)) return block;
    return { ...block, rows: block.rows.map(row => unpackArchiveRow(row, block.seasonNumber as number)) };
  });
  const last = blocks.at(-1) as Partial<FinanceArchiveBlock> | undefined;
  const start = last && Number.isSafeInteger(last.firstIndex) && Array.isArray(last.rows) ? last.firstIndex! + last.rows.length : 0;
  return {
    ...state,
    finance: {
      ...finance,
      ledger: finance.ledger.map((entry, index) => unpackLedgerEntry(entry, start + index)),
      ...(Object.hasOwn(finance, 'archives') ? { archives: blocks } : {}),
    },
  };
}

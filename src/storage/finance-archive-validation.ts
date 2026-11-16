import type { FinanceArchiveBlock, FinanceEntry, SeasonFinance } from '../domain/finance';
import { expandFinanceArchiveRow, MAX_FINANCE_ARCHIVE_BLOCKS, MAX_FINANCE_LOGICAL_ENTRIES, MAX_FINANCE_SEGMENT_ENTRIES } from '../world/finance-archives';

const DETAIL_KEYS = new Set(['ticket', 'coach', 'payroll', 'scout', 'fitness', 'physio', 'assistant', 'youth', 'facility', 'facilityUpkeep', 'sponsorship', 'boardCapital', 'namingRights', 'sponsorExit', 'debt']);
function fail(reason: string): never { throw new Error(`Invalid season save: finance archives ${reason}.`); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/**
 * Check representation and expansion bounds first. Full accounting/replay then checks every reconstructed row.
 * No imported totals or fingerprints establish evidence. The temporary flat view never replaces the saved state.
 */
export function expandFinanceForValidation(value: unknown, currentSeason: unknown): unknown {
  if (!object(value)) return value; // The ordinary validator reports the finance shape.
  if (!Array.isArray(value.ledger) || value.ledger.length > MAX_FINANCE_SEGMENT_ENTRIES) fail('require an active ledger of at most 20000 entries');
  if (!Object.hasOwn(value, 'archives')) return value;
  if (!Number.isSafeInteger(currentSeason) || (currentSeason as number) < 1) fail('require a valid current season');
  if (!Array.isArray(value.archives) || !value.archives.length || value.archives.length > MAX_FINANCE_ARCHIVE_BLOCKS) fail('must contain between 1 and 100 completed-season blocks');
  let count = 0, lastYear = 0;
  for (const block of value.archives) {
    if (!object(block) || Object.keys(block).length !== 4 || block.model !== 'finance-archive-1' || block.firstIndex !== count ||
      !Number.isSafeInteger(block.seasonNumber) || (block.seasonNumber as number) <= lastYear || (block.seasonNumber as number) >= (currentSeason as number) ||
      !Array.isArray(block.rows) || !block.rows.length || block.rows.length > MAX_FINANCE_SEGMENT_ENTRIES) fail('must retain ordered, nonempty completed seasons at contiguous absolute positions');
    for (const row of block.rows) {
      if (!Array.isArray(row) || row.length !== 6 || !object(row[5]) || Object.keys(row[5]).some(key => !DETAIL_KEYS.has(key))) fail('contain an unsupported transaction row or payload field');
      for (const key of ['ticket', 'coach', 'payroll']) if (Object.hasOwn(row[5], key) && row[5][key] === null) fail('must omit implicit null payloads');
    }
    count += block.rows.length;
    if (count + value.ledger.length > MAX_FINANCE_LOGICAL_ENTRIES) fail('exceed the 200000-transaction expansion limit');
    lastYear = block.seasonNumber as number;
  }
  for (const row of value.ledger) if (!object(row) || typeof row.seasonNumber !== 'number' || row.seasonNumber <= lastYear) fail('must end before the active ledger begins');
  const ledger: FinanceEntry[] = [];
  for (const block of value.archives as FinanceArchiveBlock[]) for (let index = 0; index < block.rows.length; index += 1) ledger.push(expandFinanceArchiveRow(block, index));
  ledger.push(...value.ledger as FinanceEntry[]);
  const { archives: _archives, ...finance } = value;
  return { ...finance, ledger } as unknown as SeasonFinance;
}

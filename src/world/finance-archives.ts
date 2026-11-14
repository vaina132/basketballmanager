import type { FinanceArchiveBlock, FinanceArchiveRow, FinanceEntry, SeasonFinance } from '../domain/finance';
import type { SeasonState } from '../domain/season';

/** Per-segment limits bound active work; total expanded evidence also has a separate finite limit. */
export const MAX_FINANCE_SEGMENT_ENTRIES = 20_000;
export const MAX_FINANCE_ARCHIVE_BLOCKS = 100;
export const MAX_FINANCE_LOGICAL_ENTRIES = 200_000;

export function expandFinanceArchiveRow(block: FinanceArchiveBlock, index: number): FinanceEntry {
  const [clubId, round, kind, amount, sourceId, details] = block.rows[index]!;
  return { clubId, seasonNumber: block.seasonNumber, round, kind, amount, sourceId,
    ticket: null, coach: null, payroll: null, ...details, id: `finance-${block.firstIndex + index + 1}` };
}

function packRow(entry: FinanceEntry, position: number): FinanceArchiveRow {
  if (entry.id !== `finance-${position + 1}`) throw new Error('Financial history must keep its original transaction identities.');
  const { id: _id, seasonNumber: _year, clubId, round, kind, amount, sourceId, ticket, coach, payroll, ...optional } = entry;
  return [clubId, round, kind, amount, sourceId, {
    ...(ticket === null ? {} : { ticket }), ...(coach === null ? {} : { coach }),
    ...(payroll === null ? {} : { payroll }), ...optional,
  }];
}

/** Archive whole completed seasons only, including their offseason decisions. Never rebase an external anchor. */
export function archiveCompletedFinance(finance: SeasonFinance, currentSeason: number): SeasonFinance {
  const archives = [...(finance.archives ?? [])];
  let firstIndex = archives.length ? archives.at(-1)!.firstIndex + archives.at(-1)!.rows.length : 0;
  let offset = 0;
  while (offset < finance.ledger.length && finance.ledger[offset]!.seasonNumber < currentSeason) {
    const year = finance.ledger[offset]!.seasonNumber;
    if (archives.length && year <= archives.at(-1)!.seasonNumber) throw new Error('Financial archives must retain complete seasons in order.');
    let end = offset + 1;
    while (end < finance.ledger.length && finance.ledger[end]!.seasonNumber === year) end += 1;
    if (end - offset > MAX_FINANCE_SEGMENT_ENTRIES || archives.length >= MAX_FINANCE_ARCHIVE_BLOCKS || firstIndex + finance.ledger.length - offset > MAX_FINANCE_LOGICAL_ENTRIES) {
      throw new Error('This career has reached the supported financial history limit.');
    }
    archives.push({ model: 'finance-archive-1', seasonNumber: year, firstIndex,
      rows: finance.ledger.slice(offset, end).map((entry, index) => packRow(entry, firstIndex + index)) });
    firstIndex += end - offset;
    offset = end;
  }
  if (!offset) return finance;
  return { ...finance, archives, ledger: finance.ledger.slice(offset) };
}

export function archiveFinancialHistory(state: SeasonState): SeasonState {
  const finance = archiveCompletedFinance(state.finance, state.seasonNumber);
  return finance === state.finance ? state : { ...state, finance };
}

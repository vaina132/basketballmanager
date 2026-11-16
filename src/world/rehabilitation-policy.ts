import type { RehabilitationRecord, SeasonPhysio } from '../domain/physio';
import type { SeasonInjury } from '../domain/season';

export const REHABILITATION_CREDIT_PER_DAY_SAVED = 100;
export const MAX_REHABILITATION_REDUCTION_PERCENT = 20;
const DAY_MS = 86_400_000;

export function rehabilitationCreditCap(injury: SeasonInjury): number {
  const days = Math.round((Date.parse(`${injury.returnOn}T00:00:00Z`) - Date.parse(`${injury.occurredOn}T00:00:00Z`)) / DAY_MS);
  return Math.floor(days * MAX_REHABILITATION_REDUCTION_PERCENT / 100) * REHABILITATION_CREDIT_PER_DAY_SAVED;
}

// Step 3.7: records grouped by injury once per record list (lists are replaced, never edited; the length guards against an
// edited one). Every availability check used to read the whole career's rehabilitation history for each past injury.
const recordsByInjury = new WeakMap<readonly RehabilitationRecord[], { length: number; byInjury: Map<string, RehabilitationRecord[]> }>();
const NO_RECORDS: readonly RehabilitationRecord[] = [];
function injuryRecords(records: readonly RehabilitationRecord[], injuryId: string): readonly RehabilitationRecord[] {
  let known = recordsByInjury.get(records);
  if (!known || known.length !== records.length) {
    const byInjury = new Map<string, RehabilitationRecord[]>();
    for (const record of records) { const list = byInjury.get(record.injuryId); if (list) list.push(record); else byInjury.set(record.injuryId, [record]); }
    known = { length: records.length, byInjury };
    recordsByInjury.set(records, known);
  }
  return known.byInjury.get(injuryId) ?? NO_RECORDS;
}

/** Only reviews already settled at the requested date affect availability. */
export function latestRehabilitation(physio: SeasonPhysio | undefined, injuryId: string, asOf: string): RehabilitationRecord | null {
  let latest: RehabilitationRecord | null = null;
  for (const record of physio?.rehabilitation ? injuryRecords(physio.rehabilitation, injuryId) : NO_RECORDS) if (record.toDate <= asOf && (!latest || record.toDate > latest.toDate)) latest = record;
  return latest;
}

export function effectiveReturnOn(physio: SeasonPhysio | undefined, injury: SeasonInjury, asOf: string): string {
  return latestRehabilitation(physio, injury.id, asOf)?.returnAfter ?? injury.returnOn;
}

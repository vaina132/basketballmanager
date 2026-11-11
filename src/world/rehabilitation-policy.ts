import type { RehabilitationRecord, SeasonPhysio } from '../domain/physio';
import type { SeasonInjury } from '../domain/season';

export const REHABILITATION_CREDIT_PER_DAY_SAVED = 100;
export const MAX_REHABILITATION_REDUCTION_PERCENT = 20;
const DAY_MS = 86_400_000;

export function rehabilitationCreditCap(injury: SeasonInjury): number {
  const days = Math.round((Date.parse(`${injury.returnOn}T00:00:00Z`) - Date.parse(`${injury.occurredOn}T00:00:00Z`)) / DAY_MS);
  return Math.floor(days * MAX_REHABILITATION_REDUCTION_PERCENT / 100) * REHABILITATION_CREDIT_PER_DAY_SAVED;
}

/** Only reviews already settled at the requested date affect availability. */
export function latestRehabilitation(physio: SeasonPhysio | undefined, injuryId: string, asOf: string): RehabilitationRecord | null {
  let latest: RehabilitationRecord | null = null;
  for (const record of physio?.rehabilitation ?? []) if (record.injuryId === injuryId && record.toDate <= asOf && (!latest || record.toDate > latest.toDate)) latest = record;
  return latest;
}

export function effectiveReturnOn(physio: SeasonPhysio | undefined, injury: SeasonInjury, asOf: string): string {
  return latestRehabilitation(physio, injury.id, asOf)?.returnAfter ?? injury.returnOn;
}

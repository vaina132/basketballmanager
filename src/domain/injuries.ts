/**
 * Game injury types (sprint 4, owner feedback point 2): shares of time-loss injuries (at least one day out) and
 * recovery days from European professional basketball studies plus NBA data. A game model, not a medical one.
 */

/** Formats before 61 recorded only these two provisional kinds. They stay readable; new matches never produce them. */
export type LegacyInjuryKind = 'ankle' | 'muscle';

export type MatchInjuryKind =
  | 'ankle-sprain' | 'knee-minor' | 'meniscus' | 'acl' | 'hamstring' | 'calf' | 'thigh' | 'groin' | 'back' | 'foot'
  | 'tendinopathy' | 'achilles-rupture' | 'arm' | 'hand' | 'fracture' | 'concussion' | 'head' | 'illness';

export type InjuryKind = LegacyInjuryKind | MatchInjuryKind;

/** How an earlier injury of the same kind raises the risk of another one (see `recurrenceFactor` in world/health). */
export type InjuryRecurrence = 'muscle' | 'ankle' | 'overuse' | null;

export interface InjuryType {
  kind: MatchInjuryKind;
  /** Medical screens and lists. */
  label: string;
  /** Match commentary: "<name> leaves with <phrase>". */
  phrase: string;
  /** Percentage of time-loss injuries; the table sums to 100. */
  share: number;
  minDays: number;
  medianDays: number;
  maxDays: number;
  lowerLimb: boolean;
  recurrence: InjuryRecurrence;
}

export const MATCH_INJURY_TYPES: readonly InjuryType[] = [
  { kind: 'ankle-sprain', label: 'Ankle sprain', phrase: 'an ankle sprain', share: 17, minDays: 1, medianDays: 6, maxDays: 42, lowerLimb: true, recurrence: 'ankle' },
  { kind: 'knee-minor', label: 'Minor knee injury', phrase: 'a knee injury', share: 12, minDays: 1, medianDays: 5, maxDays: 28, lowerLimb: true, recurrence: 'overuse' },
  { kind: 'meniscus', label: 'Meniscus tear', phrase: 'a meniscus tear', share: 2, minDays: 21, medianDays: 42, maxDays: 120, lowerLimb: true, recurrence: null },
  { kind: 'acl', label: 'Torn ACL', phrase: 'a torn ACL', share: 0.8, minDays: 240, medianDays: 330, maxDays: 400, lowerLimb: true, recurrence: null },
  { kind: 'hamstring', label: 'Hamstring strain', phrase: 'a hamstring strain', share: 7, minDays: 3, medianDays: 10, maxDays: 42, lowerLimb: true, recurrence: 'muscle' },
  { kind: 'calf', label: 'Calf strain', phrase: 'a calf strain', share: 5, minDays: 3, medianDays: 10, maxDays: 42, lowerLimb: true, recurrence: 'muscle' },
  { kind: 'thigh', label: 'Thigh strain or bruise', phrase: 'a thigh strain', share: 5, minDays: 1, medianDays: 4, maxDays: 21, lowerLimb: true, recurrence: 'muscle' },
  { kind: 'groin', label: 'Hip or groin strain', phrase: 'a hip or groin strain', share: 6, minDays: 2, medianDays: 7, maxDays: 35, lowerLimb: true, recurrence: 'muscle' },
  { kind: 'back', label: 'Back injury', phrase: 'a back injury', share: 10, minDays: 1, medianDays: 4, maxDays: 42, lowerLimb: false, recurrence: 'overuse' },
  { kind: 'foot', label: 'Foot injury', phrase: 'a foot injury', share: 5, minDays: 2, medianDays: 7, maxDays: 35, lowerLimb: true, recurrence: null },
  { kind: 'tendinopathy', label: 'Achilles tendon problem', phrase: 'an Achilles tendon problem', share: 2, minDays: 3, medianDays: 10, maxDays: 35, lowerLimb: true, recurrence: 'overuse' },
  { kind: 'achilles-rupture', label: 'Ruptured Achilles', phrase: 'a ruptured Achilles', share: 0.2, minDays: 270, medianDays: 330, maxDays: 400, lowerLimb: true, recurrence: null },
  { kind: 'arm', label: 'Shoulder, arm or elbow injury', phrase: 'a shoulder or arm injury', share: 4, minDays: 1, medianDays: 6, maxDays: 42, lowerLimb: false, recurrence: null },
  { kind: 'hand', label: 'Hand, wrist or finger injury', phrase: 'a hand or wrist injury', share: 5, minDays: 1, medianDays: 4, maxDays: 28, lowerLimb: false, recurrence: null },
  { kind: 'fracture', label: 'Fracture', phrase: 'a suspected fracture', share: 4, minDays: 14, medianDays: 40, maxDays: 100, lowerLimb: false, recurrence: null },
  { kind: 'concussion', label: 'Concussion', phrase: 'a concussion', share: 2, minDays: 3, medianDays: 8, maxDays: 30, lowerLimb: false, recurrence: null },
  // Research range 0-10 days; a game absence lasts at least one day.
  { kind: 'head', label: 'Head or face knock', phrase: 'a knock to the head', share: 2, minDays: 1, medianDays: 2, maxDays: 10, lowerLimb: false, recurrence: null },
  { kind: 'illness', label: 'Illness', phrase: 'an illness', share: 11, minDays: 1, medianDays: 2, maxDays: 7, lowerLimb: false, recurrence: null },
];

export const MATCH_INJURY_KINDS: readonly MatchInjuryKind[] = MATCH_INJURY_TYPES.map(type => type.kind);
export const LEGACY_INJURY_KINDS: readonly LegacyInjuryKind[] = ['ankle', 'muscle'];
export const INJURY_KINDS: readonly InjuryKind[] = [...LEGACY_INJURY_KINDS, ...MATCH_INJURY_KINDS];

/** Risk multipliers for one player, by kind; absent kinds carry the normal risk (1). */
export type InjuryRisk = Partial<Record<MatchInjuryKind, number>>;

const TYPES = new Map<string, InjuryType>(MATCH_INJURY_TYPES.map(type => [type.kind, type]));

export function isInjuryKind(value: unknown): value is InjuryKind { return typeof value === 'string' && (INJURY_KINDS as readonly string[]).includes(value); }
export function isMatchInjuryKind(value: unknown): value is MatchInjuryKind { return typeof value === 'string' && TYPES.has(value); }
export function injuryType(kind: MatchInjuryKind): InjuryType { return TYPES.get(kind)!; }

export function injuryLabel(kind: InjuryKind): string {
  if (kind === 'ankle') return 'Ankle injury';
  if (kind === 'muscle') return 'Muscle injury';
  return TYPES.get(kind)?.label ?? 'Injury';
}

export function injuryPhrase(kind: InjuryKind): string {
  if (kind === 'ankle') return 'an ankle problem';
  if (kind === 'muscle') return 'a muscle problem';
  return TYPES.get(kind)?.phrase ?? 'an injury';
}

/** The player's overall risk relative to normal: the share-weighted mean of his per-kind multipliers. */
export function injuryRiskTotal(risk: InjuryRisk | undefined): number {
  if (!risk) return 1;
  let total = 0;
  for (const type of MATCH_INJURY_TYPES) total += type.share * (risk[type.kind] ?? 1);
  return total / 100;
}

/** Maps a uniform value in [0, 1) to a kind: research shares weighted by the player's recurrence multipliers. */
export function pickInjuryKind(value: number, risk?: InjuryRisk): MatchInjuryKind {
  const weights = MATCH_INJURY_TYPES.map(type => type.share * (risk?.[type.kind] ?? 1));
  let target = value * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < weights.length; index += 1) { target -= weights[index]!; if (target < 0) return MATCH_INJURY_TYPES[index]!.kind; }
  return MATCH_INJURY_TYPES[MATCH_INJURY_TYPES.length - 1]!.kind;
}

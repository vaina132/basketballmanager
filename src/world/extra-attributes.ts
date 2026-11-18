/**
 * The five further player abilities (owner decision, 18 November 2026): Blocking, Stealing, Intelligence, Mental and
 * Discipline, 1-20 like the seven skills. Dependency-free apart from the overall rating, so the match engine can use it.
 *
 * Real players get them from what the pack carries (the pack has no steals or blocks, so they are estimated from the
 * rest and kept internal, owner decision): Blocking from height, position, rebounding and defence; Stealing from
 * position, defence and passing; Intelligence from passing, the overall rating and experience (age and minutes);
 * Mental from age, minutes and free throws; Discipline from age and a stable per-player value. Generated players and
 * academy prospects use the same rules with their own age. Records without them (exhibition teams, the fictional
 * development world, careers started before the five existed) keep playing, training and showing as before: every
 * effect applies only to a player who stores the five.
 */
import type { ExtraAttributes, Player, PlayerAttributes, Position } from '../domain/types';
import { overallRating } from './overall-rating';

export const EXTRA_ATTRIBUTES = ['blocking', 'stealing', 'intelligence', 'mental', 'discipline'] as const;
export type ExtraAttribute = typeof EXTRA_ATTRIBUTES[number];
export const EXTRA_ATTRIBUTE_LABELS: Readonly<Record<ExtraAttribute, string>> = { blocking: 'Blocking', stealing: 'Stealing', intelligence: 'Intelligence', mental: 'Mental', discipline: 'Discipline' };

/** The derivation weights (reversible defaults; tuned so a typical regular sits near the game's average of 12). */
export const EXTRA_DERIVATION = {
  blocking: { base: 3, rebounding: .3, defense: .25, heightFrom: 198, perCm: 1 / 3, position: { PG: -2, SG: -1, SF: 0, PF: 1, C: 2 } },
  stealing: { base: 2.5, defense: .45, passing: .3, position: { PG: 2, SG: 1.5, SF: .5, PF: -1, C: -2 } },
  intelligence: { base: 1.5, passing: .35, overall: .07, perYear: .35, fromAge: 22, toAge: 32 },
  mental: { base: 5.5, freeThrow: .3, perYear: .4, fromAge: 22, toAge: 33, stableSpread: 4 },
  discipline: { base: 7, perYear: .25, fromAge: 18, toAge: 32, stableSpread: 10 },
  /** Experience from the minutes the ratings rest on: up to two points at 2,000 minutes or more. */
  minutes: { full: 2000, points: 2, assumed: 1000 },
  assumedAge: 26,
} as const;

const clamp = (value: number) => Math.max(1, Math.min(20, Math.round(value)));
const between = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
function stable(id: string, salt: string): number {
  let hash = 2166136261;
  for (const character of `${salt}:${id}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash / 0x1_0000_0000;
}

export interface ExtraAttributeInput {
  id: string; position: Position; heightCm: number; attributes: PlayerAttributes;
  /** Age in years when known; unknown ages count as 26. */
  age?: number | null;
  /** Minutes the ratings rest on, when known (real players); unknown counts as average. */
  minutes?: number | null;
}

/** The five abilities from a player's other details; deterministic for the same input. */
export function deriveExtraAttributes(input: ExtraAttributeInput): ExtraAttributes {
  const rule = EXTRA_DERIVATION, a = input.attributes;
  const age = typeof input.age === 'number' && Number.isFinite(input.age) ? input.age : rule.assumedAge;
  const minutes = typeof input.minutes === 'number' && Number.isFinite(input.minutes) ? input.minutes : rule.minutes.assumed;
  const experience = between(minutes / rule.minutes.full, 0, 1) * rule.minutes.points;
  const years = (from: number, to: number) => between(age, from, to) - from;
  const b = rule.blocking, s = rule.stealing, i = rule.intelligence, m = rule.mental, d = rule.discipline;
  const variation = (salt: string) => stable(input.id, salt) - .5;
  return {
    blocking: clamp(b.base + a.rebounding * b.rebounding + a.defense * b.defense + (input.heightCm - b.heightFrom) * b.perCm + b.position[input.position] + variation('blocking') * 2),
    stealing: clamp(s.base + a.defense * s.defense + a.passing * s.passing + s.position[input.position] + variation('stealing') * 2),
    intelligence: clamp(i.base + a.passing * i.passing + overallRating(a, input.position) * i.overall + years(i.fromAge, i.toAge) * i.perYear + experience + variation('intelligence') * 2),
    mental: clamp(m.base + a.freeThrow * m.freeThrow + years(m.fromAge, m.toAge) * m.perYear + experience * .5 + variation('mental') * m.stableSpread),
    discipline: clamp(d.base + years(d.fromAge, d.toAge) * d.perYear + stable(input.id, 'discipline') * d.stableSpread),
  };
}

/** The attributes with the five stored (an input that already has all five keeps its own values). */
export function withExtraAttributes(input: ExtraAttributeInput): PlayerAttributes {
  return hasExtraAttributes(input.attributes) ? input.attributes : { ...input.attributes, ...deriveExtraAttributes(input) };
}

export const hasExtraAttributes = (attributes: PlayerAttributes): attributes is PlayerAttributes & ExtraAttributes => EXTRA_ATTRIBUTES.every(key => typeof attributes[key] === 'number');

/** Only the five stored abilities of a record, for carrying them through skill projections (training, ageing). */
export function storedExtras(attributes: PlayerAttributes): Partial<ExtraAttributes> {
  return hasExtraAttributes(attributes) ? { blocking: attributes.blocking, stealing: attributes.stealing, intelligence: attributes.intelligence, mental: attributes.mental, discipline: attributes.discipline } : {};
}

/** Seasonal development of the five (applied with ageing): decisions and composure grow with experience, blocking and stealing fade. */
export const EXTRA_AGING: Readonly<Record<ExtraAttribute, { growUntilAge: number; growPoints: number; fromAge: number; annualPoints: number }>> = {
  blocking: { growUntilAge: 0, growPoints: 0, fromAge: 32, annualPoints: 20 },
  stealing: { growUntilAge: 0, growPoints: 0, fromAge: 31, annualPoints: 25 },
  intelligence: { growUntilAge: 30, growPoints: 40, fromAge: 35, annualPoints: 10 },
  mental: { growUntilAge: 30, growPoints: 40, fromAge: 99, annualPoints: 0 },
  discipline: { growUntilAge: 0, growPoints: 0, fromAge: 99, annualPoints: 0 },
};

/** Match-engine weights for the five (src/engine). */
export const EXTRA_MATCH = {
  /** League-average ability the effects are centred on, so league totals stay calibrated (measured on squads like the real data's regulars). */
  centre: 12,
  /** Block chance per Blocking point above the centre near the rim (within rimDistance metres); other twos get half. */
  block: .0035, rimDistance: 3,
  /** The blocker's choice among help defenders: weight times (1 + per point above the centre). */
  blockerChoice: .06,
  /** On passes and drives: turnover chance per Stealing point of the defender (its share of the defender's skill) and steal share per point. */
  stealSkill: .4, stealShare: .012,
  /** Turnover chance per Intelligence point of the handler above turnoverCentre (ball handlers are mostly guards, who rate higher). */
  turnover: .0022, turnoverCentre: 13,
  /** Shot selection: shooting chance changes by this share per Intelligence point, up for open looks and down for contested ones. */
  selection: .02,
  /** Last minutes (clockSeconds or fewer in the fourth quarter or overtime) of games within margin points: make chance per Mental point. */
  clutchSeconds: 180, clutchMargin: 6, clutch: .003,
  /** Training progress per Discipline point above or below 10 (2% a point: 20 gives +20%, 1 gives -18%). */
  trainingPerPoint: 2,
} as const;

const worldFlags = new WeakMap<object, boolean>();
/**
 * Whether a career's world stores the five on its players: true for careers started with them (real-club worlds from
 * the pack), false for older careers and the fictional development world, whose new prospects then keep the old shape.
 */
export function storesExtraAttributes(world: { clubs: readonly { players: readonly Pick<Player, 'attributes'>[] }[] }): boolean {
  let known = worldFlags.get(world);
  if (known === undefined) { const first = world.clubs.find(club => club.players.length)?.players[0]; known = !!first && hasExtraAttributes(first.attributes); worldFlags.set(world, known); }
  return known;
}

/** New academy and youth-squad prospects of a world that stores the five get them by the same rules (no recorded minutes). */
export function prospectsWithExtras<T extends { player: Player; dateOfBirth: string }>(world: Parameters<typeof storesExtraAttributes>[0], prospects: readonly T[], onDate: string): T[] {
  if (!storesExtraAttributes(world)) return [...prospects];
  return prospects.map(prospect => {
    const birth = prospect.dateOfBirth, age = Number(onDate.slice(0, 4)) - Number(birth.slice(0, 4)) - (onDate.slice(5) < birth.slice(5) ? 1 : 0);
    return { ...prospect, player: { ...prospect.player, attributes: withExtraAttributes({ ...prospect.player, age, minutes: 0 }) } };
  });
}

/**
 * Save shape for an ability record: the seven skills, and either none or all five further abilities, each a whole
 * number from 1 to 20. Returns a reason when the record does not fit, otherwise null.
 */
export function abilityShapeProblem(value: unknown, skills: readonly string[]): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'must be an object';
  const record = value as Record<string, unknown>, keys = Object.keys(record);
  const extras = EXTRA_ATTRIBUTES.filter(key => Object.hasOwn(record, key));
  if (extras.length !== 0 && extras.length !== EXTRA_ATTRIBUTES.length) return 'must hold all five further abilities or none';
  if (skills.some(key => !Object.hasOwn(record, key)) || keys.length !== skills.length + extras.length) return 'must hold the seven skills and only supported abilities';
  if (keys.some(key => !Number.isInteger(record[key]) || (record[key] as number) < 1 || (record[key] as number) > 20)) return 'must hold abilities from 1 to 20';
  return null;
}

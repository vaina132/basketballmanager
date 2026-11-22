import { COACH_ATTRIBUTES, type CoachAttribute, type CoachAttributes, type CoachStyle, type CoachTitles, type HeadCoach } from '../domain/coaches';

/**
 * Format 82 (owner, 22 November 2026, item E): how a real coach's 1-20 attributes and style are estimated from the
 * facts the sources give (no source rates coaches). The formula is the game's own and reproducible: the same facts
 * always give the same coach. Design: scratchpad `coaches/design.md`; data: `src/data/real-coaches.ts`.
 *
 * 1. Record R = 4 EuroLeague titles + 1.2 other European titles + 0.3 league titles (at most 8 count) + 0.12 cups (at most
 *    8 count) + 1 per national medal (gold counts 1.5) + 0.3 coach-of-the-year awards. European titles weigh most because
 *    domestic titles in a weaker league are easier to win.
 * 2. Level L of his current job (`COACH_LEVELS`): EuroLeague club 4, top division club in a European cup 3, top division 2,
 *    second division 0.5; national teams by level 3.5, 2.5, 1.5.
 * 3. Experience X = min(2, years as head coach / 8), 6 years when unknown.
 * 4. Quality Q = 7.5 + L + min(4, 1.1 √R) + X, between 6 and 18.5.
 * 5. Attribute = Q + personal lean (seeded from the name, -2 to +2, adding up to zero) + age + "known for" hints, rounded, 1-20.
 * 6. Reputation = 25 + 6 L + min(30, 7 √R) + 3 X, at most 99.
 */
export const COACH_RATING_MODEL = 'coach-ratings-1' as const;

/** The level of a coach's job used by the formula. */
export const COACH_LEVELS = Object.freeze({ euroleague: 4, european: 3, top: 2, second: 0.5, national1: 3.5, national2: 2.5, national3: 1.5 });

/** What a coach is widely known for (game estimate), each adding to an attribute and to the style. */
export type CoachHint = 'defence' | 'offence' | 'pace' | 'threes' | 'youth' | 'discipline' | 'motivation' | 'tactics';

/** The facts a coach's estimate rests on. */
export interface CoachFacts {
  name: string;
  born: string | null;
  nationality: string | null;
  since: number | null;
  titles: CoachTitles;
  hints?: readonly CoachHint[];
  source?: string;
}

export const NO_TITLES: CoachTitles = Object.freeze({ euroleague: 0, europe: 0, league: 0, cup: 0, national: 0, awards: 0 });

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** FNV-1a of a text: a coach's personal lean and style never use match randomness. */
export function coachHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  return hash;
}

/** Age in whole years on a date; a birth year alone counts from 1 July. Null when unknown. */
export function coachAge(born: string | null, date: string): number | null {
  if (!born) return null;
  const birth = born.length === 4 ? `${born}-07-01` : born;
  const years = Number(date.slice(0, 4)) - Number(birth.slice(0, 4));
  return date.slice(5) < birth.slice(5) ? years - 1 : years;
}

export function recordScore(titles: CoachTitles): number {
  return 4 * titles.euroleague + 1.2 * titles.europe + 0.3 * Math.min(8, titles.league) + 0.12 * Math.min(8, titles.cup) + titles.national + 0.3 * titles.awards;
}

/** Years as a head coach in the season starting on `date` (6 when unknown), and the experience term X. */
function experience(since: number | null, date: string): number {
  const years = since === null ? 6 : Math.max(0, Number(date.slice(0, 4)) - since);
  return Math.min(2, years / 8);
}

/** Eight leans from -2 to +2 that add up to zero: the attributes are paired by the name's hash, each pair +v and -v. */
function leans(name: string): CoachAttributes {
  const hash = coachHash(`lean|${name}`), order = [...COACH_ATTRIBUTES];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = coachHash(`order|${name}|${index}`) % (index + 1);
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  const result = Object.fromEntries(COACH_ATTRIBUTES.map(key => [key, 0])) as CoachAttributes;
  for (let pair = 0; pair < 4; pair += 1) {
    const value = ((hash >>> (pair * 4)) % 5) - 2;
    result[order[pair * 2]!] += value;
    result[order[pair * 2 + 1]!] -= value;
  }
  return result;
}

const HINT_ATTRIBUTES: Readonly<Record<CoachHint, Partial<CoachAttributes>>> = {
  defence: { defence: 2, offence: -1 }, offence: { offence: 2, defence: -1 }, pace: { offence: 1 }, threes: { offence: 1 },
  youth: { youth: 2, development: 1, discipline: -1 }, discipline: { discipline: 2, motivation: -1 }, motivation: { motivation: 2, discipline: -1 }, tactics: { tactics: 2 },
};
const HINT_STYLE: Readonly<Record<CoachHint, Partial<CoachStyle>>> = {
  defence: { pressure: 4, pace: -6 }, offence: { pace: 2, shooting: 2 }, pace: { pace: 6 }, threes: { shooting: 6 }, youth: { youthTrust: 6 },
  discipline: { pressure: 2 }, motivation: {}, tactics: {},
};

/**
 * A coach's style from his attributes (each compared with his own average, so a better coach is not simply more of
 * everything), a personal lean (seeded, -3 to +3) and his hints; 1-20, 10 neutral.
 */
export function coachStyle(name: string, attributes: CoachAttributes, hints: readonly CoachHint[] = []): CoachStyle {
  const hash = coachHash(`style|${name}`), lean = (index: number) => ((hash >>> (index * 5)) % 7) - 3;
  const mean = COACH_ATTRIBUTES.reduce((sum, key) => sum + attributes[key], 0) / COACH_ATTRIBUTES.length, own = (key: CoachAttribute) => attributes[key] - mean;
  const style = {
    pace: 10 + (attributes.offence - attributes.defence) * 0.5 + own('adaptability') * 0.2 + lean(0),
    shooting: 10 + own('offence') * 0.3 + lean(1),
    pressure: 10 + (attributes.defence - attributes.offence) * 0.6 + own('discipline') * 0.3 + lean(2),
    youthTrust: 10 + own('youth') * 0.8 + own('development') * 0.3 + lean(3),
  };
  for (const hint of hints) for (const [key, value] of Object.entries(HINT_STYLE[hint])) style[key as keyof CoachStyle] += value;
  return { pace: Math.round(clamp(style.pace, 1, 20)), shooting: Math.round(clamp(style.shooting, 1, 20)), pressure: Math.round(clamp(style.pressure, 1, 20)), youthTrust: Math.round(clamp(style.youthTrust, 1, 20)) };
}

/** The quality term Q of the formula. */
export function coachQuality(facts: Pick<CoachFacts, 'titles' | 'since'>, level: number, date: string): number {
  return clamp(7.5 + level + Math.min(4, 1.1 * Math.sqrt(recordScore(facts.titles))) + experience(facts.since, date), 6, 18.5);
}

/** Age effects: young coaches adapt and trust youth, older ones demand order and handle people. */
function ageEffects(age: number | null): Partial<CoachAttributes> {
  if (age === null) return {};
  if (age < 40) return { adaptability: 1, youth: 1, discipline: -1 };
  if (age >= 60) return { discipline: 1, motivation: 1, adaptability: -1 };
  return {};
}

/** A coach's attributes, style and reputation from his facts, the level of his job and the career's opening date. */
export function estimateCoach(id: string, facts: CoachFacts, level: number, date: string, generated = false): HeadCoach {
  const quality = coachQuality(facts, level, date), lean = leans(facts.name), age = ageEffects(coachAge(facts.born, date));
  const attributes = Object.fromEntries(COACH_ATTRIBUTES.map(key => {
    let value = quality + lean[key] + (age[key] ?? 0);
    for (const hint of facts.hints ?? []) value += HINT_ATTRIBUTES[hint][key] ?? 0;
    return [key, Math.round(clamp(value, 1, 20))];
  })) as CoachAttributes;
  const reputation = Math.round(clamp(25 + 6 * level + Math.min(30, 7 * Math.sqrt(recordScore(facts.titles))) + 3 * experience(facts.since, date), 1, 99));
  return {
    id, name: facts.name, born: facts.born, nationality: facts.nationality, attributes, style: coachStyle(facts.name, attributes, facts.hints), reputation, titles: { ...facts.titles }, since: facts.since,
    ...(facts.source ? { source: facts.source } : {}), ...(generated ? { generated: true as const } : {}),
  };
}

/** The overall coach rating 1-20: the average of the eight, Tactics, Offence and Defence counting double. */
export function coachOverall(attributes: CoachAttributes): number {
  const weight = (key: CoachAttribute) => key === 'tactics' || key === 'offence' || key === 'defence' ? 2 : 1;
  const total = COACH_ATTRIBUTES.reduce((sum, key) => sum + attributes[key] * weight(key), 0);
  return Math.round(total / COACH_ATTRIBUTES.reduce((sum, key) => sum + weight(key), 0));
}

/** A style value in words. */
export function styleWords(style: CoachStyle): { pace: string; shooting: string; pressure: string; youthTrust: string } {
  const band = (value: number, low: string, middle: string, high: string) => value <= 7 ? low : value >= 13 ? high : middle;
  return {
    pace: band(style.pace, 'Slow, patient', 'Steady', 'Fast'),
    shooting: band(style.shooting, 'Inside first', 'Balanced', 'Three-point heavy'),
    pressure: band(style.pressure, 'Soft, conservative', 'Normal', 'Pressing, defence first'),
    youthTrust: band(style.youthTrust, 'Trusts veterans', 'Normal', 'Trusts young players'),
  };
}

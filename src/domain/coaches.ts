/**
 * Format 82 (owner, 22 November 2026, item E): head coaches as people. Every club and national team has a head coach
 * with eight 1-20 attributes and a playing style; the manager has the same attributes, which change with his career.
 */
export const COACH_ATTRIBUTES = ['offence', 'defence', 'tactics', 'development', 'motivation', 'discipline', 'youth', 'adaptability'] as const;
export type CoachAttribute = typeof COACH_ATTRIBUTES[number];
export type CoachAttributes = Record<CoachAttribute, number>;

/** The attributes' names as the screens show them. */
export const COACH_ATTRIBUTE_LABELS: Readonly<Record<CoachAttribute, string>> = Object.freeze({
  offence: 'Offence', defence: 'Defence', tactics: 'Tactics', development: 'Development', motivation: 'Motivation', discipline: 'Discipline', youth: 'Youth', adaptability: 'Adaptability',
});

/** Four style values, 1-20 with 10 neutral: match pace, three-point emphasis, defensive pressure and trust in young players. */
export interface CoachStyle { pace: number; shooting: number; pressure: number; youthTrust: number }

/** Titles won as a head coach, from the coach's sources (national-team medals: gold 1.5, other medals 1). */
export interface CoachTitles { euroleague: number; europe: number; league: number; cup: number; national: number; awards: number }

/** A head coach of the game: a real person from the data, or a generated one (marked). */
export interface HeadCoach {
  id: string;
  name: string;
  /** ISO birth date, a birth year, or null when unknown. */
  born: string | null;
  nationality: string | null;
  attributes: CoachAttributes;
  style: CoachStyle;
  /** 0-100, from his record and level (the manager's reputation is the board's, as before). */
  reputation: number;
  titles: CoachTitles;
  /** First season as a head coach, when known. */
  since: number | null;
  /** Source page of the facts (real coaches). */
  source?: string;
  generated?: true;
}

/** One season's change of the manager's attributes, with the reasons in plain words. */
export interface ManagerCoachSeason { seasonNumber: number; changes: Partial<Record<CoachAttribute, number>>; reasons: string[] }

/** The career's coaches: the model and the manager's own attributes (start values and each season's change). */
export interface SeasonCoaches {
  model: 'coaches-1';
  manager: { start: CoachAttributes; seasons: ManagerCoachSeason[] };
}

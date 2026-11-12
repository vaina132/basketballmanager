/** A fictional rivalry between two development-league clubs; not a claim about real clubs. */
export interface Rivalry {
  id: string;
  clubIds: readonly [string, string];
  name: string;
  /** 1 (mild) to 3 (fierce): scales the crowd effect. */
  intensity: 1 | 2 | 3;
  origin: 'fictional-development-league';
}

export interface RivalryAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  /** Completed senior matchdays across the career at activation. */
  completedRounds: number;
  /** First matchday whose derby counts: the opening matchday of a new career, otherwise the next uncommitted one. */
  effectiveFrom: { seasonNumber: number; round: number };
}

/** Format 35: rivalries add derby effects on crowds, board reviews and squad morale from their anchor. */
export interface SeasonRivalries {
  model: 'rivalries-1';
  enabledSince: RivalryAnchor | null;
}

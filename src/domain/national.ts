import type { MatchState } from './types';

/**
 * Format 80 (owner feedback item 13, 22 November 2026): national teams, their competitions and coaches, and national
 * jobs for the manager (`src/world/national.ts`). New real-club careers only.
 */
export type NationalModel = 'national-1';

/** A national team of the game: the 24 teams of the real 2027 World Cup European Qualifiers' second round. */
export interface NationalTeamInfo {
  id: string;
  /** The country as the pack spells nationalities. */
  country: string;
  name: string;
  shortName: string;
  color: string;
  /** 1 strongest, 3 weakest: the level of generated fillers, the job's requirement and the salary. */
  level: 1 | 2 | 3;
}

/** The head coach of a national team. `manager`: the career's manager (no generated name). */
export interface NationalCoach {
  teamId: string;
  name: string;
  manager?: true;
  since: { seasonNumber: number; date: string };
  /** The federation's confidence in the coach, 0-100. */
  confidence: number;
}

/** A finished national game: the score, both squads and each player's whole minutes and points (players who played). */
export interface NationalResult {
  home: number;
  away: number;
  squads: { home: string[]; away: string[] };
  minutes: Record<string, number>;
  points: Record<string, number>;
  /** Each squad's strength at tip-off (the average overall rating of its best eight), for the federations' judgement. */
  strength: { home: number; away: number };
}

/** `window` 1 is November, 2 February, 3 the summer tournament. */
export interface NationalFixture {
  id: string;
  competitionId: string;
  window: 1 | 2 | 3;
  stage: 'group' | 'semi' | 'third' | 'final';
  groupId: string | null;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  result: NationalResult | null;
}

export interface NationalGroup { id: string; name: string; teamIds: string[] }

export interface NationalCompetition {
  id: string;
  seasonNumber: number;
  kind: 'qualifiers' | 'tournament';
  name: string;
  groups: NationalGroup[];
  fixtures: NationalFixture[];
}

/** A federation's offer of its head coach job to the manager. */
export interface NationalOffer {
  id: string;
  teamId: string;
  date: string;
  expiresOn: string;
  status: 'open' | 'accepted' | 'declined' | 'expired';
}

/** The manager's national job. `selection`: the players he picked (the rest is picked automatically). */
export interface NationalJob {
  teamId: string;
  since: { seasonNumber: number; date: string };
  /** The contract runs until this season's summer tournament has been played (at the next rollover). */
  untilSeason: number;
  /** Euro cents a season; shown only (the game has no personal money). */
  salary: number;
  selection: string[];
}

/** A federation's judgement of the manager after a window or a tournament, and what followed. */
export interface NationalVerdict {
  id: string;
  teamId: string;
  date: string;
  confidence: number;
  change: number;
  outcome: 'kept' | 'dismissed' | 'renewed' | 'left';
}

/** A change in the manager's national career: appointed, resigned, dismissed or contract ended. */
export interface NationalJobEvent { id: string; teamId: string; date: string; kind: 'appointed' | 'resigned' | 'dismissed' | 'ended' }

export interface SeasonNational {
  model: NationalModel;
  teams: NationalTeamInfo[];
  coaches: NationalCoach[];
  /** How many generated coaches have been named so far (each new one takes the next name of his country). */
  coachCount: number;
  competitions: NationalCompetition[];
  job: NationalJob | null;
  offers: NationalOffer[];
  verdicts: NationalVerdict[];
  events: NationalJobEvent[];
  /** The manager's national game being played in the Match center. */
  activeFixtureId: string | null;
  activeMatch: MatchState | null;
}

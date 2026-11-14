import type { CareerWorld } from './world';
import type { SeasonBoard } from './board';
import type { SeasonCommercial } from './commercial';
import type { SeasonRivalries } from './rivalries';
import type { SeasonCareer } from './career';
import type { SeasonRelationships } from './relationships';
import type { InjuryMode, MatchResult, MatchState, PlayerStats, Side, Tactics, Team } from './types';
import type { SeasonTraining } from './training';
import type { SeasonCoaching } from './coaching';
import type { SeasonFinance } from './finance';
import type { SeasonPayroll } from './payroll';
import type { ManagerProfile } from './manager';
import type { RosterSnapshot } from './roster';
import type { SeasonEmployment } from './employment';
import type { SeasonScouting } from './scouting';
import type { SeasonNegotiations } from './negotiations';
import type { SeasonMarket } from './market';
import type { SeasonRecruitment } from './recruitment';
import type { SeasonScouts } from './scouts';
import type { SeasonFitness } from './fitness';
import type { SeasonPhysio } from './physio';
import type { SeasonAssistant } from './assistant';
import type { SeasonAcademy } from './academy';
import type { SeasonYouth } from './youth';
import type { SeasonLifecycle } from './lifecycle';
import type { SeasonYouthCompetition } from './youth-competition';
import type { SeasonFacilities } from './facilities';

export interface ClubPlan {
  tactics: Tactics;
  lineup: string[];
  autoSubstitutions: boolean;
}

/** Compact completed fixture: no duplicated animation history. */
export interface FixtureResult {
  score: Record<Side, number>;
  officialScore: Record<Side, number>;
  winnerClubId: string;
  kind: MatchResult['kind'];
  periods: number;
  stats: Record<string, PlayerStats>;
  rosterIds: Record<Side, string>;
  /** All injured players at the final whistle, including carried absences. */
  injuries: Record<string, SeasonInjury['kind']>;
}

/** A deterministic development-model recovery episode, not a medical diagnosis. */
export interface SeasonInjury {
  id: string;
  playerId: string;
  clubId: string;
  kind: 'ankle' | 'muscle';
  fixtureId: string;
  occurredOn: string;
  /** First simulated calendar day on which the player is available again. */
  returnOn: string;
}

export interface SeasonFixture {
  id: string;
  round: number;
  date: string;
  homeClubId: string;
  awayClubId: string;
  result: FixtureResult | null;
}

/** Older imports lack box scores; newly archived seasons retain complete results. */
export interface ArchivedFixture extends Omit<SeasonFixture, 'result'> {
  result: Omit<FixtureResult, 'stats'> & { stats: Record<string, PlayerStats> | null };
}

export interface SeasonArchive {
  seasonNumber: number;
  rosters: RosterSnapshot[];
  fixtures: ArchivedFixture[];
}

/** Current season save format. Bumping it also requires a migration in season-storage.ts. */
/** Format 39 carries the world; 40 compacts strings/shapes; 41 shares repeated subtrees; 42 retains eligible historical rival academy outcomes. */
export const SEASON_SCHEMA_VERSION = 42;

export interface SeasonState {
  schemaVersion: typeof SEASON_SCHEMA_VERSION;
  engineVersion: 'possession-3';
  /** The world this career plays in: the built-in league's id, or the id of the world it carries in `world`. */
  dataPackId: string;
  /** Format 39: careers outside the built-in fictional league carry their world (clubs, players and club data). */
  world?: CareerWorld;
  seed: number;
  managedClubId: string;
  manager: ManagerProfile | null;
  seasonNumber: number;
  history: SeasonArchive[];
  date: string;
  status: 'active' | 'complete';
  round: number;
  clubs: readonly Team[];
  rosters: RosterSnapshot[];
  plans: Record<string, ClubPlan>;
  conditions: Record<string, number>;
  injuryMode: InjuryMode;
  injuries: SeasonInjury[];
  training: SeasonTraining;
  coaching: SeasonCoaching;
  finance: SeasonFinance;
  payroll: SeasonPayroll;
  employment: SeasonEmployment;
  scouting: SeasonScouting;
  scouts: SeasonScouts;
  fitness: SeasonFitness;
  physio: SeasonPhysio;
  assistant: SeasonAssistant;
  academy: SeasonAcademy;
  youth: SeasonYouth;
  lifecycle: SeasonLifecycle;
  youthCompetition: SeasonYouthCompetition;
  facilities: SeasonFacilities;
  relationships: SeasonRelationships;
  board: SeasonBoard;
  commercial: SeasonCommercial;
  /** Format 35: derby effects from the rivalry anchor. */
  rivalries: SeasonRivalries;
  /** Format 37: club changes at season ends; format 38: the board's dismissal and job offers decide them. */
  career: SeasonCareer;
  negotiations: SeasonNegotiations;
  market: SeasonMarket;
  recruitment: SeasonRecruitment;
  fixtures: SeasonFixture[];
  activeFixtureId: string;
  activeMatch: MatchState;
}

export interface Standing {
  position: number;
  clubId: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  difference: number;
}

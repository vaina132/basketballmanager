import type { InjuryMode, MatchResult, MatchState, PlayerStats, Side, Tactics, Team } from './types';
import type { SeasonTraining } from './training';
import type { SeasonCoaching } from './coaching';
import type { SeasonFinance } from './finance';
import type { SeasonPayroll } from './payroll';
import type { ManagerProfile } from './manager';
import type { RosterSnapshot } from './roster';

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

export interface SeasonState {
  schemaVersion: 9;
  engineVersion: 'possession-3';
  dataPackId: 'development-league-1';
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

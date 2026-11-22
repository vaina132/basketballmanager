import type { SeasonBackground } from './background';
import type { CompetitionStage } from './competition';
import type { CareerWorld, SeasonEconomy } from './world';
import type { SeasonBoard } from './board';
import type { SeasonCommercial } from './commercial';
import type { SeasonRivalries } from './rivalries';
import type { SeasonCareer } from './career';
import type { SeasonNational } from './national';
import type { SeasonRelationships } from './relationships';
import type { InjuryKind, InjuryModel } from './injuries';
import type { InjuryMode, MatchResult, MatchState, PlayerStats, PlayModel, Position, Side, Tactics, Team } from './types';
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
import type { SeasonMedia } from './media';

export interface ClubPlan {
  tactics: Tactics;
  lineup: string[];
  autoSubstitutions: boolean;
  /** Explicit preference for the next matchday; null delegates selection. Present only in full-roster careers. */
  matchday?: string[] | null;
  /**
   * Format 74: the circles the manager chose on the court picture for players of the planned five (the position each
   * plays). Absent until the manager places a player; the other starters and computer clubs play listed positions.
   */
  slots?: Record<string, Position>;
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
  /** Original selected players plus end-of-matchday condition for club members who did not dress. */
  selection?: { home: string[]; away: string[]; rested: Record<string, number> };
}

/** A deterministic game recovery episode, not a medical diagnosis. Formats before 61 hold only 'ankle' or 'muscle'. */
export interface SeasonInjury {
  id: string;
  playerId: string;
  clubId: string;
  kind: InjuryKind;
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
  /** Format 49, postseason games only (step 3.4b): stage, series, game number and a single-venue flag. */
  stage?: Exclude<CompetitionStage, 'regular'>;
  seriesId?: string;
  game?: number;
  neutral?: true;
  /** Format 57, European games only (step 3.5b): the European competition's id. Domestic games have none. */
  competition?: string;
}

/** Older imports lack box scores; newly archived seasons retain complete results. */
export interface ArchivedFixture extends Omit<SeasonFixture, 'result'> {
  result: Omit<FixtureResult, 'stats' | 'rosterIds'> & {
    stats: Record<string, PlayerStats> | null;
    /** Absent only from a sealed result (format 73), whose sides are the clubs' registrations at that round. */
    rosterIds?: Record<Side, string>;
    appearances?: Record<string, ArchivedAppearance>;
    /** Format 73, sealed rival games of seasons before the latest completed one: each side's personal fouls (for tie-break rules). */
    fouls?: Record<Side, number>;
  };
}

/** Retained per-game evidence for historical morale, scouting and injury checks. No invented box score. */
export interface ArchivedAppearance { secondsPlayed: number; fouls: number; appeared: boolean }
export interface ArchivedPlayerTotals { clubId: string; playerId: string; games: number; totals: Omit<PlayerStats, 'condition'> }
export interface SeniorSeasonSummary { model: 'senior-totals-1'; players: ArchivedPlayerTotals[] }

/** Format 60 (step 3.5f): a season's European entrants (the opening lists, then each season end's places) and the EuroLeague's one-year place holders. */
export interface SeasonEurope { model: 'places-1'; entrants: { competitionId: string; clubIds: string[] }[]; oneYear: string[] }

export interface SeasonArchive {
  seasonNumber: number;
  rosters: RosterSnapshot[];
  fixtures: ArchivedFixture[];
  /** Totals for the fixtures with appearances instead of full box scores, never counted twice. */
  summary?: SeniorSeasonSummary;
  /** Format 50: the season's division memberships (absent for seasons before division changes began). */
  divisions?: DomesticDivisions;
  /** Format 60: the season's European entrants, in worlds with European places. */
  europe?: SeasonEurope;
}

/**
 * Format 50 (step 3.4c): every division's clubs this season. `changesFrom` is the first season whose end moves clubs
 * between divisions; seasons before it (played before format 50) kept the opening memberships.
 */
export interface DomesticDivisions {
  changesFrom: number;
  leagues: { id: string; clubIds: string[] }[];
}

/** Current season save format. Bumping it also requires a migration in season-storage.ts. */
/** Format 39 carries the world; 40 compacts strings/shapes; 41 shares subtrees; 42 summarizes rival academy reports; 43 summarizes rival youth fixtures. */
/** Format 48 adds opt-in sourced domestic standings rules; existing worlds keep their original ranking. */
/** Format 49 adds domestic postseasons and game days inside a week; format 50 moves clubs between divisions. */
/** Format 51 adds the FIBA Appendix D standings rule, the labelled default for new worlds' leagues without a sourced rule. */
/** Format 52 adds the verified ACB, BBL and FIP standings rules for new worlds' Spanish, German and Italian leagues. */
/** Format 53 adds the record of clubs outside the full world (`background`) and the world's lower-division lists. */
/** Format 54 builds next-division clubs into the world (generated squads), outside the full world until promoted. */
/** Format 55 records exchanges with next divisions (`background.changesFrom`, `background.exchanges`) and contract departures. */
/** Format 56 adds the European competitions and their entrants to new worlds (step 3.5a). */
/** Format 57 plays European competitions in their real formats on midweek game days (steps 3.5b-c). */
/** Format 58 adds the EuroCup format: four groups and best-of-three playoffs (step 3.5d). */
/** Format 59 adds the BCL format: qualification, a protected draw, play-ins, Round of 16 groups and a Final Four (step 3.5e). */
/** Format 60 adds estimated tables for unchosen leagues and each season end's European places (`europe`, step 3.5f). */
/** Format 61 records realistic injury kinds (sprint 4) and each career match's recurrence risk (`activeMatch.injuryRisk`). Format 62 (sprint 4) gives real-club worlds researched money: `world.economy` and each club's `finances[].economy` (`src/world/economy.ts`). */
/** Format 63 (saved ideas: career and board) adds the `career-2` rules for new careers: a protected first season, fresh board confidence for a new coach (`board.restarts`), mid-season dismissals and resignations (`CAREER_RULES`, `src/world/career-rules.ts`). Format 64 gives new careers sponsorship exit clauses and arena naming rights (`commercial.model` 'commercial-2', `commercial.naming`, ledger kinds 'naming-rights' and 'sponsor-exit'). Format 65: new careers use the `facilities-2` model: medical and scouting facilities, seasonal wear and repair projects (`FACILITY_RULES_2`, `src/world/facilities-policy.ts`). Format 66 gives new careers the `relationships-2` model: default roles by recorded squad rank (`relationships.squadRanks`) and players' contract requests with the club's replies. Format 67 adds richer press topics and the manager's media standing (`media`, `src/world/media.ts`). Format 68: new careers grow rivalries from results (`rivalries.model` 'rivalries-2', `src/world/rivalry-growth.ts`); older careers keep the world's fixed rivalries. Format 69: new careers use the `career-3` model: a manager may become unemployed (`managedClubId` empty), every club is then run automatically, and boards changing coach offer jobs by a slowly fading reputation (`CAREER_RULES`). Format 70: new careers use the board-2 model: president personalities, season verdicts on the player salary budget, youth and culture objectives and the president's requests (`PRESIDENT_RULES`, `src/world/presidents.ts`). Format 71: new careers can finance facility projects with bank loans and leases (`facilities.financing` 'loans-1', `facilities.debts`, ledger kinds 'loan', 'loan-repayment' and 'lease'; `FACILITY_FINANCING_RULES`, `src/world/facility-debt.ts`); older careers pay upfront.  Format 72 (club money follows promotion and relegation): new careers of real-data worlds record each season's club money figures (`economySeasons`, `src/world/economy.ts`); older careers keep their opening figures. */
/** Format 73 (step 3.7) also moves careers of real-data worlds to the closed money gaps (season money for capital, staff budgets and offseason offers, scaled amounts, solvent weak clubs, realistic staff pay); older real-club careers are refused with a "start a new career" message (`OLDER_REAL_CAREER_MESSAGE`). Compact files (`compact-3`) pack the bulkiest records losslessly (`src/storage/save-packing.ts`). */
/** Format 73 (step 3.7, save size): completed seasons are sealed at each rollover. Rival senior games of seasons before the latest completed one keep their results, diagnoses and each side's fouls (`fouls`) beside the season totals; rival youth games of completed seasons keep results and diagnoses (`detail: 'season'`); academy weeks of completed seasons keep each prospect's last report of the season. Strict checks replay the current season from these records (`src/world/sealed-history.ts`). */
/** Format 74: six-level facilities with the bank loan (also accepted at format 73), opening staff for every club (`coaching-2`), squad roles (`relationships-3`) and court-picture slots. */
/** Format 76: staff contracts of 1-3 seasons with weekly salaries and sacking compensation (`coaching-4`, `src/world/staff-contracts.ts`). */
/** Format 77: calmer playing time for new careers (`relationships-4`, `PLAYING_TIME_RULES` in `src/world/relationship-rules.ts`): quiet role adjustments (`role-adjust` events) and one calm concern (`role-request` stage 'concern'). */
/** Format 78: the transfer and loan list with bids for the manager's players and loans (`recruitment-2`), and the scouting network (`scouting-2`). */
/** Format 79: the richer play model for new careers' matches (`matchModel` 'plays-2', `src/engine/plays.ts`); older careers replay with the earlier possession actions. */
/** Format 80: national teams, their competitions, FIBA windows that pause the domestic leagues with room, and national jobs (`national`, `src/world/national.ts`). */
/** Format 81: the play model with the dead balls of a real game for new careers' matches (`matchModel` 'plays-3', option `matchFlow`, `FLOW` in `src/engine/plays.ts`); 'plays-2' careers replay unchanged. */
export const SEASON_SCHEMA_VERSION = 81;

export interface SeasonState {
  schemaVersion: typeof SEASON_SCHEMA_VERSION;
  engineVersion: 'possession-3';
  /** The world this career plays in: the built-in league's id, or the id of the world it carries in `world`. */
  dataPackId: string;
  /** Format 39: careers outside the built-in fictional league carry their world (clubs, players and club data). */
  world?: CareerWorld;
  seed: number;
  /**
   * The club the manager runs. Format 69 (`career-3` careers): empty while the manager is unemployed (`isUnemployed`);
   * every club is then automatic, and the career's moves name the last club.
   */
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
  /** Owner feedback (22 November 2026): new careers diagnose match injuries with the longer `injuries-2` durations. */
  injuryModel?: InjuryModel;
  /** Format 79 (owner feedback, 22 November 2026): new careers play their matches with the richer play model. */
  matchModel?: PlayModel;
  /** Format 80 (owner feedback item 13, 22 November 2026): national teams, competitions and the manager's national job. */
  national?: SeasonNational;
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
  /** End-of-week condition evidence for clubs with no senior fixture. New calendars only. */
  restWeeks?: { round: number; clubId: string; conditions: Record<string, number> }[];
  /** Format 50: this season's division memberships, in worlds whose leagues have postseasons. */
  divisions?: DomesticDivisions;
  /** Format 53: clubs outside the full world, with their squads (step 3.4d). Present exactly when divisions are. */
  background?: SeasonBackground;
  /** Format 60: this season's European entrants, exactly in worlds with European places (step 3.5f). */
  europe?: SeasonEurope;
  /** Format 67: richer press topics and media standing, in careers created with them; absent careers keep the format-34 press. */
  media?: SeasonMedia;
  /** Format 72: each season's club money figures, in new careers of real-data worlds; absent careers keep the world's opening figures. */
  economySeasons?: SeasonEconomy;
  activeFixtureId: string | null;
  activeMatch: MatchState | null;
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
  rankingTie?: 'unresolved' | 'draw';
}

import type { ClubFinanceDefinition } from '../data/development-finances';
import type { DevelopmentPresident } from '../data/development-presidents';
import type { DevelopmentPlayerProfile } from '../data/development-player-profiles';
import type { DevelopmentSponsor } from '../data/development-sponsors';
import type { Rivalry } from './rivalries';
import type { Team } from './types';
import type { DomesticStandingsRule } from './competition';
import type { PostseasonFormatId } from '../world/postseason';
import type { LowerDivision } from './background';

export type EuropeanCompetitionKind = 'euroleague' | 'eurocup' | 'bcl';
/** Format 57 (step 3.5b): the real format a European competition is played in (src/world/europe.ts); the EuroCup's from format 58, the BCL's from 59. */
export type EuropeanFormatId = 'euroleague-2026-1' | 'eurocup-2026-1' | 'bcl-2026-1';
/** `format` (format 57) means the competition's games are played; without it the competition is listed only (format 56). */
/**
 * `countries` (format 59, with the BCL format; format 60 for every played competition of a world with European
 * places): each entrant's country. `oneYear` (format 60, the EuroLeague): the opening season's one-year places.
 */
export interface EuropeanCompetition { id: string; name: string; kind: EuropeanCompetitionKind; season: string; clubIds: string[]; format?: EuropeanFormatId; countries?: Record<string, string>; oneYear?: string[] }
/** Format 60 (step 3.5f): a top division of a country with domestic data that was not chosen. Its clubs are in the world outside the full world; each season end ranks them in an estimated table. */
export interface BackgroundLeague { id: string; name: string; country: string; tier: 1; clubIds: string[] }
/** NBA step 4 (format 90): a conference with its divisions, each listing its clubs (five per division in the real NBA). */
export interface NbaConference { id: string; name: string; divisions: { id: string; name: string; clubIds: string[] }[] }
/**
 * NBA step 4 (format 90, new careers with the option `nba`): the world's NBA league (`leagueId`, one of its domestic
 * leagues, 30 clubs), its two conferences and six divisions, and the match rules it plays (`ruleset`). Its schedule,
 * standings and postseason follow `src/world/nba-schedule.ts`, `nba-ranking.ts` and the `nba-2026-1` postseason.
 */
export interface NbaWorld {
  model: 'nba-1'; leagueId: string; conferences: NbaConference[]; ruleset: 'nba-2026';
  /**
   * NBA step 6 (format 92, new NBA worlds): the NBA's money rules (`src/world/nba-cap.ts`, `nba-cap-policy.ts`): the salary
   * cap and its exceptions, rosters of 13-15, the luxury tax shared among non-payers and the owner's payroll ceiling.
   * Format-90 NBA worlds without it keep the placeholder money of NBA step 4.
   */
  cap?: 'nba-cap-1';
  /**
   * NBA step 8 (format 94, provisional; new NBA worlds with the cap): the NBA draft (`src/world/nba-draft.ts`,
   * `nba-draft-policy.ts`): generated prospects, the lottery, two rounds of picks with rookie contracts (`state.draft`).
   */
  draft?: 'nba-draft-1';
}
/** Format 62 (sprint 4): money of real-club worlds follows researched 2025-27 club budgets (`src/world/economy.ts`). */
export type WorldEconomyId = 'real-2026-1';
/** The money level a club's figures were placed in (`REAL_ECONOMY_RULES`). */
/** `nba` (NBA step 4, format 90): the NBA's clubs, a money level far above Europe's (`src/world/nba-economy.ts`). */
export type EconomyBand = 'euroleague-top' | 'euroleague' | 'top-upper' | 'top-lower' | 'second' | 'third' | 'nba';
/**
 * A club's estimated money for one season, in euro cents (format 62). Flows read these figures when a world has an
 * economy and the development constants otherwise.
 */
export interface ClubEconomy {
  band: EconomyBand;
  /** Total annual budget: the season's income and its costs are built to balance around it. */
  budget: number;
  /** Main sponsorship each season (also the reference for negotiated sponsorship). */
  sponsorship: number;
  /**
   * League and European distributions, public money, other income and the owner's contribution each season. The game
   * has no separate income kinds for these, so they are booked together as one season-funding receipt; the owner's
   * share covers the gap left by tickets and sponsorship, as in reality.
   */
  funding: number;
  /** Cash at the career's start (or when the club first joins the full world). */
  openingCash: number;
  /** Default ticket price in whole euros (cents); the price control ranges up to three times it. */
  ticketPrice: number;
  /** Annual operating costs (arena, travel, administration, youth teams), charged in equal weekly parts. */
  operatingCost: number;
  /**
   * Per-mille multiplier for the game's catalog amounts that have no researched value per club: staff fees and the
   * staff allocation, facility costs and upkeep, owner capital and the automation cushions (1000 = unchanged).
   */
  scale: number;
}

/**
 * Format 72: why a club's money level changed from the previous season. Division moves (`promoted`, `relegated`,
 * including moves into and out of the full world), a European competition entered or left, or a move between bands of
 * the same competition by squad strength (`band`, for example a top division's upper and lower halves).
 */
export type EconomyChangeReason = 'promoted' | 'relegated' | 'joined-euroleague' | 'left-euroleague' | 'joined-eurocup' | 'left-eurocup' | 'joined-bcl' | 'left-bcl' | 'band';

/**
 * Format 72: a club's money figures for one season after the first, moved part of the way from last season's figures
 * towards the target its new band and standing give (`REAL_ECONOMY_RULES.seasons`).
 */
export interface SeasonClubEconomy extends ClubEconomy {
  /** The player wage bill (gross, cents) these figures fund; the player salary budget follows its ratio to the opening bill. */
  playerBill: number;
  /** The budget the club's band and standing give this season (cents); `budget` moves towards it season by season. */
  target: number;
  /** Why the band changed from last season; empty when only the standing within the band (or the smoothing) moved the figures. */
  reasons: EconomyChangeReason[];
}

/** Format 72: every full-world club's figures for one season (the world's own figures are season one's). */
export interface SeasonEconomyTable { seasonNumber: number; clubs: Record<string, SeasonClubEconomy> }

/**
 * Format 72 (saved ideas level): club money follows promotion, relegation and European places in new careers of
 * real-data worlds. One table for each season from the second; once a season is complete, its divisions and European
 * places have decided the next season's figures, so the table for the next season is added then (offseason offers and
 * budgets use it). Older careers keep their opening figures.
 */
export interface SeasonEconomy { model: 'economy-seasons-1'; seasons: SeasonEconomyTable[] }

/**
 * Everything a career's league is made of at its start: clubs and squads, player birth dates and wages, venues,
 * presidents, sponsors and rivalries. The built-in fictional league is one world (`DEVELOPMENT_WORLD`, never stored
 * in saves); any other world travels inside its career's save, so a career never depends on files outside it.
 */
export interface CareerWorld {
  /** Equals the career's `dataPackId`. */
  id: string;
  name: string;
  source: 'fictional-development' | 'real-data-pack';
  /** New careers separate contracted club membership from the twelve-player matchday selection. */
  rosterModel?: 'club-roster-1';
  /** Versioned domestic membership; absent in legacy single-league careers. */
  /** Format 49: `postseason` names the league's playoff format (step 3.4b); absent in older worlds, which end after the regular season. */
  domesticLeagues?: { id: string; name: string; country: string; tier: number; clubIds: string[]; standingsRule?: DomesticStandingsRule; postseason?: PostseasonFormatId }[];
  /** First matchday of season one (a Saturday). */
  startDate: string;
  clubs: readonly Team[];
  /** Every original player's date of birth. */
  playerProfiles: Readonly<Record<string, DevelopmentPlayerProfile>>;
  /**
   * Format 50 (owner feedback, 15 November 2026): seasons left on each original player's opening contract (1-3),
   * estimated from age and quality because no source has real contract data. Absent: one season, as before.
   */
  playerContracts?: Readonly<Record<string, number>>;
  /**
   * Format 53 (step 3.4d-1): each country's real next division below its lowest full division, identities only.
   * Absent when no list is known (public worlds; Italy and France for now).
   */
  lowerDivisions?: readonly LowerDivision[];
  /**
   * Format 56 (step 3.5a): the European competitions and their entrants for the opening season. Entrants outside the
   * chosen leagues (unchosen leagues and countries outside the six) are clubs of the world outside the full world, with
   * their real squads; they play only European games.
   */
  europeanCompetitions?: readonly EuropeanCompetition[];
  /** Format 60 (step 3.5f): next season's European places follow the 2026 default (`src/world/european-places.ts`). */
  europeanPlaces?: 'places-2026-1';
  /** Format 60: the unchosen top divisions of the countries with domestic data, for their estimated tables. */
  backgroundLeagues?: readonly BackgroundLeague[];
  /**
   * Format 62: the world's money follows researched club budgets; each club's `finances` entry then carries its
   * `economy` figures. Absent: the development economy's constants (every older or test world).
   */
  economy?: WorldEconomyId;
  /**
   * Format 85 (new careers, option `neutralVenues`): games marked at one venue (`neutral`: Primera FEB's final stage,
   * the Final Fours, the BCL qualification) are played without home-court advantage and earn neither club a gate.
   */
  neutralVenues?: true;
  /** Format 85 (new careers, option `clubCountries`): clubs of a next division have their country (`clubCountry`). */
  nextDivisionCountries?: true;
  /**
   * Format 87 (new careers with researched money, option `economyBalance`): weak clubs stay sustainable over long
   * careers (`src/world/economy-balance.ts`): league solidarity money for smaller clubs, automatic facility spending that
   * counts only the home games still to come, and automatic wage targets that follow the club's money when cash is low.
   */
  economyBalance?: true;
  /**
   * Format 88 (new careers with the economy balance, option `surplusSpending`): clubs run automatically spend part of
   * their cash above a healthy reserve on wages, transfers, staff and facilities, by their president's spending style
   * (`src/world/surplus-spending.ts`).
   */
  surplusSpending?: true;
  /**
   * Format 89 (new careers with surplus spending, option `spendingBalance`): the low-cash wage limit looks one season
   * ahead, careful clubs spend a little, and clubs that fell short of their results target spend more on the squad
   * (`src/world/spending-balance.ts`).
   */
  spendingBalance?: true;
  /** NBA step 4 (format 90, new careers with the option `nba`): the NBA league of this world. */
  nba?: NbaWorld;
  /**
   * NBA step 10 (format 91, new careers with the NBA and the option `nbaJobs`): NBA careers. NBA clubs start with their
   * real head coaches, NBA jobs rank above EuroLeague jobs, which rank above other top-division jobs, and an NBA job asks
   * for a reputation of about 60-70 (`src/world/nba-jobs.ts`). Only worlds with the NBA carry it.
   */
  nbaJobs?: true;
  /** Every original player's gross season wage in euro cents: the club's cost, which payroll charges. */
  wages: Readonly<Record<string, number>>;
  finances: readonly ClubFinanceDefinition[];
  presidents: readonly DevelopmentPresident[];
  /** The sponsor market; each club's current sponsor is named in its finance definition. */
  sponsors: readonly DevelopmentSponsor[];
  rivalries: readonly Rivalry[];
}

/** The fields a context needs to find its world: careers outside the built-in league carry theirs. */
export interface WorldContext {
  dataPackId?: string;
  world?: CareerWorld;
  /**
   * Format 72: the season whose money figures apply, with the career's per-season figures (`economySeasons`). Without
   * both, money helpers read the world's opening figures, as every older career does.
   */
  seasonNumber?: number;
  economySeasons?: SeasonEconomy;
}

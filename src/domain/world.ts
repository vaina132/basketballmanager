import type { ClubFinanceDefinition } from '../data/development-finances';
import type { DevelopmentPresident } from '../data/development-presidents';
import type { DevelopmentPlayerProfile } from '../data/development-player-profiles';
import type { DevelopmentSponsor } from '../data/development-sponsors';
import type { Rivalry } from './rivalries';
import type { Team } from './types';
import type { DomesticStandingsRule } from './competition';
import type { PostseasonFormatId } from '../world/postseason';

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
  /** Every original player's gross season wage in euro cents. */
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
}

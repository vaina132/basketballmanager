import type { SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { seasonSalaryBudget, staffAllocation } from './board-consequences';
import { effectiveContractsForRound, getClubContractSummary } from './employment-policy';
import { getInSeasonOffers } from './recruitment-policy';
import { staffCommitted } from './staff-policy';
import { isCapClub } from './club-roster-policy';
import { usesNbaBalance } from './nba-balance';

/**
 * One wage pool (owner feedback, 18 November 2026; format 75, stored as `coaching.model` 'coaching-3'): new careers have
 * two budgets instead of three. **Wages left** is one pool for player wages and staff fees; **Spending left** (the
 * club's spendable cash) pays transfer fees, facilities and the arena, and bank loans add to it. Reversible defaults:
 * - The pool of a season is that season's player salary budget plus its staff budget, both still set by the club's
 *   money and the board's verdicts. Player contracts may use staff budget the club's employed staff do not use, and
 *   staff appointments may use player salary budget this season's wages and pending offers do not use.
 * - Contracts for a later season count the staff employed now as that season's staff (they usually renew), so player
 *   wages planned ahead never take the room the current staff need to stay.
 * - Staff fees are still paid in full when a person is hired, so a hire also needs the money in Spending left, and
 *   every other money guard (unpaid costs, overdue transfers, wage reserves) is unchanged. Human and computer clubs share
 *   these rules.
 */
export function usesWagePool(state: { coaching?: { model: string } }): boolean {
  return state.coaching?.model === 'coaching-3' || state.coaching?.model === 'coaching-4';
}

type StaffState = Pick<SeasonState, 'coaching' | 'seasonNumber'> & Partial<Pick<SeasonState, 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth' | 'board'>> & WorldContext;

/** Staff budget the employed staff leave unused, which a season's player wages may use (0 without the wage pool). */
export function staffRoomForWages(state: Partial<StaffState> & Pick<SeasonState, 'seasonNumber'> & WorldContext, clubId: string, seasonNumber = state.seasonNumber): number {
  if (!state.coaching || !usesWagePool(state)) return 0;
  // Format 96 (NBA step 12): an NBA club's player wages pool is its owner's payroll ceiling; unused staff budget adds nothing.
  if (usesNbaBalance(state) && isCapClub(state, clubId)) return 0;
  return Math.max(0, staffAllocation(state, clubId, seasonNumber) - staffCommitted(state as StaffState, clubId));
}

/** This season's player salary budget left after current wages and pending in-season offers (0 without the wage pool). */
export function wageRoomForStaff(state: SeasonState, clubId: string): number {
  if (!usesWagePool(state) || !state.employment?.enabledSince) return 0;
  const signed = effectiveContractsForRound(state.employment, state.seasonNumber, state.round).filter(contract => contract.clubId === clubId).reduce((sum, contract) => sum + contract.seasonWage, 0);
  const pending = getInSeasonOffers(state, clubId, true).reduce((sum, offer) => sum + offer.seasonWage, 0);
  return Math.max(0, seasonSalaryBudget(state, clubId, state.seasonNumber) - signed - pending);
}

/** The most this season's staff fees may add up to: the staff budget, plus unused player salary budget in the wage pool. */
export function staffLimit(state: SeasonState, clubId: string): number {
  return staffAllocation(state, clubId) + wageRoomForStaff(state, clubId);
}

export interface WagesLeft {
  /** The season the pool is for: this season while it is played, the coming season in the offseason. */
  seasonNumber: number;
  /** Player salary budget plus staff budget of that season. */
  pool: number;
  /** Player wages of that season, including pending offers. */
  players: number;
  /** Fees of the staff employed now. */
  staff: number;
  /** What is left in the pool (never below zero). */
  amount: number;
}

/**
 * Wages left, as the budget bar shows it: one pool for player wages and staff fees. In careers before the wage pool the
 * same sum is shown, but there the two parts keep their own limits (see the budget details).
 */
export function wagesLeft(state: SeasonState, clubId = state.managedClubId): WagesLeft {
  const seasonNumber = state.status === 'complete' ? state.seasonNumber + 1 : state.seasonNumber;
  const staff = state.coaching ? staffCommitted(state, clubId) : 0;
  let players = 0;
  if (state.employment?.enabledSince) {
    if (seasonNumber === state.seasonNumber) {
      players = effectiveContractsForRound(state.employment, seasonNumber, state.round).filter(contract => contract.clubId === clubId).reduce((sum, contract) => sum + contract.seasonWage, 0) + getInSeasonOffers(state, clubId, true).reduce((sum, offer) => sum + offer.seasonWage, 0);
    } else {
      const summary = getClubContractSummary(state, clubId, seasonNumber);
      players = summary.seasonWages + summary.reservedWages;
    }
  }
  const pool = seasonSalaryBudget(state, clubId, seasonNumber) + staffAllocation(state, clubId, seasonNumber);
  return { seasonNumber, pool, players, staff, amount: Math.max(0, pool - players - staff) };
}

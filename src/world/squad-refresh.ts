import type { EmploymentContract } from '../domain/employment';
import type { SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { minRosterSize } from './club-roster-policy';
import { getMarketWindow } from './market-policy';
import { getCareerPlayerAge } from './player-catalog';
import { playerHeadroom } from './potential';
import { clubAppetite, plannedSurplusSpend, spendsSurplus } from './surplus-spending';
import { usesSpendingBalance } from './spending-balance';
import { SCOUTING_ATTRIBUTES, scoutingActualAttributes } from './scouting-policy';

/**
 * Format 101 (owner decision, 24 November 2026, provisional number: "rich clubs with a full squad should refresh it:
 * sell or release a weak player to make room for a better one"). Reversible game defaults, not researched figures.
 *
 * Measured before (format 89 and 99): a rich club whose squad was already full (Breogán) could not turn its spending
 * appetite into anything, because automatic recruitment stops at the squad target, so its cash kept piling up.
 *
 * Rules, for new careers with the spending balance (`world.squadRefresh`; its withdrawal of offers that no longer fit
 * after an agreed sale keeps the window safe when refreshes add sales), in the offseason recruitment window, for clubs run
 * automatically (computer clubs, and the manager's club only when he delegates recruitment) that spend from a surplus
 * (`spendsSurplus`) and whose squad for next season is full (contracts and open offers reach the squad target):
 * - **Ratings:** players are judged by their real skills (the sum of the seven skills, 1-20 each, after practice and
 *   age: `refreshRating`), as a club's coaches and scouts know the league's players: a computer club's scouting rarely
 *   covers free agents, whose unknown ratings would otherwise all read the same.
 * - **Who may go:** the club's weakest players for next season, at most `weakestConsidered` of them, never one it signed or renewed this season (opening contracts excepted), a drafted rookie, a player
 *   other clubs have open offers for, or a young prospect: aged at most `protectAge`, or at most `prospectAge` with at
 *   least `prospectHeadroom` points of hidden potential left. Of equal ratings, the cheaper release first.
 * - **Who comes:** a player of the same position (squad balance by position is kept exactly) rated at least `margin`
 *   points above the player who leaves (about six overall points), a free agent or a paid transfer
 *   under the usual market rules (a paid one only while a free agent as good as the player released is also there, in
 *   case the bid fails); the best such player.
 * - **Money:** the release pays the existing contract buyout (every remaining guaranteed wage, from Spending left), and
 *   the release plus any transfer fee stay within the club's transfer budget from its surplus. The new contract must fit
 *   the club's wage guards once the released wage is freed (the usual contract quote and the low-cash wage check).
 *   NBA clubs sign free agents only, and the released salary stays on their payroll as dead money (cap rules unchanged).
 * - **Limits:** one refresh a window, two from `secondRefreshAppetite`; never below the minimum squad (eight, or 13 for NBA
 *   clubs) after the release; never on the last proposal day, so a lost bid can still be replaced.
 * - The released player is a free agent at once: any club may sign him.
 */
export const SQUAD_REFRESH_RULES = Object.freeze({
  /** How much better (recruitment rating: the sum of the seven skills, 1-20 each) a signing must be than the player released. */
  margin: 5,
  /** The weakest players of the squad a club looks at releasing. */
  weakestConsidered: 3,
  /** Players this young are never released. */
  protectAge: 21,
  /** Players this young with at least `prospectHeadroom` rating points of hidden potential are never released. */
  prospectAge: 23,
  prospectHeadroom: 2,
  /** Refreshes a club makes in one offseason window: one, two from this squad appetite. */
  secondRefreshAppetite: 0.5,
});

/** Format 101: whether the career's world carries the squad refresh (new careers with the spending balance). */
export function usesSquadRefresh(context: WorldContext | undefined): boolean {
  return context?.world?.squadRefresh === true && usesSpendingBalance(context);
}

/** Format 101: the refreshes (contract releases) a club has made in this offseason window. */
export function refreshesThisWindow(state: SeasonState, clubId: string): number {
  return getMarketWindow(state)?.events.filter(event => event.type === 'buyout' && event.clubId === clubId).length ?? 0;
}

/** Format 101: the refreshes a club may make in one window, by its squad appetite (0 when it does not spend from a surplus). */
export function refreshLimit(state: SeasonState, clubId: string): number {
  if (!usesSquadRefresh(state) || !spendsSurplus(state, clubId)) return 0;
  return clubAppetite(state, clubId, 'squad') >= SQUAD_REFRESH_RULES.secondRefreshAppetite ? 2 : 1;
}

/** Format 101: whether a player is a young prospect a club keeps (too young, or young with potential left). */
export function protectedProspect(state: SeasonState, playerId: string): boolean {
  const age = getCareerPlayerAge(state, playerId, state.date);
  if (age === null) return false;
  const rules = SQUAD_REFRESH_RULES;
  return age <= rules.protectAge || age <= rules.prospectAge && playerHeadroom(state, playerId) >= rules.prospectHeadroom;
}

/**
 * Format 101: the players a club may release to refresh its squad, weakest first (`rating` is the club's recruitment
 * rating; `cost` the release's price); empty when releasing one would take the squad below its minimum.
 */
export function releaseCandidates(state: SeasonState, clubId: string, contracts: readonly EmploymentContract[], rating: (playerId: string) => number, busy: ReadonlySet<string>, cost: (playerId: string) => number): string[] {
  if (contracts.length - 1 < minRosterSize(state, clubId)) return [];
  return contracts
    .filter(contract => (contract.signedSeason < state.seasonNumber || contract.kind === 'initial' || contract.kind === 'joined') && contract.kind !== 'drafted' && !busy.has(contract.playerId) && !protectedProspect(state, contract.playerId))
    .map(contract => contract.playerId)
    .sort((left, right) => rating(left) - rating(right) || cost(left) - cost(right) || left.localeCompare(right, 'en'))
    .slice(0, SQUAD_REFRESH_RULES.weakestConsidered);
}

/** Format 101: a player's rating for a refresh: the sum of his seven real skills (after practice and age). */
export function refreshRating(state: SeasonState, playerId: string): number {
  const attributes = scoutingActualAttributes(state, playerId);
  return SCOUTING_ATTRIBUTES.reduce((sum, key) => sum + attributes[key], 0);
}

/** Format 101: the most a refresh may cost (the release plus any transfer fee): the club's planned spending from its surplus. */
export function refreshBudget(state: SeasonState, clubId: string): number {
  return usesSquadRefresh(state) ? plannedSurplusSpend(state, clubId) : 0;
}

import { NBA_CAP_2026_27 } from '../data/nba-payrolls';
import type { CareerWorld, WorldContext } from '../domain/world';
import type { SeasonState } from '../domain/season';
import type { PlayerAttributes } from '../domain/types';
import { isNbaClub, seasonRounds, worldOf } from './career-world';
import { overallRating } from './overall-rating';
import { applyAgingAttributes } from './lifecycle-policy';
import { getCareerPlayer, getCareerPlayerAge, type CareerPlayerContext } from './player-catalog';
import { usdToCents } from './nba-cap';
import { addMarketDays, MARKET_WINDOW_DAYS } from './market-policy';
import { dateForRound } from './season';

/**
 * NBA step 7 (format 93, new NBA worlds with `world.nba.moves`): free agency and moves between the NBA and Europe.
 *
 * - **Choice of offers.** A free agent whose NBA value (his overall rating today) reaches `nbaLevel` takes an NBA offer
 *   before any European one (the NBA pays far more; owner, 23 November 2026); below it he takes the best European
 *   offer first. Within each group the best terms win as before.
 * - **European wages for NBA players.** A player paid on the NBA's scale (one listed by an NBA club when the world was
 *   built) asks a European club only what Europeans of his rating earn (`europeanWage`): at any time when he is below
 *   the NBA level; otherwise only once the NBA's free agency is late (`NBA_LATE_FREE_AGENCY_DAYS` before recruitment
 *   closes) or during the season, when no NBA contract came.
 * - **Europeans to the NBA.** An NBA club signs a European (a player never paid on the NBA's scale nor under an NBA
 *   contract) only from 23 (younger ones come through the draft) and at `europeanLevel`; a computer club at most
 *   `europeansPerWindow` in one offseason. A European under contract joins only through his release clause (the CBA's
 *   buyout: the NBA club pays up to about $875k, the player the rest; the game books the whole clause to the NBA club),
 *   otherwise he waits for his contract to end. NBA players under contract are never sold to European clubs, and NBA
 *   clubs exchange players under contract only by trade. In season an NBA club signs free agents only (minimum
 *   contracts, format 92). Draft rights (the draft step) are not handled here.
 * - **Minimum team salary.** An NBA club whose payroll at the end of its regular season is below the minimum team
 *   salary pays the shortfall (`salary-floor` ledger entry; in the CBA it is shared among its players, here charged).
 * - **NBA-only worlds.** Retirements keep at least `populationPerClub` players per NBA club, and players still without
 *   a contract when the season opens leave the world (go abroad) while that many remain.
 *
 * [S] 2023 CBA: minimum team salary 90% of the cap ($148.465M, `NBA_CAP_2026_27`); buyout allowance about $875k.
 * [E] `nbaLevel` 65: about an NBA club's 11th man in the 2026-27 pack (8th man 70, 13th man 61); 514 Europeans reach it.
 */
export const NBA_MOVES_RULES = Object.freeze({
  model: 'nba-moves-1' as const,
  nbaLevel: 65,
  /** [E] A European (never paid on the NBA's scale) gets NBA offers from 23 at about an NBA club's 8th man (70 in the pack) and above. */
  europeanLevel: 72,
  europeanMinAge: 23,
  /** [E] An NBA club run by the computer signs at most this many Europeans in one offseason window. */
  europeansPerWindow: 1,
  minimumTeamSalaryUsd: NBA_CAP_2026_27.minimumTeamSalaryUsd,
  /** [E] NBA-only worlds: players kept per NBA club (a full roster of 15; with 14 a club the synthetic three-season test left three clubs short), so every club can reach 13. */
  populationPerClub: 15,
  /** [E] The European wage of a rating: the median wage of Europeans within this many overall points. */
  wageNeighbourhood: 2,
});

/** Whether a career's world uses NBA step 7's moves (format 93). */
export const usesNbaMoves = (context: WorldContext | undefined): boolean => context?.world?.nba?.moves === NBA_MOVES_RULES.model;

/** The minimum team salary in euro cents. */
export const NBA_MINIMUM_TEAM_SALARY = usdToCents(NBA_MOVES_RULES.minimumTeamSalaryUsd);

/** The shortfall (euro cents) of a payroll below the minimum team salary, 0 at or above it. */
export const nbaSalaryFloorShortfall = (payroll: number): number => Math.max(0, NBA_MINIMUM_TEAM_SALARY - payroll);

/** Whether a world holds only NBA clubs (no European club to move to). */
export function nbaOnlyWorld(world: CareerWorld): boolean {
  return !!world.nba && world.clubs.every(club => isNbaClub(world, club.id));
}

const nbaPaidSets = new WeakMap<CareerWorld, ReadonlySet<string>>();
/** Players paid on the NBA's scale: those an NBA club listed when the world was built. */
export function isNbaPaidPlayer(world: CareerWorld, playerId: string): boolean {
  let ids = nbaPaidSets.get(world);
  if (!ids) { ids = new Set(world.clubs.filter(club => isNbaClub(world, club.id)).flatMap(club => club.players.map(player => player.id))); nbaPaidSets.set(world, ids); }
  return ids.has(playerId);
}

/** A player's NBA value: his overall rating at his position on the context's date (ageing included, training not). */
export function nbaValue(context: CareerPlayerContext, playerId: string): number {
  let player;
  try { player = getCareerPlayer(context, playerId); } catch { return 0; }
  const attributes: PlayerAttributes = context.date ? applyAgingAttributes(context, playerId, player.attributes, context.date) : player.attributes;
  return overallRating(attributes, player.position);
}

/** Whether a player is good enough for the NBA (`nbaLevel`). */
export const isNbaLevel = (context: CareerPlayerContext, playerId: string): boolean => nbaValue(context, playerId) >= NBA_MOVES_RULES.nbaLevel;

const europeanCurves = new WeakMap<CareerWorld, readonly (number | null)[]>();
/** The European wage (euro cents) of each overall rating 0-99 in a world: the median wage of its Europeans nearby. */
function europeanCurve(world: CareerWorld): readonly (number | null)[] {
  let curve = europeanCurves.get(world);
  if (curve) return curve;
  const rows: { rating: number; wage: number }[] = [];
  for (const club of world.clubs) if (!isNbaClub(world, club.id)) for (const player of club.players) {
    const wage = world.wages[player.id];
    if (wage !== undefined) rows.push({ rating: overallRating(player.attributes, player.position), wage });
  }
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]!; };
  const top = Math.max(-1, ...rows.map(row => row.rating)), spread = NBA_MOVES_RULES.wageNeighbourhood;
  const best = rows.filter(row => row.rating >= top - spread).map(row => row.wage);
  curve = Array.from({ length: 100 }, (_, rating) => {
    if (!rows.length) return null;
    if (rating > top) return median(best);
    // The nearest ratings with Europeans (widening until some are found; the best ones always exist).
    for (let width = spread; ; width += 1) {
      const near = rows.filter(row => Math.abs(row.rating - rating) <= width).map(row => row.wage);
      if (near.length) return median(near);
    }
  });
  europeanCurves.set(world, curve);
  return curve;
}

/** What a player paid on the NBA's scale asks a European club: the European wage of his rating (null without Europeans). */
export function europeanWage(context: CareerPlayerContext, playerId: string): number | null {
  const wage = europeanCurve(worldOf(context))[Math.max(0, Math.min(99, nbaValue(context, playerId)))];
  return wage === null || wage === undefined ? null : Math.max(500_000, Math.ceil(wage / 50_000) * 50_000);
}

/** [E] Days before recruitment closes from which NBA-level free agents accept European wages (as late NBA free agents accept the minimum, format 92). */
export const NBA_LATE_EUROPE_DAYS = 7;

/**
 * The demand (euro cents) of a player paid on the NBA's scale from a European club, or null when his usual demand
 * applies (format 93): his European wage when below the NBA level, or late in the offseason window, or during the
 * season; never more than his usual demand. Depends only on the world, the date and the career's phase, so a save's
 * replay decides it the same way.
 */
export function nbaEuropeanDemand(context: CareerPlayerContext & { status?: 'active' | 'complete' }, playerId: string, clubId: string | undefined, usual: number): number | null {
  if (!clubId || !usesNbaMoves(context)) return null;
  const world = worldOf(context);
  if (isNbaClub(world, clubId) || !isNbaPaidPlayer(world, playerId)) return null;
  if (isNbaLevel(context, playerId) && context.status !== 'active') {
    if (context.status !== 'complete' || context.seasonNumber === undefined || !context.date) return null;
    const closesOn = addMarketDays(dateForRound(seasonRounds(context), context.seasonNumber), MARKET_WINDOW_DAYS);
    if (context.date < addMarketDays(closesOn, -NBA_LATE_EUROPE_DAYS)) return null;
  }
  const wage = europeanWage(context, playerId);
  return wage !== null && wage < usual ? wage : null;
}

/**
 * Format 93: the order of two offers for one player from the clubs' leagues alone: NBA offers first for a player at
 * the NBA level, European offers first below it; 0 when both come from the same side or the world has no moves.
 */
export function nbaOfferOrder(context: CareerPlayerContext, playerId: string, leftClubId: string, rightClubId: string): number {
  if (!usesNbaMoves(context)) return 0;
  const world = worldOf(context), left = isNbaClub(world, leftClubId), right = isNbaClub(world, rightClubId);
  if (left === right) return 0;
  return (left ? -1 : 1) * (isNbaLevel(context, playerId) ? 1 : -1);
}

/**
 * Format 93: why a transfer of a player under contract between these clubs is refused, or null. NBA clubs exchange
 * players under contract only by trade; NBA players under contract are not sold to European clubs; a European club's
 * player under contract joins an NBA club only through his release clause (in the CBA the NBA club pays up to the
 * buyout allowance and the player the rest; the game books the whole clause to the NBA club, a small sum beside NBA
 * money), otherwise he waits for his contract to end; in season NBA clubs sign free agents only.
 */
export function nbaTransferReason(context: WorldContext, sellerClubId: string, buyerClubId: string, inSeason = false, releaseClause = false): string | null {
  if (!usesNbaMoves(context)) return null;
  const world = context.world!, seller = isNbaClub(world, sellerClubId), buyer = isNbaClub(world, buyerClubId);
  if (seller && buyer) return 'NBA clubs exchange players under contract only by trade.';
  if (seller) return 'NBA players under contract are not sold to European clubs; they move when their contract ends.';
  if (!buyer) return null;
  if (inSeason) return 'During the season an NBA club signs free agents only, on minimum contracts.';
  if (!releaseClause) return 'A European player under contract joins an NBA club only through his release clause; otherwise he waits for his contract to end.';
  return null;
}

/**
 * Format 93: why an NBA club may not sign this player (null when it may). Players paid on the NBA's scale and players
 * who have had an NBA contract are NBA players; any other player (a European) needs to be 23 or older (younger ones
 * come through the draft) and at the level Europeans need for an NBA deal (`europeanLevel`).
 */
export function nbaEligibilityReason(context: CareerPlayerContext & { employment?: { contracts: readonly { playerId: string; clubId: string }[] } }, clubId: string, playerId: string): string | null {
  if (!usesNbaMoves(context)) return null;
  const world = worldOf(context);
  if (!isNbaClub(world, clubId) || isNbaPaidPlayer(world, playerId) || context.employment?.contracts.some(contract => contract.playerId === playerId && isNbaClub(world, contract.clubId))) return null;
  const age = context.date ? getCareerPlayerAge(context, playerId, context.date) : null;
  if (age !== null && age < NBA_MOVES_RULES.europeanMinAge) return `European players under ${NBA_MOVES_RULES.europeanMinAge} join the NBA through the draft.`;
  if (nbaValue(context, playerId) < NBA_MOVES_RULES.europeanLevel) return 'NBA clubs sign European players only at the level of an NBA rotation player.';
  return null;
}

/** One of a European club's players who signed an NBA contract (format 93): the new contract and the day he signed. */
export interface NbaDeparture { playerId: string; toClubId: string; contractId: string; date: string; fee: number | null }
/**
 * Format 93: the players of a European club who signed NBA contracts this season or in the offseason before it (as a
 * free agent after their contract with the club, or through a release clause), for the manager's Inbox.
 */
export function nbaDeparturesFrom(state: Pick<SeasonState, 'employment' | 'negotiations' | 'seasonNumber'> & WorldContext, clubId: string): NbaDeparture[] {
  if (!usesNbaMoves(state)) return [];
  const world = state.world!;
  if (isNbaClub(world, clubId)) return [];
  const departures: NbaDeparture[] = [];
  for (const contract of state.employment.contracts) {
    if (contract.kind === 'initial' || contract.kind === 'joined' || !isNbaClub(world, contract.clubId) || contract.startsSeason < state.seasonNumber) continue;
    const before = state.employment.contracts.some(old => old.playerId === contract.playerId && old.clubId === clubId && old.id !== contract.id && old.startsSeason <= contract.startsSeason - (contract.kind === 'transfer' ? 0 : 1) && old.endsSeason >= contract.startsSeason - 1);
    if (!before) continue;
    const reply = state.negotiations.records.find(record => record.contractId === contract.id);
    const transfer = state.employment.transfers.find(item => item.contractId === contract.id);
    departures.push({ playerId: contract.playerId, toClubId: contract.clubId, contractId: contract.id, date: reply?.date ?? '', fee: transfer?.fee ?? null });
  }
  return departures;
}

import type { BackgroundClub, ClubExchange, SeasonBackground } from '../domain/background';
import type { EmploymentContract, EmploymentDeparture, SeasonEmployment } from '../domain/employment';
import type { DomesticDivisions, SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import type { WorldContext } from '../domain/world';
import { backgroundClubsIn, backgroundSquad } from './background';
import { isMemberList, seasonRounds, worldOf } from './career-world';
import { careerMovesGovern } from './career';
import { seasonLeagues, type SeasonPostseason } from './divisions';
import { effectiveContractsForRound, effectiveContractsForSeason } from './employment-policy';
import { applyAgingAttributes, getPlayerRetirement, isPlayerRetired, lifecycleDateOfBirth, type LifecycleContext } from './lifecycle-policy';
import { lowerDivisionExchanges, squadStrength } from './lower-division';
import { getCareerWage } from './player-catalog';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { REAL_WORLD_RULES } from './real-world';

/**
 * Clubs leaving and joining the full world at a season end (step 3.4d-2). Decided when the season completes, from its
 * own divisions, postseason outcomes and the squads outside the full world; applied at the rollover. The functions take
 * the season's postseasons as input, so the season engine and the save checks share them.
 */
export type ExchangeContext = Pick<SeasonState, 'seed' | 'seasonNumber'> & Partial<Pick<SeasonState, 'career' | 'lifecycle' | 'academy'>> & WorldContext & { divisions?: DomesticDivisions | null; background?: SeasonBackground };

/** A returning club needs this many players who have not retired to come back. */
export const MIN_RETURNING_PLAYERS = 8;

/** The exchanges at the end of `context.seasonNumber`, or none (no next-division list, no divisions, not active yet, or no job changes). */
export function computeExchanges(context: ExchangeContext, postseasons: readonly SeasonPostseason[], nextStart: string): ClubExchange[] {
  const world = worldOf(context), lists = (world.lowerDivisions ?? []).filter(isMemberList), background = context.background;
  // The manager must always be able to move clubs: exchanges need the season-end job changes (career moves).
  if (!lists.length || !context.divisions || !background?.exchanges || context.seasonNumber < (background.changesFrom ?? Infinity) || !careerMovesGovern(context.career, context.seasonNumber)) return [];
  const leagues = seasonLeagues(world, context.divisions);
  const relegated = new Map(postseasons.map(entry => [entry.league.id, entry.outcome.relegated.flatMap(item => item.clubId ? [item.clubId] : [])]));
  const away = backgroundClubsIn(background, context.seasonNumber);
  const available = (club: BackgroundClub) => club.players.filter(player => !isPlayerRetired(context, player.id, context.seasonNumber + 1, 1));
  const squadOf = (clubId: string) => {
    const record = away.find(club => club.id === clubId);
    if (record) return backgroundSquad(context, { ...record, players: available(record) }, nextStart).players;
    return world.clubs.find(club => club.id === clubId)!.players.map(player => ({ ...player, attributes: applyAgingAttributes(context, player.id, player.attributes, nextStart) }));
  };
  return lowerDivisionExchanges({
    seed: context.seed, seasonNumber: context.seasonNumber, leagues, relegated, lowerDivisions: lists,
    background: away, strengthOf: clubId => squadStrength(squadOf(clubId)),
    eligible: clubId => { const record = away.find(club => club.id === clubId); return !record || available(record).length >= MIN_RETURNING_PLAYERS; },
  }).map(item => ({ seasonNumber: context.seasonNumber, leagueId: item.leagueId, leaving: item.leaving, joining: item.joining.map(entry => entry.clubId) }));
}

/** A club leaving at the end of `seasonNumber` loses every term from the following season on. */
export function departureFor(employment: SeasonEmployment, clubId: string, seasonNumber: number): EmploymentDeparture {
  const startsSeason = seasonNumber + 1;
  const effective = new Set([0, 1, 2].flatMap(offset => effectiveContractsForSeason(employment, startsSeason + offset)).filter(contract => contract.clubId === clubId).map(contract => contract.id));
  return { clubId, seasonNumber, startsSeason, releasedContractIds: employment.contracts.filter(contract => effective.has(contract.id)).map(contract => contract.id) };
}

/** A stable value in [0, 2^32) for a player, from an independent stream (never match randomness). */
function stable(seed: number, key: string): number { let value = (2166136261 ^ seed) >>> 0; for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; }

/**
 * Opening terms for a joining club's squad from the season after `seasonNumber`: a first-time club's generated players
 * on their estimated wages and lengths; a returning club's players (those not retired) on their career wages and
 * lengths estimated by age, never beyond an announced retirement.
 */
export function joinedContracts(context: ExchangeContext, exchange: ClubExchange, firstId: number, start: string): EmploymentContract[] {
  const world = worldOf(context), startsSeason = exchange.seasonNumber + 1;
  const away = backgroundClubsIn(context.background, exchange.seasonNumber);
  const rounds = seasonRounds(context);
  let next = firstId;
  return exchange.joining.flatMap(clubId => {
    const record = away.find(club => club.id === clubId);
    const players = record ? record.players.filter(player => !isPlayerRetired(context, player.id, startsSeason, 1)) : world.clubs.find(club => club.id === clubId)!.players;
    return players.map(player => {
      const wage = Object.hasOwn(world.wages, player.id) ? world.wages[player.id]! : getCareerWage(context, player.id);
      const dateOfBirth = lifecycleDateOfBirth(context, player.id);
      const years = record ? REAL_WORLD_RULES.contractYears(dateOfBirth ? playerAgeOnDate(dateOfBirth, start) ?? REAL_WORLD_RULES.defaultAge : REAL_WORLD_RULES.defaultAge, stable(context.seed, player.id)) : world.playerContracts?.[player.id] ?? 1;
      const notice = getPlayerRetirement(context, player.id, start).notice;
      const endsSeason = Math.min(exchange.seasonNumber + years, notice ? Math.max(startsSeason, notice.lastSeason) : Infinity);
      return { id: `employment-contract-${next++}`, playerId: player.id, clubId, startsSeason, startsRound: 1, endsSeason, seasonWage: wage, signedSeason: exchange.seasonNumber, signedRound: rounds, kind: 'joined' as const };
    });
  });
}

/** A leaving club's record: its final registration of the season, minus players with another club's terms next season. */
export function leavingRecord(context: WorldContext, team: Team, country: string, since: number, employment: SeasonEmployment | null): BackgroundClub {
  const identity = worldOf(context).clubs.find(club => club.id === team.id)!;
  // Next season's opening registrations: later in-season changes never alter who left with the club.
  const elsewhere = new Set(employment ? effectiveContractsForRound(employment, since, 1).filter(contract => contract.clubId !== team.id).map(contract => contract.playerId) : []);
  return { id: team.id, name: identity.name, shortName: identity.shortName, color: identity.color, country, origin: 'relegated', since, players: team.players.filter(player => !elsewhere.has(player.id)).map(player => ({ ...player, attributes: { ...player.attributes } })) };
}

/** The lifecycle context the exchange reads (aging and retirements). */
export type { LifecycleContext };

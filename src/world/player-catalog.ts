import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import type { WorldContext } from '../domain/world';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { roundKey, seasonRounds, worldOf, worldPlayer, worldPlayers } from './career-world';
import { isPlayerRetired } from './lifecycle-policy';

/** A catalog is local to a career and a calendar boundary, never a global mutable registry. */
export type CareerPlayerContext = Partial<Pick<SeasonState, 'academy' | 'lifecycle' | 'seasonNumber' | 'round' | 'date'>> & WorldContext;

function atBoundary(context: CareerPlayerContext, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): number {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 7974 || !Number.isInteger(round) || round < 1 || round > seasonRounds(context)) throw new Error('Choose a supported player-catalog calendar boundary.');
  return roundKey(seasonNumber, round);
}

/** Only graduates available at this boundary join the ordinary recruitment/scouting population. */
export function getCareerPlayers(context: CareerPlayerContext, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): readonly Player[] {
  const boundary = atBoundary(context, seasonNumber, round);
  const graduates = context.academy?.enabledSince ? context.academy.graduates.filter(entry => roundKey(entry.availableSince.seasonNumber, entry.availableSince.round) <= boundary) : [];
  const originals = worldPlayers(worldOf(context));
  return graduates.length ? [...originals, ...graduates.map(entry => entry.player)] : originals;
}

/** Currently known seniors who can still play at the requested registration boundary.
 * Future availability never introduces a prospect who has not graduated yet.
 * Historical identity, payroll and report readers keep using getCareerPlayers.
 */
export function getActiveCareerPlayers(context: CareerPlayerContext, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): readonly Player[] {
  const requested = atBoundary(context, seasonNumber, round), known = atBoundary(context);
  const players = requested < known ? getCareerPlayers(context, seasonNumber, round) : getCareerPlayers(context);
  return players.filter(player => !isPlayerRetired(context, player.id, seasonNumber, round));
}

/** Scalar identity lookup also serves pending academy promotion offers, after actual intake only. */
export function getCareerPlayer(context: CareerPlayerContext, playerId: string, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): Player {
  const boundary = atBoundary(context, seasonNumber, round);
  const original = worldPlayer(worldOf(context), playerId);
  if (original) return original;
  if (context.academy?.enabledSince) {
    const graduate = context.academy.graduates.find(entry => entry.player.id === playerId && roundKey(entry.availableSince.seasonNumber, entry.availableSince.round) <= boundary);
    if (graduate) return graduate.player;
    const prospect = context.academy.prospects.find(entry => entry.player.id === playerId && roundKey(entry.intakeSeason, entry.intakeRound) <= boundary);
    if (prospect) return prospect.player;
  }
  throw new Error('Choose a player who exists in this career at this date.');
}

export function getCareerWage(context: CareerPlayerContext, playerId: string): number {
  getCareerPlayer(context, playerId);
  const wages = worldOf(context).wages;
  if (Object.hasOwn(wages, playerId)) return wages[playerId]!;
  const prospect = context.academy?.prospects.find(entry => entry.player.id === playerId);
  if (prospect) return prospect.seasonWage;
  throw new Error('This career has no wage terms for the selected player.');
}

export function getCareerPlayerAge(context: CareerPlayerContext, playerId: string, onDate: string): number | null {
  const profiles = worldOf(context).playerProfiles;
  const original = Object.hasOwn(profiles, playerId) ? profiles[playerId] : undefined;
  if (original) return playerAgeOnDate(original.dateOfBirth, onDate);
  const boundary = atBoundary(context);
  const prospect = context.academy?.enabledSince ? context.academy.prospects.find(entry => entry.player.id === playerId && roundKey(entry.intakeSeason, entry.intakeRound) <= boundary) : undefined;
  return playerAgeOnDate(prospect?.dateOfBirth, onDate);
}

import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import type { WorldContext } from '../domain/world';
import type { AcademyProspect } from '../domain/academy';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { joinedPlayers, roundKey, seasonRounds, worldOf, worldPlayer, worldPlayers } from './career-world';
import { isPlayerRetired } from './lifecycle-policy';
import { scaledMoney } from './economy';

/** A catalog is local to a career and a calendar boundary, never a global mutable registry. */
export type CareerPlayerContext = Partial<Pick<SeasonState, 'academy' | 'lifecycle' | 'seasonNumber' | 'round' | 'date' | 'background'>> & WorldContext;

function atBoundary(context: CareerPlayerContext, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): number {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 7974 || !Number.isInteger(round) || round < 1 || round > seasonRounds(context)) throw new Error('Choose a supported player-catalog calendar boundary.');
  return roundKey(seasonNumber, round);
}

/** Only graduates available at this boundary join the ordinary recruitment/scouting population. */
export function getCareerPlayers(context: CareerPlayerContext, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): readonly Player[] {
  const boundary = atBoundary(context, seasonNumber, round);
  const graduates = context.academy?.enabledSince ? context.academy.graduates.filter(entry => roundKey(entry.availableSince.seasonNumber, entry.availableSince.round) <= boundary) : [];
  const originals = worldPlayers(worldOf(context));
  // Format 55: generated players of next-division clubs join the catalog with their club (step 3.4d-2).
  const joined = joinedPlayers(context, seasonNumber);
  return graduates.length || joined.length ? [...originals, ...joined, ...graduates.map(entry => entry.player)] : originals;
}

/** Currently known seniors who can still play at the requested registration boundary.
 * Future availability never introduces a prospect who has not graduated yet.
 * Historical identity, payroll and report readers keep using getCareerPlayers.
 */
export function getActiveCareerPlayers(context: CareerPlayerContext, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): readonly Player[] {
  const requested = atBoundary(context, seasonNumber, round), known = atBoundary(context);
  const players = requested < known ? getCareerPlayers(context, seasonNumber, round) : getCareerPlayers(context);
  // Players who left the full world with their club cannot be signed or scouted while the club is away (step 3.4d-2).
  const away = new Set((context.background?.clubs ?? []).filter(club => club.since <= seasonNumber && (club.until === undefined || seasonNumber < club.until)).flatMap(club => club.players.map(player => player.id)));
  return players.filter(player => !away.has(player.id) && !isPlayerRetired(context, player.id, seasonNumber, round));
}

/** Scalar identity lookup also serves pending academy promotion offers, after actual intake only. */
export function getCareerPlayer(context: CareerPlayerContext, playerId: string, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): Player {
  const boundary = atBoundary(context, seasonNumber, round);
  const original = worldPlayer(worldOf(context), playerId) ?? joinedPlayers(context, seasonNumber).find(player => player.id === playerId);
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
  if (prospect) return academyWage(context, prospect);
  throw new Error('This career has no wage terms for the selected player.');
}

/**
 * An academy prospect's asking wage: his intake's catalog wage (EUR 5,000-8,000) in the development economy; in worlds
 * with an economy the same amount at his club's opening money level (money gaps fix, 16 November 2026), in EUR 500
 * steps and never below the EUR 5,000 contract minimum. The opening level keeps it fixed for the whole career.
 */
export function academyWage(context: WorldContext, prospect: Pick<AcademyProspect, 'clubId' | 'seasonWage'>): number {
  return Math.max(500_000, scaledMoney({ world: worldOf(context) }, prospect.clubId, prospect.seasonWage, 50_000));
}

export function getCareerPlayerAge(context: CareerPlayerContext, playerId: string, onDate: string): number | null {
  const profiles = worldOf(context).playerProfiles;
  const original = Object.hasOwn(profiles, playerId) ? profiles[playerId] : undefined;
  if (original) return playerAgeOnDate(original.dateOfBirth, onDate);
  const boundary = atBoundary(context);
  const prospect = context.academy?.enabledSince ? context.academy.prospects.find(entry => entry.player.id === playerId && roundKey(entry.intakeSeason, entry.intakeRound) <= boundary) : undefined;
  return playerAgeOnDate(prospect?.dateOfBirth, onDate);
}

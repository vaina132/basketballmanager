import type { SeasonState } from '../domain/season';
import type { Player } from '../domain/types';
import type { AcademyGraduate } from '../domain/academy';
import type { WorldContext } from '../domain/world';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { joinedPlayers, playerInList, roundKey, seasonRounds, worldOf, worldPlayer, worldPlayers } from './career-world';
import { isPlayerRetired } from './lifecycle-policy';

/** A catalog is local to a career and a calendar boundary, never a global mutable registry. */
export type CareerPlayerContext = Partial<Pick<SeasonState, 'academy' | 'lifecycle' | 'seasonNumber' | 'round' | 'date' | 'background'>> & WorldContext;

function atBoundary(context: CareerPlayerContext, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): number {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 7974 || !Number.isInteger(round) || round < 1 || round > seasonRounds(context)) throw new Error('Choose a supported player-catalog calendar boundary.');
  return roundKey(seasonNumber, round);
}

// Step 3.7: catalogs are built once per world, joined players and graduate list (all replaced, never edited; the length
// guards against a list edited anyway). Once a career had graduates or joined clubs every catalog read copied the whole
// world's players again, so later seasons slowed down. The lists are shared, so callers must not change them.
const NO_PLAYERS: readonly Player[] = Object.freeze([]);
const graduateLists = new WeakMap<readonly AcademyGraduate[], { length: number; byBoundary: Map<number, readonly Player[]> }>();
function graduatesAt(graduates: readonly AcademyGraduate[], boundary: number): readonly Player[] {
  let known = graduateLists.get(graduates);
  if (!known || known.length !== graduates.length) { known = { length: graduates.length, byBoundary: new Map() }; graduateLists.set(graduates, known); }
  let players = known.byBoundary.get(boundary);
  if (!players) {
    const available = graduates.filter(entry => roundKey(entry.availableSince.seasonNumber, entry.availableSince.round) <= boundary);
    players = available.length ? Object.freeze(available.map(entry => entry.player)) : NO_PLAYERS;
    known.byBoundary.set(boundary, players);
  }
  return players;
}
const catalogs = new WeakMap<readonly Player[], WeakMap<readonly Player[], WeakMap<readonly Player[], readonly Player[]>>>();
function catalogOf(originals: readonly Player[], joined: readonly Player[], graduates: readonly Player[]): readonly Player[] {
  if (!joined.length && !graduates.length) return originals;
  let byJoined = catalogs.get(originals);
  if (!byJoined) { byJoined = new WeakMap(); catalogs.set(originals, byJoined); }
  let byGraduates = byJoined.get(joined);
  if (!byGraduates) { byGraduates = new WeakMap(); byJoined.set(joined, byGraduates); }
  let catalog = byGraduates.get(graduates);
  if (!catalog) { catalog = Object.freeze([...originals, ...joined, ...graduates]); byGraduates.set(graduates, catalog); }
  return catalog;
}

/** Only graduates available at this boundary join the ordinary recruitment/scouting population. */
export function getCareerPlayers(context: CareerPlayerContext, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): readonly Player[] {
  const boundary = atBoundary(context, seasonNumber, round);
  const graduates = context.academy?.enabledSince ? graduatesAt(context.academy.graduates, boundary) : NO_PLAYERS;
  const originals = worldPlayers(worldOf(context));
  // Format 55: generated players of next-division clubs join the catalog with their club (step 3.4d-2).
  const joined = joinedPlayers(context, seasonNumber);
  return catalogOf(originals, joined, graduates);
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
  const original = worldPlayer(worldOf(context), playerId) ?? playerInList(joinedPlayers(context, seasonNumber), playerId);
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

import type { RosterSnapshot } from '../domain/roster';
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season';
import type { Team } from '../domain/types';

/** Capture identities once at registration; match development never rewrites them. */
export function createRosterSnapshots(clubs: readonly Team[], seasonNumber: number): RosterSnapshot[] {
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1) throw new Error('Roster snapshots require a valid season number.');
  if (new Set(clubs.map(club => club.id)).size !== clubs.length) throw new Error('Roster snapshots require distinct clubs.');
  const playerIds = clubs.flatMap(club => club.players.map(player => player.id));
  if (new Set(playerIds).size !== playerIds.length) throw new Error('A registered player cannot belong to two clubs at once.');
  return clubs.map(club => ({
    id: `roster-s${seasonNumber}-${club.id}-r1`, clubId: club.id, fromRound: 1,
    players: club.players.map(player => ({ ...player, attributes: { ...player.attributes } })),
  }));
}

/** Resolve the registration effective at this boundary, irrespective of array order. */
export function rosterForRound(rosters: readonly RosterSnapshot[], clubId: string, round: number): RosterSnapshot {
  if (!Number.isInteger(round) || round < 1 || round > 10) throw new Error('Choose a roster round between one and ten.');
  const eligible = rosters.filter(roster => roster.clubId === clubId && roster.fromRound <= round);
  if (!eligible.length) throw new Error('The club has no registered roster for this round.');
  const fromRound = Math.max(...eligible.map(roster => roster.fromRound));
  const latest = eligible.filter(roster => roster.fromRound === fromRound);
  if (latest.length !== 1) throw new Error('The club has ambiguous roster registrations for this round.');
  return latest[0]!;
}

export interface SeasonRosterData {
  seasonNumber: number;
  rosters: readonly RosterSnapshot[];
  fixtures: readonly (SeasonFixture | ArchivedFixture)[];
}

export function getSeasonRosterData(season: SeasonState, seasonNumber = season.seasonNumber): SeasonRosterData {
  if (seasonNumber === season.seasonNumber) return { seasonNumber, rosters: season.rosters, fixtures: season.fixtures };
  const archive = season.history.find(candidate => candidate.seasonNumber === seasonNumber);
  if (!archive) throw new Error('Choose an available career season.');
  return archive;
}

/** A historical fixture's players come from its registration, never today's squad. */
export function getFixtureTeams(season: SeasonState, fixture: SeasonFixture | ArchivedFixture, seasonNumber = season.seasonNumber): { home: Team; away: Team } {
  const { rosters } = getSeasonRosterData(season, seasonNumber);
  function team(clubId: string, side: 'home' | 'away'): Team {
    const club = season.clubs.find(candidate => candidate.id === clubId);
    if (!club) throw new Error('A fixture refers to an unknown club.');
    const expected = rosterForRound(rosters, clubId, fixture.round);
    const snapshot = fixture.result ? rosters.find(candidate => candidate.id === fixture.result!.rosterIds[side]) : expected;
    if (!snapshot || snapshot.clubId !== clubId || snapshot.id !== expected.id) throw new Error('The fixture refers to an invalid historical roster.');
    return { ...club, players: snapshot.players };
  }
  const home = team(fixture.homeClubId, 'home'), away = team(fixture.awayClubId, 'away');
  const players = [...home.players, ...away.players].map(player => player.id);
  if (new Set(players).size !== players.length) throw new Error('A fixture cannot register the same player twice.');
  return { home, away };
}

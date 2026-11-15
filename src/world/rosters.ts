import type { RosterSnapshot } from '../domain/roster';
import type { ArchivedFixture, SeasonFixture, SeasonState } from '../domain/season';
import type { Team } from '../domain/types';
import type { EmploymentContract } from '../domain/employment';
import { getContractedClubsForRound } from './employment-policy';
import { MAX_SEASON_ROUNDS, worldOf } from './career-world';
import { backgroundSide } from './europe';
import { reconcileMatchdayPlan, selectedTeam } from './matchday-selection';

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

/** Registration is one boundary operation after old-squad training and match commitment. */
export function registerInSeasonArrivals(state: SeasonState, contracts: readonly EmploymentContract[]): SeasonState {
  if (!contracts.length) return state;
  if (state.status !== 'active' || contracts.some(contract => !['midseason', 'midseason-transfer'].includes(contract.kind) || contract.startsSeason !== state.seasonNumber || contract.startsRound !== state.round)) throw new Error('Register new players on their agreed matchday.');
  const moved = state.employment.transfers.filter(transfer => contracts.some(contract => contract.id === transfer.contractId));
  const affected = new Set([...contracts.map(contract => contract.clubId), ...moved.map(transfer => transfer.fromClubId)]);
  const canonical = getContractedClubsForRound(state, state.seasonNumber, state.round);
  const clubs = state.clubs.map(club => {
    if (!affected.has(club.id)) return club;
    const rebuilt = canonical.find(item => item.id === club.id)!;
    const previous = new Map(club.players.map(player => [player.id, player]));
    for (const player of club.players) {
      const remains = rebuilt.players.find(item => item.id === player.id);
      if (remains ? remains.number !== player.number : !moved.some(transfer => transfer.playerId === player.id && transfer.fromClubId === club.id)) throw new Error('Registration must preserve every remaining teammate and jersey number.');
    }
    return { ...club, players: rebuilt.players.map(player => previous.get(player.id) ?? player) };
  });
  const added = clubs.filter(club => affected.has(club.id)).map(club => ({ id: `roster-s${state.seasonNumber}-${club.id}-r${state.round}`, clubId: club.id, fromRound: state.round, players: club.players.map(player => ({ ...player, attributes: { ...player.attributes } })) }));
  if (added.some(roster => state.rosters.some(existing => existing.id === roster.id))) throw new Error('This registration boundary has already been recorded.');
  return { ...state, clubs, rosters: [...state.rosters, ...added], plans: Object.fromEntries(clubs.map(club => {
    const plan = state.plans[club.id]!;
    if (!affected.has(club.id)) return [club.id, plan];
    const registered = new Set(club.players.map(player => player.id));
    const lineup = [...new Set([...plan.lineup.filter(id => registered.has(id)), ...club.players.map(player => player.id)])].slice(0, 5);
    return [club.id, reconcileMatchdayPlan({ ...plan, lineup }, club)];
  })), training: { ...state.training, plans: Object.fromEntries(clubs.map(club => {
    const plan = state.training.plans[club.id]!;
    return [club.id, affected.has(club.id) ? { ...plan, individual: Object.fromEntries(club.players.map(player => [player.id, plan.individual[player.id] ?? 'team'])) } : plan];
  })) } };
}

/** Resolve the registration effective at this boundary, irrespective of array order. */
export function rosterForRound(rosters: readonly RosterSnapshot[], clubId: string, round: number): RosterSnapshot {
  if (!Number.isInteger(round) || round < 1 || round > MAX_SEASON_ROUNDS) throw new Error('Choose a supported roster matchday.');
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
  summary?: SeasonState['history'][number]['summary'];
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
    // Step 3.5b: a European game's club outside the full world that season plays its background squad.
    if (fixture.competition && !rosters.some(roster => roster.clubId === clubId)) {
      const squad = backgroundSide(season, clubId, seasonNumber);
      return fixture.result?.selection ? { ...squad, players: fixture.result.selection[side].map(id => squad.players.find(player => player.id === id)!) } : squad;
    }
    const club = season.clubs.find(candidate => candidate.id === clubId) ?? worldOf(season).clubs.find(candidate => candidate.id === clubId);
    if (!club) throw new Error('A fixture refers to an unknown club.');
    const expected = rosterForRound(rosters, clubId, fixture.round);
    const snapshot = fixture.result ? rosters.find(candidate => candidate.id === fixture.result!.rosterIds[side]) : expected;
    if (!snapshot || snapshot.clubId !== clubId || snapshot.id !== expected.id) throw new Error('The fixture refers to an invalid historical roster.');
    const registered = { ...club, players: snapshot.players };
    return fixture.result?.selection ? selectedTeam(registered, fixture.result.selection[side]) : registered;
  }
  const home = team(fixture.homeClubId, 'home'), away = team(fixture.awayClubId, 'away');
  const players = [...home.players, ...away.players].map(player => player.id);
  if (new Set(players).size !== players.length) throw new Error('A fixture cannot register the same player twice.');
  return { home, away };
}

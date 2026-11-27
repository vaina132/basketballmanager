import { describe, expect, it } from 'vitest';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { nationalPausedWeeks, nationalTournamentName, nationalWindowDays, nationalWindowWeeks } from '../src/world/national-calendar';
import { generatedNationalPlayer, nationalPlayerPool, nationalTable, pickNationalSquad, rolloverNational } from '../src/world/national';
import { NATIONAL_TEAMS } from '../src/data/national-teams';
import { nationalWorld } from './helpers/national-world';
import { validateNationalShape } from '../src/storage/national-validation';
import { SEASON_SCHEMA_VERSION } from '../src/domain/season';

const world = nationalWorld();
const create = (options: Record<string, unknown> = {}) => createSeason({ seed: 11, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, ...options });

describe('national teams (format 80)', () => {
  it('puts the FIBA windows on the real 2026-27 dates and pauses leagues with room', () => {
    expect(nationalWindowDays(1, 1)).toEqual(['2026-11-26', '2026-11-28']);
    expect(nationalWindowDays(1, 2)).toEqual(['2027-02-25', '2027-02-27']);
    expect(nationalWindowWeeks(1)).toEqual([13, 26]);
    expect(nationalPausedWeeks(1, 30, 38)).toEqual([13, 26]);
    expect(nationalPausedWeeks(1, 38, 38)).toEqual([]);
    expect(nationalTournamentName(1)).toBe('World Championship 2027 (Qatar)');
    expect(nationalTournamentName(3)).toBe('European Championship 2029');
  });

  it('starts new real-club careers with the 24 teams, coaches and the real groups; others are unchanged', () => {
    const state = create();
    expect(state.national?.teams).toHaveLength(24);
    expect(new Set(state.national!.coaches.map(coach => coach.name)).size).toBe(24);
    const qualifiers = state.national!.competitions[0]!;
    expect(qualifiers.groups.map(group => group.name)).toEqual(['Group I', 'Group J', 'Group K', 'Group L']);
    expect(qualifiers.fixtures).toHaveLength(48);
    // Each team plays four games, two in each window.
    for (const team of NATIONAL_TEAMS) expect(qualifiers.fixtures.filter(fixture => fixture.homeTeamId === team.id || fixture.awayTeamId === team.id)).toHaveLength(4);
    // The top division pauses on both window weekends; the second division has no room and plays on.
    const weeks = (leagueClubs: readonly string[]) => new Set(state.fixtures.filter(fixture => leagueClubs.includes(fixture.homeClubId)).map(fixture => fixture.round));
    const top = weeks(world.domesticLeagues![0]!.clubIds), second = weeks(world.domesticLeagues![1]!.clubIds);
    expect(top.has(13) || top.has(26)).toBe(false);
    expect(second.has(13) && second.has(26)).toBe(true);
    const without = create({ nationalTeams: false });
    expect(without.national).toBeUndefined();
    expect(createSeason({ seed: 11, ...NEW_CAREER_SYSTEMS }).national).toBeUndefined();
  });

  it('picks real players of the country first and fills with generated players', () => {
    const state = create();
    const pool = nationalPlayerPool(state, state.date, null);
    const turkey = NATIONAL_TEAMS.find(team => team.country === 'Turkey')!, iceland = NATIONAL_TEAMS.find(team => team.country === 'Iceland')!;
    const turks = pickNationalSquad(turkey, pool.get('Turkey') ?? [], state.seed);
    expect(turks).toHaveLength(12);
    expect(turks.every(item => !item.generated)).toBe(true);
    const icelanders = pickNationalSquad(iceland, pool.get('Iceland') ?? [], state.seed);
    expect(icelanders.every(item => item.generated)).toBe(true);
    expect(generatedNationalPlayer(iceland, 1, state.seed)).toEqual(generatedNationalPlayer(iceland, 1, state.seed));
    // In a window, players of clubs with a game in the window's week stay with their club.
    const busy = nationalPlayerPool({ ...state, fixtures: [{ ...state.fixtures[0]!, date: '2026-11-25' }] }, '2026-11-28', { saturday: '2026-11-28' });
    const busyClubs = [state.fixtures[0]!.homeClubId, state.fixtures[0]!.awayClubId];
    expect([...busy.values()].flat().some(item => busyClubs.includes(item.clubId!))).toBe(false);
  });

  it('plays the windows, the summer tournament and draws next season at the rollover', () => {
    const state = create();
    const national = rolloverNational({ ...state, status: 'complete' });
    const qualifiers = national.competitions.find(item => item.id === 'nq-s1')!, tournament = national.competitions.find(item => item.id === 'nt-s1')!;
    expect(qualifiers.fixtures.every(fixture => fixture.result)).toBe(true);
    for (const group of qualifiers.groups) expect(nationalTable(national, qualifiers, group.id).reduce((sum, row) => sum + row.played, 0)).toBe(24);
    expect(tournament.name).toBe('World Championship 2027 (Qatar)');
    expect(tournament.fixtures.map(fixture => fixture.stage).filter(stage => stage !== 'group')).toEqual(['semi', 'semi', 'final', 'third']);
    expect(tournament.fixtures.every(fixture => fixture.result && fixture.result.home !== fixture.result.away)).toBe(true);
    const next = national.competitions.find(item => item.id === 'nq-s2')!;
    expect(next.groups.map(group => group.teamIds.length)).toEqual([6, 6, 6, 6]);
    expect(next.fixtures.every(fixture => fixture.date > '2027-09-01')).toBe(true);
    // The save check accepts the national records of the new season (the tournament ends after its first day).
    expect(() => validateNationalShape(national, { ...state, seasonNumber: 2, date: '2027-09-04' }, SEASON_SCHEMA_VERSION)).not.toThrow();
    expect(() => validateNationalShape(national, state, 79)).toThrow(/format 80/);
  });
});

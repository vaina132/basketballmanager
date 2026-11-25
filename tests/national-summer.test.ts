import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { continueAction, runContinueStep } from '../src/world/continue-step';
import { continueStop } from '../src/ui/continue-run';
import { acceptNationalOffer, careerEarnings, nationalManagedSide, nationalTournament, offerNationalJob, resignNationalJob, seasonNationalCompetitions } from '../src/world/national';
import { nationalTournamentDays } from '../src/world/national-calendar';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { getClubMedicalCases, getInjuryMedicalSummary, getPlayerHealth, getPlayerMedicalSummary, medicalViewDate } from '../src/world/health';
import { continueDay } from '../src/ui/career-text';
import { setEmploymentDelegation } from '../src/world/employment';
import { nationalWorld } from './helpers/national-world';

const world = nationalWorld();

/** Continue until `until` holds; every match the manager has to play is finished automatically. */
function playUntil(start: SeasonState, until: (state: SeasonState) => boolean, onStep?: (before: SeasonState, after: SeasonState) => void): SeasonState {
  let state = start;
  for (let guard = 0; guard < 600 && !until(state); guard += 1) {
    const national = state.national?.activeMatch;
    if (national && national.status !== 'finished') { state = { ...state, national: { ...state.national!, activeMatch: simulateToEnd(setAutoSubstitutions(national, nationalManagedSide(state), true)) } }; continue; }
    if (state.status === 'active' && state.activeMatch && state.activeMatch.status !== 'finished') { state = { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) }; continue; }
    const result = runContinueStep(state, { decided: true });
    if ('outlook' in result) throw new Error('No board decision is expected here.');
    onStep?.(state, result.state);
    state = result.state;
  }
  if (!until(state)) throw new Error('The career did not reach the expected point.');
  return state;
}

describe('the summer tournament in the offseason (format 80)', () => {
  it('is drawn when the qualifiers end and played live by the manager after recruitment, before the season change', () => {
    expect(nationalTournamentDays(1)).toEqual(['2027-08-21', '2027-08-23', '2027-08-25', '2027-08-29', '2027-09-02']);
    const start = setEmploymentDelegation(createSeason({ seed: 5, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, generatedPeople: false, positionProfiles: false }), true);
    // The February window closes the qualifiers: the tournament is drawn then, its games still to come.
    let state = playUntil(start, current => !!current.national && !!nationalTournament(current.national, 1));
    const drawn = nationalTournament(state.national!, 1)!;
    expect(drawn.fixtures).toHaveLength(12);
    expect(drawn.fixtures.every(fixture => !fixture.result)).toBe(true);
    // The manager takes over a qualified team.
    const teamId = drawn.groups[0]!.teamIds[0]!;
    if (state.national!.job) state = resignNationalJob(state);
    state = offerNationalJob(state, teamId);
    state = acceptNationalOffer(state, state.national!.offers.find(offer => offer.status === 'open')!.id);
    expect(parseSeason(serializeSeason(state)).national).toEqual(state.national);
    // To the season's end, then through recruitment: the tournament waits until recruitment is complete.
    state = playUntil(state, current => current.status === 'complete');
    const actions: string[] = [], stops: string[] = [];
    let opened: SeasonState | null = null, injuryChecks = 0;
    state = playUntil(state, current => current.seasonNumber === 2, (before, after) => {
      actions.push(continueAction(before).kind);
      const stop = continueStop(before, after);
      if (stop) stops.push(`${stop.kind}:${stop.message}`);
      if (!opened && after.national?.activeMatch) opened = after;
      // The top bar shows the national game's day for the tournament steps, not the offseason date.
      if (continueAction(before).kind === 'national') expect(continueDay(before)).toMatch(/^2027-0[89]-/);
      // Tournament days come after the offseason date: their injuries show on the medical screens from their day.
      if (after.status !== 'complete') return;
      const today = medicalViewDate(after);
      for (const injury of after.injuries.filter(item => item.fixtureId.startsWith('nt-s1-') && item.occurredOn <= today && today < item.returnOn)) {
        expect(today > after.date).toBe(true);
        expect(getPlayerHealth(after, injury.playerId)?.id).toBe(injury.id);
        expect(getPlayerMedicalSummary(after, injury.playerId)!.daysRemaining).toBeGreaterThan(0);
        if (injury.clubId === after.managedClubId) expect(getClubMedicalCases(after).some(item => item.injury.id === injury.id)).toBe(true);
        injuryChecks += 1;
      }
    });
    // Seed 5: a player is injured on the tournament's second day (23 August), shown before the season change.
    expect(injuryChecks).toBeGreaterThan(0);
    const firstNational = actions.indexOf('national');
    expect(firstNational).toBeGreaterThan(0);
    expect(actions.slice(firstNational).every(kind => kind === 'national' || kind === 'rollover')).toBe(true);
    expect(actions.at(-1)).toBe('rollover');
    // Continue stopped for the manager's game in the Match center; an open game survives a save.
    expect(stops.some(stop => stop.startsWith('match:Your national team plays'))).toBe(true);
    expect(opened).not.toBeNull();
    const open = opened! as SeasonState;
    expect(open.status).toBe('complete');
    expect(open.national!.activeFixtureId).toMatch(/^nt-s1-/);
    expect(parseSeason(serializeSeason(open)).national!.activeFixtureId).toBe(open.national!.activeFixtureId);
    // After the season change the tournament is complete, with the manager's games in it, and the federation judged it.
    const tournament = nationalTournament(state.national!, 1)!;
    expect(tournament.fixtures).toHaveLength(16);
    expect(tournament.fixtures.every(fixture => fixture.result)).toBe(true);
    expect(tournament.fixtures.filter(fixture => fixture.homeTeamId === teamId || fixture.awayTeamId === teamId).length).toBeGreaterThanOrEqual(2);
    expect(state.national!.verdicts.some(verdict => verdict.id === 'national-verdict-s1-w3')).toBe(true);
    // The salary was paid every month, through the offseason to the new season's first day.
    expect(careerEarnings(state)!.payments.at(-1)!.date).toBe('2027-09-01');
    expect(state.national!.earnings.paidThrough).toBe(state.date);
    expect(parseSeason(serializeSeason(state)).national).toEqual(state.national);
  }, 900_000);

  it('a full season change with national teams: the February window, the offseason, the tournament and season two pass the strict check', () => {
    // No national job: computer coaches play every national game, and the tournament is played at the season change.
    const start = setEmploymentDelegation(createSeason({ seed: 7, world, managedClubId: world.clubs[2]!.id, ...NEW_CAREER_SYSTEMS }), true);
    const strict = (state: SeasonState) => expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    // Through the November window and the February window: the qualifiers end and the tournament is drawn.
    let state = playUntil(start, current => !!current.national && !!nationalTournament(current.national, 1));
    const qualifiers = seasonNationalCompetitions(state.national!, 1).find(item => item.kind === 'qualifiers')!;
    expect(qualifiers.fixtures.every(fixture => fixture.result)).toBe(true);
    expect(nationalTournament(state.national!, 1)!.fixtures.every(fixture => !fixture.result)).toBe(true);
    strict(state);
    // To the season's end, then the offseason; the tournament waits for the season change.
    state = playUntil(state, current => current.status === 'complete');
    strict(state);
    let before: SeasonState | null = null;
    state = playUntil(state, current => current.seasonNumber === 2, (previous, after) => { if (after.seasonNumber === 2) before = previous; });
    expect(before!.status).toBe('complete');
    expect(nationalTournament(before!.national!, 1)!.fixtures.every(fixture => !fixture.result)).toBe(true);
    strict(before!);
    // Season two: the tournament is complete, its injuries are recorded and show, next season's qualifiers are drawn.
    const tournament = nationalTournament(state.national!, 1)!;
    expect(tournament.fixtures.length).toBe(16);
    expect(tournament.fixtures.every(fixture => fixture.result)).toBe(true);
    for (const injury of state.injuries.filter(item => item.fixtureId.startsWith('nt-s1-'))) {
      expect(tournament.fixtures.find(fixture => fixture.id === injury.fixtureId)!.result!.injuries[injury.playerId]).toBe(injury.kind);
      if (getInjuryMedicalSummary(state, injury).effectiveReturnOn > state.date) expect(getPlayerHealth(state, injury.playerId)?.id).toBe(injury.id);
    }
    const next = seasonNationalCompetitions(state.national!, 2).find(item => item.kind === 'qualifiers')!;
    expect(next.fixtures.length).toBeGreaterThan(0);
    expect(next.fixtures.every(fixture => !fixture.result)).toBe(true);
    expect(state.status).toBe('active');
    strict(state);
    // Two weeks into season two, still valid.
    const opening = state.round;
    state = playUntil(state, current => current.round >= opening + 2);
    expect(state.national!.job).toBeNull();
    strict(state);
  }, 1_800_000);
});

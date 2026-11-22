import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { runContinueStep } from '../src/world/continue-step';
import { continueUntilStop } from '../src/ui/continue-run';
import { getInboxItems } from '../src/ui/inbox-items';
import { acceptNationalOffer, clubWindowCallUps, nationalManagedSide, offerNationalJob, resignNationalJob, setNationalSelection } from '../src/world/national';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { nationalWorld } from './helpers/national-world';

const world = nationalWorld();

/** Continue until `until` holds, finishing every match the manager has to play (club and national) automatically. */
function playUntil(start: SeasonState, until: (state: SeasonState) => boolean, onNational?: (state: SeasonState) => void): SeasonState {
  let state = start;
  for (let guard = 0; guard < 400 && !until(state); guard += 1) {
    const national = state.national?.activeMatch;
    if (national && national.status !== 'finished') { onNational?.(state); state = { ...state, national: { ...state.national!, activeMatch: simulateToEnd(setAutoSubstitutions(national, nationalManagedSide(state), true)) } }; continue; }
    if (state.activeMatch && state.activeMatch.status !== 'finished') { state = { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) }; continue; }
    const result = runContinueStep(state, { decided: true });
    if ('outlook' in result) throw new Error('No board decision is expected here.');
    state = result.state;
  }
  if (!until(state)) throw new Error('The career did not reach the expected point.');
  return state;
}

describe('national windows in play (format 80)', () => {
  const start = createSeason({ seed: 5, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS });

  it('calls up players, plays the November window and replays national duty in the strict training check', () => {
    // At round 11 the November window is within two weeks: the club sees who would be called up.
    const before = playUntil(start, state => state.round === 11);
    const projected = clubWindowCallUps(before, before.managedClubId, 1, 1)!;
    expect(projected.played).toBe(false);
    expect(projected.players.length).toBeGreaterThan(0);
    expect(getInboxItems(before).some(item => item.id === 'national-callups-s1-w1')).toBe(true);
    // Week 12 closes with the window's games; its training misses the called-up players from Wednesday to Saturday.
    const after = playUntil(before, state => state.round === 13);
    const qualifiers = after.national!.competitions[0]!;
    expect(qualifiers.fixtures.filter(fixture => fixture.window === 1).every(fixture => fixture.result)).toBe(true);
    expect(qualifiers.fixtures.filter(fixture => fixture.window === 2).some(fixture => fixture.result)).toBe(false);
    const callUps = clubWindowCallUps(after, after.managedClubId, 1, 1)!;
    expect(callUps.played).toBe(true);
    const report = after.training.lastWeek!;
    expect(report.afterRound).toBe(12);
    const away = callUps.players[0]!, stayed = after.clubs[0]!.players.find(player => !callUps.players.some(item => item.playerId === player.id))!;
    expect(report.players[away.playerId]!.availableDays).toBeLessThan(report.players[stayed.id]!.availableDays);
    expect(getInboxItems(after).some(item => item.id === 'national-back-s1-w1')).toBe(true);
    // The strict save check accepts the window and replays the training week with national duty.
    expect(parseSeason(serializeSeason(after)).national).toEqual(after.national);
    // The compact save the game writes keeps the national records too.
    expect(parseSeason(serializeSeasonCompact(after)).national).toEqual(after.national);
    // A changed result is refused: points must add up to the score.
    const tampered = { ...after, national: { ...after.national!, competitions: after.national!.competitions.map((competition, index) => index ? competition : { ...competition, fixtures: competition.fixtures.map((fixture, at) => at || !fixture.result ? fixture : { ...fixture, result: { ...fixture.result, home: fixture.result.home + 1 } }) }) } };
    expect(() => parseSeason(serializeSeason(tampered))).toThrow(/national/);
  }, 600_000);

  it('offers a national job, plays the manager\'s window games in the Match center and keeps the club job', () => {
    expect(() => setNationalSelection(start, [])).toThrow(/national team/);
    const offered = offerNationalJob(start, 'nation-tur');
    const offer = getInboxItems(offered).find(item => item.target === 'national' && item.needsAction)!;
    expect(offer.title).toContain('Turkey');
    const hired = acceptNationalOffer(offered, offer.offerId!);
    expect(hired.national!.job!.teamId).toBe('nation-tur');
    expect(hired.managedClubId).toBe(start.managedClubId);
    expect(hired.national!.coaches.find(coach => coach.teamId === 'nation-tur')!.manager).toBe(true);
    const spanish = hired.clubs.flatMap(club => club.players).find(player => hired.world!.playerProfiles[player.id]!.nationality === 'Spain')!;
    expect(() => setNationalSelection(hired, [spanish.id])).toThrow(/Turkey/);
    const turk = hired.clubs[0]!.players.find(player => hired.world!.playerProfiles[player.id]!.nationality === 'Turkey')!;
    const picked = setNationalSelection(hired, [turk.id]);
    // Continue stops for the manager's national game before week 12 closes.
    const stops: string[] = [];
    let state = playUntil(picked, current => current.round === 12);
    const run = continueUntilStop(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
    expect(run.stop?.kind).toBe('match');
    state = run.state;
    expect(state.national!.activeMatch).not.toBeNull();
    expect(run.stop?.message).toContain('national team');
    // An open national game survives a save.
    expect(parseSeason(serializeSeason(state)).national!.activeFixtureId).toBe(state.national!.activeFixtureId);
    state = playUntil(state, current => current.round === 13, current => stops.push(current.national!.activeFixtureId!));
    const own = state.national!.competitions[0]!.fixtures.filter(fixture => fixture.window === 1 && (fixture.homeTeamId === 'nation-tur' || fixture.awayTeamId === 'nation-tur'));
    expect(own.every(fixture => fixture.result)).toBe(true);
    expect(own.some(fixture => [...fixture.result!.squads.home, ...fixture.result!.squads.away].includes(turk.id))).toBe(true);
    // The federation judged the window.
    expect(state.national!.verdicts.some(verdict => verdict.id === 'national-verdict-s1-w1')).toBe(true);
    // Leaving the national job keeps the club.
    const resigned = resignNationalJob(state);
    expect(resigned.national!.job).toBeNull();
    expect(resigned.managedClubId).toBe(state.managedClubId);
    expect(parseSeason(serializeSeason(resigned)).national!.job).toBeNull();
  }, 600_000);
});

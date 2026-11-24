import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { createSeason, managedSide, NEW_CAREER_SYSTEMS, resignManager } from '../src/world/season';
import { isUnemployed, NO_CLUB } from '../src/world/career-rules';
import { continueAction } from '../src/world/continue-step';
import { runContinueStep } from '../src/world/continue-step';
import { continueUntilStop } from '../src/ui/continue-run';
import { getInboxItems } from '../src/ui/inbox-items';
import { continueDay } from '../src/ui/career-text';
import { acceptNationalOffer, activeNationalFixture, careerEarnings, clubWindowCallUps, dueManagerNationalGame, isNationalFixtureId, monthlyNationalSalary, nationalManagedSide, offerNationalJob, resignNationalJob, setNationalSelection } from '../src/world/national';
import { getPlayerHealth } from '../src/world/health';
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
  const start = createSeason({ seed: 5, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, playerDevelopment: false, positionProfiles: false });

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
    // The salary is paid monthly into the manager's career earnings (1 October and 1 November), never into club money.
    const earned = careerEarnings(state)!;
    expect(earned.payments.map(payment => payment.date)).toEqual(['2026-10-01', '2026-11-01']);
    expect(earned.total).toBe(2 * monthlyNationalSalary(state.national!.job!.salary));
    expect(state.finance.ledger.some(entry => JSON.stringify(entry).includes('national'))).toBe(false);
    const forged = { ...state, national: { ...state.national!, earnings: { ...state.national!.earnings, payments: [...state.national!.earnings.payments, { date: '2026-11-15', teamId: 'nation-tur', amount: 1 }] } } };
    expect(() => parseSeason(serializeSeason(forged))).toThrow(/earnings/);
    // Leaving the national job keeps the club.
    const resigned = resignNationalJob(state);
    expect(resigned.national!.job).toBeNull();
    expect(resigned.managedClubId).toBe(state.managedClubId);
    expect(parseSeason(serializeSeason(resigned)).national!.job).toBeNull();
  }, 600_000);

  it('records injuries from national games: the player returns to his club injured (strict check included)', () => {
    // Seed 24 (11 before head coaches steered computer clubs, format 86): a player of the manager's club is injured with
    // his national team in the November window, and so is a computer club's player.
    const career = createSeason({ seed: 24, world, managedClubId: world.clubs[4]!.id, ...NEW_CAREER_SYSTEMS, playerDevelopment: false, positionProfiles: false });
    const after = playUntil(career, state => state.round === 13);
    const national = after.injuries.filter(injury => isNationalFixtureId(injury.fixtureId));
    const own = national.find(injury => injury.clubId === after.managedClubId)!;
    expect(own).toBeDefined();
    const fixture = after.national!.competitions[0]!.fixtures.find(item => item.id === own.fixtureId)!;
    expect(fixture.result!.injuries[own.playerId]).toBe(own.kind);
    expect(getPlayerHealth(after, own.playerId)?.id).toBe(own.id);
    expect(getInboxItems(after).find(item => item.id === `national-injury-${own.id}`)?.title).toMatch(/was injured with/);
    // Computer clubs' players are recorded the same way.
    expect(national.some(injury => injury.clubId !== after.managedClubId)).toBe(true);
    expect(parseSeason(serializeSeason(after)).injuries).toEqual(after.injuries);
    // The next club game counts him out, and the strict check still replays the career.
    const next = playUntil(after, state => state.round === 15);
    const game = next.fixtures.find(item => item.round === 14 && item.result && [item.homeClubId, item.awayClubId].includes(next.managedClubId))!;
    expect(game.result!.injuries[own.playerId]).toBe(own.kind);
    expect(game.result!.stats[own.playerId]?.secondsPlayed ?? 0).toBe(0);
    expect(parseSeason(serializeSeasonCompact(next)).injuries).toEqual(next.injuries);
    // A changed diagnosis is refused.
    const tampered = { ...next, injuries: next.injuries.map(injury => injury.id === own.id ? { ...injury, returnOn: '2027-01-30' } : injury) };
    expect(() => parseSeason(serializeSeason(tampered))).toThrow(/Invalid season save/);
  }, 600_000);

  it('an unemployed manager plays his national games live: Continue stops for them in the Match center', () => {
    const career = createSeason({ seed: 5, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, playerDevelopment: false, positionProfiles: false });
    let state = resignManager(career, NO_CLUB);
    expect(isUnemployed(state)).toBe(true);
    state = offerNationalJob(state, 'nation-tur');
    state = acceptNationalOffer(state, state.national!.offers.find(offer => offer.status === 'open')!.id);
    // A week before the window, Continue opens his game instead of simulating the week.
    state = playUntil(state, current => current.round === 12);
    expect(continueAction(state).kind).toBe('national');
    // The top bar shows that game's day, not the week's Saturday.
    const due = dueManagerNationalGame(state)!;
    expect(due.date).not.toBe(state.date);
    expect(continueDay(state)).toBe(due.date);
    const run = continueUntilStop(state);
    expect(continueDay(run.state)).toBe(activeNationalFixture(run.state)!.date);
    expect(run.stop?.kind).toBe('match');
    expect(run.stop?.page).toBe('match');
    expect(run.state.national!.activeFixtureId).toMatch(/^nq-s1-/);
    expect(parseSeason(serializeSeason(run.state)).national!.activeFixtureId).toBe(run.state.national!.activeFixtureId);
    const opened: string[] = [];
    state = playUntil(run.state, current => current.round === 13, current => opened.push(current.national!.activeFixtureId!));
    const own = state.national!.competitions[0]!.fixtures.filter(fixture => fixture.window === 1 && (fixture.homeTeamId === 'nation-tur' || fixture.awayTeamId === 'nation-tur'));
    expect(own.every(fixture => fixture.result)).toBe(true);
    expect(new Set([run.state.national!.activeFixtureId!, ...opened])).toEqual(new Set(own.map(fixture => fixture.id)));
    expect(isUnemployed(state)).toBe(true);
    expect(parseSeason(serializeSeason(state)).national).toEqual(state.national);
  }, 600_000);

  it('keeps loading format-80 saves from before national injuries and career earnings', () => {
    // Seed 5: the November window records no injury at a full-world club, as an earlier format-80 save would hold. A
    // format-80 career played its matches on the plays-2 engine (the match flow of format 81 came later), so this career
    // keeps it on purpose.
    // Nor did it have head coaches who steer computer clubs (format 86).
    const played = playUntil(createSeason({ seed: 5, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS, playerDevelopment: false, positionProfiles: false, matchFlow: false, coachSteering: false, careerBalance: false }), state => state.round === 13);
    expect(played.injuries.some(injury => isNationalFixtureId(injury.fixtureId))).toBe(false);
    const hired = acceptNationalOffer(offerNationalJob(played, 'nation-tur'), `national-offer-test-nation-tur-${played.date}`);
    // The earlier shape: results without injury records, the national record without earnings.
    const envelope = JSON.parse(serializeSeason(hired));
    // A format-80 file: no real head coaches (format 82) yet.
    envelope.formatVersion = 80; envelope.state.schemaVersion = 80; delete envelope.state.coaches;
    delete envelope.state.coaching.fullStaff; // format 84: computer clubs always fill every staff role
    delete envelope.state.national.earnings;
    for (const competition of envelope.state.national.competitions) for (const fixture of competition.fixtures) if (fixture.result) delete fixture.result.injuries;
    const earlier = JSON.stringify(envelope);
    expect(earlier).not.toContain('"earnings"');
    const loaded = parseSeason(earlier);
    expect(loaded.national!.earnings).toEqual({ paidThrough: hired.date, payments: [] });
    expect(loaded.national!.competitions[0]!.fixtures.filter(fixture => fixture.result).every(fixture => Object.keys(fixture.result!.injuries).length === 0)).toBe(true);
    // It continues a week under the strict check, and the salary starts on the next first of a month.
    const next = playUntil(loaded, state => state.round === 14);
    expect(careerEarnings(next)!.payments.map(payment => payment.date)).toEqual(['2026-12-01']);
    expect(parseSeason(serializeSeason(next)).national).toEqual(next.national);
    // A save that carries the fields keeps its exact checks.
    const forged = JSON.parse(serializeSeason(next));
    forged.state.national.earnings.payments[0].amount += 1;
    expect(() => parseSeason(JSON.stringify(forged))).toThrow(/earnings/);
  }, 600_000);
});

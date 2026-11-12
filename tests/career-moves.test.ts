import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { careerMoveRefusal, enableCareerMoves, managedClubAtLedger, managedClubFor, matchClubFor } from '../src/world/career';
import { offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { getAvailablePlayers, quotePlayerContract } from '../src/world/employment-policy';
import { setAcademyFocus } from '../src/world/academy';
import { requestSponsorshipImprovement } from '../src/world/commercial';
import { startFacilityUpgrade } from '../src/world/facilities';
import { FACILITY_TYPES, quoteFacilityUpgrade } from '../src/world/facilities-policy';
import { setTicketPlan } from '../src/world/finance';
import { getPressQuestion } from '../src/world/press-policy';
import { answerPress, getSquadRelationships, quoteRelationshipTalk, talkToPlayer } from '../src/world/relationships';
import { TRAINING_FOCUSES } from '../src/world/training';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { advanceMatchday } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';

const FROM = 'rhine-falcons', TO = 'aegean-waves';
const finish = (state: SeasonState) => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const career = (careerMoves = true) => createSeason({ seed: 227, managedClubId: FROM, injuryMode: 'standard', manager: { name: 'Moving Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, careerMoves });
let finalDay: SeasonState, moved: SeasonState, opened: SeasonState, playing: SeasonState;

beforeAll(() => {
  let state = career();
  while (state.round < 10) state = advanceMatchday(state);
  finalDay = finish(state);
  moved = advanceSeason(finalDay, { moveTo: TO });
  // The new club's recruitment is delegated so the offseason can finish without manual signings.
  let offseason = setEmploymentDelegation(moved, true);
  for (let step = 0; step < 80 && getMarketStartReason(offseason); step += 1) offseason = advanceMarket(offseason);
  opened = rolloverSeason(offseason);
  playing = opened;
  while (playing.round < 4) playing = advanceMatchday(playing);
}, 240_000);

describe('season-end club changes', () => {
  it('hands the offseason and later seasons to the new club while the final match stays with the former club', () => {
    expect(moved.managedClubId).toBe(TO);
    expect(moved.career.moves).toEqual([{ seasonNumber: 1, date: finalDay.date, fromClubId: FROM, toClubId: TO, reason: 'moved', ledgerCount: expect.any(Number) }]);
    expect([managedClubFor(moved, 1, false), managedClubFor(moved, 1, true), managedClubFor(moved, 2, false)]).toEqual([FROM, TO, TO]);
    expect(matchClubFor(moved)).toBe(FROM);
    expect(managedSide(moved)).toBe(managedSide(finalDay));
    const move = moved.career.moves[0]!;
    expect([managedClubAtLedger(moved, move.ledgerCount - 1), managedClubAtLedger(moved, move.ledgerCount)]).toEqual([FROM, TO]);
  });

  it('puts the former club under automatic control and gives the manager the new club', () => {
    expect(moved.plans[FROM]!.autoSubstitutions).toBe(true);
    expect([moved.finance.plans[FROM]!.delegated, moved.finance.plans[TO]!.delegated]).toEqual([true, false]);
    expect([moved.payroll.delegated[FROM], moved.payroll.delegated[TO]]).toEqual([true, false]);
    expect([moved.scouting.clubs[FROM]!.delegated, moved.scouting.clubs[TO]!.delegated]).toEqual([true, false]);
    expect([moved.commercial.plans[FROM]!.delegated, moved.commercial.plans[TO]!.delegated]).toEqual([true, false]);
    expect([moved.facilities.delegated[FROM], moved.facilities.delegated[TO]]).toEqual([true, false]);
    expect(moved.training.plans[FROM]!.delegated).toBe(true);
    expect(moved.facilities.events.filter(event => event.type === 'delegate' && event.seasonNumber === 1 && event.round === 10).map(event => event.type === 'delegate' && [event.clubId, event.delegated])).toEqual([[FROM, true], [TO, false]]);
  });

  it('keeps every season-end, offseason and next-season save valid', () => {
    for (const state of [moved, opened, playing]) expect(parseSeason(serializeSeason(state))).toEqual(state);
    expect(opened.managedClubId).toBe(TO);
    expect([opened.fixtures.find(fixture => fixture.id === opened.activeFixtureId)!.homeClubId, opened.fixtures.find(fixture => fixture.id === opened.activeFixtureId)!.awayClubId]).toContain(TO);
  });

  it('refuses moves outside a governed season end', () => {
    expect(() => advanceSeason(career(), { moveTo: TO })).toThrow(/final matchday/);
    expect(careerMoveRefusal(moved, 'danube-lynx')).toMatch(/already changed clubs/);
    let plain = career(false);
    while (plain.round < 10) plain = advanceMatchday(plain);
    expect(() => advanceSeason(finish(plain), { moveTo: TO })).toThrow(/not active/);
    expect(careerMoveRefusal({ ...finalDay, status: 'complete' }, FROM)).toMatch(/already manage/);
    expect(enableCareerMoves(moved)).toBe(moved);
  }, 120_000);

  it.each([
    ['a move to another club', (copy: SeasonState) => { copy.career.moves[0]!.toClubId = 'danube-lynx'; }],
    ['a removed move', (copy: SeasonState) => { copy.career.moves = []; }],
    ['a move before the final matchday ledger', (copy: SeasonState) => { copy.career.moves[0]!.ledgerCount -= 40; }],
    ['a move without the career switch', (copy: SeasonState) => { copy.career.enabledSince = null; }],
  ])('rejects %s', (_label, mutate) => {
    const copy = structuredClone(moved);
    mutate(copy);
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/);
  });

  it('rejects a move recorded as a dismissal before dismissal exists', () => {
    const copy = structuredClone(moved);
    (copy.career.moves[0] as { reason: string }).reason = 'dismissed';
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/supported reason/);
  });

  it('rejects the career record in a format-36 file', () => {
    const file = JSON.parse(serializeSeason(career()));
    file.formatVersion = 36; file.state.schemaVersion = 36;
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/unsupported fields/);
  });
});

/** Ordinary manager decisions at `clubId`, so every replay must credit them to the club managed at the time. */
function manage(state: SeasonState, clubId: string, log: string[]): SeasonState {
  let next = state;
  const prospect = next.academy.prospects.find(item => item.clubId === clubId && next.academy.focus[item.player.id] === 'balanced' && !next.academy.graduates.some(graduate => graduate.prospectId === item.player.id));
  if (prospect && next.status === 'active') { next = setAcademyFocus(next, prospect.player.id, TRAINING_FOCUSES[1]); log.push(`academy:${clubId}`); }
  const question = getPressQuestion(next);
  if (question && !question.answered) { next = answerPress(next, question.answers[0]!); log.push(`press:${clubId}`); }
  const offer = next.commercial.offers.find(item => item.clubId === clubId && item.status === 'open' && !item.request);
  if (offer) { next = requestSponsorshipImprovement(next, offer.id); log.push(`sponsor:${clubId}`); }
  const talk = next.status === 'active' ? getSquadRelationships(next, clubId).find(row => quoteRelationshipTalk(next, row.player.id, 'explain', clubId).canTalk) : undefined;
  if (talk) { next = talkToPlayer(next, talk.player.id, 'explain', clubId); log.push(`talk:${clubId}`); }
  const upgrade = FACILITY_TYPES.find(type => quoteFacilityUpgrade(next, type, clubId).canStart);
  if (upgrade && !next.facilities.delegated[clubId]) { next = startFacilityUpgrade(next, upgrade); log.push(`facility:${clubId}`); }
  // In the offseason the manager also bids for a free agent in the transfer window.
  const signing = next.status === 'complete' && !next.employment.delegated ? getAvailablePlayers(next).map(player => quotePlayerContract(next, player.id, quotePlayerContract(next, player.id, 100_000, 1, clubId).askingWage, 1, clubId)).find(quote => quote.canOffer) : undefined;
  if (signing) { next = offerPlayerContract(next, signing.playerId, signing.seasonWage, 1); log.push(`market:${clubId}`); }
  return next;
}

describe('club changes after manual decisions at both clubs', () => {
  const log: string[] = [];
  let secondMove: SeasonState, thirdSeason: SeasonState;

  beforeAll(() => {
    let state = setTicketPlan(career(), { delegated: false, price: 2200 });
    while (state.round < 10) state = advanceMatchday(manage(state, FROM, log));
    state = advanceSeason(finish(manage(state, FROM, log)), { moveTo: TO });
    state = setEmploymentDelegation(manage(state, TO, log), true);
    for (let step = 0; step < 80 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    state = rolloverSeason(state);
    while (state.round < 10) state = advanceMatchday(manage(state, TO, log));
    secondMove = advanceSeason(finish(manage(state, TO, log)), { moveTo: 'danube-lynx' });
    state = setEmploymentDelegation(secondMove, true);
    for (let step = 0; step < 80 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    thirdSeason = advanceMatchday(rolloverSeason(state));
  }, 480_000);

  it('records manual decisions at both clubs and two chained moves', () => {
    for (const kind of ['academy', 'sponsor', 'facility', 'press', 'talk', 'market']) expect(log.some(entry => entry.startsWith(`${kind}:`)), kind).toBe(true);
    expect(log.some(entry => entry.endsWith(`:${FROM}`)) && log.some(entry => entry.endsWith(`:${TO}`))).toBe(true);
    expect(secondMove.career.moves.map(move => [move.seasonNumber, move.fromClubId, move.toClubId])).toEqual([[1, FROM, TO], [2, TO, 'danube-lynx']]);
    expect([1, 2, 3].map(season => managedClubFor(thirdSeason, season, false))).toEqual([FROM, TO, 'danube-lynx']);
  });

  it('validates the whole history with every decision credited to the club managed then', () => {
    for (const state of [secondMove, thirdSeason]) expect(parseSeason(serializeSeason(state))).toEqual(state);
  }, 120_000);
});

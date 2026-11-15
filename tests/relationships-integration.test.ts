import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { createSeason, advanceSeason, managedSide, rolloverSeason } from '../src/world/season';
import { agreeSquadRole, enableRelationships, getPlayerRelationship, getPreparedRelationshipMorale, getSquadRelationships, quoteRelationshipTalk, talkToPlayer } from '../src/world/relationships';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getSeasonWage } from '../src/data/development-wages';
import { submitInSeasonTransferOffer, decideInSeasonTransfer } from '../src/world/recruitment';
import { getInSeasonOffers, requiredInSeasonTransferFee } from '../src/world/recruitment-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { setEmploymentDelegation } from '../src/world/employment';

const initial = (enabled = true) => createSeason(227, 'rhine-falcons', 'off', true, false, true, true, null, true, false, true, false, false, false, false, false, true, false, false, false, false, enabled);
const finish = (state: SeasonState) => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
const advance = (state: SeasonState) => advanceSeason(finish(state));
function careerWithConcern() {
  let state = initial();
  for (const player of state.clubs.find(club => club.id === state.managedClubId)!.players.slice(0, 5)) state = agreeSquadRole(state, player.id, 'starter');
  let row = getSquadRelationships(state).find(row => row.concern && row.canTalk);
  for (let round = 0; !row && round < 6; round += 1) { state = advance(state); row = getSquadRelationships(state).find(row => row.concern && row.canTalk); }
  if (!row) throw new Error('The actual fixture sequence must create a playing-time concern.');
  return { state, row };
}

describe('career relationships and match preparation boundaries', () => {
  it('preserves an older prepared match on opt-in and freezes every next-round player consistently', () => {
    const before = initial(false), enabled = enableRelationships(before);
    expect(enabled.activeMatch!).toBe(before.activeMatch!);
    expect(enabled.activeMatch!.morale).toBeUndefined();
    expect(getPreparedRelationshipMorale(enabled)).toBeUndefined();
    const next = advance(enabled), prepared = getPreparedRelationshipMorale(next)!;
    expect(Object.keys(prepared.values)).toHaveLength(next.clubs.reduce((sum, club) => sum + club.players.length, 0));
    expect(next.activeMatch!.morale!.eventCount).toBe(prepared.eventCount);
    for (const [id, value] of Object.entries(next.activeMatch!.morale!.values)) expect(value).toBe(prepared.values[id]);
    expect(parseSeason(serializeSeason(next))).toEqual(next);
  });

  it('keeps current-round AI and managed results fixed after same-day role edits', () => {
    const before = initial(), player = before.clubs.find(club => club.id === before.managedClubId)!.players[0]!;
    expect(Object.values(before.activeMatch!.morale!.values).every(value => value === 50)).toBe(true);
    const changed = agreeSquadRole(before, player.id, 'starter');
    expect(changed.activeMatch!).toBe(before.activeMatch!);
    expect(getPreparedRelationshipMorale(changed)).toEqual(getPreparedRelationshipMorale(before));
    const normal = advance(before), edited = advance(changed);
    expect(edited.fixtures.filter(fixture => fixture.round === 1)).toEqual(normal.fixtures.filter(fixture => fixture.round === 1));
    expect(edited.finance).toEqual(normal.finance);
    expect(edited.activeMatch!.morale!.eventCount).toBeGreaterThan(changed.activeMatch!.morale!.eventCount);
    expect(parseSeason(serializeSeason(changed))).toEqual(changed);
  });

  it('creates concerns from real appearances, commits a future promise and preserves its checkpoint', () => {
    const { state, row } = careerWithConcern();
    expect(row).toBeDefined();
    expect(row!.eligibleGames).toBeGreaterThanOrEqual(3);
    expect(row!.averageMinutes).toBeLessThan(row!.minMinutes);
    const quote = quoteRelationshipTalk(state, row!.player.id, 'minutes-promise');
    expect(quote.canTalk).toBe(true);
    const promised = talkToPlayer(state, row!.player.id, 'minutes-promise');
    expect(promised.activeMatch!).toBe(state.activeMatch!);
    const promise = getSquadRelationships(promised).find(item => item.player.id === row!.player.id)!.promise!;
    expect(promise.targetMinutes).toBe(row!.minMinutes);
    expect(promise.eligibleGames).toBe(0);
    expect(quoteRelationshipTalk(promised, row!.player.id, 'explain').canTalk).toBe(false);
    const loaded = parseSeason(serializeSeason(promised));
    expect(loaded).toEqual(promised);
    expect(advance(loaded)).toEqual(advance(promised));
  });

  it('freezes AI focus before new-day automatic conversations just as it does for the manager', () => {
    let state = initial();
    const ai = state.clubs.find(club => club.id === 'aegean-waves')!;
    for (const player of ai.players.slice(0, 5)) state = agreeSquadRole(state, player.id, 'starter', ai.id);
    for (let round = 0; round < 4; round += 1) state = advance(state);
    const prepared = getPreparedRelationshipMorale(state)!;
    const decisions = state.relationships.events.map((event, index) => ({ event, index })).filter(({ event }) => event.type !== 'prepare' && event.clubId === ai.id && event.round === state.round);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every(({ index }) => index + 1 > prepared.eventCount)).toBe(true);
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  });

  it('closes a real sold player promise without penalty and resets the role on return', () => {
    const { state, row } = careerWithConcern(), id = row.player.id, buyer = 'aegean-waves';
    const promised = talkToPlayer(state, id, 'minutes-promise');
    const offered = submitInSeasonTransferOffer(promised, id, requiredNegotiationWage(id, 2), 2, requiredInSeasonTransferFee(promised, id), buyer);
    const offer = getInSeasonOffers(offered, buyer, true).find(offer => offer.playerId === id)!;
    const agreed = decideInSeasonTransfer(offered, offer.id, 'accept');
    const departed = advance(agreed);
    expect(departed.clubs.find(club => club.id === buyer)!.players.some(player => player.id === id)).toBe(true);
    const prior = getPlayerRelationship(departed, id);
    expect(prior.promises.at(-1)!.status).toBe('departed');
    expect(prior.reasons.find(reason => reason.label === 'Playing-time promises')!.impact).toBe(0);
    expect(getPlayerRelationship(departed, id, buyer).role).toBe('rotation');
    expect(parseSeason(serializeSeason(departed))).toEqual(departed);
    let nextYear = setEmploymentDelegation(departed, true);
    while (nextYear.status === 'active') nextYear = advance(nextYear);
    nextYear = rolloverSeason(nextYear);
    const returnOffer = submitInSeasonTransferOffer(nextYear, id, getSeasonWage(id), 1, requiredInSeasonTransferFee(nextYear, id));
    const returned = advance(returnOffer);
    expect(returned.clubs.find(club => club.id === returned.managedClubId)!.players.some(player => player.id === id)).toBe(true);
    const current = getPlayerRelationship(returned, id);
    expect(current.role).toBe('rotation');
    expect(current.promises.at(-1)!.status).toBe('departed');
    expect(current.promise).toBeNull();
    expect(parseSeason(serializeSeason(returned))).toEqual(returned);
  });
});

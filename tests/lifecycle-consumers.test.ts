import { describe, expect, it } from 'vitest';
import type { RetirementNotice } from '../src/domain/lifecycle';
import type { SeasonState } from '../src/domain/season';
import { createSeason, dateForRound } from '../src/world/season';
import { getActiveCareerPlayers, getCareerPlayer, getCareerPlayers, getCareerWage } from '../src/world/player-catalog';
import { getAvailablePlayers, quotePlayerContract } from '../src/world/employment-policy';
import { getInSeasonCandidates, quoteInSeasonOffer } from '../src/world/recruitment-policy';
import { quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from '../src/world/midseason-transfer-policy';
import { getScoutingDiscovery } from '../src/world/scouting-discovery';
import { getMatchPlayerKnowledge, getPlayerKnowledge, quoteScoutingAssignment } from '../src/world/scouting-policy';
import { setShortlisted } from '../src/world/scouting';
import { developClub } from '../src/world/training';

const create = () => createSeason(227, 'rhine-falcons', 'off', true, true, true, true, null, true, true, true, false, true, true, true, true, true, true, true);
/** Isolated policy boundary; canonical notice generation/replay has separate coverage. */
function announced(state: SeasonState, playerId: string, lastSeason: number): SeasonState {
  const notice: RetirementNotice = { id: 'retirement-1', reviewId: 'lifecycle-review-1', playerId, clubId: state.clubs.find(club => club.players.some(player => player.id === playerId))?.id ?? null, announcedSeason: 1, announcedRound: 1, announcedOn: dateForRound(1, 1), targetAge: 38, lastSeason, retirementSeason: lastSeason + 1, retiredOn: dateForRound(1, lastSeason + 1) };
  return { ...state, lifecycle: { ...state.lifecycle, notices: [notice] } };
}

describe('lifecycle boundaries in contracts, identity and scouting', () => {
  it('keeps match ability at its original roster while calendar aging changes current squad skills', () => {
    const initial = create(), id = 'rhf-3';
    const later = { ...initial, date: dateForRound(1, 11) };
    const player = [...initial.activeMatch.home.players, ...initial.activeMatch.away.players].find(player => player.id === id)!;
    expect(getPlayerKnowledge(later, id).attributes!.stamina).toBeLessThan(player.attributes.stamina);
    expect(getMatchPlayerKnowledge(later, id).attributes).toEqual(player.attributes);
    expect(getMatchPlayerKnowledge(later, 'adr-3')).toEqual(getPlayerKnowledge(later, 'adr-3'));
    expect(getMatchPlayerKnowledge(later, 'adr-3').attributes).toBeNull();
    expect(later.activeMatch).toBe(initial.activeMatch);
  });

  it('keeps historical identity after retirement while removing the player from active recruitment and discovery', () => {
    const initial = announced(create(), 'adr-3', 1);
    const retired = { ...initial, seasonNumber: 2, round: 1, date: dateForRound(1, 2) };
    expect(getActiveCareerPlayers(initial).some(player => player.id === 'adr-3')).toBe(true);
    expect(getActiveCareerPlayers(initial, 2, 1).some(player => player.id === 'adr-3')).toBe(false);
    expect(getCareerPlayers(retired).some(player => player.id === 'adr-3')).toBe(true);
    expect(getCareerPlayer(retired, 'adr-3')).toEqual(getCareerPlayer(initial, 'adr-3'));
    expect(getCareerWage(retired, 'adr-3')).toBe(getCareerWage(initial, 'adr-3'));
    expect(getInSeasonCandidates(retired).some(player => player.id === 'adr-3')).toBe(false);
    expect(getScoutingDiscovery(retired).playerIds).not.toContain('adr-3');
    expect(quoteInSeasonOffer(retired, 'adr-3', getCareerWage(retired, 'adr-3')).reason).toMatch(/retired/);
  });

  it('allows a contract through the final season but rejects extensions beyond it on every offer path', () => {
    const own = announced(create(), 'rhf-3', 2);
    const wage = getCareerWage(own, 'rhf-3');
    expect(quotePlayerContract(own, 'rhf-3', wage, 1).canOffer).toBe(true);
    expect(quotePlayerContract(own, 'rhf-3', wage, 2).reason).toMatch(/retire after season 2/);
    const foreign = announced(create(), 'adr-3', 2);
    const fee = requiredInSeasonTransferFee(foreign, 'adr-3'), salary = getCareerWage(foreign, 'adr-3');
    expect(quoteInSeasonTransferOffer(foreign, 'adr-3', salary, 2, fee).canOffer).toBe(true);
    expect(quoteInSeasonTransferOffer(foreign, 'adr-3', salary, 3, fee).reason).toMatch(/retire after season 2/);
    expect(quoteInSeasonTransferOffer(foreign, 'adr-3', salary, 3, fee, foreign.managedClubId, 'upfront', undefined, { releaseFee: 100_000 }).reason).toMatch(/retire after season 2/);
  });

  it('does not present a final-season player as a next-season free-agent option', () => {
    const initial = announced(create(), 'adr-3', 1);
    const offseason: SeasonState = { ...initial, status: 'complete', round: 10, date: dateForRound(10, 1), employment: { ...initial.employment, market: { seasonNumber: 2 } } };
    expect(getAvailablePlayers(offseason).some(player => player.id === 'adr-3')).toBe(false);
    expect(quotePlayerContract(offseason, 'adr-3', getCareerWage(offseason, 'adr-3'), 1).reason).toMatch(/retire/);
  });

  it('allows removing a retained shortlist entry but refuses a new retirement observation or shortlist addition', () => {
    const shortlisted = setShortlisted(announced(create(), 'adr-3', 1), 'adr-3', true);
    const retired = { ...shortlisted, seasonNumber: 2, round: 1, date: dateForRound(1, 2) };
    expect(quoteScoutingAssignment(retired, 'adr-3').reason).toMatch(/retired/);
    expect(() => setShortlisted(retired, 'adr-3', true)).toThrow(/retired/);
    const removed = setShortlisted(retired, 'adr-3', false);
    expect(removed.scouting.clubs[retired.managedClubId]!.shortlist).not.toContain('adr-3');
    expect(removed.lifecycle).toBe(retired.lifecycle);
  });

  it('uses the same dated own-player skills as match preparation without refreshing old outsider reports', () => {
    const initial = create(), id = 'adr-3', original = getCareerPlayer(initial, id);
    const owner = initial.clubs.find(club => club.players.some(player => player.id === id))!;
    const own = { ...initial, managedClubId: owner.id, seasonNumber: 6, round: 1, date: dateForRound(1, 6) };
    const expected = developClub(owner, own.training, own).players.find(player => player.id === id)!;
    expect(expected.attributes.stamina).toBeLessThan(original.attributes.stamina);
    expect(getPlayerKnowledge(own, id).attributes).toEqual(expected.attributes);
    expect(owner.players.find(player => player.id === id)!.attributes).toEqual(original.attributes);
    const outsider = initial.managedClubId;
    const office = initial.scouting.clubs[outsider]!;
    const withReport = { ...initial, scouting: { ...initial.scouting, clubs: { ...initial.scouting.clubs, [outsider]: { ...office, squadKnowledge: { ...office.squadKnowledge, [id]: { playerId: id, seasonNumber: 1, round: 1, date: initial.date, clubId: owner.id, rosterId: initial.rosters.find(roster => roster.clubId === owner.id)!.id, attributes: original.attributes } } } } } };
    const later = { ...withReport, seasonNumber: 6, date: own.date };
    const knowledge = getPlayerKnowledge(later, id);
    expect(knowledge.kind).toBe('report');
    expect(knowledge.attributes).toBeNull();
    expect(knowledge.observedOn).toBe(initial.date);
    expect(later.scouting.clubs[outsider]!.squadKnowledge[id]!.attributes).toEqual(original.attributes);
  });
});

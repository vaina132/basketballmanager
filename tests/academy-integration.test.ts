import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd, substitutePlayer } from '../src/engine/match';
import { getClubAcademy } from '../src/world/academy-policy';
import { offerAcademyPromotion, setAcademyFocus } from '../src/world/academy';
import { offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { contractForSeason } from '../src/world/employment-policy';
import { getPlayerHealth } from '../src/world/health';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getSeasonPerformance } from '../src/world/performance';
import { getCareerPlayer, getCareerPlayerAge, getCareerPlayers } from '../src/world/player-catalog';
import { decideInSeasonTransfer, submitInSeasonTransferOffer } from '../src/world/recruitment';
import { quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from '../src/world/midseason-transfer-policy';
import { getFixtureTeams } from '../src/world/rosters';
import { setShortlisted } from '../src/world/scouting';
import { getPlayerKnowledge } from '../src/world/scouting-policy';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';

const clubId = 'rhine-falcons';
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });

describe('academy graduates across the senior career systems', () => {
  let initial: SeasonState, offered: SeasonState, promoted: SeasonState, played: SeasonState, nextYear: SeasonState;
  let playerId: string;
  beforeAll(() => {
    initial = createSeason(227, clubId, 'off', true, true, true, true, null, true, true, true, true, true, true, true, true, true, true);
    playerId = getClubAcademy(initial)[0]!.player.id;
    let trained = setAcademyFocus(initial, playerId, 'threePoint');
    for (let week = 0; week < 4; week += 1) trained = play(trained);
    offered = offerAcademyPromotion(trained, playerId, requiredNegotiationWage(playerId, 1, undefined, trained));
    promoted = play(offered);
    const side = managedSide(promoted);
    const match = promoted.activeMatch!.lineups[side].includes(playerId) ? promoted.activeMatch! : substitutePlayer(promoted.activeMatch!, side, promoted.activeMatch!.lineups[side][0]!, playerId);
    played = play({ ...promoted, activeMatch: match });
    let continuing = offerPlayerContract(played, playerId, requiredNegotiationWage(playerId, 3, undefined, played), 3);
    continuing = setEmploymentDelegation(continuing, true);
    while (continuing.status === 'active') continuing = play(continuing);
    for (let step = 0; step < 40 && getMarketStartReason(continuing); step += 1) continuing = advanceMarket(continuing);
    nextYear = rolloverSeason(continuing);
  }, 120_000);

  it('retains academy gains and joins only after the actual offer response', () => {
    const prospect = initial.academy.prospects.find(row => row.player.id === playerId)!;
    expect(getCareerPlayers(offered).some(player => player.id === playerId)).toBe(false);
    expect(offered.activeMatch![managedSide(offered)].players.some(player => player.id === playerId)).toBe(false);
    const graduate = promoted.academy.graduates.find(row => row.player.id === playerId)!;
    expect(graduate.player.attributes.threePoint).toBeGreaterThan(prospect.player.attributes.threePoint);
    expect(getCareerPlayer(promoted, playerId)).toEqual(graduate.player);
    expect(promoted.activeMatch![managedSide(promoted)].players.find(player => player.id === playerId)?.attributes).toEqual(graduate.player.attributes);
    expect(Object.values(promoted.training.points[playerId]!)).toEqual(Array(7).fill(0));
    expect(promoted.conditions[playerId]).toBe(100);
    expect(getPlayerHealth(promoted, playerId)).toBeNull();
    expect(getCareerPlayerAge(promoted, playerId, promoted.date)).toBe(16);
    expect(promoted.payroll.agreements.find(agreement => agreement.playerId === playerId)).toMatchObject({ clubId, startsRound: promoted.round, seasonNumber: 1 });
    expect(contractForSeason(promoted.employment, playerId, 1)?.kind).toBe('midseason');
  });

  it('preserves pre-promotion rosters and records actual minutes and wages afterward', () => {
    const before = promoted.fixtures.find(fixture => fixture.id === offered.activeFixtureId!)!;
    const teams = getFixtureTeams(promoted, before);
    expect([...teams.home.players, ...teams.away.players].some(player => player.id === playerId)).toBe(false);
    expect(before.result!.stats![playerId]).toBeUndefined();
    const performance = getSeasonPerformance(played).find(row => row.player.id === playerId && row.club.id === clubId)!;
    expect(performance.games).toBe(1);
    expect(performance.totals.secondsPlayed).toBeGreaterThan(0);
    expect(performance.log).toHaveLength(1);
    expect(performance.log[0]!.round).toBe(promoted.round);
    const charges = played.finance.ledger.flatMap(entry => entry.payroll?.items ?? []).filter(item => item.playerId === playerId);
    expect(charges.length).toBeGreaterThan(0);
    expect(charges.every(item => item.amount > 0)).toBe(true);
  });

  it('keeps own skills exact and outsider knowledge unknown until evidence exists', () => {
    const own = getPlayerKnowledge(promoted, playerId);
    expect(own.kind).toBe('own');
    expect(own.attributes).toEqual(getCareerPlayer(promoted, playerId).attributes);
    const opponent = promoted.clubs.find(club => club.id !== clubId)!.id;
    expect(getPlayerKnowledge(promoted, playerId, opponent).attributes).toBeNull();
    const shortlisted = setShortlisted(promoted, playerId, true);
    expect(shortlisted.scouting.clubs[clubId]!.shortlist).toContain(playerId);
    expect(shortlisted.scouting.clubs[clubId]!.assignments).toEqual(promoted.scouting.clubs[clubId]!.assignments);
    expect(parseSeason(serializeSeason(shortlisted))).toEqual(shortlisted);
  });

  it('transfers a graduate with normal consent, wages and historical club attribution', () => {
    const wage = requiredNegotiationWage(playerId, 1, undefined, played);
    const fee = requiredInSeasonTransferFee(played, playerId);
    const buyer = played.clubs.find(club => club.id !== clubId && quoteInSeasonTransferOffer(played, playerId, wage, 1, fee, club.id).canOffer)!;
    expect(buyer).toBeDefined();
    let proposed = submitInSeasonTransferOffer(played, playerId, wage, 1, fee, buyer.id);
    const offer = proposed.recruitment.offers.at(-1)!;
    proposed = decideInSeasonTransfer(proposed, offer.id, 'accept');
    const transferred = play(proposed);
    expect(contractForSeason(transferred.employment, playerId, 1)?.clubId).toBe(buyer.id);
    expect(transferred.clubs.find(club => club.id === clubId)!.players.some(player => player.id === playerId)).toBe(false);
    expect(transferred.clubs.find(club => club.id === buyer.id)!.players.some(player => player.id === playerId)).toBe(true);
    expect(transferred.academy.graduates.find(row => row.player.id === playerId)).toEqual(played.academy.graduates.find(row => row.player.id === playerId));
    expect(getPlayerKnowledge(transferred, playerId).kind).toBe('report');
    expect(getSeasonPerformance(transferred).find(row => row.player.id === playerId && row.club.id === clubId)!.log.some(log => log.round === promoted.round && log.stats.secondsPlayed > 0)).toBe(true);
    expect(parseSeason(serializeSeason(transferred))).toEqual(transferred);
  });

  it('renews the graduate, rebuilds opening payroll and retains the archived appearance', () => {
    expect(nextYear.seasonNumber).toBe(2);
    expect(contractForSeason(nextYear.employment, playerId, 2)).toMatchObject({ clubId, endsSeason: 4 });
    expect(nextYear.clubs.find(club => club.id === clubId)!.players.some(player => player.id === playerId)).toBe(true);
    expect(nextYear.payroll.agreements.some(agreement => agreement.playerId === playerId && agreement.seasonNumber === 2 && agreement.startsRound === 1)).toBe(true);
    const history = getSeasonPerformance(nextYear, 1).find(row => row.player.id === playerId && row.club.id === clubId)!;
    expect(history.log.some(log => log.round === promoted.round && log.stats.secondsPlayed > 0)).toBe(true);
    expect(nextYear.academy.intakes.filter(intake => intake.clubId === clubId && intake.seasonNumber === 2)[0]!.prospectIds).toHaveLength(2);
    expect(parseSeason(serializeSeason(nextYear))).toEqual(nextYear);
    expect(advanceSeason({ ...nextYear, activeMatch: simulateToEnd(setAutoSubstitutions(nextYear.activeMatch!, managedSide(nextYear), true)) })).toEqual(play(parseSeason(serializeSeason(nextYear))));
  });
});

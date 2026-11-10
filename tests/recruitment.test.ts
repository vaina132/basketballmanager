import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { contractForRound, contractForSeason, effectiveContractsForRound, WAGE_STEP } from '../src/world/employment-policy';
import { getFinanceBalance } from '../src/world/finance';
import { advanceMarket, submitMarketOffer } from '../src/world/market';
import { getPlayerPayroll } from '../src/world/payroll';
import { getPayrollReserve, getSpendableCash, payrollInstallment } from '../src/world/payroll-policy';
import { createInSeasonRecruitment, enableInSeasonRecruitment, resolveInSeasonRecruitment, scheduleInSeasonRecruitment, submitInSeasonOffer, withdrawInSeasonOffer } from '../src/world/recruitment';
import { getInSeasonBudget, getInSeasonCandidates, getInSeasonOffers, getReservedInSeasonWages, quoteInSeasonOffer } from '../src/world/recruitment-policy';
import { rosterForRound } from '../src/world/rosters';
import { advanceSeason, createSeason, dateForRound, managedSide, rolloverSeason } from '../src/world/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';

const clubId = 'rhine-falcons';
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
function finish(state: SeasonState): SeasonState { while (state.status === 'active') state = play(state); return state; }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Only scarcity guard tests use an accounting fixture; gameplay and save fixtures use real commands. */
function withCash(state: SeasonState, id: string, cash: number): SeasonState {
  const balance = getFinanceBalance(state.finance, id), amount = cash - balance.cash + balance.unpaid;
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, { id: `finance-${state.finance.ledger.length + 1}`, clubId: id, amount, kind: 'sponsor', sourceId: 'scarcity-test', seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null }] } };
}

describe('dated in-season free-agent recruitment', () => {
  let opening: SeasonState, playerId: string, wage: number;
  beforeAll(() => {
    let state = advanceMarket(finish(createSeason(53, clubId, 'off', true, true, true, true, null, true, true, true, true)));
    for (const player of state.clubs.find(club => club.id === clubId)!.players.slice(0, 8)) state = submitMarketOffer(state, player.id, getSeasonWage(player.id), 1);
    opening = freeze(rolloverSeason(advanceMarket(state)));
    playerId = getInSeasonCandidates(opening)[0]!.id;
    wage = getSeasonWage(playerId);
  }, 30_000);

  it('reserves only remaining wages and leaves the prepared match and current registration untouched', () => {
    expect(getInSeasonCandidates(opening)).toHaveLength(12);
    const quote = quoteInSeasonOffer(opening, playerId, wage);
    expect(quote).toMatchObject({ canOffer: true, responseRound: 2, responseOn: dateForRound(2, 2), remainingWages: wage * .9 });
    const pending = submitInSeasonOffer(opening, playerId, wage);
    for (const key of ['activeMatch', 'fixtures', 'clubs', 'rosters', 'conditions', 'training', 'finance', 'payroll', 'employment', 'negotiations'] as const) expect(pending[key]).toBe(opening[key]);
    expect(getReservedInSeasonWages(pending, clubId)).toBe(quote.remainingWages);
    expect(getSpendableCash(pending, clubId)).toBe(getSpendableCash(opening, clubId) - quote.remainingWages);
    expect(getInSeasonBudget(pending)).toMatchObject({ rosterSize: 8, reservedRosterSize: 1, reservedWages: wage });
    expect(submitInSeasonOffer(pending, playerId, wage)).toBe(pending);
    const replaced = submitInSeasonOffer(pending, playerId, wage + WAGE_STEP);
    expect(getInSeasonOffers(replaced, clubId).map(offer => offer.status)).toEqual(['replaced', 'pending']);
    expect(getReservedInSeasonWages(replaced, clubId)).toBe((wage + WAGE_STEP) * .9);
    const withdrawn = withdrawInSeasonOffer(replaced, getInSeasonOffers(replaced, clubId, true)[0]!.id);
    expect(getReservedInSeasonWages(withdrawn, clubId)).toBe(0);
    expect(getSpendableCash(withdrawn, clubId)).toBe(getSpendableCash(opening, clubId));
  });

  it('registers replies after the old squad trains, preserves jerseys and starts payroll on arrival', () => {
    const pending = submitInSeasonOffer(opening, playerId, wage), next = play(pending);
    const arrival = contractForRound(next.employment, playerId, 2, 2)!;
    expect(arrival).toMatchObject({ clubId, startsSeason: 2, endsSeason: 2, startsRound: 2, signedRound: 2, kind: 'midseason', seasonWage: wage });
    expect(contractForRound(next.employment, playerId, 2, 1)).toBeNull();
    expect(getInSeasonOffers(next, clubId)[0]).toMatchObject({ status: 'accepted', respondedOn: next.date, closedOn: next.date });
    expect(next.negotiations.records.at(-1)).toMatchObject({ startsSeason: 2, offeredSeasons: 1, contractId: arrival.id });
    expect(rosterForRound(next.rosters, clubId, 1)).toEqual(rosterForRound(opening.rosters, clubId, 1));
    const beforePlayers = opening.clubs.find(club => club.id === clubId)!.players;
    const afterPlayers = next.clubs.find(club => club.id === clubId)!.players;
    expect(afterPlayers.slice(0, beforePlayers.length)).toEqual(beforePlayers);
    expect(afterPlayers.at(-1)?.id).toBe(playerId);
    expect(new Set(afterPlayers.map(player => player.number)).size).toBe(afterPlayers.length);
    expect(next.rosters.filter(roster => roster.fromRound === 2)).toHaveLength(1);
    expect(next.training.lastWeek!.players[playerId]).toBeUndefined();
    expect(next.training.plans[clubId]!.individual[playerId]).toBe('team');
    expect(next.training.points[playerId]).toEqual(opening.training.points[playerId]);
    expect(next.conditions[playerId]).toBe(opening.conditions[playerId]);
    expect(next.fixtures.filter(fixture => fixture.round === 1).every(fixture => !fixture.result!.stats[playerId])).toBe(true);
    expect(next.activeMatch[managedSide(next)].players.some(player => player.id === playerId)).toBe(true);
    expect(getPlayerPayroll(next, playerId)).toMatchObject({ agreement: { startsRound: 2 }, charged: 0, futureCommitted: wage * .9, nextInstallment: payrollInstallment(wage, 2) });
    const played = play(next);
    expect(getPlayerPayroll(played, playerId)).toMatchObject({ charged: payrollInstallment(wage, 2), futureCommitted: wage * .8 });
    expect(played.training.lastWeek!.players[playerId]).toBeTruthy();
    expect(resolveInSeasonRecruitment(played)).toBe(played);
  });

  it('groups simultaneous arrivals into one registration while keeping all prior result identities', () => {
    const otherId = getInSeasonCandidates(opening)[1]!.id;
    const next = play(submitInSeasonOffer(submitInSeasonOffer(opening, playerId, wage), otherId, getSeasonWage(otherId)));
    expect(next.rosters.filter(roster => roster.clubId === clubId && roster.fromRound === 2)).toHaveLength(1);
    expect(next.clubs.find(club => club.id === clubId)!.players.slice(-2).map(player => player.id)).toEqual([playerId, otherId]);
    expect(next.payroll.agreements.slice(-2).map(agreement => agreement.playerId)).toEqual([playerId, otherId]);
    expect(getReservedInSeasonWages(next, clubId)).toBe(0);
  });

  it('chooses the best competing salary and resolves equal offers independently of submission order', () => {
    const rival = opening.clubs.find(club => club.id !== clubId)!.id;
    const competed = play(submitInSeasonOffer(submitInSeasonOffer(opening, playerId, wage), playerId, wage + WAGE_STEP, rival));
    expect(contractForSeason(competed.employment, playerId, 2)?.clubId).toBe(rival);
    const loser = getInSeasonOffers(competed, clubId)[0]!, winner = getInSeasonOffers(competed, rival)[0]!;
    expect(loser).toMatchObject({ status: 'lost', chosenOfferId: winner.id, negotiationId: null });
    const a = play(submitInSeasonOffer(submitInSeasonOffer(opening, playerId, wage), playerId, wage, rival));
    const b = play(submitInSeasonOffer(submitInSeasonOffer(opening, playerId, wage, rival), playerId, wage));
    expect(contractForSeason(a.employment, playerId, 2)?.clubId).toBe(contractForSeason(b.employment, playerId, 2)?.clubId);
    expect(a.fixtures).toEqual(b.fixtures);
  });

  it('closes counteroffers and rejection holds, then dates a fresh improved proposal for the next matchday', () => {
    const counter = play(submitInSeasonOffer(opening, playerId, wage - WAGE_STEP));
    expect(getInSeasonOffers(counter, clubId)[0]).toMatchObject({ status: 'countered', closedOn: counter.date });
    expect(getReservedInSeasonWages(counter, clubId)).toBe(0);
    expect(contractForSeason(counter.employment, playerId, 2)).toBeNull();
    const improved = submitInSeasonOffer(counter, playerId, wage);
    expect(getInSeasonOffers(improved, clubId, true)[0]).toMatchObject({ offeredRound: 2, responseRound: 3, remainingWages: wage * .8 });
    expect(contractForRound(play(improved).employment, playerId, 2, 3)?.startsRound).toBe(3);
    const rejected = play(submitInSeasonOffer(opening, playerId, 500_000));
    expect(getInSeasonOffers(rejected, clubId)[0]?.status).toBe('rejected');
    expect(getReservedInSeasonWages(rejected, clubId)).toBe(0);
  });

  it('enforces current employment, protected cash, annual salary and held squad slots', () => {
    expect(quoteInSeasonOffer(opening, opening.clubs[0]!.players[0]!.id, wage).reason).toMatch(/free agent/i);
    const poor = withCash(opening, clubId, getPayrollReserve(opening, clubId) + wage * .9 - 1);
    expect(quoteInSeasonOffer(poor, playerId, wage).reason).toMatch(/remaining salary/i);
    let full = opening;
    for (const player of getInSeasonCandidates(opening).slice(0, 4)) full = submitInSeasonOffer(full, player.id, getSeasonWage(player.id));
    expect(getInSeasonBudget(full)).toMatchObject({ rosterSize: 8, reservedRosterSize: 4 });
    expect(quoteInSeasonOffer(full, getInSeasonCandidates(opening)[4]!.id, wage).reason).toMatch(/twelve/i);
    let expensive = opening;
    for (const player of getInSeasonCandidates(opening)) {
      if (!quoteInSeasonOffer(expensive, player.id, 5_000_000).canOffer) { expect(quoteInSeasonOffer(expensive, player.id, 5_000_000).reason).toMatch(/salary budget/i); break; }
      expensive = submitInSeasonOffer(expensive, player.id, 5_000_000);
    }
  });

  it('cancels unaffordable replies without inventing a player negotiation', () => {
    const pending = submitInSeasonOffer(opening, playerId, wage);
    const scarce = withCash(pending, clubId, 0);
    const next = play(scarce);
    expect(getInSeasonOffers(next, clubId)[0]).toMatchObject({ status: 'cancelled', respondedOn: next.date, negotiationId: null });
    expect(next.negotiations.records).toEqual(opening.negotiations.records);
    expect(contractForSeason(next.employment, playerId, 2)).toBeNull();
  });

  it('activates prospectively and refuses offers without a later registration date', () => {
    let legacy: SeasonState = { ...opening, recruitment: createInSeasonRecruitment() };
    legacy = play(legacy);
    const enabled = enableInSeasonRecruitment(legacy);
    expect(enabled.recruitment.enabledSince).toMatchObject({ seasonNumber: 2, round: 2 });
    expect(enabled.activeMatch).toBe(legacy.activeMatch);
    expect(quoteInSeasonOffer(enabled, playerId, wage).responseRound).toBe(3);
    let late = opening;
    while (late.round < 9) late = play(late);
    const joined = play(submitInSeasonOffer(late, playerId, wage));
    expect(getPlayerPayroll(joined, playerId)?.futureCommitted).toBe(payrollInstallment(wage, 10));
    expect(quoteInSeasonOffer(joined, getInSeasonCandidates(joined)[0]!.id, wage).reason).toMatch(/later matchday/i);
    const completed = play(joined);
    expect(getPlayerPayroll(completed, playerId)?.charged).toBe(payrollInstallment(wage, 10));
  }, 30_000);

  it('uses shared holds for assistant recruitment and AI injury repairs', () => {
    const delegated = setEmploymentDelegation(opening, true);
    expect(getInSeasonOffers(delegated, clubId, true)).toHaveLength(2);
    expect(scheduleInSeasonRecruitment(delegated)).toEqual(delegated);
    const joined = play(delegated);
    expect(effectiveContractsForRound(joined.employment, 2, 2).filter(contract => contract.clubId === clubId)).toHaveLength(10);
    const rival = opening.clubs.find(club => club.id !== clubId)!;
    const injured = { ...opening, injuries: [{ id: 'injury-policy-fixture', playerId: rival.players[0]!.id, clubId: rival.id, kind: 'ankle' as const, fixtureId: opening.fixtures[0]!.id, occurredOn: opening.date, returnOn: dateForRound(4, 2) }] };
    const repaired = scheduleInSeasonRecruitment(injured);
    expect(getInSeasonOffers(repaired, rival.id, true)).toHaveLength(1);
    expect(getInSeasonOffers(repaired, clubId, true)).toHaveLength(0);
  });

  it('saves and replays pending, accepted and completed partial-season employment', () => {
    const pending = submitInSeasonOffer(opening, playerId, wage);
    expect(parseSeason(serializeSeason(pending))).toEqual(pending);
    const joined = play(pending);
    expect(parseSeason(serializeSeason(joined))).toEqual(joined);
    const completed = finish(joined);
    expect(parseSeason(serializeSeason(completed))).toEqual(completed);
  }, 30_000);
});

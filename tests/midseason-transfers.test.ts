import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { offerPlayerContract } from '../src/world/employment';
import { contractForRound, getClubContractSummary, quotePlayerContract, WAGE_STEP } from '../src/world/employment-policy';
import { getFinanceBalance } from '../src/world/finance';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getClubPayrollSummary, getPlayerPayroll, prepayWages } from '../src/world/payroll';
import { agreementCommitted, agreementThroughRound, getSpendableCash, payrollInstallment } from '../src/world/payroll-policy';
import { decideInSeasonTransfer, enableInSeasonTransfers, scheduleInSeasonRecruitment, submitInSeasonTransferOffer, withdrawInSeasonOffer } from '../src/world/recruitment';
import { getInSeasonOffers, getReservedInSeasonFees, getReservedInSeasonWages, quoteInSeasonSale, quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from '../src/world/recruitment-policy';
import { rosterForRound } from '../src/world/rosters';
import { advanceSeason, createSeason, dateForRound, managedSide } from '../src/world/season';
import { getTransferObligationReserve } from '../src/world/transfer-payments';

const buyer = 'rhine-falcons', seller = 'aegean-waves', rival = 'alpine-stags';
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

describe('midseason club transfers', () => {
  let initial: SeasonState, target: string, fee: number, wage: number;
  beforeAll(() => {
    initial = freeze(createSeason(53, buyer, 'off', true, true, true, true, null, true, true, true, true));
    target = initial.clubs.find(club => club.id === seller)!.players[0]!.id;
    fee = requiredInSeasonTransferFee(initial, target); wage = getSeasonWage(target);
  });

  it('dates AI-approved terms for the next matchday and protects fee, salary and future annual capacity', () => {
    const salary = requiredNegotiationWage(target, 3);
    const pending = submitInSeasonTransferOffer(initial, target, salary, 3, fee);
    const offer = getInSeasonOffers(pending, buyer, true)[0]!;
    expect(offer).toMatchObject({ status: 'pending', offeredRound: 1, responseRound: 2, seasons: 3, transfer: { clubStatus: 'accepted', sellerClubId: seller, clubRespondedOn: initial.date } });
    expect(pending.recruitment.events.slice(-2).map(event => event.type)).toEqual(['offer', 'club-decision']);
    for (const key of ['activeMatch', 'fixtures', 'clubs', 'rosters', 'conditions', 'training', 'finance', 'payroll', 'employment', 'negotiations'] as const) expect(pending[key]).toBe(initial[key]);
    expect(getReservedInSeasonFees(pending, buyer)).toBe(fee);
    expect(getReservedInSeasonWages(pending, buyer)).toBe(salary * .9);
    expect(getSpendableCash(pending, buyer)).toBe(getSpendableCash(initial, buyer) - fee - salary * .9);
    expect(getClubContractSummary(pending, buyer, 2)).toMatchObject({ reservedRosterSize: 1, reservedWages: salary });
    expect(getClubContractSummary(pending, buyer, 3)).toMatchObject({ reservedRosterSize: 1, reservedWages: salary });
    expect(submitInSeasonTransferOffer(pending, target, salary, 3, fee)).toBe(pending);
    expect(getSpendableCash(withdrawInSeasonOffer(pending, offer.id), buyer)).toBe(getSpendableCash(initial, buyer));
  });

  it('moves current and future rights together while historical ownership, jerseys and training stay intact', () => {
    const pending = submitInSeasonTransferOffer(initial, target, requiredNegotiationWage(target, 3), 3, fee);
    const next = play(pending), unchanged = play(initial), transfer = next.employment.transfers.at(-1)!;
    expect(transfer).toMatchObject({ playerId: target, fromClubId: seller, toClubId: buyer, startsSeason: 1, startsRound: 2, fee });
    expect(contractForRound(next.employment, target, 1, 1)?.clubId).toBe(seller);
    expect(contractForRound(next.employment, target, 1, 2)).toMatchObject({ clubId: buyer, kind: 'midseason-transfer', startsRound: 2, endsSeason: 3 });
    expect(contractForRound(next.employment, target, 2, 1)?.clubId).toBe(buyer);
    expect(next.fixtures.filter(fixture => fixture.round === 1)).toEqual(unchanged.fixtures.filter(fixture => fixture.round === 1));
    expect(rosterForRound(next.rosters, seller, 1)).toEqual(rosterForRound(initial.rosters, seller, 1));
    expect(next.clubs.find(club => club.id === seller)!.players).toEqual(initial.clubs.find(club => club.id === seller)!.players.filter(player => player.id !== target));
    expect(next.clubs.find(club => club.id === buyer)!.players.slice(0, 10)).toEqual(initial.clubs.find(club => club.id === buyer)!.players);
    expect(next.rosters.filter(roster => roster.fromRound === 2)).toHaveLength(2);
    expect(next.plans[seller]!.lineup).not.toContain(target);
    expect(next.training.lastWeek).toEqual(unchanged.training.lastWeek);
    expect(next.training.plans[seller]!.individual[target]).toBeUndefined();
    expect(next.training.plans[buyer]!.individual[target]).toBe('team');
    expect(next.conditions[target]).toBe(unchanged.conditions[target]);
    expect(next.activeMatch![managedSide(next)].players.some(player => player.id === target)).toBe(true);
    expect(getReservedInSeasonFees(next, buyer)).toBe(0);
  });

  it('stops unposted seller wages, starts a separate buyer agreement and never refunds prepaid salary', () => {
    const sourcePlayer = initial.clubs.find(club => club.id === buyer)!.players[0]!.id;
    const prepaid = prepayWages(initial, sourcePlayer);
    const old = getPlayerPayroll(prepaid, sourcePlayer)!;
    const incoming = submitInSeasonTransferOffer(prepaid, sourcePlayer, getSeasonWage(sourcePlayer), 1, requiredInSeasonTransferFee(prepaid, sourcePlayer), seller);
    const offer = getInSeasonOffers(incoming, seller, true)[0]!;
    expect(quoteInSeasonSale(incoming, offer.id)).toMatchObject({ canAccept: true, remainingWagesFreed: 0, nonRefundablePrepayment: old.charged });
    const next = play(decideInSeasonTransfer(incoming, offer.id, 'accept'));
    const current = getPlayerPayroll(next, sourcePlayer)!;
    expect(current.agreement).toMatchObject({ id: `wage-s1-${sourcePlayer}-r2`, clubId: seller, startsRound: 2 });
    expect(next.finance.ledger.filter(entry => entry.sourceId === `prepay-${old.agreement.id}`)).toEqual(prepaid.finance.ledger.filter(entry => entry.sourceId === `prepay-${old.agreement.id}`));
    expect(agreementThroughRound(next, old.agreement)).toBe(1);
    expect(agreementCommitted(old.agreement, next.finance.ledger, agreementThroughRound(next, old.agreement), 10)).toBe(0);
    expect(getClubPayrollSummary(next, buyer).charged).toBe(old.charged + initial.clubs.find(club => club.id === buyer)!.players.filter(player => player.id !== sourcePlayer).reduce((sum, player) => sum + payrollInstallment(getSeasonWage(player.id), 1, 10), 0));
    const ordinary = submitInSeasonTransferOffer(initial, sourcePlayer, getSeasonWage(sourcePlayer), 1, requiredInSeasonTransferFee(initial, sourcePlayer), seller);
    expect(quoteInSeasonSale(ordinary, getInSeasonOffers(ordinary, seller, true)[0]!.id).remainingWagesFreed).toBe(getSeasonWage(sourcePlayer) * .9);
  });

  it('supports club counters, rejection and unanswered review expiry without player replies or payments', () => {
    const counter = submitInSeasonTransferOffer(initial, target, wage, 1, fee - 100_000);
    const countered = getInSeasonOffers(counter, buyer)[0]!;
    expect(countered).toMatchObject({ status: 'countered', negotiationId: null, transfer: { counterFee: fee, clubStatus: 'countered' } });
    expect(getReservedInSeasonFees(counter, buyer)).toBe(0);
    expect(getInSeasonOffers(submitInSeasonTransferOffer(counter, target, wage, 1, fee), buyer).map(offer => offer.status)).toEqual(['countered', 'pending']);
    const rejected = submitInSeasonTransferOffer(initial, target, wage, 1, 100_000);
    expect(getInSeasonOffers(rejected, buyer)[0]!.status).toBe('rejected');
    const sourcePlayer = initial.clubs.find(club => club.id === buyer)!.players[0]!.id;
    const incoming = submitInSeasonTransferOffer(initial, sourcePlayer, getSeasonWage(sourcePlayer), 1, requiredInSeasonTransferFee(initial, sourcePlayer), seller);
    expect(getInSeasonOffers(incoming, seller)[0]!.status).toBe('club-review');
    const expired = play(incoming);
    expect(getInSeasonOffers(expired, seller)[0]).toMatchObject({ status: 'expired', negotiationId: null, closedOn: expired.date });
    expect(expired.employment.transfers).toHaveLength(0);
    expect(getReservedInSeasonFees(expired, seller)).toBe(0);
    expect(() => decideInSeasonTransfer(incoming, getInSeasonOffers(incoming, seller)[0]!.id, 'accept', rival)).toThrow(/your club/i);
  });

  it('protects seller minimum-eight registrations across concurrent approvals and locks pending sale renewals', () => {
    const players = initial.clubs.find(club => club.id === seller)!.players;
    let pending = initial;
    for (const player of players.slice(0, 2)) pending = submitInSeasonTransferOffer(pending, player.id, getSeasonWage(player.id), 1, requiredInSeasonTransferFee(pending, player.id));
    expect(quoteInSeasonTransferOffer(pending, players[2]!.id, getSeasonWage(players[2]!.id), 1, requiredInSeasonTransferFee(pending, players[2]!.id), rival).reason).toMatch(/eight/i);
    expect(quotePlayerContract(pending, target, wage, 1, seller).reason).toMatch(/transfer proposals/i);
    const next = play(pending);
    expect(next.clubs.find(club => club.id === seller)!.players).toHaveLength(8);
    expect(next.clubs.find(club => club.id === buyer)!.players).toHaveLength(12);
  });

  it('selects competing accepted terms without duplicate ownership and releases losing fee holds', () => {
    const pending = submitInSeasonTransferOffer(submitInSeasonTransferOffer(initial, target, wage, 1, fee), target, wage + WAGE_STEP, 1, fee, rival);
    const next = play(pending);
    expect(contractForRound(next.employment, target, 1, 2)?.clubId).toBe(rival);
    expect(next.clubs.filter(club => club.players.some(player => player.id === target))).toHaveLength(1);
    expect(getInSeasonOffers(next, buyer)[0]).toMatchObject({ status: 'lost', negotiationId: null });
    expect(getReservedInSeasonFees(next, buyer)).toBe(0);
    expect(next.employment.transfers).toHaveLength(1);
  });

  it('freezes future installments and reserves the entire unpaid fee', () => {
    const next = play(submitInSeasonTransferOffer(initial, target, wage, 1, fee, buyer, 'three-payments'));
    const transfer = next.employment.transfers.at(-1)!;
    expect(transfer.installments).toEqual([{ dueOn: next.date, amount: Math.floor(fee / 2) }, { dueOn: dateForRound(1, 2), amount: Math.floor(fee / 4) }, { dueOn: dateForRound(6, 2), amount: fee - Math.floor(fee / 2) - Math.floor(fee / 4) }]);
    expect(transfer.payments).toHaveLength(1);
    expect(transfer.payments[0]!.amount).toBe(Math.floor(fee / 2));
    expect(getTransferObligationReserve(next, buyer)).toBe(fee - Math.floor(fee / 2));
    expect(getFinanceBalance(next.finance, seller).cash).toBe(getFinanceBalance(play(initial).finance, seller).cash + Math.floor(fee / 2));
  });

  it('keeps new transfers prospective for older careers and rejects repeat moves', () => {
    const old: SeasonState = { ...initial, recruitment: { ...initial.recruitment, transfersEnabledSince: null, events: initial.recruitment.events.filter(event => event.type !== 'enable-transfers') } };
    expect(quoteInSeasonTransferOffer(old, target, wage, 1, fee).reason).toMatch(/enable/i);
    const enabled = enableInSeasonTransfers(old);
    expect(enabled.activeMatch!).toBe(old.activeMatch!);
    expect(enabled.recruitment.transfersEnabledSince?.round).toBe(1);
    const next = play(submitInSeasonTransferOffer(enabled, target, wage, 1, fee));
    expect(quoteInSeasonTransferOffer(next, target, wage, 1, requiredInSeasonTransferFee(next, target), rival).reason).toMatch(/already moved/i);
  });

  it('uses paid AI recruitment only for a genuine shortage when no free agent is available', () => {
    expect(scheduleInSeasonRecruitment(initial)).toEqual(initial);
    const club = initial.clubs.find(club => club.id === seller)!;
    const shortage: SeasonState = { ...initial, injuries: club.players.slice(0, 3).map((player, index) => ({ id: `policy-injury-${index}`, playerId: player.id, clubId: seller, kind: 'ankle-sprain', fixtureId: initial.fixtures[0]!.id, occurredOn: initial.date, returnOn: dateForRound(4) })) };
    const repaired = scheduleInSeasonRecruitment(shortage);
    const offers = getInSeasonOffers(repaired, seller, true);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.transfer).not.toBeNull();
    expect(offers[0]!.seasons).toBe(1);
  });

  it('releases independently renewed future seller agreements, protecting existing buyer future commitments', () => {
    const managedTarget = initial.clubs.find(club => club.id === buyer)!.players[0]!.id;
    const extended = offerPlayerContract(initial, managedTarget, requiredNegotiationWage(managedTarget, 2), 2);
    const incoming = submitInSeasonTransferOffer(extended, managedTarget, getSeasonWage(managedTarget), 1, requiredInSeasonTransferFee(extended, managedTarget), seller);
    const accepted = decideInSeasonTransfer(incoming, getInSeasonOffers(incoming, seller, true)[0]!.id, 'accept');
    const next = play(accepted), transfer = next.employment.transfers.at(-1)!;
    expect(transfer.releasedContractIds).toHaveLength(2);
    expect(contractForRound(next.employment, managedTarget, 2, 1)).toBeNull();
    expect(contractForRound(next.employment, managedTarget, 1, 1)?.clubId).toBe(buyer);
    expect(contractForRound(next.employment, managedTarget, 1, 2)?.clubId).toBe(seller);
  });
});

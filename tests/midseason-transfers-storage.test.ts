import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { getSeasonWage } from '../src/data/development-wages';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { contractForRound } from '../src/world/employment-policy';
import { requiredInSeasonTransferFee } from '../src/world/midseason-transfer-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { getClubPayrollSummary } from '../src/world/payroll';
import { decideInSeasonTransfer, submitInSeasonTransferOffer } from '../src/world/recruitment';
import { rosterForRound } from '../src/world/rosters';
import { advanceSeason, createSeason, dateForRound, managedSide } from '../src/world/season';

const managed = 'rhine-falcons', seller = 'aegean-waves', target = 'aew-1';
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
let opening: SeasonState, pending: SeasonState, arrived: SeasonState, paid: SeasonState, incoming: SeasonState, sold: SeasonState, lost: SeasonState;
let playerId: string, ownPlayerId: string;

beforeAll(() => {
  opening = createSeason(73, managed, 'off', true, true, true, true, null, true, true, true, true);
  playerId = opening.clubs.find(club => club.id === seller)!.players.find(player => player.id === target)?.id ?? opening.clubs.find(club => club.id === seller)!.players[0]!.id;
  ownPlayerId = opening.clubs.find(club => club.id === managed)!.players[0]!.id;
  pending = submitInSeasonTransferOffer(opening, playerId, requiredNegotiationWage(playerId, 3), 3, requiredInSeasonTransferFee(opening, playerId), managed, 'three-payments');
  arrived = play(pending); paid = play(arrived);
  incoming = submitInSeasonTransferOffer(opening, ownPlayerId, getSeasonWage(ownPlayerId), 1, requiredInSeasonTransferFee(opening, ownPlayerId), seller);
  sold = play(decideInSeasonTransfer(incoming, incoming.recruitment.offers.at(-1)!.id, 'accept'));
  const rival = opening.clubs.find(club => ![managed, seller].includes(club.id))!.id;
  lost = play(submitInSeasonTransferOffer(pending, playerId, requiredNegotiationWage(playerId, 3) + 50_000, 3, requiredInSeasonTransferFee(opening, playerId), rival));
}, 60_000);

describe('paid in-season transfer persistence', () => {
  it('round-trips club review, approval, arrivals, new payroll and competing choices without changing the next match action', () => {
    for (const state of [opening, pending, arrived, paid, incoming, sold, lost]) {
      const restored = parseSeason(serializeSeason(state));
      expect(restored).toEqual(state);
      expect(stepMatch(restored.activeMatch)).toEqual(stepMatch(state.activeMatch));
    }
  });

  it('keeps both club histories and prepaid seller costs while the new club starts a distinct wage stint', () => {
    expect(contractForRound(arrived.employment, playerId, 1, 1)?.clubId).toBe(seller);
    expect(contractForRound(arrived.employment, playerId, 1, 2)?.clubId).toBe(managed);
    expect(rosterForRound(arrived.rosters, seller, 1).players.some(player => player.id === playerId)).toBe(true);
    expect(rosterForRound(arrived.rosters, seller, 2).players.some(player => player.id === playerId)).toBe(false);
    expect(rosterForRound(arrived.rosters, managed, 1).players.some(player => player.id === playerId)).toBe(false);
    expect(rosterForRound(arrived.rosters, managed, 2).players.some(player => player.id === playerId)).toBe(true);
    const original = opening.payroll.agreements.find(agreement => agreement.playerId === playerId)!;
    expect(arrived.payroll.agreements.find(agreement => agreement.id === original.id)).toEqual(original);
    const historicalCharges = opening.finance.ledger.filter(entry => entry.payroll?.items.some(item => item.agreementId === original.id));
    expect(historicalCharges.some(entry => entry.payroll?.type === 'prepayment')).toBe(true);
    expect(arrived.finance.ledger.filter(entry => historicalCharges.some(old => old.id === entry.id))).toEqual(historicalCharges);
    expect(arrived.payroll.agreements.find(agreement => agreement.id === `wage-s1-${playerId}-r2`)).toMatchObject({ clubId: managed, startsRound: 2 });
    expect(getClubPayrollSummary(arrived, seller).charged).toBe(getClubPayrollSummary(opening, seller).charged);
    expect(arrived.employment.transfers[0]!.installments.map(item => item.dueOn)).toEqual([dateForRound(2, 1), dateForRound(1, 2), dateForRound(6, 2)]);
  });

  it('retains seller knowledge and the last old-squad training interval after departure', () => {
    expect(arrived.scouting.clubs[seller]!.squadKnowledge[playerId]).toMatchObject({ seasonNumber: 1, round: 1, clubId: seller });
    expect(arrived.scouting.clubs[managed]!.squadKnowledge[playerId]).toMatchObject({ seasonNumber: 1, round: 2, clubId: managed });
    expect(arrived.training.lastWeek!.rosterIds[seller]).toBe(rosterForRound(arrived.rosters, seller, 1).id);
    expect(arrived.training.lastWeek!.players[playerId]).toBeDefined();
    expect(sold.plans[managed]!.lineup).not.toContain(ownPlayerId);
    expect(sold.training.plans[managed]!.individual).not.toHaveProperty(ownPlayerId);
  });

  it('preserves transferred condition when the optional training system is disabled', () => {
    const start = createSeason(74, managed, 'off', false, true, true, true, null, true, true, true, true);
    const state = play(submitInSeasonTransferOffer(start, playerId, getSeasonWage(playerId), 1, requiredInSeasonTransferFee(start, playerId)));
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  });

  it.each<[string, (state: SeasonState) => void]>([
    ['registration round', state => { state.employment.transfers[0]!.startsRound = 1; }],
    ['completion date', state => { state.employment.transfers[0]!.completedOn = dateForRound(1, 1); }],
    ['source employer', state => { state.employment.transfers[0]!.fromClubId = managed; }],
    ['missing released agreement', state => { state.employment.transfers[0]!.releasedContractIds = []; }],
    ['transfer fee', state => { state.employment.transfers[0]!.fee += 100_000; }],
    ['future due date', state => { state.employment.transfers[0]!.installments[1]!.dueOn = dateForRound(1, 1); }],
    ['receipt round', state => { state.employment.transfers[0]!.payments[0]!.round = 1; }],
    ['buyer wage identity', state => { state.payroll.agreements.find(agreement => agreement.id === `wage-s1-${playerId}-r2`)!.id = `wage-s1-${playerId}`; }],
    ['rewritten seller wage', state => { state.payroll.agreements.find(agreement => agreement.id === `wage-s1-${playerId}`)!.seasonWage += 50_000; }],
    ['missing seller snapshot', state => { state.rosters = state.rosters.filter(roster => roster.clubId !== seller || roster.fromRound !== 2); }],
    ['rewritten earlier membership', state => { state.rosters.find(roster => roster.clubId === seller && roster.fromRound === 1)!.players = [...rosterForRound(state.rosters, seller, 2).players]; }],
    ['missing seller memory', state => { delete state.scouting.clubs[seller]!.squadKnowledge[playerId]; }],
    ['missing fee debit', state => { state.finance.ledger = state.finance.ledger.filter(entry => !(entry.kind === 'transfer' && entry.amount < 0)).map((entry, index) => ({ ...entry, id: `finance-${index + 1}` })); }],
    ['missing club consent', state => { state.recruitment.events = state.recruitment.events.filter(event => event.type !== 'club-decision'); }],
    ['changed club consent', state => { const event = state.recruitment.events.find(event => event.type === 'club-decision')!; if (event.type === 'club-decision') event.response = 'reject'; }],
    ['missing transfer activation', state => { state.recruitment.events = state.recruitment.events.filter(event => event.type !== 'enable-transfers'); }],
    ['activation cash anchor', state => { state.recruitment.transfersEnabledSince!.ledgerIndex -= 1; }],
    ['salary term length', state => { state.recruitment.offers[0]!.seasons = 1; }],
    ['fee proposal', state => { state.recruitment.offers[0]!.transfer!.fee += 100_000; }],
  ])('rejects forged %s', (_label, mutate) => {
    const state = structuredClone(arrived); mutate(state);
    expect(() => validateSeasonState(state)).toThrow();
  });
});

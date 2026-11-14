import { financeAtLedgerBoundary, financeLedgerSlice } from '../src/world/finance-ledger';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { ownerCapital } from '../src/world/board-consequences';
import { managedClubFor } from '../src/world/career';
import { setSponsorshipDelegation } from '../src/world/commercial';
import { setEmploymentDelegation } from '../src/world/employment';
import { contractForSeason } from '../src/world/employment-policy';
import { setFacilityDelegation } from '../src/world/facilities';
import { FACILITY_AUTOMATION_BUFFER } from '../src/world/facilities-policy';
import { ANNUAL_SPONSORSHIP, DEFAULT_TICKET_PRICE, financeLedgerRows, forecastGate, getFinanceBalance, recommendTicketPrice, setTicketPlan } from '../src/world/finance';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { createSeason, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { getInboxItems } from '../src/ui/inbox-items';
import { advanceMatchday } from './helpers/board-funding';

// Level 7 acceptance: overpricing affects demand plausibly; sponsors and capital projects cannot create free money;
// delegated actions respect policy and report results; dismissal preserves the world and enables a continuing career.
const FIRST = 'rhine-falcons';
/** Hand every delegable area of the managed club to automatic control. */
function automatic(state: SeasonState): SeasonState {
  let next = setEmploymentDelegation(state, true);
  if (!next.facilities.delegated[next.managedClubId]) next = setFacilityDelegation(next, true);
  if (!next.commercial.plans[next.managedClubId]!.delegated) next = setSponsorshipDelegation(next, true);
  if (!next.finance.plans[next.managedClubId]!.delegated) next = setTicketPlan(next, { ...next.finance.plans[next.managedClubId]!, delegated: true });
  return next;
}
function playSeason(state: SeasonState): SeasonState {
  let next = automatic(state);
  while (next.status === 'active') next = advanceMatchday(next);
  return next;
}
function nextSeason(state: SeasonState): SeasonState {
  let next = automatic(state);
  for (let step = 0; step < 80 && getMarketStartReason(next); step += 1) next = advanceMarket(next);
  return rolloverSeason(next);
}
let firstSeasonEnd: SeasonState, secondSeasonEnd: SeasonState, thirdSeason: SeasonState;

beforeAll(() => {
  // Seed 3: an all-automatic Rhine Falcons season ends Under pressure, so the board dismisses the manager.
  firstSeasonEnd = playSeason(createSeason({ seed: 3, managedClubId: FIRST, injuryMode: 'standard', manager: { name: 'Acceptance Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS }));
  secondSeasonEnd = playSeason(nextSeason(firstSeasonEnd));
  thirdSeason = nextSeason(secondSeasonEnd);
  for (let round = 0; round < 2; round += 1) thirdSeason = advanceMatchday(thirdSeason);
}, 480_000);

describe('Level 7 acceptance', () => {
  it('lets overpricing cost both crowd and income once the arena stops selling out', () => {
    const fixture = thirdSeason.fixtures.find(item => item.round === thirdSeason.round)!;
    const gates = [1, 1.5, 2, 3].map(factor => forecastGate(thirdSeason, fixture, DEFAULT_TICKET_PRICE * factor));
    for (const [index, gate] of gates.entries()) if (index) expect(gate.attendance).toBeLessThanOrEqual(gates[index - 1]!.attendance);
    // Demand falls faster than price rises: tripling the default price loses more than two thirds of the crowd and income.
    expect(gates[3]!.attendance).toBeLessThan(gates[0]!.attendance / 3);
    expect(gates[3]!.revenue).toBeLessThan(gates[2]!.revenue);
    const best = forecastGate(thirdSeason, fixture, recommendTicketPrice(thirdSeason, fixture));
    for (const gate of gates) expect(best.revenue).toBeGreaterThanOrEqual(gate.revenue);
  });

  it('pays sponsors only what their agreements promise and board capital only towards real construction', () => {
    const state = secondSeasonEnd, ledger = financeLedgerSlice(state.finance);
    for (const club of state.clubs) for (const season of [1, 2]) {
      const sponsor = ledger.filter(entry => entry.kind === 'sponsor' && entry.clubId === club.id && entry.seasonNumber === season);
      const agreed = sponsor.filter(entry => entry.sponsorship);
      expect(sponsor.filter(entry => !entry.sponsorship).reduce((sum, entry) => sum + entry.amount, 0)).toBeLessThanOrEqual(ANNUAL_SPONSORSHIP);
      for (const entry of agreed) {
        const agreement = state.commercial.agreements.find(item => item.id === entry.sponsorship!.agreementId)!;
        expect([agreement.clubId, season >= agreement.startsSeason && season <= agreement.endsSeason]).toEqual([club.id, true]);
      }
      for (const agreement of new Set(agreed.map(entry => entry.sponsorship!.agreementId))) {
        const terms = state.commercial.agreements.find(item => item.id === agreement)!;
        const paid = agreed.filter(entry => entry.sponsorship!.agreementId === agreement);
        expect(paid.filter(entry => entry.sponsorship!.installment !== 'bonus').reduce((sum, entry) => sum + entry.amount, 0)).toBeLessThanOrEqual(terms.annualFee);
        expect(paid.filter(entry => entry.sponsorship!.installment === 'bonus').reduce((sum, entry) => sum + entry.amount, 0)).toBeLessThanOrEqual(terms.bonus);
      }
      const capital = ledger.filter(entry => entry.kind === 'board-capital' && entry.clubId === club.id && entry.seasonNumber === season);
      expect(capital.reduce((sum, entry) => sum + entry.amount, 0)).toBeLessThanOrEqual(ownerCapital(state, club.id, season));
      for (const entry of capital) {
        const project = state.facilities.projects.find(item => item.id === entry.boardCapital!.projectId)!;
        // The approval is journaled right before the funded start; automatic control also restores its cash cushion.
        const start = state.facilities.events.findIndex(event => event.type === 'start' && event.projectId === project.id);
        const decision = state.facilities.events[start - 1]!;
        expect(decision).toMatchObject({ type: 'funding', approved: true, clubId: club.id, amount: entry.amount });
        expect(entry.amount).toBeLessThanOrEqual(project.cost + (decision.type === 'funding' && decision.mode === 'automatic' ? FACILITY_AUTOMATION_BUFFER : 0));
        expect(ledger.find(item => item.kind === 'facility' && item.sourceId === project.id)!.amount).toBe(-project.cost);
      }
    }
    expect(ledger.some(entry => entry.kind === 'board-capital')).toBe(true);
    for (const project of state.facilities.projects) expect(ledger.filter(entry => entry.kind === 'facility' && entry.sourceId === project.id).map(entry => entry.amount)).toEqual([-project.cost]);
    // The strict save check replays every gate, payment, offer and approval from the recorded history.
    expect(parseSeason(serializeSeason(state))).toEqual(state);
  });

  it('keeps automatic decisions within the money a club has and reports them to the manager', () => {
    const state = secondSeasonEnd, ledger = financeLedgerSlice(state.finance);
    for (const event of state.facilities.events) if (event.type === 'start') {
      const project = state.facilities.projects.find(item => item.id === event.projectId)!;
      expect(getFinanceBalance(financeAtLedgerBoundary(state.finance, event.ledgerIndex), event.clubId).cash).toBeGreaterThanOrEqual(project.cost);
    }
    const managed = state.managedClubId, inbox = getInboxItems(state);
    const automaticSigning = state.commercial.agreements.find(agreement => agreement.clubId === managed && agreement.automatic);
    if (automaticSigning) expect(inbox.find(item => item.id === automaticSigning.id)?.detail).toContain('chosen by automatic control');
    for (const event of state.facilities.events) if (event.type === 'funding' && event.clubId === managed && event.seasonNumber === state.seasonNumber) expect(inbox.some(item => item.title.startsWith(event.approved ? 'Board capital approved' : 'Board capital refused'))).toBe(true);
    // Every automatic payment of the managed club appears in its ledger rows on the Club page.
    const rows = financeLedgerRows(state.finance, managed);
    expect(rows.length).toBe(ledger.filter(entry => entry.clubId === managed).length);
  });

  it('preserves the world through a dismissal and continues the career at the new club', () => {
    const move = firstSeasonEnd.career.moves[0]!;
    expect(move).toMatchObject({ seasonNumber: 1, fromClubId: FIRST, reason: 'dismissed' });
    expect(firstSeasonEnd.clubs.map(club => club.id)).toEqual(thirdSeason.clubs.map(club => club.id));
    // The former club keeps playing under automatic control with a full squad.
    expect([firstSeasonEnd.facilities.delegated[FIRST], firstSeasonEnd.commercial.plans[FIRST]!.delegated, firstSeasonEnd.finance.plans[FIRST]!.delegated]).toEqual([true, true, true]);
    expect(thirdSeason.employment.contracts.filter(contract => contract.clubId === FIRST && contractForSeason(thirdSeason.employment, contract.playerId, 3)?.id === contract.id).length).toBeGreaterThanOrEqual(8);
    expect(secondSeasonEnd.fixtures.filter(fixture => [fixture.homeClubId, fixture.awayClubId].includes(FIRST)).every(fixture => fixture.result)).toBe(true);
    // History is intact and attributed to the club managed at the time.
    expect(thirdSeason.history.map(archive => archive.fixtures.every(fixture => fixture.result))).toEqual([true, true]);
    expect([managedClubFor(thirdSeason, 1, false), managedClubFor(thirdSeason, 2, false)]).toEqual([FIRST, move.toClubId]);
    expect([thirdSeason.seasonNumber, thirdSeason.round]).toEqual([3, 3]);
    expect(parseSeason(serializeSeason(thirdSeason))).toEqual(thirdSeason);
  });
});

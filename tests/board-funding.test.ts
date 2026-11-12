import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_PRESIDENTS } from '../src/data/development-presidents';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { boardCapitalGranted, quoteBoardFunding, requiredBoardConfidence, type BoardFundingQuote } from '../src/world/board-funding-policy';
import { enableBoardFunding, requestBoardFunding, startFacilityUpgrade } from '../src/world/facilities';
import { FACILITY_TYPES, getActiveFacilityProject, quoteFacilityUpgrade } from '../src/world/facilities-policy';
import { getFinanceBalance } from '../src/world/finance';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { currentSeasonFile } from './helpers/season-format';

const advance = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
/** The manager upgrades the most expensive affordable facility whenever idle, until an upgrade needs board capital. */
function driveToFundingRequest(clubId: string, seed: number): { state: SeasonState; quote: BoardFundingQuote } {
  let state = createSeason({ seed, managedClubId: clubId, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
  for (let step = 0; step < 40; step += 1) {
    if (!getActiveFacilityProject(state, clubId)) {
      const affordable = FACILITY_TYPES.map(type => quoteFacilityUpgrade(state, type, clubId)).filter(quote => quote.canStart).sort((a, b) => b.cost - a.cost)[0];
      if (affordable) state = startFacilityUpgrade(state, affordable.type);
      const quote = FACILITY_TYPES.map(type => quoteBoardFunding(state, type, clubId)).find(item => item.eligible);
      if (quote) return { state, quote };
    }
    if (state.status === 'active') state = advance(state);
    else {
      state = setEmploymentDelegation(state, true);
      for (let i = 0; i < 80 && getMarketStartReason(state); i += 1) state = advanceMarket(state);
      state = rolloverSeason(state);
    }
  }
  throw new Error('No funding request became possible.');
}
const changed = (state: SeasonState, mutate: (copy: SeasonState) => void) => { const copy = structuredClone(state); mutate(copy); return currentSeasonFile(copy); };
let generous: { state: SeasonState; quote: BoardFundingQuote }, cautious: { state: SeasonState; quote: BoardFundingQuote };

beforeAll(() => {
  generous = driveToFundingRequest('aegean-waves', 227);
  cautious = driveToFundingRequest('alpine-stags', 227);
}, 240_000);

describe('board funding rules', () => {
  it('gives every club a fictional president whose generosity sets the confidence the board needs', () => {
    expect(DEVELOPMENT_PRESIDENTS.map(president => president.clubId).sort()).toEqual(createSeason().clubs.map(club => club.id).sort());
    expect([1, 3, 5].map(generosity => requiredBoardConfidence({ generosity: generosity as 1 | 3 | 5 }))).toEqual([60, 50, 40]);
    for (const president of DEVELOPMENT_PRESIDENTS) expect(president.seasonCapital).toBeGreaterThan(0);
  });

  it('asks only for the missing amount and explains when a request is not possible', () => {
    const { state, quote } = generous;
    expect(quote.amount).toBe(quote.cost - quote.available);
    expect(quote.amount).toBeGreaterThan(0);
    const legacy = createSeason({ seed: 3, managedClubId: 'adriatic-comets', ...NEW_CAREER_SYSTEMS, boardFunding: false });
    expect(quoteBoardFunding(legacy, 'arena').reason).toBe('Enable board funding requests first.');
    expect(quoteBoardFunding(createSeason({ seed: 3, managedClubId: 'adriatic-comets', ...NEW_CAREER_SYSTEMS }), 'youth').reason).toBe('The club can fund this upgrade without board capital.');
    expect(() => enableBoardFunding(createSeason({ seed: 3, finance: true, facilities: true }))).toThrow(/board reviews/);
    expect(quote.capitalRemaining).toBe(DEVELOPMENT_PRESIDENTS.find(item => item.clubId === 'aegean-waves')!.seasonCapital - boardCapitalGranted(state.facilities, 'aegean-waves', state.seasonNumber));
  });
});

describe('board funding in a career', () => {
  it("approves capital when confidence meets the president's threshold and starts the upgrade at once without free money", () => {
    const { state, quote } = generous;
    expect(quote.approved).toBe(true);
    const funded = requestBoardFunding(state, quote.facilityType);
    const [decision, start] = funded.facilities.events.slice(-2);
    expect(decision).toMatchObject({ type: 'funding', clubId: 'aegean-waves', facilityType: quote.facilityType, amount: quote.amount, mode: 'manager', approved: true, confidence: quote.confidence, requiredConfidence: 45 });
    expect(start).toMatchObject({ type: 'start', clubId: 'aegean-waves', facilityType: quote.facilityType });
    const [capital, payment] = funded.finance.ledger.slice(-2);
    expect(capital).toMatchObject({ kind: 'board-capital', amount: quote.amount, boardCapital: { facilityType: quote.facilityType } });
    expect(payment).toMatchObject({ kind: 'facility', amount: -quote.cost });
    expect(getFinanceBalance(funded.finance, 'aegean-waves').cash).toBe(getFinanceBalance(state.finance, 'aegean-waves').cash + quote.amount - quote.cost);
    expect(getActiveFacilityProject(funded, 'aegean-waves')?.type).toBe(quote.facilityType);
    expect(parseSeason(serializeSeason(funded))).toEqual(funded);
  });

  it('records a refusal with its reason and makes the club wait before asking again', () => {
    const { state, quote } = cautious;
    expect(quote.approved).toBe(false);
    expect(quote.refusal).toMatch(/confidence of at least 55/);
    const refused = requestBoardFunding(state, quote.facilityType);
    expect(refused.facilities.events.at(-1)).toMatchObject({ type: 'funding', approved: false, amount: quote.amount });
    expect(refused.finance.ledger).toEqual(state.finance.ledger);
    expect(() => requestBoardFunding(refused, quote.facilityType)).toThrow(/reconsider after 2 more matchdays/);
    expect(parseSeason(serializeSeason(refused))).toEqual(refused);
  });

  it('lets automatic control and rival clubs ask only when the rules approve, within each owner\'s seasonal capital', () => {
    const automatic = generous.state.facilities.events.filter(event => event.type === 'funding' && event.mode === 'automatic');
    expect(automatic.length).toBeGreaterThan(0);
    expect(automatic.every(event => event.type === 'funding' && event.approved && event.confidence >= event.requiredConfidence)).toBe(true);
    for (const president of DEVELOPMENT_PRESIDENTS) for (let season = 1; season <= generous.state.seasonNumber; season += 1) expect(boardCapitalGranted(generous.state.facilities, president.clubId, season)).toBeLessThanOrEqual(president.seasonCapital);
  });

  it.each([
    ['a changed capital amount', (copy: SeasonState) => { const event = copy.facilities.events.find(item => item.type === 'funding' && item.approved)!; (event as { amount: number }).amount += 100; }],
    ['an approval turned into a refusal', (copy: SeasonState) => { const event = copy.facilities.events.find(item => item.type === 'funding' && item.approved)!; (event as { approved: boolean }).approved = false; }],
    ['altered decision evidence', (copy: SeasonState) => { const event = copy.facilities.events.find(item => item.type === 'funding')!; (event as { confidence: number }).confidence += 1; }],
    ['capital without its detail', (copy: SeasonState) => { delete copy.finance.ledger.find(entry => entry.kind === 'board-capital')!.boardCapital; }],
    ['funding enabled without board reviews', (copy: SeasonState) => { copy.board = { model: 'board-1', enabledSince: null, mandates: [], reviews: [] }; }],
  ])('rejects %s', (_label, mutate) => {
    expect(() => parseSeason(changed(generous.state, mutate))).toThrow(/Invalid season save/);
  });
});

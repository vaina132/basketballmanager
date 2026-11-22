import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { getDevelopmentPresident } from '../src/data/development-presidents';
import { boardCapitalGranted, quoteBoardFunding, type BoardFundingQuote } from '../src/world/board-funding-policy';
import { requestBoardFunding } from '../src/world/facilities';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { BoardPanel } from '../src/ui/BoardPanel';
import { FacilityBoardFunding } from '../src/ui/FacilitiesPanel';
import { driveToFundingRequest } from './helpers/board-funding';

const noop = () => {};
const board = (season: SeasonState) => renderToStaticMarkup(<BoardPanel season={season} onEnable={noop} onEnableFunding={noop} onEnableConsequences={noop} onEnableRivalries={noop} onEnableCareerMoves={noop} />);
const ask = (quote: BoardFundingQuote, enabled = true) => renderToStaticMarkup(<FacilityBoardFunding quote={quote} enabled={enabled} busy={false} onRequest={noop} />);
const money = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100);
let generous: { state: SeasonState; quote: BoardFundingQuote }, cautious: { state: SeasonState; quote: BoardFundingQuote };
let funded: SeasonState, refused: SeasonState;

beforeAll(() => {
  // Seed 2 (4 before the match flow, real coaches and European entry of formats 81-83, 227 before the relationships-2
  // rules of format 66): Aegean Waves' board approves at the start of season 2, after automatic requests.
  generous = driveToFundingRequest('aegean-waves', 2);
  cautious = driveToFundingRequest('alpine-stags', 227);
  funded = requestBoardFunding(generous.state, generous.quote.facilityType);
  refused = requestBoardFunding(cautious.state, cautious.quote.facilityType);
}, 240_000);

describe('board panel: president and capital', () => {
  it('introduces the president, the capital left this season and the confidence the board needs', () => {
    const html = board(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'off', ...NEW_CAREER_SYSTEMS, simpleFacilities: false }));
    expect(html).toContain('data-board-president="rhine-falcons"');
    expect(html).toContain('Helena Varga');
    expect(html).toContain('Club president · Measured investor');
    expect(html).toContain('data-board-capital-left="20000000"');
    expect(html).toContain('€200,000');
    expect(html).toContain('data-board-required="50"');
    expect(html).toContain('Met · current confidence 50');
    expect(html).toContain('No capital requests yet.');
    expect(html).not.toContain('id="enable-board-funding"');
    expect(html).toContain('decides capital requests');
    expect(html).toContain('Capital requests: the board funds only the part of a facility upgrade the club cannot pay');
  });

  it('offers prospective activation to older careers and explains when facilities must come first', () => {
    const legacy = board(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'off', ...NEW_CAREER_SYSTEMS, simpleFacilities: false, boardFunding: false }));
    expect(legacy).toMatch(/id="enable-board-funding"[^>]*>Enable funding requests/);
    expect(legacy).not.toMatch(/id="enable-board-funding"[^>]*disabled/);
    expect(legacy).toContain('Rival clubs can ask their boards under the same rules once this is on.');
    expect(legacy).not.toContain('decides capital requests');
    const noFacilities = board(createSeason({ seed: 227, managedClubId: 'rhine-falcons', finance: true, board: true }));
    expect(noFacilities).toContain('Enable club facilities first, on the Club page.');
    expect(noFacilities).toMatch(/id="enable-board-funding"[^>]*disabled/);
  });

  it('records approvals and refusals with the reason the board gave', () => {
    const approved = board(funded);
    const president = getDevelopmentPresident('aegean-waves');
    expect(approved).toContain('data-board-funding-request="approved"');
    expect(approved).toContain(`data-board-capital-left="${president.seasonCapital - boardCapitalGranted(funded.facilities, 'aegean-waves', funded.seasonNumber)}"`);
    expect(boardCapitalGranted(funded.facilities, 'aegean-waves', funded.seasonNumber)).toBeGreaterThanOrEqual(generous.quote.amount);
    const declined = board(refused);
    expect(declined).toContain('data-board-funding-request="refused"');
    expect(declined).toContain(`The board needs confidence of at least 60; it is ${cautious.quote.confidence}.`);
    expect(declined).toContain('Not met · current confidence');
  });
});

describe('facility review: asking the board', () => {
  it('shows the amount, the confidence needed and the expected answer before the manager asks', () => {
    const html = ask(generous.quote);
    expect(html).toContain('data-board-funding="approve"');
    expect(html).toContain(`data-board-amount="${generous.quote.amount}"`);
    expect(html).toContain(`${money(generous.quote.cost)} cost − ${money(generous.quote.available)} available`);
    expect(html).toContain('Nikos Thalassinos needs 40');
    expect(html).toContain('On these figures the board approves.');
    expect(html).toMatch(new RegExp(`id="facility-board-request"[^>]*>.*Ask for ${money(generous.quote.amount)}`));
    expect(html).not.toMatch(/id="facility-board-request"[^>]*disabled/);
  });

  it('warns that a refusal is expected and what it costs, then blocks a repeat request during the wait', () => {
    const html = ask(cautious.quote);
    expect(html).toContain('data-board-funding="refuse"');
    expect(html).toContain('The board needs confidence of at least 60');
    expect(html).toContain('you can ask again after 3 matchdays');
    const waiting = ask(quoteBoardFunding(refused, cautious.quote.facilityType));
    expect(waiting).toContain('data-board-funding="unavailable"');
    expect(waiting).toContain('The board will reconsider after 3 more matchdays.');
    expect(waiting).toMatch(/id="facility-board-request"[^>]*disabled/);
  });

  it('points older careers to the Board view when requests are off', () => {
    const html = ask(generous.quote, false);
    expect(html).toContain('data-board-funding="off"');
    expect(html).toContain('Board funding requests are off in this career. You can switch them on from the Board page.');
    expect(html).not.toContain('id="facility-board-request"');
  });
});

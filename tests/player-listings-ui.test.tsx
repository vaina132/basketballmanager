import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { worldFromPack } from '../src/world/real-world';
import { scheduleListingBids, setPlayerListing } from '../src/world/listings';
import { InboxWorkspace } from '../src/ui/InboxWorkspace';
import { PlayerListingControl } from '../src/ui/PlayerListingControl';
import { TransfersWorkspace } from '../src/ui/TransfersWorkspace';
import { advanceMatchday } from './helpers/board-funding';
import { economyPack } from './helpers/economy-pack';

/** Owner feedback (22 November 2026): listing on the profile, bids answered in the Inbox, one-click Scout in Transfers. */
const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 8] }], null, 13);
const clubId = 'bbl-1';
const noop = () => {};
let week: SeasonState;
beforeAll(() => { week = advanceMatchday(createSeason({ seed: 7, world: worldFromPack(pack, 'bbl'), managedClubId: clubId, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS })); }, 120_000);

describe('listing and bids on screen', () => {
  it('offers Transfer list and Loan list on the player profile, with a suggested price', () => {
    const player = week.clubs.find(club => club.id === clubId)!.players[6]!;
    const listed = setPlayerListing(week, player.id, { transfer: true, loan: false });
    const html = renderToStaticMarkup(<PlayerListingControl season={listed} playerId={player.id} busy={false} onListing={noop} />);
    expect(html).toMatch(/data-listing-transfer="[^"]+"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-listing-transfer/);
    expect(html).toContain('Suggested');
    expect(html).toContain('Loan list');
  });

  it('shows a bid in the Inbox reading pane with Accept and Decline', () => {
    const player = week.clubs.find(club => club.id === clubId)!.players[6]!;
    const listed = setPlayerListing(week, player.id, { transfer: true, loan: false });
    const state = Array.from({ length: 60 }, (_, index) => ({ ...scheduleListingBids({ ...listed, seed: 2000 + index }), seed: listed.seed })).find(item => item.recruitment.offers.some(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === clubId))!;
    const bid = state.recruitment.offers.find(offer => offer.status === 'club-review' && offer.transfer?.sellerClubId === clubId)!;
    const html = renderToStaticMarkup(<InboxWorkspace season={state} onAnswerPress={noop} onOpen={noop} onBidDecision={noop} initialSelectedId={`bid-${bid.id}`} />);
    expect(html).toContain(`data-bid-accept="${bid.id}"`);
    expect(html).toContain(`data-bid-decline="${bid.id}"`);
  });

  it('puts a Scout button on each player and explains the scouting network in Transfers', () => {
    const html = renderToStaticMarkup(<TransfersWorkspace season={week} disabled={false} onEnable={noop} onEnableNegotiations={noop} onEnableInSeasonTransfers={noop} onInSeasonTransferOffer={noop} onInSeasonClubDecision={noop} onEnableInSeason={noop} onInSeasonOffer={noop} onWithdrawInSeasonOffer={noop} onOpenMatch={noop} onOpenAcademy={noop} onEnableMarket={noop} onWithdrawOffer={noop} onDelegation={noop} onOffer={noop} onClubDecision={noop} focusedPlayerId={null} onClearFocusedPlayer={noop} onOpenScouting={noop} onShortlist={noop} onOpenContracts={noop} onOpenScoutingPage={noop} onScout={noop} onOpenScouts={noop} onListing={noop} scouting={<p>scouting tab</p>} onTabChange={noop} />);
    expect(html).toContain('data-transfer-scout=');
    expect(html).toMatch(/data-scout-network-range="\d"/);
    expect(html).toContain('id="transfers-tab-scouting"');
    expect(html).toContain('Your transfer and loan list');
  });
});

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { nbaPack } from './helpers/nba-pack';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, dateForRound, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { clubContractsForRound } from '../src/world/employment-policy';
import { proposeTrade, quoteTradeProposal } from '../src/world/trades';
import { TradeBuilder } from '../src/ui/TradeBuilder';
import { getInboxItems } from '../src/ui/inbox-items';
import { setDisplayCurrency } from '../src/ui/money-format';

/** NBA step 9 (format 95): Transfers > Trades and the trade offers in the Inbox. */
const noop = () => undefined;
const world = worldFromPack(nbaPack(), 'nba');
const state = createSeason({ seed: 21, world, managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
const ids = (clubId: string) => clubContractsForRound(state.employment, 1, 1, clubId).map(contract => contract.playerId);

describe('Transfers > Trades', () => {
  it('shows both squads, the trade deadline and one Send offer action', () => {
    const html = renderToStaticMarkup(<TradeBuilder season={state} disabled={false} onPropose={noop} onWithdraw={noop} />);
    expect(html).toContain('data-trade-builder');
    expect(html).toContain('Trade deadline 2027-02-04');
    expect(html).toContain('Boston Celtics sends');
    expect(html).toContain('Trade with');
    for (const id of ids('nba-bos')) expect(html).toContain(`data-trade-player="${id}"`);
    expect(html).toContain('Send offer');
    expect(html).toContain('Choose one to 3 players on each side.');
  });

  it('lists the waiting offer with Withdraw, and the Inbox names the answer day', () => {
    const toClubId = 'nba-atl';
    const send = ids('nba-bos').find(id => ids(toClubId).some(other => !quoteTradeProposal(state, toClubId, [id], [other]).reason))!;
    const receive = ids(toClubId).find(other => !quoteTradeProposal(state, toClubId, [send], [other]).reason)!;
    const offered = proposeTrade(state, toClubId, [send], [receive]);
    const html = renderToStaticMarkup(<TradeBuilder season={offered} disabled={false} onPropose={noop} onWithdraw={noop} />);
    expect(html).toContain('data-trade-proposal="pending"');
    expect(html).toContain(`Waiting for an answer (answer on ${dateForRound(2, 1)})`);
    expect(html).toContain('Withdraw');
    const item = getInboxItems(offered).find(entry => entry.id === 'trade-proposal-1')!;
    expect(item).toMatchObject({ title: 'Trade offer sent · Atlanta Hawks', target: 'trades', needsAction: false });
    expect(item.detail).toContain(`answers on ${dateForRound(2, 1)}`);
  });

  it('shows salaries in the chosen currency', () => {
    setDisplayCurrency('USD');
    try { expect(renderToStaticMarkup(<TradeBuilder season={state} disabled={false} onPropose={noop} onWithdraw={noop} />)).toContain('$'); }
    finally { setDisplayCurrency('EUR'); }
  });
});

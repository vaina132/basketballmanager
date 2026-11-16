import { beforeAll, describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setShortlisted } from '../src/world/scouting';
import { BoardWorkspace } from '../src/ui/BoardPanel';
import { MainNavigation, mainNavigation, PAGE_NAMES, unemployedNavigation, type Page } from '../src/ui/navigation';
import { SquadContracts } from '../src/ui/SquadContracts';
import { TransfersWorkspace } from '../src/ui/TransfersWorkspace';
import { DEFAULT_TRANSFER_FILTERS, filterTransferRows, getTransferSearch, sortTransferRows, type TransferSearchFilters } from '../src/ui/transfer-search';

/**
 * Owner, 16 November 2026: the Board gets its own menu item, the left menu is short and ordered by use, Transfers opens
 * on a player search, and the own squad's contracts live on Squad > Contracts.
 */
const noop = () => {};
const club = 'rhine-falcons';
const ownIds = (season: SeasonState) => season.clubs.find(team => team.id === club)!.players.map(player => player.id);
const filtersOf = (change: Partial<TransferSearchFilters>): TransferSearchFilters => ({ ...DEFAULT_TRANSFER_FILTERS, ...change });
const transfers = (season: SeasonState) => renderToStaticMarkup(<TransfersWorkspace season={season} disabled={false} onEnable={noop} onEnableNegotiations={noop} onEnableInSeasonTransfers={noop} onInSeasonTransferOffer={noop} onInSeasonClubDecision={noop} onEnableInSeason={noop} onInSeasonOffer={noop} onWithdrawInSeasonOffer={noop} onOpenMatch={noop} onOpenAcademy={noop} onEnableMarket={noop} onAdvanceMarket={noop} onWithdrawOffer={noop} onDelegation={noop} onOffer={noop} onClubDecision={noop} onStartSeason={noop} focusedPlayerId={null} onClearFocusedPlayer={noop} onOpenScouting={noop} onShortlist={noop} onOpenContracts={noop} onOpenScoutingPage={noop} />);
const contracts = (season: SeasonState) => renderToStaticMarkup(<SquadContracts season={season} disabled={false} onEnable={noop} onDelegation={noop} onOffer={noop} onWithdrawOffer={noop} onBuyout={noop} onContractReply={noop} onOpenScouting={noop} onShortlist={noop} onOpenTransfers={noop} focusedPlayerId={null} onClearFocusedPlayer={noop} />);
const searchPlayers = (html: string) => [...html.matchAll(/data-search-player="([^"]+)"/g)].map(match => match[1]);

/** The rendered menu's buttons, found in the element tree so their click handlers can be called without a browser. */
function buttons(node: ReactNode): ReactElement<{ 'data-nav': Page; onClick: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: ReactNode; 'data-nav'?: Page }>(node)) return [];
  return node.props['data-nav'] ? [node as ReactElement<{ 'data-nav': Page; onClick: () => void }>] : buttons(node.props.children);
}

let opening: SeasonState, offseason: SeasonState;
beforeAll(() => {
  opening = createSeason({ seed: 7, managedClubId: club, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
  let state = createSeason(53, club, 'off', true, true, true, true, null, true, true, true, true);
  while (state.status === 'active') state = advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
  offseason = state;
}, 120_000);

describe('the left menu', () => {
  it('is ordered by use in small groups, with Board as its own item and every page reachable', () => {
    const groups = mainNavigation({ career: true, europe: true });
    expect(groups.map(group => group.map(item => item.id))).toEqual([
      ['home', 'inbox'], ['squad', 'match', 'transfers', 'scouting', 'training', 'staff'], ['club', 'board'], ['season', 'calendar', 'europe'], ['academy', 'medical'],
    ]);
    expect(groups.flat().find(item => item.id === 'board')).toMatchObject({ label: 'Board', icon: 'shield' });
    // Nothing that exists is hidden: every page has its menu item.
    expect(groups.flat().map(item => item.id).sort()).toEqual((Object.keys(PAGE_NAMES) as Page[]).sort());
    expect(mainNavigation({ career: true, europe: false }).flat().some(item => item.id === 'europe')).toBe(false);
    expect(mainNavigation({ career: false, europe: false }).flat().map(item => item.id)).toEqual(['home', 'squad', 'match', 'season']);
    expect(unemployedNavigation({ europe: false }).flat().map(item => item.id)).toEqual(['home', 'inbox', 'season', 'calendar']);
  });

  it('opens the Board page from its Board button', () => {
    const groups = mainNavigation({ career: true, europe: false });
    const html = renderToStaticMarkup(<MainNavigation groups={groups} current="board" disabled={false} onNavigate={noop} />);
    expect(html).toMatch(/<button[^>]*data-nav="board"[^>]*aria-label="Board"[^>]*aria-current="page"/);
    expect(html.match(/class="nav-divider"/g)).toHaveLength(groups.length - 1);
    const opened: Page[] = [];
    const board = buttons(MainNavigation({ groups, current: 'home', disabled: false, onNavigate: page => opened.push(page) })).find(button => button.props['data-nav'] === 'board')!;
    board.props.onClick();
    expect(opened).toEqual(['board']);
    expect(PAGE_NAMES.board).toBe('Board');
  });

  it('shows the board, the president and the media standing on the Board page', () => {
    const html = renderToStaticMarkup(<BoardWorkspace season={opening} onEnable={noop} onEnableFunding={noop} onEnableConsequences={noop} onEnableRivalries={noop} onEnableCareerMoves={noop} />);
    expect(html).toContain('aria-labelledby="board-title"');
    expect(html).toContain('id="media-standing-title"');
  });
});

describe('Transfers', () => {
  it('opens on a player search with filters and the shortlist, without the own squad', () => {
    const shortlisted = getTransferSearch(opening).rows[0]!.player.id;
    const html = transfers(setShortlisted(opening, shortlisted, true));
    expect(html).toContain('id="transfer-search-title"');
    for (const id of ['name', 'position', 'min-age', 'max-age', 'stars', 'wage', 'fee', 'contract', 'league', 'free', 'sort']) expect(html).toContain(`id="transfer-search-${id}"`);
    expect(html).toContain('id="transfer-shortlist-title"');
    expect(html).toContain(`data-shortlist-player="${shortlisted}"`);
    const listed = searchPlayers(html);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.some(id => ownIds(opening).includes(id))).toBe(false);
    // Each row leads to the existing offer flow; the own squad's contracts are one link away on Squad > Contracts.
    expect(html).toMatch(/data-transfer-action="[^"]+"[^>]*>Offer transfer/);
    expect(html).toContain('id="transfers-open-contracts"');
    expect(html).not.toContain('data-contract-player=');
    expect(html).not.toContain('Current squad contracts');
  });

  it('lists only players the scouts know and filters and sorts them', () => {
    const search = getTransferSearch(opening);
    expect(search.phase).toBe('season');
    expect(search.scouted).toBe(true);
    expect(search.rows.length).toBeLessThan(search.marketCount);
    const rows = search.rows;
    const centres = filterTransferRows(rows, filtersOf({ position: 'C' }));
    expect(centres.length).toBeGreaterThan(0);
    expect(centres.every(row => row.player.position === 'C')).toBe(true);
    const young = filterTransferRows(rows, filtersOf({ minAge: 20, maxAge: 25 }));
    expect(young.length).toBeGreaterThan(0);
    expect(young.every(row => row.age !== null && row.age >= 20 && row.age <= 25)).toBe(true);
    const cheapest = Math.min(...rows.map(row => row.wage));
    expect(filterTransferRows(rows, filtersOf({ maxWage: cheapest })).every(row => row.wage === cheapest)).toBe(true);
    expect(filterTransferRows(rows, filtersOf({ query: rows[0]!.player.name.slice(0, 5).toUpperCase() })).some(row => row.player.id === rows[0]!.player.id)).toBe(true);
    // In-season, every known player is under contract elsewhere: free agents only leaves none; unscouted ratings stay unknown.
    expect(filterTransferRows(rows, filtersOf({ freeOnly: true }))).toEqual([]);
    expect(filterTransferRows(rows, filtersOf({ minStars: 3 }))).toEqual([]);
    const byAge = sortTransferRows(rows, 'age').map(row => row.age!);
    expect(byAge).toEqual([...byAge].sort((left, right) => left - right));
    const byFee = sortTransferRows(rows, 'fee').map(row => row.fee!);
    expect(byFee).toEqual([...byFee].sort((left, right) => left - right));
  });

  it('leaves the own unrenewed players to Squad > Contracts in the offseason', () => {
    const search = getTransferSearch(offseason);
    expect(search.phase).toBe('offseason');
    expect(search.rows.length).toBeGreaterThan(0);
    expect(search.rows.every(row => row.fee === null && row.kind === 'offseason-free')).toBe(true);
    expect(search.rows.some(row => ownIds(offseason).includes(row.player.id))).toBe(false);
    expect(filterTransferRows(search.rows, filtersOf({ freeOnly: true }))).toHaveLength(search.rows.length);
    const html = contracts(offseason);
    expect(html).toContain('id="squad-contracts-heading"');
    for (const id of ownIds(offseason)) expect(html).toContain(`data-contract-player="${id}"`);
    expect(html).toMatch(/aria-label="Renew [^"]+"/);
  });
});

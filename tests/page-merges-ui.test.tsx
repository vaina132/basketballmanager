import { beforeAll, describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { CLUB_VIEWS, competitionsViews, MERGED_PAGES, PageViewTabs, resolveNavigation, SQUAD_VIEWS, TRAINING_VIEWS, type Page } from '../src/ui/navigation';
import { AcademyWorkspace } from '../src/ui/AcademyWorkspace';
import { BoardWorkspace } from '../src/ui/BoardPanel';
import { PayrollWorkspace } from '../src/ui/PayrollWorkspace';
import { SeasonCalendar } from '../src/ui/SeasonCalendar';
import { StaffWorkspace } from '../src/ui/StaffWorkspace';

/**
 * Owner decisions (22 November 2026): Calendar and Europe are tabs of Competitions, Academy a tab of Training, Board a
 * tab of Club, the wage list sits inside Squad > Contracts, Staff keeps one list of current staff.
 */
const noop = () => {};
let opening: SeasonState;
beforeAll(() => { opening = createSeason({ seed: 7, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS }); }, 120_000);

/** The tab buttons in the element tree, so their click handlers can be called without a browser. */
function tabButtons(node: ReactNode): ReactElement<{ 'data-page-view': string; 'aria-pressed': boolean; onClick: () => void }>[] {
  if (Array.isArray(node)) return node.flatMap(tabButtons);
  if (!isValidElement<{ children?: ReactNode; 'data-page-view'?: string }>(node)) return [];
  return node.props['data-page-view'] ? [node as ReactElement<{ 'data-page-view': string; 'aria-pressed': boolean; onClick: () => void }>] : tabButtons(node.props.children);
}

describe('old links land on the new tabs', () => {
  it('opens each merged page as a tab of the page that holds it', () => {
    const landing = (target: Page) => { const { page, view } = resolveNavigation(target); return [page, view?.view ?? null]; };
    // Inbox "Open board", the Desk's board notice and the Continue stop for a president request all open 'board'.
    expect(landing('board')).toEqual(['club', 'board']);
    // Transfers and Staff "Open academy" links open 'academy'.
    expect(landing('academy')).toEqual(['training', 'academy']);
    // The unemployed desk's "Calendar" link.
    expect(landing('calendar')).toEqual(['season', 'calendar']);
    expect(landing('europe')).toEqual(['season', 'europe']);
    expect(landing('medical')).toEqual(['squad', 'medical']);
  });

  it('opens a page from its menu item or a plain link on its first tab, so Club links reach facilities and the bank', () => {
    expect(resolveNavigation('club')).toEqual({ page: 'club', view: { page: 'club', view: 'club' } });
    expect(resolveNavigation('training')).toEqual({ page: 'training', view: { page: 'training', view: 'plan' } });
    expect(resolveNavigation('season')).toEqual({ page: 'season', view: { page: 'season', view: 'league' } });
    // Squad keeps the view it was left on (Contracts and profile links set their own view).
    expect(resolveNavigation('squad')).toEqual({ page: 'squad', view: null });
    expect(resolveNavigation('transfers')).toEqual({ page: 'transfers', view: null });
  });

  it('lists every merged page among its new page\'s tabs', () => {
    const tabs: Record<string, readonly { id: string }[]> = { squad: SQUAD_VIEWS, season: competitionsViews(true), training: TRAINING_VIEWS, club: CLUB_VIEWS };
    for (const merged of Object.values(MERGED_PAGES)) expect(tabs[merged!.page]!.map(tab => tab.id)).toContain(merged!.view);
    expect(competitionsViews(true).map(tab => tab.label)).toEqual(['League', 'Calendar', 'Europe']);
    expect(competitionsViews(false).map(tab => tab.id)).toEqual(['league', 'calendar']);
    expect(TRAINING_VIEWS.map(tab => tab.label)).toEqual(['Training', 'Academy']);
    expect(CLUB_VIEWS.map(tab => tab.label)).toEqual(['Facilities & money', 'Board']);
    // Wages are no longer their own Squad view: the wage list is inside Contracts.
    expect(SQUAD_VIEWS.map(tab => tab.label)).toEqual(['Selection', 'Statistics', 'Dynamics', 'Contracts', 'Medical']);
  });
});

describe('the tab bar', () => {
  it('is a labelled group of keyboard buttons that shows the open tab and switches tabs', () => {
    const html = renderToStaticMarkup(<PageViewTabs label="Club view" idPrefix="club-view" views={CLUB_VIEWS} current="board" onChange={noop} />);
    expect(html).toContain('role="group" aria-label="Club view"');
    expect(html).toMatch(/<button id="club-view-board" data-page-view="board" aria-pressed="true" class="selected"/);
    expect(html).toMatch(/<button id="club-view-club" data-page-view="club" aria-pressed="false"/);
    const opened: string[] = [];
    const buttons = tabButtons(PageViewTabs({ label: 'Training view', idPrefix: 'training-view', views: TRAINING_VIEWS, current: 'plan', onChange: view => opened.push(view) }));
    expect(buttons.map(button => button.props['data-page-view'])).toEqual(['plan', 'academy']);
    buttons[1]!.props.onClick();
    expect(opened).toEqual(['academy']);
  });
});

describe('the merged pages keep their controls in their new tabs', () => {
  it('Club > Board: board, president and media standing', () => {
    const html = renderToStaticMarkup(<BoardWorkspace season={opening} onEnable={noop} onEnableFunding={noop} onEnableConsequences={noop} onEnableRivalries={noop} onEnableCareerMoves={noop} />);
    expect(html).toContain('aria-labelledby="board-title"');
    expect(html).toContain('id="media-standing-title"');
  });

  it('Training > Academy: prospects and youth controls', () => {
    const html = renderToStaticMarkup(<AcademyWorkspace season={opening} onEnableAcademy={noop} onEnableYouthCompetition={noop} onAcademyFocus={noop} onPromoteAcademy={noop} onWithdrawPromotion={noop} onOpenYouthCoach={noop} onOpenPlayer={noop} />);
    expect(html).toMatch(/academy/i);
    expect(html).toMatch(/<button|<select/);
  });

  it('Competitions > Calendar: every week of the season', () => {
    const html = renderToStaticMarkup(<SeasonCalendar season={opening} />);
    expect(html).toMatch(/Week 1\b|week 1\b/);
  });

  it('Squad > Contracts: the wage list with each player\'s salary', () => {
    const html = renderToStaticMarkup(<PayrollWorkspace season={opening} onEnable={noop} onOpenClub={noop} onSelectPlayer={noop} />);
    expect(html).toContain('id="payroll-heading"');
    expect(html).toMatch(/data-payroll-player="|id="payroll-enable-title"/);
  });

  it('Staff: one list; each current person has the contract end, Replace and Release, and vacancies lead to candidates', () => {
    const html = renderToStaticMarkup(<StaffWorkspace season={opening} role="coaches" onRoleChange={noop} onEnable={noop} onHire={noop} onRelease={noop} onAssignment={noop} onRenewal={noop} onOpenTraining={noop} onHireScout={noop} onHireFitness={noop} onHirePhysio={noop} onHireAssistant={noop} onHireYouthCoach={noop} />);
    expect(html).not.toContain('Current staff');
    expect(html).not.toContain('staff-overview');
    const cards = html.match(/data-release-coach="/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    expect(html.match(/data-replace-staff="/g)).toHaveLength(cards.length);
    expect(html.match(/data-contract-until="/g)).toHaveLength(cards.length);
    expect(html).toMatch(/data-coach-renewal="|data-coach-assignment="/);
  });
});

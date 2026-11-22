import { beforeAll, describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { CLUB_VIEWS, competitionsViews, europeLinkView, MERGED_PAGES, PageViewTabs, resolveNavigation, shownCompetitionsView, SQUAD_VIEWS, TRAINING_VIEWS, type Page } from '../src/ui/navigation';
import { AcademyWorkspace } from '../src/ui/AcademyWorkspace';
import { BoardWorkspace } from '../src/ui/BoardPanel';
import { PayrollWorkspace } from '../src/ui/PayrollWorkspace';
import { SeasonCalendar } from '../src/ui/SeasonCalendar';
import { StaffWorkspace } from '../src/ui/StaffWorkspace';
import app from '../src/App.tsx?raw';

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
    // Europe became International (the club's European competitions) on 22 November 2026, evening.
    expect(landing('europe')).toEqual(['season', 'international']);
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
    const all = { league: true, international: true, leagues: true, national: true };
    const tabs: Record<string, readonly { id: string }[]> = { squad: SQUAD_VIEWS, season: competitionsViews(all), training: TRAINING_VIEWS, club: CLUB_VIEWS };
    for (const merged of Object.values(MERGED_PAGES)) expect(tabs[merged!.page]!.map(tab => tab.id)).toContain(merged!.view);
    // Owner, 22 November 2026, evening: Calendar, League, International, European Leagues, National Teams.
    expect(competitionsViews(all).map(tab => tab.label)).toEqual(['Calendar', 'League', 'International', 'European Leagues', 'National Teams']);
    expect(competitionsViews({ league: true, international: false, leagues: false, national: false }).map(tab => tab.id)).toEqual(['calendar', 'league']);
    expect(TRAINING_VIEWS.map(tab => tab.label)).toEqual(['Training', 'Academy']);
    expect(CLUB_VIEWS.map(tab => tab.label)).toEqual(['Facilities & money', 'Board']);
    // Wages are no longer their own Squad view: the wage list is inside Contracts.
    expect(SQUAD_VIEWS.map(tab => tab.label)).toEqual(['Selection', 'Statistics', 'Dynamics', 'Contracts', 'Medical']);
  });
});

describe('Competitions tabs (owner, 22 November 2026, evening)', () => {
  const tabs = (flags: Partial<Parameters<typeof competitionsViews>[0]>) => competitionsViews({ league: false, international: false, leagues: false, national: false, ...flags });

  it('shows only tabs with something to show; no NBA tab yet', () => {
    // An unemployed manager has no league of his own: Calendar, International (every competition), European Leagues.
    expect(tabs({ international: true, leagues: true }).map(tab => tab.id)).toEqual(['calendar', 'international', 'leagues']);
    expect(tabs({ league: true, national: true }).map(tab => tab.label)).toEqual(['Calendar', 'League', 'National Teams']);
    expect(competitionsViews({ league: true, international: true, leagues: true, national: true }).some(tab => /NBA/.test(tab.label))).toBe(false);
  });

  it('falls back to a tab that exists, and old Europe links open International or European Leagues', () => {
    expect(shownCompetitionsView('league', tabs({ international: true, leagues: true }))).toBe('leagues');
    expect(shownCompetitionsView('international', tabs({ league: true, leagues: true }))).toBe('leagues');
    expect(shownCompetitionsView('international', tabs({ league: true }))).toBe('league');
    expect(shownCompetitionsView('national', tabs({ league: true }))).toBe('league');
    expect(shownCompetitionsView('calendar', tabs({}))).toBe('calendar');
    expect(europeLinkView(true)).toBe('international');
    expect(europeLinkView(false)).toBe('leagues');
  });

  it('App shows each tab\'s workspace and keeps the chosen competition and league', () => {
    expect(app).toContain("shownCompetitions === 'international' && season && <InternationalWorkspace season={season} competitionId={internationalCompetition} onCompetitionChange={setInternationalCompetition} />");
    expect(app).toContain("shownCompetitions === 'leagues' && season && <EuropeanLeaguesWorkspace season={season} leagueId={europeanLeague} onLeagueChange={setEuropeanLeague}");
    expect(app).toContain("else if (target === 'europe') {");
    expect(app).not.toContain('EuropeWorkspace season');
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
    // Only the training-coach role is shown; the other roles' handlers are not called while rendering.
    const props = { season: opening, role: 'coaches', onRoleChange: noop, onEnable: noop, onHire: noop, onRelease: noop, onAssignment: noop, onRenewal: noop, onOpenTraining: noop, onHireScout: noop, onHireFitness: noop, onHirePhysio: noop, onHireAssistant: noop, onHireYouthCoach: noop } as unknown as Parameters<typeof StaffWorkspace>[0];
    const html = renderToStaticMarkup(<StaffWorkspace {...props} />);
    expect(html).not.toContain('Current staff');
    expect(html).not.toContain('staff-overview');
    const cards = html.match(/data-release-coach="/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    expect(html.match(/data-replace-staff="/g)).toHaveLength(cards.length);
    expect(html.match(/data-contract-until="/g)).toHaveLength(cards.length);
    expect(html).toMatch(/data-coach-renewal="|data-coach-assignment="/);
  });
});

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { acceptNationalOffer, offerNationalJob } from '../src/world/national';
import { NationalTeamPage, NationalJobCard } from '../src/ui/NationalTeamPage';
import { NationalWorkspace } from '../src/ui/NationalWorkspace';
import { InboxWorkspace } from '../src/ui/InboxWorkspace';
import { competitionsViews, NATIONAL_TEAMS_LINK, resolveNavigation, shownCompetitionsView, unemployedNavigation } from '../src/ui/navigation';
import app from '../src/App.tsx?raw';
import { CareerStart } from '../src/ui/CareerStart';
import { nationalWorld } from './helpers/national-world';

const world = nationalWorld();
const noop = () => {};

describe('national team screens (format 80)', () => {
  const start = createSeason({ seed: 3, world, managedClubId: world.clubs[0]!.id, ...NEW_CAREER_SYSTEMS });
  const offered = offerNationalJob(start, 'nation-tur');
  const hired = acceptNationalOffer(offered, offered.national!.offers.at(-1)!.id);

  it('shows the groups and games in Competitions > National teams', () => {
    const html = renderToStaticMarkup(<NationalWorkspace season={start} />);
    expect(html).toContain('World Cup 2027 European Qualifiers');
    expect(html).toContain('Group J');
    expect(html).toContain('Next games: 26 Nov 2026 and 28 Nov 2026.');
    expect((html.match(/data-national-fixture=/g) ?? []).length).toBe(48);
  });

  it('offers the job with Accept and Decline in the Inbox', () => {
    const html = renderToStaticMarkup(<InboxWorkspace season={offered} onAnswerPress={noop} onOpen={noop} onNationalOffer={noop} initialSelectedId={offered.national!.offers.at(-1)!.id} />);
    expect(html).toContain('Job offer · Turkey national team');
    expect(html).toContain('data-national-accept');
  });

  it('shows the national team page and the unemployed desk card with the job', () => {
    const html = renderToStaticMarkup(<NationalTeamPage season={hired} busy={false} onSelect={noop} onResign={noop} onOpenCompetitions={noop} />);
    expect(html).toContain('data-national-page="nation-tur"');
    expect((html.match(/data-national-player=/g) ?? []).length).toBe(12);
    expect(html).toContain('Resign');
    expect(html).toContain('Career earnings');
    expect(renderToStaticMarkup(<NationalJobCard season={hired} onOpen={noop} />)).toContain('You still coach');
  });

  it('gives a manager without a club the Match center while his national game is open', () => {
    expect(unemployedNavigation(true, true).flat().map(item => item.id)).toEqual(['home', 'inbox', 'match', 'season', 'national']);
    expect(unemployedNavigation(true).flat().map(item => item.id)).toEqual(['home', 'inbox', 'season', 'national']);
  });

  it('shows career earnings on the Manager profile', () => {
    const career = { managerName: 'Test Coach', clubName: 'Test club', date: '2026-11-07', earnings: { total: 6_666_666, payments: [{ date: '2026-11-01', source: 'Turkey', amount: 3_333_333 }, { date: '2026-10-01', source: 'Turkey', amount: 3_333_333 }] } };
    const html = renderToStaticMarkup(<CareerStart view="profile" busy={false} error={null} hasSession currentCareer={career} savedCareer={null} savesLoading={false} onContinue={noop} onResume={noop} onNewCareer={noop} onLoad={noop} onImport={noop} onExhibition={noop} onCancel={noop} onStart={noop} onSaveProfile={noop} pack={null} onPackLoaded={noop} />);
    expect(html).toContain('Career earnings');
    expect(html).toContain('data-career-earnings="6666666"');
    expect(html).toContain('Turkey');
  });

  it('opens Competitions > National Teams from every national-team link (navigating used to reset the tab to League)', () => {
    // The link names the tab, and navigating sets it after the page's first tab, so it is not reset.
    expect(resolveNavigation(NATIONAL_TEAMS_LINK)).toEqual({ page: 'season', view: { page: 'season', view: 'national' } });
    expect(app).toContain("const { page: nextPage, view } = resolveNavigation(target)");
    expect(app).toContain("else if (view?.page === 'season') setCompetitionsView(view.view)");
    // A career with national teams has the tab, so it is the one shown (employed or not).
    expect(start.national).toBeDefined();
    for (const league of [true, false]) expect(shownCompetitionsView(resolveNavigation(NATIONAL_TEAMS_LINK).view!.view as 'national', competitionsViews({ league, international: true, leagues: true, national: !!start.national }))).toBe('national');
    // The three links: "National team" (Inbox, menu) without a national job, and the national team page's link in the
    // unemployed and employed layouts. None sets the tab before navigating any more.
    expect(app).toContain("if (current.kind === 'season' && current.season.national?.job) navigate('national')\n    else navigate(NATIONAL_TEAMS_LINK)");
    expect(app.match(/onOpenCompetitions=\{\(\) => navigate\(NATIONAL_TEAMS_LINK\)\}/g)).toHaveLength(2);
    expect(app.match(/navigate\(NATIONAL_TEAMS_LINK\)/g)).toHaveLength(3);
    expect(app).not.toContain("setCompetitionsView('national')");
  });
});

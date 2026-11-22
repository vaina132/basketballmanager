import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { acceptNationalOffer, offerNationalJob } from '../src/world/national';
import { NationalTeamPage, NationalJobCard } from '../src/ui/NationalTeamPage';
import { NationalWorkspace } from '../src/ui/NationalWorkspace';
import { InboxWorkspace } from '../src/ui/InboxWorkspace';
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
    expect(renderToStaticMarkup(<NationalJobCard season={hired} onOpen={noop} />)).toContain('You still coach');
  });
});

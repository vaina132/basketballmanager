import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { acceptSponsorshipOffer, requestSponsorshipImprovement } from '../src/world/commercial';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { SponsorshipPanel } from '../src/ui/SponsorshipPanel';

const club = 'rhine-falcons';
const noop = () => {};
const render = (season: SeasonState) => renderToStaticMarkup(<SponsorshipPanel season={season} onEnableSponsorship={noop} onAcceptSponsorship={noop} onDeclineSponsorship={noop} onRequestSponsorship={noop} onSponsorshipDelegation={noop} />);
const advance = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
let opening: SeasonState, renewal: SeasonState, signed: SeasonState, nextSeason: SeasonState;

beforeAll(() => {
  opening = createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
  renewal = opening;
  while (renewal.round < 6) renewal = advance(renewal);
  signed = acceptSponsorshipOffer(renewal, renewal.commercial.offers.find(offer => offer.clubId === club)!.id);
  let complete = setEmploymentDelegation(signed, true);
  while (complete.status === 'active') complete = advance(complete);
  for (let step = 0; step < 80 && getMarketStartReason(complete); step += 1) complete = advanceMarket(complete);
  nextSeason = rolloverSeason(complete);
}, 120_000);

describe('sponsorship panel', () => {
  it('offers prospective activation for older careers and explains why it is unavailable', () => {
    const legacy = createSeason({ seed: 227, managedClubId: club, injuryMode: 'off', ...NEW_CAREER_SYSTEMS, commercial: false });
    const html = render(legacy);
    expect(html).toContain('Negotiate your main sponsor');
    expect(html).toContain('This season stays as it is');
    expect(html).toMatch(/id="enable-sponsorship"[^>]*>Enable negotiations/);
    expect(html).not.toContain('id="sponsor-control"');
    const noFinance = render(createSeason({ seed: 227, managedClubId: club, finance: false, payroll: false }));
    expect(noFinance).toContain('Enable club finances first.');
    expect(noFinance).toMatch(/id="enable-sponsorship"[^>]*disabled/);
  });

  it('shows the inherited fixed sponsor and when offers will arrive', () => {
    const html = render(opening);
    expect(html).toContain('Northbank Works');
    expect(html).toContain('€200,000 · fixed');
    expect(html).toContain('Offers for 2027/28 arrive on matchday 6');
    expect(html).toContain('aria-valuetext="Manual"');
    expect(html).not.toContain('data-sponsor-offer=');
  });

  it('lists open offers with their guaranteed value and one request each', () => {
    const html = render(renewal);
    expect(html).toContain('3 offers for 2027/28');
    expect(html.match(/data-sponsor-offer="/g)).toHaveLength(3);
    expect(html.match(/Ask for 10% more/g)).toHaveLength(3);
    expect(html.match(/data-sponsor-decline="/g)).toHaveLength(3);
    const offer = renewal.commercial.offers.find(item => item.clubId === club)!;
    const asked = render(requestSponsorshipImprovement(renewal, offer.id));
    expect(asked).toMatch(/Agreed to your request|Countered at|Kept its original offer|Withdrew after your request/);
    expect(asked.match(/Ask for 10% more/g)?.length ?? 0).toBeLessThan(3);
  });

  it('confirms a signed future sponsor and keeps the offer history in the disclosure', () => {
    const html = render(signed);
    expect(html).toMatch(/is signed from 2027\/28/);
    expect(html).not.toContain('data-sponsor-offer=');
    expect(html).toContain('data-sponsor-history=');
    expect(html).toContain('Accepted');
  });

  it('shows dated installments for a negotiated season', () => {
    const html = render(nextSeason);
    expect(html).toContain('Opening installment');
    expect(html).toContain('Matchday 6 installment');
    expect(html).toMatch(/data-sponsor-payment="received"/);
    expect(html).toMatch(/data-sponsor-payment="scheduled"/);
  });
});

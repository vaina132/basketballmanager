import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { REAL_CLUB_LOGOS, REAL_COMPETITION_LOGOS } from '../src/data/real-logos';
import { ClubBadge, InlineLogo, clubLogoUrl } from '../src/ui/ClubLogo';

/** Real logos (owner decision, 22 November 2026): API-Sports logos for real-pack clubs, the plain badge otherwise. */
const matches = JSON.parse(readFileSync('real-data/club-logo-matches.json', 'utf8'));

describe('real logos', () => {
  it('maps every matched club and competition that has a logo, and nothing else', () => {
    expect(Object.keys(REAL_CLUB_LOGOS).sort()).toEqual(matches.clubs.filter(row => row.logo).map(row => row.clubId).sort());
    expect(Object.keys(REAL_COMPETITION_LOGOS).sort()).toEqual(matches.competitions.filter(row => row.logo).map(row => row.competitionId).sort());
    expect(Object.keys(REAL_CLUB_LOGOS).length).toBeGreaterThanOrEqual(190);
  });

  it('has a small image file for every map entry', () => {
    const files = [...Object.values(REAL_CLUB_LOGOS).map(file => `public/logos/clubs/${file}`), ...Object.values(REAL_COMPETITION_LOGOS).map(file => `public/logos/competitions/${file}`)];
    for (const file of files) {
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeLessThan(20_000);
    }
    expect(files.reduce((sum, file) => sum + statSync(file).size, 0)).toBeLessThan(3_000_000);
  });

  it('shows the real logo for a real club and the old badge otherwise', () => {
    const real = matches.clubs.find(row => row.logo);
    const html = renderToStaticMarkup(<ClubBadge club={{ id: real.clubId, name: real.club, shortName: 'RCL', color: '#ffffff' }} className="season-club-code" />);
    expect(html).toContain(`src="${clubLogoUrl(real.clubId)}"`);
    expect(html).toContain(`alt="${real.club}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('season-club-code');
    const plain = renderToStaticMarkup(<ClubBadge club={{ id: 'fictional-club', name: 'Harbour City', shortName: 'HAR', color: '#123456' }} className="season-club-code" />);
    expect(plain).not.toContain('<img');
    expect(plain).toContain('HAR');
    expect(renderToStaticMarkup(<InlineLogo kind="competition" id="unknown" name="League" />)).toBe('');
  });
});

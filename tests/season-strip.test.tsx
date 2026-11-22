import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { seasonRounds } from '../src/world/career-world';
import { SeasonProgress, seasonFacts, showsSeasonStrip } from '../src/ui/SeasonProgress';
import { PAGE_NAMES, type Page } from '../src/ui/navigation';

// Owner feedback (22 November 2026): the season strip only on the Desk, the key facts in the top bar, no Squad header strip.
describe('season facts in the top bar', () => {
  const season = createSeason({ seed: 8, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager: { name: 'Strip Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, media: false });

  it('shows the season strip on the Desk only', () => {
    const pages = Object.keys(PAGE_NAMES) as Page[];
    expect(pages.filter(showsSeasonStrip)).toEqual(['home']);
    const html = renderToStaticMarkup(<SeasonProgress season={season} onCompetition={() => {}} />);
    expect(html).toContain('League table');
  });

  it('puts matchday and record in a few words', () => {
    expect(seasonFacts(season)).toBe(`Matchday 1/${seasonRounds(season)} · 0-0`);
  });

  it('has no Squad header strip and renders the strip only through the Desk check', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).not.toContain('squad-summary');
    expect(app).not.toContain('AVG. STAMINA');
    expect(app.match(/<SeasonProgress /g)).toHaveLength(1);
    expect(app).toContain('showsSeasonStrip(page) && <SeasonProgress');
    expect(app).toContain('data-topbar-season');
  });
});

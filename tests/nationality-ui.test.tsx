import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { worldOf } from '../src/world/career-world';
import { Nationality, playerNationality } from '../src/ui/Nationality';
import app from '../src/App.tsx?raw';
import transfers from '../src/ui/TransfersWorkspace.tsx?raw';

// Owner feedback (22 November 2026): player nationalities on the profile, as a small flag in the Squad list and transfer search.
describe('player nationality', () => {
  const base = createSeason({ seed: 8, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager: { name: 'Flag Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, media: false });
  const world = worldOf(base), [first, second, third] = Object.keys(world.playerProfiles);
  const season = { ...base, world: { ...world, source: 'real-data-pack', playerProfiles: { ...world.playerProfiles, [first!]: { ...world.playerProfiles[first!]!, nationality: 'Turkey' }, [second!]: { ...world.playerProfiles[second!]!, nationality: 'Rio Breogan' } } } } as SeasonState;

  it('reads known countries from the world and leaves unknown or junk values blank', () => {
    expect(playerNationality(season, first!)).toBe('Turkey');
    expect(playerNationality(season, second!)).toBeNull();
    expect(playerNationality(season, third!)).toBeNull();
    expect(playerNationality(null, first!)).toBeNull();
  });

  it('shows the flag and country name, or only the flag when compact', () => {
    const full = renderToStaticMarkup(<Nationality country="Turkey" />);
    expect(full).toContain('class="country-flag"');
    expect(full).toContain('<span>Turkey</span>');
    // Real SVG flags since 22 November 2026, evening (no emoji, which Windows shows as letters).
    const emoji = renderToStaticMarkup(<Nationality country="USA" compact />);
    expect(emoji).toContain('data-flag="US"');
    expect(emoji).not.toContain('🇺🇸');
    expect(emoji).toContain('title="USA"');
    expect(emoji).toContain('class="sr-only">USA');
    expect(renderToStaticMarkup(<Nationality country={null} />)).toBe('');
  });

  it('is on the player profile, the Squad list and transfer search rows', () => {
    const profile = app.slice(app.indexOf('function PlayerProfile('));
    expect(profile.slice(0, profile.indexOf('\n}\n'))).toContain('<Nationality country={playerNationality(season, player.id)} />');
    expect(app).toContain('<Nationality country={playerNationality(season, player.id)} compact />');
    expect(transfers).toContain('<Nationality country={playerNationality(season, player.id)} compact />');
  });
});

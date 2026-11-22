import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PLAYER_PHOTOS } from '../src/data/player-photos';
import { Avatar, PhotoCredit } from '../src/ui/Avatar';
import { PhotoCredits } from '../src/ui/PhotoCredits';

/** Real player photos (owner decision, 22 November 2026): free Wikimedia Commons photos with credits, the drawn avatar otherwise. */
const matches = JSON.parse(readFileSync('real-data/player-photo-matches.json', 'utf8'));
const FREE = /^(CC0( 1\.0)?|Public domain|PD[- ].*|CC BY(-SA)? \d\.\d( [a-z]{2,3})?)$/;
const entries = Object.entries(PLAYER_PHOTOS);
const player = (id, name) => ({ id, name, number: 7, skinTone: '#a06a4b', hairColor: '#222222' });

describe('player photos', () => {
  it('maps only freely licensed Commons photos with an author, and matches the reviewed list', () => {
    expect(entries.length).toBeGreaterThanOrEqual(500);
    expect(Object.keys(PLAYER_PHOTOS).sort()).toEqual(matches.players.map(row => row.playerId).sort());
    for (const [id, photo] of entries) {
      expect(photo.licence, id).toMatch(FREE);
      expect(photo.licence, id).not.toMatch(/\b(NC|ND)\b/i);
      expect(photo.author.trim().length, id).toBeGreaterThan(0);
      expect(photo.source, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      if (!/^(CC0|Public domain|PD)/.test(photo.licence)) expect(photo.licenceUrl, id).toMatch(/^https?:\/\/creativecommons\.org\//);
      expect(Boolean(photo.shareAlike), id).toBe(/-SA\b/.test(photo.licence));
    }
  });

  it('has a small image file for every entry and no stray files', () => {
    const files = entries.map(([, photo]) => `public/photos/players/${photo.file}`);
    for (const file of files) {
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeLessThan(25_000);
    }
    expect(files.reduce((sum, file) => sum + statSync(file).size, 0)).toBeLessThan(6_000_000);
    expect(readdirSync('public/photos/players').filter(file => file.endsWith('.webp')).length).toBe(files.length);
  });

  it('shows the photo for a player who has one and the drawn avatar otherwise', () => {
    const [id, photo] = entries[0];
    const html = renderToStaticMarkup(<Avatar player={player(id, photo.player)} color="#123456" size={34} />);
    expect(html).toContain(`src="/photos/players/${photo.file}"`);
    expect(html).toContain(`alt="${photo.player}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('width="34"');
    const drawn = renderToStaticMarkup(<Avatar player={player('fictional-player', 'Sam Harbour')} color="#123456" />);
    expect(drawn).not.toContain('<img');
    expect(drawn).toContain('<svg');
    expect(renderToStaticMarkup(<PhotoCredit playerId="fictional-player" />)).toBe('');
    const credit = renderToStaticMarkup(<PhotoCredit playerId={id} />);
    expect(credit).toContain('Photo:');
    expect(credit).toContain(photo.licence);
  });

  it('lists every photo with its author, licence and Commons page in the Credits view', () => {
    const closed = renderToStaticMarkup(<PhotoCredits />);
    expect(closed).toContain(`Player photos: ${entries.length} from Wikimedia Commons`);
    expect(closed).not.toContain('data-photo-credit-row');
    const html = renderToStaticMarkup(<PhotoCredits defaultOpen />);
    expect(html.match(/data-photo-credit-row=/g)).toHaveLength(entries.length);
    for (const [, photo] of entries.slice(0, 25)) {
      expect(html).toContain(renderToStaticMarkup(<>{photo.author}</>));
      expect(html).toContain(`href="${photo.source.replace(/&/g, '&amp;')}"`);
    }
    expect(html).toContain('href="https://creativecommons.org/');
  });
});

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { estimatedSaveMiB, estimatedSeasonSeconds, GameSpeed } from '../src/ui/GameSpeed';

describe('game speed indicator at career setup (owner request, 15 November 2026)', () => {
  // Step 3.6: real-data measurements (92 s for 18 clubs, 247 s for 36), scaled by 1.5 for a typical laptop.
  it('matches the measured real-data seasons and grows with the number of clubs', () => {
    expect(estimatedSeasonSeconds(18) / 1.5).toBeGreaterThan(80);
    expect(estimatedSeasonSeconds(18) / 1.5).toBeLessThan(105);
    expect(estimatedSeasonSeconds(36) / 1.5).toBeGreaterThan(220);
    expect(estimatedSeasonSeconds(36) / 1.5).toBeLessThan(270);
    expect(estimatedSeasonSeconds(173)).toBeGreaterThan(estimatedSeasonSeconds(36) * 5);
  });

  it('estimates the first-season save size within half a MiB of each measurement', () => {
    for (const [clubs, measured] of [[18, 4.62], [36, 7.45], [54, 10.57]]) expect(Math.abs(estimatedSaveMiB(clubs) - measured)).toBeLessThan(0.5);
    expect(renderToStaticMarkup(<GameSpeed clubs={36} weeks={39} />)).toContain('The save is about 8 MB after the first season.');
  });

  it('shows a level, a meter and per-week and per-season times', () => {
    const one = renderToStaticMarkup(<GameSpeed clubs={18} weeks={40} />);
    expect(one).toContain('data-game-speed="Fast"');
    expect(one).toContain('About 3 seconds per week and 2 minutes per season with 18 clubs playing every week');
    expect(renderToStaticMarkup(<GameSpeed clubs={36} weeks={39} />)).toContain('data-game-speed="Moderate"');
    expect(renderToStaticMarkup(<GameSpeed clubs={74} weeks={44} />)).toContain('data-game-speed="Slow"');
    expect(renderToStaticMarkup(<GameSpeed clubs={173} weeks={44} />)).toContain('data-game-speed="Very slow"');
    expect((one.match(/game-speed-on/g) ?? []).length).toBe(1);
  });
});

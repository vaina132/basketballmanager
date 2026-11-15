import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { estimatedSeasonSeconds, GameSpeed } from '../src/ui/GameSpeed';

describe('game speed indicator at career setup (owner request, 15 November 2026)', () => {
  it('matches the measured seasons and grows with the number of clubs', () => {
    expect(Math.round(estimatedSeasonSeconds(18))).toBeGreaterThan(120);
    expect(Math.round(estimatedSeasonSeconds(18))).toBeLessThan(140);
    expect(Math.round(estimatedSeasonSeconds(36))).toBeGreaterThan(320);
    expect(Math.round(estimatedSeasonSeconds(36))).toBeLessThan(360);
    expect(estimatedSeasonSeconds(173)).toBeGreaterThan(estimatedSeasonSeconds(36) * 5);
  });

  it('shows a level, a meter and per-week and per-season times', () => {
    const one = renderToStaticMarkup(<GameSpeed clubs={18} weeks={40} />);
    expect(one).toContain('data-game-speed="Fast"');
    expect(one).toContain('About 3 seconds per week and 2 minutes per season with 18 clubs');
    expect(renderToStaticMarkup(<GameSpeed clubs={36} weeks={39} />)).toContain('data-game-speed="Moderate"');
    expect(renderToStaticMarkup(<GameSpeed clubs={74} weeks={44} />)).toContain('data-game-speed="Slow"');
    expect(renderToStaticMarkup(<GameSpeed clubs={173} weeks={44} />)).toContain('data-game-speed="Very slow"');
    expect((one.match(/game-speed-on/g) ?? []).length).toBe(1);
  });
});

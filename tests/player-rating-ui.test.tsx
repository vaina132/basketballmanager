import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlayerKnowledge } from '../src/domain/scouting';
import type { PlayerAttributes } from '../src/domain/types';
import { MatchRating, PlayerRating } from '../src/ui/PlayerRating';

const attributes: PlayerAttributes = { twoPoint: 10, threePoint: 10, freeThrow: 10, passing: 10, defense: 10, rebounding: 10, stamina: 10 };
const unknown: PlayerKnowledge = { playerId: 'p', kind: 'unknown', level: 0, attributes: null, ranges: null, observedOn: null, observedClubId: null, ageDays: null, freshness: 'unknown', source: null, observations: 0 };

describe('accessible player rating components', () => {
  it('renders half stars with an explicit ability scale', () => {
    const html = renderToStaticMarkup(<PlayerRating attributes={attributes} compact />);
    expect(html).toContain('aria-label="Ability: 2.5 out of 5 stars"');
    expect(html).toContain('width:50%');
    expect(html).toContain('player-rating--compact');
  });

  it('gives supplied knowledge precedence over raw attributes', () => {
    const html = renderToStaticMarkup(<PlayerRating knowledge={unknown} attributes={attributes} />);
    expect(html).toContain('aria-label="Ability: unknown"');
    expect(html).not.toContain('2.5');
  });

  it('keeps a scouted range visible and announces it as estimated', () => {
    const knowledge: PlayerKnowledge = { ...unknown, kind: 'report', ranges: Object.fromEntries(Object.keys(attributes).map(key => [key, { min: 8, max: 16 }])) as PlayerKnowledge['ranges'] };
    const html = renderToStaticMarkup(<PlayerRating knowledge={knowledge} compact />);
    expect(html).toContain('estimated 2 to 4 out of 5 stars');
    expect(html).toContain('2.0–4.0');
    expect(html).toContain('player-rating-star-range');
  });

  it('separates the match scale from ability and provides an accessible unrated state', () => {
    const rated = renderToStaticMarkup(<MatchRating value={8.3} compact />);
    expect(rated).toContain('Match: 8.3 out of 10');
    expect(rated).toContain('Live ratings are provisional');
    const unrated = renderToStaticMarkup(<MatchRating stats={null} compact />);
    expect(unrated).toContain('Match: unrated, no appearance');
    expect(unrated).toContain('—');
  });
});

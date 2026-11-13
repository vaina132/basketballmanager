import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlayerKnowledge } from '../src/domain/scouting';
import type { PlayerAttributes } from '../src/domain/types';
import { MatchRating, PlayerRating } from '../src/ui/PlayerRating';

const attributes: PlayerAttributes = { twoPoint: 10, threePoint: 10, freeThrow: 10, passing: 10, defense: 10, rebounding: 10, stamina: 10 };
const unknown: PlayerKnowledge = { playerId: 'p', kind: 'unknown', level: 0, attributes: null, ranges: null, observedOn: null, observedClubId: null, ageDays: null, freshness: 'unknown', source: null, observations: 0 };

describe('accessible player rating components', () => {
  it('renders the overall rating with half stars and an explicit scale', () => {
    const html = renderToStaticMarkup(<PlayerRating attributes={{ ...attributes, passing: 16, threePoint: 14 }} position="PG" compact />);
    expect(html).toContain('aria-label="Ability: overall 63, 3 out of 5 stars"');
    expect(html).toContain('>63<');
    expect(html).toContain('player-rating--compact');
    const wide = renderToStaticMarkup(<PlayerRating attributes={{ ...attributes, passing: 16, threePoint: 14 }} position="C" />);
    expect(wide).toContain('aria-label="Ability: overall 49, 2 out of 5 stars"');
    expect(wide).toContain('OVR 49');
    const skill = renderToStaticMarkup(<PlayerRating attributes={attributes} attribute="passing" label="Passing" compact />);
    expect(skill).toContain('aria-label="Passing: 10 out of 20, 2.5 out of 5 stars"');
    expect(skill).toContain('width:50%');
  });

  it('gives supplied knowledge precedence over raw attributes', () => {
    const html = renderToStaticMarkup(<PlayerRating knowledge={unknown} attributes={attributes} />);
    expect(html).toContain('aria-label="Ability: unknown"');
    expect(html).not.toContain('44');
  });

  it('keeps a scouted range visible and announces it as estimated', () => {
    const knowledge: PlayerKnowledge = { ...unknown, kind: 'report', ranges: Object.fromEntries(Object.keys(attributes).map(key => [key, { min: 8, max: 16 }])) as PlayerKnowledge['ranges'] };
    const html = renderToStaticMarkup(<PlayerRating knowledge={knowledge} compact />);
    expect(html).toContain('estimated overall 28 to 92, 1 to 5 out of 5 stars');
    expect(html).toContain('28–92');
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

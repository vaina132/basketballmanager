import { describe, expect, it } from 'vitest';
import { FAIRNESS_MINUTES, withFairRatings } from '../src/world/rating-fairness';

const attributes = value => ({ twoPoint: value, threePoint: value, freeThrow: value, passing: value, defense: value, rebounding: value, stamina: value });
const player = (id, value, extra = {}) => ({ id, name: id, clubId: 'club-a', number: null, position: 'SF', nationality: null, age: 25, heightCm: 200, weightKg: 95, attributes: attributes(value), estimated: [], ...extra });
const pack = players => ({ format: 'basketball-manager-data-pack', formatVersion: 1, version: 't', season: '2026-27', source: {}, notice: '', competitions: [], clubs: [{ id: 'club-a', name: 'A', shortName: 'AAA', country: null, city: null, arena: null, color: null, secondaryColor: null, identitySource: null, playerIds: players.map(item => item.id) }], players });

describe('rating fairness (sprint 4)', () => {
  it('keeps well-sampled ratings and pulls low-minute ratings towards the club level', () => {
    const fair = withFairRatings(pack([player('star', 18, { ratingMinutes: 1500 }), player('regular', 14, { ratingMinutes: 1500 }), player('fringe', 4, { ratingMinutes: 30 }), player('hot', 19, { ratingMinutes: 200 }), player('unrated', 9, { estimated: ['all-abilities'] })]));
    const value = id => fair.players.find(item => item.id === id).attributes.twoPoint;
    expect(value('star')).toBe(18);
    expect(value('regular')).toBe(14);
    // The club level is the minutes-weighted average of its rated players, one step lower.
    expect(value('fringe')).toBeGreaterThan(10);
    expect(value('hot')).toBeLessThan(19);
    expect(value('hot')).toBeGreaterThan(14);
    expect(value('unrated')).toBeGreaterThan(9);
    expect(FAIRNESS_MINUTES).toBe(600);
  });

  it('leaves packs without minutes unchanged except for players with no statistics', () => {
    const original = pack([player('a', 12), player('b', 6), player('c', 9, { estimated: ['all-abilities'] })]);
    expect(withFairRatings(original)).toBe(original);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FixtureResult, SeasonState } from '../src/domain/season';
import { canAdvance, ENTITLEMENT_STORAGE_KEY, freePlayLimit, isPastFreeLimit, LICENSING_ENABLED, loadEntitlement, notConfiguredVerifier, parseEntitlement, saveEntitlement, UNLICENSED, type Entitlement, type EntitlementStorage } from '../src/licensing';
import { NO_CLUB } from '../src/world/career-rules';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { freePartText, UnlockGame } from '../src/ui/UnlockGame';
import { economyPack } from './helpers/economy-pack';
import { nbaPack } from './helpers/nba-pack';

/** The paid version's infrastructure (owner decision, 24 November 2026): built, but off while the owner play-tests. */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };
const PLAYED = { kind: 'played' } as unknown as FixtureResult;
const LICENSED: Entitlement = { status: 'licensed', key: 'TEST-KEY', productId: 'test-product', verifiedAt: '2026-11-24T10:00:00.000Z' };
const noop = () => {};
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** The career with a result on the first `count` of the counted games (in date order); results on nothing else. */
function withPlayed(state: SeasonState, count: number, clubId = state.managedClubId): SeasonState {
  const counted = state.fixtures.filter(fixture => !fixture.stage && !fixture.competition && (!clubId || fixture.homeClubId === clubId || fixture.awayClubId === clubId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).slice(0, count).map(fixture => fixture.id);
  const played = new Set(counted);
  return { ...state, fixtures: state.fixtures.map(fixture => ({ ...fixture, result: played.has(fixture.id) ? PLAYED : null })) };
}

describe('the free part: the first half of the first season', () => {
  let spain: SeasonState, nba: SeasonState;
  beforeAll(() => {
    spain = createSeason({ seed: 5, world: worldFromPack(economyPack([SPAIN]), 'acb'), managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS });
    nba = createSeason({ seed: 11, world: worldFromPack(nbaPack(), 'nba'), managedClubId: 'nba-bos', ...NEW_CAREER_SYSTEMS });
  });

  it('ends in a European league after half of the club\'s regular-season games', () => {
    const limit = freePlayLimit(withPlayed(spain, 0))!;
    expect(limit).toMatchObject({ seasonNumber: 1, basis: 'club', clubId: 'acb-9', total: 34, needed: 17, played: 0 });
    expect(isPastFreeLimit(withPlayed(spain, 0))).toBe(false);
    expect(isPastFreeLimit(withPlayed(spain, 16))).toBe(false);
    expect(isPastFreeLimit(withPlayed(spain, 17))).toBe(true);
    // Other clubs' results do not count for the manager's club.
    const others = spain.fixtures.filter(fixture => fixture.homeClubId !== 'acb-9' && fixture.awayClubId !== 'acb-9').map(fixture => fixture.id);
    const busy = { ...spain, fixtures: spain.fixtures.map(fixture => ({ ...fixture, result: others.includes(fixture.id) ? PLAYED : null })) };
    expect(freePlayLimit(busy)!.played).toBe(0);
  });

  it('ends in the NBA after 41 of 82 games; play-in, playoff and European games are not counted', () => {
    expect(freePlayLimit(nba)).toMatchObject({ basis: 'club', clubId: 'nba-bos', total: 82, needed: 41 });
    expect(isPastFreeLimit(withPlayed(nba, 40))).toBe(false);
    expect(isPastFreeLimit(withPlayed(nba, 41))).toBe(true);
    const extra = { ...nba, fixtures: [...nba.fixtures, { ...nba.fixtures.find(fixture => fixture.homeClubId === 'nba-bos')!, id: 'extra-playoff', stage: 'final' as const }, { ...nba.fixtures.find(fixture => fixture.homeClubId === 'nba-bos')!, id: 'extra-europe', competition: 'euroleague' }] };
    expect(freePlayLimit(extra)!.total).toBe(82);
  });

  it('counts the whole world\'s games for a manager without a club', () => {
    const unemployed = { ...spain, managedClubId: NO_CLUB };
    const all = spain.fixtures.filter(fixture => !fixture.stage && !fixture.competition).length;
    expect(freePlayLimit(unemployed)).toEqual({ seasonNumber: 1, basis: 'world', total: all, needed: Math.ceil(all / 2), played: 0 });
    expect(isPastFreeLimit(withPlayed(unemployed, Math.ceil(all / 2) - 1, NO_CLUB))).toBe(false);
    expect(isPastFreeLimit(withPlayed(unemployed, Math.ceil(all / 2), NO_CLUB))).toBe(true);
  });

  it('is past once the first season is over, and never blocks a calendar without games', () => {
    expect(freePlayLimit({ ...spain, status: 'complete' })).toBeNull();
    expect(isPastFreeLimit({ ...spain, status: 'complete' })).toBe(true);
    expect(isPastFreeLimit({ ...withPlayed(spain, 0), seasonNumber: 2 })).toBe(true);
    expect(isPastFreeLimit({ ...spain, fixtures: [] })).toBe(false);
  });

  it('never blocks while licensing is off, the default of every build', () => {
    expect(LICENSING_ENABLED).toBe(false);
    for (const state of [withPlayed(spain, 0), withPlayed(spain, 17), { ...spain, seasonNumber: 4 }, withPlayed(nba, 82)]) {
      expect(canAdvance(state, UNLICENSED)).toEqual({ allowed: true });
      expect(canAdvance(state, UNLICENSED, false)).toEqual({ allowed: true });
    }
  });

  it('when switched on, blocks past the free part without a licence and allows with one', () => {
    expect(canAdvance(withPlayed(spain, 16), UNLICENSED, true)).toEqual({ allowed: true });
    expect(canAdvance(withPlayed(spain, 17), UNLICENSED, true)).toEqual({ allowed: false, reason: 'free-limit', limit: expect.objectContaining({ played: 17, needed: 17, total: 34 }) });
    expect(canAdvance({ ...spain, seasonNumber: 3 }, UNLICENSED, true)).toEqual({ allowed: false, reason: 'free-limit', limit: null });
    expect(canAdvance(withPlayed(spain, 17), LICENSED, true)).toEqual({ allowed: true });
    expect(canAdvance({ ...spain, seasonNumber: 3 }, LICENSED, true)).toEqual({ allowed: true });
  });
});

describe('the licence in this browser', () => {
  const memory = () => { const items = new Map<string, string>(); return { items, storage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } } satisfies EntitlementStorage }; };
  const blocked: EntitlementStorage = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('SecurityError'); } };

  it('remembers a licence and forgets it again', () => {
    const { items, storage } = memory();
    expect(loadEntitlement(storage)).toEqual(UNLICENSED);
    expect(saveEntitlement(LICENSED, storage)).toBe(true);
    expect(JSON.parse(items.get(ENTITLEMENT_STORAGE_KEY)!)).toEqual(LICENSED);
    expect(loadEntitlement(storage)).toEqual(LICENSED);
    expect(saveEntitlement(UNLICENSED, storage)).toBe(true);
    expect(items.has(ENTITLEMENT_STORAGE_KEY)).toBe(false);
  });

  it('reads blocked, missing or damaged storage as unlicensed, without throwing', () => {
    expect(loadEntitlement(blocked)).toEqual(UNLICENSED);
    expect(saveEntitlement(LICENSED, blocked)).toBe(false);
    expect(loadEntitlement(null)).toEqual(UNLICENSED);
    expect(saveEntitlement(LICENSED, null)).toBe(false);
    for (const raw of ['', 'not json', 'null', '[]', '{"status":"licensed"}', '{"status":"licensed","key":"K","productId":"P","verifiedAt":"yesterday"}', JSON.stringify({ ...LICENSED, key: 'x'.repeat(201) })]) expect(parseEntitlement(raw)).toEqual(UNLICENSED);
  });

  it('is never part of a save file', () => {
    const state = createSeason({ seed: 5, managedClubId: 'rhine-falcons', injuryMode: 'off' });
    expect(JSON.stringify(state)).not.toMatch(/licen[cs]e|entitlement/i);
  });

  it('has only the stub verifier, which answers "not configured" for every key', async () => {
    await expect(notConfiguredVerifier.verify('ANY-KEY')).resolves.toEqual({ kind: 'not-configured', message: expect.stringContaining('cannot be checked') });
  });
});

describe('the "Unlock the full game" screen', () => {
  const limit = { seasonNumber: 1 as const, basis: 'club' as const, clubId: 'acb-9', total: 34, needed: 17, played: 17 };

  it('offers the licence key, says the career is kept and lets the manager save', () => {
    const html = renderToStaticMarkup(<UnlockGame limit={limit} verifier={notConfiguredVerifier} buyUrl="" busy={false} onUnlocked={noop} onSave={noop} onClose={noop} />);
    expect(html).toMatch(/<dialog[^>]*id="unlock-game"[^>]*aria-labelledby="unlock-game-title"/);
    expect(text(html)).toContain('Unlock the full game');
    expect(text(html)).toContain('the first half of your first season (17 of 34 regular-season games)');
    expect(html).toMatch(/<label for="unlock-game-key">Licence key<\/label>/);
    expect(html).toMatch(/id="unlock-game-submit"[^>]*disabled/);
    expect(text(html)).toContain('Your career is kept. Save it now; it continues from this day once the game is unlocked.');
    expect(html).toMatch(/id="unlock-game-save"[^>]*>.*Save career/);
    // No shop yet: no dead Buy link, a plain note instead.
    expect(html).not.toContain('unlock-game-buy');
    expect(text(html)).toContain('Licences are not on sale yet.');
    expect(renderToStaticMarkup(<UnlockGame limit={limit} verifier={notConfiguredVerifier} buyUrl="" busy onUnlocked={noop} onSave={noop} onClose={noop} />)).toMatch(/id="unlock-game-save"[^>]*disabled/);
  });

  it('shows the Buy link once a shop page is configured', () => {
    const html = renderToStaticMarkup(<UnlockGame limit={null} verifier={notConfiguredVerifier} buyUrl="https://example.com/l/game" busy={false} onUnlocked={noop} onSave={noop} onClose={noop} />);
    expect(html).toMatch(/<a id="unlock-game-buy" class="button" href="https:\/\/example.com\/l\/game" target="_blank" rel="noreferrer">.*Buy a licence<\/a>/);
    expect(html).not.toContain('data-unlock-no-shop');
  });

  it('describes the free part for a manager without a club and after the first season', () => {
    expect(freePartText({ ...limit, basis: 'world', clubId: undefined, total: 306, needed: 153, played: 153 })).toContain('(153 of 306 regular-season games in the world)');
    expect(freePartText(null)).toBe('You have played the free part of the game: the first half of your first season.');
  });
});

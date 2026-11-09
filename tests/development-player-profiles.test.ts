import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_START_DATE } from '../src/data/development-league';
import { DEVELOPMENT_PLAYERS } from '../src/data/development-players';
import { DEVELOPMENT_PLAYER_PROFILES, getPlayerAge, playerAgeOnDate } from '../src/data/development-player-profiles';

describe('fictional player calendar ages', () => {
  it('changes age on the simulated birthday, independent of the real current date', () => {
    expect(playerAgeOnDate('1998-04-12', '2026-04-11')).toBe(27);
    expect(playerAgeOnDate('1998-04-12', '2026-04-12')).toBe(28);
    expect(playerAgeOnDate('1998-04-12', '2026-04-13')).toBe(28);
    expect(playerAgeOnDate('1998-04-12', '2036-04-12')).toBe(38);
    expect(playerAgeOnDate('1998-04-12', '9999-12-31')).toBe(8001);
  });

  it('uses March 1 for February 29 birthdays in non-leap years', () => {
    expect(playerAgeOnDate('2004-02-29', '2026-02-28')).toBe(21);
    expect(playerAgeOnDate('2004-02-29', '2026-03-01')).toBe(22);
    expect(playerAgeOnDate('2004-02-29', '2028-02-28')).toBe(23);
    expect(playerAgeOnDate('2004-02-29', '2028-02-29')).toBe(24);
  });

  it('uses exact ISO calendar boundaries rather than local midnight or timezone offsets', () => {
    expect(playerAgeOnDate('2000-01-01', '2026-12-31')).toBe(26);
    expect(playerAgeOnDate('2000-01-01', '2027-01-01')).toBe(27);
    expect(playerAgeOnDate('2000-01-01', '2027-01-01T00:00:00+14:00')).toBeNull();
    expect(playerAgeOnDate('2000-01-01T00:00:00Z', '2027-01-01')).toBeNull();
  });

  it.each([null, undefined, '', 'unknown', '2001-02-29', '2004-02-30', '2000-13-01', '0000-01-01', '2030-04-12'])('preserves unknown age for absent, invalid or future birth date %s', dateOfBirth => {
    expect(playerAgeOnDate(dateOfBirth, '2026-09-05')).toBeNull();
  });

  it('handles an unknown catalog identity and invalid simulated date without inventing an age', () => {
    expect(getPlayerAge('future-import-player', DEVELOPMENT_START_DATE)).toBeNull();
    expect(getPlayerAge('rhf-1', '2026-02-30')).toBeNull();
    expect(getPlayerAge('rhf-1', '')).toBeNull();
    expect(playerAgeOnDate('2026-09-05', '2026-09-05')).toBe(0);
  });

  it('covers every stable development identity with explicitly fictional, immutable metadata', () => {
    expect(Object.keys(DEVELOPMENT_PLAYER_PROFILES).sort()).toEqual(DEVELOPMENT_PLAYERS.map(player => player.id).sort());
    expect(Object.keys(DEVELOPMENT_PLAYER_PROFILES)).toHaveLength(60);
    expect(Object.isFrozen(DEVELOPMENT_PLAYER_PROFILES)).toBe(true);
    for (const player of DEVELOPMENT_PLAYERS) {
      const profile = DEVELOPMENT_PLAYER_PROFILES[player.id]!;
      expect(profile.source).toBe('fictional-development');
      expect(Object.isFrozen(profile)).toBe(true);
      const age = getPlayerAge(player.id, DEVELOPMENT_START_DATE)!;
      expect(age).toBeGreaterThanOrEqual(18);
      expect(age).toBeLessThanOrEqual(36);
      expect(getPlayerAge(player.id, '2027-09-05')).toBe(age + 1);
      expect(Object.hasOwn(player, 'dateOfBirth')).toBe(false);
    }
  });
});

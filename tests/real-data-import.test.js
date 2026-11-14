import { describe, expect, it } from 'vitest';
import { COMPETITIONS, competitionsToImport, displayName, seconds } from '../scripts/real-data-import.mjs';

describe('real-data importer', () => {
  it('reads whole-minute Italian playing time and minute/second values without inventing missing time', () => {
    expect(['28', 28, '28:14', ' 0:05 ', '0', '45:00'].map(seconds)).toEqual([1680, 1680, 1694, 5, 0, 2700]);
    expect([null, undefined, '', 'DNP', '-1', '28:60', '28:99', '28.5', '9007199254740993'].map(seconds)).toEqual(Array(9).fill(null));
  });

  it('turns the provider\'s "Surname Firstname" into a display name and keeps initials as they are', () => {
    expect(['Larkin Shane', 'Horton-Tucker Talen', 'De Colo Nando', 'Fernando Bruno', 'C. Silva', 'Madonna'].map(displayName))
      .toEqual(['Shane Larkin', 'Talen Horton-Tucker', 'Nando De Colo', 'Bruno Fernando', 'C. Silva', 'Madonna']);
  });

  it('covers the first-release scope: ten domestic divisions in six countries and three European competitions', () => {
    expect(new Set(COMPETITIONS.map(item => item.providerId)).size).toBe(13);
    const domestic = COMPETITIONS.filter(item => item.kind === 'domestic');
    expect(domestic).toHaveLength(10);
    const tiers = Object.fromEntries(['Turkey', 'Spain', 'Italy', 'France', 'Greece', 'Germany'].map(country => [country, domestic.filter(item => item.country === country).map(item => item.tier).sort()]));
    expect(tiers).toEqual({ Turkey: [1, 2], Spain: [1, 2], Italy: [1, 2], France: [1, 2], Greece: [1], Germany: [1] });
    expect(COMPETITIONS.filter(item => item.kind === 'european').map(item => item.name)).toEqual(['EuroLeague', 'EuroCup', 'Basketball Champions League']);
    for (const item of COMPETITIONS) expect(item.seasons.map(([label]) => label)).toEqual(['2025-26', '2026-27']);
  });

  it('imports everything by default, or only the named leagues, and refuses unknown league IDs', () => {
    expect(competitionsToImport()).toHaveLength(13);
    expect(competitionsToImport(['117', '95']).map(item => item.name)).toEqual(['Liga ACB', 'Primera FEB']);
    expect(() => competitionsToImport(['117', '999'])).toThrow(/Unknown league ID\(s\) for --only: 999/);
    expect(() => competitionsToImport([])).toThrow(/none given/);
  });
});

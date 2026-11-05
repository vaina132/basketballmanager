import { describe, expect, it } from 'vitest';
import { collectPages, csvCell, normalizeEuroleagueData, parseArguments, requireComplete, toCsv, validateYear } from '../scripts/euroleague-data.mjs';

const registration = (overrides = {}) => ({
  person: { code: 'P1', name: 'TEST, PLAYER', birthDate: '2000-02-29T00:00:00', country: { code: 'TST', name: 'Testland' }, height: 200, weight: 90 },
  type: 'J', club: { code: 'AAA' }, season: { code: 'E2025' }, active: false,
  startDate: '2026-01-15T12:34:56', endDate: '2026-06-30T00:00:00', dorsal: '12', positionName: 'Guard',
  ...overrides,
});
const totals = (overrides = {}) => ({
  player: { code: 'P1', team: { code: 'AAA' } }, gamesPlayed: 3, minutesPlayed: 22.5,
  pointsScored: 12, twoPointersMade: 2, twoPointersAttempted: 4, threePointersMade: 2, threePointersAttempted: 6,
  freeThrowsMade: 2, freeThrowsAttempted: 2, totalRebounds: 3, assists: 0, steals: 1, blocks: 0, turnovers: 2, foulsCommited: 4,
  ...overrides,
});
const document = (overrides = {}) => ({
  code: 'E', season: { code: 'E2025', year: 2025 },
  clubs: { total: 1, data: [{ code: 'AAA', name: 'Test Club', country: { code: 'TST', name: 'Testland' }, city: 'Test City' }] },
  people: { total: 1, data: [registration()] }, statistics: { total: 1, players: [totals()] },
  sourceRefs: { season: ['season-source'], clubs: ['clubs-source'], people: ['people-source'], statistics: ['statistics-source'] },
  ...overrides,
});

describe('real-data normalization without fabricated values', () => {
  it('is deterministic, leaves input untouched, preserves season history and excludes staff', () => {
    const fixture = document({ people: { total: 2, data: [registration(), registration({ type: 'E', person: { code: 'COACH', name: 'TEST, COACH' } })] } });
    const original = structuredClone(fixture);
    const first = normalizeEuroleagueData([fixture], { retrievedAt: '2026-11-05T12:00:00Z' });
    expect(normalizeEuroleagueData([fixture], { retrievedAt: '2026-11-05T12:00:00Z' })).toEqual(first);
    expect(fixture).toEqual(original);
    expect(first.quality.counts).toEqual({ clubs: 1, players: 1, registrations: 1, statistics: 1 });
    expect(first.players[0]).toMatchObject({ id: 'euroleague:person:P1', birthDate: '2000-02-29', heightCm: 200, weightKg: 90, sourceRefs: ['people-source'] });
    expect(first.registrations[0]).toMatchObject({ startDate: '2026-01-15T12:34:56', activeInSource: false, position: 'Guard' });
    expect(first.players[0]).not.toHaveProperty('salary');
    expect(first.players[0]).not.toHaveProperty('ratings');
  });

  it('keeps unknown profile values and absent statistics distinct from zero', () => {
    const fixture = document({
      people: { total: 1, data: [registration({ person: { code: 'P1', name: 'TEST, PLAYER', birthDate: '2000-02-30T00:00:00', height: 0, weight: 0 } })] },
      statistics: { total: 0, players: [] },
    });
    const result = normalizeEuroleagueData([fixture]);
    expect(result.players[0]).toMatchObject({ birthDate: null, heightCm: null, weightKg: null, country: null });
    expect(result.players[0].missingFields).toEqual(['birthDate', 'country', 'heightCm', 'weightKg']);
    expect(result.quality.missing.registrationsWithoutStatistics).toBe(1);
    expect(result.statistics).toEqual([]);
    const unknownStats = normalizeEuroleagueData([document({ statistics: { total: 1, players: [totals({ assists: null, steals: undefined })] } })]);
    expect(unknownStats.statistics[0]).toMatchObject({ assists: null, steals: null, blocks: 0 });
  });

  it('deduplicates players across competitions, fills unknowns and records conflicting observations', () => {
    const first = document({ people: { total: 1, data: [registration({ person: { code: 'P1', name: 'TEST, PLAYER', height: 200, weight: 0 } })] } });
    const second = document({
      code: 'U', season: { code: 'U2025', year: 2025 },
      people: { total: 1, data: [registration({ season: { code: 'U2025' }, person: { code: 'P1', name: 'TEST, PLAYER', height: 201, weight: 91 } })] },
      sourceRefs: { people: ['other-people'], clubs: ['other-clubs'], statistics: ['other-statistics'] },
    });
    const result = normalizeEuroleagueData([second, first]);
    expect(result.players).toHaveLength(1);
    expect(result.registrations).toHaveLength(2);
    expect(result.players[0]).toMatchObject({ heightCm: 200, weightKg: 91, sourceRefs: ['other-people', 'people-source'] });
    expect(result.clubs[0].competitionIds).toEqual(['E2025', 'U2025']);
    expect(result.quality.conflicts).toContainEqual({ entityId: 'euroleague:person:P1', field: 'heightCm', selected: 200, observations: [
      { value: 200, sourceRefs: ['people-source'] }, { value: 201, sourceRefs: ['other-people'] },
    ] });
  });

  it('keeps multi-club statistics as one competition total and validates shot arithmetic', () => {
    const fixture = document({
      clubs: { total: 2, data: [{ code: 'AAA', name: 'First Club' }, { code: 'BBB', name: 'Second Club' }] },
      statistics: { total: 1, players: [totals({ player: { code: 'P1', team: { code: 'AAA;BBB' } } })] },
    });
    const result = normalizeEuroleagueData([fixture]);
    expect(result.statistics).toHaveLength(1);
    expect(result.statistics[0]).toMatchObject({ sourceTeamCode: 'AAA;BBB', clubIds: ['euroleague:club:AAA', 'euroleague:club:BBB'], points: 12 });
    expect(() => normalizeEuroleagueData([document({ statistics: { total: 1, players: [totals({ pointsScored: 13 })] } })])).toThrow('points do not reconcile');
    expect(() => normalizeEuroleagueData([document({ statistics: { total: 1, players: [totals({ twoPointersAttempted: 1 })] } })])).toThrow('makes exceed attempts');
  });

  it('rejects incorrect seasons, incomplete sources, duplicates and unresolved identities', () => {
    expect(() => normalizeEuroleagueData([document({ season: { code: 'E2024', year: 2024 } })])).toThrow('season metadata');
    expect(() => normalizeEuroleagueData([document({ people: { total: 2, data: [registration()] } })])).toThrow('incomplete');
    expect(() => normalizeEuroleagueData([document(), document()])).toThrow('Duplicate competition');
    expect(() => normalizeEuroleagueData([document({ people: { total: 2, data: [registration(), registration()] } })])).toThrow('duplicate registration');
    expect(() => normalizeEuroleagueData([document({ statistics: { total: 2, players: [totals(), totals()] } })])).toThrow('double count');
    expect(() => normalizeEuroleagueData([document({ people: { total: 0, data: [] } })])).toThrow('not registered');
    expect(() => normalizeEuroleagueData([document({ people: { total: 1, data: [registration({ club: { code: 'UNKNOWN' } })] } })])).toThrow('unknown club');
  });
});

describe('complete paginated snapshots', () => {
  it('advances by actual returned rows when the server caps a page', async () => {
    const offsets = [];
    const result = await collectPages(async (offset) => {
      offsets.push(offset);
      return { total: 5, data: ['a', 'b', 'c', 'd', 'e'].slice(offset, offset + 2) };
    });
    expect(offsets).toEqual([0, 2, 4]);
    expect(requireComplete(result)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('rejects truncated, repeated and inconsistent pages', async () => {
    await expect(collectPages(async (offset) => ({ total: 3, data: offset === 0 ? ['a'] : [] }))).rejects.toThrow('pagination ended');
    await expect(collectPages(async () => ({ total: 3, data: ['a'] }))).rejects.toThrow('repeated page');
    await expect(collectPages(async (offset) => ({ total: offset === 0 ? 3 : 4, data: [String(offset)] }))).rejects.toThrow('total changed');
    expect(() => requireComplete({ total: '1', data: ['a'] })).toThrow('integer');
    expect(() => requireComplete({ total: 0, data: ['a'] })).toThrow('more rows');
  });
});

describe('safe local export and CLI', () => {
  it('escapes quoted multiline Unicode and spreadsheet formula cells while retaining unknowns', () => {
    expect(csvCell('A "quoted", name\r\nİstanbul')).toBe('"A ""quoted"", name\r\nİstanbul"');
    for (const input of ['=HYPERLINK("bad")', '+SUM(1,2)', '-1+1', '@SUM(1,2)', '  =formula', '\tformula', '\rformula']) {
      expect(csvCell(input).startsWith('"\'')).toBe(true);
    }
    expect(csvCell(null)).toBe('""');
    expect(csvCell(0)).toBe('"0"');
    expect(toCsv([{ name: 'İstanbul', height: null }], ['name', 'height'])).toBe('\uFEFF"name","height"\r\n"İstanbul",""\r\n');
  });

  it('allows only bounded season years and known arguments', () => {
    expect(parseArguments(['--year', '2025', '--from-research'])).toEqual({ year: 2025, fromResearch: '.artifacts/data-research' });
    expect(parseArguments(['--from-research', 'fixtures', '--refresh'])).toEqual({ year: 2025, fromResearch: 'fixtures', refresh: true });
    for (const input of ['../2025', '2025.0', '2025&secret', '1999', '2101', undefined]) expect(() => validateYear(input)).toThrow('four-digit');
    expect(() => parseArguments(['--url', 'https://untrusted.test'])).toThrow('Unknown argument');
    expect(() => parseArguments(['--year'])).toThrow('four-digit');
  });
});

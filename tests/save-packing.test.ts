import { describe, expect, it } from 'vitest';
import { SEASON_SCHEMA_VERSION, type SeasonState } from '../src/domain/season';
import type { FinanceArchiveRow } from '../src/domain/finance';
import { compactJson2 } from '../src/storage/compact-json';
import { packSeasonForSave, unpackSavedSeason } from '../src/storage/save-packing';
import { parseSealedSeason, parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { createSeason, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { advanceMatchday } from './helpers/board-funding';

// Format 73 (step 3.7): compact saves pack the bulkiest records losslessly; the game and its checks never see the packing.
type Packed = { packing: string; finance: { ledger: unknown[]; archives: { seasonNumber: number; rows: unknown[][] }[] }; injuries: unknown[]; physio: { rehabilitation: unknown[] }; scouting: { clubs: Record<string, { reviews: unknown[] }> }; youthCompetition: { seasons: { fixtures: { id: unknown }[] }[] }; academy: { weeks: { players: Record<string, unknown> }[] }; fixtures: { result: { stats: unknown } | null }[]; history: { fixtures: { result: { stats: unknown; appearances?: unknown } }[] }[] };
const text = (value: unknown) => JSON.stringify(value);
const compactLength = (value: unknown) => { const { strings, shapes, nodes, value: encoded } = compactJson2(value); return text({ strings, shapes, nodes, encoded }).length; };

let career: SeasonState | undefined;
function careerWithArchive(): SeasonState {
  if (career) return career;
  let state = setEmploymentDelegation(createSeason({ seed: 17, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager: { name: 'Packing Manager', dateOfBirth: '1983-05-02', nationality: 'Spain' }, ...NEW_CAREER_SYSTEMS }), true);
  while (state.status === 'active') state = advanceMatchday(state);
  for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
  state = rolloverSeason(state);
  career = advanceMatchday(advanceMatchday(state));
  return career;
}

describe('record packing in compact saves (format 73)', () => {
  it('packs archived and active transactions and restores exactly the same state', () => {
    const state = careerWithArchive();
    expect(state.finance.archives?.length).toBe(1);
    const packed = packSeasonForSave(state) as Packed;
    expect(packed.packing).toBe('save-pack-1');
    // Nearly every transaction packs: weekly charges, wages and gates restore their source and wage lines.
    const rows = packed.finance.archives[0]!.rows;
    expect(rows.filter(row => row[4] === 0).length).toBeGreaterThan(rows.length * 0.6);
    expect(packed.finance.ledger.filter(Array.isArray).length).toBeGreaterThan(packed.finance.ledger.length * 0.6);
    // Scouting reports, injuries, rehabilitation weeks, youth fixtures and academy outcomes pack too.
    const reviews = Object.values(packed.scouting.clubs).flatMap(club => club.reviews);
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every(Array.isArray)).toBe(true);
    if (packed.injuries.length) expect(packed.injuries.every(Array.isArray)).toBe(true);
    if (packed.physio.rehabilitation.length) expect(packed.physio.rehabilitation.every(Array.isArray)).toBe(true);
    expect(packed.youthCompetition.seasons.flatMap(season => season.fixtures).every(fixture => Array.isArray(fixture.id))).toBe(true);
    expect(packed.academy.weeks.some(week => Object.values(week.players).some(Array.isArray))).toBe(true);
    // Box scores and a summarized season's appearances become flat lists keyed by player.
    expect(packed.fixtures.filter(fixture => fixture.result).every(fixture => Array.isArray(fixture.result!.stats))).toBe(true);
    const archived = packed.history[0]!.fixtures;
    expect(archived.some(fixture => Array.isArray(fixture.result.stats))).toBe(true);
    expect(archived.some(fixture => Array.isArray(fixture.result.appearances))).toBe(true);
    const restored = unpackSavedSeason(JSON.parse(text(packed)));
    expect(text(restored)).toBe(text(state));
    expect(compactLength(packed)).toBeLessThan(compactLength(state));
    // The writer packs, every reader restores; plain files stay unpacked.
    const saved = serializeSeasonCompact(state);
    expect(JSON.parse(saved).formatVersion).toBe(SEASON_SCHEMA_VERSION);
    expect(parseSealedSeason(saved)).toEqual(state);
    expect(text(parseSealedSeason(saved))).toBe(text(state));
    expect(JSON.parse(serializeSeason(state)).state).not.toHaveProperty('packing');
  }, 600_000);

  it('passes the full save check after packing and keeps transactions it cannot restore exactly as written', () => {
    const state = careerWithArchive();
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    // A source identity or wage line that does not follow the usual pattern is written whole.
    const archive = state.finance.archives![0]!;
    const index = archive.rows.findIndex(row => row[2] === 'payroll' && row[5].payroll?.type === 'installment' && row[5].payroll.items.length > 0);
    const [clubId, round, kind, amount, , details] = archive.rows[index]!;
    const odd: FinanceArchiveRow = [clubId, round, kind, amount, 'payroll-odd', { payroll: { ...details.payroll!, items: details.payroll!.items.map(item => ({ ...item, agreementId: `${item.agreementId}-odd` })) } }];
    const edited = { ...state, finance: { ...state.finance, archives: [{ ...archive, rows: archive.rows.map((row, position) => position === index ? odd : row) }] } };
    const packed = packSeasonForSave(edited) as Packed;
    expect(packed.finance.archives[0]!.rows[index]).toEqual(odd);
    expect(text(unpackSavedSeason(JSON.parse(text(packed))))).toBe(text(edited));
  }, 600_000);

  it('refuses a packed transaction whose source cannot be restored', () => {
    const state = careerWithArchive();
    const packed = JSON.parse(text(packSeasonForSave(state))) as Packed;
    const position = packed.finance.archives[0]!.rows.findIndex(row => row[2] === 'sponsor');
    packed.finance.archives[0]!.rows[position]![4] = 0;
    expect(() => unpackSavedSeason(packed)).toThrow('Invalid season save: packing cannot restore a transaction source.');
    const broken = JSON.parse(text(packSeasonForSave(state))) as Packed;
    broken.finance.ledger[0] = ['club', 1];
    expect(() => unpackSavedSeason(broken)).toThrow('Invalid season save: packing has an invalid transaction.');
    expect(() => unpackSavedSeason({ ...broken, packing: 'save-pack-9' })).toThrow('unsupported layout');
    const report = JSON.parse(text(packSeasonForSave(state))) as Packed;
    const club = Object.values(report.scouting.clubs).find(item => item.reviews.length)!;
    (club.reviews[0] as unknown[])[5] = 7;
    expect(() => unpackSavedSeason(report)).toThrow('Invalid season save: packing has an invalid scouting report.');
  }, 600_000);
});

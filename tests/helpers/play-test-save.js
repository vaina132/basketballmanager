import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSeason, serializeCheckpoint, serializeSeasonCompact, SEASON_SCHEMA_VERSION } from '../../src/storage/season-storage';
import { setEmploymentDelegation } from '../../src/world/employment';
import { getPlayerListing } from '../../src/world/listings';
import { advanceMarket } from '../../src/world/market';
import { getMarketStartReason } from '../../src/world/market-policy';
import { rolloverSeason } from '../../src/world/season';
import { expectValidOldSaveWeek, playWeek } from './old-save-week';

/**
 * Old-save checks for the formats players may hold since the play test began (73 on). Each fixture is a genuine save of
 * a small real-club career, written by its own format's runtime with `scripts/capture-play-test-save.mjs` (see
 * tests/fixtures/README.md): a few weeks played, an in-season transfer, injuries and, from format 78, a listed player.
 * Plain JavaScript so it can read the fixture files with Node's built-in modules (the project has no Node types).
 * With today's code it must load, pass the strict check, keep the rules it was recorded with, continue a week, and
 * play on through the season's end and the offseason into the next season.
 */

const root = new URL('../fixtures/', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Every system's model, as the capture script recorded it (top-level `…Model` fields and each system's `model`). */
export function systemModels(state) {
  return Object.fromEntries(Object.entries(state).flatMap(([key, value]) => key === 'world' || key === 'activeMatch' ? []
    : /(^model|Model)$/.test(key) ? [[key, value]]
      : value && typeof value === 'object' && !Array.isArray(value) && typeof value.model === 'string' ? [[`${key}.model`, value.model]] : []));
}

/** The checks of one captured format; `commit` is the full hash of the commit whose runtime wrote the files. */
export function describePlayTestSave(version, commit, title) {
  const prefix = `season${version}-playtest`;
  const manifest = JSON.parse(readFileSync(new URL(`${prefix}-manifest.json`, root), 'utf8'));
  /** The save text the browser stored, after checking the recorded hash and envelope. */
  const file = name => {
    const bytes = readFileSync(new URL(`${prefix}-${name}.json.gz`, root));
    expect(sha(bytes)).toBe(manifest.files[`${prefix}-${name}`].sha256);
    const text = gunzipSync(bytes).toString('utf8');
    expect(JSON.parse(text)).toMatchObject({ format: 'basketball-manager-season', formatVersion: version, encoding: 'compact-3' });
    return text;
  };
  const roundTrip = state => parseSeason(serializeSeasonCompact(state));
  /** National teams (format 80) exactly when the captured career had them. */
  const expectNational = state => expect(Object.hasOwn(state, 'national')).toBe(manifest.career.nationalPlayed !== undefined);

  describe(`format-${version} play-test career (${title})`, () => {
    it(`was captured from the unchanged format-${version} runtime`, () => {
      expect(manifest.schema).toBe(version);
      expect(manifest.source).toBe(`commit ${commit} (src unchanged)`);
      expect(manifest.moduleCount).toBeGreaterThan(100);
      // The current format's own fixture (80 while it is the latest) is the one capture without a later runtime.
      expect(SEASON_SCHEMA_VERSION).toBeGreaterThanOrEqual(version);
      file('career'); file('career-next');
    });

    it('loads with the strict check, keeps its own rules and every recorded event, and round-trips', () => {
      const state = parseSeason(file('career'));
      expect(state.schemaVersion).toBe(SEASON_SCHEMA_VERSION);
      const recorded = manifest.files[`${prefix}-career`];
      expect([state.seasonNumber, state.round, state.date, state.status]).toEqual([recorded.seasonNumber, recorded.round, recorded.date, recorded.status]);
      // The rules the career was created with: no newer system model, play model or injury model is switched on.
      expect(systemModels(state)).toEqual(manifest.career.models);
      // Features of later formats stay off (format 80's national teams); a format-80 career keeps its national record.
      expectNational(state);
      if (manifest.career.nationalPlayed !== undefined) expect(state.national.competitions.flatMap(competition => competition.fixtures).filter(fixture => fixture.result)).toHaveLength(manifest.career.nationalPlayed);
      expect(state.managedClubId).toBe(manifest.career.managedClubId);
      expect(state.employment.transfers).toHaveLength(manifest.career.transfers);
      expect(state.employment.transfers.some(transfer => transfer.playerId === manifest.career.signing)).toBe(true);
      expect(state.injuries).toHaveLength(manifest.career.injuries);
      expect(state.fixtures.filter(fixture => fixture.result)).toHaveLength(manifest.career.playedFixtures);
      if (manifest.career.listed) expect(getPlayerListing(state, manifest.career.listed)).not.toBeNull();
      // Saved again as the browser saves it (manual save and background checkpoint), it reads back unchanged.
      expect(roundTrip(state)).toEqual(state);
      expect(parseSeason(serializeCheckpoint(structuredClone(state)))).toEqual(state);
    }, 600_000);

    it('continues one valid week on its own rules, like the week its runtime played', () => {
      const state = parseSeason(file('career'));
      const next = playWeek(state);
      expectValidOldSaveWeek(state, next, parseSeason(file('career-next')));
      expect(systemModels(next)).toEqual(manifest.career.models);
      expectNational(next);
      expect(roundTrip(next)).toEqual(next);
    }, 600_000);

    it('plays out its season and offseason and rolls over into a valid next season on its own rules', () => {
      let state = parseSeason(file('career'));
      for (let weeks = 0; state.status === 'active'; weeks += 1) { expect(weeks).toBeLessThan(60); state = playWeek(state); }
      expect(roundTrip(state)).toEqual(state);
      // The manager lets the assistant finish recruitment (the squad needs eight signed players to close the market).
      state = setEmploymentDelegation(state, true);
      for (let steps = 0; steps < 150 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
      expect(getMarketStartReason(state)).toBeNull();
      let opening = rolloverSeason(state);
      expect(opening.seasonNumber).toBe(2);
      expect(roundTrip(opening)).toEqual(opening);
      for (let week = 0; week < 2; week += 1) opening = playWeek(opening);
      expect(roundTrip(opening)).toEqual(opening);
      expect(systemModels(opening)).toEqual(manifest.career.models);
      expectNational(opening);
    }, 1_200_000);
  });
}

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEASON_SCHEMA_VERSION } from '../src/domain/season';
import { loadCareerCheckpoint, readCareerSaves, readCurrentCareer, saveCareerCheckpoint } from '../src/storage/career-saves';
import { SAVE_CHECKS_VERSION, saveSeal, sealMatches } from '../src/storage/save-seal';
import { directSeasonCodec } from '../src/storage/season-codec';
import { decodeSeasonJournal, prepareSeasonCheckpoint } from '../src/storage/season-journal';
import { parseSealedSeason, parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { createSeason } from '../src/world/season';

const storage = vi.hoisted(() => ({ readSeasonJournal: vi.fn(), writeSeasonCheckpoint: vi.fn(), readLocalSeason: vi.fn(), writeLocalSeason: vi.fn() }));
vi.mock('../src/storage/season-indexed-db', () => storage);
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/season39-${name}.json.gz`, import.meta.url))).toString('utf8');
const state = createSeason(19, 'aegean-waves');
const text = serializeSeasonCompact(state);
/** The same career with inconsistent condition accounting, which the full checks refuse. */
function invalidState() {
  const changed = structuredClone(state);
  changed.conditions[Object.keys(changed.conditions)[0]] = 37;
  return changed;
}
function tampered() {
  // Serialize without validation, as a damaged or edited file would be.
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: SEASON_SCHEMA_VERSION, engineVersion: 'possession-3', state: invalidState() });
}
const versionOneSeal = serialized => createHash('sha256').update(`courtside-save-seal|format-${SEASON_SCHEMA_VERSION}|checks-1|${serialized}`).digest('hex');
const counting = () => {
  const calls = { parse: 0, parseSealed: 0 };
  const codec = {
    serialize: value => directSeasonCodec.serialize(value),
    parse: value => { calls.parse += 1; return directSeasonCodec.parse(value); },
    parseSealed: value => { calls.parseSealed += 1; return directSeasonCodec.parseSealed(value); },
  };
  return { codec, calls };
};
const checkpoint = (revision, serialized, seal) => ({ revision, savedAt: `2026-11-14T12:00:0${revision}.000Z`, reason: 'matchday', serialized, ...(seal ? { seal } : {}) });

describe('save seals (step 3.2)', () => {
  it('fingerprint a save text and its checks version, and match only that text', async () => {
    const seal = await saveSeal(text);
    expect(seal).toMatch(/^[0-9a-f]{64}$/);
    expect(await saveSeal(text)).toBe(seal);
    expect(await saveSeal(`${text} `)).not.toBe(seal);
    expect(await sealMatches(text, seal)).toBe(true);
    expect(await sealMatches(`${text} `, seal)).toBe(false);
    for (const missing of [undefined, null, '', 'abc', seal.toUpperCase(), 42]) expect(await sealMatches(text, missing)).toBe(false);
  });

  it('unpack a sealed save without replaying it, and still check its world', () => {
    expect(parseSealedSeason(text)).toEqual(parseSeason(text));
    expect(() => parseSeason(tampered())).toThrow(/Invalid season save/);
    const wrongWorld = JSON.parse(tampered());
    wrongWorld.state.dataPackId = 'somewhere-else';
    expect(() => parseSealedSeason(JSON.stringify(wrongWorld))).toThrow(/unsupported data pack/);
    expect(() => parseSealedSeason('{')).toThrow(/not a valid JSON/);
  });

  it('send older formats through the full checks and their upgrade', () => {
    const old = fixture('board-opening');
    expect(parseSealedSeason(old)).toEqual(parseSeason(old));
  }, 120_000);

  it.each(['manual', 'new-game', 'matchday', 'rollover', 'recovery'])('fully validate a %s checkpoint before any write', async reason => {
    await expect(saveCareerCheckpoint(invalidState(), 0, reason)).rejects.toThrow(/Invalid season save/);
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it('never uses an unchecked serialization shortcut, including codecs from the unfinished implementation', async () => {
    const serialize = vi.fn(value => directSeasonCodec.serialize(value));
    const unchecked = vi.fn(async () => tampered());
    const codec = { ...directSeasonCodec, serialize, serializeCheckpoint: unchecked };
    await expect(saveCareerCheckpoint(invalidState(), 0, 'manual', codec)).rejects.toThrow(/Invalid season save/);
    expect(serialize).toHaveBeenCalledExactlyOnceWith(invalidState());
    expect(unchecked).not.toHaveBeenCalled();
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it('keep portable import and export strict, with no fingerprint inside the exported text', async () => {
    expect(await directSeasonCodec.serialize(state)).toBe(text);
    expect(JSON.parse(text)).not.toHaveProperty('seal');
    await expect(directSeasonCodec.serialize(invalidState())).rejects.toThrow(/Invalid season save/);
    await expect(directSeasonCodec.parse(tampered())).rejects.toThrow(/Invalid season save/);
    const fileWithSeal = { ...JSON.parse(tampered()), seal: await saveSeal(text) };
    await expect(directSeasonCodec.parse(JSON.stringify(fileWithSeal))).rejects.toThrow(/Invalid season save/);
  });

  it('are written beside every checkpoint the game saves', async () => {
    storage.writeSeasonCheckpoint.mockImplementation(async (serialized, revision, reason, seal) => checkpoint(revision + 1, serialized, seal));
    const saved = await saveCareerCheckpoint(state, 0, 'matchday');
    expect(storage.writeSeasonCheckpoint).toHaveBeenCalledWith(text, 0, 'matchday', await saveSeal(text));
    expect(saved.seal).toBe(await saveSeal(text));
  });

  it('let a checkpoint whose text still matches load without the replay; any other text gets the full checks', async () => {
    const seal = await saveSeal(text);
    storage.readSeasonJournal.mockResolvedValue({ revision: 1, current: text, checkpoints: [checkpoint(1, text, seal)] });
    let { codec, calls } = counting();
    expect((await readCurrentCareer(codec)).current).toEqual(state);
    expect(calls).toEqual({ parse: 0, parseSealed: 1 });

    // Damaged or edited text no longer matches its seal: the full checks run and refuse it.
    const damaged = tampered();
    storage.readSeasonJournal.mockResolvedValue({ revision: 1, current: damaged, checkpoints: [checkpoint(1, damaged, seal)] });
    ({ codec, calls } = counting());
    const result = await readCurrentCareer(codec);
    expect(result.current).toBeNull();
    expect(result.currentError).toMatch(/cannot be loaded/);
    expect(calls).toEqual({ parse: 1, parseSealed: 0 });

    // Checkpoints saved before seals existed, and older checkpoints in history, keep the full checks.
    const older = serializeSeasonCompact(createSeason(23, 'atlantic-pilots'));
    storage.readSeasonJournal.mockResolvedValue({ revision: 2, current: text, checkpoints: [checkpoint(2, text, seal), checkpoint(1, older)] });
    ({ codec, calls } = counting());
    const list = await readCareerSaves(codec);
    expect(list.entries.map(entry => entry.valid)).toEqual([true, true]);
    expect(calls).toEqual({ parse: 1, parseSealed: 1 });
    ({ codec, calls } = counting());
    expect((await loadCareerCheckpoint(2, codec)).state).toEqual(state);
    expect(calls).toEqual({ parse: 0, parseSealed: 1 });
  });

  it('invalidate version-one fingerprints even when their text is unchanged', async () => {
    expect(SAVE_CHECKS_VERSION).toBeGreaterThan(1);
    for (const serialized of [text, tampered()]) {
      const oldSeal = versionOneSeal(serialized);
      expect(await sealMatches(serialized, oldSeal)).toBe(false);
      storage.readSeasonJournal.mockResolvedValue({ revision: 1, current: serialized, checkpoints: [checkpoint(1, serialized, oldSeal)] });
      const { codec, calls } = counting();
      const loaded = await readCurrentCareer(codec);
      expect(calls).toEqual({ parse: 1, parseSealed: 0 });
      if (serialized === text) expect(loaded.current).toEqual(state);
      else {
        expect(loaded.current).toBeNull();
        expect(loaded.currentError).toMatch(/cannot be loaded/);
      }
    }
  });

  it('keep codecs without a verified-checkpoint reader compatible through strict parsing', async () => {
    const seal = await saveSeal(text);
    storage.readSeasonJournal.mockResolvedValue({ revision: 1, current: text, checkpoints: [checkpoint(1, text, seal)] });
    const parse = vi.fn(value => directSeasonCodec.parse(value));
    const codec = { serialize: value => directSeasonCodec.serialize(value), parse };
    const list = await readCareerSaves(codec);
    expect(list.current).toEqual(state);
    expect(list.entries[0].valid).toBe(true);
    expect(parse).toHaveBeenCalledExactlyOnceWith(text);
  });

  it.each(['broken', 17, {}, null])('ignore malformed fingerprint metadata %j and retain strict recovery choices', async invalidSeal => {
    const older = checkpoint(1, text, await saveSeal(text));
    const damagedText = tampered();
    const newest = { ...checkpoint(2, damagedText), seal: invalidSeal };
    const journal = decodeSeasonJournal(damagedText, 2, [newest, older]);
    expect(journal.checkpoints[0]).not.toHaveProperty('seal');
    storage.readSeasonJournal.mockResolvedValue(journal);
    const { codec, calls } = counting();
    const list = await readCareerSaves(codec);
    expect(list.current).toBeNull();
    expect(list.entries.map(entry => entry.valid)).toEqual([false, true]);
    expect(calls).toEqual({ parse: 1, parseSealed: 1 });
    expect((await loadCareerCheckpoint(1, codec)).state).toEqual(state);
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it.each(['missing crypto', 'missing subtle', 'rejected digest'])('preserve strict saving and loading with %s', async failure => {
    const seal = await saveSeal(text);
    const crypto = failure === 'missing crypto' ? undefined : failure === 'missing subtle' ? {} : { subtle: { digest: vi.fn().mockRejectedValue(new Error('Crypto unavailable')) } };
    vi.stubGlobal('crypto', crypto);
    expect(await saveSeal(text)).toBeUndefined();
    expect(await sealMatches(text, seal)).toBe(false);

    storage.writeSeasonCheckpoint.mockImplementation(async (serialized, revision, reason, fingerprint) => checkpoint(revision + 1, serialized, fingerprint));
    const saved = await saveCareerCheckpoint(state, 0, 'matchday');
    expect(storage.writeSeasonCheckpoint).toHaveBeenCalledExactlyOnceWith(text, 0, 'matchday', undefined);
    expect(saved).not.toHaveProperty('seal');

    storage.readSeasonJournal.mockResolvedValue({ revision: 1, current: text, checkpoints: [checkpoint(1, text, seal)] });
    const { codec, calls } = counting();
    expect((await readCurrentCareer(codec)).current).toEqual(state);
    expect(calls).toEqual({ parse: 1, parseSealed: 0 });

    storage.readSeasonJournal.mockResolvedValue({ revision: 1, current: tampered(), checkpoints: [checkpoint(1, tampered(), seal)] });
    expect((await readCurrentCareer(codec)).current).toBeNull();
    expect(calls).toEqual({ parse: 2, parseSealed: 0 });
    storage.writeSeasonCheckpoint.mockClear();
    await expect(saveCareerCheckpoint(invalidState(), 1, 'manual')).rejects.toThrow(/Invalid season save/);
    expect(storage.writeSeasonCheckpoint).not.toHaveBeenCalled();
  });

  it('are kept by the checkpoint journal when valid and ignored when malformed', async () => {
    const seal = await saveSeal(text);
    expect(decodeSeasonJournal(text, 1, [checkpoint(1, text, seal)]).checkpoints[0].seal).toBe(seal);
    expect(decodeSeasonJournal(text, 1, [checkpoint(1, text, 'not-a-seal')]).checkpoints[0]).not.toHaveProperty('seal');
    const empty = { revision: 0, current: null, checkpoints: [] };
    expect(prepareSeasonCheckpoint(empty, text, 0, 'matchday', '2026-11-14T12:00:00.000Z', seal).checkpoint.seal).toBe(seal);
    expect(prepareSeasonCheckpoint(empty, text, 0, 'matchday', '2026-11-14T12:00:00.000Z').checkpoint).not.toHaveProperty('seal');
    expect(() => prepareSeasonCheckpoint(empty, text, 0, 'matchday', '2026-11-14T12:00:00.000Z', 'xyz')).toThrow(/64 hexadecimal/);
  });
});

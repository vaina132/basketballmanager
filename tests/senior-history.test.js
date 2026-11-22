import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEASON_SCHEMA_VERSION } from '../src/domain/season';
import { parseSeason, serializeSeasonCompact, validateSeasonState } from '../src/storage/season-storage';
import { getSeasonPerformance, getPerformanceCoverage } from '../src/world/performance';
import { getSquadRelationships } from '../src/world/relationships';
import { managedClubFor } from '../src/world/career';
import { SENIOR_TOTAL_KEYS, summarizeSeniorHistory } from '../src/world/senior-history';
import { sealCompletedHistory } from '../src/world/sealed-history';
import { currentSeasonFile } from './helpers/season-format';

const manifest = JSON.parse(readFileSync(new URL('./fixtures/senior-history-original-44.json', import.meta.url), 'utf8'));
const cases = [];
beforeAll(() => {
  for (const row of manifest.fixtures) {
    const bytes = readFileSync(new URL(`./fixtures/${row.file}`, import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
    const text = gunzipSync(bytes).toString('utf8'), original = JSON.parse(text);
    expect(original.formatVersion).toBe(44);
    const full = { ...original.state, schemaVersion: SEASON_SCHEMA_VERSION };
    // Since save checks version 6 a current-format save keeps its completed seasons' youth games and academy weeks
    // sealed (format 73), as a rollover leaves them.
    validateSeasonState(sealCompletedHistory(full));
    cases.push({ file: row.file, text, full, summarized: parseSeason(text) });
  }
}, 120_000);
const totals = rows => rows.map(({ log, summaryGames, ...row }) => row);
const opening = () => cases.find(row => row.file === 'season44-board-opening.json.gz');

describe('completed senior season summaries', () => {
  it.each(manifest.fixtures)('preserves original totals, manager logs and morale for $file', ({ file }) => {
    const { full, summarized } = cases.find(row => row.file === file);
    for (let year = 1; year <= full.seasonNumber; year++) {
      const before = getSeasonPerformance(full, year), after = getSeasonPerformance(summarized, year);
      expect(totals(after)).toEqual(totals(before));
      const managed = managedClubFor(full, year, false);
      expect(after.filter(row => row.club.id === managed)).toEqual(before.filter(row => row.club.id === managed));
    }
    for (const club of full.clubs) expect(getSquadRelationships(summarized, club.id)).toEqual(getSquadRelationships(full, club.id));
    for (const [index, archive] of summarized.history.entries()) {
      const managed = managedClubFor(full, archive.seasonNumber, false);
      expect(archive.summary.players.length).toBeGreaterThan(0);
      for (const [at, fixture] of archive.fixtures.entries()) {
        if ([fixture.homeClubId, fixture.awayClubId].includes(managed)) expect(fixture).toEqual(full.history[index].fixtures[at]);
        else { expect(fixture.result.stats).toBeNull(); expect(fixture.result.appearances).toBeDefined(); }
      }
    }
    expect(parseSeason(serializeSeasonCompact(summarized))).toEqual(summarized);
    expect(summarizeSeniorHistory(summarized)).toBe(summarized);
  });

  it('shrinks the retained season while preserving the full source object', () => {
    const { full, summarized } = opening(), before = structuredClone(full);
    // The unsealed source is no longer a valid current-format save (save checks version 6), so compare plain JSON.
    expect(JSON.stringify(summarized).length).toBeLessThan(JSON.stringify(full).length);
    // Format 73: the upgraded career's completed youth and academy seasons are sealed as a rollover would do.
    expect(sealCompletedHistory(summarizeSeniorHistory(full))).toEqual(summarized);
    expect(full).toEqual(before);
  });

  it('keeps the previously managed club’s detail after an offseason job change', () => {
    // Policy projection only: a historical move must select the old club, regardless of the current job.
    const state = structuredClone(opening().full), previousClub = state.managedClubId;
    state.managedClubId = state.clubs.find(club => club.id !== previousClub).id;
    state.career.moves = [{ seasonNumber: 1, fromClubId: previousClub, toClubId: state.managedClubId }];
    const projected = summarizeSeniorHistory(state);
    for (const fixture of projected.history[0].fixtures) {
      if ([fixture.homeClubId, fixture.awayClubId].includes(previousClub)) expect(fixture.result.stats).not.toBeNull();
      else expect(fixture.result.appearances).toBeDefined();
    }
  });

  it('keeps genuinely missing old statistics unknown instead of inventing totals', () => {
    const state = structuredClone(opening().full);
    for (const archive of state.history) for (const fixture of archive.fixtures) fixture.result.stats = null;
    expect(summarizeSeniorHistory(state)).toBe(state);
    expect(getPerformanceCoverage(state, 1)).toBe('unavailable');
    expect(getSeasonPerformance(state, 1)).toEqual([]);
  });

  it('validates original format 44 evidence before any migration can discard detail', () => {
    const envelope = JSON.parse(opening().text);
    const fixture = envelope.state.history[0].fixtures.find(row => ![row.homeClubId, row.awayClubId].includes(envelope.state.managedClubId));
    Object.values(fixture.result.stats)[0].points += 1;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow();
  });

  it.each(['missing summary', 'extra row', 'missing row', 'row order', 'games', 'seconds', 'fouls', 'score', 'shots', 'missing appearance', 'false participation', 'full and summary', 'manager detail', 'legacy summary'])('rejects %s after a prior successful validation', damage => {
    const state = structuredClone(opening().summarized);
    validateSeasonState(state);
    const archive = state.history[0], fixture = archive.fixtures.find(row => row.result.appearances);
    const row = archive.summary.players[0];
    if (damage === 'missing summary') delete archive.summary;
    else if (damage === 'extra row') archive.summary.players.push(structuredClone(row));
    else if (damage === 'missing row') archive.summary.players.pop();
    else if (damage === 'row order') archive.summary.players.reverse();
    else if (damage === 'games') row.games += 1;
    else if (damage === 'seconds') row.totals.secondsPlayed += 1;
    else if (damage === 'fouls') row.totals.fouls += 1;
    else if (damage === 'score') { row.totals.points += 2; row.totals.fieldGoalsMade += 1; row.totals.fieldGoalsAttempted += 1; }
    else if (damage === 'shots') row.totals.threePointersMade = row.totals.fieldGoalsMade + 1;
    else if (damage === 'missing appearance') delete fixture.result.appearances[Object.keys(fixture.result.appearances)[0]];
    else if (damage === 'false participation') { const entry = Object.values(fixture.result.appearances).find(item => item.secondsPlayed > 0); entry.appeared = false; }
    else if (damage === 'full and summary') fixture.result.stats = {};
    else if (damage === 'legacy summary') delete fixture.result.appearances;
    else {
      const managed = archive.fixtures.find(row => [row.homeClubId, row.awayClubId].includes(managedClubFor(state, 1, false)));
      managed.result.appearances = Object.fromEntries(Object.entries(managed.result.stats).map(([id, stats]) => [id, { secondsPlayed: stats.secondsPlayed, fouls: stats.fouls, appeared: SENIOR_TOTAL_KEYS.some(key => stats[key] !== 0) }]));
      managed.result.stats = null;
    }
    expect(() => validateSeasonState(state)).toThrow();
    expect(() => parseSeason(currentSeasonFile(state))).toThrow();
  });
});

import { restoreSeniorDetail } from './helpers/senior-reference';
import { financeAtLedgerBoundary, financeLedgerCount } from '../src/world/finance-ledger';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSealedSeason, parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { saveSeal, sealMatches } from '../src/storage/save-seal';
import { advanceSeason, managedSide, rolloverSeason } from '../src/world/season';
import { SEASON_SCHEMA_VERSION } from './helpers/season-format';
import { expectValidOldSaveWeek, withFormat73Records } from './helpers/old-save-week';

// Captured at unchanged commit 11a02a9, before academy outcomes existed. Never relabel or forge their versions.
const names = ['career', 'career-next', 'complete', 'opening'];
const files = Object.fromEntries(names.map(name => [name, gunzipSync(readFileSync(new URL(`./fixtures/season41-board-${name}.json.gz`, import.meta.url))).toString('utf8')]));
const originals = Object.fromEntries(names.map(name => [name, JSON.parse(files[name]).state]));
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const outcome = report => ({ detail: 'outcome', clubId: report.clubId, focus: report.focus, pointsAfter: { ...report.pointsAfter } });
let states;

beforeAll(() => { states = Object.fromEntries(names.map(name => [name, parseSeason(files[name])])); }, 120_000);

/** Restore omitted display details from the independently recorded old fixture, only after proving every retained value. */
function fullReference(candidate, original) {
  const restored = restoreSeniorDetail(candidate, original);
  const byWeek = new Map(original.academy.weeks.map(week => [week.id, week]));
  for (const week of restored.academy.weeks) for (const [id, report] of Object.entries(week.players)) if (report.detail === 'outcome') {
    const previous = byWeek.get(week.id)?.players[id];
    expect(previous, `${week.id}/${id} requires original evidence`).toBeDefined();
    expect(report).toEqual(outcome(previous));
    week.players[id] = structuredClone(previous);
  }
  const youthById = new Map(original.youthCompetition.seasons.flatMap(season => season.fixtures).map(fixture => [fixture.id, fixture]));
  for (const season of restored.youthCompetition.seasons) for (const fixture of season.fixtures) if (fixture.detail === 'outcome') {
    const previous = youthById.get(fixture.id);
    expect(previous, `${fixture.id} requires original youth evidence`).toBeDefined();
    expect(fixture).toEqual({ ...previous, home: null, away: null, startingConditions: null, detail: 'outcome', playerIds: { home: previous.home.players.map(player => player.id), away: previous.away.players.map(player => player.id) } });
    delete fixture.detail;
    delete fixture.playerIds;
    fixture.home = structuredClone(previous.home);
    fixture.away = structuredClone(previous.away);
    fixture.startingConditions = structuredClone(previous.startingConditions);
  }
  restored.finance = financeAtLedgerBoundary(restored.finance, financeLedgerCount(restored.finance));
  restored.schemaVersion = 41;
  return restored;
}

describe('genuine format-41 academy history', () => {
  it('migrates verified old reports without changing retained points, any other state or source input', () => {
    for (const name of names) {
      const file = JSON.parse(files[name]);
      expect(file.formatVersion).toBe(41);
      expect(file.encoding).toBeUndefined();
      expect(withFormat73Records(fullReference(states[name], originals[name]))).toEqual(withFormat73Records(originals[name]));
      expect(originals[name].academy.weeks.flatMap(week => Object.values(week.players)).some(report => report.detail === 'outcome')).toBe(false);
    }
    for (const name of ['career', 'career-next', 'complete']) expect(states[name].academy.weeks).toEqual(withFormat73Records(originals[name]).academy.weeks);
    // Format 73 also summarizes the current season's rival reports that are no longer a club's latest, never the manager's.
    const career = states.career, latest = career.academy.weeks.at(-1).id;
    let count = 0;
    for (const week of career.academy.weeks) for (const report of Object.values(week.players)) if (report.detail === 'outcome') {
      expect(report.clubId).not.toBe(career.managedClubId);
      expect(week.id).not.toBe(latest);
      count += 1;
    }
    expect(count).toBeGreaterThan(0);
    // The opening seals the completed season: each prospect keeps only its last report of that season.
    const opening = states.opening, source = originals.opening;
    const completed = state => state.academy.weeks.filter(week => week.seasonNumber < state.seasonNumber).flatMap(week => Object.keys(week.players));
    expect(new Set(completed(opening)).size).toBe(completed(opening).length);
    expect(new Set(completed(opening))).toEqual(new Set(completed(source)));
    expect(completed(opening).length).toBeLessThan(completed(source).length);
  });

  // Match calibration and realistic injuries (sprint 4) changed the simulated results after this old save, so the week is
  // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts). The rollover plays no games.
  it('continues the old career for a valid week that follows the independently recorded one', () => {
    expectValidOldSaveWeek(states.career, advance(states.career), states['career-next']);
  }, 120_000);

  it('rolls over exactly as the prior implementation independently recorded', () => {
    expect(withFormat73Records(fullReference(rolloverSeason(states.complete), originals.opening))).toEqual(withFormat73Records(originals.opening));
    expect(rolloverSeason(states.complete)).toEqual(states.opening);
  }, 120_000);

  it('keeps outcomes and gameplay identical through strict portable and verified local roundtrips', async () => {
    for (const name of names) {
      const text = serializeSeasonCompact(states[name]);
      // Format 73 writes every save, older careers included, in the compact-3 layout, stored compressed since 24 November 2026.
      expect(JSON.parse(text)).toMatchObject({ formatVersion: SEASON_SCHEMA_VERSION, encoding: 'compact-3-deflate' });
      expect(parseSeason(text)).toEqual(states[name]);
      expect(await sealMatches(text, await saveSeal(text))).toBe(true);
      expect(parseSealedSeason(text)).toEqual(states[name]);
    }
    expect(advance(parseSeason(serializeSeasonCompact(states.opening)))).toEqual(advance(states.opening));
  }, 120_000);
});

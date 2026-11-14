import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSeason, serializeSeason, validateSeasonState } from '../src/storage/season-storage';
import { currentSeasonFile } from './helpers/season-format';

const original = name => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/season41-board-${name}.json.gz`, import.meta.url))).toString('utf8'));
// Independent description of the portable outcome fields; never copy the implementation's projection in a test.
const outcome = report => ({ detail: 'outcome', clubId: report.clubId, focus: report.focus, pointsAfter: { ...report.pointsAfter } });
let opening, complete, oldOpening, summarizedId, summarizedWeek;
beforeAll(() => {
  oldOpening = original('opening');
  opening = parseSeason(JSON.stringify(oldOpening));
  complete = parseSeason(JSON.stringify(original('complete')));
  summarizedWeek = opening.academy.weeks.findIndex(week => Object.values(week.players).some(report => report.detail === 'outcome'));
  expect(summarizedWeek).toBeGreaterThanOrEqual(0);
  summarizedId = Object.keys(opening.academy.weeks[summarizedWeek].players).find(id => opening.academy.weeks[summarizedWeek].players[id].detail === 'outcome');
}, 120_000);

describe('strict academy history outcomes', () => {
  it('validates, exports and reloads retained outcomes without changing their sporting or financial state', () => {
    const before = JSON.stringify(opening);
    validateSeasonState(opening);
    expect(parseSeason(serializeSeason(opening))).toEqual(opening);
    expect(JSON.stringify(opening)).toBe(before);
    expect(opening.academy.weeks[summarizedWeek].players[summarizedId]).toEqual(outcome(oldOpening.state.academy.weeks[summarizedWeek].players[summarizedId]));
  });

  it('accepts an eligible detailed report as well as its verified outcome', () => {
    const detailed = structuredClone(opening);
    detailed.academy.weeks[summarizedWeek].players[summarizedId] = structuredClone(oldOpening.state.academy.weeks[summarizedWeek].players[summarizedId]);
    expect(parseSeason(currentSeasonFile(detailed))).toEqual(detailed);
  });

  it.each([
    ['changed development total', report => { report.pointsAfter.twoPoint += 1; }],
    ['missing development attribute', report => { delete report.pointsAfter.passing; }],
    ['invented development attribute', report => { report.pointsAfter.invented = 0; }],
    ['changed focus', report => { report.focus = report.focus === 'defense' ? 'passing' : 'defense'; }],
    ['changed owner', report => { report.clubId = opening.managedClubId; }],
    ['unknown outcome version', report => { report.detail = 'future-outcome'; }],
    ['missing outcome marker', report => { delete report.detail; }],
    ['hidden unvalidated gains', report => { report.gains = { twoPoint: 999 }; }],
    ['hidden unvalidated availability', report => { report.availability = { availableDays: 7, conditionBefore: 100, conditionAfter: 100 }; }],
  ])('rejects %s after the same object previously validated', (_label, damage) => {
    const changed = structuredClone(opening);
    validateSeasonState(changed);
    damage(changed.academy.weeks[summarizedWeek].players[summarizedId]);
    expect(() => validateSeasonState(changed)).toThrow();
    expect(() => parseSeason(currentSeasonFile(changed))).toThrow();
  });

  it.each([
    ['missing player', state => { delete state.academy.weeks[summarizedWeek].players[summarizedId]; }],
    ['missing interval', state => { state.academy.weeks.splice(summarizedWeek, 1); }],
    ['repeated interval', state => { state.academy.weeks.splice(summarizedWeek, 0, structuredClone(state.academy.weeks[summarizedWeek])); }],
    ['missing staff evidence', state => { delete state.academy.weeks[summarizedWeek].coaches[opening.academy.weeks[summarizedWeek].players[summarizedId].clubId]; }],
  ])('rejects %s rather than treating a summary as an accepted historical seal', (_label, damage) => {
    const changed = structuredClone(opening);
    damage(changed);
    expect(() => parseSeason(currentSeasonFile(changed))).toThrow();
  });

  it('requires detailed reports for the historical managed club', () => {
    const changed = structuredClone(opening), week = changed.academy.weeks[0];
    const id = Object.keys(week.players).find(id => week.players[id].clubId === changed.managedClubId);
    expect(id).toBeDefined();
    week.players[id] = outcome(week.players[id]);
    expect(() => parseSeason(currentSeasonFile(changed))).toThrow();
  });

  it('requires detailed reports for the current season and the latest retained report', () => {
    const current = structuredClone(complete), previous = structuredClone(opening);
    for (const [state, week] of [[current, current.academy.weeks[0]], [previous, previous.academy.weeks.at(-1)]]) {
      const id = Object.keys(week.players).find(id => week.players[id].clubId !== state.managedClubId);
      expect(id).toBeDefined();
      week.players[id] = outcome(week.players[id]);
      expect(() => parseSeason(currentSeasonFile(state))).toThrow();
    }
  });

  it('checks the complete original report before a legacy import discards derived detail', () => {
    const changed = structuredClone(oldOpening);
    changed.state.academy.weeks[summarizedWeek].players[summarizedId].coachingGains.twoPoint += 1;
    expect(() => parseSeason(JSON.stringify(changed))).toThrow();
  });

  it('does not allow outcome records to masquerade as format-41 reports', () => {
    const changed = structuredClone(oldOpening);
    const report = changed.state.academy.weeks[summarizedWeek].players[summarizedId];
    changed.state.academy.weeks[summarizedWeek].players[summarizedId] = outcome(report);
    expect(() => parseSeason(JSON.stringify(changed))).toThrow();
  });
});

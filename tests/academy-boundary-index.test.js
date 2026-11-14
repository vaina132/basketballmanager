import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { academyAtBoundary, createAcademy } from '../src/world/academy';
import { emptyAcademyPoints } from '../src/world/academy-policy';
import { roundKey } from '../src/world/career-world';
import { withCalculationCache } from '../src/world/pure-cache';

const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/season40-board-opening.json.gz', import.meta.url))).toString('utf8')).state.academy;

// The original exhaustive selector, retained as an independent reference for the indexing optimization.
function reference(academy, season, round, contracts, intakeCount = academy.intakes.length) {
  const at = roundKey(season, round);
  if (!academy.enabledSince || roundKey(academy.enabledSince.seasonNumber, academy.enabledSince.round) > at) return createAcademy();
  const intakes = academy.intakes.slice(0, intakeCount).filter(row => roundKey(row.seasonNumber, row.round) <= at);
  const retained = new Set(intakes.flatMap(row => row.prospectIds));
  const prospects = academy.prospects.filter(row => roundKey(row.intakeSeason, row.intakeRound) <= at && retained.has(row.player.id));
  const ids = new Set(prospects.map(row => row.player.id));
  const weeks = academy.weeks.filter(row => roundKey(row.seasonNumber, row.afterRound) < at);
  const points = Object.fromEntries(prospects.map(row => [row.player.id, emptyAcademyPoints()]));
  for (const week of weeks) for (const [id, report] of Object.entries(week.players)) if (ids.has(id)) points[id] = { ...report.pointsAfter };
  const graduates = academy.graduates.filter(row => roundKey(row.availableSince.seasonNumber, row.availableSince.round) <= at && (row.kind === 'age-out' || contracts === undefined || Number(row.contractId?.replace('employment-contract-', '')) <= contracts));
  return { ...academy, intakes, prospects, weeks, points, focus: Object.fromEntries(prospects.map(row => [row.player.id, academy.focus[row.player.id]])), graduates: graduates.filter(row => ids.has(row.prospectId)) };
}

describe('academy historical boundary index', () => {
  it('preserves every historical boundary, same-day intake prefix and contract-dependent promotion', () => {
    expect(fixture.weeks.length).toBeGreaterThan(1);
    expect(fixture.graduates.length).toBeGreaterThan(0);
    const boundaries = [[1, 1], ...fixture.weeks.flatMap(row => [[row.seasonNumber, row.afterRound], [row.seasonNumber, row.afterRound + 1]]), [2, 1]];
    withCalculationCache(() => {
      for (const [year, round] of boundaries) for (const contracts of [0, 1, undefined]) for (const intakeCount of [0, 1, fixture.intakes.length]) {
        expect(academyAtBoundary(fixture, year, round, contracts, intakeCount)).toEqual(reference(fixture, year, round, contracts, intakeCount));
      }
    });
  });

  it('does not silently sort duplicate or out-of-order reports before their validation', () => {
    const changed = structuredClone(fixture);
    changed.weeks.reverse();
    changed.weeks.push(structuredClone(changed.weeks[0]));
    withCalculationCache(() => {
      for (const round of [1, 3, 7, 10]) expect(academyAtBoundary(changed, 1, round)).toEqual(reference(changed, 1, round));
    });
  });

  it('returns independent point maps and arrays even when a boundary is reused', () => {
    withCalculationCache(() => {
      const first = academyAtBoundary(fixture, 2, 1);
      const id = Object.keys(first.points)[0];
      first.points[id].twoPoint = -99;
      first.prospects.length = 0;
      first.weeks.length = 0;
      first.intakes.length = 0;
      first.focus[id] = 'invalid';
      expect(academyAtBoundary(fixture, 2, 1)).toEqual(reference(fixture, 2, 1));
    });
  });

  it('does not reuse a previous validation after the caller changes the same academy object', () => {
    const changed = structuredClone(fixture);
    withCalculationCache(() => academyAtBoundary(changed, 2, 1));
    const report = Object.values(changed.weeks.at(-1).players)[0];
    report.pointsAfter.twoPoint += 1;
    withCalculationCache(() => expect(academyAtBoundary(changed, 2, 1)).toEqual(reference(changed, 2, 1)));
    expect(academyAtBoundary(changed, 2, 1)).toEqual(reference(changed, 2, 1));
  });
});

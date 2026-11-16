import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseSeason } from '../src/storage/season-storage';
import { getClubAcademy } from '../src/world/academy-policy';
import { AcademyWorkspace } from '../src/ui/AcademyWorkspace';

const noop = () => {};
const render = season => renderToStaticMarkup(<AcademyWorkspace season={season} onEnableAcademy={noop} onEnableYouthCompetition={noop} onAcademyFocus={noop} onPromoteAcademy={noop} onWithdrawPromotion={noop} onOpenYouthCoach={noop} onOpenPlayer={noop} />);
let reduced, detailed;
beforeAll(() => {
  const text = gunzipSync(readFileSync(new URL('./fixtures/season41-board-opening.json.gz', import.meta.url))).toString('utf8');
  reduced = parseSeason(text);
  // Eligible full reports are still valid current state; restore the genuine source reports for presentation comparison.
  detailed = { ...reduced, academy: JSON.parse(text).state.academy };
});

it('preserves the actual academy workspace and latest report after migration', () => {
  // Format 73: the completed season is sealed (each prospect keeps its last report of the season).
  const reports = state => state.academy.weeks.reduce((count, week) => count + Object.keys(week.players).length, 0);
  expect(reports(reduced)).toBeLessThan(reports(detailed));
  const html = render(reduced);
  expect(html).toContain('Latest development report');
  expect(html).toContain('data-academy-coaching-gain=');
  expect(html).toBe(render(detailed));
});

it('keeps every club prospect latest full development report available to its player view', () => {
  for (const club of reduced.clubs) {
    const rows = getClubAcademy(reduced, club.id), before = getClubAcademy(detailed, club.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map(row => row.lastWeek?.player ?? null)).toEqual(before.map(row => row.lastWeek?.player ?? null));
  }
});

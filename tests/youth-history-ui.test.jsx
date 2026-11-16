import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseSeason } from '../src/storage/season-storage';
import { YouthResultReview } from '../src/ui/AcademyCompetition';
import { summarizeYouthFixture } from '../src/world/youth-history';

const noop = () => {};
const render = (season, fixture) => renderToStaticMarkup(<YouthResultReview season={season} fixture={fixture} onClose={noop} />);
let state, source, archived, full;
beforeAll(() => {
  const text = gunzipSync(readFileSync(new URL('./fixtures/season42-board-opening.json.gz', import.meta.url))).toString('utf8');
  source = JSON.parse(text).state;
  state = parseSeason(text);
  // Format 73 seals the completed season, so the format-43 outcome is projected from a genuine frozen snapshot of a
  // game in the opening week, whose academy points the sealed career still holds.
  const sealed = state.youthCompetition.seasons.flatMap(season => season.fixtures).find(fixture => fixture.detail === 'season' && fixture.result.played && fixture.round === 1);
  expect(sealed).toBeDefined();
  full = source.youthCompetition.seasons.flatMap(season => season.fixtures).find(fixture => fixture.id === sealed.id);
  archived = summarizeYouthFixture(full);
});

it('renders the same historical box score, player identities and MVP from an outcome and its genuine frozen snapshot', () => {
  const html = render(state, archived);
  expect(html).toBe(render(state, full));
  expect(html).toContain('Youth match box score');
  for (const player of full.home.players) {
    expect(html).toContain(`data-youth-box-player="${player.id}"`);
    expect(html).toContain(player.name);
  }
  expect(html).toContain('PIR');
  expect(html).not.toContain('No play took place');
});

it('never invents a box score or MVP for an explicitly unplayed outcome', () => {
  // Presentation-only fixture: an awarded result retains both original squad lists despite empty statistics.
  const result = { kind: 'no-contest', played: false, score: { home: 0, away: 0 }, officialScore: { home: 0, away: 0 }, winnerClubId: null, periods: 0, stats: {}, injuries: [], reason: 'Both academies have fewer than five available players; no contest.' };
  const html = render(state, { ...archived, result });
  expect(html).toBe(render(state, { ...full, result }));
  expect(html).toContain('There are no player statistics or match MVP.');
  expect(html).not.toContain('data-youth-box-player=');
  expect(html).not.toContain('Youth match box score');
});

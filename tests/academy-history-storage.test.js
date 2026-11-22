import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSeason, serializeSeason, serializeSeasonCompact, validateSeasonState } from '../src/storage/season-storage';
import { sealCompletedHistory } from '../src/world/sealed-history';
import { advanceMatchday } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';

const original = name => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/season41-board-${name}.json.gz`, import.meta.url))).toString('utf8'));
// Independent description of the portable outcome fields; never copy the implementation's projection in a test.
const outcome = report => ({ detail: 'outcome', clubId: report.clubId, focus: report.focus, pointsAfter: { ...report.pointsAfter } });
// Independent description of a sealed completed season (format 73): every week stays with its identity and dates, each
// prospect's last report of the season stays in the week it was made, and only the season's final week keeps its staff.
function sealedWeeks(weeks) {
  const last = new Map();
  weeks.forEach((week, index) => { for (const id of Object.keys(week.players)) last.set(id, index); });
  return weeks.map((week, index) => ({ ...week, coaches: index === weeks.length - 1 ? week.coaches : {}, players: Object.fromEntries(Object.entries(week.players).filter(([id]) => last.get(id) === index)) }));
}
const rejected = state => {
  expect(() => validateSeasonState(state)).toThrow();
  expect(() => parseSeason(currentSeasonFile(state))).toThrow();
};
const positive = report => Object.keys(report.pointsAfter).find(key => report.pointsAfter[key] > 0);
let opening, complete, live, oldOpening, oldComplete, summarizedId, summarizedWeek, finalWeek, rivalId, ownId;
beforeAll(() => {
  oldOpening = original('opening');
  oldComplete = original('complete');
  // Season two's opening: season one is a completed, sealed season. A week later the current season has its own report.
  opening = parseSeason(JSON.stringify(oldOpening));
  complete = parseSeason(JSON.stringify(oldComplete));
  live = advanceMatchday(opening);
  // An older rival report of the completed season, chosen from the genuine format-41 source.
  const weeks = oldOpening.state.academy.weeks;
  summarizedWeek = weeks.findIndex((week, index) => index < weeks.length - 1 && Object.values(week.players).some(report => report.clubId !== oldOpening.state.managedClubId));
  expect(summarizedWeek).toBeGreaterThanOrEqual(0);
  summarizedId = Object.keys(weeks[summarizedWeek].players).find(id => weeks[summarizedWeek].players[id].clubId !== oldOpening.state.managedClubId);
  // Reports kept in the sealed season: a rival prospect's and a prospect of the manager's club, both with points earned.
  finalWeek = opening.academy.weeks.findLastIndex(week => week.seasonNumber === 1);
  const kept = opening.academy.weeks[finalWeek].players;
  rivalId = Object.keys(kept).find(id => kept[id].clubId !== opening.managedClubId && positive(kept[id]));
  ownId = Object.keys(kept).find(id => kept[id].clubId === opening.managedClubId && positive(kept[id]));
  expect([rivalId, ownId].every(Boolean)).toBe(true);
}, 120_000);

// Format 73 (step 3.7): completed seasons are sealed at rollover and on import. Their academy weeks keep each prospect's
// last report of the season and the final week's staff, and the strict check verifies them by shape and by the season-end
// points the next season starts from. The current season's reports are still replayed exactly.
describe('sealed academy history (format 73)', () => {
  it('keeps every week, each prospect\'s last report of a completed season and only the final week\'s staff', () => {
    const weeks = oldOpening.state.academy.weeks;
    expect(weeks.every(week => week.seasonNumber === 1)).toBe(true);
    expect(opening.academy.weeks).toEqual(sealedWeeks(weeks));
    expect(opening.academy.weeks.filter(week => Object.keys(week.coaches).length)).toHaveLength(1);
    // Each kept report holds the prospect's development points at the season end, which season two starts from.
    const kept = opening.academy.weeks.flatMap(week => Object.entries(week.players));
    expect(kept.length).toBe(new Set(kept.map(([id]) => id)).size);
    for (const [id, report] of kept) expect(opening.academy.points[id]).toEqual(report.pointsAfter);
  });

  it('keeps the same record of a season once it is no longer the latest completed one', () => {
    const completed = live.academy.weeks.filter(week => week.seasonNumber === 1).length;
    const later = sealCompletedHistory({ ...live, seasonNumber: live.seasonNumber + 1 });
    expect(later.academy.weeks.slice(0, completed)).toEqual(live.academy.weeks.slice(0, completed));
  });

  it('validates, exports and reloads a sealed season and the current season beside it without changing them', () => {
    for (const state of [opening, live]) {
      const before = JSON.stringify(state);
      validateSeasonState(state);
      expect(parseSeason(serializeSeason(state))).toEqual(state);
      expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
      expect(JSON.stringify(state)).toBe(before);
    }
  });

  it('accepts a sealed report either in full or as its outcome', () => {
    const summarized = structuredClone(opening), week = summarized.academy.weeks[finalWeek];
    week.players[rivalId] = outcome(week.players[rivalId]);
    expect(parseSeason(currentSeasonFile(summarized))).toEqual(summarized);
  });

  it.each([
    ['lowered development total', report => { report.pointsAfter[positive(report)] -= 1; }],
    ['development total beyond the prospect\'s limit', report => { report.pointsAfter.passing = 1_000_000; }],
    ['missing development attribute', report => { delete report.pointsAfter.passing; }],
    ['invented development attribute', report => { report.pointsAfter.invented = 0; }],
    ['unsupported instruction', report => { report.focus = 'invented-focus'; }],
    ['changed owner', report => { report.clubId = report.clubId === opening.managedClubId ? 'aegean-waves' : opening.managedClubId; }],
    ['unknown report version', report => { report.detail = 'future-outcome'; }],
    ['hidden unvalidated field', report => { report.invented = 0; }],
  ])('rejects a sealed report with %s after the same object previously validated', (_label, damage) => {
    for (const id of [rivalId, ownId]) {
      const changed = structuredClone(opening);
      validateSeasonState(changed);
      damage(changed.academy.weeks[finalWeek].players[id]);
      rejected(changed);
    }
  });

  it.each([
    ['hidden unvalidated gains', report => { report.gains = { twoPoint: 999 }; }],
    ['hidden unvalidated availability', report => { report.availability = { availableDays: 7, conditionBefore: 100, conditionAfter: 100 }; }],
    ['lowered development total', report => { report.pointsAfter[positive(report)] -= 1; }],
    ['missing outcome field', report => { delete report.focus; }],
  ])('rejects a sealed outcome record with %s', (_label, damage) => {
    const changed = structuredClone(opening), week = changed.academy.weeks[finalWeek];
    week.players[rivalId] = outcome(week.players[rivalId]);
    damage(week.players[rivalId]);
    rejected(changed);
  });

  it.each([
    ['missing last report', state => { delete state.academy.weeks[finalWeek].players[rivalId]; }],
    ['missing interval', state => { state.academy.weeks.splice(summarizedWeek, 1); }],
    ['repeated interval', state => { state.academy.weeks.splice(summarizedWeek, 0, structuredClone(state.academy.weeks[summarizedWeek])); }],
    ['moved interval dates', state => { state.academy.weeks[summarizedWeek].fromDate = '2020-01-01'; }],
    ['malformed staff record', state => { const week = state.academy.weeks[finalWeek]; week.coaches[Object.keys(week.coaches)[0]] = { coachId: 'invented-coach' }; }],
    ['report of an unknown prospect', state => { const week = state.academy.weeks[finalWeek]; week.players['invented-prospect'] = structuredClone(week.players[rivalId]); }],
    ['report before the prospect\'s intake', state => {
      const later = state.academy.prospects.find(prospect => prospect.intakeSeason === 2), week = state.academy.weeks[finalWeek];
      expect(later).toBeDefined();
      week.players[later.player.id] = { ...structuredClone(week.players[rivalId]), clubId: later.clubId };
    }],
  ])('rejects a sealed season with a %s', (_label, damage) => {
    const changed = structuredClone(opening);
    damage(changed);
    rejected(changed);
  });

  it('rebuilds the latest completed season\'s board history beside its sealed academy weeks', () => {
    const reviews = opening.board.reviews;
    expect(reviews.some(review => review.seasonNumber === 1)).toBe(true);
    // Only the latest review lists each club's counted games.
    expect(reviews.slice(0, -1).every(review => Object.values(review.clubs).every(club => club.fixtureIds === undefined))).toBe(true);
    const confidence = structuredClone(opening), review = confidence.board.reviews.find(item => item.seasonNumber === 1 && item.round > 1);
    const club = Object.values(review.clubs)[0];
    club.confidence = club.confidence >= 50 ? club.confidence - 1 : club.confidence + 1;
    rejected(confidence);
    const counted = structuredClone(opening);
    for (const item of Object.values(counted.board.reviews[0].clubs)) item.fixtureIds = [];
    rejected(counted);
  });
});

describe('current-season academy reports (format 73)', () => {
  it.each([
    ['changed development gains', report => { const key = Object.keys(report.gains)[0]; report.gains[key] += 1; }],
    ['changed prior points', report => { const key = Object.keys(report.pointsBefore)[0]; report.pointsBefore[key] += 1; }],
    ['changed availability', report => { report.availability.availableDays -= 1; }],
    ['changed instruction', report => { report.focus = report.focus === 'defense' ? 'passing' : 'defense'; }],
    ['outcome in place of the latest report', (report, week, id) => { week.players[id] = outcome(report); }],
  ])('replays the week after a sealed season exactly: rejects %s', (_label, damage) => {
    const latest = live.academy.weeks.length - 1;
    expect(live.academy.weeks[latest].seasonNumber).toBe(live.seasonNumber);
    for (const id of [rivalId, ownId]) {
      const changed = structuredClone(live), week = changed.academy.weeks[latest];
      validateSeasonState(changed);
      damage(week.players[id], week, id);
      rejected(changed);
    }
  });

  it('replays the current season from the sealed season-end points and its staff', () => {
    const lowered = structuredClone(live), report = lowered.academy.weeks[finalWeek].players[rivalId];
    report.pointsAfter[positive(report)] -= 1;
    rejected(lowered);
    const staff = structuredClone(live);
    staff.academy.weeks.at(-1).coaches = {};
    rejected(staff);
  });

  it('accepts an older rival report of the current season in full or as its verified outcome', () => {
    const week = complete.academy.weeks.findIndex(item => Object.values(item.players).some(report => report.detail === 'outcome'));
    const id = Object.keys(complete.academy.weeks[week].players).find(key => complete.academy.weeks[week].players[key].detail === 'outcome');
    expect(id).toBeDefined();
    expect(complete.academy.weeks[week].players[id]).toEqual(outcome(oldComplete.state.academy.weeks[week].players[id]));
    const detailed = structuredClone(complete);
    detailed.academy.weeks[week].players[id] = structuredClone(oldComplete.state.academy.weeks[week].players[id]);
    expect(parseSeason(currentSeasonFile(detailed))).toEqual(detailed);
  });

  it.each([
    ['changed development total', report => { report.pointsAfter[positive(report)] -= 1; }],
    ['changed instruction', report => { report.focus = report.focus === 'defense' ? 'passing' : 'defense'; }],
    ['hidden unvalidated gains', report => { report.gains = { twoPoint: 999 }; }],
    ['missing outcome marker', report => { delete report.detail; }],
  ])('rejects a current-season outcome record with %s after the same object previously validated', (_label, damage) => {
    const changed = structuredClone(complete);
    validateSeasonState(changed);
    const week = changed.academy.weeks.find(item => Object.values(item.players).some(report => report.detail === 'outcome' && positive(report)));
    damage(Object.values(week.players).find(report => report.detail === 'outcome' && positive(report)));
    rejected(changed);
  });

  it('requires full reports for the managed club and for each club\'s latest report of the current season', () => {
    const own = structuredClone(complete), early = own.academy.weeks[0];
    const ownReport = Object.keys(early.players).find(id => early.players[id].clubId === own.managedClubId);
    expect(ownReport).toBeDefined();
    early.players[ownReport] = outcome(early.players[ownReport]);
    rejected(own);
    for (const state of [structuredClone(complete), structuredClone(live)]) {
      const week = state.academy.weeks.at(-1), id = Object.keys(week.players).find(key => week.players[key].clubId !== state.managedClubId);
      week.players[id] = outcome(week.players[id]);
      rejected(state);
    }
  });
});

describe('format-41 academy reports before migration', () => {
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

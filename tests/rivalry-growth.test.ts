import type { CareerMove } from '../src/domain/career';
import { BEFORE_SAVED_IDEAS, beforeSavedIdeas } from './helpers/legacy-season';
import { withLegacyFacilities } from './helpers/legacy-season';
import { asCareer1 } from './helpers/career-rules';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { GrownRivalry, SeasonRivalries } from '../src/domain/rivalries';
import type { RosterSnapshot } from '../src/domain/roster';
import type { ArchivedFixture, SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { forecastGate } from '../src/world/finance';
import { overallRating } from '../src/world/overall-rating';
import { governingDerby } from '../src/world/rivalries';
import { computeRivalryTables, rivalryChanges, RIVALRY_GROWTH_RULES, type RivalryGrowthContext } from '../src/world/rivalry-growth';
import { createSeason, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { BoardPanel } from '../src/ui/BoardPanel';
import { getInboxItems } from '../src/ui/inbox-items';
import { rivalryReasonText } from '../src/ui/rivalry-text';
import { advanceMatchday, playFirstSeason } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';

const RHINE = 'rhine-falcons', AEGEAN = 'aegean-waves', ALPINE = 'alpine-stags', PILOTS = 'atlantic-pilots';
let serial = 0;
/** A recorded game; `margin` is the winner's lead, `periods` above 4 means overtime. */
function game(home: string, away: string, homeWins: boolean, margin: number, fields: Partial<ArchivedFixture> = {}, periods = 4): ArchivedFixture {
  serial += 1;
  const score = homeWins ? { home: 80 + margin, away: 80 } : { home: 80, away: 80 + margin };
  return { id: `g${serial}`, round: 1, date: '2027-05-01', homeClubId: home, awayClubId: away, ...fields, result: { score, officialScore: { ...score }, winnerClubId: homeWins ? home : away, kind: 'normal', periods, stats: null, rosterIds: { home: '', away: '' }, injuries: {} } };
}
const final = (home: string, away: string, results: boolean[], margin = 9) => results.map((homeWins, index) => game(home, away, homeWins, margin, { stage: 'final', seriesId: 'final', game: index + 1 }));
const context = (seasons: ArchivedFixture[][], extra: Partial<RivalryGrowthContext> = {}, world: CareerWorld = DEVELOPMENT_WORLD): RivalryGrowthContext => ({
  world, seasonNumber: seasons.length + 1, history: seasons.map((fixtures, index) => ({ seasonNumber: index + 1, fixtures, rosters: [] })) as unknown as SeasonState['history'], rosters: [], ...extra,
});
const pair = (table: { rivalries: GrownRivalry[] }, a: string, b: string) => table.rivalries.find(item => item.clubIds.includes(a) && item.clubIds.includes(b));
const grown = (seasons: SeasonRivalries['seasons']): SeasonRivalries => ({ model: 'rivalries-2', enabledSince: { seasonNumber: 1, round: 1, date: '2026-09-26', completedRounds: 0, effectiveFrom: { seasonNumber: 1, round: 1 } }, seasons });

describe('rivalries grown from results', () => {
  it('starts real worlds empty and the fictional league from its designed rivalries, as lasting bases', () => {
    const [opening] = computeRivalryTables(context([]));
    expect(opening!.rivalries.map(item => [item.clubIds, item.intensity])).toEqual([[['adriatic-comets', 'aegean-waves'], 50], [['alpine-stags', 'atlantic-pilots'], 35], [['danube-lynx', 'rhine-falcons'], 75]]);
    expect(computeRivalryTables(context([], {}, { ...DEVELOPMENT_WORLD, rivalries: [] }))[0]!.rivalries).toEqual([]);
    // Without games the designed rivalries keep their base level.
    expect(computeRivalryTables(context([[], [], []]))[3]!.rivalries.map(item => item.intensity)).toEqual([50, 35, 75]);
  });

  it('turns a close playoff final, close games and a title race into a rivalry, with each reason recorded', () => {
    const season = [...final(RHINE, AEGEAN, [true, false, true, false, true]), game(RHINE, AEGEAN, true, 2), game(AEGEAN, RHINE, true, 1, {}, 5)];
    const entry = pair(computeRivalryTables(context([season]))[1]!, RHINE, AEGEAN)!;
    expect(entry.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'series', stage: 'final', wins: [2, 3], close: true, points: 40 }),
      expect.objectContaining({ kind: 'close-games', games: 2, overtime: 1, points: 5 }),
      expect.objectContaining({ kind: 'title-race', gap: 0, points: 10 }),
    ]));
    expect(entry.reasons.length).toBe(RIVALRY_GROWTH_RULES.reasons);
    // Seven meetings add the capped repeated-meetings points too; the strongest three reasons are kept.
    expect(entry.intensity).toBe(40 + 5 + 10 + 4);
    expect(entry.reasons.map(reason => reason.kind)).toEqual(['series', 'title-race', 'close-games']);
  });

  it('fades season by season without meaningful games until the rivalry lapses', () => {
    const tables = computeRivalryTables(context([final(RHINE, AEGEAN, [true, false, true]), [], [], []]));
    expect(tables.map(table => pair(table, RHINE, AEGEAN)?.intensity ?? null)).toEqual([null, 40, 34, null, null]);
    const repeated = computeRivalryTables(context([final(RHINE, AEGEAN, [true, true]), final(AEGEAN, RHINE, [true, true])]));
    expect(pair(repeated[2]!, RHINE, AEGEAN)!.intensity).toBe(Math.floor(30 * 85 / 100) + 30);
  });

  it('links the club left before unemployment to the next club, as a direct move does (format 72)', () => {
    const left = { seasonNumber: 1, date: '2026-11-28', fromClubId: ALPINE, toClubId: '', reason: 'dismissed' as const, ledgerCount: 0, round: 9, phase: 'season' as const };
    const joined = { seasonNumber: 2, date: '2027-10-02', fromClubId: '', toClubId: PILOTS, reason: 'appointed' as const, ledgerCount: 0, round: 2, phase: 'season' as const };
    const tables = (moves: CareerMove[]) => computeRivalryTables({ ...context([[], []]), career: { model: 'career-3', enabledSince: null, moves } });
    // Leaving for unemployment links nothing; the appointment a season later strengthens the designed Summit rivalry.
    const linked = tables([left, { ...joined, formerClubId: ALPINE }]);
    expect(pair(linked[1]!, ALPINE, PILOTS)!.intensity).toBe(35);
    expect(pair(linked[2]!, ALPINE, PILOTS)).toMatchObject({ intensity: 35 + RIVALRY_GROWTH_RULES.managerMove, reasons: expect.arrayContaining([expect.objectContaining({ kind: 'manager-move', seasonNumber: 2, fromClubId: ALPINE, toClubId: PILOTS, points: RIVALRY_GROWTH_RULES.managerMove })]) });
    // The same table as a direct move between the two clubs in that season.
    expect(linked).toEqual(tables([{ ...joined, fromClubId: ALPINE, reason: 'moved' }]));
    // Appointments recorded before format 72 carry no former club and keep the original rule.
    expect(pair(tables([left, joined])[2]!, ALPINE, PILOTS)!.intensity).toBe(35);
  });

  it('counts the manager and star players moving between clubs, and same-country European meetings', () => {
    const rhine = DEVELOPMENT_WORLD.clubs.find(club => club.id === RHINE)!, aegean = DEVELOPMENT_WORLD.clubs.find(club => club.id === AEGEAN)!;
    const star = [...rhine.players].sort((a, b) => overallRating(b.attributes, b.position) - overallRating(a.attributes, a.position))[0]!;
    const roster = (clubId: string, players: typeof rhine.players, season: number): RosterSnapshot => ({ id: `roster-s${season}-${clubId}-r1`, clubId, fromRound: 1, players });
    const history = [{ seasonNumber: 1, fixtures: [], rosters: [roster(RHINE, rhine.players, 1), roster(AEGEAN, aegean.players, 1)] }] as unknown as SeasonState['history'];
    const moves = [{ seasonNumber: 1, date: '2027-06-01', fromClubId: ALPINE, toClubId: PILOTS, reason: 'moved' as const, ledgerCount: 0 }];
    const tables = computeRivalryTables({ world: DEVELOPMENT_WORLD, seasonNumber: 2, history, rosters: [roster(RHINE, rhine.players.filter(player => player.id !== star.id), 2), roster(AEGEAN, [...aegean.players, star], 2)], career: { model: 'career-1', enabledSince: null, moves } });
    // A single star move is a reason but not yet a rivalry; the manager's move strengthens the designed Summit rivalry.
    expect(pair(tables[1]!, RHINE, AEGEAN)).toBeUndefined();
    const summit = pair(tables[1]!, ALPINE, PILOTS)!;
    expect(summit.intensity).toBe(35 + 15);
    expect(summit.reasons[1]).toMatchObject({ kind: 'manager-move', fromClubId: ALPINE, toClubId: PILOTS, points: 15 });
    expect(rivalryChanges(grown(tables), () => ALPINE)).toEqual([expect.objectContaining({ seasonNumber: 2, rivalId: PILOTS, change: 'intensified' })]);
    const again = computeRivalryTables({ world: DEVELOPMENT_WORLD, seasonNumber: 2, history: [{ ...history[0]!, fixtures: final(RHINE, AEGEAN, [true, true]) }], rosters: [roster(RHINE, rhine.players.filter(player => player.id !== star.id), 2), roster(AEGEAN, [...aegean.players, star], 2)] });
    expect(pair(again[1]!, RHINE, AEGEAN)!.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'star-move', playerId: star.id, name: star.name, fromClubId: RHINE, toClubId: AEGEAN, points: 10 })]));
    // Two clubs of one country meeting in Europe as well as at home.
    const spain: CareerWorld = { ...DEVELOPMENT_WORLD, domesticLeagues: [{ id: 'liga', name: 'Liga', country: 'Spain', tier: 1, clubIds: DEVELOPMENT_WORLD.clubs.map(club => club.id) }] };
    const european = [game(RHINE, AEGEAN, true, 12), game(AEGEAN, RHINE, true, 12), game(RHINE, AEGEAN, true, 12, { competition: 'euroleague' }), game(AEGEAN, RHINE, true, 12, { competition: 'euroleague' }), ...final(RHINE, AEGEAN, [true, true])];
    const meeting = pair(computeRivalryTables(context([european], {}, spain))[1]!, RHINE, AEGEAN)!;
    // Final 30, title race 10 (level on wins), two same-country European games 6, six meetings 3 (beyond the usual three).
    expect(meeting.intensity).toBe(30 + 10 + 6 + 3);
    expect(meeting.reasons).toEqual([expect.objectContaining({ kind: 'series', wins: [0, 2], close: false }), expect.objectContaining({ kind: 'title-race' }), expect.objectContaining({ kind: 'europe', games: 2, points: 6 })]);
  });

  it('plays a named rivalry with the derby effects on the existing 1-3 scale, within their limits', () => {
    const tables = computeRivalryTables(context([[...final(RHINE, AEGEAN, [true, false, true]), ...final(ALPINE, PILOTS, [true, false, true])]]));
    const rivalries = grown(tables);
    expect(governingDerby(rivalries, AEGEAN, RHINE, 2, 1, DEVELOPMENT_WORLD)).toMatchObject({ name: 'Rivalry', intensity: 1, origin: 'results' });
    expect(governingDerby(rivalries, ALPINE, PILOTS, 2, 1, DEVELOPMENT_WORLD)).toMatchObject({ id: 'summit-rivalry', name: 'Summit rivalry', intensity: 3 });
    expect(governingDerby(rivalries, 'danube-lynx', RHINE, 2, 1, DEVELOPMENT_WORLD)).toMatchObject({ id: 'river-derby', intensity: 3 });
    expect(governingDerby(rivalries, AEGEAN, 'danube-lynx', 2, 1, DEVELOPMENT_WORLD)).toBeNull();
    // Season one's table holds only the designed rivalries; switched-off rivalries never count.
    expect(governingDerby(rivalries, AEGEAN, RHINE, 1, 1, DEVELOPMENT_WORLD)).toBeNull();
    expect(governingDerby({ ...rivalries, enabledSince: null }, 'danube-lynx', RHINE, 2, 1, DEVELOPMENT_WORLD)).toBeNull();
    // The crowd grows 5% per step: a 50 rivalry is the second step (+10%).
    const state = createSeason({ seed: 227, managedClubId: RHINE, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS });
    const fixture = state.fixtures.find(item => item.homeClubId === RHINE && item.awayClubId === AEGEAN)!;
    const table = { seasonNumber: 1, rivalries: [...state.rivalries.seasons![0]!.rivalries, { clubIds: [AEGEAN, RHINE] as const, intensity: 50, reasons: [] }] };
    const plain = forecastGate(state, fixture, 4000), derby = forecastGate({ ...state, rivalries: { ...state.rivalries, seasons: [table] } }, fixture, 4000);
    expect(plain.attendance).toBeLessThan(plain.capacity);
    expect(derby.attendance / plain.attendance).toBeGreaterThan(1.09);
    expect(derby.attendance / plain.attendance).toBeLessThan(1.11);
  });
});

describe('grown rivalries in a career', () => {
  let opening: SeasonState, second: SeasonState;
  beforeAll(() => {
    opening = rolloverSeason(playFirstSeason(false));
    second = opening;
    for (let step = 0; step < 3; step += 1) second = advanceMatchday(second);
  }, 300_000);

  it('rebuilds the new season\'s table at the rollover from the completed season, and the save re-derives it', () => {
    expect(opening.rivalries.model).toBe('rivalries-2');
    expect(opening.rivalries.seasons!.map(table => table.seasonNumber)).toEqual([1, 2]);
    expect(opening.rivalries.seasons).toEqual(computeRivalryTables(opening));
    expect(parseSeason(serializeSeason(second))).toEqual(second);
    for (const review of second.board.reviews.filter(item => item.seasonNumber === 2)) for (const club of Object.values(review.clubs)) expect(Math.abs(club.rivalryImpact ?? 0)).toBeLessThanOrEqual(6);
  });

  it.each([
    ['a raised intensity', (copy: SeasonState) => { copy.rivalries.seasons![1]!.rivalries[0]!.intensity += 1; }],
    ['an invented rivalry', (copy: SeasonState) => { copy.rivalries.seasons![1]!.rivalries.push({ clubIds: ['adriatic-comets', 'rhine-falcons'], intensity: 40, reasons: [] }); }],
    ['a missing season table', (copy: SeasonState) => { copy.rivalries.seasons!.pop(); }],
  ])('rejects %s', (_label, mutate) => {
    const copy = structuredClone(second);
    mutate(copy);
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/);
  });

  it('shows the club\'s rivalries with intensity and reasons, and notes them in the inbox', () => {
    const table = { seasonNumber: second.seasonNumber, rivalries: [...second.rivalries.seasons![1]!.rivalries.filter(item => !item.clubIds.includes(AEGEAN)), { clubIds: [AEGEAN, RHINE] as const, intensity: 46, reasons: [{ kind: 'series' as const, seasonNumber: 1, stage: 'final' as const, competition: null, wins: [3, 2] as [number, number], score: null, close: true, points: 40 }] }].sort((a, b) => a.clubIds.join('|') < b.clubIds.join('|') ? -1 : 1) };
    const shown: SeasonState = { ...second, rivalries: { ...second.rivalries, seasons: [second.rivalries.seasons![0]!, table] } };
    const noop = () => {};
    const html = renderToStaticMarkup(createElement(BoardPanel, { season: shown, onEnable: noop, onEnableFunding: noop, onEnableConsequences: noop, onEnableRivalries: noop, onEnableCareerMoves: noop }));
    expect(html).toContain(`data-board-rival="${AEGEAN}"`);
    expect(html).toContain('data-rivalry-intensity="46"');
    expect(html).toContain('Rivalry · 46/100');
    expect(html).toContain('2026/27 final, 3-2 series');
    expect(html).toContain('How rivalries grow');
    const inbox = getInboxItems(shown);
    expect(inbox.find(item => item.id === `rivalry-formed-2-${AEGEAN}`)).toMatchObject({ title: 'Rivalry formed · Aegean Waves', detail: 'Rivalry · 46/100 from 2027/28. Why: 2026/27 final, 3-2 series.', category: 'board' });
    expect(rivalryReasonText(shown, { kind: 'star-move', seasonNumber: 1, playerId: 'x', name: 'A. Star', fromClubId: RHINE, toClubId: AEGEAN, points: 10 })).toBe('2026/27: A. Star moved from Rhine Falcons to Aegean Waves');
  });
});

describe('older careers', () => {
  it('keep the fixed rivalries: a format-62 save loads and replays them, and rejects grown rivalries', () => {
    // A genuine format-62 career had no media record (format 67) either.
    const state = beforeSavedIdeas(createSeason({ seed: 227, managedClubId: RHINE, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, ...BEFORE_SAVED_IDEAS }));
    const file = JSON.parse(serializeSeason(state));
    file.formatVersion = 62; file.state.schemaVersion = 62;
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/requires format 68/);
    file.state.rivalries = { model: 'rivalries-1', enabledSince: state.rivalries.enabledSince };
    const loaded = parseSeason(JSON.stringify(file));
    expect(loaded.rivalries).toEqual({ model: 'rivalries-1', enabledSince: state.rivalries.enabledSince });
    expect(governingDerby(loaded.rivalries, 'danube-lynx', RHINE, 4, 1, DEVELOPMENT_WORLD)).toBe(DEVELOPMENT_WORLD.rivalries.find(item => item.id === 'river-derby'));
  });
});

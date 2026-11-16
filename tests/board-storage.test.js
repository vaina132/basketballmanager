import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd, stepMatch } from '../src/engine/match';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { createBoard, enableBoard, getBoardSummary } from '../src/world/board';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { enableFinance } from '../src/world/finance';
import { currentSeasonFile, expectedMigration } from './helpers/season-format';
import { expectValidOldSaveWeek } from './helpers/old-save-week';

const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
const upgrade = state => expectedMigration(state, 29);
const restore = state => parseSeason(serializeSeason(state));
const advance = state => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
const changed = (state, mutate) => { const copy = structuredClone(state); mutate(copy); return currentSeasonFile(copy); };
let legacy, enabled, next, initial, reviewed, grace, complete, opening, noFinance;
beforeAll(() => {
  legacy = parseSeason(fixture('season29-relationships-career'));
  enabled = enableBoard(legacy); next = advance(enabled);
  initial = createSeason(227, 'rhine-falcons', 'standard', true, true, true, true, null, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true);
  grace = advance(initial); reviewed = advance(advance(grace));
  complete = setEmploymentDelegation(reviewed, true);
  while (complete.status === 'active') complete = advance(complete);
  for (let count = 0; count < 80 && getMarketStartReason(complete); count += 1) complete = advanceMarket(complete);
  opening = rolloverSeason(complete);
  noFinance = enableBoard(createSeason(171, 'rhine-falcons', 'off', false, false, false, false), 'career');
}, 90_000);

describe('board objectives, dated review audit and genuine format29 compatibility', () => {
  // Match calibration and realistic injuries (sprint 4) changed the simulated results after this old save, so the week is
  // checked for what must hold under intended rule changes (tests/helpers/old-save-week.ts).
  it('preserves the entire original relationship-rich career and continues a valid week that follows the recorded matchday', () => {
    const original = JSON.parse(fixture('season29-relationships-career'));
    expect(original.formatVersion).toBe(29);
    expect(legacy).toEqual(upgrade(original.state));
    expect(legacy.relationships.events.some(event => event.type === 'talk')).toBe(true);
    expect(legacy.activeMatch.morale).toBeDefined();
    expectValidOldSaveWeek(legacy, advance(legacy), parseSeason(fixture('season29-relationships-career-next')));
    expect(restore(legacy)).toEqual(legacy);
  });
  it('preserves the independently captured offseason and year2 opening with board disabled', () => {
    const end = parseSeason(fixture('season29-relationships-complete'));
    expect(rolloverSeason(end)).toEqual(upgrade(JSON.parse(fixture('season29-relationships-opening')).state));
  });
  it('enables prospectively without changing the current prepared match or including its result', () => {
    expect(enabled.activeMatch).toBe(legacy.activeMatch);
    expect(enabled.board.mandates[0].startsRound).toBe(6);
    expect(stepMatch(restore(enabled).activeMatch)).toEqual(stepMatch(legacy.activeMatch));
    expect(next.board.reviews).toHaveLength(0);
    expect(restore(next)).toEqual(next);
    const review = advance(next);
    expect(review.board.reviews[0].round).toBe(6);
    expect(review.board.reviews[0].clubs[legacy.managedClubId].fixtureIds).toHaveLength(1);
    expect(restore(review)).toEqual(review);
  });
  it('recomputes every club review from exact results and preserves the initial grace period', () => {
    expect(grace.board.reviews[0].clubs[initial.managedClubId].resultsImpact).toBe(0);
    expect(reviewed.board.reviews).toHaveLength(3);
    expect(Object.keys(reviewed.board.reviews.at(-1).clubs)).toHaveLength(initial.clubs.length);
    for (const state of [initial, grace, reviewed]) expect(restore(state)).toEqual(state);
  });
  it('retains dated final assessment through offseason and refreshes objectives at rollover', () => {
    expect(complete.board.reviews).toHaveLength(10);
    expect(complete.board.reviews.at(-1).date).not.toBe(complete.date);
    expect(opening.board.mandates).toHaveLength(2);
    expect(opening.board.reviews).toEqual(complete.board.reviews);
    expect(getBoardSummary(opening).confidence).toBe(getBoardSummary(complete).confidence);
    for (const state of [complete, opening, advance(opening)]) expect(restore(state)).toEqual(state);
    expect(rolloverSeason(restore(complete))).toEqual(opening);
  });
  it('keeps an inactive financial objective inactive after later finance activation', () => {
    expect(noFinance.board.mandates[0].clubs[noFinance.managedClubId].startingUnpaid).toBeNull();
    const funded = enableFinance(advance(noFinance)), advanced = advance(funded);
    expect(advanced.board.reviews.at(-1).clubs[noFinance.managedClubId].unpaid).toBeNull();
    expect(restore(advanced)).toEqual(advanced);
  });
  it('assesses newly enabled finances only when the next annual mandate is set', () => {
    let end = enableFinance(advance(noFinance));
    while (end.status === 'active') end = advance(end);
    expect(end.board.reviews.at(-1).clubs[end.managedClubId].unpaid).toBeNull();
    const opening = rolloverSeason(end), after = advance(opening);
    expect(opening.board.mandates.at(-1).clubs[end.managedClubId].startingUnpaid).not.toBeNull();
    expect(after.board.reviews.at(-1).clubs[end.managedClubId].unpaid).not.toBeNull();
    expect(restore(after)).toEqual(after);
  });
  it('waits for the next opening when activated after the final matchday', () => {
    const end = parseSeason(fixture('season29-relationships-complete'));
    const activated = enableBoard(end);
    expect(activated.board.mandates).toHaveLength(0);
    expect(restore(activated)).toEqual(activated);
    expect(restore(rolloverSeason(activated))).toEqual(rolloverSeason(activated));
  });
  it('accepts harmless map key reordering without rewriting the original reviews', () => {
    const text = changed(reviewed, state => {
      state.board.mandates[0].clubs = Object.fromEntries(Object.entries(state.board.mandates[0].clubs).reverse());
      state.board.reviews[0].clubs = Object.fromEntries(Object.entries(state.board.reviews[0].clubs).reverse());
    });
    expect(parseSeason(text)).toEqual(reviewed);
  });
  it('rejects invented board metadata in a genuine format29 file', () => {
    const old = JSON.parse(fixture('season29-relationships-career'));
    old.state.board = createBoard();
    expect(() => parseSeason(JSON.stringify(old))).toThrow(/unsupported fields/);
  });

  const club = 'rhine-falcons';
  const cases = [
    ['unsupported model', () => initial, state => { state.board.model = 'board-2'; }],
    ['invented aggregate confidence', () => initial, state => { state.board.confidence = 100; }],
    ['disabled history', () => reviewed, state => { state.board.enabledSince = null; }],
    ['activation future date', () => enabled, state => { state.board.enabledSince.date = '2027-01-01'; }],
    ['retroactive activation', () => enabled, state => { state.board.enabledSince.includeCurrentRound = true; }],
    ['activation result prefix', () => enabled, state => { state.board.enabledSince.completedRounds -= 1; }],
    ['activation roster prefix', () => enabled, state => { state.board.enabledSince.rosterCount -= 1; }],
    ['split initial funding', () => initial, state => { state.board.enabledSince.ledgerCount = 1; state.board.mandates[0].ledgerCount = 1; }],
    ['missing mandate', () => initial, state => { state.board.mandates = []; }],
    ['duplicated mandate', () => initial, state => { state.board.mandates.push(state.board.mandates[0]); }],
    ['objective identity', () => initial, state => { state.board.mandates[0].id = 'board-mandate-9'; }],
    ['objective deadline', () => initial, state => { state.board.mandates[0].deadlineDate = '2026-12-31'; }],
    ['retroactive objective', () => enabled, state => { state.board.mandates[0].startsRound = 5; }],
    ['invented club', () => initial, state => { state.board.mandates[0].clubs.unknown = state.board.mandates[0].clubs[club]; }],
    ['frozen roster identity', () => initial, state => { state.board.mandates[0].clubs[club].rosterId = 'wrong-roster'; }],
    ['frozen squad rank', () => initial, state => { state.board.mandates[0].clubs[club].resourceRank += 1; }],
    ['lowered win target', () => initial, state => { state.board.mandates[0].clubs[club].targetWins -= 1; }],
    ['invented inherited debt', () => initial, state => { state.board.mandates[0].clubs[club].startingUnpaid = 1_000_000; }],
    ['missing review', () => reviewed, state => { state.board.reviews.splice(1, 1); }],
    ['duplicated review', () => reviewed, state => { state.board.reviews.push(state.board.reviews.at(-1)); }],
    ['review identity', () => reviewed, state => { state.board.reviews[0].id = 'board-review-9'; }],
    ['review wrong mandate', () => reviewed, state => { state.board.reviews[0].mandateId = 'board-mandate-9'; }],
    ['review reordered', () => reviewed, state => { state.board.reviews.reverse(); }],
    ['review future date', () => reviewed, state => { state.board.reviews[0].date = state.date; }],
    ['review missing cost boundary', () => reviewed, state => { state.board.reviews[0].ledgerCount -= 1; }],
    ['review future cost boundary', () => reviewed, state => { state.board.reviews[0].ledgerCount += 1; }],
    ['review result prefix', () => reviewed, state => { state.board.reviews[0].completedRounds -= 1; }],
    ['review unsupported field', () => reviewed, state => { state.board.reviews[0].dismissed = true; }],
    ['review fixture evidence', () => reviewed, state => { state.board.reviews[0].clubs[club].fixtureIds = []; }],
    ['review wins', () => reviewed, state => { state.board.reviews[0].clubs[club].wins += 1; }],
    ['review injury relief', () => reviewed, state => { state.board.reviews[0].clubs[club].injuryRelief += 1; }],
    ['review inherited cost evidence', () => reviewed, state => { state.board.reviews[0].clubs[club].unpaid += 1; }],
    ['review confidence', () => reviewed, state => { state.board.reviews[0].clubs[club].confidence += 1; }],
    ['review previous confidence', () => reviewed, state => { state.board.reviews[1].clubs[club].previousConfidence += 1; }],
    ['new season missing mandate', () => opening, state => { state.board.mandates.pop(); }],
    ['new season sponsor exclusion', () => opening, state => { state.board.mandates[1].ledgerCount = state.board.reviews.at(-1).ledgerCount; }],
  ];
  it.each(cases)('rejects %s', (_name, source, mutate) => {
    expect(() => parseSeason(changed(source(), mutate))).toThrow();
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonBoard } from '../src/domain/board';
import type { SeasonState } from '../src/domain/season';
import { getDevelopmentPresident } from '../src/data/development-presidents';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { boardEventAnchor, createBoard, enableBoardConsequences } from '../src/world/board';
import { BOARD_VERDICT_EFFECTS, boardConsequencesGovern, governingVerdict, ownerCapital, seasonVerdict, staffAllocation, verdictForConfidence } from '../src/world/board-consequences';
import { quoteBoardFunding } from '../src/world/board-funding-policy';
import { createSeason, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { remainingStaffBudget, STAFF_BUDGET, staffCommitted } from '../src/world/staff-policy';
import { playFirstSeason } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';

const verdictOf = (state: SeasonState, clubId: string) => seasonVerdict(state.board, clubId, 1, 10)!.verdict;
let complete: SeasonState, opening: SeasonState, legacyComplete: SeasonState, legacyOpening: SeasonState;

beforeAll(() => {
  complete = playFirstSeason(true);
  opening = rolloverSeason(complete);
  legacyComplete = playFirstSeason(false);
  legacyOpening = rolloverSeason(legacyComplete);
}, 240_000);

describe('board verdict rules', () => {
  it('uses the confidence labels already shown to the manager, with visible budget effects', () => {
    expect([80, 65, 64, 45, 44, 30, 29, 0].map(verdictForConfidence)).toEqual(['confident', 'confident', 'steady', 'steady', 'concerned', 'concerned', 'pressure', 'pressure']);
    expect(Object.fromEntries(Object.entries(BOARD_VERDICT_EFFECTS).map(([verdict, effect]) => [verdict, [effect.staffPercent, effect.capitalPercent]]))).toEqual({ confident: [110, 150], steady: [100, 100], concerned: [90, 50], pressure: [80, 0] });
  });

  it('changes nothing until consequences are on, and then only for later seasons', () => {
    const review = { id: 'board-review-10', seasonNumber: 1, round: 10, date: '2026-11-07', clubs: { 'alpine-stags': { confidence: 28 } } };
    const board = { ...createBoard(), reviews: [review] } as unknown as SeasonBoard;
    const anchor = { seasonNumber: 1, round: 4, date: '2026-09-26', completedRounds: 3, ledgerCount: 40, rosterCount: 6 };
    expect(staffAllocation({ board, seasonNumber: 2 }, 'alpine-stags')).toBe(STAFF_BUDGET);
    const governed = { board: { ...board, consequencesSince: anchor }, seasonNumber: 2 };
    expect(boardConsequencesGovern(governed.board, 1)).toBe(false);
    expect(staffAllocation(governed, 'alpine-stags', 1)).toBe(STAFF_BUDGET);
    expect(staffAllocation(governed, 'alpine-stags')).toBe(12_000_000);
    expect(ownerCapital(governed, 'alpine-stags')).toBe(0);
    // A club without a final review that season keeps the standard budgets.
    expect(staffAllocation(governed, 'rhine-falcons')).toBe(STAFF_BUDGET);
    expect(ownerCapital(governed, 'rhine-falcons')).toBe(getDevelopmentPresident('rhine-falcons').seasonCapital);
  });
});

describe('board verdicts in a career', () => {
  it("sets each club's next-season staff budget and owner capital from its final confidence", () => {
    const verdicts = new Set(opening.clubs.map(club => verdictOf(complete, club.id)));
    expect(verdicts.size).toBeGreaterThanOrEqual(2);
    for (const club of opening.clubs) {
      const effect = BOARD_VERDICT_EFFECTS[verdictOf(complete, club.id)];
      expect(governingVerdict(opening, club.id, 2)?.reviewId).toBe(complete.board.reviews.at(-1)!.id);
      expect(staffAllocation(opening, club.id)).toBe(STAFF_BUDGET * effect.staffPercent / 100);
      expect(ownerCapital(opening, club.id)).toBe(getDevelopmentPresident(club.id).seasonCapital * effect.capitalPercent / 100);
      expect(staffCommitted(opening, club.id)).toBeLessThanOrEqual(staffAllocation(opening, club.id));
      expect(quoteBoardFunding(opening, 'arena', club.id).seasonCapital).toBe(ownerCapital(opening, club.id));
      // The season that produced the verdict kept the standard budgets.
      expect(staffAllocation(complete, club.id)).toBe(STAFF_BUDGET);
    }
    expect(remainingStaffBudget(opening)).toBeLessThanOrEqual(staffAllocation(opening, 'rhine-falcons') - staffCommitted(opening, 'rhine-falcons'));
    expect(parseSeason(serializeSeason(opening))).toEqual(opening);
  });

  it('keeps standard budgets in older careers until switched on, effective from the next season', () => {
    for (const club of legacyOpening.clubs) expect(staffAllocation(legacyOpening, club.id)).toBe(STAFF_BUDGET);
    expect(legacyComplete.board.consequencesSince).toBeNull();
    // Switching on after the final review governs the next season by the verdict already given.
    const switched = enableBoardConsequences(legacyComplete);
    expect(switched.board.consequencesSince).toEqual(boardEventAnchor(legacyComplete));
    expect(parseSeason(serializeSeason(switched))).toEqual(switched);
    for (const club of switched.clubs) expect(staffAllocation(switched, club.id, 2)).toBe(staffAllocation(opening, club.id));
    // Switching on during a season leaves that season unchanged.
    const midSeason = enableBoardConsequences(legacyOpening);
    for (const club of midSeason.clubs) expect(staffAllocation(midSeason, club.id)).toBe(STAFF_BUDGET);
    expect(boardConsequencesGovern(midSeason.board, 3)).toBe(true);
    expect(enableBoardConsequences(midSeason)).toBe(midSeason);
    expect(() => enableBoardConsequences(createSeason({ seed: 3, finance: true }))).toThrow(/board reviews/);
  });

});

describe('board verdict validation', () => {
  it('rejects a staff total above a reduced budget when the save claims verdicts applied', () => {
    // The legacy career hired under standard budgets; backdating the switch would cut some of those budgets.
    const reduced = legacyOpening.clubs.filter(club => staffCommitted(legacyOpening, club.id) > staffAllocation(opening, club.id));
    expect(reduced.length).toBeGreaterThan(0);
    const tampered = structuredClone(legacyOpening);
    tampered.board.consequencesSince = { ...legacyOpening.board.mandates[0]! } as never;
    for (const key of ['id', 'startsRound', 'deadlineDate', 'clubs']) delete (tampered.board.consequencesSince as unknown as Record<string, unknown>)[key];
    expect(() => parseSeason(currentSeasonFile(tampered))).toThrow(/Invalid season save/);
  });

  it.each([
    ['a switch on a disabled board', (copy: SeasonState) => { copy.board = { ...createBoard(), consequencesSince: copy.board.consequencesSince }; }],
    ['an invented switch date', (copy: SeasonState) => { copy.board.consequencesSince = { ...copy.board.consequencesSince!, date: '2026-12-25' }; }],
    ['a switch before board reviews began', (copy: SeasonState) => { copy.board.enabledSince = { ...copy.board.enabledSince!, ...{ round: 2 } }; }],
  ])('rejects %s', (_label, mutate) => {
    const copy = structuredClone(opening);
    mutate(copy);
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/);
  });

  it('rejects the switch in a format-32 file', () => {
    // A genuine format-32 career had neither season verdicts, rivalries, upkeep choices nor club changes.
    const file = JSON.parse(serializeSeason(createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, boardConsequences: false, rivalries: false, facilityMaintenance: false, careerMoves: false })));
    file.formatVersion = 32; file.state.schemaVersion = 32;
    delete file.state.board.consequencesSince;
    delete file.state.rivalries;
    delete file.state.facilities.maintenanceSince;
    delete file.state.career;
    expect(() => parseSeason(JSON.stringify(file))).not.toThrow();
    file.state.board.consequencesSince = null;
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/unsupported fields/);
  });
});

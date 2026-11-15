import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { enableCareerMoves } from '../src/world/career';
import { managerReputation, REPUTATION_WEIGHTS, STARTING_REPUTATION, VACANCY_BASE_REQUIREMENT, VACANCY_STEP, vacancyRequirement } from '../src/world/career-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { setFacilityDelegation } from '../src/world/facilities';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, previewSeasonEnd } from '../src/world/season';
import { advanceMatchday } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';
import { getInboxItems } from '../src/ui/inbox-items';

const CLUB = 'rhine-falcons';
const finish = (state: SeasonState) => ({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch!, managedSide(state), true)) });
const start = (seed: number, careerMoves = true) => setEmploymentDelegation(setFacilityDelegation(createSeason({ seed, managedClubId: CLUB, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, careerMoves }), true), true);
/** An all-automatic Rhine Falcons season, played to the finished final match. */
function finalMatchday(seed: number, careerMoves = true, enableAtRound?: number): SeasonState {
  let state = start(seed, careerMoves);
  while (state.round < 10) {
    if (state.round === enableAtRound) state = enableCareerMoves(state);
    state = advanceMatchday(state);
  }
  return finish(state);
}
let sackedDay: SeasonState, sacked: SeasonState, changeDay: SeasonState, offeredDay: SeasonState;

beforeAll(() => {
  // Seed 67: Rhine Falcons end Under pressure (20); Atlantic Pilots are also Under pressure and need a coach.
  sackedDay = finalMatchday(67);
  sacked = advanceSeason(sackedDay);
  // Seed 35: Rhine Falcons are dismissed (29) and no other season ended Under pressure.
  changeDay = finalMatchday(35);
  // Seed 20: Rhine Falcons end steady (56) while Danube Lynx's season ends Under pressure.
  offeredDay = finalMatchday(20);
}, 240_000);

describe('dismissal at a season end', () => {
  it('previews the verdict, the vacancy and the offer before the final matchday is committed', () => {
    const outlook = previewSeasonEnd(sackedDay)!;
    expect(outlook).toMatchObject({ seasonNumber: 1, clubId: CLUB, dismissed: true, verdict: { verdict: 'pressure', confidence: 20 } });
    expect(outlook.reputation).toEqual({ value: 20, seasons: [{ seasonNumber: 1, clubId: CLUB, confidence: 20, weight: 3 }] });
    expect(outlook.vacancies).toEqual([{ clubId: 'atlantic-pilots', position: 5, requirement: 31, reason: 'pressure', confidence: 29 }]);
    // Below the requirement, a dismissed manager still receives the job asking for the least.
    expect(outlook.offers.map(offer => offer.clubId)).toEqual(['atlantic-pilots']);
  });

  it('moves a dismissed manager to the best offer when no choice was made, and saves it', () => {
    expect(sacked.managedClubId).toBe('atlantic-pilots');
    expect(sacked.career.moves).toEqual([expect.objectContaining({ seasonNumber: 1, fromClubId: CLUB, toClubId: 'atlantic-pilots', reason: 'dismissed' })]);
    expect(parseSeason(serializeSeason(sacked))).toEqual(sacked);
    expect(() => advanceSeason(sackedDay, { moveTo: 'danube-lynx' })).toThrow(/offered you its job/);
    expect(getInboxItems(sacked).find(item => item.id === 'career-move-1')).toMatchObject({ category: 'board', title: 'Dismissed by Rhine Falcons · now managing Atlantic Pilots', needsAction: false });
  });

  it('opens a vacancy at the least confident board when no other season ended Under pressure', () => {
    const outlook = previewSeasonEnd(changeDay)!;
    expect(outlook.dismissed).toBe(true);
    expect(outlook.vacancies).toEqual([expect.objectContaining({ clubId: 'alpine-stags', reason: 'change', confidence: 44 })]);
    expect(outlook.offers.map(offer => offer.clubId)).toEqual(['alpine-stags']);
    const moved = advanceSeason(changeDay);
    expect([moved.managedClubId, moved.career.moves[0]!.reason]).toEqual(['alpine-stags', 'dismissed']);
    expect(parseSeason(serializeSeason(moved))).toEqual(moved);
  });

  it('offers a successful manager a job without forcing a move', () => {
    const outlook = previewSeasonEnd(offeredDay)!;
    expect(outlook).toMatchObject({ dismissed: false, reputation: { value: 56 }, offers: [{ clubId: 'danube-lynx', requirement: VACANCY_BASE_REQUIREMENT }] });
    expect(advanceSeason(offeredDay).managedClubId).toBe(CLUB);
    const moved = advanceSeason(offeredDay, { moveTo: 'danube-lynx' });
    expect(moved.career.moves[0]!.reason).toBe('moved');
    expect(getInboxItems(moved).find(item => item.id === 'career-move-1')?.title).toBe('New job · Danube Lynx');
    expect(parseSeason(serializeSeason(moved))).toEqual(moved);
  });

  it('never dismisses while job changes are off, and only from the next season after an older career opts in', () => {
    expect(previewSeasonEnd(finalMatchday(67, false))).toBeNull();
    const optedIn = finalMatchday(67, false, 5);
    expect(optedIn.career.enabledSince).toMatchObject({ seasonNumber: 1, effectiveFrom: 2 });
    expect(previewSeasonEnd(optedIn)).toBeNull();
    const stayed = advanceSeason(optedIn);
    expect([stayed.managedClubId, stayed.career.moves]).toEqual([CLUB, []]);
    expect(parseSeason(serializeSeason(stayed))).toEqual(stayed);
  }, 120_000);

  it.each([
    ['a dismissal without a new club', (copy: SeasonState) => { copy.career.moves = []; copy.managedClubId = CLUB; }],
    ['a dismissal recorded as a voluntary move', (copy: SeasonState) => { copy.career.moves[0]!.reason = 'moved'; }],
  ])('rejects %s', (_label, mutate) => {
    const copy = structuredClone(sacked);
    mutate(copy);
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/);
  });
});

describe('careers saved in format 37, before dismissal existed', () => {
  it('keep a season that ended Under pressure without a move, and judge only later season ends', () => {
    // The format-37 runtime recorded the switch but never dismissed: the same season end, without a move.
    const stayed = { ...advanceSeason({ ...sackedDay, career: { ...sackedDay.career, enabledSince: null } }), career: sackedDay.career };
    const file = (version: number) => JSON.stringify({ format: 'basketball-manager-season', formatVersion: version, engineVersion: 'possession-3', state: { ...stayed, schemaVersion: version } });
    expect(() => parseSeason(file(38))).toThrow(/joined after the dismissal/);
    const migrated = parseSeason(file(37));
    expect([migrated.managedClubId, migrated.career.moves, migrated.career.enabledSince!.effectiveFrom]).toEqual([CLUB, [], 2]);
    const dismissal = JSON.parse(serializeSeason(sacked));
    dismissal.formatVersion = 37; dismissal.state.schemaVersion = 37;
    expect(() => parseSeason(JSON.stringify(dismissal))).toThrow(/supported reason/);
  });
});

describe('reputation and requirements', () => {
  it('weighs the last three final reviews of the clubs managed, most recent first', () => {
    const review = (seasonNumber: number, confidence: number) => ({ id: `r${seasonNumber}`, seasonNumber, round: 10, date: '2027-01-01', clubs: { [CLUB]: { confidence } } });
    const context = { managedClubId: CLUB, seasonNumber: 4, clubs: [], fixtures: [], history: [], board: { reviews: [review(1, 90), review(2, 30), review(3, 60), review(4, 80)] } } as unknown as SeasonState;
    expect(REPUTATION_WEIGHTS).toEqual([3, 2, 1]);
    expect(managerReputation(context).value).toBe(Math.round((80 * 3 + 60 * 2 + 30) / 6));
    expect(managerReputation({ ...context, board: { ...context.board, reviews: [] } }).value).toBe(STARTING_REPUTATION);
    expect([1, 6].map(position => vacancyRequirement(position, Array.from({ length: 6 }, (_, id) => ({ id: String(id) }))))).toEqual([VACANCY_BASE_REQUIREMENT + 5 * VACANCY_STEP, VACANCY_BASE_REQUIREMENT]);
  });
});

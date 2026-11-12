import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { TrainingWeekInput } from '../src/world/training';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { advanceSeason, createSeason, dateForRound, managedSide } from '../src/world/season';
import { enableFacilities, processFacilityProjects, startFacilityUpgrade } from '../src/world/facilities';
import { processTrainingWeek, trainingPointCap, TRAINING_ATTRIBUTES } from '../src/world/training';
import { processAcademyWeek } from '../src/world/academy';
import { getClubAcademy } from '../src/world/academy-policy';
import { getClubCashOutlook } from '../src/world/finance-outlook';
import { getFinanceBalance, ROUND_OPERATING_COST } from '../src/world/finance';

const clubId = 'rhine-falcons';
const total = (points: Record<string, number>) => Object.values(points).reduce((sum, value) => sum + value, 0);
const initial = () => enableFacilities(createSeason(227, clubId, 'off', true, true, true, true, null, true, false, true, false, false, false, false, false, true, true));
const advance = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });

/** Isolated daily-practice inputs; completion still goes through the project command. */
function practice(): TrainingWeekInput {
  const started = startFacilityUpgrade(initial(), 'training');
  const state = processFacilityProjects({ ...started, date: dateForRound(4), round: 4 });
  return {
    facilities: state.facilities, training: { ...state.training, plans: Object.fromEntries(Object.entries(state.training.plans).map(([id, plan]) => [id, { ...plan, delegated: false, intensity: 'standard' as const, focus: 'passing' as const }])) },
    coaching: state.coaching, clubs: state.clubs, conditions: Object.fromEntries(Object.keys(state.conditions).map(id => [id, 80])), injuries: [], seasonNumber: 1, afterRound: 4, fromDate: dateForRound(4), toDate: dateForRound(5),
  };
}

describe('facility effects on earned development', () => {
  it('adds to ordinary practice without multiplying coaching or changing condition', () => {
    const input = practice(), baseline = processTrainingWeek({ ...input, facilities: undefined }), upgraded = processTrainingWeek(input);
    const owned = input.clubs.find(club => club.id === clubId)!;
    expect(upgraded.conditions).toEqual(baseline.conditions);
    for (const player of owned.players) {
      const before = baseline.training.lastWeek!.players[player.id]!, after = upgraded.training.lastWeek!.players[player.id]!;
      expect(after.coachingGains).toEqual(before.coachingGains);
      expect(after.facility!.earnedPoints).toBe(1);
      expect(total(after.facility!.gains)).toBe(1);
      expect(total(after.gains)).toBe(total(before.gains) + 1);
      expect(after.facility!.gains.passing).toBe(1);
    }
  });

  it('never awards practice for rehabilitation or recovery sessions and attributes skill caps honestly', () => {
    const input = practice(), player = input.clubs.find(club => club.id === clubId)!.players[0]!;
    const injured = processTrainingWeek({ ...input, injuries: [{ id: 'injury-test', playerId: player.id, clubId, fixtureId: 'test', kind: 'ankle', occurredOn: input.fromDate, returnOn: dateForRound(6) }] });
    expect(injured.training.lastWeek!.players[player.id]).toMatchObject({ availableDays: 0, facility: { earnedPoints: 0 } });
    expect(total(injured.training.lastWeek!.players[player.id]!.gains)).toBe(0);
    const recovery = processTrainingWeek({ ...input, training: { ...input.training, plans: { ...input.training.plans, [clubId]: { ...input.training.plans[clubId]!, intensity: 'recovery' } } } });
    expect(recovery.training.lastWeek!.players[player.id]!.facility!.earnedPoints).toBe(0);
    const capped = processTrainingWeek({ ...input, training: { ...input.training, points: { ...input.training.points, [player.id]: Object.fromEntries(TRAINING_ATTRIBUTES.map(attribute => [attribute, trainingPointCap(player.attributes[attribute])])) as typeof input.training.points[string] } } });
    expect(capped.training.lastWeek!.players[player.id]!.facility!.earnedPoints).toBe(1);
    expect(total(capped.training.lastWeek!.players[player.id]!.facility!.gains)).toBe(0);
  });

  it('uses completion dates for daily practice, including a partial week', () => {
    const input = practice(), full = input.facilities!;
    const project = full.projects.find(project => project.clubId === clubId)!;
    // Four days at 4 points/day is less than one whole extra point at 5%.
    const late = { ...full, projects: full.projects.map(item => item.id === project.id ? { ...item, completedOn: '2026-09-30' } : item) };
    const actual = processTrainingWeek({ ...input, facilities: late });
    for (const player of input.clubs.find(club => club.id === clubId)!.players) expect(actual.training.lastWeek!.players[player.id]!.facility!.earnedPoints).toBe(0);
    const pending = processTrainingWeek({ ...input, facilities: { ...full, projects: full.projects.map(item => item.id === project.id ? { ...item, completedOn: null } : item) } });
    for (const player of input.clubs.find(club => club.id === clubId)!.players) expect(pending.training.lastWeek!.players[player.id]!.facility!.earnedPoints).toBe(0);
  });

  it('completes construction through real Continue boundaries and improves the following full academy week', () => {
    let state = startFacilityUpgrade(initial(), 'youth');
    const id = getClubAcademy(state)[0]!.player.id;
    for (let round = 1; round <= 3; round += 1) {
      state = advance(state);
      expect(state.academy.weeks.at(-1)!.players[id]!.facility!.earnedPoints).toBe(0);
    }
    expect(state.facilities.projects.find(project => project.clubId === clubId)).toMatchObject({ completedOn: dateForRound(4) });
    const outlook = getClubCashOutlook(state);
    expect(outlook.startCash).toBe(getFinanceBalance(state.finance, clubId).cash);
    expect(outlook.rows.reduce((sum, row) => sum + row.operations, 0)).toBe(7 * (ROUND_OPERATING_COST + 30_000));
    const input = { academy: state.academy, youth: state.youth, clubs: state.clubs, seasonNumber: 1, afterRound: 4, fromDate: state.date, toDate: dateForRound(5) };
    const baseline = processAcademyWeek(input);
    const next = advance(state), report = next.academy.weeks.at(-1)!.players[id]!;
    expect(report.facility!.earnedPoints).toBe(1);
    expect(total(report.facility!.gains)).toBe(1);
    expect(report.coachingGains).toEqual(baseline.weeks.at(-1)!.players[id]!.coachingGains);
    expect(total(report.gains)).toBe(total(baseline.weeks.at(-1)!.players[id]!.gains) + 1);
    expect(next.finance.ledger.find(entry => entry.clubId === clubId && entry.kind === 'facility-upkeep')).toMatchObject({ seasonNumber: 1, round: 4, amount: -30_000 });
    expect(getClubCashOutlook(next).rows.reduce((sum, row) => sum + row.operations, 0)).toBe(6 * (ROUND_OPERATING_COST + 30_000));
  });
});

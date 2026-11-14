import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getClubCashOutlook } from '../src/world/finance-outlook';
import { enableFitness, hireFitnessCoach, setFitnessRenewal } from '../src/world/fitness';
import { availableFitnessCoaches, getClubFitnessCoach, quoteFitnessHire } from '../src/world/fitness-policy';
import { getFinanceBalance } from '../src/world/finance';
import { quoteScoutHire } from '../src/world/scout-policy';
import { availableCoaches, hireCoach } from '../src/world/coaching';
import { remainingStaffBudget, STAFF_BUDGET, staffCommitmentsByRole, staffCommitted } from '../src/world/staff-policy';
import { advanceFitnessCareer, createFitnessCareers, fitnessClub as club, useHeavyTraining } from './helpers/fitness-careers';

const restore = state => parseSeason(serializeSeason(state));
let careers, injured, injuredHired, unavailableWeek, partialWeek;
beforeAll(() => {
  careers = createFitnessCareers();
  injured = useHeavyTraining(parseSeason(gunzipSync(readFileSync(new URL('./fixtures/season21-training-scouts.json.gz', import.meta.url))).toString('utf8')));
  injuredHired = hireFitnessCoach(enableFitness(injured), 'fitness-12');
  unavailableWeek = advanceFitnessCareer(injuredHired);
  partialWeek = advanceFitnessCareer(unavailableWeek);
}, 120_000);

describe('fitness coaching across actual career boundaries', () => {
  it('changes only future training when hired and records the fee once in cash and the outlook', () => {
    const { initial, hired } = careers;
    expect(hired.activeMatch).toEqual(initial.activeMatch);
    expect(stepMatch(hired.activeMatch)).toEqual(stepMatch(initial.activeMatch));
    expect(hired.training).toEqual(initial.training);
    expect(hired.finance.ledger.slice(initial.finance.ledger.length)).toMatchObject([{ kind: 'fitness', clubId: club, amount: -5_000_000, fitness: { coachId: 'fitness-12' } }]);
    const before = getClubCashOutlook(initial), after = getClubCashOutlook(hired);
    expect(before.startCash - after.startCash).toBe(5_000_000);
    expect(before.baseline.endBalance - after.baseline.endBalance).toBe(5_000_000);
    expect(after.rows.map(row => [row.wages, row.operations, row.transferOut])).toEqual(before.rows.map(row => [row.wages, row.operations, row.transferOut]));
    expect(restore(hired)).toEqual(hired);
  });

  it('reconciles the reported contribution with a real identical week without the managed coach', () => {
    const { reported, withoutCoach } = careers;
    expect(reported.fixtures).toEqual(withoutCoach.fixtures);
    const report = reported.training.lastWeek, baseline = withoutCoach.training.lastWeek;
    let benefited = 0;
    for (const player of reported.clubs.find(team => team.id === club).players) {
      const row = report.players[player.id], previous = baseline.players[player.id];
      expect(row.conditionBefore).toBe(previous.conditionBefore);
      expect(row.fitness.conditionWithoutCoach).toBe(previous.conditionAfter);
      expect(row.fitness.conditionBenefit).toBeCloseTo(row.conditionAfter - previous.conditionAfter, 3);
      expect(row.fitness.conditionBenefit).toBeGreaterThanOrEqual(0);
      expect(row.fitness.conditionBenefit).toBeLessThanOrEqual(14);
      expect(reported.conditions[player.id]).toBe(row.conditionAfter);
      expect(row.conditionAfter).toBeLessThanOrEqual(100);
      if (row.fitness.conditionBenefit > 0) benefited++;
    }
    expect(benefited).toBeGreaterThan(0);
  });

  it('preserves a completed week through release and replacement, with no refunded or duplicated fees', () => {
    const { reported, released, replaced, replacementWeek } = careers;
    expect(released.finance).toEqual(reported.finance);
    expect(released.training).toEqual(reported.training);
    expect(replaced.training).toEqual(reported.training);
    expect(replaced.training.lastWeek.fitness[club].coachId).toBe('fitness-12');
    expect(replacementWeek.training.lastWeek.fitness[club].coachId).toBe(getClubFitnessCoach(replaced).coachId);
    expect(replacementWeek.training.lastWeek.fitness[club].coachId).not.toBe('fitness-12');
    expect(restore(released)).toEqual(released);
    expect(restore(replaced)).toEqual(replaced);
  });

  it('does not help medically unavailable days or shorten a genuine injury episode', () => {
    const episode = injured.injuries.find(item => item.playerId === 'rhf-9');
    expect(episode.returnOn).toBe('2026-09-25');
    expect(injuredHired.training.lastWeek).toEqual(injured.training.lastWeek);
    for (const state of [injuredHired, unavailableWeek, partialWeek]) expect(state.injuries.find(item => item.id === episode.id)).toEqual(episode);
    const absent = unavailableWeek.training.lastWeek.players['rhf-9'];
    expect(absent.availableDays).toBe(0);
    expect(absent.fitness.conditionBenefit).toBe(0);
    expect(Object.values(absent.gains).reduce((sum, value) => sum + value, 0)).toBe(0);
    const partial = partialWeek.training.lastWeek.players['rhf-9'];
    expect(partial.availableDays).toBe(2);
    expect(partial.fitness.conditionBenefit).toBeGreaterThan(0);
    expect(partial.fitness.conditionBenefit).toBeLessThanOrEqual(4);
    expect(restore(partialWeek)).toEqual(partialWeek);
  });

  it('keeps all three staff roles within one allocation and closes hiring when no training week remains', () => {
    const { hired, replaced, allocationBlocked, roundTen } = careers;
    expect(staffCommitmentsByRole(hired, club)).toEqual({ coaches: 4_000_000, scouts: 2_000_000, fitness: 5_000_000, physio: 0, assistant: 0, youth: 0, total: 11_000_000 });
    expect(staffCommitted(replaced, club)).toBe(13_000_000);
    expect(remainingStaffBudget(replaced)).toBe(2_000_000);
    expect(quoteScoutHire(replaced, 'scout-13').canHire).toBe(false);
    const coach = availableCoaches(replaced.coaching, replaced)[0];
    expect(() => hireCoach(replaced, coach.id)).toThrow(/staff allocation/);
    expect(quoteFitnessHire(allocationBlocked, 'fitness-12').reason).toMatch(/shared staff allocation/);
    expect(quoteFitnessHire(roundTen, availableFitnessCoaches(roundTen)[0].id).reason).toMatch(/No weekly training/);
    expect(() => hireFitnessCoach(roundTen, availableFitnessCoaches(roundTen)[0].id)).toThrow(/No weekly training/);
  });

  it('renews selected staff against a fresh allocation and applies no extra offseason recovery', () => {
    const { completed, nextYear } = careers;
    expect(nextYear.training.lastWeek).toBeNull();
    expect(Object.values(nextYear.conditions).every(value => value === 100)).toBe(true);
    expect(getClubFitnessCoach(nextYear)).toMatchObject({ seasonNumber: 2, startedRound: 1 });
    expect(staffCommitmentsByRole(nextYear, club)).toEqual({ coaches: 4_000_000, scouts: 2_000_000, fitness: 2_000_000, physio: 0, assistant: 0, youth: 0, total: 8_000_000 });
    expect(nextYear.fitness.contracts.slice(0, completed.fitness.contracts.length)).toEqual(completed.fitness.contracts);
    expect(nextYear.finance.ledger.slice(0, completed.finance.ledger.length)).toEqual(completed.finance.ledger);
    const updated = setFitnessRenewal(nextYear, getClubFitnessCoach(nextYear).id, false);
    expect(updated.finance).toEqual(nextYear.finance);
    expect(updated.training).toEqual(nextYear.training);
    expect(getClubFitnessCoach(updated).renew).toBe(false);
    expect(restore(nextYear)).toEqual(nextYear);
  });

  it('obeys identical staff limits, cash accounting and unique appointments for all clubs over two seasons', () => {
    for (const state of careers.boundaries) {
      const active = state.clubs.map(team => getClubFitnessCoach(state, team.id)).filter(Boolean);
      expect(new Set(active.map(contract => contract.coachId)).size).toBe(active.length);
      for (const team of state.clubs) {
        expect(staffCommitted(state, team.id)).toBeLessThanOrEqual(STAFF_BUDGET);
        const contracts = state.fitness.contracts.filter(contract => contract.clubId === team.id && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null);
        expect(contracts.length).toBeLessThanOrEqual(1);
        expect(getFinanceBalance(state.finance, team.id).cash).toBeGreaterThanOrEqual(0);
      }
    }
    expect(careers.initial.clubs.filter(team => team.id !== club).every(team => getClubFitnessCoach(careers.initial, team.id))).toBe(true);
    expect(restore(careers.secondSeason)).toEqual(careers.secondSeason);
  });

  it('resumes the next matchday identically from a save with a replacement coach and previous report', () => {
    const loaded = restore(careers.replaced);
    expect(stepMatch(loaded.activeMatch)).toEqual(stepMatch(careers.replaced.activeMatch));
    expect(advanceFitnessCareer(loaded)).toEqual(careers.replacementWeek);
  });
});

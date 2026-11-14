import { financeLedgerSlice } from '../src/world/finance-ledger';
import { beforeAll, describe, expect, it } from 'vitest';
import { stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getClubCashOutlook } from '../src/world/finance-outlook';
import { getClubMedicalCases, getInjuryMedicalSummary, getPlayerHealth, getPlayerMedicalSummary } from '../src/world/health';
import { hirePhysio, setPhysioRenewal } from '../src/world/physio';
import { availablePhysios, getClubPhysio, quotePhysioHire } from '../src/world/physio-policy';
import { effectiveReturnOn, rehabilitationCreditCap } from '../src/world/rehabilitation-policy';
import { remainingStaffBudget, STAFF_BUDGET, staffCommitmentsByRole, staffCommitted } from '../src/world/staff-policy';
import { advancePhysioCareer, createPhysioCareers, createPhysioEligibilityCareers, finishPhysioMatch } from './helpers/physio-careers';

const restore = state => parseSeason(serializeSeason(state));
const club = 'rhine-falcons';
let careers, eligibility;
beforeAll(() => {
  careers = createPhysioCareers();
  eligibility = createPhysioEligibilityCareers();
}, 120_000);

describe('physiotherapy across actual career boundaries', () => {
  it('charges a hire once without immediately changing injury, training, match or random state', () => {
    const { initial, hired } = careers;
    expect(hired.activeMatch).toEqual(initial.activeMatch);
    expect(stepMatch(hired.activeMatch)).toEqual(stepMatch(initial.activeMatch));
    expect(hired.injuries).toEqual(initial.injuries);
    expect(hired.training).toEqual(initial.training);
    expect(hired.physio.rehabilitation).toEqual(initial.physio.rehabilitation);
    expect(hired.finance.ledger.slice(initial.finance.ledger.length)).toMatchObject([{ kind: 'physio', clubId: club, amount: -5_000_000, physio: { physioId: 'physio-12' } }]);
    const before = getClubCashOutlook(initial), after = getClubCashOutlook(hired);
    expect(before.startCash - after.startCash).toBe(5_000_000);
    expect(before.baseline.endBalance - after.baseline.endBalance).toBe(5_000_000);
    expect(after.rows.map(row => [row.wages, row.operations, row.transferOut])).toEqual(before.rows.map(row => [row.wages, row.operations, row.transferOut]));
    expect(restore(hired)).toEqual(hired);
  });

  it('settles only prospective recovery and retains the original episode and identical completed fixture', () => {
    const { initial, treated, withoutPhysio } = careers;
    const injury = initial.injuries.find(injury => injury.playerId === 'rhf-9');
    expect(injury.returnOn).toBe('2026-09-25');
    expect(treated.fixtures).toEqual(withoutPhysio.fixtures);
    expect(treated.injuries).toEqual(withoutPhysio.injuries);
    const review = treated.physio.rehabilitation.find(record => record.injuryId === injury.id);
    expect(review).toMatchObject({ physioId: 'physio-12', eligibleDays: 6, creditBefore: 0, creditEarned: 180, creditAfter: 180, fromDate: '2026-09-12', toDate: '2026-09-19', returnBefore: '2026-09-25', returnAfter: '2026-09-24' });
    expect(effectiveReturnOn(treated.physio, injury, '2026-09-18')).toBe(injury.returnOn);
    expect(effectiveReturnOn(treated.physio, injury, '2026-09-19')).toBe('2026-09-24');
    expect(getInjuryMedicalSummary(treated, injury)).toMatchObject({ daysSaved: 1, daysRemaining: 5, originalReturnOn: '2026-09-25', effectiveReturnOn: '2026-09-24' });
    expect(treated.training.lastWeek.players['rhf-9'].availableDays).toBe(0);
  });

  it('lets ordinary training use earned availability without retroactively changing last week', () => {
    const { treated, continuedCare, baselineReturn } = careers;
    expect(continuedCare.training.lastWeek.players['rhf-9'].availableDays).toBe(3);
    expect(baselineReturn.training.lastWeek.players['rhf-9'].availableDays).toBe(2);
    expect(treated.training.lastWeek.players['rhf-9'].availableDays).toBe(0);
    expect(continuedCare.injuries).toEqual(baselineReturn.injuries);
    expect(getPlayerHealth(continuedCare, 'rhf-9')).toBeNull();
    const history = getPlayerMedicalSummary(continuedCare, 'rhf-9');
    expect(history).toMatchObject({ daysSaved: 1, daysRemaining: 0, progress: 100 });
    expect(history.lastReview.creditAfter).toBeGreaterThanOrEqual(200);
    // Credit earned after clearance cannot be misreported as an additional saved day.
    expect(history.daysSaved).toBe(1);
  });

  it('keeps earlier improvements and report authors through release and replacement', () => {
    const { treated, released, replaced, replacementWeek } = careers;
    expect(released.finance).toEqual(treated.finance);
    expect(released.physio.rehabilitation).toEqual(treated.physio.rehabilitation);
    expect(replaced.physio.rehabilitation).toEqual(treated.physio.rehabilitation);
    expect(replaced.training).toEqual(treated.training);
    const old = treated.physio.rehabilitation.find(record => record.playerId === 'rhf-9');
    expect(replacementWeek.physio.rehabilitation.find(record => record.id === old.id)).toEqual(old);
    const next = replacementWeek.physio.rehabilitation.find(record => record.playerId === 'rhf-9' && record.afterRound === 3);
    expect(next.physioId).toBe(getClubPhysio(replaced).physioId);
    expect(next.physioId).not.toBe(old.physioId);
    expect(next.creditBefore).toBe(old.creditAfter);
    expect(next.creditAfter).toBeLessThanOrEqual(rehabilitationCreditCap(treated.injuries.find(injury => injury.id === old.injuryId)));
    expect(restore(released)).toEqual(released);
    expect(restore(replaced)).toEqual(replaced);
  });

  it('uses one allocation for four roles, including retained released fees', () => {
    const { hired, replaced, roundTen } = careers;
    expect(staffCommitmentsByRole(hired, club)).toEqual({ coaches: 4_000_000, scouts: 2_000_000, fitness: 2_000_000, physio: 5_000_000, assistant: 0, youth: 0, total: 13_000_000 });
    expect(staffCommitted(replaced, club)).toBe(STAFF_BUDGET);
    expect(remainingStaffBudget(replaced)).toBe(0);
    expect(quotePhysioHire(hired, availablePhysios(hired)[0].id).reason).toMatch(/occupied/);
    expect(quotePhysioHire(roundTen, availablePhysios(roundTen)[0].id).reason).toMatch(/No weekly medical review/);
    expect(() => hirePhysio(roundTen, availablePhysios(roundTen)[0].id)).toThrow(/No weekly medical review/);
  });

  it('shows a new match injury immediately but grants no treatment before Continue', () => {
    const { hired, fulltime } = eligibility;
    expect(fulltime.injuries).toEqual(hired.injuries);
    expect(fulltime.physio.rehabilitation).toEqual(hired.physio.rehabilitation);
    const summary = getPlayerMedicalSummary(fulltime, 'aeg-2');
    expect(summary).toMatchObject({ pending: true, originalReturnOn: '2026-09-28', effectiveReturnOn: '2026-09-28', daysSaved: 0, lastReview: null });
    expect(getClubMedicalCases(fulltime).some(item => item.injury.playerId === 'aeg-2')).toBe(true);
  });

  it('can clear a player for an earlier fixture with training disabled, using the same injury rules', () => {
    const { treated, returned, stillUnavailable } = eligibility;
    expect(returned.training.enabledSince).toBeNull();
    const injury = returned.injuries.find(injury => injury.playerId === 'aeg-2');
    expect(injury.returnOn).toBe('2026-09-28');
    expect(returned.injuries).toEqual(stillUnavailable.injuries);
    expect(returned.fixtures).toEqual(stillUnavailable.fixtures);
    expect(returned.date).toBe('2026-09-26');
    expect(getPlayerHealth(returned, 'aeg-2')).toBeNull();
    expect(getPlayerHealth(stillUnavailable, 'aeg-2')).toEqual(injury);
    expect(returned.activeMatch.preExistingInjuries).not.toContain('aeg-2');
    expect(stillUnavailable.activeMatch.preExistingInjuries).toContain('aeg-2');
    expect(getPlayerMedicalSummary(returned, 'aeg-2')).toMatchObject({ effectiveReturnOn: '2026-09-26', daysSaved: 2 });
    expect(getPlayerMedicalSummary(treated, 'aeg-2')).toMatchObject({ effectiveReturnOn: '2026-09-27', daysSaved: 1 });
    expect(finishPhysioMatch(returned).activeMatch.stats['aeg-2'].secondsPlayed).toBeGreaterThan(0);
    expect(finishPhysioMatch(stillUnavailable).activeMatch.stats['aeg-2'].secondsPlayed).toBe(0);
  });

  it('renews against the next annual allocation without inventing offseason treatment', () => {
    const { completed, nextYear } = careers;
    expect(nextYear.physio.rehabilitation).toEqual(completed.physio.rehabilitation);
    expect(nextYear.physio.contracts.slice(0, completed.physio.contracts.length)).toEqual(completed.physio.contracts);
    expect(financeLedgerSlice(nextYear.finance).slice(0, completed.finance.ledger.length)).toEqual(completed.finance.ledger);
    expect(staffCommitmentsByRole(nextYear, club)).toEqual({ coaches: 4_000_000, scouts: 2_000_000, fitness: 2_000_000, physio: 2_000_000, assistant: 0, youth: 0, total: 10_000_000 });
    expect(Object.values(nextYear.conditions).every(value => value === 100)).toBe(true);
    const updated = setPhysioRenewal(nextYear, getClubPhysio(nextYear).id, false);
    expect(getClubPhysio(updated).renew).toBe(false);
    expect(updated.finance).toEqual(nextYear.finance);
    expect(updated.injuries).toEqual(nextYear.injuries);
  });

  it('keeps AI staffing exclusive and within the same limits across two real seasons', () => {
    for (const state of careers.boundaries) {
      const active = state.physio.contracts.filter(contract => contract.seasonNumber === state.seasonNumber && contract.releasedRound === null);
      expect(new Set(active.map(contract => contract.physioId)).size).toBe(active.length);
      for (const team of state.clubs) {
        expect(active.filter(contract => contract.clubId === team.id).length).toBeLessThanOrEqual(1);
        expect(staffCommitted(state, team.id)).toBeLessThanOrEqual(STAFF_BUDGET);
      }
      for (const record of state.physio.rehabilitation) {
        const injury = state.injuries.find(injury => injury.id === record.injuryId);
        expect(record.creditAfter).toBeLessThanOrEqual(rehabilitationCreditCap(injury));
        expect(record.returnAfter <= record.returnBefore).toBe(true);
        if (record.returnAfter !== record.returnBefore) expect(record.returnAfter >= record.toDate).toBe(true);
      }
    }
    expect(careers.secondSeason.status).toBe('complete');
  });

  it('roundtrips treatment, next match events and the next world transition exactly', () => {
    for (const state of [careers.treated, careers.replacementWeek, eligibility.returned]) {
      const loaded = restore(state);
      expect(loaded).toEqual(state);
      expect(stepMatch(loaded.activeMatch)).toEqual(stepMatch(state.activeMatch));
      expect(advancePhysioCareer(loaded)).toEqual(advancePhysioCareer(state));
    }
  });
});

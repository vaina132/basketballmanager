import { beforeAll, describe, expect, it } from 'vitest';
import type { FinanceEntry } from '../src/domain/finance';
import type { RehabilitationWeekInput, SeasonPhysio } from '../src/domain/physio';
import type { SeasonInjury, SeasonState } from '../src/domain/season';
import { DEVELOPMENT_PHYSIOS } from '../src/data/development-physios';
import { hireCoach } from '../src/world/coaching';
import { getFinanceBalance } from '../src/world/finance';
import { hireFitnessCoach } from '../src/world/fitness';
import { getClubMedicalCases, getInjuryMedicalSummary, getPlayerHealth, isRecovering } from '../src/world/health';
import { getSpendableCash } from '../src/world/payroll-policy';
import { createPhysio, enablePhysio, hirePhysio, recruitAiPhysios, releasePhysio, setPhysioRenewal } from '../src/world/physio';
import { availablePhysios, getClubPhysio, physioEffects, quotePhysioHire } from '../src/world/physio-policy';
import { processRehabilitationWeek } from '../src/world/rehabilitation';
import { scheduleInSeasonRecruitment } from '../src/world/recruitment';
import { effectiveReturnOn, rehabilitationCreditCap } from '../src/world/rehabilitation-policy';
import { hireScout } from '../src/world/scouts';
import { createSeason, dateForRound } from '../src/world/season';
import { remainingStaffBudget, STAFF_BUDGET, staffCommitmentsByRole, staffCommitted } from '../src/world/staff-policy';
import { processTrainingWeek, trainingAvailableDays } from '../src/world/training';

const club = 'rhine-falcons', other = 'aegean-waves', player = 'rhf-1';
const create = (physio = true) => createSeason(53, club, 'off', true, true, true, true, null, true, true, true, true, true, true, physio);
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function injury(duration = 18, occurredOn = dateForRound(1)): SeasonInjury {
  return { id: `policy-${duration}-${occurredOn}`, playerId: player, clubId: club, kind: 'ankle', fixtureId: 'dev-r1-g1', occurredOn, returnOn: new Date(Date.parse(`${occurredOn}T00:00:00Z`) + duration * 86400000).toISOString().slice(0, 10) };
}
function input(state: SeasonState, episode: SeasonInjury, afterRound = 1, physio = state.physio): RehabilitationWeekInput {
  return { physio, clubs: state.clubs, rosters: state.rosters, injuries: [episode], seasonNumber: state.seasonNumber, afterRound, fromDate: dateForRound(afterRound), toDate: dateForRound(afterRound + 1) };
}
/** Isolated cash/clinical inputs test policy; genuine career histories are covered separately. */
function expense(state: SeasonState, amount: number): SeasonState {
  const entry: FinanceEntry = { id: `test-${state.finance.ledger.length}`, clubId: club, seasonNumber: state.seasonNumber, round: state.round, kind: 'operations', amount: -amount, sourceId: 'physio-test', ticket: null, coach: null, payroll: null };
  return { ...state, finance: { ...state.finance, ledger: [...state.finance.ledger, entry] } };
}

describe('physio recruitment and four-role staff allocation', () => {
  let initial: SeasonState;
  beforeAll(() => { initial = freeze(create()); });

  it('activates prospectively without requiring training or changing a prepared game', () => {
    const legacy = freeze(create(false)), active = enablePhysio(legacy);
    expect(legacy.physio).toEqual(createPhysio());
    expect(active.physio.enabledSince).toEqual({ seasonNumber: 1, round: 1, ledgerIndex: legacy.finance.ledger.length });
    expect(active.activeMatch).toBe(legacy.activeMatch);
    expect(active.injuries).toBe(legacy.injuries);
    expect(active.training).toBe(legacy.training);
    expect(enablePhysio(active)).toBe(active);
    const noTraining = createSeason(53, club, 'off', false, false, true, false, null, false, false, false, false, false, false, true);
    expect(noTraining.physio.enabledSince).not.toBeNull();
    expect(() => enablePhysio(createSeason(53, club, 'off', false, false, false, false))).toThrow(/finances/i);
    expect(() => enablePhysio({ ...legacy, round: 10 })).toThrow(/one to nine/i);
  });

  it('uses one meaningful bounded skill and hires each person for only one club', () => {
    for (const physio of DEVELOPMENT_PHYSIOS) {
      expect(Object.isFrozen(physio)).toBe(true);
      expect(physioEffects(physio)).toEqual({ creditPerDay: 10 + 2 * physio.rehabilitation, maximumReductionPercent: 20 });
    }
    const employed = initial.physio.contracts[0]!;
    expect(quotePhysioHire(initial, employed.physioId).reason).toMatch(/active club/i);
    const hired = hirePhysio(initial, 'physio-12'), contract = getClubPhysio(hired)!;
    expect(hired.finance.ledger.at(-1)).toMatchObject({ kind: 'physio', amount: -5_000_000, sourceId: `physio-${contract.id}`, physio: { contractId: contract.id, physioId: 'physio-12' } });
    expect(contract.hiredLedgerIndex).toBe(initial.finance.ledger.length);
    expect(() => hirePhysio(hired, 'physio-06')).toThrow(/occupied/i);
    expect(hired.activeMatch).toBe(initial.activeMatch);
    const released = releasePhysio(hired, contract.id);
    expect(released.finance).toBe(hired.finance);
    expect(staffCommitted(released, club)).toBe(staffCommitted(hired, club));
    expect(availablePhysios(released).some(physio => physio.id === contract.physioId)).toBe(true);
    expect(() => releasePhysio(released, contract.id)).toThrow(/active physio/i);
  });

  it('shares exact cash/allocation guards with the other three roles and retains release costs', () => {
    const staffed = hirePhysio(hireFitnessCoach(hireScout(initial, 'scout-06'), 'fitness-06'), 'physio-12');
    expect(staffCommitmentsByRole(staffed, club)).toEqual({ coaches: 4_000_000, scouts: 2_000_000, fitness: 2_000_000, physio: 5_000_000, total: 13_000_000 });
    expect(() => hireCoach(staffed, 'coach-25')).toThrow(/shared staff/i);
    expect(() => hireScout(staffed, 'scout-07')).toThrow(/shared staff/i);
    const full = hireFitnessCoach(hireCoach(initial, 'coach-07'), 'fitness-07');
    expect(quotePhysioHire(full, 'physio-06').reason).toMatch(/shared staff/i);
    const poor = freeze(expense(initial, getSpendableCash(initial, club) - 1_000_000));
    expect(quotePhysioHire(poor, 'physio-06').reason).toMatch(/remaining budget/i);
    const unpaid = freeze(expense(initial, getFinanceBalance(initial.finance, club).cash + 1));
    expect(quotePhysioHire(unpaid, 'physio-06').reason).toMatch(/unpaid/i);
    expect(remainingStaffBudget(unpaid)).toBe(0);
  });

  it('keeps final-round hiring closed, renewal editable, and AI within the same budget and limits', () => {
    expect(quotePhysioHire({ ...initial, round: 10 }, 'physio-06').reason).toMatch(/next season/i);
    const hired = hirePhysio(initial, 'physio-06'), contract = getClubPhysio(hired)!;
    expect(getClubPhysio(setPhysioRenewal({ ...hired, round: 10 }, contract.id, false))?.renew).toBe(false);
    expect(() => setPhysioRenewal(hired, contract.id, 'yes' as never)).toThrow(/renew/i);
    expect(recruitAiPhysios(initial)).toBe(initial);
    expect(new Set(initial.physio.contracts.map(contract => contract.physioId)).size).toBe(initial.physio.contracts.length);
    for (const team of initial.clubs) {
      expect(Boolean(getClubPhysio(initial, team.id))).toBe(team.id !== club);
      expect(staffCommitted(initial, team.id)).toBeLessThanOrEqual(STAFF_BUDGET);
    }
    expect(create()).toEqual(initial);
  });
});

describe('dated rehabilitation, immutable diagnosis and prospective clearance', () => {
  let state: SeasonState;
  beforeAll(() => { state = freeze(hirePhysio(create(), 'physio-12')); });

  it('treats six between-matchday days and records canonical staff/roster provenance without touching inputs', () => {
    const episode = freeze(injury()), original = freeze(input(state, episode)), before = structuredClone(original);
    const first = processRehabilitationWeek(original), record = first.rehabilitation[0]!;
    expect(record).toMatchObject({ id: 'rehab-1', injuryId: episode.id, playerId: player, clubId: club, seasonNumber: 1, afterRound: 1, fromDate: dateForRound(1), toDate: dateForRound(2), rosterId: state.rosters.find(roster => roster.clubId === club)!.id, contractId: getClubPhysio(state)!.id, physioId: 'physio-12', eligibleDays: 6, creditBefore: 0, creditEarned: 180, creditAfter: 180, returnBefore: '2026-09-23', returnAfter: '2026-09-22' });
    expect(original).toEqual(before);
    expect(processRehabilitationWeek(original)).toEqual(first);
    expect(episode.returnOn).toBe('2026-09-23');
    expect(effectiveReturnOn(first, episode, '2026-09-11')).toBe(episode.returnOn);
    expect(effectiveReturnOn(first, episode, '2026-09-12')).toBe('2026-09-22');
    expect(() => processRehabilitationWeek({ ...original, physio: first })).toThrow(/already been processed/i);
  });

  it('caps whole days sooner to20% and never treats an already cleared episode', () => {
    const episode = injury(), first = processRehabilitationWeek(input(state, episode));
    const second = processRehabilitationWeek(input(state, episode, 2, first));
    expect(rehabilitationCreditCap(episode)).toBe(300);
    expect(second.rehabilitation.at(-1)).toMatchObject({ creditBefore: 180, creditEarned: 120, creditAfter: 300, returnAfter: '2026-09-20' });
    expect(processRehabilitationWeek(input(state, episode, 3, second))).toBe(second);
    expect(getInjuryMedicalSummary({ ...state, physio: second, injuries: [episode], date: dateForRound(3), round: 3 }, episode)).toMatchObject({ originalReturnOn: '2026-09-23', effectiveReturnOn: '2026-09-20', daysSaved: 3, credit: 300, creditCap: 300, pending: false });
  });

  it('can clear the review day but cannot backdate any previous training day', () => {
    const episode = injury(8), medical = processRehabilitationWeek(input(state, episode));
    expect(medical.rehabilitation[0]).toMatchObject({ returnBefore: '2026-09-13', returnAfter: dateForRound(2), creditAfter: 100 });
    expect(trainingAvailableDays([episode], player, dateForRound(1), dateForRound(2))).toBe(0);
    expect(trainingAvailableDays([episode], player, dateForRound(1), dateForRound(2), medical)).toBe(1);
    expect(isRecovering(episode, '2026-09-11', medical)).toBe(true);
    expect(isRecovering(episode, '2026-09-12', medical)).toBe(false);
    const plan = state.training.plans[club]!;
    const training = { ...state.training, plans: { ...state.training.plans, [club]: { ...plan, delegated: false, intensity: 'standard' as const, focus: 'passing' as const } } };
    const result = processTrainingWeek({ training, clubs: state.clubs, rosters: state.rosters, conditions: Object.fromEntries(Object.keys(state.conditions).map(id => [id, 80])), injuries: [episode], physio: medical, seasonNumber: 1, afterRound: 1, fromDate: dateForRound(1), toDate: dateForRound(2) });
    expect(result.training.lastWeek!.players[player]!.availableDays).toBe(1);
    expect(result.training.lastWeek!.players[player]!.gains.passing).toBe(4);
  });

  it('distinguishes accumulated credit from actual days saved after a late review', () => {
    const episode = injury(17), later = { ...state, round: 2, date: dateForRound(2) };
    const first = processRehabilitationWeek(input(later, episode, 2));
    const next = processRehabilitationWeek(input(later, episode, 3, first));
    expect(next.rehabilitation.at(-1)).toMatchObject({ eligibleDays: 1, creditBefore: 180, creditAfter: 210, returnBefore: '2026-09-21', returnAfter: '2026-09-21' });
    const summary = getInjuryMedicalSummary({ ...state, physio: next, injuries: [episode], date: dateForRound(4), round: 4 }, episode);
    expect(summary).toMatchObject({ daysSaved: 1, credit: 210, daysRemaining: 0, progress: 100 });
  });

  it('does not erase an earned earlier return after release and preserves historical care after replacement', () => {
    const episode = injury(), first = processRehabilitationWeek(input(state, episode));
    const current = { ...state, physio: first, round: 2, date: dateForRound(2) };
    const released = releasePhysio(current, getClubPhysio(current)!.id);
    expect(released.physio.rehabilitation).toBe(first.rehabilitation);
    expect(effectiveReturnOn(released.physio, episode, current.date)).toBe('2026-09-22');
    expect(processRehabilitationWeek(input(released, episode, 2))).toBe(released.physio);
    const replacement = hirePhysio(released, 'physio-06');
    const next = processRehabilitationWeek(input(replacement, episode, 2));
    expect(next.rehabilitation.at(-1)).toMatchObject({ physioId: 'physio-06', creditBefore: 180, creditEarned: 108, creditAfter: 288 });
    expect(next.rehabilitation[0]).toEqual(first.rehabilitation[0]);
  });

  it('uses the treating registered club rather than the original diagnosis club', () => {
    const episode = { ...injury(), clubId: other };
    const record = processRehabilitationWeek(input(state, episode)).rehabilitation[0]!;
    expect(record.clubId).toBe(club);
    expect(record.physioId).toBe('physio-12');
    expect(episode.clubId).toBe(other);
    const missing = { ...input(state, episode), clubs: state.clubs.map(team => team.id === club ? { ...team, players: team.players.filter(item => item.id !== player) } : team) };
    expect(() => processRehabilitationWeek(missing)).toThrow(/registered squad/i);
  });

  it('allows a new episode after early clearance even while the original diagnosis date is in the future', () => {
    const episode = injury(8), physio = processRehabilitationWeek(input(state, episode));
    const repeated = { ...injury(8, dateForRound(2)), id: 'second-episode' };
    const current = { ...state, physio, injuries: [episode, repeated], date: dateForRound(2), round: 2 };
    expect(isRecovering(episode, current.date)).toBe(true);
    expect(isRecovering(episode, current.date, physio)).toBe(false);
    expect(getPlayerHealth(current, player)?.id).toBe(repeated.id);
    expect(getClubMedicalCases(current).map(summary => summary.injury.id)).toEqual([repeated.id]);
    const next = processRehabilitationWeek({ ...input(current, repeated, 2), injuries: [episode, repeated] });
    expect(next.rehabilitation.slice(1).every(record => record.injuryId === repeated.id)).toBe(true);
  });

  it('leaves disabled and preactivation care inert and rejects offseason or malformed intervals', () => {
    const episode = injury(), original = input(state, episode), disabled = createPhysio();
    expect(processRehabilitationWeek({ ...original, physio: disabled })).toBe(disabled);
    const prospective: SeasonPhysio = { ...state.physio, enabledSince: { seasonNumber: 1, round: 2, ledgerIndex: 0 } };
    expect(processRehabilitationWeek({ ...original, physio: prospective })).toBe(prospective);
    expect(() => processRehabilitationWeek({ ...original, afterRound: 10 })).toThrow(/seven-day interval/i);
    expect(() => processRehabilitationWeek({ ...original, toDate: dateForRound(3) })).toThrow(/seven-day interval/i);
    const prior = structuredClone(episode);
    expect(getInjuryMedicalSummary(state, episode)).toMatchObject({ pending: true, daysSaved: 0, credit: 0 });
    expect(episode).toEqual(prior);
  });

  it('does not let response-day recruitment forecasts use care unknown on the offer date', () => {
    const injuries = state.clubs.find(team => team.id === other)!.players.slice(0, 3).map(target => ({ ...injury(8), id: `forecast-${target.id}`, playerId: target.id, clubId: other }));
    const known = { ...state, injuries };
    const future = processRehabilitationWeek({ ...input(known, injuries[0]!), injuries });
    expect(future.rehabilitation.filter(record => record.clubId === other)).toHaveLength(3);
    expect(future.rehabilitation.every(record => record.returnAfter === dateForRound(2))).toBe(true);
    const ordinary = scheduleInSeasonRecruitment(known);
    expect(ordinary.recruitment.offers.some(offer => offer.clubId === other)).toBe(true);
    expect(scheduleInSeasonRecruitment({ ...known, physio: future }).recruitment).toEqual(ordinary.recruitment);
  });
});

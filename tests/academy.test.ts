import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_YOUTH_COACHES } from '../src/data/development-youth';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { academyAtBoundary, cancelAcademyPromotion, createAcademy, enableAcademy, offerAcademyPromotion, prepareAcademySeason, processAcademyWeek, setAcademyFocus } from '../src/world/academy';
import { generateAcademyProspects } from '../src/world/academy-generation';
import { academyPointCap, getAcademyPlayer, getClubAcademy, quoteAcademyPromotion } from '../src/world/academy-policy';
import { hireAssistant } from '../src/world/assistant';
import { hireFitnessCoach } from '../src/world/fitness';
import { getFinanceBalance } from '../src/world/finance';
import { getCareerPlayer, getCareerPlayerAge, getCareerPlayers } from '../src/world/player-catalog';
import { getPlayerPayroll } from '../src/world/payroll';
import { getSpendableCash } from '../src/world/payroll-policy';
import { hirePhysio } from '../src/world/physio';
import { getInSeasonCandidates, getReservedInSeasonWages } from '../src/world/recruitment-policy';
import { scheduleInSeasonRecruitment, submitInSeasonOffer } from '../src/world/recruitment';
import { hireScout } from '../src/world/scouts';
import { advanceSeason, createSeason, dateForRound, managedSide } from '../src/world/season';
import { STAFF_BUDGET, staffCommitmentsByRole, staffCommitted } from '../src/world/staff-policy';
import { TRAINING_ATTRIBUTES } from '../src/world/training';
import { enableYouth, hireYouthCoach, recruitAiYouthCoaches, releaseYouthCoach, setYouthCoachRenewal } from '../src/world/youth';
import { availableYouthCoaches, getClubYouthCoach, quoteYouthCoachHire, youthCoachEffects } from '../src/world/youth-policy';

const club = 'rhine-falcons';
const create = (academy = true, youth = true) => createSeason(227, club, 'off', true, true, true, true, null, true, true, true, true, true, true, true, true, academy, youth);
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function nextRound(state: SeasonState): SeasonState { return advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) }); }
const total = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0);
function week(state: SeasonState, afterRound = state.round) { return { academy: state.academy, youth: state.youth, clubs: state.clubs, seasonNumber: state.seasonNumber, afterRound, fromDate: dateForRound(afterRound, state.seasonNumber), toDate: dateForRound(afterRound + 1, state.seasonNumber) }; }

describe('persistent academy intake and development', () => {
  let initial: SeasonState;
  beforeAll(() => { initial = freeze(create()); });

  it('generates deterministic private prospects without altering the prepared match or senior population', () => {
    const legacy = freeze(create(false, false)), activated = enableAcademy(legacy);
    expect(legacy.academy).toEqual(createAcademy());
    expect(activated.activeMatch).toBe(legacy.activeMatch);
    expect(activated.training).toBe(legacy.training);
    expect(activated.conditions).toBe(legacy.conditions);
    expect(activated.academy.prospects).toHaveLength(18);
    expect(getClubAcademy(activated).map(row => row.age)).toEqual([16, 17, 18]);
    expect(getCareerPlayers(activated)).toHaveLength(60);
    expect(getInSeasonCandidates(activated).some(player => player.id.startsWith('academy-'))).toBe(false);
    expect(activated.academy.prospects.slice(0, 3)).toEqual(generateAcademyProspects(227, club, 1, 1, true, 3));
    expect(new Set(activated.academy.prospects.map(prospect => prospect.player.id)).size).toBe(18);
    expect(enableAcademy(activated)).toBe(activated);
    expect(() => enableAcademy({ ...legacy, round: 10 })).toThrow(/one to nine/i);
    expect(() => enableAcademy(createSeason())).toThrow(/contracts|recruitment/i);
  });

  it('applies real weekly focus and bounded coach gains without borrowing senior progress', () => {
    const id = initial.academy.prospects[0]!.player.id;
    const focused = setAcademyFocus(initial, id, 'passing');
    const baseline = processAcademyWeek(week(focused));
    expect(baseline.weeks[0]!.players[id]).toMatchObject({ focus: 'passing', gains: { passing: 28 }, coachingGains: { passing: 0 } });
    const coached = hireYouthCoach(focused, 'youth-12');
    const advanced = processAcademyWeek(week(coached));
    expect(advanced.weeks[0]!.coaches[club]).toMatchObject({ coachId: 'youth-12', bonusPercent: 50 });
    expect(advanced.weeks[0]!.players[id]).toMatchObject({ gains: { passing: 42 }, coachingGains: { passing: 14 } });
    const balanced = initial.academy.prospects[1]!.player.id;
    expect(total(advanced.weeks[0]!.players[balanced]!.gains)).toBe(42);
    expect(initial.training.points[id]).toBeUndefined();
    expect(initial.conditions[id]).toBeUndefined();
    expect(coached.activeMatch).toBe(initial.activeMatch);
    expect(() => processAcademyWeek({ ...week(coached), academy: advanced })).toThrow(/already.*processed/i);
    expect(() => processAcademyWeek(week(coached, 2))).toThrow(/calendar order/i);
  });

  it('reports only capped gains and preserves prior coach provenance after release', () => {
    const staffed = hireYouthCoach(initial, 'youth-12'), id = staffed.academy.prospects[0]!.player.id;
    const points = { ...staffed.academy.points[id]!, passing: 298 };
    const capped = { ...setAcademyFocus(staffed, id, 'passing'), academy: { ...staffed.academy, focus: { ...staffed.academy.focus, [id]: 'passing' as const }, points: { ...staffed.academy.points, [id]: points } } };
    const trained = processAcademyWeek(week(capped));
    expect(trained.weeks[0]!.players[id]!.gains.passing).toBe(2);
    expect(trained.weeks[0]!.players[id]!.coachingGains.passing).toBe(0);
    expect(academyPointCap(19)).toBe(100);
    const later = releaseYouthCoach({ ...staffed, round: 2, date: dateForRound(2), academy: trained }, getClubYouthCoach(staffed)!.id);
    expect(later.academy).toBe(trained);
    expect(later.academy.weeks[0]!.coaches[club]?.coachId).toBe('youth-12');
    expect(getAcademyPlayer(later, id)?.player.attributes.passing).toBe(staffed.academy.prospects[0]!.player.attributes.passing + 3);
  });

  it('refills only annual vacancies and releases over-age players as genuine free agents', () => {
    // Isolated annual boundaries exercise intake; full intervening seasons are integration-tested.
    let state = initial;
    const oldest = initial.academy.prospects[2]!;
    for (let year = 2; year <= 4; year += 1) {
      state = prepareAcademySeason({ ...state, seasonNumber: year, round: 1, date: dateForRound(1, year) });
      expect(getClubAcademy(state).length).toBeLessThanOrEqual(6);
      expect(prepareAcademySeason(state)).toBe(state);
    }
    const graduate = state.academy.graduates.find(entry => entry.prospectId === oldest.player.id)!;
    expect(graduate).toMatchObject({ kind: 'age-out', offerId: null, contractId: null, availableSince: { seasonNumber: 4, round: 1 } });
    expect(getCareerPlayers(state).some(player => player.id === oldest.player.id)).toBe(true);
    expect(getCareerPlayerAge(state, oldest.player.id, state.date)).toBe(21);
    expect(state.conditions[oldest.player.id]).toBe(100);
    expect(total(state.training.points[oldest.player.id]!)).toBe(0);
    expect(state.employment.contracts.some(contract => contract.playerId === oldest.player.id)).toBe(false);
    expect(getInSeasonCandidates(state).some(player => player.id === oldest.player.id)).toBe(true);
  });
});

describe('academy promotion through normal recruitment', () => {
  let initial: SeasonState;
  beforeAll(() => { initial = freeze(create()); });

  it('prevents outside poaching and accidental ordinary offers before graduation', () => {
    const own = getClubAcademy(initial)[0]!, rival = initial.academy.prospects.find(prospect => prospect.clubId !== club)!;
    expect(() => submitInSeasonOffer(initial, own.player.id, own.prospect.seasonWage)).toThrow(/choose a player/i);
    expect(quoteAcademyPromotion(initial, rival.player.id, rival.seasonWage).canOffer).toBe(false);
    expect(() => setAcademyFocus(initial, rival.player.id, 'passing')).toThrow(/your academy/i);
    expect(() => offerAcademyPromotion(initial, own.player.id, own.prospect.seasonWage, rival.clubId)).toThrow(/own academy/i);
    expect(quoteAcademyPromotion({ ...initial, round: 10 }, own.player.id, own.prospect.seasonWage).canOffer).toBe(false);
  });

  it('reserves cash and roster capacity, and releases holds when a promotion is cancelled', () => {
    const [one, two, three] = getClubAcademy(initial);
    const offered = offerAcademyPromotion(initial, one!.player.id, one!.prospect.seasonWage);
    const quote = quoteAcademyPromotion(initial, one!.player.id, one!.prospect.seasonWage);
    expect(offered.activeMatch).toBe(initial.activeMatch);
    expect(offered.clubs).toBe(initial.clubs);
    expect(getSpendableCash(initial, club) - getSpendableCash(offered, club)).toBe(quote.remainingWages);
    expect(getReservedInSeasonWages(offered, club)).toBe(quote.remainingWages);
    expect(offered.recruitment.offers.at(-1)).toMatchObject({ academyProspectId: one!.player.id, responseRound: 2, status: 'pending' });
    const twoOffers = offerAcademyPromotion(offered, two!.player.id, two!.prospect.seasonWage);
    expect(quoteAcademyPromotion(twoOffers, three!.player.id, three!.prospect.seasonWage).reason).toMatch(/twelve/i);
    const cancelled = cancelAcademyPromotion(offered, offered.recruitment.offers.at(-1)!.id);
    expect(getSpendableCash(cancelled, club)).toBe(getSpendableCash(initial, club));
    expect(getClubAcademy(cancelled)).toHaveLength(3);
  });

  it('registers two promotions together after academy training and starts fresh senior progress', () => {
    const [one, two] = getClubAcademy(initial), beforeContracts = initial.employment.contracts.length;
    const offered = offerAcademyPromotion(offerAcademyPromotion(setAcademyFocus(initial, one!.player.id, 'passing'), one!.player.id, one!.prospect.seasonWage), two!.player.id, two!.prospect.seasonWage);
    const next = nextRound(offered);
    expect(next.academy.graduates).toHaveLength(2);
    expect(getClubAcademy(next)).toHaveLength(1);
    expect(next.clubs.find(team => team.id === club)!.players).toHaveLength(12);
    expect(next.rosters.filter(roster => roster.clubId === club && roster.fromRound === 2)).toHaveLength(1);
    for (const graduate of next.academy.graduates) {
      expect(total(graduate.sourcePoints)).toBe(28);
      expect(total(next.training.points[graduate.player.id]!)).toBe(0);
      expect(next.conditions[graduate.player.id]).toBe(100);
      expect(next.employment.contracts.find(contract => contract.id === graduate.contractId)).toMatchObject({ playerId: graduate.player.id, startsRound: 2, kind: 'midseason' });
      expect(getPlayerPayroll(next, graduate.player.id)).toMatchObject({ agreement: { startsRound: 2 }, charged: 0 });
      expect(next.training.lastWeek!.players[graduate.player.id]).toBeUndefined();
      expect(getCareerPlayer(next, graduate.player.id)).toEqual(graduate.player);
    }
    const historical = academyAtBoundary(next.academy, 1, 1);
    expect(historical.graduates).toEqual([]);
    expect(historical.weeks).toEqual([]);
    expect(total(historical.points[one!.player.id]!)).toBe(0);
    const beforeAcceptance = academyAtBoundary(next.academy, 1, 2, beforeContracts);
    expect(beforeAcceptance.graduates).toEqual([]);
    expect(total(beforeAcceptance.points[one!.player.id]!)).toBe(28);
    expect(academyAtBoundary(next.academy, 1, 2, beforeContracts + 1).graduates).toHaveLength(1);
  });

  it('retains a prospect after a rejected or countered salary instead of silently registering him', () => {
    const candidate = getClubAcademy(initial).find(row => row.prospect.seasonWage > 500_000)!;
    const offered = offerAcademyPromotion(initial, candidate.player.id, 500_000);
    const next = nextRound(offered), reply = next.recruitment.offers.find(offer => offer.id === offered.recruitment.offers.at(-1)!.id)!;
    expect(['countered', 'rejected']).toContain(reply.status);
    expect(getAcademyPlayer(next, candidate.player.id)).not.toBeNull();
    expect(next.academy.graduates.some(graduate => graduate.prospectId === candidate.player.id)).toBe(false);
    expect(getReservedInSeasonWages(next, club)).toBe(0);
  });

  it('uses the same guarded academy offers when AI clubs repair injury shortages', () => {
    const team = initial.clubs.find(team => team.id !== club)!;
    const injuries = team.players.slice(0, 3).map((player, index) => ({ id: `policy-injury-${index}`, playerId: player.id, clubId: team.id, kind: 'ankle' as const, fixtureId: 'policy', occurredOn: initial.date, returnOn: dateForRound(4) }));
    const scheduled = scheduleInSeasonRecruitment({ ...initial, injuries });
    const offer = scheduled.recruitment.offers.find(offer => offer.clubId === team.id && offer.academyProspectId)!;
    expect(offer).toBeDefined();
    expect(getReservedInSeasonWages(scheduled, team.id)).toBeGreaterThan(0);
    expect(getClubAcademy(initial, team.id).some(row => row.player.id === offer.playerId)).toBe(true);
  });
});

describe('youth staff share the existing financial rules', () => {
  it('adds one meaningful coach, retains fees on release, and keeps all six roles in one allocation', () => {
    let state = create();
    const cash = getFinanceBalance(state.finance, club).cash;
    state = hireYouthCoach(hireAssistant(hirePhysio(hireFitnessCoach(hireScout(state, 'scout-06'), 'fitness-06'), 'physio-06'), 'assistant-06'), 'youth-12');
    expect(staffCommitmentsByRole(state, club)).toEqual({ coaches: 4_000_000, scouts: 2_000_000, fitness: 2_000_000, physio: 2_000_000, assistant: 2_000_000, youth: 3_000_000, total: 15_000_000 });
    expect(cash - getFinanceBalance(state.finance, club).cash).toBe(11_000_000);
    const contract = getClubYouthCoach(state)!;
    expect(youthCoachEffects(DEVELOPMENT_YOUTH_COACHES.at(-1)!)).toEqual({ bonusPercent: 50 });
    expect(() => hireYouthCoach(state, 'youth-06')).toThrow(/occupied/i);
    expect(getClubYouthCoach(setYouthCoachRenewal(state, contract.id, false))?.renew).toBe(false);
    const released = releaseYouthCoach(state, contract.id);
    expect(released.finance).toBe(state.finance);
    expect(quoteYouthCoachHire(released, 'youth-06').reason).toMatch(/shared staff/i);
    expect(availableYouthCoaches(released).some(coach => coach.id === 'youth-12')).toBe(true);
    for (const team of state.clubs) expect(staffCommitted(state, team.id)).toBeLessThanOrEqual(STAFF_BUDGET);
  });

  it('keeps prospective activation and last-week boundaries explicit', () => {
    const state = create(true, false), enabled = enableYouth(state);
    expect(enabled.activeMatch).toBe(state.activeMatch);
    expect(getClubYouthCoach(enabled)).toBeNull();
    expect(enabled.youth.contracts).toHaveLength(5);
    expect(new Set(enabled.youth.contracts.map(contract => contract.coachId)).size).toBe(5);
    expect(recruitAiYouthCoaches(enabled)).toBe(enabled);
    expect(quoteYouthCoachHire({ ...enabled, round: 10 }, 'youth-06').canHire).toBe(false);
    expect(() => enableYouth(create(false, false))).toThrow(/academy/i);
    for (const points of Object.values(enabled.academy.points)) expect(TRAINING_ATTRIBUTES.every(key => points[key] === 0)).toBe(true);
  });
});

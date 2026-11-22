import { describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { staffFee, withRealEconomy } from '../src/world/economy';
import { withLowerDivisions } from '../src/world/lower-division';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { seasonRounds } from '../src/world/career-world';
import { availablePhysios } from '../src/world/physio-policy';
import { hirePhysio } from '../src/world/physio';
import { payrollInstallment } from '../src/world/payroll-policy';
import { releaseStaff, replacementWarning, replaceStaff, roleStaff, sackingTerms, STAFF_ROLES } from '../src/world/staff-roster';
import { formatEuros } from '../src/ui/money-format';
import { compensationTerms, contractCompensation, keepContractedStaff, payComputerStaffCompensation, seasonStaffContracts, setStaffTerm, STAFF_CONTRACT_RULES } from '../src/world/staff-contracts';
import { availableFitnessCoaches } from '../src/world/fitness-policy';
import { PHYSIO_DIRECTORY, staffMember } from '../src/data/staff-directory';
import { wagesLeft } from '../src/world/wage-pool';

/** Two divisions of six clubs with researched money and a next division (as in opening-staff.test.ts). */
function moneyWorld(): CareerWorld {
  const base = testWorld(12);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return withRealEconomy(withLowerDivisions({ ...base, id: 'staff-contracts-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
}
const world = moneyWorld();
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const play = (state: SeasonState) => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const career = () => createSeason({ seed: 5, world, managedClubId: world.clubs[2]!.id, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });

describe('staff contracts like players (format 76, coaching-4)', () => {
  it('gives every opening person a 1-3 season contract, pays no fee up front and pays salaries weekly from Wages left', () => {
    let state = career();
    expect(state.coaching.model).toBe('coaching-4');
    const opening = seasonStaffContracts(state).filter(contract => contract.releasedRound === null);
    expect(opening.length).toBeGreaterThan(state.clubs.length * STAFF_ROLES.length - 1);
    for (const contract of opening) {
      const term = state.coaching.terms![contract.personId]!;
      expect(term.clubId).toBe(contract.clubId);
      expect(term.untilSeason - term.fromSeason + 1).toBeGreaterThanOrEqual(1);
      expect(term.untilSeason - term.fromSeason + 1).toBeLessThanOrEqual(3);
    }
    expect(new Set(opening.map(contract => state.coaching.terms![contract.personId]!.untilSeason)).size).toBeGreaterThan(1);
    // No up-front fee: every appointment's ledger entry is zero.
    const staffKinds = ['coaching', 'scouting', 'fitness', 'physio', 'assistant', 'youth'];
    expect(state.finance.ledger.filter(entry => staffKinds.includes(entry.kind)).every(entry => entry.amount === 0)).toBe(true);
    // Staff salaries count in Wages left as a season's pay.
    const clubId = state.managedClubId;
    expect(wagesLeft(state).staff).toBe(STAFF_ROLES.reduce((sum, role) => sum + roleStaff(state, role).reduce((total, member) => total + member.fee, 0), 0));
    expect(roundTrip(state)).toEqual(state);

    // One week: each club pays this week's installment of every salary, in one entry.
    const round = state.round, rounds = seasonRounds(state);
    const expected = STAFF_ROLES.reduce((sum, role) => sum + roleStaff(state, role).reduce((total, member) => total + payrollInstallment(member.fee, round, rounds), 0), 0);
    state = play(state);
    const wages = state.finance.ledger.filter(entry => entry.kind === 'staff-wages' && entry.clubId === clubId);
    expect(wages).toHaveLength(1);
    expect(wages[0]!.amount).toBe(-expected);
    expect(wages[0]!.sourceId).toBe(`staff-wages-s1-r${round}`);
    expect(roundTrip(state)).toEqual(state);
  }, 300_000);

  it('computes compensation for 1-, 2- and 3-season contracts at different points of a season, with the exact warning', () => {
    let state = career();
    const physio = roleStaff(state, 'physio')[0]!;
    const rounds = seasonRounds(state);
    const at = (seasons: number, weeks: number) => {
      let next = setStaffTerm(state, physio.personId, seasons);
      for (let week = 0; week < weeks; week += 1) next = play(next);
      return { next, compensation: contractCompensation(next, 'physio', physio.contractId)! };
    };
    const rest = (round: number) => Array.from({ length: rounds - round + 1 }, (_, index) => payrollInstallment(physio.fee, round + index, rounds)).reduce((sum, value) => sum + value, 0);
    const half = Math.round(physio.fee * STAFF_CONTRACT_RULES.laterSeasonShare);
    for (const [seasons, weeks] of [[1, 0], [2, 0], [3, 0], [1, 3], [2, 5], [3, 2]] as const) {
      const { next, compensation } = at(seasons, weeks);
      expect(compensation.rest, `${seasons} seasons after ${weeks} weeks`).toBe(rest(next.round));
      expect(compensation.laterSeasons).toBe(seasons - 1);
      expect(compensation.amount).toBe(rest(next.round) + half * (seasons - 1));
    }
    // The warning names the exact amount, and the sacking pays it at once from Spending left.
    const { next, compensation } = at(2, 2);
    expect(compensationTerms(physio.name, compensation)).toMatch(new RegExp(`^Sacking ${physio.name} costs €[\\d.,]+M? compensation: the rest of this season and half of next season\\.$`));
    expect(compensationTerms('Rado Trifunović', { salary: 6_000_000, rest: 3_000_000, laterSeasons: 1, later: 1_500_000, amount: 4_500_000 })).toBe('Sacking Rado Trifunović costs €45,000 compensation: the rest of this season and half of next season.');
    expect(compensationTerms('A', { salary: 6_000_000, rest: 0, laterSeasons: 0, later: 0, amount: 0 })).toBe('Sacking A costs nothing: the contract ends with this season.');
    // The sacking and replacement warnings on the Staff page show it before confirming.
    expect(sackingTerms(next, roleStaff(next, 'physio')[0]!, formatEuros)).toBe(`${physio.name} leaves the club today. ${compensationTerms(physio.name, compensation)} It is paid at once from Spending left.`);
    expect(replacementWarning(roleStaff(next, 'physio')[0]!, next)).toBe(`This replaces ${physio.name} as physio. ${compensationTerms(physio.name, compensation)} It is paid at once from Spending left.`);
    const sacked = releaseStaff(next, 'physio', physio.contractId);
    const entry = sacked.finance.ledger.at(-1)!;
    expect(entry).toMatchObject({ kind: 'staff-compensation', clubId: next.managedClubId, amount: -compensation.amount, sourceId: `staff-compensation-physio-${physio.contractId}` });
    expect(sacked.coaching.terms![physio.personId]).toBeUndefined();
    expect(roundTrip(sacked)).toEqual(sacked);
    // Replacing someone pays the same compensation; the new person's contract has the chosen length.
    const fitness = roleStaff(next, 'fitness')[0]!;
    const fitnessCompensation = contractCompensation(next, 'fitness', fitness.contractId)!;
    const incoming = [...availablePhysios(sacked)].sort((left, right) => left.fee - right.fee)[0]!;
    const hired = setStaffTerm(hirePhysio(sacked, incoming.id), incoming.id, 3);
    expect(hired.coaching.terms![incoming.id]).toMatchObject({ fromSeason: 1, untilSeason: 3 });
    expect(roundTrip(hired)).toEqual(hired);
    const choice = [...availableFitnessCoaches(hired)].sort((left, right) => left.fee - right.fee)[0]!;
    const replaced = replaceStaff(hired, 'fitness', fitness.contractId, choice.id);
    expect(replaced.finance.ledger.find(item => item.sourceId === `staff-compensation-fitness-${fitness.contractId}`)?.amount).toBe(-fitnessCompensation.amount);
    expect(roleStaff(replaced, 'fitness').map(member => member.personId)).toEqual([choice.id]);
    expect(roundTrip(replaced)).toEqual(replaced);
  }, 300_000);

  it('makes computer clubs pay compensation when they let someone go before the contract ends', () => {
    let state = career();
    while (state.status === 'active') state = play(state);
    const ai = state.clubs.find(club => club.id !== state.managedClubId)!.id;
    const physio = roleStaff(state, 'physio', ai)[0]!;
    // A three-season contract, let go after the first season (as when the club's money falls).
    state = { ...state, coaching: { ...state.coaching, terms: { ...state.coaching.terms, [physio.personId]: { clubId: ai, fromSeason: 1, untilSeason: 3 } } } };
    const next = { ...state, seasonNumber: 2, round: 1, status: 'active' as const };
    const kept = keepContractedStaff(next, state.coaching);
    const planned = { ...kept.state, physio: { ...kept.state.physio, contracts: kept.state.physio.contracts.map(contract => contract.id === physio.contractId ? { ...contract, renew: false } : contract) } };
    const paid = payComputerStaffCompensation(planned, kept.coaching);
    const entry = paid.finance.ledger.at(-1)!;
    // Half the salary of each of the two seasons left.
    expect(entry).toMatchObject({ kind: 'staff-compensation', clubId: ai, amount: -Math.round(staffFee(next, ai, staffMember(PHYSIO_DIRECTORY, physio.personId)!.fee) * 0.5) * 2 });
  }, 600_000);

  it('keeps contracted staff, ends finished contracts and renews at the contract end across a rollover, passing the strict check', () => {
    let state = setEmploymentDelegation(career(), true);
    const clubId = state.managedClubId;
    const [physio, fitness, assistant] = [roleStaff(state, 'physio')[0]!, roleStaff(state, 'fitness')[0]!, roleStaff(state, 'assistant')[0]!];
    state = setStaffTerm(setStaffTerm(setStaffTerm(state, physio.personId, 2), fitness.personId, 1), assistant.personId, 1);
    // Renew unticked for the physio (still under contract: stays) and the fitness coach (contract ends: leaves).
    state = { ...state, physio: { ...state.physio, contracts: state.physio.contracts.map(contract => contract.id === physio.contractId ? { ...contract, renew: false } : contract) },
      fitness: { ...state.fitness, contracts: state.fitness.contracts.map(contract => contract.id === fitness.contractId ? { ...contract, renew: false } : contract) } };
    while (state.status === 'active') state = play(state);
    expect(roundTrip(state)).toEqual(state);
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    state = rolloverSeason(state);
    expect(state.seasonNumber).toBe(2);
    expect(roleStaff(state, 'physio').map(member => member.personId)).toEqual([physio.personId]);
    expect(state.coaching.terms![physio.personId]).toMatchObject({ clubId, fromSeason: 1, untilSeason: 2 });
    expect(roleStaff(state, 'fitness').map(member => member.personId)).not.toContain(fitness.personId);
    expect(state.coaching.terms![fitness.personId]?.clubId).not.toBe(clubId);
    // Renewed at the contract's end for the same length again.
    expect(roleStaff(state, 'assistant').map(member => member.personId)).toEqual([assistant.personId]);
    expect(state.coaching.terms![assistant.personId]).toMatchObject({ clubId, fromSeason: 2, untilSeason: 2 });
    // Every employed person has a contract that runs at least through this season.
    for (const contract of seasonStaffContracts(state).filter(item => item.releasedRound === null && item.clubId !== clubId)) expect(state.coaching.terms![contract.personId]!.untilSeason).toBeGreaterThanOrEqual(2);
    expect(roundTrip(state)).toEqual(state);
    state = play(state);
    expect(roundTrip(state)).toEqual(state);
  }, 900_000);
});

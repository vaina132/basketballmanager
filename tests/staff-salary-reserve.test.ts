import { describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { withRealEconomy } from '../src/world/economy';
import { withLowerDivisions } from '../src/world/lower-division';
import { setEmploymentDelegation } from '../src/world/employment';
import { seasonRounds } from '../src/world/career-world';
import { getSpendableCash, getSpendablePosition } from '../src/world/payroll-policy';
import { appendFinanceLedgerEntry } from '../src/world/finance-ledger';
import { quoteStaffReplacement, releaseStaff, replaceStaff, roleStaff, STAFF_ROLES, staffReplacementSpending } from '../src/world/staff-roster';
import { contractCompensation, releasedStaffReserve, seasonStaffContracts, setStaffTerm, staffHireReserve, staffWageReserve } from '../src/world/staff-contracts';
import { staffHireSpending } from '../src/world/staff-policy';
import { availablePhysios, getClubPhysio, quotePhysioHire } from '../src/world/physio-policy';
import { hirePhysio, recruitAiPhysios } from '../src/world/physio';
import { staffFee } from '../src/world/economy';
import { payrollInstallment } from '../src/world/payroll-policy';
import { formatEuros } from '../src/ui/money-format';
import { financeLedgerCount } from '../src/world/finance-ledger';
import { FACILITY_BANK_REASON, getActiveFacilityProject, quoteFacilityUpgrade } from '../src/world/facilities-policy';
import { automateFacilities, setFacilityDelegation, startFacilityUpgrade } from '../src/world/facilities';
import { getInSeasonTransferCandidates, quoteInSeasonTransferOffer, requiredInSeasonTransferFee } from '../src/world/midseason-transfer-policy';

/** Two divisions of six clubs with researched money and a next division (as in staff-contracts.test.ts). */
function moneyWorld(): CareerWorld {
  const base = testWorld(12);
  const playerContracts = Object.fromEntries(base.clubs.flatMap(club => club.players.map((player, index) => [player.id, 1 + (index % 3)])));
  return withRealEconomy(withLowerDivisions({ ...base, id: 'staff-reserve-test', rosterModel: 'club-roster-1', playerContracts, domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
  ] }, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]));
}
const world = moneyWorld();
const roundTrip = (state: SeasonState) => parseSeason(serializeSeasonCompact(state));
const play = (state: SeasonState) => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const career = () => createSeason({ seed: 5, world, managedClubId: world.clubs[2]!.id, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
/** The same career read with the earlier rule (no staff salary reserve); nothing else in Spending left reads the model. */
const withoutReserve = (state: SeasonState): SeasonState => ({ ...state, coaching: { ...state.coaching, model: 'coaching-3' } });
/** Sets a club's money so that its Spending left before the staff reserve is exactly `position`. */
function withPosition(state: SeasonState, clubId: string, position: number): SeasonState {
  const amount = position - getSpendablePosition(withoutReserve(state), clubId);
  return { ...state, finance: appendFinanceLedgerEntry(state.finance, { clubId, kind: 'operations', amount, sourceId: `test-money-${clubId}-${state.finance.ledger.length}`, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null }) };
}
const staffPay = (state: SeasonState, clubId: string) => STAFF_ROLES.reduce((sum, role) => sum + roleStaff(state, role, clubId).reduce((total, member) => total + member.fee, 0), 0);
const contractIds = (state: SeasonState, clubId: string) => seasonStaffContracts(state).filter(contract => contract.clubId === clubId).map(contract => `${contract.role}/${contract.contractId}/${contract.releasedRound}`).sort();

describe('Spending left holds back staff salaries (format 76, coaching-4)', () => {
  it('reserves the rest of the season\'s staff salaries for human and computer clubs, and weekly payments release it', () => {
    let state = career();
    const clubId = state.managedClubId, ai = state.clubs.find(club => club.id !== clubId)!.id;
    for (const id of [clubId, ai]) {
      // At the opening every salary is owed in full, and Spending left falls by exactly that much.
      expect(staffWageReserve(state, id)).toBe(staffPay(state, id));
      expect(staffWageReserve(state, id)).toBeGreaterThan(0);
      expect(getSpendablePosition(state, id)).toBe(getSpendablePosition(withoutReserve(state), id) - staffWageReserve(state, id));
    }
    // Older careers (no staff contracts) are unchanged.
    expect(staffWageReserve(withoutReserve(state), clubId)).toBe(0);
    // Each week's payment releases exactly what it pays, while the staff stays the same.
    for (let week = 0; week < 3; week += 1) {
      const before = state, next = play(state);
      for (const id of [clubId, ai]) {
        if (contractIds(next, id).join() !== contractIds(before, id).join()) continue;
        const paid = -next.finance.ledger.filter(entry => entry.kind === 'staff-wages' && entry.clubId === id && entry.round === before.round).reduce((sum, entry) => sum + entry.amount, 0);
        expect(paid).toBeGreaterThan(0);
        expect(staffWageReserve(next, id)).toBe(staffWageReserve(before, id) - paid);
      }
      state = next;
    }
    // Sacking frees the person's remaining salary from the reserve (the compensation is paid instead).
    const physio = roleStaff(state, 'physio')[0]!;
    const sacked = releaseStaff(state, 'physio', physio.contractId);
    const rounds = seasonRounds(state), rest = Array.from({ length: rounds - state.round + 1 }, (_, index) => state.round + index).reduce((sum, round) => sum + Math.floor(physio.fee / rounds) + Math.floor(round * (physio.fee % rounds) / rounds) - Math.floor((round - 1) * (physio.fee % rounds) / rounds), 0);
    expect(staffWageReserve(sacked, clubId)).toBe(staffWageReserve(state, clubId) - rest);
    expect(roundTrip(sacked)).toEqual(sacked);
  }, 600_000);

  it('refuses a facility or an in-season transfer that would eat into staff pay, for the manager and computer clubs', () => {
    const state = career();
    const clubId = state.managedClubId, ai = state.clubs.find(club => club.id !== clubId)!.id;
    const reserve = staffWageReserve(state, clubId);
    // Facility: money for the upgrade only when staff pay is ignored.
    const cost = quoteFacilityUpgrade(state, 'training', clubId).cost;
    expect(cost).toBeGreaterThan(0);
    const tight = withPosition(state, clubId, cost + Math.floor(reserve / 2));
    expect(quoteFacilityUpgrade(withoutReserve(tight), 'training', clubId).canStart).toBe(true);
    const quote = quoteFacilityUpgrade(tight, 'training', clubId);
    expect(quote.canStart).toBe(false);
    expect(quote.reason).toBe(FACILITY_BANK_REASON);
    expect(() => startFacilityUpgrade(tight, 'training', clubId)).toThrow();
    // With the staff pay covered too, the same upgrade can start.
    expect(quoteFacilityUpgrade(withPosition(state, clubId, cost + reserve), 'training', clubId).canStart).toBe(true);

    // In-season transfer: the fee and the player's remaining salary fit only when staff pay is ignored.
    const player = getInSeasonTransferCandidates(state, clubId)[0]!;
    const fee = requiredInSeasonTransferFee(state, player.id), wage = 500_000;
    const rich = quoteInSeasonTransferOffer(withPosition(state, clubId, 1_000_000_000_000), player.id, wage, 1, fee, clubId);
    expect(rich.reason).toBeNull();
    const needed = fee + rich.remainingWages;
    const short = withPosition(state, clubId, needed + Math.floor(reserve / 2));
    expect(quoteInSeasonTransferOffer(withoutReserve(short), player.id, wage, 1, fee, clubId).reason).toBeNull();
    expect(quoteInSeasonTransferOffer(short, player.id, wage, 1, fee, clubId).reason).toBe('The transfer fee and remaining salary exceed the available budget after existing commitments.');

    // A computer club's board follows the same rule: no automatic upgrade that would eat into its staff pay.
    const aiReserve = staffWageReserve(state, ai);
    const cheapest = Math.min(...(['training', 'medical', 'youth', 'scouting'] as const).map(type => quoteFacilityUpgrade(state, type, ai)).filter(item => item.cost > 0).map(item => item.cost));
    const aiTight = setFacilityDelegation(withPosition(state, ai, cheapest * 4 + Math.floor(aiReserve / 2)), true);
    expect(getActiveFacilityProject(automateFacilities(withoutReserve(aiTight)), ai)).not.toBeNull();
    const automated = automateFacilities(aiTight);
    if (getActiveFacilityProject(automated, ai)) expect(getSpendablePosition(automated, ai)).toBeGreaterThanOrEqual(0);
    expect(getSpendableCash(aiTight, ai)).toBe(Math.max(0, getSpendablePosition(withoutReserve(aiTight), ai) - aiReserve));
  }, 600_000);

  it('plays a delegated season with the reserve and passes the strict save check at the end', () => {
    let state = setFacilityDelegation(setEmploymentDelegation(career(), true), true);
    const clubId = state.managedClubId;
    /** Every computer club that took on someone new this week has Spending left of zero or more afterwards. */
    const checkComputerHires = (before: SeasonState, after: SeasonState) => {
      for (const club of after.clubs.filter(club => club.id !== clubId)) {
        const old = new Set(contractIds(before, club.id).filter(id => id.endsWith('/null')).map(id => id.split('/').slice(0, 2).join('/')));
        const hired = contractIds(after, club.id).filter(id => id.endsWith('/null') && !old.has(id.split('/').slice(0, 2).join('/')));
        if (hired.length && after.seasonNumber === before.seasonNumber) expect(getSpendablePosition(after, club.id)).toBeGreaterThanOrEqual(0);
      }
    };
    for (let week = 0; week < 4; week += 1) { const next = play(state); checkComputerHires(state, next); state = next; }
    // A mid-season sacking (compensation) and a strict round trip in the middle of the season.
    state = releaseStaff(state, 'fitness', roleStaff(state, 'fitness')[0]!.contractId);
    expect(roundTrip(state)).toEqual(state);
    // A replacement on the shared Spending left check, then a strict round trip.
    const physio = roleStaff(state, 'physio')[0]!, cheapest = [...availablePhysios(state)].sort((left, right) => left.fee - right.fee)[0]!;
    expect(quoteStaffReplacement(state, 'physio', physio.contractId, cheapest.id)).toMatchObject({ canReplace: true, reason: null });
    state = replaceStaff(state, 'physio', physio.contractId, cheapest.id);
    expect(roundTrip(state)).toEqual(state);
    while (state.status === 'active') { const next = play(state); checkComputerHires(state, next); state = next; }
    expect(staffWageReserve(state, clubId)).toBe(0);
    expect(roundTrip(state)).toEqual(state);
  }, 900_000);
});

describe('a staff hire needs Spending left for the rest of the season (format 76, coaching-4)', () => {
  /** A club's Spending left set to exactly `amount` (after the staff reserve). */
  const withSpending = (state: SeasonState, clubId: string, amount: number) => withPosition(state, clubId, amount + staffWageReserve(state, clubId));
  const cheapestPhysio = (state: SeasonState) => [...availablePhysios(state)].sort((left, right) => left.fee - right.fee || left.id.localeCompare(right.id))[0]!;

  it('refuses a hire when Spending left is short and allows it when it fits, with the exact figures', () => {
    const opened = play(career());
    const clubId = opened.managedClubId;
    // A vacancy: the manager sacks the physio, then looks for a new one.
    const vacant = releaseStaff(withSpending(opened, clubId, 1_000_000_000_000), 'physio', roleStaff(opened, 'physio')[0]!.contractId);
    const physio = cheapestPhysio(vacant), salary = staffFee(vacant, clubId, physio.fee);
    const needed = staffHireReserve(vacant, salary), rounds = seasonRounds(vacant);
    // The salary of the weeks still to pay this season (this week included, nothing paid yet this week).
    expect(needed).toBe(Array.from({ length: rounds - vacant.round + 1 }, (_, index) => payrollInstallment(salary, vacant.round + index, rounds)).reduce((sum, value) => sum + value, 0));
    expect(needed).toBeGreaterThan(0);
    expect(needed).toBeLessThan(salary);

    const short = withSpending(vacant, clubId, needed - 1);
    expect(getSpendableCash(short, clubId)).toBe(needed - 1);
    const quote = quotePhysioHire(short, physio.id);
    expect(quote.canHire).toBe(false);
    expect(quote.reason!.startsWith(`Not enough Spending left: this hire needs ${formatEuros(needed)} for the rest of the season, you have ${formatEuros(needed - 1)}.`)).toBe(true);
    expect(staffHireSpending(short, clubId, salary)).toEqual({ needed, available: needed - 1, after: -1 });
    expect(() => hirePhysio(short, physio.id)).toThrow('Not enough Spending left');
    // A computer club follows the same rule.
    const ai = opened.clubs.find(club => club.id !== clubId)!.id, aiSalary = staffFee(vacant, ai, physio.fee);
    const aiVacant: SeasonState = { ...vacant, physio: { ...vacant.physio, contracts: vacant.physio.contracts.map(contract => contract.clubId === ai && contract.releasedRound === null && contract.seasonNumber === vacant.seasonNumber ? { ...contract, releasedRound: vacant.round, releasedLedgerIndex: financeLedgerCount(vacant.finance) } : contract) } };
    const aiShort = withSpending(aiVacant, ai, staffHireReserve(vacant, aiSalary) - 1);
    expect(quotePhysioHire(aiShort, physio.id, ai).reason).toBe(`Not enough Spending left: this hire needs ${formatEuros(staffHireReserve(vacant, aiSalary))} for the rest of the season, you have ${formatEuros(staffHireReserve(vacant, aiSalary) - 1)}.`);

    // Exactly enough: the hire goes through and Spending left ends at zero, as the hire review said.
    const enough = withSpending(vacant, clubId, needed);
    expect(quotePhysioHire(enough, physio.id).canHire).toBe(true);
    expect(staffHireSpending(enough, clubId, salary)!.after).toBe(0);
    const hired = hirePhysio(enough, physio.id);
    expect(getSpendablePosition(hired, clubId)).toBe(0);
    // Older careers keep their rules (no salary reserve, no such check).
    expect(staffHireSpending(withoutReserve(short), clubId, salary)).toBeNull();
  }, 600_000);

  it('counts a replacement as one change: compensation, minus the freed salary, plus the new salary', () => {
    const opened = play(career());
    const clubId = opened.managedClubId;
    const outgoing = roleStaff(opened, 'physio')[0]!;
    const state = setStaffTerm(withSpending(opened, clubId, 0), outgoing.personId, 3);
    const incoming = cheapestPhysio(state), salary = staffFee(state, clubId, incoming.fee);
    const compensation = contractCompensation(state, 'physio', outgoing.contractId)!;
    expect(compensation.later).toBeGreaterThan(0);
    const needed = compensation.amount - releasedStaffReserve(state, 'physio', outgoing.contractId) + staffHireReserve(state, salary);
    expect(releasedStaffReserve(state, 'physio', outgoing.contractId)).toBe(compensation.rest);
    expect(needed).toBeGreaterThan(0);

    const short = withSpending(state, clubId, needed - 1);
    expect(staffReplacementSpending(short, 'physio', outgoing.contractId, incoming.id)).toEqual({ needed, available: needed - 1, after: -1 });
    const message = `Not enough Spending left: this hire needs ${formatEuros(needed)} for the rest of the season, you have ${formatEuros(needed - 1)}.`;
    expect(() => replaceStaff(short, 'physio', outgoing.contractId, incoming.id)).toThrow(message);
    const quote = quoteStaffReplacement(short, 'physio', outgoing.contractId, incoming.id);
    expect(quote.canReplace).toBe(false);
    expect(quote.reason!.startsWith(message)).toBe(true);

    // Exactly enough: the whole change fits and leaves Spending left at zero (the compensation counted once).
    const enough = withSpending(state, clubId, needed);
    const replaced = replaceStaff(enough, 'physio', outgoing.contractId, incoming.id);
    expect(getSpendablePosition(replaced, clubId)).toBe(0);
    expect(-replaced.finance.ledger.filter(entry => entry.kind === 'staff-compensation').reduce((sum, entry) => sum + entry.amount, 0)).toBe(compensation.amount);
  }, 600_000);

  it('lets computer clubs hire only staff whose salary Spending left carries', () => {
    const opened = play(career());
    const ais = opened.clubs.filter(club => club.id !== opened.managedClubId).map(club => club.id);
    // Every computer club's physio leaves (as if his contract ended), and the clubs get different Spending left.
    let state: SeasonState = { ...opened, physio: { ...opened.physio, contracts: opened.physio.contracts.map(contract => ais.includes(contract.clubId) && contract.releasedRound === null && contract.seasonNumber === opened.seasonNumber ? { ...contract, releasedRound: opened.round, releasedLedgerIndex: financeLedgerCount(opened.finance) } : contract) } };
    const cheapest = cheapestPhysio(state);
    const levels = ais.map((clubId, index) => ({ clubId, amount: [0, staffHireReserve(state, staffFee(state, clubId, cheapest.fee)) - 1, 1_000_000_000_000][index % 3]! }));
    for (const { clubId, amount } of levels) state = withSpending(state, clubId, amount);
    const after = recruitAiPhysios(state);
    for (const { clubId, amount } of levels) {
      const hired = getClubPhysio(after, clubId) !== null;
      if (amount < 1_000_000_000_000) expect(hired).toBe(false);
      if (hired) expect(getSpendablePosition(after, clubId)).toBeGreaterThanOrEqual(0);
    }
    expect(levels.some(({ clubId, amount }) => amount === 1_000_000_000_000 && getClubPhysio(after, clubId) !== null)).toBe(true);
  }, 600_000);
});

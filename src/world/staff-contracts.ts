import type { SeasonState } from '../domain/season';
import type { SeasonCoaching, StaffTerm } from '../domain/coaching';
import type { WorldContext } from '../domain/world';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY, staffMember } from '../data/staff-directory';
import { staffFee } from './economy';
import { getSpendablePosition, payrollInstallment } from './payroll-policy';
import { seasonRounds } from './career-world';
import { formatEuros } from '../ui/money-format';
import { appendFinanceLedgerEntry } from './finance-ledger';
import { staffLedgerEvidence } from './finance-ledger-index';
import type { StaffRole } from './staff-levels';

/**
 * Staff contracts like players' (owner decision, 18 November 2026; format 76, stored as `coaching.model` 'coaching-4').
 * Reversible defaults:
 * - Every staff member has a contract of 1-3 seasons (`coaching.terms`, by person). Opening staff get a stable length
 *   of 1-3 seasons from the career seed; the manager chooses 1, 2 or 3 seasons when hiring; computer clubs sign
 *   `computerSeasons` seasons. A hire without a chosen length runs to the end of the current season.
 * - The catalog fee at the club's money level is the person's **annual salary**. It counts against Wages left like a
 *   player's wage and is paid in weekly installments, like player wages (no up-front fee). The salary still to pay
 *   this season is held back from Spending left like player wages (`staffWageReserve`, read from the ledger, so strict
 *   replays of past money decisions see the reserve of their moment).
 * - Contracts end at a season end. A person under contract stays; at the contract's end the Renew choice decides, and a
 *   renewal runs for the same length again.
 * - Sacking (or replacing) someone costs compensation, paid at once from Spending left: the rest of this season's
 *   salary plus `laterSeasonShare` (50%) of the salary of each later season left on the contract (staff usually find
 *   a new job). Computer clubs pay it too when they let someone go before the contract ends.
 */
export const STAFF_CONTRACT_RULES = Object.freeze({ seasons: Object.freeze([1, 2, 3] as const), laterSeasonShare: 0.5, computerSeasons: 2 });

export function usesStaffContracts(state: { coaching?: { model: string } }): boolean {
  return state.coaching?.model === 'coaching-4';
}

type StaffState = Pick<SeasonState, 'coaching' | 'seasonNumber'> & Partial<Pick<SeasonState, 'scouts' | 'fitness' | 'physio' | 'assistant' | 'youth'>>;
/** One staff contract of any role, as the shared staff rules read it. */
export interface StaffContractView { role: StaffRole; contractId: string; personId: string; clubId: string; seasonNumber: number; startedRound: number; releasedRound: number | null; renew: boolean; catalogFee: number }

const view = (role: StaffRole, contract: { id: string; clubId: string; seasonNumber: number; startedRound: number; releasedRound: number | null; renew: boolean }, personId: string, catalogFee: number | undefined): StaffContractView[] =>
  catalogFee === undefined ? [] : [{ role, contractId: contract.id, personId, clubId: contract.clubId, seasonNumber: contract.seasonNumber, startedRound: contract.startedRound, releasedRound: contract.releasedRound, renew: contract.renew, catalogFee }];

/** Every staff contract of a season (released ones included), across the six roles. */
export function seasonStaffContracts(state: StaffState, seasonNumber = state.seasonNumber): StaffContractView[] {
  const of = <C extends { seasonNumber: number }>(contracts: readonly C[] | undefined) => (contracts ?? []).filter(contract => contract.seasonNumber === seasonNumber);
  return [
    ...of(state.coaching.contracts).flatMap(contract => view('coaches', contract, contract.coachId, staffMember(COACH_DIRECTORY, contract.coachId)?.fee)),
    ...of(state.scouts?.contracts).flatMap(contract => view('scouts', contract, contract.scoutId, staffMember(SCOUT_DIRECTORY, contract.scoutId)?.fee)),
    ...of(state.fitness?.contracts).flatMap(contract => view('fitness', contract, contract.coachId, staffMember(FITNESS_DIRECTORY, contract.coachId)?.fee)),
    ...of(state.physio?.contracts).flatMap(contract => view('physio', contract, contract.physioId, staffMember(PHYSIO_DIRECTORY, contract.physioId)?.fee)),
    ...of(state.assistant?.contracts).flatMap(contract => view('assistant', contract, contract.assistantId, staffMember(ASSISTANT_DIRECTORY, contract.assistantId)?.fee)),
    ...of(state.youth?.contracts).flatMap(contract => view('youth', contract, contract.coachId, staffMember(YOUTH_COACH_DIRECTORY, contract.coachId)?.fee)),
  ];
}

/** The last season of a person's contract at a club (the current season when no length was recorded). */
export function contractUntil(state: Pick<SeasonState, 'coaching' | 'seasonNumber'>, personId: string, clubId: string): number {
  const term = state.coaching.terms?.[personId];
  return term && term.clubId === clubId ? term.untilSeason : state.seasonNumber;
}

/** A season's salary installment for a week (the same split as player wages). */
const installment = (salary: number, round: number, rounds: number) => payrollInstallment(salary, round, rounds);
/** The installments of weeks `from` to `through` together (the same split, summed in one step). */
function installmentsBetween(salary: number, from: number, through: number, rounds: number): number {
  if (through < from) return 0;
  const base = Math.floor(salary / rounds), remainder = salary % rounds;
  return base * (through - from + 1) + Math.floor(through * remainder / rounds) - Math.floor((from - 1) * remainder / rounds);
}

/** The salary still owed this season from the current week on (nothing once the season is complete). */
export function restOfSeasonSalary(state: Pick<SeasonState, 'round' | 'status'> & WorldContext, salary: number): number {
  if (state.status === 'complete') return 0;
  const rounds = seasonRounds(state);
  return installmentsBetween(salary, state.round, rounds, rounds);
}

export interface StaffCompensation { salary: number; rest: number; laterSeasons: number; later: number; amount: number }
/** What letting a person go now costs: the rest of this season's salary and half of each later season's. */
export function staffCompensation(state: SeasonState, contract: Pick<StaffContractView, 'personId' | 'clubId' | 'catalogFee'>): StaffCompensation {
  const salary = staffFee(state, contract.clubId, contract.catalogFee);
  const rest = restOfSeasonSalary(state, salary);
  const laterSeasons = Math.max(0, contractUntil(state, contract.personId, contract.clubId) - state.seasonNumber);
  const later = Math.round(salary * STAFF_CONTRACT_RULES.laterSeasonShare) * laterSeasons;
  return { salary, rest, laterSeasons, later, amount: rest + later };
}

/** The compensation for one of a club's current contracts (by role and contract), or undefined. */
export function contractCompensation(state: SeasonState, role: StaffRole, contractId: string): StaffCompensation | undefined {
  const contract = seasonStaffContracts(state).find(item => item.role === role && item.contractId === contractId);
  return contract ? staffCompensation(state, contract) : undefined;
}

/** The warning before a sacking, with the exact compensation. */
export function compensationTerms(name: string, compensation: StaffCompensation): string {
  if (compensation.amount === 0) return `Sacking ${name} costs nothing: the contract ends with this season.`;
  const parts = [compensation.rest > 0 ? 'the rest of this season' : null, compensation.laterSeasons === 1 ? 'half of next season' : compensation.laterSeasons > 1 ? `half of each of the ${compensation.laterSeasons} later seasons` : null].filter(Boolean);
  return `Sacking ${name} costs ${formatEuros(compensation.amount)} compensation: ${parts.join(' and ')}.`;
}

function withoutTerm(coaching: SeasonCoaching, personId: string): SeasonCoaching {
  if (!coaching.terms || !Object.hasOwn(coaching.terms, personId)) return coaching;
  const { [personId]: _removed, ...terms } = coaching.terms;
  return { ...coaching, terms };
}

/** Records a contract's length for a person hired now (1, 2 or 3 seasons, ending at a season end). */
export function setStaffTerm(state: SeasonState, personId: string, seasons: number): SeasonState {
  if (!usesStaffContracts(state)) return state;
  if (!STAFF_CONTRACT_RULES.seasons.includes(seasons as 1 | 2 | 3)) throw new Error('Choose a contract of 1, 2 or 3 seasons.');
  const contract = seasonStaffContracts(state).find(item => item.personId === personId && item.releasedRound === null);
  if (!contract) throw new Error('Choose a person your club employs now.');
  const term: StaffTerm = { clubId: contract.clubId, fromSeason: state.seasonNumber, untilSeason: state.seasonNumber + seasons - 1 };
  return { ...state, coaching: { ...state.coaching, terms: { ...state.coaching.terms, [personId]: term } } };
}

/** A hire with the length the manager chose (no change when none was chosen or the career has no staff contracts). */
export function withChosenTerm(state: SeasonState, personId: string, seasons: number | undefined): SeasonState {
  return seasons === undefined || !usesStaffContracts(state) ? state : setStaffTerm(state, personId, seasons);
}

/** A fixed number in [0, 1) for a text (FNV-1a), never match randomness. */
function unitHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash / 0x1_0000_0000;
}

/** The opening staff's contracts: a stable 1-3 seasons each, from the career seed. */
export function withOpeningStaffTerms(state: SeasonState): SeasonState {
  const terms: Record<string, StaffTerm> = {};
  for (const contract of seasonStaffContracts(state)) if (contract.releasedRound === null) {
    const seasons = 1 + Math.floor(unitHash(`${state.seed}|${contract.clubId}|${contract.personId}|term`) * 3);
    terms[contract.personId] = { clubId: contract.clubId, fromSeason: state.seasonNumber, untilSeason: state.seasonNumber + seasons - 1 };
  }
  return { ...state, coaching: { ...state.coaching, terms } };
}

/** Computer clubs' new appointments get the computer contract length (the manager's hires keep the length chosen). */
export function withComputerStaffTerms(state: SeasonState): SeasonState {
  if (!usesStaffContracts(state)) return state;
  const missing = seasonStaffContracts(state).filter(contract => contract.releasedRound === null && contract.clubId !== state.managedClubId && state.coaching.terms?.[contract.personId]?.clubId !== contract.clubId);
  if (!missing.length) return state;
  const terms = { ...state.coaching.terms };
  for (const contract of missing) terms[contract.personId] = { clubId: contract.clubId, fromSeason: state.seasonNumber, untilSeason: state.seasonNumber + STAFF_CONTRACT_RULES.computerSeasons - 1 };
  return { ...state, coaching: { ...state.coaching, terms } };
}

/**
 * The salaries a club owes for one week: every person employed when the week is paid (hired by then, not released
 * before it). Computer clubs' appointments made after a week's payments carry that week's round, so a strict check
 * passes `hiredBefore` to leave out appointments made after the payment.
 */
export function staffWeekWages(state: StaffState & WorldContext, clubId: string, round: number, rounds: number, hiredBefore: (contract: StaffContractView) => boolean = () => true): number {
  return seasonStaffContracts(state).filter(contract => contract.clubId === clubId && contract.startedRound <= round && (contract.releasedRound === null || contract.releasedRound > round) && hiredBefore(contract))
    .reduce((sum, contract) => sum + installment(staffFee(state, clubId, contract.catalogFee), round, rounds), 0);
}

/** Each appointment entry kind's role and the catalog its person comes from. */
const APPOINTMENTS: Readonly<Record<string, { role: StaffRole; directory: readonly { id: string; fee: number }[] }>> = Object.freeze({
  coaching: { role: 'coaches', directory: COACH_DIRECTORY }, scouting: { role: 'scouts', directory: SCOUT_DIRECTORY }, fitness: { role: 'fitness', directory: FITNESS_DIRECTORY },
  physio: { role: 'physio', directory: PHYSIO_DIRECTORY }, assistant: { role: 'assistant', directory: ASSISTANT_DIRECTORY }, youth: { role: 'youth', directory: YOUTH_COACH_DIRECTORY },
});

/**
 * The staff salaries still to pay this season, held back from Spending left like player wages (owner, 18 November
 * 2026; `coaching-4` only, the same rule for every club). Read from the ledger alone, so a strict check that cuts the
 * ledger at a past decision gets the reserve the game used then, even in an earlier season whose staff contracts are
 * no longer kept: every appointment booked this season (its entry names the person and its week, the contract's first
 * week) counts its salary installments from the week after the last week whose staff salaries were paid (so a computer
 * club's appointment made after a week's payments starts with the next week, as it is paid) to the season's end, or to
 * the week before an early release once its compensation is booked (a release booked with no compensation leaves no
 * salary to pay).
 */
export function staffWageReserve(state: Partial<Pick<SeasonState, 'coaching' | 'finance'>> & Pick<SeasonState, 'seasonNumber'> & WorldContext, clubId: string): number {
  if (!state.coaching || !usesStaffContracts(state) || !state.finance?.enabledSince) return 0;
  const rounds = seasonRounds(state), evidence = staffLedgerEvidence(state.finance), year = state.seasonNumber, paidThrough = evidence.paidThrough(year);
  if (paidThrough >= rounds) return 0;
  let reserve = 0;
  for (const appointment of evidence.appointments(year, clubId)) {
    const source = APPOINTMENTS[appointment.kind], catalogFee = source ? staffMember(source.directory, appointment.personId)?.fee : undefined;
    if (!source || catalogFee === undefined) continue;
    const released = evidence.releasedRound(year, clubId, staffCompensationSourceId(source.role, appointment.contractId));
    reserve += installmentsBetween(staffFee(state, clubId, catalogFee), Math.max(paidThrough + 1, appointment.round), released === undefined ? rounds : released - 1, rounds);
  }
  return reserve;
}

/** The kinds of staff money entries format 76 books. */
export const STAFF_WAGES_KIND = 'staff-wages';
export const STAFF_COMPENSATION_KIND = 'staff-compensation';
export const staffWagesSourceId = (seasonNumber: number, round: number) => `staff-wages-s${seasonNumber}-r${round}`;
export const staffCompensationSourceId = (role: StaffRole, contractId: string) => `staff-compensation-${role}-${contractId}`;

/** Books a staff money entry on the current boundary (no details). */
function bookEntry(state: SeasonState, clubId: string, kind: 'staff-wages' | 'staff-compensation', amount: number, sourceId: string): SeasonState {
  return { ...state, finance: appendFinanceLedgerEntry(state.finance, { clubId, kind, amount, sourceId, seasonNumber: state.seasonNumber, round: state.round, ticket: null, coach: null, payroll: null }) };
}

/** The week's staff salaries for every club, booked before the player wages (format 76). */
export function processStaffWagesRound(state: SeasonState): SeasonState {
  if (!usesStaffContracts(state) || !state.finance.enabledSince) return state;
  const rounds = seasonRounds(state);
  let next = state;
  for (const club of state.clubs) {
    const amount = staffWeekWages(state, club.id, state.round, rounds);
    if (amount > 0) next = bookEntry(next, club.id, STAFF_WAGES_KIND, -amount, staffWagesSourceId(state.seasonNumber, state.round));
  }
  return next;
}

/**
 * After a release (the contract already marked released): the compensation is paid at once and the contract's length
 * is forgotten. The club needs the compensation in Spending left (after the release, which frees the person's salary).
 */
export function payStaffCompensation(released: SeasonState, role: StaffRole, contractId: string): SeasonState {
  if (!usesStaffContracts(released)) return released;
  const contract = seasonStaffContracts(released).find(item => item.role === role && item.contractId === contractId);
  if (!contract) return released;
  const compensation = staffCompensation(released, contract);
  // The reserve still holds the released person's salary until the compensation is booked; it is freed here.
  const spending = released.finance.enabledSince ? Math.max(0, getSpendablePosition(released, contract.clubId) + compensation.rest) : null;
  if (spending !== null && compensation.amount > spending) throw new Error(`Not enough Spending left: sacking costs ${formatEuros(compensation.amount)} compensation, you have ${formatEuros(spending)} to spend.`);
  let next: SeasonState = { ...released, coaching: withoutTerm(released.coaching, contract.personId) };
  if (compensation.amount > 0 && next.finance.enabledSince) next = bookEntry(next, contract.clubId, STAFF_COMPENSATION_KIND, -compensation.amount, staffCompensationSourceId(role, contractId));
  return next;
}

/**
 * Before the new season's renewals: a person still under contract stays (Renew applies only at a contract's end).
 * Returns the previous coaching with those coaches marked to renew and the state with the other roles marked.
 */
export function keepContractedStaff(state: SeasonState, previous: SeasonCoaching): { state: SeasonState; coaching: SeasonCoaching } {
  if (!usesStaffContracts(state)) return { state, coaching: previous };
  const year = state.seasonNumber - 1;
  const terms = previous.terms ?? {};
  const contracted = (personId: string, clubId: string, contract: { seasonNumber: number; releasedRound: number | null }) => contract.seasonNumber === year && contract.releasedRound === null && terms[personId]?.clubId === clubId && terms[personId]!.untilSeason >= state.seasonNumber;
  const mark = <C extends { clubId: string; seasonNumber: number; releasedRound: number | null; renew: boolean }>(contracts: C[], person: (contract: C) => string): C[] => contracts.map(contract => contracted(person(contract), contract.clubId, contract) && !contract.renew ? { ...contract, renew: true } : contract);
  return {
    coaching: { ...previous, contracts: mark(previous.contracts, contract => contract.coachId) },
    state: { ...state,
      scouts: { ...state.scouts, contracts: mark(state.scouts.contracts, contract => contract.scoutId) },
      fitness: { ...state.fitness, contracts: mark(state.fitness.contracts, contract => contract.coachId) },
      physio: { ...state.physio, contracts: mark(state.physio.contracts, contract => contract.physioId) },
      assistant: { ...state.assistant, contracts: mark(state.assistant.contracts, contract => contract.assistantId) },
      youth: { ...state.youth, contracts: mark(state.youth.contracts, contract => contract.coachId) },
    },
  };
}

/**
 * After computer clubs planned their renewals: everyone they let go while still under contract is paid compensation
 * (the previous season is over, so half the salary of each season left), on the new season's opening day.
 */
export function payComputerStaffCompensation(planned: SeasonState, previous: SeasonCoaching): SeasonState {
  if (!usesStaffContracts(planned) || !planned.finance.enabledSince) return planned;
  const year = planned.seasonNumber - 1, terms = previous.terms ?? {};
  let next = planned;
  const leaving = seasonStaffContracts({ ...planned, coaching: previous, seasonNumber: year }, year).filter(contract => contract.clubId !== planned.managedClubId && contract.releasedRound === null && !contract.renew && terms[contract.personId]?.clubId === contract.clubId && terms[contract.personId]!.untilSeason >= planned.seasonNumber && planned.clubs.some(club => club.id === contract.clubId));
  for (const contract of leaving) {
    const salary = staffFee(planned, contract.clubId, contract.catalogFee);
    const amount = Math.round(salary * STAFF_CONTRACT_RULES.laterSeasonShare) * (terms[contract.personId]!.untilSeason - planned.seasonNumber + 1);
    if (amount > 0) next = bookEntry(next, contract.clubId, STAFF_COMPENSATION_KIND, -amount, staffCompensationSourceId(contract.role, contract.contractId));
  }
  return next;
}

/**
 * After the new season's renewals: contracts still running keep their length; a contract renewed at its end runs for
 * the same length again; everyone else's length is forgotten.
 */
export function settleStaffTerms(state: SeasonState, previous: SeasonCoaching): SeasonState {
  if (!usesStaffContracts(state)) return state;
  const old = previous.terms ?? {}, terms: Record<string, StaffTerm> = {};
  for (const contract of seasonStaffContracts(state)) if (contract.releasedRound === null) {
    const term = old[contract.personId];
    if (term && term.clubId === contract.clubId && term.untilSeason >= state.seasonNumber) terms[contract.personId] = term;
    else {
      const length = term && term.clubId === contract.clubId ? term.untilSeason - term.fromSeason + 1 : 1;
      terms[contract.personId] = { clubId: contract.clubId, fromSeason: state.seasonNumber, untilSeason: state.seasonNumber + length - 1 };
    }
  }
  return { ...state, coaching: { ...state.coaching, terms } };
}

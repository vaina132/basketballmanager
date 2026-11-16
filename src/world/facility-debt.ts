import type { FacilityDebt, FacilityType, SeasonFacilities } from '../domain/facilities';
import type { FinanceEntry } from '../domain/finance';
import type { WorldContext } from '../domain/world';
import { roundKey, seasonRounds } from './career-world';
import { scaledMoney } from './economy';
import { financeLedgerCount, financeLedgerEntries, type FinanceLedgerSource } from './finance-ledger';
import { dateForRound } from './season';

/**
 * Loans and leases for facility projects (format 71, `loans-1`, new careers; owner-approved saved idea, 15 November
 * 2026). These are provisional, reversible game defaults, not real bank terms. Money is in euro cents of the development
 * economy; real-data worlds scale every amount with the club's money level (`scaledMoney`), like facility costs.
 * Older careers keep paying upfront.
 */
export const FACILITY_FINANCING_RULES = Object.freeze({
  /**
   * Loans and leases together may not exceed this outstanding amount: EUR 300,000 in the development economy, about
   * 1.25 times the top arena upgrade. Outstanding means a loan's remaining principal and a lease's remaining payments.
   */
  borrowingLimit: 30_000_000,
  /** Terms a club can choose, in seasons. */
  termSeasons: Object.freeze([2, 3, 4, 5]) as readonly number[],
  /** Payment weeks: this share of the season's weeks, rounded up (weeks 3 and 8 of the development league's ten). */
  paymentWeekPercents: Object.freeze([25, 75]) as readonly number[],
  /**
   * Fixed yearly loan rate: 4%, plus up to 2 points in proportion to the club's debt after borrowing (against its
   * limit), plus 1 point when its Remaining budget is below the automatic cash cushion; quarter-point steps, at most 7%.
   * Each payment charges half the yearly rate on the remaining principal (equal payments, two a season).
   */
  baseRateBasisPoints: 400,
  leverageRateBasisPoints: 200,
  thinCashRateBasisPoints: 100,
  rateStepBasisPoints: 25,
  maxRateBasisPoints: 700,
  /** The smallest loan (EUR 1,000 in the development economy); amounts are whole euros. */
  minimumPrincipal: 100_000,
  /** Repaying a loan early settles its remaining principal plus this fee; the interest not yet due is saved. */
  earlyRepaymentFeePercent: 2,
  /** Facilities that can be leased: arena seating and training equipment. */
  leaseTypes: Object.freeze(['arena', 'training']) as readonly FacilityType[],
  /** A lease costs the purchase price plus this premium for each season of its term (two seasons 114%, five 135%). */
  leasePremiumPercentPerSeason: 7,
  /** Ending a lease early hands the leased level back and costs this share of the payments still to come. */
  leaseEndPenaltyPercent: 25,
  /** Board reviews: no effect up to this debt ratio (percent of the borrowing limit), then -1 per started 15 points, at most -4. */
  boardDebtFreePercent: 40,
  boardDebtStepPercent: 15,
  boardDebtImpactMax: 4,
  /** Capital requests: the confidence the board requires rises by 5 from a 50% debt ratio and by 10 from 80%. */
  boardCapitalSurcharge: Object.freeze([Object.freeze([80, 10]), Object.freeze([50, 5])]) as readonly (readonly [number, number])[],
  /**
   * Rival clubs (and automatic control) borrow only for a valuable project they cannot fund from cash or board
   * capital: the repair of a facility below the automatic repair condition, or a bigger arena after their last two
   * home games sold out. One loan at a time, up to half the limit, keeping half their cash cushion, over three seasons.
   */
  automaticMaxDebtPercent: 50,
  automaticTermSeasons: 3,
  automaticSoldOutGames: 2,
  // Rival clubs (and automatic control) also lease (`automaticLease` in facilities.ts), under the manager's lease guards,
  // one level at a time over the automatic term and within the same half of the limit: more seats after sold-out home
  // games when a loan cannot pay for them (one is already running, or its terms do not fit), keeping half their cash
  // cushion after this season's payments; or training equipment below the average level of the club's league, only
  // without any other debt and keeping their whole cushion after this season's payments.
});

/** Careers started with facility financing (format 71). */
export const usesFacilityFinancing = (facilities: Pick<SeasonFacilities, 'financing'> | undefined): boolean => facilities?.financing === 'loans-1';

/** What the debt calculations read: the debts, the ledger prefix they are judged at, and the season. */
export type DebtContext = { facilities?: Pick<SeasonFacilities, 'financing' | 'debts'>; finance: FinanceLedgerSource; seasonNumber: number } & WorldContext;

export interface DebtPayment {
  /** 1-based. */
  number: number;
  seasonNumber: number;
  round: number;
  date: string;
  amount: number;
  /** The part that reduces the principal (a lease's whole payment). */
  principal: number;
  /** Loan: the principal still owed after this payment. Lease: the payments still to come. */
  balanceAfter: number;
}

/** The terms that fix a schedule; a debt record carries them. */
export type DebtTerms = Pick<FacilityDebt, 'kind' | 'principal' | 'rateBasisPoints' | 'seasons' | 'payment' | 'total' | 'seasonNumber' | 'round'>;

/** The season's payment weeks for its length. */
export function paymentRounds(rounds: number): number[] {
  return [...new Set(FACILITY_FINANCING_RULES.paymentWeekPercents.map(percent => Math.max(1, Math.min(rounds, Math.ceil(rounds * percent / 100)))))].sort((a, b) => a - b);
}

/** The payment weeks after a start, `count` of them, in calendar order. */
function paymentSlots(seasonNumber: number, round: number, count: number, rounds: number): { seasonNumber: number; round: number }[] {
  const weeks = paymentRounds(rounds), slots: { seasonNumber: number; round: number }[] = [];
  for (let season = seasonNumber; slots.length < count; season += 1) for (const week of weeks) if (slots.length < count && roundKey(season, week) > roundKey(seasonNumber, round)) slots.push({ seasonNumber: season, round: week });
  return slots;
}

const perPaymentRate = (rateBasisPoints: number, rounds: number) => rateBasisPoints / 10_000 / paymentRounds(rounds).length;

/**
 * The equal payment of a loan, rounded up to whole euros: the annuity for `principal` over `payments` payments at
 * half the yearly rate each (growth by repeated multiplication, so every engine computes the same cents).
 */
export function loanPayment(principal: number, rateBasisPoints: number, payments: number, rounds: number): number {
  const rate = perPaymentRate(rateBasisPoints, rounds);
  let growth = 1;
  for (let index = 0; index < payments; index += 1) growth *= 1 + rate;
  const exact = rate === 0 ? principal / payments : principal * rate * growth / (growth - 1);
  return Math.ceil(exact / 100) * 100;
}

const schedules = new WeakMap<DebtTerms, Map<number, readonly DebtPayment[]>>();
/**
 * Every payment of a loan or lease. A loan's payment covers half a year's interest on the remaining principal and
 * repays the rest; the last payment clears the remaining principal. A lease pays its total in equal whole-euro parts.
 */
export function debtSchedule(terms: DebtTerms, rounds: number): readonly DebtPayment[] {
  let byRounds = schedules.get(terms);
  const known = byRounds?.get(rounds);
  if (known) return known;
  const count = terms.seasons * paymentRounds(rounds).length, rate = perPaymentRate(terms.rateBasisPoints, rounds);
  let balance = terms.kind === 'loan' ? terms.principal : terms.total;
  const payments = paymentSlots(terms.seasonNumber, terms.round, count, rounds).map((slot, index): DebtPayment => {
    const last = index === count - 1;
    if (terms.kind === 'lease') {
      const amount = last ? balance : Math.min(balance, terms.payment);
      balance -= amount;
      return { number: index + 1, ...slot, date: dateForRound(slot.round, slot.seasonNumber), amount, principal: amount, balanceAfter: balance };
    }
    const interest = Math.round(balance * rate), principal = last ? balance : Math.max(0, Math.min(balance, terms.payment - interest));
    balance -= principal;
    return { number: index + 1, ...slot, date: dateForRound(slot.round, slot.seasonNumber), amount: principal + interest, principal, balanceAfter: balance };
  });
  if (!byRounds) { byRounds = new Map(); schedules.set(terms, byRounds); }
  byRounds.set(rounds, Object.freeze(payments));
  return payments;
}

/** The regular payment and total of a loan started now. */
export function loanTerms(principal: number, rateBasisPoints: number, seasons: number, seasonNumber: number, round: number, rounds: number): { payment: number; total: number; payments: number } {
  const payments = seasons * paymentRounds(rounds).length, payment = loanPayment(principal, rateBasisPoints, payments, rounds);
  const total = debtSchedule({ kind: 'loan', principal, rateBasisPoints, seasons, payment, total: 0, seasonNumber, round }, rounds).reduce((sum, item) => sum + item.amount, 0);
  return { payment, total, payments };
}

/** A lease's total (the price plus its premium, whole euros) and its regular payment. */
export function leaseTerms(price: number, seasons: number, rounds: number): { payment: number; total: number; payments: number } {
  const payments = seasons * paymentRounds(rounds).length;
  const total = Math.round(price * (100 + FACILITY_FINANCING_RULES.leasePremiumPercentPerSeason * seasons) / 100 / 100) * 100;
  return { payment: Math.ceil(total / payments / 100) * 100, total, payments };
}

const bookedIndex = new WeakMap<readonly FinanceEntry[], Map<string, Map<string, number>>>();
/** The highest scheduled payment of each debt booked in `seasonNumber` (a season's payments sit in the active ledger tail). */
function bookedInSeason(finance: FinanceLedgerSource, seasonNumber: number): Map<string, number> {
  let bySeason = bookedIndex.get(finance.ledger);
  if (!bySeason) { bySeason = new Map(); bookedIndex.set(finance.ledger, bySeason); }
  // A replay may append to a local work array, so the length is part of the key.
  const key = `${seasonNumber}|${finance.ledger.length}|${financeLedgerCount(finance)}`;
  let booked = bySeason.get(key);
  if (booked) return booked;
  booked = new Map();
  const note = (entry: FinanceEntry) => { if (entry.seasonNumber === seasonNumber && entry.debt && typeof entry.debt.payment === 'number') booked!.set(entry.debt.debtId, Math.max(booked!.get(entry.debt.debtId) ?? 0, entry.debt.payment)); };
  if ((finance.archives?.at(-1)?.seasonNumber ?? 0) >= seasonNumber) for (const entry of financeLedgerEntries(finance)) note(entry);
  else for (let index = finance.ledger.length - 1; index >= 0 && finance.ledger[index]!.seasonNumber >= seasonNumber; index -= 1) note(finance.ledger[index]!);
  bySeason.set(key, booked);
  return booked;
}

export interface DebtPosition {
  debt: FacilityDebt;
  schedule: readonly DebtPayment[];
  /** Whether the debt was settled early within this ledger prefix. */
  settled: boolean;
  /** Scheduled payments booked so far (all of an earlier season's, and those of this season already in the ledger). */
  booked: number;
  /** Loan: remaining principal. Lease: payments still to come. Zero once settled or fully paid. */
  outstanding: number;
  /** Scheduled payments of the current season not yet booked: reserved in the club's Remaining budget. */
  dueThisSeason: number;
  next: DebtPayment | null;
}

/** A debt as this ledger prefix and season see it. */
export function debtPosition(context: DebtContext, debt: FacilityDebt): DebtPosition {
  const schedule = debtSchedule(debt, seasonRounds(context));
  const count = financeLedgerCount(context.finance), settled = debt.settled !== null && debt.settled.ledgerIndex < count;
  const bookedMax = bookedInSeason(context.finance, context.seasonNumber).get(debt.id) ?? 0;
  const booked = schedule.filter(item => item.seasonNumber < context.seasonNumber || item.seasonNumber === context.seasonNumber && item.number <= bookedMax).length;
  const remaining = debt.kind === 'loan' ? booked === 0 ? debt.principal : schedule[booked - 1]!.balanceAfter : schedule.slice(booked).reduce((sum, item) => sum + item.amount, 0);
  const dueThisSeason = settled ? 0 : schedule.slice(booked).filter(item => item.seasonNumber === context.seasonNumber).reduce((sum, item) => sum + item.amount, 0);
  return { debt, schedule, settled, booked, outstanding: settled ? 0 : remaining, dueThisSeason, next: settled ? null : schedule[booked] ?? null };
}

/** A club's loans and leases already started in this ledger prefix. */
export function clubDebts(context: DebtContext, clubId: string): FacilityDebt[] {
  const debts = context.facilities?.debts;
  if (!debts?.length) return [];
  const count = financeLedgerCount(context.finance);
  return debts.filter(debt => debt.clubId === clubId && debt.ledgerIndex < count);
}

/** Loans' remaining principal plus leases' remaining payments. */
export function outstandingDebt(context: DebtContext, clubId: string): number {
  return clubDebts(context, clubId).reduce((sum, debt) => sum + debtPosition(context, debt).outstanding, 0);
}

/** This season's loan and lease payments still to come; Remaining budget reserves them (format 71). */
export function debtReserve(context: DebtContext, clubId: string): number {
  return clubDebts(context, clubId).reduce((sum, debt) => sum + debtPosition(context, debt).dueThisSeason, 0);
}

/** The most a club may owe on loans and leases together, at its money level. */
export const borrowingLimit = (context: WorldContext, clubId: string): number => scaledMoney(context, clubId, FACILITY_FINANCING_RULES.borrowingLimit);

/** Outstanding debt as a whole percentage of the borrowing limit. */
export function debtRatioPercent(context: DebtContext, clubId: string): number {
  return Math.round(outstandingDebt(context, clubId) * 100 / borrowingLimit(context, clubId));
}

/** The board-review effect of a debt ratio: 0 up to 40%, then -1 per started 15 points, at most -4. */
export function boardDebtImpactFor(ratioPercent: number): number {
  const { boardDebtFreePercent, boardDebtStepPercent, boardDebtImpactMax } = FACILITY_FINANCING_RULES;
  return ratioPercent <= boardDebtFreePercent ? 0 : -Math.min(boardDebtImpactMax, Math.ceil((ratioPercent - boardDebtFreePercent) / boardDebtStepPercent));
}

/** Format 71: each club's debt effect on a board review at this boundary (nonzero only); undefined without facility financing. */
export function boardDebtImpacts(context: DebtContext & { clubs: readonly { id: string }[] }): Record<string, number> | undefined {
  if (!usesFacilityFinancing(context.facilities)) return undefined;
  const impacts: Record<string, number> = {};
  for (const club of context.clubs) {
    if (!clubDebts(context, club.id).length) continue;
    const impact = boardDebtImpactFor(debtRatioPercent(context, club.id));
    if (impact) impacts[club.id] = impact;
  }
  return impacts;
}

/** Format 71: extra confidence the board requires for capital while the club's debt ratio is high (0, 5 or 10). */
export function boardCapitalSurcharge(context: DebtContext, clubId: string): number {
  if (!usesFacilityFinancing(context.facilities) || !clubDebts(context, clubId).length) return 0;
  const ratio = debtRatioPercent(context, clubId);
  return FACILITY_FINANCING_RULES.boardCapitalSurcharge.find(([from]) => ratio >= from)?.[1] ?? 0;
}

/** The fixed yearly rate of a new loan in basis points (4-7%). */
export function loanRateBasisPoints(debtAfter: number, limit: number, thinCash: boolean): number {
  const rules = FACILITY_FINANCING_RULES;
  const leverage = Math.min(rules.leverageRateBasisPoints, Math.round(rules.leverageRateBasisPoints * debtAfter / Math.max(1, limit)));
  const raw = rules.baseRateBasisPoints + leverage + (thinCash ? rules.thinCashRateBasisPoints : 0);
  return Math.min(rules.maxRateBasisPoints, Math.round(raw / rules.rateStepBasisPoints) * rules.rateStepBasisPoints);
}

/** The lease still running on a club's facility, if any (a fully paid lease leaves the level owned). */
export function activeLease(context: DebtContext, clubId: string, type: FacilityType): FacilityDebt | null {
  return clubDebts(context, clubId).find(debt => debt.kind === 'lease' && debt.facilityType === type && debtPosition(context, debt).outstanding > 0) ?? null;
}

/** The scheduled payments due at this week's financial commit, for clubs in the full world, in debt order. */
export function dueDebtPayments(context: DebtContext & { round: number; clubs: readonly { id: string }[] }): { debt: FacilityDebt; payment: DebtPayment }[] {
  const debts = context.facilities?.debts;
  if (!debts?.length) return [];
  const count = financeLedgerCount(context.finance), clubs = new Set(context.clubs.map(club => club.id)), rounds = seasonRounds(context);
  const due: { debt: FacilityDebt; payment: DebtPayment }[] = [];
  for (const debt of debts) {
    if (!clubs.has(debt.clubId) || debt.ledgerIndex >= count || debt.settled !== null && debt.settled.ledgerIndex < count) continue;
    const payment = debtSchedule(debt, rounds).find(item => item.seasonNumber === context.seasonNumber && item.round === context.round);
    if (payment) due.push({ debt, payment });
  }
  return due;
}

/** Ledger source identities of a debt's entries. */
export const debtSourceId = (debtId: string, payment: 'start' | number | 'settle'): string => payment === 'start' ? debtId : payment === 'settle' ? `${debtId}-settle` : `${debtId}-p${payment}`;

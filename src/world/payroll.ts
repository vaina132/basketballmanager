import { requireCalendarWeek } from './calendar-boundary';
import type { ClubPayrollSummary, PlayerPayroll, PlayerWageAgreement, SeasonPayroll, WagePrepaymentQuote } from '../domain/payroll';
import type { SeasonState } from '../domain/season';
import type { EmploymentContract } from '../domain/employment';
import type { Team } from '../domain/types';
import { getCareerWage } from './player-catalog';
import { contractForSeason } from './employment-policy';
import { getFinanceBalance, recordPayrollCharge } from './finance';
import { agreementCommittedFromLedger, agreementThroughRound, getPayrollReserve, getSpendableCash, PAYROLL_AUTOMATION_CUSHION, PAYROLL_INSTALLMENTS, payrollInstallment, PREPAYMENT_DISCOUNT_PERCENT } from './payroll-policy';
import { seasonRounds } from './career-world';
import { financeLedgerCount, financeLedgerEntries } from './finance-ledger';
import { payrollLedgerReader, type PayrollLedgerReader } from './finance-ledger-index';

export { getSeasonWage } from '../data/development-wages';
export { agreementCommitted, getPayrollReserve, getSpendableCash, isAgreementPrepaid, PAYROLL_AUTOMATION_CUSHION, PAYROLL_INSTALLMENTS, payrollInstallment, PREPAYMENT_DISCOUNT_PERCENT } from './payroll-policy';
export type { ClubPayrollSummary, PlayerPayroll, WagePrepaymentQuote } from '../domain/payroll';

export function createPayroll(clubs: readonly Team[], managedClubId: string): SeasonPayroll {
  return { model: 'payroll-1', enabledSince: null, delegated: Object.fromEntries(clubs.map(club => [club.id, club.id !== managedClubId])), agreements: [] };
}

/** No opening payment: wages begin with the player's first registered matchday. */
export function addInSeasonWageAgreement(state: SeasonState, contract: EmploymentContract): SeasonState {
  const paid = contract.kind === 'midseason-transfer';
  if (!state.payroll.enabledSince || !paid && contract.kind !== 'midseason' || contract.startsSeason !== state.seasonNumber || contract.startsRound !== state.round || contract.endsSeason < state.seasonNumber) throw new Error('Use the effective current-season arrival contract to start payroll.');
  if (state.payroll.agreements.some(agreement => agreement.playerId === contract.playerId && agreement.seasonNumber === state.seasonNumber && agreementThroughRound(state, agreement) >= state.round)) throw new Error('This player already has an active wage agreement for the season.');
  const agreement: PlayerWageAgreement = { id: `wage-s${state.seasonNumber}-${contract.playerId}${paid ? `-r${state.round}` : ''}`, playerId: contract.playerId, clubId: contract.clubId, seasonNumber: state.seasonNumber, startsRound: state.round, seasonWage: contract.seasonWage };
  return { ...state, payroll: { ...state.payroll, agreements: [...state.payroll.agreements, agreement] } };
}

function seasonAgreements(state: SeasonState, startsRound: number): PlayerWageAgreement[] {
  return state.clubs.flatMap(club => club.players.map(player => {
    const contract = state.employment.enabledSince ? contractForSeason(state.employment, player.id, state.seasonNumber) : null;
    if (state.employment.enabledSince && (!contract || contract.clubId !== club.id)) throw new Error('Every registered player needs an effective employment contract before payroll.');
    return { id: `wage-s${state.seasonNumber}-${player.id}`, playerId: player.id, clubId: club.id, seasonNumber: state.seasonNumber, startsRound, seasonWage: contract?.seasonWage ?? getCareerWage(state, player.id) };
  }));
}

function installmentRecorded(state: SeasonState, clubId: string): boolean {
  for (const entry of financeLedgerEntries(state.finance)) {
    if (entry.clubId === clubId && entry.kind === 'payroll' && entry.sourceId === `payroll-s${state.seasonNumber}-r${state.round}`) return true;
  }
  return false;
}

export function getPlayerPayroll(state: SeasonState, playerId: string): PlayerPayroll | null {
  if (!state.payroll.enabledSince) return null;
  const agreement = state.payroll.agreements.find(agreement => agreement.playerId === playerId && agreement.seasonNumber === state.seasonNumber && agreement.startsRound <= state.round && agreementThroughRound(state, agreement) >= state.round);
  return agreement ? agreementPayroll(state, agreement) : null;
}

function agreementPayroll(state: SeasonState, agreement: PlayerWageAgreement, readPayroll: PayrollLedgerReader = payrollLedgerReader(state.finance)): PlayerPayroll {
  const { prepaid, amount, discount } = readPayroll(agreement.id);
  const active = agreement.startsRound <= state.round && agreementThroughRound(state, agreement) >= state.round;
  return {
    agreement, prepaid, seasonWages: agreement.seasonWage,
    charged: amount, savings: discount,
    futureCommitted: agreementCommittedFromLedger(agreement, agreementThroughRound(state, agreement), seasonRounds(state), readPayroll),
    nextInstallment: !active || state.status === 'complete' || prepaid || installmentRecorded(state, agreement.clubId) ? 0 : payrollInstallment(agreement.seasonWage, state.round, seasonRounds(state)),
  };
}

export function getClubPayrollSummary(state: SeasonState, clubId: string): ClubPayrollSummary {
  const summary: ClubPayrollSummary = { seasonWages: 0, charged: 0, futureCommitted: 0, nextInstallment: 0, savings: 0, spendableCash: getSpendableCash(state, clubId) };
  if (!state.payroll.enabledSince) return summary;
  const readPayroll = payrollLedgerReader(state.finance);
  for (const agreement of state.payroll.agreements.filter(agreement => agreement.clubId === clubId && agreement.seasonNumber === state.seasonNumber && agreement.startsRound <= state.round)) {
    const row = agreementPayroll(state, agreement, readPayroll);
    if (agreementThroughRound(state, agreement) >= state.round) summary.seasonWages += row.seasonWages;
    summary.charged += row.charged; summary.futureCommitted += row.futureCommitted; summary.nextInstallment += row.nextInstallment; summary.savings += row.savings;
  }
  return summary;
}

function prepaymentQuote(state: SeasonState, playerId: string, actingClubId: string): WagePrepaymentQuote {
  const row = getPlayerPayroll(state, playerId);
  if (!row) throw new Error('Enable player payroll and choose a player with a current season wage agreement.');
  const { agreement } = row;
  const gross = row.futureCommitted, discount = Math.floor(gross * PREPAYMENT_DISCOUNT_PERCENT / 100), amount = gross - discount;
  const otherCommitments = Math.max(0, getPayrollReserve(state, agreement.clubId) - gross), requiredCash = amount + otherCommitments;
  const balance = getFinanceBalance(state.finance, agreement.clubId);
  let reason: string | null = null;
  if (agreement.clubId !== actingClubId) reason = 'Choose a player at your club.';
  else if (!state.finance.enabledSince) reason = 'Enable club finances before settling wages.';
  else if (state.status === 'complete') reason = 'Start the next season before settling future wages.';
  else if (row.prepaid) reason = 'This player’s remaining season wages are already prepaid.';
  else if (!gross || installmentRecorded(state, agreement.clubId)) reason = 'There are no remaining wages to settle on this matchday.';
  else if (balance.unpaid > 0) reason = 'Settle unpaid club costs before prepaying future wages.';
  else if (balance.cash < requiredCash) reason = 'Not enough cash to prepay while protecting other players’ remaining wage commitments.';
  return { agreementId: agreement.id, playerId, clubId: agreement.clubId, fromRound: state.round, throughRound: seasonRounds(state), gross, discount, amount, otherCommitments, requiredCash, canPrepay: reason === null, reason };
}

export function quoteWagePrepayment(state: SeasonState, playerId: string): WagePrepaymentQuote {
  return prepaymentQuote(state, playerId, state.managedClubId);
}

/** The shared command validates both manual and delegated payments before recording any expense. */
function prepayForClub(state: SeasonState, playerId: string, clubId: string): SeasonState {
  const quote = prepaymentQuote(state, playerId, clubId);
  if (!quote.canPrepay) throw new Error(quote.reason!);
  return recordPayrollCharge(state, clubId, { type: 'prepayment', fromRound: quote.fromRound, throughRound: quote.throughRound, items: [{ agreementId: quote.agreementId, playerId, gross: quote.gross, discount: quote.discount, amount: quote.amount }] }, `prepay-${quote.agreementId}`);
}

export function prepayWages(state: SeasonState, playerId: string): SeasonState {
  return prepayForClub(state, playerId, state.managedClubId);
}

function prepareClubPayroll(state: SeasonState, clubId: string): SeasonState {
  if (!state.payroll.enabledSince || !state.payroll.delegated[clubId] || state.status === 'complete') return state;
  let next = state;
  const agreements = state.payroll.agreements.filter(agreement => agreement.clubId === clubId && agreement.seasonNumber === state.seasonNumber && agreement.startsRound <= state.round && agreementThroughRound(state, agreement) >= state.round).sort((a, b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);
  for (const agreement of agreements) {
    const quote = prepaymentQuote(next, agreement.playerId, clubId);
    if (quote.canPrepay && getFinanceBalance(next.finance, clubId).cash >= quote.requiredCash + PAYROLL_AUTOMATION_CUSHION) next = prepayForClub(next, agreement.playerId, clubId);
  }
  return next;
}

/** Preparation and explicit delegation changes are the only automatic-prepayment boundaries. */
export function preparePayrollRound(state: SeasonState): SeasonState {
  if (!state.payroll.enabledSince || state.status === 'complete') return state;
  let next = state;
  for (const club of state.clubs) next = prepareClubPayroll(next, club.id);
  return next;
}

export function setPayrollDelegation(state: SeasonState, delegated: boolean): SeasonState {
  if (!state.payroll.enabledSince) throw new Error('Enable player payroll before changing payment control.');
  if (typeof delegated !== 'boolean') throw new Error('Choose manual or delegated wage payments.');
  const next = { ...state, payroll: { ...state.payroll, delegated: { ...state.payroll.delegated, [state.managedClubId]: delegated } } };
  return delegated ? prepareClubPayroll(next, state.managedClubId) : next;
}

export function enablePayroll(state: SeasonState): SeasonState {
  if (state.payroll.enabledSince) return state;
  if (!state.finance.enabledSince) throw new Error('Enable club finances before enabling player payroll.');
  if (state.status === 'complete') throw new Error('Start the next season before enabling player payroll.');
  return { ...state, payroll: { ...state.payroll, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: financeLedgerCount(state.finance) }, agreements: seasonAgreements(state, state.round) } };
}

/** Every rostered player is owed their installment regardless of match exposure or availability. */
export function processPayrollRound(state: SeasonState): SeasonState {
  if (!state.payroll.enabledSince) return state;
  if (!state.finance.enabledSince) throw new Error('Player payroll requires enabled club finances.');
  const fixtures = state.fixtures.filter(fixture => fixture.round === state.round);
  if (fixtures.some(fixture => fixture.result === null)) throw new Error('Commit every matchday result before recording payroll.');
  requireCalendarWeek(state, true);
  let next = state;
  const readPayroll = payrollLedgerReader(state.finance);
  for (const club of state.clubs) {
    const items = club.players.flatMap(player => {
      const agreement = state.payroll.agreements.find(agreement => agreement.playerId === player.id && agreement.clubId === club.id && agreement.seasonNumber === state.seasonNumber && agreement.startsRound <= state.round && agreementThroughRound(state, agreement) >= state.round);
      if (!agreement || agreement.startsRound > state.round) throw new Error('Every player needs a current wage agreement before payroll.');
      if (readPayroll(agreement.id).prepaid) return [];
      const gross = payrollInstallment(agreement.seasonWage, state.round, seasonRounds(state));
      return [{ agreementId: agreement.id, playerId: player.id, gross, discount: 0, amount: gross }];
    });
    next = recordPayrollCharge(next, club.id, { type: 'installment', fromRound: state.round, throughRound: state.round, items }, `payroll-s${state.seasonNumber}-r${state.round}`);
  }
  return next;
}

/** Create a new payment schedule from opening-day registrations and effective terms. */
export function startPayrollSeason(state: SeasonState): SeasonState {
  if (!state.payroll.enabledSince) return state;
  if (state.status !== 'active' || state.round !== 1) throw new Error('Start the annual wage schedule on opening day.');
  if (state.payroll.agreements.some(agreement => agreement.seasonNumber === state.seasonNumber)) throw new Error('This season’s wage agreements already exist.');
  const readPayroll = payrollLedgerReader(state.finance);
  if (state.payroll.agreements.some(agreement => agreement.seasonNumber < state.seasonNumber && agreementCommittedFromLedger(agreement, agreementThroughRound(state, agreement), seasonRounds(state), readPayroll) !== 0)) throw new Error('Record every previous season wage installment before opening the new schedule.');
  return { ...state, payroll: { ...state.payroll, agreements: [...state.payroll.agreements, ...seasonAgreements(state, 1)] } };
}

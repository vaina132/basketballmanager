import type { InSeasonSaleQuote, InSeasonTransferQuote } from '../domain/recruitment';
import type { SeasonState } from '../domain/season';
import type { TransferPaymentPlan } from '../domain/transfer-payments';
import type { Player } from '../domain/types';
import { DEVELOPMENT_PLAYERS } from '../data/development-players';
import { contractForRound, effectiveContractsForRound, getClubContractSummary, MAX_CONTRACT_SEASONS, MAX_CONTRACT_WAGE, MAX_ROSTER_SIZE, MIN_CONTRACT_WAGE, MIN_ROSTER_SIZE, MIN_ROSTER_WAGE_RESERVE, outgoingReplacementReserve, WAGE_STEP } from './employment-policy';
import { getFinanceBalance } from './finance';
import { getPlayerPayroll } from './payroll';
import { getInSeasonBudget, getInSeasonOffers, remainingSeasonWages } from './recruitment-policy';
import { dateForRound, SEASON_ROUNDS } from './season';
import { getTransferPaymentSchedule, getTransferPaymentSummary, TRANSFER_PAYMENT_PLANS } from './transfer-payments';
import { MAX_TRANSFER_FEE, MIN_TRANSFER_FEE, TRANSFER_FEE_STEP } from './transfers-policy';

/** Every current and future seller agreement is released together; third-party promises never are. */
export function getInSeasonReleasedContractIds(state: SeasonState, playerId: string, sellerClubId: string): string[] {
  const ids = new Set<string>();
  const through = Math.max(state.seasonNumber, ...state.employment.contracts.filter(contract => contract.playerId === playerId).map(contract => contract.endsSeason));
  for (let year = state.seasonNumber; year <= through; year += 1) {
    for (const contract of effectiveContractsForRound(state.employment, year, year === state.seasonNumber ? state.round : 1)) if (contract.playerId === playerId && contract.clubId === sellerClubId) ids.add(contract.id);
  }
  return [...ids];
}

function futureRightsReason(state: SeasonState, playerId: string, sellerClubId: string): string | null {
  const through = Math.max(state.seasonNumber, ...state.employment.contracts.filter(contract => contract.playerId === playerId).map(contract => contract.endsSeason));
  for (let year = state.seasonNumber + 1; year <= through; year += 1) if (effectiveContractsForRound(state.employment, year, 1).some(contract => contract.playerId === playerId && contract.clubId !== sellerClubId)) return 'This player has a future agreement with another club. That agreement cannot be sold by the current employer.';
  return null;
}

export function requiredInSeasonTransferFee(state: SeasonState, playerId: string): number {
  const current = contractForRound(state.employment, playerId, state.seasonNumber, state.round);
  if (!current) return 0;
  let remaining = remainingSeasonWages(current.seasonWage, Math.min(SEASON_ROUNDS, state.round + 1));
  const ids = getInSeasonReleasedContractIds(state, playerId, current.clubId);
  const through = Math.max(state.seasonNumber, ...state.employment.contracts.filter(contract => ids.includes(contract.id)).map(contract => contract.endsSeason));
  for (let year = state.seasonNumber + 1; year <= through; year += 1) remaining += effectiveContractsForRound(state.employment, year, 1).filter(contract => contract.playerId === playerId && contract.clubId === current.clubId).reduce((sum, contract) => sum + contract.seasonWage, 0);
  return Math.min(MAX_TRANSFER_FEE, Math.max(MIN_TRANSFER_FEE, Math.ceil(remaining / TRANSFER_FEE_STEP) * TRANSFER_FEE_STEP));
}

export function getInSeasonTransferCandidates(state: SeasonState, clubId = state.managedClubId): readonly Player[] {
  if (!state.recruitment?.transfersEnabledSince || state.status !== 'active') return [];
  return DEVELOPMENT_PLAYERS.filter(player => {
    const contract = contractForRound(state.employment, player.id, state.seasonNumber, state.round);
    return contract && contract.clubId !== clubId && !state.employment.transfers.some(transfer => transfer.playerId === player.id && transfer.startsSeason === state.seasonNumber && transfer.startsRound > 1);
  });
}

/** Seller must retain eight actual registrations, without counting hoped-for arrivals. */
export function inSeasonSellerReason(state: SeasonState, playerId: string, sellerClubId: string, excludeOfferId?: string): string | null {
  const target = contractForRound(state.employment, playerId, state.seasonNumber, state.round);
  if (!target || target.clubId !== sellerClubId) return 'The player is no longer registered with the selling club.';
  const futureReason = futureRightsReason(state, playerId, sellerClubId);
  if (futureReason) return futureReason;
  const outgoing = new Set([playerId, ...getInSeasonOffers(state, undefined, true).filter(offer => offer.id !== excludeOfferId && offer.transfer?.sellerClubId === sellerClubId && offer.transfer.clubStatus === 'accepted').map(offer => offer.playerId)]);
  const current = effectiveContractsForRound(state.employment, state.seasonNumber, state.round).filter(contract => contract.clubId === sellerClubId);
  if (current.filter(contract => !outgoing.has(contract.playerId)).length < MIN_ROSTER_SIZE) return 'The selling club must retain at least eight registered players after all approved departures.';
  const through = Math.max(state.seasonNumber, ...state.employment.contracts.filter(contract => outgoing.has(contract.playerId) && contract.clubId === sellerClubId).map(contract => contract.endsSeason));
  for (let year = state.seasonNumber + 1; year <= through; year += 1) {
    const summary = getClubContractSummary(state, sellerClubId, year);
    const removed = summary.contracts.filter(contract => outgoing.has(contract.playerId));
    const size = summary.rosterSize - removed.length;
    const wages = summary.seasonWages - removed.reduce((sum, contract) => sum + contract.seasonWage, 0);
    const holds = getInSeasonOffers(state, sellerClubId, true).filter(offer => offer.seasonNumber + offer.seasons - 1 >= year);
    const shortfalls = holds.reduce((sum, offer) => sum + Math.max(0, MIN_ROSTER_WAGE_RESERVE - offer.seasonWage), 0);
    const reserve = Math.max(0, MIN_ROSTER_SIZE - size - summary.reservedRosterSize) * MIN_ROSTER_WAGE_RESERVE + shortfalls;
    if (wages + summary.reservedWages + reserve > summary.budget) return `The selling club needs salary budget to replace its departing players in season ${year}.`;
  }
  return null;
}

export function quoteInSeasonTransferOffer(state: SeasonState, playerId: string, seasonWage: number, seasons: number, fee: number, clubId = state.managedClubId, paymentPlan: TransferPaymentPlan = 'upfront', resolvingOfferId?: string): InSeasonTransferQuote {
  const current = contractForRound(state.employment, playerId, state.seasonNumber, state.round);
  const own = getInSeasonOffers(state, clubId, true).find(offer => offer.playerId === playerId);
  const resolving = !!resolvingOfferId && own?.id === resolvingOfferId && own.status === 'pending' && own.responseRound === state.round && own.responseOn === state.date;
  const responseRound = resolving ? state.round : Math.min(SEASON_ROUNDS, state.round + 1), responseOn = dateForRound(responseRound, state.seasonNumber);
  const wageValid = Number.isSafeInteger(seasonWage) && seasonWage >= MIN_CONTRACT_WAGE && seasonWage <= MAX_CONTRACT_WAGE && seasonWage % WAGE_STEP === 0;
  const termsValid = Number.isInteger(seasons) && seasons >= 1 && seasons <= MAX_CONTRACT_SEASONS && state.seasonNumber + seasons - 1 <= 7974;
  const feeValid = Number.isSafeInteger(fee) && fee >= MIN_TRANSFER_FEE && fee <= MAX_TRANSFER_FEE && fee % TRANSFER_FEE_STEP === 0;
  const planValid = TRANSFER_PAYMENT_PLANS.includes(paymentPlan);
  const remainingWages = wageValid ? remainingSeasonWages(seasonWage, responseRound) : 0;
  const budget = getInSeasonBudget(state, clubId, own?.id), futureBudgets: InSeasonTransferQuote['futureBudgets'] = [];
  let reason: string | null = null;
  if (!state.recruitment?.enabledSince || !state.recruitment.transfersEnabledSince) reason = 'Enable in-season club transfers before approaching contracted players.';
  else if (state.status !== 'active') reason = 'Use the offseason market after the final matchday.';
  else if (state.round >= SEASON_ROUNDS && !resolving) reason = 'There is no later matchday available to register a transfer this season.';
  else if (!state.clubs.some(club => club.id === clubId) || !current || current.clubId === clubId) reason = 'Choose a player currently registered at another club.';
  else if (state.employment.transfers.some(transfer => transfer.playerId === playerId && transfer.startsSeason === state.seasonNumber && transfer.startsRound > 1)) reason = 'This player has already moved in a paid transfer during this season.';
  else if (!wageValid) reason = 'Choose an annual salary from EUR 5,000 to EUR 50,000 in EUR 500 steps.';
  else if (!termsValid) reason = 'Choose the rest of this season, optionally with one or two further seasons.';
  else if (!feeValid) reason = 'Choose a transfer fee from EUR 1,000 to EUR 500,000 in EUR 1,000 steps.';
  else if (!planValid || paymentPlan !== 'upfront' && state.seasonNumber >= 7974) reason = 'Choose a payment plan within the supported career calendar.';
  else if (resolving && (!own?.transfer || own.transfer.clubStatus !== 'accepted' || own.transfer.contractId !== current.id || own.transfer.sellerClubId !== current.clubId || own.seasonWage !== seasonWage || own.seasons !== seasons || own.transfer.fee !== fee || own.transfer.paymentPlan !== paymentPlan)) reason = 'The selling club must approve these transfer terms before the player can join.';
  else if (getFinanceBalance(state.finance, clubId).unpaid > 0) reason = 'Settle unpaid club costs before offering a transfer fee.';
  else if (getTransferPaymentSummary(state, clubId).overdue > 0) reason = 'Settle overdue transfer payments before offering another transfer fee.';
  else if (budget.rosterSize + budget.reservedRosterSize + 1 > MAX_ROSTER_SIZE) reason = 'The squad already has twelve registered players or reserved places.';
  else if (budget.seasonWages + budget.reservedWages + seasonWage > budget.budget) reason = 'This offer exceeds the current season player salary budget.';
  else if (budget.spendableCash < fee + remainingWages) reason = 'The transfer fee and remaining salary exceed the available budget after existing commitments.';
  else reason = inSeasonSellerReason(state, playerId, current.clubId, own?.id);
  if (termsValid) for (let year = state.seasonNumber + 1; year < state.seasonNumber + seasons; year += 1) {
    const summary = getClubContractSummary(state, clubId, year, own?.id);
    const size = summary.rosterSize + summary.reservedRosterSize + 1;
    const shortfalls = getInSeasonOffers(state, clubId, true).filter(offer => offer.id !== own?.id && offer.seasonNumber + offer.seasons - 1 >= year).reduce((sum, offer) => sum + Math.max(0, MIN_ROSTER_WAGE_RESERVE - offer.seasonWage), 0);
    const reserve = Math.max(0, MIN_ROSTER_SIZE - size) * MIN_ROSTER_WAGE_RESERVE + shortfalls + (resolving ? 0 : Math.max(0, MIN_ROSTER_WAGE_RESERVE - seasonWage)) + outgoingReplacementReserve(state, clubId, year);
    const remainingBudget = Math.max(0, summary.budget - summary.seasonWages - summary.reservedWages - (wageValid ? seasonWage : 0));
    futureBudgets.push({ seasonNumber: year, remainingBudget, rosterSize: size });
    if (!reason && size > MAX_ROSTER_SIZE) reason = `The squad already has twelve signed or reserved players for season ${year}.`;
    if (!reason && summary.seasonWages + summary.reservedWages + seasonWage + reserve > summary.budget) reason = `This offer exceeds the season ${year} salary budget after protecting space for eight players.`;
  }
  return { playerId, clubId, seasonWage, seasons, endsSeason: state.seasonNumber + seasons - 1, fee, paymentPlan, sellerClubId: current?.clubId ?? null, contractId: current?.id ?? null, requiredFee: current ? requiredInSeasonTransferFee(state, playerId) : 0, installments: feeValid && planValid && (paymentPlan === 'upfront' || state.seasonNumber < 7974) ? getTransferPaymentSchedule(fee, paymentPlan, responseOn, state.seasonNumber, responseRound) : [], remainingWages, responseRound, responseOn, remainingBudgetAfter: Math.max(0, budget.spendableCash - remainingWages - (feeValid ? fee : 0)), annualBudgetRemaining: Math.max(0, budget.budget - budget.seasonWages - budget.reservedWages - (wageValid ? seasonWage : 0)), rosterSize: budget.rosterSize + budget.reservedRosterSize + 1, canOffer: reason === null, reason, futureBudgets };
}

export function quoteInSeasonSale(state: SeasonState, offerId: string): InSeasonSaleQuote {
  const offer = state.recruitment.offers.find(offer => offer.id === offerId);
  if (!offer?.transfer) throw new Error('Choose an incoming in-season club transfer.');
  const transfer = offer.transfer;
  const current = contractForRound(state.employment, offer.playerId, state.seasonNumber, state.round);
  const outgoing = new Set([offer.playerId, ...getInSeasonOffers(state, undefined, true).filter(item => item.id !== offer.id && item.transfer?.sellerClubId === transfer.sellerClubId && item.transfer.clubStatus === 'accepted').map(item => item.playerId)]);
  const rosterAfter = effectiveContractsForRound(state.employment, state.seasonNumber, state.round).filter(contract => contract.clubId === transfer.sellerClubId && !outgoing.has(contract.playerId)).length;
  const payroll = getPlayerPayroll(state, offer.playerId);
  const sellerPayroll = payroll?.agreement.clubId === transfer.sellerClubId ? payroll : null;
  let acceptReason = !state.recruitment.transfersEnabledSince || state.status !== 'active' || offer.seasonNumber !== state.seasonNumber || offer.offeredRound !== state.round || offer.status !== 'club-review' || transfer.clubStatus !== 'review' ? 'Choose a transfer offer awaiting this matchday\'s club decision.' : current?.id !== transfer.contractId ? 'The selling agreement has changed.' : inSeasonSellerReason(state, offer.playerId, transfer.sellerClubId, offer.id);
  if (!acceptReason && offer.responseRound <= state.round) acceptReason = 'This transfer review has expired.';
  const counterReason = acceptReason ?? (transfer.fee >= transfer.requiredFee ? 'This offer already meets the asking fee. Accept or reject it.' : null);
  const released = getInSeasonReleasedContractIds(state, offer.playerId, transfer.sellerClubId);
  return { offerId, playerId: offer.playerId, sellerClubId: transfer.sellerClubId, buyerClubId: offer.clubId, fee: transfer.fee, paymentPlan: transfer.paymentPlan, requiredFee: transfer.requiredFee, rosterAfter, annualSalaryFreed: current?.clubId === transfer.sellerClubId ? current.seasonWage : 0, remainingWagesFreed: sellerPayroll && !sellerPayroll.prepaid ? Math.min(sellerPayroll.futureCommitted, remainingSeasonWages(sellerPayroll.seasonWages, offer.responseRound)) : 0, salaryAlreadyCharged: sellerPayroll?.charged ?? 0, nonRefundablePrepayment: sellerPayroll?.prepaid ? state.finance.ledger.flatMap(entry => entry.payroll?.type === 'prepayment' ? entry.payroll.items : []).filter(item => item.agreementId === sellerPayroll.agreement.id).reduce((sum, item) => sum + item.amount, 0) : 0, releasedThroughSeason: Math.max(state.seasonNumber, ...state.employment.contracts.filter(contract => released.includes(contract.id)).map(contract => contract.endsSeason)), decisionDeadline: offer.responseOn, responseRound: offer.responseRound, responseOn: offer.responseOn, canAccept: acceptReason === null, acceptReason, canCounter: counterReason === null, counterReason };
}

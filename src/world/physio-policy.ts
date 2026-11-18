import { staffLimit } from './wage-pool';
import type { Physio, PhysioContract, PhysioHireQuote } from '../domain/physio';
import type { SeasonState } from '../domain/season';
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios';
import { getFinanceBalance } from './finance';
import { MAX_REHABILITATION_REDUCTION_PERCENT } from './rehabilitation-policy';
import { remainingStaffBudget, staffAllocation, staffCommitted, staffMoneyReason } from './staff-policy';
import { staffMarketWorld } from './staff-levels';
import { getTransferPaymentSummary } from './transfer-payments';
import { seasonRounds, worldOf } from './career-world';
import { PHYSIO_DIRECTORY, staffMarket, staffMember } from '../data/staff-directory';
import type { WorldContext } from '../domain/world';
import { staffFee } from './economy';

export const MAX_PHYSIOS = 1;
export function physioRating(physio: Physio): number { return physio.rehabilitation; }
export function physioEffects(physio: Physio): { creditPerDay: number; maximumReductionPercent: number } { return { creditPerDay: 10 + 2 * physio.rehabilitation, maximumReductionPercent: MAX_REHABILITATION_REDUCTION_PERCENT }; }
export function getClubPhysio(state: Pick<SeasonState, 'physio' | 'seasonNumber' | 'managedClubId'>, clubId = state.managedClubId): PhysioContract | null {
  return state.physio.contracts.find(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null) ?? null;
}
/** The league's market (sized to its clubs) without this season's employed staff. */
export function availablePhysios(state: Pick<SeasonState, 'physio' | 'seasonNumber'> & Partial<Pick<SeasonState, 'clubs'>> & WorldContext): Physio[] {
  const employed = new Set(state.physio.contracts.filter(contract => contract.seasonNumber === state.seasonNumber && contract.releasedRound === null).map(contract => contract.physioId));
  return staffMarket(PHYSIO_DIRECTORY, staffMarketWorld(state)).filter(physio => !employed.has(physio.id));
}
export function quotePhysioHire(state: SeasonState, physioId: string, clubId = state.managedClubId): PhysioHireQuote {
  const physio = staffMember(PHYSIO_DIRECTORY, physioId);
  const remainingAllocation = Math.max(0, staffLimit(state, clubId) - staffCommitted(state, clubId));
  const remainingBudget = remainingStaffBudget(state, clubId);
  let reason: string | null = null;
  if (!state.physio.enabledSince) reason = 'Enable physio recruitment before hiring.';
  else if (!state.finance.enabledSince) reason = 'Physio recruitment requires club finances.';
  else if (state.status !== 'active' || state.round === seasonRounds(state)) reason = 'No weekly medical review remains this season. Recruit a physio when the next season starts.';
  else if (!state.clubs.some(club => club.id === clubId) || !physio) reason = 'Choose a physio and club from this career.';
  else if (getClubPhysio(state, clubId)) reason = 'The physio position is already occupied.';
  else if (!availablePhysios(state).some(available => available.id === physioId)) reason = 'This physio already has an active club contract.';
  else if (getFinanceBalance(state.finance, clubId).unpaid) reason = 'Settle unpaid club costs before hiring a physio.';
  else if (getTransferPaymentSummary(state, clubId).overdue) reason = 'Settle overdue transfer payments before hiring a physio.';
  else reason = staffMoneyReason(state, 'physio', staffFee(state, clubId, physio.fee), remainingAllocation, remainingBudget);
  return { physioId, clubId, fee: staffFee(state, clubId, physio?.fee ?? 0), remainingAllocation, remainingBudget, canHire: reason === null, reason };
}

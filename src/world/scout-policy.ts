import type { Scout, ScoutContract, ScoutHireQuote } from '../domain/scouts';
import type { SeasonState } from '../domain/season';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { getFinanceBalance } from './finance';
import { remainingStaffBudget, staffAllocation, staffCommitted } from './staff-policy';
import { getTransferPaymentSummary } from './transfer-payments';
import { SCOUT_DIRECTORY, staffMarket } from '../data/staff-directory';
import type { WorldContext } from '../domain/world';
import { worldOf } from './career-world';
import { staffFee } from './economy';

export const MAX_SCOUTS = 3;
export function scoutRating(scout: Scout): number { return Math.round((scout.skills.evaluation + scout.skills.reporting) / 2); }
export function scoutEvidence(scout: Scout): number { return 100 + 5 * (scout.skills.evaluation + scout.skills.reporting); }
export function getClubScouts(state: Pick<SeasonState, 'scouts' | 'seasonNumber' | 'managedClubId'>, clubId = state.managedClubId): ScoutContract[] {
  return state.scouts.contracts.filter(contract => contract.clubId === clubId && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null);
}
/** The league's market (sized to its clubs) without this season's employed staff. */
export function availableScouts(state: Pick<SeasonState, 'scouts' | 'seasonNumber'> & WorldContext): Scout[] {
  const employed = new Set(state.scouts.contracts.filter(contract => contract.seasonNumber === state.seasonNumber && contract.releasedRound === null).map(contract => contract.scoutId));
  return staffMarket(SCOUT_DIRECTORY, worldOf(state)).filter(scout => !employed.has(scout.id));
}
export function quoteScoutHire(state: SeasonState, scoutId: string, clubId = state.managedClubId): ScoutHireQuote {
  const scout = SCOUT_DIRECTORY.find(scout => scout.id === scoutId);
  const remainingAllocation = Math.max(0, staffAllocation(state, clubId) - staffCommitted(state, clubId));
  const remainingBudget = remainingStaffBudget(state, clubId);
  let reason: string | null = null;
  if (!state.scouts.enabledSince) reason = 'Enable scout recruitment before hiring a scout.';
  else if (!state.scouting.enabledSince || !state.finance.enabledSince) reason = 'Scout recruitment requires scouting and club finances.';
  else if (state.status !== 'active') reason = 'Start the next season before recruiting a scout.';
  else if (!state.clubs.some(club => club.id === clubId) || !scout) reason = 'Choose a scout and club from this career.';
  else if (getClubScouts(state, clubId).length >= MAX_SCOUTS) reason = 'All three scout positions are occupied.';
  else if (!availableScouts(state).some(available => available.id === scoutId)) reason = 'This scout already has an active club contract.';
  else if (getFinanceBalance(state.finance, clubId).unpaid) reason = 'Settle unpaid club costs before hiring a scout.';
  else if (getTransferPaymentSummary(state, clubId).overdue) reason = 'Settle overdue transfer payments before hiring a scout.';
  else if (staffFee(state, clubId, scout.fee) > remainingAllocation) reason = 'This appointment exceeds the shared staff allocation. Released staff fees remain committed for this season.';
  else if (staffFee(state, clubId, scout.fee) > remainingBudget) reason = 'Not enough remaining budget after protected wages and transfer commitments.';
  return { scoutId, clubId, fee: staffFee(state, clubId, scout?.fee ?? 0), remainingAllocation, remainingBudget, canHire: reason === null, reason };
}

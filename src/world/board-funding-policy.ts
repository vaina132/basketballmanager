import type { FacilityFundingDecision, FacilityType, SeasonFacilities } from '../domain/facilities';
import type { SeasonState } from '../domain/season';
import type { DevelopmentPresident } from '../data/development-presidents';
import { clubPresident, roundOrdinal, seasonRounds, worldOf } from './career-world';
import { FACILITY_AUTOMATION_BUFFER, FACILITY_FUNDS_REASON, quoteFacilityUpgrade } from './facilities-policy';
import { getSpendablePosition } from './payroll-policy';
import { ownerCapital } from './board-consequences';

/** Confidence the board requires is 65 minus five per point of presidential generosity (60 to 40). */
export const BOARD_FUNDING_BASE_CONFIDENCE = 65;
export const BOARD_FUNDING_GENEROSITY_STEP = 5;
/** After a refusal, the board reconsiders once this many further matchdays have been reached. */
export const BOARD_FUNDING_REFUSAL_COOLDOWN = 2;
/** Matchdays as one sequence across seasons; stored in anchors and counted forward, so it uses the season length. */
const ordinal = (seasonNumber: number, round: number, rounds: number) => roundOrdinal(seasonNumber, round, rounds);
const eurosFormat = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euros = (cents: number) => eurosFormat.format(cents / 100);

export function requiredBoardConfidence(president: Pick<DevelopmentPresident, 'generosity'>): number {
  return BOARD_FUNDING_BASE_CONFIDENCE - BOARD_FUNDING_GENEROSITY_STEP * president.generosity;
}

/** The latest board confidence already reviewed at this boundary; 50 before the first review. */
export function boardConfidenceNow(state: Pick<SeasonState, 'board' | 'finance' | 'date'>, clubId: string): number {
  return state.board.reviews.filter(review => review.ledgerCount <= state.finance.ledger.length && review.date <= state.date).at(-1)?.clubs[clubId]?.confidence ?? 50;
}

export function boardCapitalGranted(facilities: Pick<SeasonFacilities, 'events'>, clubId: string, seasonNumber: number): number {
  return facilities.events.reduce((sum, event) => sum + (event.type === 'funding' && event.approved && event.clubId === clubId && event.seasonNumber === seasonNumber ? event.amount : 0), 0);
}

/** The board's stated reason for a refusal, rebuilt from the recorded decision evidence; null for an approval. */
export function boardFundingRefusal(decision: Pick<FacilityFundingDecision, 'approved' | 'confidence' | 'requiredConfidence' | 'capitalRemaining'>): string | null {
  if (decision.approved) return null;
  return decision.confidence < decision.requiredConfidence ? `The board needs confidence of at least ${decision.requiredConfidence}; it is ${decision.confidence}.` : `The owner has ${euros(decision.capitalRemaining)} of capital left this season.`;
}

export interface BoardFundingQuote {
  clubId: string;
  facilityType: FacilityType;
  mode: 'manager' | 'automatic';
  president: DevelopmentPresident;
  cost: number;
  available: number;
  /** Capital asked for: the shortfall, plus the automatic cash cushion for automatic control. */
  amount: number;
  confidence: number;
  requiredConfidence: number;
  seasonCapital: number;
  capitalRemaining: number;
  /** Whether a request can be made at all, and why not. */
  eligible: boolean;
  reason: string | null;
  /** The board's answer to an eligible request, and its explanation when refused. */
  approved: boolean;
  refusal: string | null;
}

/**
 * The board funds the missing part of one facility upgrade from the owner's capital for the season when its
 * confidence meets the president's threshold. The rules are visible; the same answer applies to every club.
 */
export function quoteBoardFunding(state: SeasonState, type: FacilityType, clubId = state.managedClubId, mode: 'manager' | 'automatic' = 'manager'): BoardFundingQuote {
  const president = clubPresident(worldOf(state), clubId);
  const upgrade = quoteFacilityUpgrade(state, type, clubId);
  // A negative position means wages and fees already exceed cash; capital is never a back door for those.
  const position = getSpendablePosition(state, clubId), available = Math.max(0, position);
  const amount = Math.max(0, upgrade.cost + (mode === 'automatic' ? FACILITY_AUTOMATION_BUFFER : 0) - available);
  const confidence = boardConfidenceNow(state, clubId), requiredConfidence = requiredBoardConfidence(president);
  // The previous season's board verdict can raise, halve or withhold the owner's capital (see board-consequences).
  const seasonCapital = ownerCapital(state, clubId);
  const capitalRemaining = Math.max(0, seasonCapital - boardCapitalGranted(state.facilities, clubId, state.seasonNumber));
  const refused = [...state.facilities.events].reverse().find(event => event.type === 'funding' && !event.approved && event.clubId === clubId);
  const wait = refused ? ordinal(refused.seasonNumber, refused.round, seasonRounds(state)) + BOARD_FUNDING_REFUSAL_COOLDOWN - ordinal(state.seasonNumber, state.round, seasonRounds(state)) : 0;
  let reason: string | null = null;
  if (!state.facilities.fundingSince) reason = 'Enable board funding requests first.';
  else if (!state.board.enabledSince) reason = 'Enable board reviews before asking for capital.';
  else if (upgrade.fromLevel === upgrade.toLevel) reason = 'This facility is already at the highest development level.';
  else if (upgrade.reason && upgrade.reason !== FACILITY_FUNDS_REASON) reason = upgrade.reason;
  else if (amount === 0) reason = 'The club can fund this upgrade without board capital.';
  else if (position < 0) reason = 'Committed wages and fees already exceed the club\'s cash; the board will not fund new construction.';
  else if (wait > 0) reason = `The board will reconsider after ${wait} more ${wait === 1 ? 'matchday' : 'matchdays'}.`;
  const approved = reason === null && confidence >= requiredConfidence && amount <= capitalRemaining;
  const refusal = reason === null ? boardFundingRefusal({ approved, confidence, requiredConfidence, capitalRemaining }) : null;
  return { clubId, facilityType: type, mode, president, cost: upgrade.cost, available, amount, confidence, requiredConfidence, seasonCapital, capitalRemaining, eligible: reason === null, reason, approved, refusal };
}

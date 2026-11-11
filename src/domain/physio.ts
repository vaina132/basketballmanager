import type { SeasonInjury } from './season';
import type { RosterSnapshot } from './roster';
import type { Team } from './types';

export interface Physio { id: string; name: string; rehabilitation: number; fee: number }
export interface PhysioContract {
  id: string;
  physioId: string;
  clubId: string;
  seasonNumber: number;
  startedRound: number;
  releasedRound: number | null;
  renew: boolean;
  hiredLedgerIndex: number;
  releasedLedgerIndex: number | null;
}

/** Dated treatment outcome; the original injury diagnosis is never rewritten. */
export interface RehabilitationRecord {
  id: string;
  injuryId: string;
  playerId: string;
  clubId: string;
  seasonNumber: number;
  afterRound: number;
  fromDate: string;
  toDate: string;
  rosterId: string;
  contractId: string;
  physioId: string;
  eligibleDays: number;
  creditBefore: number;
  creditEarned: number;
  creditAfter: number;
  returnBefore: string;
  returnAfter: string;
}

export interface SeasonPhysio {
  model: 'physio-1';
  enabledSince: { seasonNumber: number; round: number; ledgerIndex: number } | null;
  contracts: PhysioContract[];
  rehabilitation: RehabilitationRecord[];
}

export interface PhysioHireQuote {
  physioId: string;
  clubId: string;
  fee: number;
  remainingAllocation: number;
  remainingBudget: number;
  canHire: boolean;
  reason: string | null;
}

export interface RehabilitationWeekInput {
  physio: SeasonPhysio;
  clubs: readonly Team[];
  rosters: readonly RosterSnapshot[];
  injuries: readonly SeasonInjury[];
  seasonNumber: number;
  afterRound: number;
  fromDate: string;
  toDate: string;
}

export interface PlayerMedicalSummary {
  injury: SeasonInjury;
  originalReturnOn: string;
  effectiveReturnOn: string;
  daysRemaining: number;
  daysSaved: number;
  progress: number;
  credit: number;
  creditCap: number;
  /** The physio currently responsible for the registered club, if any. */
  physioId: string | null;
  lastReview: RehabilitationRecord | null;
  pending: boolean;
}

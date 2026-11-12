export interface YouthCoach { id: string; name: string; development: number; fee: number }
export interface YouthCoachContract {
  id: string;
  coachId: string;
  clubId: string;
  seasonNumber: number;
  startedRound: number;
  releasedRound: number | null;
  renew: boolean;
  hiredLedgerIndex: number;
  releasedLedgerIndex: number | null;
}
export interface SeasonYouth {
  model: 'youth-1';
  enabledSince: { seasonNumber: number; round: number; ledgerIndex: number } | null;
  contracts: YouthCoachContract[];
}
export interface YouthCoachHireQuote {
  coachId: string;
  clubId: string;
  fee: number;
  remainingAllocation: number;
  remainingBudget: number;
  canHire: boolean;
  reason: string | null;
}

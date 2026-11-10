/** Authored development staff, with role skills from one to ten. */
export interface Scout {
  id: string;
  name: string;
  skills: { evaluation: number; reporting: number };
  /** Full-season fee in euro cents; midseason appointments have the same fee. */
  fee: number;
}

export interface ScoutContract {
  id: string;
  scoutId: string;
  clubId: string;
  seasonNumber: number;
  startedRound: number;
  releasedRound: number | null;
  renew: boolean;
  /** Ledger length immediately before this appointment's fee. */
  hiredLedgerIndex: number;
  releasedLedgerIndex: number | null;
}

export interface SeasonScouts {
  model: 'scouts-1';
  enabledSince: { seasonNumber: number; round: number; ledgerIndex: number } | null;
  /** Career history is retained to explain every named observation. */
  contracts: ScoutContract[];
}

export interface ScoutHireQuote {
  scoutId: string;
  clubId: string;
  fee: number;
  remainingAllocation: number;
  remainingBudget: number;
  canHire: boolean;
  reason: string | null;
}

export interface ScoutingObserver {
  contractId: string | null;
  scoutId: string | null;
  /** Potential evidence if the target plays; 100 is one baseline observation. */
  evidence: number;
  assignedLedgerIndex: number;
}

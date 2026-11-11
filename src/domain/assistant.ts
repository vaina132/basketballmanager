export interface AssistantCoach { id: string; name: string; assessment: number; fee: number }

export interface AssistantContract {
  id: string;
  assistantId: string;
  clubId: string;
  seasonNumber: number;
  startedRound: number;
  releasedRound: number | null;
  renew: boolean;
  hiredLedgerIndex: number;
  releasedLedgerIndex: number | null;
}

export interface SeasonAssistant {
  model: 'assistant-1';
  enabledSince: { seasonNumber: number; round: number; ledgerIndex: number } | null;
  /** Retained across seasons so appointment fees and releases remain auditable. */
  contracts: AssistantContract[];
}

export interface AssistantHireQuote {
  assistantId: string;
  clubId: string;
  fee: number;
  /** Available allocation and cash-limited budget before this appointment. */
  remainingAllocation: number;
  remainingBudget: number;
  canHire: boolean;
  reason: string | null;
}

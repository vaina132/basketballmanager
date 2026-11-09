/** Immutable employment terms. Seasonal payroll remains a separate payment schedule. */
export interface EmploymentContract {
  id: string;
  playerId: string;
  clubId: string;
  startsSeason: number;
  endsSeason: number;
  /** Gross annual wage in euro cents. */
  seasonWage: number;
  signedSeason: number;
  signedRound: number;
  kind: 'initial' | 'renewal' | 'free-agent';
}

export interface SeasonEmployment {
  model: 'employment-1';
  enabledSince: { seasonNumber: number; round: number } | null;
  delegated: boolean;
  contracts: EmploymentContract[];
  /** Completed-season rosters remain unchanged while next year's terms are agreed. */
  market: { seasonNumber: number } | null;
}

export interface ClubContractSummary {
  clubId: string;
  seasonNumber: number;
  rosterSize: number;
  seasonWages: number;
  budget: number;
  remainingBudget: number;
  minimumReserve: number;
  spendableBudget: number;
  contracts: EmploymentContract[];
}

export interface PlayerContractQuote {
  playerId: string;
  clubId: string;
  startsSeason: number;
  endsSeason: number;
  seasons: number;
  seasonWage: number;
  askingWage: number;
  canOffer: boolean;
  reason: string | null;
}

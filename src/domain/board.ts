export interface BoardAnchor {
  seasonNumber: number;
  round: number;
  date: string;
  completedRounds: number;
  ledgerCount: number;
  rosterCount: number;
}

export interface BoardClubMandate {
  rosterId: string;
  resourceRank: number;
  targetWins: number;
  games: number;
  /** Recorded unpaid costs and overdue transfer fees, in euro cents. Null when finances are disabled. */
  startingUnpaid: number | null;
}

export interface BoardMandate extends BoardAnchor {
  id: string;
  startsRound: number;
  deadlineDate: string;
  clubs: Record<string, BoardClubMandate>;
}

export interface BoardClubReview {
  fixtureIds: string[];
  played: number;
  wins: number;
  targetPace: number;
  /** Recorded pre-existing absences in the fixtures used by this review. */
  carriedAbsences: number;
  rosterPlaces: number;
  unpaid: number | null;
  resultsImpact: number;
  injuryRelief: number;
  financeImpact: number;
  assessment: number;
  previousConfidence: number;
  confidence: number;
}

export interface BoardReview extends BoardAnchor {
  id: string;
  mandateId: string;
  clubs: Record<string, BoardClubReview>;
}

export interface SeasonBoard {
  model: 'board-1';
  enabledSince: (BoardAnchor & { includeCurrentRound: boolean }) | null;
  mandates: BoardMandate[];
  reviews: BoardReview[];
  /** Season verdicts set later budgets from this anchor (format 33); absent in older formats, null until enabled. */
  consequencesSince?: BoardAnchor | null;
}

export interface BoardSummary {
  enabled: boolean;
  confidence: number;
  confidenceLabel: string;
  mandate: BoardMandate | null;
  objective: BoardClubMandate | null;
  latest: (BoardReview & { club: BoardClubReview }) | null;
  history: (BoardReview & { club: BoardClubReview })[];
  nextReviewDate: string | null;
  sportingStatus: 'waiting' | 'building' | 'on-track' | 'behind' | 'met' | 'missed';
  financeStatus: 'unassessed' | 'waiting' | 'on-track' | 'behind';
}

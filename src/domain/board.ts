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
  /** Format 35, once rivalries govern the review: derby wins and losses in the counted games. */
  rivalryImpact?: number;
  /** Format 67, the manager's club in careers with media: media standing and recent press answers (`src/world/media.ts`). */
  mediaImpact?: number;
  assessment: number;
  previousConfidence: number;
  confidence: number;
}

export interface BoardReview extends BoardAnchor {
  id: string;
  mandateId: string;
  clubs: Record<string, BoardClubReview>;
}

/**
 * Format 63 (`career-2` careers): a club's board starts afresh with a new coach. The next review moves from
 * `confidence` instead of the previous coach's confidence. `reviewCount` orders the restart against the reviews.
 */
export interface BoardRestart {
  clubId: string;
  seasonNumber: number;
  /** The week of the change (the season's last week for `end` and `offseason`). */
  round: number;
  /** As for career moves: before week `round`'s games, at the season end, or during its offseason. */
  phase: 'season' | 'end' | 'offseason';
  date: string;
  /** Reviews recorded before the change. */
  reviewCount: number;
  confidence: number;
  /** `manager`: the manager took over (career start or a move); `ai`: the club appointed another coach. */
  coach: 'manager' | 'ai';
}

export interface SeasonBoard {
  model: 'board-1';
  enabledSince: (BoardAnchor & { includeCurrentRound: boolean }) | null;
  mandates: BoardMandate[];
  reviews: BoardReview[];
  /** Season verdicts set later budgets from this anchor (format 33); absent in older formats, null until enabled. */
  consequencesSince?: BoardAnchor | null;
  /** Format 63, `career-2` careers only: coach changes that restart a board's confidence, in chronological order. */
  restarts?: BoardRestart[];
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
  /** Format 63: this club's fresh starts for a new coach (empty in older careers). */
  restarts: BoardRestart[];
}

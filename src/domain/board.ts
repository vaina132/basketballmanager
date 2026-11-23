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
  /** Format 70, board-2: the most confidence may move in one review, from the president's patience. */
  reviewStep?: number;
  /** Format 70, board-2: a final confidence below this gives the Under pressure verdict (dismissal line), from the president's patience. */
  pressureBelow?: number;
  /** Format 70, board-2: the youth objective, or null when this board sets none. */
  youth?: BoardYouthObjective | null;
  /** Format 70, board-2: the culture objective, or null when this board sets none. */
  culture?: BoardCultureObjective | null;
  /** Format 83 (careers with European entry rules): the European aim, or null when this board sets none. */
  europe?: BoardEuropeanAim | null;
  /** Format 91 (NBA clubs of worlds with `world.nba.cap`): the playoff aim, or null when this owner sets none. */
  playoffs?: BoardPlayoffAim | null;
}

/** Format 91: an NBA owner's aim for the postseason: reach the playoffs (first round), or at least the play-in (top ten of the conference). */
export interface BoardPlayoffAim { kind: 'nba-playoffs' | 'nba-play-in' }

/**
 * Format 83 (owner decision, 22 November 2026: a European aim counts in the season verdict): a stage to reach in the
 * club's European competition this season (`keep`: a EuroCup-route holder keeps its place by reaching the playoffs), or
 * a European place for next season (`european-place`, decided on the places day at the season's last review).
 */
export interface BoardEuropeanAim {
  kind: 'euroleague-playoffs' | 'euroleague-play-in' | 'eurocup-quarter-finals' | 'eurocup-eighth-finals' | 'bcl-quarter-finals' | 'bcl-round-of-16' | 'european-place';
  competitionId: string | null;
  keep?: true;
}

/**
 * Format 70 youth objectives: minutes for under-23 and academy players in counted games (`youth-minutes`), or a
 * promotion from the club's own academy during the season (`academy-promotion`, set for the manager's club only,
 * because rival clubs do not promote prospects in this game).
 */
export type BoardYouthObjective =
  | { kind: 'youth-minutes'; targetMinutes: number; maxAge: number }
  | { kind: 'academy-promotion'; target: number };

/**
 * Format 70 culture objectives: keep a number of the club's own players (registered with it last season, or from its
 * academy, frozen in `playerIds` at the season opening; in a career's first season the whole opening squad) in the
 * rotation (`established-core`), or a style of playing young players: a number of under-23 players in the rotation
 * (`young-rotation`). The game holds no player nationalities, so national-player objectives are not offered.
 */
export type BoardCultureObjective =
  | { kind: 'established-core'; target: number; playerIds: string[] }
  | { kind: 'young-rotation'; target: number; maxAge: number };

/** Format 70: what the president asks of the manager, with a deadline (a later review week of the same season). */
export type BoardRequestKind = 'raise-ticket-price' | 'sign-player' | 'play-player';

export interface BoardRequest {
  id: string;
  clubId: string;
  kind: BoardRequestKind;
  /** The review that raised it. */
  seasonNumber: number;
  round: number;
  date: string;
  /** The review week by which it must be met; unmet at that review, it counts as ignored. */
  deadlineRound: number;
  /** `raise-ticket-price`: the lowest manual home ticket price that meets it, in euro cents. */
  ticketPrice?: number;
  /** `sign-player`: the position of the player to register. */
  position?: string;
  /** `play-player`: the player to give minutes, and the minutes needed in counted games after the request. */
  playerId?: string;
  minutes?: number;
  /** `withdrawn`: the named player left the club, so the request lapsed without effect. */
  outcome: 'open' | 'met' | 'ignored' | 'withdrawn';
  resolvedRound: number | null;
}

export interface BoardMandate extends BoardAnchor {
  id: string;
  startsRound: number;
  deadlineDate: string;
  clubs: Record<string, BoardClubMandate>;
}

export interface BoardClubReview {
  /** The games counted; absent from reviews of sealed seasons (format 73), where they follow from the season's results. */
  fixtureIds?: string[];
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
  /** Format 71, careers with facility financing: a high debt ratio lowers the assessment a little (-1 to -4); absent at 0. */
  debtImpact?: number;
  /** Format 70, board-2 with a youth objective: progress (minutes, or academy promotions) and its assessment points. */
  youthProgress?: number;
  youthImpact?: number;
  /** Format 70, board-2 with a culture objective: players meeting it in the rotation and its assessment points. */
  cultureProgress?: number;
  cultureImpact?: number;
  /** Format 70, board-2: confidence added or removed by the president's requests met or ignored at this review. */
  requestImpact?: number;
  /** Format 83, with a European aim: whether it is met, missed or still open, and its assessment points. */
  europeProgress?: 'open' | 'met' | 'missed';
  europeImpact?: number;
  /** Format 91, with an NBA playoff aim: whether it is met, missed or still open, and its assessment points. */
  playoffsProgress?: 'open' | 'met' | 'missed';
  playoffsImpact?: number;
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
  /** `board-2` (format 70, new careers): president personalities, salary budget verdicts, youth and culture objectives and the president's requests. */
  model: 'board-1' | 'board-2';
  enabledSince: (BoardAnchor & { includeCurrentRound: boolean }) | null;
  mandates: BoardMandate[];
  reviews: BoardReview[];
  /** Season verdicts set later budgets from this anchor (format 33); absent in older formats, null until enabled. */
  consequencesSince?: BoardAnchor | null;
  /** Format 63, `career-2` careers only: coach changes that restart a board's confidence, in chronological order. */
  restarts?: BoardRestart[];
  /** Format 70, board-2 only: the president's requests to the manager, in order. */
  requests?: BoardRequest[];
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

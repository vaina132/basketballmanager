import type { ContractRequestStatus } from '../domain/relationships';

/**
 * The numbers behind the `relationships-2` model (new careers from format 66). Careers saved with `relationships-1`
 * keep their original rules: every player without an agreed role is a Rotation player, and nobody asks about contracts.
 */
export const RELATIONSHIP_RULES = Object.freeze({
  /**
   * Default roles. The match engine's automatic rotation plans about 26.8 down to 14.2 minutes for the players ranked
   * one to nine, about 4 for the tenth and none for the eleventh and twelfth (`ROTATION.plannedMinutes`). A player
   * without an agreed role therefore defaults to Rotation (12+ minutes) when he ranks in the top nine of his registered
   * squad by overall rating, and to Reserve below that. The best five stay Rotation: the engine's starters average
   * about 23.8 planned minutes, so a 24-minute Starter default would raise concerns for ordinary rotations. The role
   * minimums themselves are unchanged. The rank is recorded once per registration snapshot (each season start and
   * each in-season registration change), from the players' current overall ratings, so saves replay it exactly.
   */
  defaultRoles: { rotationMaxRank: 9 },
  /** Final-year players who matter ask about a new contract; the club answers, ignores or lets the request lapse. */
  contractRequests: {
    /** Requests start once this share of the season's matchdays is complete (the middle of the season). */
    fromSeasonShare: 0.5,
    /** Another club's in-season transfer proposal for the player makes him ask at the next matchday, even earlier. */
    interestTrigger: true,
    /** At most this many new requests per club at one matchday; interest first, then the best-ranked players. */
    maxNewPerClubRound: 2,
    /** A player is valued with any of: a squad rank this high, this many recent minutes (3+ of his last 4 eligible games), or this frozen morale. */
    valued: { maxRank: 6, minMinutes: 20, minMorale: 65 },
    /** Matchdays to answer; an unanswered request then counts as ignored. Requests stop when no full reply window remains. */
    replyRounds: 3,
    /** After opening talks, an offer must follow within this many matchdays (and before the season ends). */
    talksRounds: 3,
    /** Morale and trust changes by outcome, fading by half every halfLifeDays from the outcome date. */
    effects: {
      ignored: { morale: -6, trust: -8 },
      declined: { morale: -8, trust: -10 },
      lapsed: { morale: -6, trust: -8 },
      broken: { morale: -10, trust: -15 },
      kept: { morale: 2, trust: 4 },
      renewed: { morale: 4, trust: 6 },
    } as Readonly<Partial<Record<ContractRequestStatus, { morale: number; trust: number }>>>,
    halfLifeDays: 42,
    /** Bounds on the combined contract-request effect for one player. */
    bounds: { morale: { min: -12, max: 6 }, trust: { min: -15, max: 6 } },
    /**
     * Harder to re-sign: after a refusal the player asks this much more (percent of his wage) to sign with that club,
     * for the request's season and the next. Renewing him removes it.
     */
    premiumPercent: { ignored: 10, declined: 15, lapsed: 10, broken: 15 } as Readonly<Partial<Record<ContractRequestStatus, number>>>,
    premiumSeasons: 2,
    /** AI clubs answer at once: they renew players ranked this high when the contract fits their budget, and let others go. */
    ai: { renewMaxRank: 8, renewalSeasons: 2 },
  },
});

const REQUESTS = RELATIONSHIP_RULES.contractRequests;
/** Player-facing phrases built from the rules above, so screens and messages never drift from them. */
export const CONTRACT_REQUEST_TEXT = Object.freeze({
  replyWindow: `${REQUESTS.replyRounds} matchdays`,
  talksWindow: `${REQUESTS.talksRounds} matchdays`,
  /** For example "costs 10 trust and 8 morale". */
  cost: (status: ContractRequestStatus) => `costs ${-(REQUESTS.effects[status]?.trust ?? 0)} trust and ${-(REQUESTS.effects[status]?.morale ?? 0)} morale`,
  /** For example "he asks 15% more to re-sign for 2 seasons". */
  premium: (status: ContractRequestStatus) => `he asks ${REQUESTS.premiumPercent[status] ?? 0}% more to re-sign for ${REQUESTS.premiumSeasons} seasons`,
});

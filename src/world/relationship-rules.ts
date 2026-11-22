import type { ContractRequestStatus, SquadRole } from '../domain/relationships';

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

/**
 * The `relationships-3` model (squad roles everywhere; new careers from format 74). Defaults recorded in
 * docs/decisions.md ("Squad roles everywhere").
 */
export const SQUAD_ROLE_RULES = Object.freeze({
  /**
   * Expected minutes per eligible game (regulation is 200 squad minutes). The minimums follow the match engine's
   * automatic rotation, which plans about 26.8 and 25.3 minutes for the two best players, 23.8-20.8 for the next three,
   * 20.7-14.2 for the sixth to ninth, about 4 for the tenth and none for the last two (`ROTATION.plannedMinutes`), so
   * the default roles below are met by an ordinary rotation and only real neglect raises a concern. A Prospect expects
   * development and some minutes when they come, not a fixed share, so his minimum is zero.
   */
  definitions: {
    star: { label: 'Star', minMinutes: 24, maxMinutes: 34 },
    starter: { label: 'Starter', minMinutes: 20, maxMinutes: 30 },
    rotation: { label: 'Rotation', minMinutes: 12, maxMinutes: 20 },
    development: { label: 'Reserve', minMinutes: 0, maxMinutes: 8 },
    prospect: { label: 'Prospect', minMinutes: 0, maxMinutes: 15 },
  } as Readonly<Record<SquadRole, { label: string; minMinutes: number; maxMinutes: number }>>,
  /** Highest role first: the order of demotions and of the role menus. */
  order: ['star', 'starter', 'rotation', 'development', 'prospect'] as readonly SquadRole[],
  /**
   * Default roles by the recorded squad rank (best overall rating first) and age on the registration date: the best two
   * are Stars, the next three Starters, the rest of the top nine Rotation, the others Reserve; players under 21 outside
   * the top eight are Prospects instead.
   */
  defaults: { starMaxRank: 2, starterMaxRank: 5, rotationMaxRank: 9, prospectMaxAge: 20, prospectOutsideRank: 8 },
  /**
   * Contract roles. The role offered changes the asking wage by these percentages (before the contract-length premium;
   * never below the minimum contract wage). A player's standing at the offering club is his rank by market value (his
   * asking wage) among the players contracted there now: a natural Star (top two) refuses any role below Starter, a
   * natural Starter (top five) refuses a Reserve or Prospect role, and only players under 23 accept a Prospect role.
   * Computer clubs offer each player his natural role. The agreed role is a contract term: it is the player's
   * expected role from the contract's first day until another role is agreed.
   */
  contracts: {
    wagePercent: { star: 15, starter: 5, rotation: 0, development: -10, prospect: -15 } as Readonly<Record<SquadRole, number>>,
    standing: { starMaxRank: 2, starterMaxRank: 5, rotationMaxRank: 9 },
    prospectMaxAge: 22,
  },
  /**
   * Changing a role from the Squad list. A demotion is refused when the player's standing (as above) rules out the
   * lower role, when his trust is below 35 or while he has asked to leave; otherwise he accepts it unhappily (morale and
   * trust -4, fading; -8 morale when it goes below the role in his contract). Promotions keep the 200-minute limit.
   */
  changes: { minTrustForDemotion: 35, demotionMorale: -4, belowContractMorale: -8 },
  /**
   * An unmet role escalates. The concern itself lowers morale as before. When the last `talksAfterGames` eligible games
   * in the role average below its minimum, the player asks for talks; a conversation or role change answers him. If
   * the concern is still there `leaveAfterRounds` club matchdays later and no playing-time promise is running, he
   * asks to leave (a transfer request): morale `leaveMorale` until his minutes meet the role again or he leaves.
   */
  escalation: { talksAfterGames: 6, leaveAfterRounds: 4, leaveMorale: -10 },
});

/**
 * The `relationships-4` model (calmer playing time; owner feedback, 22 November 2026; new careers from format 77). The
 * five roles, their minutes, defaults and contract terms stay as in `SQUAD_ROLE_RULES`; only how playing time is judged
 * and answered changes, the same way for every club:
 * - minutes are judged over the player's last `window.games` eligible games in his role, once at least
 *   `window.minGames` count; games he was injured, ill, disqualified or not in the matchday squad do not count;
 * - he is short only when he averages below `shareOfMinimum` of his role's minimum (8 of a Rotation player's 12);
 * - a player whose role is a default, an earlier quiet adjustment or a contract role below Starter accepts the role his
 *   minutes fit quietly (a note on Squad dynamics, no message). Here games outside the matchday squad count as zero:
 *   a player who is never picked has no claim to his default role;
 * - others (a role agreed with the manager, or a Star or Starter by contract) say once, calmly, that they would like more
 *   minutes; a new message for the same player follows only after the concern has been settled for
 *   `concern.repeatAfterRounds` club matchdays;
 * - only a Star or Starter by contract escalates: talks when the concern has stood `escalation.talksAfterRounds`
 *   matchdays without a running promise while he averages below `escalation.belowShare` of the minimum, then a wish to
 *   leave `escalation.leaveAfterRounds` matchdays later under the same conditions.
 * Reserve and Prospect roles expect no minimum, so they never complain.
 */
export const PLAYING_TIME_RULES = Object.freeze({
  window: { games: 8, minGames: 6 },
  shareOfMinimum: 2 / 3,
  concern: { repeatAfterRounds: 8, maxMorale: 10 },
  escalation: { talksAfterRounds: 8, leaveAfterRounds: 8, belowShare: 0.5, leaveMorale: -10 },
});

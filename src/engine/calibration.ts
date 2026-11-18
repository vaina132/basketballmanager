/**
 * Match calibration (sprint 4) for the possession engine and the automatic rotation.
 *
 * Targets: 2025-26 regular season, per team per game, plain mean of nine European competitions (EuroLeague, EuroCup,
 * BCL, ACB, BBL, LBA, LNB, BSL, GBL); the official totals include team rebounds and team turnovers.
 * - Points 85.2 (82.7-88.1 across leagues); about 75.7 possessions (FGA - ORB + TOV + 0.44 FTA); about 112.5 points per 100.
 * - FG 29.7-64.1 (46.3%); 2P 20.3-37.3 (54.6%); 3P 9.4-26.9 (34.8%, 3PA 41.9% of FGA); FT 16.4-21.8 (75.3%, FTA/FGA 0.34).
 * - Rebounds 11.2 offensive and 24.7 defensive, about 2 + 2 of them team rebounds (player rebounds about 32).
 * - Assists 18.5 (62% of field goals assisted); turnovers 13.2; steals 7.0; blocks 2.6; personal fouls 22.0.
 * - Final margins average 12.0 points (15.4% within 3, 27.0% within 5, 51.9% within 10, 17.8% by 20 or more);
 *   4.8% of games go to overtime; home teams win 59.4%.
 * - Starters play 23-24 minutes (10th-90th percentile about 15-31) and take 57-59% of team minutes and 59-62% of the
 *   points; 5.2-5.8 bench players get on court for about 15 minutes each; the five longest-playing players take 63-65%.
 * Measured by simulating seasons of real-data worlds (each of the six domestic top divisions in the online pack with its
 * European games, about 6,800 games) with the AI rotation and the managed side's assistant substitutions.
 */

/** Seconds of game clock an action takes before tempo and its random spread (the advance includes the inbound). */
export const ACTION_SECONDS = { advance: 5.3, frontcourtInbound: 3, drive: 4.8, pass: 3.3, shot: 4 } as const;

/**
 * Chance of shooting rather than passing or driving after the advance: base + per later action + outside intent
 * (close to the basket: closeRange). Otherwise a pass with passBase - passDecay per later action + outside intent x
 * passOutside, else a drive: the ball handler starts the play with a pass, receivers more often attack the basket. A pass
 * goes to a forward or centre with weight bigReceiver - outside intent, to a guard or wing with wingReceiver + outside intent.
 */
export const SHOT_SELECTION = { base: .075, perAction: .17, outsideShare: .13, max: .7, closeRange: .58, passBase: .6, passDecay: .3, passOutside: .45, bigReceiver: 1.3, wingReceiver: .62 } as const;

/** Turnovers per action. Defensive pressure and the defender's defense over the handler's passing add to the base. */
export const TURNOVERS = {
  advance: .017, pass: .047, drive: .051, shot: .012, pressure: .026, skillGap: .003, fatigue: .014, max: .14,
  /** Share of live-ball turnovers that are steals; the rest go out of bounds. */
  stealShare: .59,
  /** Team-control (offensive) fouls per action: a turnover and a personal foul, no free throws. */
  offensiveFoul: .01,
} as const;

/** Non-shooting defensive fouls per action, plus the defending side's pressure. */
export const DEFENSIVE_FOULS = { advance: .022, pass: .03, drive: .07, shot: .026, pressure: .028 } as const;

/** Shooting fouls: base and pressure, extra on two-point attempts; wide-open shooters are fouled less. */
export const SHOOTING_FOULS = { base: .025, pressure: .03, twoPoint: .13, separation: .03, min: .01, max: .25 } as const;

/**
 * Field-goal make chance: base plus the shooter's skill (1-20 scale) per shot value, less the matched defender's defense
 * above 10, before space, height, range and fatigue. Skill and defense weigh about equally, so a league of weaker
 * players still scores about as much as a strong one, while the gap between two sides decides who wins.
 */
export const SHOT_MAKING = { twoBase: .441, twoSkill: .013, threeBase: .228, threeSkill: .012, defense: .009, rushed: .06, andOne: .65 } as const;

/** Home teams shoot slightly better and visitors slightly worse (home teams win 59.4% of games). */
export const HOME_COURT_MAKE_BONUS = .016;

/**
 * Score effects: a side's make chance falls by perPoint for each point of its lead (up to cap) and rises as much when it
 * trails, 1.75 times as much from the fourth quarter on. Leading teams ease off and rest players, trailing teams
 * push, so final margins average 12 points rather than the 14 that independent possessions give.
 */
export const SCORE_EFFECT = { perPoint: .0016, cap: 15, fourthQuarter: 1.75 } as const;

/**
 * Which defender commits a foul or blocks a two-point shot: weights by position, with the attacker's own defender counted
 * matchedFoul or matchedBlock times (threes are always his). Bigs foul and block most, as in real box scores.
 */
export const DEFENDER_ROLES = {
  foul: { PG: .7, SG: .85, SF: 1, PF: 1.15, C: 1.25 }, matchedFoul: 1.5,
  block: { PG: .2, SG: .4, SF: .9, PF: 1.8, C: 3.5 }, matchedBlock: 1.5,
  /** A defender with three or four fouls is this much less likely to be the one who fouls (fewer foul-outs). */
  caution: { 3: .7, 4: .35 },
} as const;

/**
 * Blocked shots: two-point chance from defense, height and closeness; threes are blocked far less often. Blocking
 * (src/world/extra-attributes.ts, EXTRA_MATCH) adds to two-point chances, so defense weighs less than before (.0038).
 */
export const BLOCKS = { base: .028, defense: .003, height: .002, separation: .025, min: .005, max: .16, threeFactor: .2 } as const;

/**
 * Last possession of a close fourth quarter or overtime (the game clock at most shotClockGrace beyond the shot clock):
 * tied or down by up to maxDeficit, the attack holds the ball and shoots with shootAt seconds or fewer left, a three when
 * down three. With foulSeconds or fewer left, a defense trailing by up to foulMaxLead fouls within foulDelay seconds to
 * stop the clock (4.8% of games go to overtime).
 */
export const LATE_GAME = { maxDeficit: 3, shootAt: 4, shotClockGrace: 6, foulSeconds: 24, foulMaxLead: 3, foulDelay: 2 } as const;

/** Offensive rebound chance from rebounding strength near the landing spot. */
export const REBOUNDS = { offensiveBase: .29, strength: .014, numbers: .035, min: .14, max: .48 } as const;
/** Share of rebounds that go out of bounds and count for the team, not a player (about 4 of 36 per team), and the attack's share of them. */
export const TEAM_REBOUND_SHARE = .11, TEAM_REBOUND_OFFENSIVE_SHARE = .45;

/**
 * Automatic rotation. Players are ranked by overall rating, starters first by a margin; each rank has a planned share of
 * the 200 team minutes, shifted by quality. At each legal stoppage the assistant swaps players whose minutes, fatigue or
 * foul trouble have drifted furthest from that plan.
 */
export const ROTATION = {
  /** Planned minutes by rank (1-12) before the quality shift; scaled so the team's total is 200. */
  plannedMinutes: [26.8, 25.3, 23.8, 22.3, 20.8, 20.7, 18.7, 16.7, 14.2, 4, 0, 0],
  /** Players ranked beyond the first rotationSize (the 11th and 12th) sit unless needed: minutes of need against them outside garbage time. */
  rotationSize: 10, depthPenalty: 4,
  /** Rating points a starter is ahead of a bench player when ranking. */
  starterBonus: 6,
  /** Planned minutes per rating point above or below the rotation's average (first ten). */
  qualityMinutes: .25,
  /** Condition below which a player wants rest, and minutes of need per condition point below it. */
  restCondition: 92, fatigueWeight: .12,
  /** Minutes of need against a player in foul trouble (two in the first quarter, three in the second, four later). */
  foulTrouble: 5,
  /** Minutes of need a swap must gain, and per step of positional mismatch (PG to C is four steps). */
  swapThreshold: 3, positionStep: .7,
  /** Swaps per side at one stoppage. */
  maxSwaps: 2,
  /** Close finish: last seconds of the fourth quarter or overtime within this margin; the best five close. */
  closingSeconds: 180, closingMargin: 10, closingBonus: 8,
  /** Garbage time: fourth quarter with this margin and time left; the players ranked beyond garbageRank (ninth on) come in, the top five sit. */
  garbageMargin: 20, garbageSeconds: 300, garbageBonus: 8, garbageRank: 8,
} as const;

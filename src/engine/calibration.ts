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
 * (src/world/extra-attributes.ts, EXTRA_MATCH) adds to two-point chances, so defense weighs less for a blocker who has it;
 * players without the five further abilities (older careers, exhibition teams) keep the earlier weight.
 */
export const BLOCKS = { base: .028, defense: .003, defenseWithoutBlocking: .0038, height: .002, separation: .025, min: .005, max: .16, threeFactor: .2 } as const;

/**
 * Last possession of a close fourth quarter or overtime (the game clock at most shotClockGrace beyond the shot clock):
 * tied or down by up to maxDeficit, the attack holds the ball and shoots with shootAt seconds or fewer left, a three when
 * down three. With foulSeconds or fewer left, a defense trailing by up to foulMaxLead fouls within foulDelay seconds to
 * stop the clock (4.8% of games go to overtime).
 */
export const LATE_GAME = { maxDeficit: 3, shootAt: 4, shotClockGrace: 6, foulSeconds: 24, foulMaxLead: 3, foulDelay: 2 } as const;

/** Free-throw make chance (possession engine and play model): base + skill x Free throw - fatigue, within min and max. */
export const FREE_THROWS = { base: .45, skill: .025, fatigue: .021, min: .4, max: .95 } as const;

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

export type ShotKind = 'rim' | 'dunk' | 'floater' | 'mid' | 'post' | 'catchThree' | 'pullThree' | 'putback' | 'tip' | 'heave';
export type RiskKind = 'advance' | 'pass' | 'drive' | 'post' | 'screen' | 'fastBreak';

/**
 * Calibration of the play model (reversible defaults, 22 November 2026), measured on the sprint-4 calibration squads
 * against the 2025-26 European regular-season averages in src/engine/calibration.ts (per team per game: about 75
 * possessions, 85 points, 3PA 42% of FGA, FTA/FGA 0.34, 13.2 turnovers, 7.0 steals, 2.6 blocks, 22 fouls).
 */
export const PLAYS = {
  /** Game-clock seconds per action before tempo (seconds per tempo step below the middle) and a spread of two seconds. */
  seconds: { advance: 7.2, inbound: 4.5, fastBreak: 4.3, putback: 1.4, pnr: 9.2, drive: 8.2, post: 9.7, motion: 9.2, early: 5, late: 2.5, tempo: 1.6 },
  /** Half-court play choice weights (pick-and-roll, isolation drive, post-up, ball movement, early-offense three). */
  choice: { pnr: .34, drive: .28, post: .09, motion: .25, early: .06 },
  /** Fast-break chance after a steal, a defensive rebound and a recovered block; tempo adds up to `tempo`. */
  fastBreak: { steal: .62, rebound: .13, tempo: .12 },
  /** An offensive rebounder within `range` metres of the rim goes straight back up with this chance. */
  putback: { chance: .55, range: 2.8, tipHeight: 203, tipShare: .35 },
  /** Make chance at skill 12 against defense 12 with about 1.3 m of space, by shot kind. */
  shots: { rim: .52, dunk: .83, floater: .39, mid: .375, post: .44, catchThree: .347, pullThree: .307, putback: .51, tip: .46, heave: .03 } satisfies Record<ShotKind, number>,
  skill2: .017, skill3: .015, defense: .011, rushed: .06,
  /** Shooting-foul chance by kind before the defense's pressure; a made shot when fouled counts with `andOne` of its chance. */
  fouls: { rim: .175, dunk: .14, floater: .085, mid: .038, post: .15, catchThree: .012, pullThree: .017, putback: .14, tip: .085, heave: .004 } satisfies Record<ShotKind, number>,
  foulPressure: .03, andOne: .55,
  /** Block chance by kind (Blocking above 12 adds near the rim as before; height and space adjust). */
  blocks: { rim: .07, dunk: .02, floater: .05, mid: .021, post: .058, catchThree: .006, pullThree: .009, putback: .07, tip: .026, heave: 0 } satisfies Record<ShotKind, number>,
  /** A blocked ball goes out of bounds (the attack keeps it) with blockOut; otherwise the attack's rebound chance gains blockOffense. */
  blockOut: .3, blockOffense: .05,
  /** Block chance per Blocking point above 12 near the rim (half further out and on jump shots). */
  blocking: .006,
  /** Steal share of a pass or drive turnover per Stealing point above 12, and Stealing's share of the defender's skill there. */
  stealing: .03, stealSkill: .5,
  /** Turnover chance per risky action, plus the defense's pressure, the defender's skill over the actor's passing and fatigue. */
  turnovers: { advance: .018, pass: .08, drive: .112, post: .095, screen: .002, fastBreak: .1, pressure: .02, skillGap: .003, fatigue: .014, max: .14 } satisfies Record<RiskKind | 'pressure' | 'skillGap' | 'fatigue' | 'max', number>,
  /** Share of those turnovers that are steals (Stealing adjusts it on passes and drives). */
  stealShare: { advance: .5, pass: .7, drive: .58, post: .46, screen: 0, fastBreak: .58 } satisfies Record<RiskKind, number>,
  /** Offensive fouls (charges, illegal screens, post push-offs) per action. */
  offensiveFouls: { advance: 0, pass: 0, drive: .016, post: .012, screen: .012, fastBreak: .012 } satisfies Record<RiskKind, number>,
  /** Non-shooting defensive fouls per action, plus the defense's pressure. */
  defensiveFouls: { advance: .036, pass: .03, drive: .062, post: .08, screen: .045, fastBreak: .06, pressure: .036 } satisfies Record<RiskKind | 'pressure', number>,
  heldBall: .003,
  /** Technical foul on a defender whose foul gives free throws: base plus per Discipline point below 12. */
  technical: { base: .007, discipline: .0015 },
  /** A late-clock possession (four seconds or fewer) fails to get a shot off with this chance. */
  shotClockViolation: .2,
  /** Reads: weight times e^(sharpness x (expected points - best)); Intelligence above 12 sharpens. resetValue is the expected value of resetting; threeValue scales a three's expected points (NBA set only). */
  reads: { sharpness: 2, intelligence: .25, resetValue: .9, threeValue: 1 },
  /** The computer coach calls a timeout after an unanswered run of this many points (keeping two for the end of the second half). */
  timeoutRun: 8,
  /** Fourth quarter and overtime: a defense trailing by up to `lead` fouls on purpose with `seconds` or fewer left. */
  intentional: [{ lead: 3, seconds: 24 }, { lead: 5, seconds: 35 }, { lead: 7, seconds: 50 }],
  /** End of a period: heave from the backcourt with this many seconds or fewer; push for a quick shot with `rush` or fewer. */
  heaveSeconds: 3, rushSeconds: 7,
} as const;

/**
 * Format 81 (`plays-3`, owner feedback 22 November 2026 evening: "the ball going out, backcourt violations ... hundreds
 * of possibilities"): the dead balls of a real game, at the rates of European top-flight games (per game, both teams:
 * about 15 balls knocked out of bounds by the defense, 1.5 kicked balls, 1.5 held balls, 0.1-0.3 each of 8-second,
 * 5-second and double-dribble violations, 0.3 goaltending calls, 0.4 unsportsmanlike fouls, 5-7 timeouts). Reversible
 * defaults, 22 November 2026; `plays-2` matches never read them.
 */
export const FLOW = {
  /** The defense knocks the ball out of bounds and the attack keeps it (throw-in, shot clock running on), per risky action. */
  outOfBounds: { advance: .012, pass: .05, drive: .056, post: .036, screen: .006, fastBreak: .035 } satisfies Record<RiskKind, number>,
  /** Kicked ball by the defense (the attack keeps it; shot clock 24 in the backcourt, at least 14 in the frontcourt). */
  kicked: { advance: .002, pass: .0065, drive: .0045, post: .002, screen: 0, fastBreak: .003 } satisfies Record<RiskKind, number>,
  heldBall: .0055,
  /** Share of blocked attempts near the rim called goaltending (the basket counts), and of missed tips and putbacks called basket interference. */
  goaltending: .065, interference: .035,
  /** Unsportsmanlike foul share of non-shooting fouls: on a fast break, and elsewhere. */
  unsportsmanlike: { fastBreak: .14, other: .004 },
  /** Game-clock seconds of a frontcourt throw-in (the clock starts when the ball is touched on court). */
  inbound: 2.2,
  /** Computer coaches: timeout after an unanswered run of this many points; late in the fourth when behind by up to `lateBehind`. */
  timeoutRun: 6, lateSeconds: 120, lateBehind: 6,
  /** End of a period with no more than a shot clock left: hold the ball for the last shot, attacking with `shootAt` seconds left. */
  holdFrom: 24, shootAt: 6,
  /** Late in the fourth with the lead, the attack runs the clock: extra seconds per half-court action. */
  milk: { seconds: 120, extra: 3 },
  shotClockViolation: .15,
  /** Non-shooting fouls per risky action relative to `plays-2` (its quicker actions take more of them per game). */
  foulScale: .88, turnoverScale: .95,
  /** Game-clock seconds per action (quicker than `plays-2`: the throw-ins, holds and dead balls above take their own time). */
  seconds: { advance: 6.6, pnr: 8.5, drive: 7.5, post: 9, motion: 8.5, early: 4.6 },
} as const;


/** Calibration values with their literal types widened (an NBA set has the same shape as the FIBA set, other numbers). */
type Widened<T> = T extends number ? number : T extends readonly (infer U)[] ? readonly Widened<U>[] : { readonly [K in keyof T]: Widened<T[K]> };

/** One ruleset's match calibration: the possession engine, the rotation and the play model. */
export interface Calibration {
  ACTION_SECONDS: Widened<typeof ACTION_SECONDS>; SHOT_SELECTION: Widened<typeof SHOT_SELECTION>; TURNOVERS: Widened<typeof TURNOVERS>;
  DEFENSIVE_FOULS: Widened<typeof DEFENSIVE_FOULS>; SHOOTING_FOULS: Widened<typeof SHOOTING_FOULS>; SHOT_MAKING: Widened<typeof SHOT_MAKING>;
  HOME_COURT_MAKE_BONUS: number; SCORE_EFFECT: Widened<typeof SCORE_EFFECT>; DEFENDER_ROLES: Widened<typeof DEFENDER_ROLES>; BLOCKS: Widened<typeof BLOCKS>;
  LATE_GAME: Widened<typeof LATE_GAME>; FREE_THROWS: Widened<typeof FREE_THROWS>; REBOUNDS: Widened<typeof REBOUNDS>; TEAM_REBOUND_SHARE: number; TEAM_REBOUND_OFFENSIVE_SHARE: number;
  ROTATION: Widened<typeof ROTATION>; PLAYS: Widened<typeof PLAYS>; FLOW: Widened<typeof FLOW>;
}

/** The FIBA calibration: today's objects, unchanged (FIBA matches replay bit for bit). */
const FIBA_CALIBRATION: Calibration = Object.freeze({
  ACTION_SECONDS, SHOT_SELECTION, TURNOVERS, DEFENSIVE_FOULS, SHOOTING_FOULS, SHOT_MAKING, HOME_COURT_MAKE_BONUS, SCORE_EFFECT, DEFENDER_ROLES, BLOCKS,
  LATE_GAME, FREE_THROWS, REBOUNDS, TEAM_REBOUND_SHARE, TEAM_REBOUND_OFFENSIVE_SHARE, ROTATION, PLAYS, FLOW,
});

/**
 * NBA calibration (NBA step 3, reversible defaults, 23 November 2026). Targets, 2024-25 and 2025-26 regular seasons,
 * per team per game: points about 114, pace about 99, FG 47%, 37 three-point attempts at 36% (about 42% of shots),
 * 21.5 free-throw attempts at 78%, about 44 rebounds (11 offensive), 26.5 assists, 14 turnovers, 8 steals, 5 blocks,
 * 19 personal fouls; 6% of games go to overtime and home teams win 54-55%; starters play 30-34 minutes. Against the
 * European set: quicker actions, more threes, far fewer fouls per minute, fewer offensive rebounds, more blocks.
 * Measured by tests/nba-match-calibration.test.ts on NBA-strength squads. The NBA plays only with the play model.
 */
const NBA_CALIBRATION: Calibration = Object.freeze({
  ...FIBA_CALIBRATION,
  HOME_COURT_MAKE_BONUS: .007,
  FREE_THROWS: { ...FREE_THROWS, base: .41 },
  REBOUNDS: { ...REBOUNDS, offensiveBase: .245 },
  TEAM_REBOUND_SHARE: .08,
  ROTATION: {
    ...ROTATION,
    // Planned minutes of a 48-minute game (240 team minutes): starters 30-34.
    plannedMinutes: [34.5, 33.5, 32.5, 31.5, 30.5, 22, 18.5, 16, 12, 6, 0, 0],
  },
  PLAYS: {
    ...PLAYS,
    seconds: { ...PLAYS.seconds, advance: 6.6, inbound: 4.3, fastBreak: 4.1, pnr: 8.5, drive: 7.7, post: 9.1, motion: 8.5, early: 4.7 },
    choice: { pnr: .36, drive: .37, post: .07, motion: .17, early: .03 },
    reads: { ...PLAYS.reads, threeValue: .95 },
    shots: { ...PLAYS.shots, rim: .51, floater: .38, mid: .365, post: .43, catchThree: .36, pullThree: .32 },
    fouls: { rim: .13, dunk: .1, floater: .06, mid: .028, post: .11, catchThree: .009, pullThree: .013, putback: .1, tip: .06, heave: .003 },
    blocks: { rim: .095, dunk: .028, floater: .068, mid: .029, post: .08, catchThree: .008, pullThree: .012, putback: .095, tip: .036, heave: 0 },
    turnovers: { ...PLAYS.turnovers, advance: .02, pass: .073, drive: .1, post: .088, fastBreak: .092 },
    defensiveFouls: { advance: .022, pass: .018, drive: .039, post: .05, screen: .028, fastBreak: .037, pressure: .022 },
  },
  FLOW: { ...FLOW, seconds: { advance: 6.1, pnr: 7.9, drive: 7.1, post: 8.5, motion: 7.9, early: 4.4 } },
});

/** The match calibration a ruleset plays with: FIBA's frozen objects, or the NBA set. */
export function calibrationFor(rules: { id: string }): Calibration { return rules.id === 'nba-2026' ? NBA_CALIBRATION : FIBA_CALIBRATION; }

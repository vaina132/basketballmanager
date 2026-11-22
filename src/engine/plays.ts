/**
 * The richer play model (format 79, `plays-2`; owner feedback 16, 22 November 2026: "a more realistic simulator with
 * more actions"). New careers only: matches without `playModel` keep the earlier possession actions unchanged.
 *
 * Each live step is one basketball action that may contain several recorded events (a screen, a pass, a drive, the
 * shot): bringing the ball up, fast breaks after steals and rebounds, pick-and-rolls with their reads (pull-up, drive,
 * roll with the occasional alley-oop, pop, kick-out, reset), post-ups (hook, drop step, face-up, double team and
 * kick-out), drives (finish, dunk, floater, kick-out, dump-off, charge), ball movement (catch-and-shoot, extra pass,
 * backdoor cut, attacking a closeout), putbacks and tip-ins, late-clock isolations, shot-clock violations, heaves at the
 * horn, and-ones, blocks kept or lost, offensive fouls, travels and other dead-ball turnovers, rare technical fouls,
 * intentional fouls late in close games and the computer coach's timeouts in a bad run.
 *
 * Players' abilities decide outcomes: shooting skills make shots, passing and defense decide turnovers and the space a
 * shooter gets, Blocking chooses and powers shot blockers, Stealing turns turnovers into steals, Intelligence picks the
 * better read, Mental steadies late close shots (as before) and Discipline keeps technical fouls away. Deterministic:
 * every random choice uses the match stream; the viewer receives the exact sporting positions.
 */
import type { CourtBallPoint, CourtPoint, CourtPosition, MatchEvent, MatchState, Player, PossessionPlay, Side } from '../domain/types';
import { EXTRA_MATCH } from '../world/extra-attributes';
import { DEFENDER_ROLES, HOME_COURT_MAKE_BONUS, LATE_GAME, REBOUNDS, SCORE_EFFECT, TEAM_REBOUND_OFFENSIVE_SHARE, TEAM_REBOUND_SHARE } from './calibration';
import { actionScene } from './court-events';
import { basketPoint, clutchAdjustment, courtDistance, createPossessionPlay, matchedDefender, moveForAction, offenseDirection, positionOf, primaryHandler } from './possession';

/** The reducer's steps the play model uses (src/engine/match.ts lends them, so both engines share one set of rules). */
export interface PlayKit {
  draw(state: MatchState): number;
  emit(state: MatchState, event: Omit<MatchEvent, 'id' | 'period' | 'clockSeconds' | 'score'>): void;
  player(state: MatchState, side: Side, id: string): Player;
  active(state: MatchState, side: Side): Player[];
  choose(state: MatchState, players: readonly Player[], weight: (player: Player) => number): Player;
  personalFoul(state: MatchState, side: Side, offender: Player, text: string): void;
  foulCaution(state: MatchState, player: Player): number;
  startFreeThrows(state: MatchState, side: Side, shooter: Player, total: 1 | 2 | 3): void;
  madeBasketWindow(state: MatchState, scoring: Side): void;
  creditPoints(state: MatchState, side: Side, shooter: Player, value: number): void;
  exposure(state: MatchState, seconds: number): void;
  installControl(state: MatchState, side: Side, handlerId: string, positions: CourtPosition[], frontcourt: boolean, clock?: number): void;
  whistle(state: MatchState, reason?: 'whistle' | 'free-throws' | 'timeout'): void;
  resetPossession(state: MatchState, side: Side, shotClock?: number): void;
  visualStart(state: MatchState, fallback: CourtPosition[]): CourtPosition[];
  visualBallStart(state: MatchState, fallback: CourtPoint): CourtBallPoint;
  sampleInjuries(state: MatchState, seconds: number): void;
  finishPeriod(state: MatchState): void;
  resolveEligibility(state: MatchState): void;
  remainingTimeouts(state: MatchState, side: Side): number;
  moraleTurnover(state: MatchState, playerId: string): number;
}

type ShotKind = 'rim' | 'dunk' | 'floater' | 'mid' | 'post' | 'catchThree' | 'pullThree' | 'putback' | 'tip' | 'heave';
type RiskKind = 'advance' | 'pass' | 'drive' | 'post' | 'screen' | 'fastBreak';
type Action = 'advance' | 'fastBreak' | 'heave' | 'rush' | 'putback' | 'hold' | 'late' | 'foul' | 'pnr' | 'drive' | 'post' | 'motion' | 'early';

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
  /** Reads: weight times e^(sharpness x (expected points - best)); Intelligence above 12 sharpens. resetValue is the expected value of resetting. */
  reads: { sharpness: 2, intelligence: .25, resetValue: .9 },
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

const other = (side: Side): Side => side === 'home' ? 'away' : 'home';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number) => Math.round(value * 100000) / 100000;
const isBig = (p: Player) => p.position === 'PF' || p.position === 'C';
const ballAt = (point: CourtPoint, height = 1.25): CourtBallPoint => ({ x: point.x, y: point.y, height });
const nameOf = (p: Player) => p.name;

interface Ctx { state: MatchState; kit: PlayKit; play: PossessionPlay; offense: Side; defense: Side; hoop: CourtPoint; dir: 1 | -1; flow: boolean; restarted: boolean }
interface ShotPlan { shooter: Player; kind: ShotKind; value: 2 | 3; contest: Player; assist?: Player; rushed?: boolean; offDribble?: boolean; alleyOop?: boolean }
interface Read { key: string; weight: number; value: number }

const attackers = (ctx: Ctx) => ctx.kit.active(ctx.state, ctx.offense);
const defenders = (ctx: Ctx) => ctx.kit.active(ctx.state, ctx.defense);
const pos = (ctx: Ctx, id: string) => positionOf(ctx.play, id);
const defenderOf = (ctx: Ctx, p: Player) => matchedDefender(ctx.state, ctx.play, p.id);
const distanceToRim = (ctx: Ctx, point: CourtPoint) => courtDistance(point, ctx.hoop);

/** A court point `metres` from the attacking basket at `angle` (0 straight out, positive toward y = 1). */
function spot(ctx: Ctx, metres: number, angle: number): CourtPoint {
  return { x: round(clamp(ctx.hoop.x - ctx.dir * Math.cos(angle) * metres / 28, .02, .98)), y: round(clamp(.5 + Math.sin(angle) * metres / 15, .03, .97)) };
}
function angleOf(ctx: Ctx, point: CourtPoint): number {
  return Math.atan2((point.y - .5) * 15, Math.max(.3, (ctx.hoop.x - point.x) * ctx.dir * 28));
}
/** A point `metres` from `from` toward `to`; beside `from` when `to` is closer than that. */
function toward(from: CourtPoint, to: CourtPoint, metres: number): CourtPoint {
  const dx = (to.x - from.x) * 28, dy = (to.y - from.y) * 15, length = Math.hypot(dx, dy);
  if (length < metres + .25) return { x: round(clamp(from.x, .035, .965)), y: round(clamp(from.y + (from.y < .5 ? 1 : -1) * metres / 15, .035, .965)) };
  return { x: round(clamp(from.x + dx / length * metres / 28, .035, .965)), y: round(clamp(from.y + dy / length * metres / 15, .035, .965)) };
}
function setAt(positions: CourtPosition[], id: string, point: CourtPoint): void {
  const entry = positions.find(item => item.playerId === id);
  if (entry) { entry.x = round(point.x); entry.y = round(point.y); }
}
/** Off-ball defenders follow their assignments, between their man and the basket; `placed` keeps the ones already set. */
function follow(ctx: Ctx, positions: CourtPosition[], placed: ReadonlySet<string>): void {
  const gap = clamp(1.65 - ctx.state.tactics[ctx.defense].pressure * .65, .7, 2);
  for (const defender of defenders(ctx)) {
    if (placed.has(defender.id)) continue;
    const assignment = ctx.play.matchups.find(pair => pair.defenderId === defender.id);
    const man = assignment && positions.find(item => item.playerId === assignment.attackerId);
    if (man) setAt(positions, defender.id, toward(man, ctx.hoop, gap));
  }
}
const copyPositions = (ctx: Ctx) => ctx.play.positions.map(point => ({ ...point }));

/** Record one movement event and adopt its end positions. The ball goes from `from` to `to` (players or points). */
function move(ctx: Ctx, type: 'pass' | 'drive' | 'command', actor: Player, next: CourtPosition[], text: string, ball: { from: string; to: string; arc?: number }, receiver?: Player): void {
  const start = ctx.play.positions, find = (list: CourtPosition[], id: string) => list.find(item => item.playerId === id)!;
  ctx.kit.emit(ctx.state, { type, side: ctx.offense, playerId: actor.id, ...(receiver ? { receiverId: receiver.id } : {}), text,
    scene: actionScene(type === 'command' ? 'setup' : type, ctx.offense, start, next, ballAt(find(start, ball.from)), ballAt(find(next, ball.to)), ball.arc ?? (type === 'pass' ? .35 : .08)) });
  ctx.play.positions = next;
}
/** The shooter's man (or a chosen help defender) placed `separation` metres from him, the others following. */
function settle(ctx: Ctx, positions: CourtPosition[], shooter: Player, defender: Player, separation: number): void {
  const at = positions.find(item => item.playerId === shooter.id)!;
  setAt(positions, defender.id, toward(at, ctx.hoop, separation));
  follow(ctx, positions, new Set([defender.id]));
}
function pass(ctx: Ctx, passer: Player, receiver: Player, to: CourtPoint, text: string, contest?: { defender: Player; separation: number }, arc?: number): void {
  const next = copyPositions(ctx);
  setAt(next, receiver.id, to);
  if (contest) settle(ctx, next, receiver, contest.defender, contest.separation); else follow(ctx, next, new Set());
  move(ctx, 'pass', passer, next, text, { from: passer.id, to: receiver.id, arc }, receiver);
  ctx.play.handlerId = receiver.id; ctx.play.passerId = passer.id;
}
function drive(ctx: Ctx, driver: Player, to: CourtPoint, text: string, contest?: { defender: Player; separation: number }, screener?: Player): void {
  const next = copyPositions(ctx);
  setAt(next, driver.id, to);
  if (screener) setAt(next, screener.id, toward(to, ctx.hoop, -1));
  if (contest) settle(ctx, next, driver, contest.defender, contest.separation); else follow(ctx, next, new Set());
  move(ctx, 'drive', driver, next, text, { from: driver.id, to: driver.id });
  ctx.play.handlerId = driver.id;
}

/** Space a shooter gets: base plus the creator's skill over the defender's defense, with a random spread (metres). */
function space(ctx: Ctx, creator: number, defender: Player, base: number, spread: number): number {
  return clamp(base + (creator - defender.attributes.defense) * .055 + (ctx.kit.draw(ctx.state) - .5) * spread, .3, 3.6);
}
function makeChance(ctx: Ctx, shooter: Player, defender: Player, kind: ShotKind, value: 2 | 3, separation: number, distance: number): number {
  const state = ctx.state;
  if (kind === 'heave') return clamp(PLAYS.shots.heave - Math.max(0, distance - 16) * .003, .01, .05);
  const skill = value === 3 ? shooter.attributes.threePoint : shooter.attributes.twoPoint;
  const base = PLAYS.shots[kind] + (skill - 12) * (value === 3 ? PLAYS.skill3 : PLAYS.skill2) * (kind === 'dunk' ? .35 : 1);
  const defense = (defender.attributes.defense - 12) * PLAYS.defense;
  const room = clamp((separation - 1.3) * .045, -.06, .08);
  const height = value === 2 ? clamp((defender.heightCm - shooter.heightCm) / 1000, -.025, .025) : 0;
  const range = value === 3 ? Math.max(0, distance - 7.4) * .025 : 0;
  const fatigue = (100 - state.stats[shooter.id]!.condition) / 100 * .07;
  const home = ctx.offense === 'home' ? HOME_COURT_MAKE_BONUS : -HOME_COURT_MAKE_BONUS;
  const lead = clamp(state.score[ctx.offense] - state.score[ctx.defense], -SCORE_EFFECT.cap, SCORE_EFFECT.cap);
  const scoreEffect = lead * SCORE_EFFECT.perPoint * (state.period >= 4 ? SCORE_EFFECT.fourthQuarter : 1);
  return clamp(base - defense + room - height - range - fatigue + home - scoreEffect + clutchAdjustment(state, shooter), .05, value === 3 ? .65 : .93);
}
/** Expected points of a look, for reads (no random draw). */
function lookValue(ctx: Ctx, shooter: Player, defender: Player, kind: ShotKind, value: 2 | 3, separation: number, distance: number): number {
  return makeChance(ctx, shooter, defender, kind, value, separation, distance) * value * (1 - PLAYS.blocks[kind]) + PLAYS.fouls[kind] * 1.5;
}
/** Picks a read: better expected points are chosen more often, more so by an intelligent decision maker. */
function pickRead(ctx: Ctx, decider: Player, reads: Read[]): string {
  const usable = reads.filter(read => read.weight > 0);
  if (!usable.length) return 'reset';
  const best = Math.max(...usable.map(read => read.value));
  const sharp = PLAYS.reads.sharpness + ((decider.attributes.intelligence ?? EXTRA_MATCH.centre) - EXTRA_MATCH.centre) * PLAYS.reads.intelligence;
  const weights = usable.map(read => read.weight * Math.exp(sharp * (read.value - best)));
  let target = ctx.kit.draw(ctx.state) * weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < usable.length; index += 1) { target -= weights[index]!; if (target < 0) return usable[index]!.key; }
  return usable.at(-1)!.key;
}
function resetValue(ctx: Ctx): number { return PLAYS.reads.resetValue * clamp((ctx.state.shotClockSeconds - 7) / 10, 0, 1); }

/** The best spot-up shooter among `pool`, weighted by three-point skill and the team's outside intent. */
function shooterFrom(ctx: Ctx, pool: Player[]): Player | undefined {
  if (!pool.length) return undefined;
  const outside = ctx.state.tactics[ctx.offense].outsideShare;
  return ctx.kit.choose(ctx.state, pool, p => Math.max(.2, p.attributes.threePoint - 6) ** 2 * (isBig(p) ? .45 + outside * .3 : 1));
}
const others = (ctx: Ctx, ...exclude: Player[]) => attackers(ctx).filter(p => !exclude.some(item => item.id === p.id));
function rimProtector(ctx: Ctx, matched: Player): Player {
  const weight = (p: Player) => DEFENDER_ROLES.block[p.position] * (p.id === matched.id ? DEFENDER_ROLES.matchedBlock : 1) * (p.attributes.blocking === undefined ? 1 : Math.max(.2, 1 + (p.attributes.blocking - EXTRA_MATCH.centre) * EXTRA_MATCH.blockerChoice));
  return ctx.kit.choose(ctx.state, defenders(ctx), weight);
}
const threeSpot = (ctx: Ctx, p: Player) => spot(ctx, 7.05, clamp(angleOf(ctx, pos(ctx, p.id)), -1.2, 1.2) || .9);

/** Turnovers, offensive fouls, defensive fouls and held balls for one risky action; true when the play ends. */
function risk(ctx: Ctx, actor: Player, kind: RiskKind, interceptor?: Player): boolean {
  const { state, kit } = ctx, defender = interceptor ?? defenderOf(ctx, actor), pressure = state.tactics[ctx.defense].pressure;
  const stealing = defender.attributes.stealing, intelligence = actor.attributes.intelligence;
  const defending = stealing !== undefined && (kind === 'pass' || kind === 'drive') ? defender.attributes.defense * (1 - PLAYS.stealSkill) + stealing * PLAYS.stealSkill : defender.attributes.defense;
  const decisions = intelligence === undefined ? 0 : (intelligence - EXTRA_MATCH.turnoverCentre) * EXTRA_MATCH.turnover;
  const fatigue = (100 - state.stats[actor.id]!.condition) / 100;
  const T = PLAYS.turnovers;
  const turnover = (kind === 'screen' ? T.screen : clamp(T[kind] + pressure * T.pressure + (defending - actor.attributes.passing) * T.skillGap - decisions + fatigue * T.fatigue + kit.moraleTurnover(state, actor.id), .004, T.max)) * (ctx.flow ? FLOW.turnoverScale : 1);
  const offensive = PLAYS.offensiveFouls[kind], foul = (PLAYS.defensiveFouls[kind] + pressure * PLAYS.defensiveFouls.pressure) * (ctx.flow ? FLOW.foulScale : 1), held = kind === 'advance' ? 0 : ctx.flow ? FLOW.heldBall : PLAYS.heldBall;
  // Format 81: balls knocked out of bounds and kicked by the defense (the attack keeps the ball).
  // A deflection out of bounds needs time to inbound and still play (the shot clock runs on): not in the last seconds.
  const out = ctx.flow && state.shotClockSeconds >= 5 ? FLOW.outOfBounds[kind] : 0, kick = ctx.flow ? FLOW.kicked[kind] : 0;
  const roll = kit.draw(state);
  if (roll < turnover) { loseBall(ctx, actor, kind, defender); return true; }
  if (roll < turnover + offensive) { offensiveFoul(ctx, actor, kind, defender); return true; }
  if (roll < turnover + offensive + foul) { defensiveFoul(ctx, actor, kind); return true; }
  if (roll < turnover + offensive + foul + held) {
    const receiving = state.possessionArrow; state.possessionArrow = other(receiving);
    if (receiving !== ctx.offense) kit.resetPossession(state, receiving);
    kit.whistle(state); kit.emit(state, { type: 'held-ball', side: receiving, text: ctx.flow ? `Held ball between ${nameOf(actor)} and ${nameOf(defender)}. The possession arrow awards the throw-in to ${state[receiving].name}.` : `Held ball. The possession arrow awards the throw-in to ${state[receiving].name}.` });
    return true;
  }
  if (roll < turnover + offensive + foul + held + out) { knockedOut(ctx, actor, kind, defender); return true; }
  if (roll < turnover + offensive + foul + held + out + kick) { kickedBall(ctx, actor, defender); return true; }
  return false;
}
/** Where a throw-in is taken: the baseline near the end line, otherwise the nearest sideline. */
function throwInLine(point: CourtPoint): 'baseline' | 'sideline' {
  return Math.min(point.x, 1 - point.x) * 28 < 1.6 && Math.abs(point.y - .5) * 15 < 6 ? 'baseline' : 'sideline';
}
/** Format 81: the defense knocks the ball out of bounds; the attack keeps it with the shot clock running on (FIBA 29.2.1). */
function knockedOut(ctx: Ctx, actor: Player, kind: RiskKind, defender: Player): void {
  const { state, kit } = ctx, line = throwInLine(pos(ctx, actor.id));
  const how = kind === 'pass' ? `deflects ${nameOf(actor)}'s pass` : kind === 'drive' || kind === 'fastBreak' ? `pokes the ball away from ${nameOf(actor)}` : kind === 'post' ? `swipes at ${nameOf(actor)} in the post and knocks the ball` : kind === 'screen' ? `tips the ball away from ${nameOf(actor)}` : `gets a hand on ${nameOf(actor)}'s dribble and knocks the ball`;
  kit.whistle(state);
  kit.emit(state, { type: 'command', side: ctx.defense, playerId: defender.id, text: `${nameOf(defender)} ${how} out of bounds: ${state[ctx.offense].name} keep the ball, ${line} throw-in. Shot clock ${state.shotClockSeconds}.` });
}
/** Format 81: a kicked ball (defensive violation): the attack keeps it; shot clock 24 in the backcourt, at least 14 in the frontcourt. */
function kickedBall(ctx: Ctx, actor: Player, defender: Player): void {
  const { state, kit } = ctx;
  state.shotClockSeconds = state.frontcourt ? Math.max(14, state.shotClockSeconds) : 24;
  kit.whistle(state);
  kit.emit(state, { type: 'command', side: ctx.defense, playerId: defender.id, text: `Kicked ball: ${nameOf(defender)} stops ${nameOf(actor)}'s pass with his foot. ${state[ctx.offense].name} keep the ball, shot clock ${state.shotClockSeconds}.` });
}
function loseBall(ctx: Ctx, actor: Player, kind: RiskKind | 'shot-clock', defender: Player): void {
  const { state, kit, play } = ctx;
  const stealing = defender.attributes.stealing;
  const share = kind === 'shot-clock' ? 0 : stealing !== undefined && (kind === 'pass' || kind === 'drive') ? clamp(PLAYS.stealShare[kind] + (stealing - EXTRA_MATCH.centre) * PLAYS.stealing, .3, .92) : PLAYS.stealShare[kind];
  const stolen = kind !== 'shot-clock' && kit.draw(state) < share;
  state.stats[actor.id]!.turnovers += 1;
  if (stolen) state.stats[defender.id]!.steals += 1;
  const variant = stolen || kind === 'shot-clock' ? 0 : kit.draw(state);
  const text = kind === 'shot-clock' ? `${state[ctx.offense].name} fail to release a shot before the shot-clock signal. Turnover.`
    : ctx.flow && !stolen ? deadBallText(ctx, actor, kind, variant)
    : stolen ? kind === 'pass' ? `${nameOf(defender)} steals ${nameOf(actor)}'s pass and the ball goes the other way.` : `${nameOf(defender)} steals the ball from ${nameOf(actor)}.`
      : kind === 'pass' ? `${nameOf(actor)}'s pass sails out of bounds. Turnover.`
        : kind === 'post' ? variant < .5 ? `${nameOf(actor)} travels in the post. Turnover.` : `${nameOf(actor)} is called for three seconds. Turnover.`
          : kind === 'advance' ? variant < .7 ? `${nameOf(actor)} loses the ball out of bounds.` : `${nameOf(actor)} is called for a backcourt violation. Turnover.`
            : variant < .45 ? `${nameOf(actor)} travels. Turnover.` : variant < .8 ? `${nameOf(actor)} loses the ball out of bounds.` : `${nameOf(actor)} steps out of bounds. Turnover.`;
  const from = ballAt(pos(ctx, actor.id)), to = stolen ? ballAt(pos(ctx, defender.id)) : { ...from, y: from.y < .5 ? 0 : 1, height: .2 };
  const positions = play.positions;
  kit.installControl(state, ctx.defense, defender.id, positions, false);
  if (!stolen) kit.whistle(state);
  kit.emit(state, { type: kind === 'shot-clock' ? 'shot-clock' : 'turnover', side: ctx.offense, playerId: actor.id, text, scene: actionScene('turnover', ctx.offense, positions, positions, from, to, .1) });
}
/** The ball is put in play from the end line after the other team scored (a made basket or last free throw). */
function afterScore(ctx: Ctx): boolean {
  const event = ctx.state.events.at(-1);
  return !!event && event.side === ctx.defense && (event.type === 'shot' && !!event.shot?.made || event.type === 'free-throw' && /\bmakes\b/.test(event.text));
}
/** Format 81: the dead-ball turnovers of a real game, by action (travels, out of bounds, violations). */
function deadBallText(ctx: Ctx, actor: Player, kind: RiskKind, variant: number): string {
  const who = nameOf(actor), team = ctx.state[ctx.offense].name;
  if (kind === 'advance') {
    if (variant < .46) return `${who} loses the ball out of bounds.`;
    if (variant < .68) return `${who} is called for a backcourt violation. Turnover.`;
    if (variant < .8) return `${team} cannot bring the ball over halfcourt in eight seconds: 8-second violation. Turnover.`;
    if (variant < .9) return `${who} is called for a double dribble. Turnover.`;
    return ctx.restarted || afterScore(ctx) ? `${team} cannot throw the ball in within five seconds: 5-second violation. Turnover.` : `${who} steps on the sideline. Turnover.`;
  }
  if (kind === 'pass') return variant < .86 ? `${who}'s pass sails out of bounds. Turnover.` : `${who}'s pass goes back over halfcourt: backcourt violation. Turnover.`;
  if (kind === 'post') return variant < .45 ? `${who} travels in the post. Turnover.` : variant < .9 ? `${who} is called for three seconds. Turnover.` : `${who} loses the ball out of bounds in the post.`;
  if (kind === 'fastBreak') return variant < .3 ? `${who} travels on the break. Turnover.` : variant < .8 ? `${who} loses the ball out of bounds on the break.` : variant < .9 ? `${who} is called for a double dribble. Turnover.` : `${who} steps out of bounds. Turnover.`;
  return variant < .4 ? `${who} travels. Turnover.` : variant < .72 ? `${who} loses the ball out of bounds.` : variant < .9 ? `${who} steps out of bounds. Turnover.` : variant < .95 ? `${who} is called for a double dribble. Turnover.` : `${who} is called for carrying the ball. Turnover.`;
}
function offensiveFoul(ctx: Ctx, actor: Player, kind: RiskKind, defender: Player): void {
  const { state, kit } = ctx;
  const text = kind === 'screen' ? `Illegal screen: offensive foul on ${nameOf(actor)}. No free throws.`
    : kind === 'post' ? `${nameOf(actor)} pushes off in the post: offensive foul. No free throws.`
      : `${nameOf(actor)} is called for a charge, drawn by ${nameOf(defender)}. No free throws.`;
  kit.personalFoul(state, ctx.offense, actor, text);
  state.stats[actor.id]!.turnovers += 1; kit.resetPossession(state, ctx.defense); kit.whistle(state);
}
function defensiveFoul(ctx: Ctx, actor: Player, kind: RiskKind): void {
  const { state, kit } = ctx, matched = defenderOf(ctx, actor);
  const fouler = kit.choose(state, defenders(ctx), p => DEFENDER_ROLES.foul[p.position] * (p.id === matched.id ? DEFENDER_ROLES.matchedFoul : 1) * kit.foulCaution(state, p));
  const how = kind === 'screen' ? `fouls ${nameOf(actor)} fighting through the screen` : kind === 'post' ? `fouls ${nameOf(actor)} in the post` : kind === 'drive' || kind === 'fastBreak' ? `reaches in on ${nameOf(actor)}` : kind === 'advance' ? `fouls ${nameOf(actor)} in the backcourt` : `holds ${nameOf(actor)} off the ball`;
  // Format 81: an unsportsmanlike foul (mostly stopping a fast break): two free throws and the ball (FIBA 37).
  if (ctx.flow && kit.draw(state) < (kind === 'fastBreak' ? FLOW.unsportsmanlike.fastBreak : FLOW.unsportsmanlike.other)) {
    kit.personalFoul(state, ctx.defense, fouler, `${nameOf(fouler)} ${kind === 'fastBreak' ? `pulls down ${nameOf(actor)} on the break` : `grabs ${nameOf(actor)} away from the ball`}: unsportsmanlike foul, two free throws and the ball.`);
    kit.startFreeThrows(state, ctx.offense, actor, 2);
    return;
  }
  kit.personalFoul(state, ctx.defense, fouler, `${nameOf(fouler)} ${how}: a non-shooting foul.`);
  if (state.teamFouls[ctx.defense] >= 5) awardFreeThrows(ctx, actor, fouler, 2);
  else { state.shotClockSeconds = state.frontcourt ? Math.max(14, state.shotClockSeconds) : 24; kit.whistle(state); }
}
/** Free throws, with the rare technical foul on a fouler who disputes the call (one more free throw, at most three). */
function awardFreeThrows(ctx: Ctx, shooter: Player, fouler: Player, total: 1 | 2 | 3): void {
  const { state, kit } = ctx;
  let count = total;
  if (count < 3 && state.stats[fouler.id]!.fouls < 5) {
    const discipline = fouler.attributes.discipline ?? EXTRA_MATCH.centre;
    if (kit.draw(state) < Math.max(.001, PLAYS.technical.base + (EXTRA_MATCH.centre - discipline) * PLAYS.technical.discipline)) {
      kit.personalFoul(state, ctx.defense, fouler, `${nameOf(fouler)} disputes the call and is given a technical foul: one more free throw.`);
      count += 1;
    }
  }
  kit.startFreeThrows(state, ctx.offense, shooter, count as 1 | 2 | 3);
}

const SHOT_WORDS: Record<ShotKind, { made: string; missed: string; noun: string }> = {
  rim: { made: 'lays it in', missed: 'misses the layup', noun: 'layup' },
  dunk: { made: 'throws down the dunk', missed: 'cannot finish the dunk', noun: 'dunk' },
  floater: { made: 'drops in a floater', missed: 'misses the floater', noun: 'floater' },
  mid: { made: 'hits the mid-range jumper', missed: 'misses the mid-range jumper', noun: 'jumper' },
  post: { made: 'scores with a hook shot in the post', missed: 'misses the hook shot', noun: 'hook shot' },
  catchThree: { made: 'drains a catch-and-shoot three', missed: 'misses a catch-and-shoot three', noun: 'three' },
  pullThree: { made: 'hits a pull-up three', missed: 'misses a pull-up three', noun: 'three' },
  putback: { made: 'scores the putback', missed: 'misses the putback', noun: 'putback' },
  tip: { made: 'tips it in', missed: 'cannot tip it in', noun: 'tip-in' },
  heave: { made: 'banks in a heave from long range!', missed: 'heaves from long range and misses', noun: 'heave' },
};
function shoot(ctx: Ctx, plan: ShotPlan): void {
  const { state, kit, play, offense, defense, hoop } = ctx, { shooter, kind, value, contest } = plan, stats = state.stats[shooter.id]!;
  const origin = pos(ctx, shooter.id), distance = distanceToRim(ctx, origin), separation = courtDistance(origin, pos(ctx, contest.id));
  const label = separation <= .85 ? 'contested' : separation <= 1.75 ? 'pressured' : 'open';
  const chance = makeChance(ctx, shooter, contest, kind, value, separation, distance) - (plan.rushed ? PLAYS.rushed : 0);
  const pressure = state.tactics[defense].pressure;
  const fouled = kit.draw(state) < clamp(PLAYS.fouls[kind] + pressure * PLAYS.foulPressure - Math.max(0, separation - 1.6) * .02, .002, .3);
  const inside = value === 2 && kind !== 'mid';
  // Near the basket help defenders (mostly bigs) foul and block as well as the shooter's own man.
  const fouler = fouled && inside ? kit.choose(state, defenders(ctx), p => DEFENDER_ROLES.foul[p.position] * (p.id === contest.id ? DEFENDER_ROLES.matchedFoul : 1) * kit.foulCaution(state, p)) : contest;
  const blocker = !fouled && inside ? rimProtector(ctx, contest) : contest;
  const blocking = blocker.attributes.blocking === undefined ? 0 : (blocker.attributes.blocking - EXTRA_MATCH.centre) * PLAYS.blocking * (inside && distance <= EXTRA_MATCH.rimDistance ? 1 : .5);
  const blockChance = PLAYS.blocks[kind] === 0 ? 0 : clamp(PLAYS.blocks[kind] + blocking + Math.max(0, blocker.heightCm - shooter.heightCm) * .0015 + (blocker.attributes.defense - 12) * .002 - Math.max(0, separation - .9) * .02, .002, .2);
  let blocked = !fouled && kit.draw(state) < blockChance;
  // Format 81: a block on the ball's way down near the rim is goaltending (the basket counts).
  const goaltending = ctx.flow && blocked && inside && kind !== 'dunk' && kit.draw(state) < FLOW.goaltending;
  if (goaltending) blocked = false;
  const made = goaltending || !blocked && kit.draw(state) < chance * (fouled ? PLAYS.andOne : 1);
  // Format 81: a missed tip or putback touched in the cylinder is basket interference: no attempt, the defense's ball.
  if (ctx.flow && !made && !blocked && !fouled && (kind === 'tip' || kind === 'putback') && kit.draw(state) < FLOW.interference) {
    stats.turnovers += 1;
    kit.resetPossession(state, defense); kit.whistle(state);
    kit.emit(state, { type: 'turnover', side: offense, playerId: shooter.id, text: `Basket interference on ${nameOf(shooter)}: he touches the ball in the cylinder. No basket, ${state[defense].name} ball.` });
    return;
  }
  const landing: CourtPoint = made ? hoop : blocked ? toward(origin, hoop, -1.5 - kit.draw(state) * 2) : { x: clamp(hoop.x - ctx.dir * (.5 + kit.draw(state) * (value === 3 ? 2.2 : 1.4)) / 28, .025, .975), y: clamp(.5 + (kit.draw(state) - .5) * .25, .08, .92) };
  const assist = made && plan.assist ? plan.assist : undefined;
  if (!fouled || made) {
    stats.fieldGoalsAttempted += 1; if (value === 3) stats.threePointersAttempted += 1;
    if (made) { stats.fieldGoalsMade += 1; if (value === 3) stats.threePointersMade += 1; kit.creditPoints(state, offense, shooter, value); }
    if (blocked) state.stats[blocker.id]!.blocks += 1;
    if (assist) state.stats[assist.id]!.assists += 1;
    const words = SHOT_WORDS[kind], horn = state.clockSeconds === 0 ? ' at the horn' : '';
    const what = plan.alleyOop ? made ? 'finishes the alley-oop' : 'cannot finish the alley-oop' : made ? words.made : words.missed;
    const text = goaltending ? `${nameOf(blocker)} is called for goaltending on ${nameOf(shooter)}'s ${plan.alleyOop ? 'alley-oop' : words.noun}: the basket counts${horn}.`
      : blocked ? `${nameOf(blocker)} blocks ${nameOf(shooter)}'s ${plan.alleyOop ? 'alley-oop' : words.noun}${horn}.`
      : `${nameOf(shooter)} ${what}${kind === 'heave' || kind === 'catchThree' || kind === 'pullThree' || kind === 'dunk' || plan.alleyOop ? '' : ` (${label})`}${fouled ? ' through the contact' : ''}${horn}.`;
    kit.emit(state, { type: 'shot', side: offense, playerId: shooter.id, ...(assist ? { assistPlayerId: assist.id } : {}), text,
      shot: { x: origin.x, y: origin.y, made, value, defenderId: goaltending ? blocker.id : contest.id, contest: label, distanceM: Math.round(distance * 100) / 100 },
      scene: actionScene('shot', offense, play.positions, play.positions, ballAt(origin, kind === 'dunk' || plan.alleyOop ? 2.9 : 2.1), ballAt(landing, made ? 3.05 : .45), made ? kind === 'dunk' || plan.alleyOop ? .3 : value === 3 || kind === 'heave' ? 3.1 : 2.4 : 2.8) });
  }
  if (fouled) {
    kit.personalFoul(state, defense, fouler, made ? `${nameOf(fouler)} fouls ${nameOf(shooter)} on the shot: and one.` : `${nameOf(fouler)} fouls ${nameOf(shooter)} on the ${value === 3 ? 'three-point attempt' : 'shot'}.`);
    awardFreeThrows(ctx, shooter, fouler, made ? 1 : value);
  } else if (made) { kit.madeBasketWindow(state, offense); coachTimeout(ctx); }
  else if (state.clockSeconds > 0) rebound(ctx, landing, !blocked, blocked);
}

/** Rebounds as in the possession engine; a blocked ball may go out of bounds (the attack keeps it) or be fought for. */
function rebound(ctx: Ctx, landing: CourtPoint, rimContact: boolean, blocked: boolean): void {
  const { state, kit, play, offense, defense } = ctx;
  const att = attackers(ctx), def = defenders(ctx);
  const proximity = (p: Player) => 1 / (1 + courtDistance(pos(ctx, p.id), landing) * .2);
  const strength = (players: Player[]) => players.reduce((total, p) => total + p.attributes.rebounding * proximity(p), 0) / Math.max(1, players.length);
  if (kit.draw(state) < (blocked ? PLAYS.blockOut : TEAM_REBOUND_SHARE)) {
    const offensive = blocked || kit.draw(state) < TEAM_REBOUND_OFFENSIVE_SHARE, side = offensive ? offense : defense;
    kit.resetPossession(state, side, offensive ? rimContact ? 14 : Math.max(14, state.shotClockSeconds) : 24); state.frontcourt = offensive; kit.whistle(state);
    kit.emit(state, { type: 'command', side, text: blocked ? `The ball goes out of bounds after the block: team rebound, ${state[side].name} keep possession.` : `The rebound goes out of bounds off ${offensive ? 'a defender' : 'an attacker'}: team rebound, ${state[side].name} ${offensive ? 'keep' : 'take'} possession.` });
    return;
  }
  const offensive = kit.draw(state) < clamp(REBOUNDS.offensiveBase + (strength(att) - strength(def)) * REBOUNDS.strength + (att.length - def.length) * REBOUNDS.numbers + (blocked ? PLAYS.blockOffense : 0), REBOUNDS.min, REBOUNDS.max);
  const side = offensive ? offense : defense;
  const rebounder = kit.choose(state, offensive ? att : def, p => p.attributes.rebounding * proximity(p));
  const positions = play.positions.map(point => point.playerId === rebounder.id ? { ...point, ...landing } : { ...point });
  state.stats[rebounder.id]!.rebounds += 1;
  kit.installControl(state, side, rebounder.id, positions, offensive, offensive ? rimContact ? 14 : state.shotClockSeconds : 24);
  kit.emit(state, { type: 'rebound', side, playerId: rebounder.id, text: `${nameOf(rebounder)} collects the ${offensive ? 'offensive' : 'defensive'} rebound${blocked ? ' after the block' : ''}.`,
    scene: actionScene('rebound', offense, play.positions, positions, ballAt(landing, .45), ballAt(landing), .12) });
}

/** After a made basket: a computer coach stops an unanswered run, or sets up a late possession when just behind. */
function coachTimeout(ctx: Ctx): void {
  const { state, kit } = ctx, side = ctx.defense, scoring = ctx.offense;
  if (!state.computerCoach?.includes(side) || state.clockSeconds === 0 || state.status === 'finished') return;
  const remaining = kit.remainingTimeouts(state, side), keep = state.period === 3 || state.period === 4 && state.clockSeconds > 120 ? 2 : 1;
  const own = state.score[side];
  let low = state.score[scoring];
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index]!;
    if (event.score[side] !== own) break;
    if (event.type === 'timeout' && event.side === side) return;
    low = Math.min(low, event.score[scoring]);
  }
  const run = state.score[scoring] - low, behind = state.score[scoring] - own;
  // Format 81: coaches stop shorter runs and draw up plays over the last two minutes (about three timeouts a team a game).
  const late = ctx.flow ? state.period >= 4 && state.clockSeconds <= FLOW.lateSeconds && behind >= 1 && behind <= FLOW.lateBehind : state.period >= 4 && state.clockSeconds <= 40 && behind >= 1 && behind <= 3;
  if (remaining < (late ? 1 : keep) || !late && run < (ctx.flow ? FLOW.timeoutRun : PLAYS.timeoutRun)) return;
  kit.emit(state, { type: 'command', side, text: late ? `${state[side].name} call time to set up the next play.` : `${state[side].name} call time to stop the ${run}-0 run.` });
  state.timeoutRequested[side] = true;
}

/** The last event when it is a steal, a defensive rebound or an offensive rebound by this possession's handler. */
function lastControl(ctx: Ctx): 'steal' | 'rebound' | 'offensive' | null {
  const event = ctx.state.events.at(-1);
  if (!event) return null;
  if (event.type === 'turnover' && event.side === ctx.defense && / steals /.test(event.text)) return 'steal';
  if (event.type === 'rebound' && event.side === ctx.offense) return /offensive/.test(event.text) ? event.playerId === ctx.play.handlerId ? 'offensive' : null : 'rebound';
  return null;
}

function choosePlay(ctx: Ctx, handler: Player): Action {
  const { state } = ctx, tactics = state.tactics[ctx.offense], C = PLAYS.choice;
  const team = attackers(ctx), bigs = team.filter(isBig), post = [...(bigs.length ? bigs : team)].sort((a, b) => (b.attributes.twoPoint - defenderOf(ctx, b).attributes.defense) - (a.attributes.twoPoint - defenderOf(ctx, a).attributes.defense) || a.id.localeCompare(b.id))[0]!;
  const edge = post.attributes.twoPoint - defenderOf(ctx, post).attributes.defense;
  const weights: [Action, number][] = [
    ['pnr', isBig(handler) || team.length < 2 ? 0 : C.pnr * (1 + (handler.attributes.passing - 12) * .04)],
    ['drive', C.drive * clamp(1 + (handler.attributes.twoPoint - 12) * .05, .5, 1.6)],
    ['post', C.post * clamp(1 + edge * .09, .25, 2.4) * (1.35 - tactics.outsideShare) * (isBig(handler) ? 1.6 : 1)],
    ['motion', team.length < 2 ? 0 : C.motion * (.65 + tactics.outsideShare * .7)],
    ['early', ctx.play.actions === 1 && state.shotClockSeconds >= 16 ? C.early * tactics.outsideShare * 2 : 0],
  ];
  let target = ctx.kit.draw(state) * weights.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [action, weight] of weights) { target -= weight; if (target < 0) return action; }
  return 'motion';
}

/** One live action of the richer play model. */
export function resolvePlaysAction(state: MatchState, kit: PlayKit): void {
  const restarted = !state.possessionPlay;
  const play = state.possessionPlay ?? createPossessionPlay(state); state.possessionPlay = play;
  const offense = play.offense, defense = other(offense);
  const flow = state.playModel === 'plays-3';
  const ctx: Ctx = { state, kit, play, offense, defense, hoop: basketPoint(state, offense), dir: offenseDirection(state, offense), flow, restarted };
  const handler = kit.player(state, offense, play.handlerId), tactics = state.tactics[offense];
  const lead = state.score[offense] - state.score[defense];
  const lastShot = state.period >= 4 && state.frontcourt && !restarted && state.clockSeconds <= state.shotClockSeconds + LATE_GAME.shotClockGrace && lead <= 0 && lead >= -LATE_GAME.maxDeficit;
  const threeNeeded = lastShot && lead === -3, holdFor = Math.min(state.clockSeconds, state.shotClockSeconds);
  const stopClock = state.period >= 4 && lead >= 1 && PLAYS.intentional.some(rule => lead <= rule.lead && state.clockSeconds <= rule.seconds);
  const control = restarted ? null : lastControl(ctx);
  // Format 81: with a shot clock or less left in a period, the attack holds the ball for the last shot (in the fourth
  // and overtime only with the lead; the existing late-game rules handle a tie or a deficit).
  const endHold = flow && state.frontcourt && !restarted && !lastShot && !stopClock && state.clockSeconds <= Math.min(FLOW.holdFrom, state.shotClockSeconds + 1) && state.clockSeconds > FLOW.shootAt + 1 && (state.period < 4 || lead > 0) && control !== 'offensive';
  let action: Action;
  if (stopClock) action = 'foul';
  else if (endHold) action = 'hold';
  else if (restarted || !state.frontcourt) {
    if (state.clockSeconds <= PLAYS.heaveSeconds && state.clockSeconds <= state.shotClockSeconds) action = 'heave';
    else if (state.clockSeconds <= PLAYS.rushSeconds && state.clockSeconds <= state.shotClockSeconds) action = 'rush';
    else if ((control === 'steal' || control === 'rebound') && kit.draw(state) < (control === 'steal' ? PLAYS.fastBreak.steal : PLAYS.fastBreak.rebound) + tactics.tempo * PLAYS.fastBreak.tempo) action = 'fastBreak';
    else action = 'advance';
  } else if (control === 'offensive' && distanceToRim(ctx, pos(ctx, handler.id)) <= PLAYS.putback.range && kit.draw(state) < PLAYS.putback.chance) action = 'putback';
  else if (lastShot) action = holdFor > LATE_GAME.shootAt ? 'hold' : 'late';
  else if (state.shotClockSeconds <= 5 || state.clockSeconds <= 5 && state.clockSeconds <= state.shotClockSeconds || play.actions >= 3) action = 'late';
  else action = choosePlay(ctx, handler);
  const base = action === 'advance' && state.frontcourt ? flow ? FLOW.inbound : PLAYS.seconds.inbound : action === 'heave' || action === 'rush' || action === 'hold' || action === 'foul' ? 0 : flow && Object.hasOwn(FLOW.seconds, action) ? FLOW.seconds[action as keyof typeof FLOW.seconds] : PLAYS.seconds[action];
  let proposed = clamp(Math.round(base + (.5 - tactics.tempo) * PLAYS.seconds.tempo + (kit.draw(state) - .5) * 3), 1, 13);
  // Format 81: a frontcourt throw-in with little left on the shot clock is a quick catch.
  if (flow && action === 'advance' && state.frontcourt && state.shotClockSeconds <= 8) proposed = 1;
  // Format 81: late in the fourth with the lead, the attack runs the clock.
  if (flow && state.period >= 4 && state.clockSeconds <= FLOW.milk.seconds && lead > 0 && (action === 'pnr' || action === 'drive' || action === 'post' || action === 'motion')) proposed += FLOW.milk.extra;
  if (action === 'putback') proposed = Math.min(proposed, 2);
  if (action === 'heave' || action === 'rush') proposed = state.clockSeconds;
  if (action === 'hold') proposed = endHold ? clamp(state.clockSeconds - FLOW.shootAt, 1, 18) : clamp(holdFor - LATE_GAME.shootAt, 1, 7);
  if (action === 'late' && lastShot) proposed = Math.max(1, holdFor - 1);
  if (action === 'foul') proposed = Math.min(proposed, LATE_GAME.foulDelay);
  const shooting = action !== 'advance' && action !== 'hold' && action !== 'foul';
  // A play that would outlast the period becomes a shot released before the horn.
  if (shooting && proposed >= state.clockSeconds && state.clockSeconds <= state.shotClockSeconds) proposed = state.clockSeconds;
  // Late in the shot clock the attack hurries; with four seconds or fewer it may fail to get a shot off.
  let violation = false;
  if (proposed >= state.shotClockSeconds && state.shotClockSeconds < state.clockSeconds) {
    if (state.shotClockSeconds > 1 && !(shooting && state.shotClockSeconds <= 4 && kit.draw(state) < (flow ? FLOW.shotClockViolation : PLAYS.shotClockViolation))) proposed = state.shotClockSeconds - 1;
    else { proposed = state.shotClockSeconds; violation = true; }
  }
  const seconds = Math.min(state.clockSeconds, state.shotClockSeconds, proposed);
  if (seconds <= 0) throw new Error('A live action must have time on both clocks.');
  kit.exposure(state, seconds); state.clockSeconds -= seconds; state.shotClockSeconds -= seconds; state.stepCount += 1; state.phase = 'live-ball'; state.stoppage = null;
  const rushed = state.shotClockSeconds <= 2 && state.shotClockSeconds < state.clockSeconds || action === 'late' && state.shotClockSeconds <= 4;
  if (violation) loseBall(ctx, handler, 'shot-clock', defenderOf(ctx, handler));
  else if (!shooting && seconds < proposed || state.clockSeconds === 0 && !shooting) {
    kit.emit(state, { type: 'command', side: offense, playerId: handler.id, text: `The period horn interrupts ${nameOf(handler)}'s ${action === 'advance' ? 'advance' : 'possession'}.`, scene: actionScene('setup', offense, play.positions, play.positions, ballAt(pos(ctx, handler.id)), ballAt(pos(ctx, handler.id))) });
  } else if (action === 'foul') {
    const fouler = defenderOf(ctx, handler);
    kit.personalFoul(state, defense, fouler, `${nameOf(fouler)} fouls ${nameOf(handler)} intentionally to stop the clock.`);
    if (state.teamFouls[defense] >= 5) kit.startFreeThrows(state, offense, handler, 2);
    else { state.shotClockSeconds = state.frontcourt ? Math.max(14, state.shotClockSeconds) : 24; kit.whistle(state); }
  } else if (action === 'advance') advance(ctx, restarted);
  else if (action === 'fastBreak') fastBreak(ctx, handler);
  else if (action === 'heave') heave(ctx, handler);
  else if (action === 'rush') rush(ctx, handler);
  else if (action === 'putback') putback(ctx, handler);
  else if (action === 'hold') { if (endHold) holdForLastShot(ctx, handler); else hold(ctx, handler); }
  else if (action === 'late') late(ctx, handler, threeNeeded, rushed);
  else if (action === 'pnr') pickAndRoll(ctx, handler);
  else if (action === 'drive') isolation(ctx, handler);
  else if (action === 'post') postUp(ctx, handler);
  else if (action === 'early') early(ctx, handler);
  else motion(ctx, handler);
  // One action per live step, however many events it recorded (the saved count never exceeds the steps played).
  if (state.possessionPlay === play) play.actions += 1;
  kit.sampleInjuries(state, seconds); kit.finishPeriod(state); kit.resolveEligibility(state);
}

function advance(ctx: Ctx, restarted: boolean): void {
  const { state, kit, play, offense } = ctx, handler = kit.player(state, offense, play.handlerId);
  if (risk(ctx, handler, 'advance')) return;
  const start = restarted ? kit.visualStart(state, play.positions) : play.positions;
  const positions = moveForAction(state, play, 'advance'), carrier = kit.player(state, offense, primaryHandler(state, offense));
  const from = kit.visualBallStart(state, start.find(point => point.playerId === handler.id)!), to = ballAt(positions.find(point => point.playerId === carrier.id)!);
  // Format 81 names a throw-in taken in the frontcourt (after a foul, a ball knocked out or a kicked ball).
  const text = ctx.flow && state.frontcourt ? `${nameOf(carrier)} takes the throw-in in the frontcourt. Shot clock ${state.shotClockSeconds}.` : `${nameOf(carrier)} brings ${state[offense].name} into their half-court offense.`;
  play.positions = positions; play.handlerId = carrier.id; play.passerId = null; state.frontcourt = true;
  kit.emit(state, { type: 'command', side: offense, playerId: carrier.id, text, scene: actionScene('setup', offense, start, positions, from, to) });
}

/** Fast break after a steal or a defensive rebound: the leader finishes, hits a runner or a trailer, or the defense recovers. */
function fastBreak(ctx: Ctx, handler: Player): void {
  const { state, kit } = ctx;
  state.frontcourt = true; ctx.play.passerId = null;
  // A big who rebounds makes the outlet pass to the point guard, who pushes.
  let leader = handler;
  if (isBig(handler)) {
    const guard = kit.player(state, ctx.offense, primaryHandler(state, ctx.offense));
    if (guard.id !== handler.id) {
      if (risk(ctx, handler, 'pass', defenderOf(ctx, guard))) return;
      pass(ctx, handler, guard, toward(pos(ctx, guard.id), ctx.hoop, 3), `${nameOf(handler)} makes the outlet pass to ${nameOf(guard)}.`);
      leader = guard;
    }
  }
  if (risk(ctx, leader, 'fastBreak')) return;
  const help = defenders(ctx), back = [...help].sort((a, b) => distanceToRim(ctx, pos(ctx, a.id)) - distanceToRim(ctx, pos(ctx, b.id)) || a.id.localeCompare(b.id))[0]!;
  const runner = others(ctx, leader).sort((a, b) => (b.attributes.twoPoint + (100 - state.stats[b.id]!.condition) * -.05) - (a.attributes.twoPoint + (100 - state.stats[a.id]!.condition) * -.05) || a.id.localeCompare(b.id))[0];
  const trailer = shooterFrom(ctx, others(ctx, leader, ...(runner ? [runner] : [])));
  const open = 1.7 + (leader.attributes.stamina - back.attributes.defense) * .04;
  const reads: Read[] = [
    { key: 'finish', weight: 1, value: lookValue(ctx, leader, back, 'rim', 2, open - .4, 1) },
    { key: 'runner', weight: runner ? .8 : 0, value: runner ? lookValue(ctx, runner, back, leader.heightCm >= 198 ? 'dunk' : 'rim', 2, open, .8) : 0 },
    { key: 'trailer', weight: trailer ? .45 : 0, value: trailer ? lookValue(ctx, trailer, defenderOf(ctx, trailer), 'catchThree', 3, 2, 7.1) : 0 },
    { key: 'settle', weight: .55, value: PLAYS.reads.resetValue },
  ];
  const choice = pickRead(ctx, leader, reads);
  const lane = spot(ctx, 1.1, angleOf(ctx, pos(ctx, leader.id)) * .3);
  if (choice === 'settle') {
    const next = copyPositions(ctx); setAt(next, leader.id, toward(lane, { x: .5, y: .5 }, 6)); follow(ctx, next, new Set());
    move(ctx, 'drive', leader, next, `${nameOf(leader)} pushes on the fast break, but the defense gets back.`, { from: leader.id, to: leader.id });
    ctx.play.handlerId = leader.id; ctx.play.passerId = null;
    return;
  }
  if (choice === 'finish') {
    drive(ctx, leader, lane, `${nameOf(leader)} races away on the fast break.`, { defender: back, separation: space(ctx, leader.attributes.twoPoint, back, open - .4, 1.4) });
    return shoot(ctx, { shooter: leader, kind: leader.heightCm >= 198 && kit.draw(state) < .3 ? 'dunk' : 'rim', value: 2, contest: back });
  }
  const target = choice === 'runner' ? runner! : trailer!;
  drive(ctx, leader, toward(lane, { x: .5, y: .5 }, 4), `${nameOf(leader)} leads the fast break.`);
  if (risk(ctx, leader, 'pass', defenderOf(ctx, target))) return;
  if (choice === 'runner') {
    pass(ctx, leader, target, spot(ctx, .9, -angleOf(ctx, pos(ctx, leader.id)) * .3 || .3), `${nameOf(leader)} finds ${nameOf(target)} ahead on the fast break.`, { defender: back, separation: space(ctx, leader.attributes.passing, back, open, 1.4) });
    return shoot(ctx, { shooter: target, kind: target.heightCm >= 200 && kit.draw(state) < .5 ? 'dunk' : 'rim', value: 2, contest: back, assist: leader });
  }
  const man = defenderOf(ctx, target);
  pass(ctx, leader, target, threeSpot(ctx, target), `${nameOf(leader)} kicks it out to the trailing ${nameOf(target)} on the fast break.`, { defender: man, separation: space(ctx, leader.attributes.passing, man, 1.9, 1.6) });
  shoot(ctx, { shooter: target, kind: 'catchThree', value: 3, contest: man, assist: leader });
}

function heave(ctx: Ctx, handler: Player): void {
  const man = defenderOf(ctx, handler), from = spot(ctx, 15 + ctx.kit.draw(ctx.state) * 5, (angleOf(ctx, pos(ctx, handler.id)) || .2) * .15);
  drive(ctx, handler, from, `${nameOf(handler)} races up the floor against the clock.`, { defender: man, separation: 2.2 });
  shoot(ctx, { shooter: handler, kind: 'heave', value: 3, contest: man });
}
function rush(ctx: Ctx, handler: Player): void {
  const man = defenderOf(ctx, handler), three = handler.attributes.threePoint >= 12 || ctx.state.score[ctx.offense] < ctx.state.score[ctx.defense] - 2;
  drive(ctx, handler, three ? spot(ctx, 7.6, angleOf(ctx, pos(ctx, handler.id)) * .4) : spot(ctx, 1.2, 0), `${nameOf(handler)} pushes for a quick shot before the horn.`, { defender: man, separation: space(ctx, handler.attributes.twoPoint, man, .9, 1) });
  shoot(ctx, { shooter: handler, kind: three ? 'pullThree' : 'rim', value: three ? 3 : 2, contest: man, rushed: true, offDribble: true });
}
function putback(ctx: Ctx, handler: Player): void {
  const near = [...defenders(ctx)].sort((a, b) => courtDistance(pos(ctx, a.id), pos(ctx, handler.id)) - courtDistance(pos(ctx, b.id), pos(ctx, handler.id)) || a.id.localeCompare(b.id))[0]!;
  const tip = handler.heightCm >= PLAYS.putback.tipHeight && ctx.kit.draw(ctx.state) < PLAYS.putback.tipShare;
  ctx.play.passerId = null;
  shoot(ctx, { shooter: handler, kind: tip ? 'tip' : 'putback', value: 2, contest: near });
}
/** Late in a close game: keep the ball moving until the last shot. */
function hold(ctx: Ctx, handler: Player): void {
  const receiver = shooterFrom(ctx, others(ctx, handler));
  if (!receiver) return;
  if (risk(ctx, handler, 'pass', defenderOf(ctx, receiver))) return;
  pass(ctx, handler, receiver, threeSpot(ctx, receiver), `${nameOf(handler)} swings it to ${nameOf(receiver)}, running down the clock.`);
}
/** Format 81: end of a period: the handler dribbles out the clock at the top, the others spread the floor. */
function holdForLastShot(ctx: Ctx, handler: Player): void {
  if (ctx.state.period < 4 && risk(ctx, handler, 'advance')) return;
  const next = copyPositions(ctx);
  setAt(next, handler.id, spot(ctx, 8.6, clamp(angleOf(ctx, pos(ctx, handler.id)) * .3, -.35, .35)));
  follow(ctx, next, new Set());
  setAt(next, defenderOf(ctx, handler).id, toward(next.find(item => item.playerId === handler.id)!, ctx.hoop, 1.4));
  move(ctx, 'command', handler, next, ctx.state.period < 4 ? `${nameOf(handler)} holds the ball for the last shot of the quarter.` : `${nameOf(handler)} runs down the clock with the lead.`, { from: handler.id, to: handler.id });
  ctx.play.passerId = null;
}
/** Shot clock or game clock running out: the best creator isolates. */
function late(ctx: Ctx, handler: Player, threeNeeded: boolean, rushed: boolean): void {
  const { state, kit } = ctx, man = defenderOf(ctx, handler);
  const three = threeNeeded || handler.attributes.threePoint >= 11 && kit.draw(state) < .25 + state.tactics[ctx.offense].outsideShare * .5 + (handler.attributes.threePoint - handler.attributes.twoPoint) * .03;
  const angle = angleOf(ctx, pos(ctx, handler.id));
  const to = three ? spot(ctx, 7.3, clamp(angle, -1.1, 1.1)) : spot(ctx, handler.attributes.twoPoint >= 14 ? 1.6 : 4.5, angle * .6);
  drive(ctx, handler, to, threeNeeded ? `${nameOf(handler)} looks for the tying three.` : `${nameOf(handler)} isolates as the clock runs down.`, { defender: man, separation: space(ctx, three ? handler.attributes.threePoint : handler.attributes.twoPoint, man, .75, 1) });
  shoot(ctx, { shooter: handler, kind: three ? 'pullThree' : distanceToRim(ctx, to) < 2.5 ? 'rim' : 'mid', value: three ? 3 : 2, contest: man, rushed, offDribble: true });
}

/** Pick-and-roll: a screen, then the handler's read. */
function pickAndRoll(ctx: Ctx, handler: Player): void {
  const { state, kit } = ctx, mates = others(ctx, handler);
  const screener = kit.choose(state, mates, p => ({ PG: .3, SG: .4, SF: 1, PF: 2.4, C: 3 })[p.position] * (p.attributes.twoPoint + p.attributes.rebounding) / 24);
  if (risk(ctx, screener, 'screen')) return;
  const man = defenderOf(ctx, handler), help = defenderOf(ctx, screener);
  const handlerAt = pos(ctx, handler.id), screenAt = toward(pos(ctx, man.id), { x: handlerAt.x, y: handlerAt.y < .5 ? handlerAt.y + .08 : handlerAt.y - .08 }, .7);
  const next = copyPositions(ctx); setAt(next, screener.id, screenAt); follow(ctx, next, new Set([man.id]));
  move(ctx, 'command', handler, next, `${nameOf(screener)} sets a ball screen for ${nameOf(handler)}.`, { from: handler.id, to: handler.id });
  ctx.play.passerId = null;
  const shooter = shooterFrom(ctx, others(ctx, handler, screener));
  const pullThree = handler.attributes.threePoint >= 12;
  const lob = screener.heightCm >= 203 && handler.attributes.passing >= 13;
  const reads: Read[] = [
    { key: 'pull', weight: 1, value: lookValue(ctx, handler, man, pullThree ? 'pullThree' : 'mid', pullThree ? 3 : 2, 1.4 + (handler.attributes.threePoint - man.attributes.defense) * .05, pullThree ? 7.3 : 4.8) },
    { key: 'drive', weight: 1.1, value: lookValue(ctx, handler, help, 'rim', 2, .9 + (handler.attributes.twoPoint - help.attributes.defense) * .05, 1) },
    { key: 'roll', weight: isBig(screener) ? 1 : .5, value: lookValue(ctx, screener, help, lob ? 'dunk' : 'rim', 2, 1 + (handler.attributes.passing - help.attributes.defense) * .05, 1) * .95 },
    { key: 'pop', weight: screener.attributes.threePoint >= 11 ? .7 : 0, value: lookValue(ctx, screener, help, 'catchThree', 3, 1.8, 7.1) },
    { key: 'kick', weight: shooter ? .6 : 0, value: shooter ? lookValue(ctx, shooter, defenderOf(ctx, shooter), 'catchThree', 3, 1.6, 7.1) : 0 },
    { key: 'reset', weight: 1, value: resetValue(ctx) },
  ];
  const choice = pickRead(ctx, handler, reads);
  const angle = angleOf(ctx, handlerAt);
  if (choice === 'pull') {
    drive(ctx, handler, pullThree ? spot(ctx, 7.3, clamp(angle * .8, -1.1, 1.1)) : spot(ctx, 4.6, angle * .7), `${nameOf(handler)} comes off the screen for a pull-up.`, { defender: man, separation: space(ctx, pullThree ? handler.attributes.threePoint : handler.attributes.twoPoint, man, 1.35, 1.6) }, screener);
    return shoot(ctx, { shooter: handler, kind: pullThree ? 'pullThree' : 'mid', value: pullThree ? 3 : 2, contest: man, offDribble: true });
  }
  if (choice === 'drive') {
    if (risk(ctx, handler, 'drive')) return;
    drive(ctx, handler, spot(ctx, 2.6, angle * .5), `${nameOf(handler)} turns the corner off the screen.`, undefined, screener);
    return driveRead(ctx, handler);
  }
  if (choice === 'roll') {
    if (risk(ctx, handler, 'pass', help)) return;
    const alley = lob && kit.draw(state) < .07;
    pass(ctx, handler, screener, spot(ctx, alley ? .6 : 1.1, -angle * .3), alley ? `${nameOf(handler)} throws the lob to ${nameOf(screener)} for the alley-oop.` : `${nameOf(handler)} hits the rolling ${nameOf(screener)}.`,
      { defender: help, separation: space(ctx, handler.attributes.passing, help, alley ? 1.2 : .9, 1.4) }, alley ? 1.6 : .35);
    return shoot(ctx, { shooter: screener, kind: alley || screener.heightCm >= 205 && kit.draw(state) < .2 ? 'dunk' : 'rim', value: 2, contest: help, assist: handler, alleyOop: alley });
  }
  if (choice === 'pop') {
    if (risk(ctx, handler, 'pass', help)) return;
    pass(ctx, handler, screener, spot(ctx, 7.1, clamp(angle * 1.2 + (angle >= 0 ? .4 : -.4), -1.2, 1.2)), `${nameOf(handler)} finds ${nameOf(screener)} popping out for three.`, { defender: help, separation: space(ctx, handler.attributes.passing, help, 1.7, 1.6) });
    return shoot(ctx, { shooter: screener, kind: 'catchThree', value: 3, contest: help, assist: handler });
  }
  if (choice === 'kick' && shooter) {
    const guard = defenderOf(ctx, shooter);
    if (risk(ctx, handler, 'pass', guard)) return;
    pass(ctx, handler, shooter, threeSpot(ctx, shooter), `${nameOf(handler)} draws two and kicks it out to ${nameOf(shooter)}.`, { defender: guard, separation: space(ctx, handler.attributes.passing, guard, 1.6, 1.6) });
    return shoot(ctx, { shooter, kind: 'catchThree', value: 3, contest: guard, assist: handler });
  }
  swing(ctx, handler, 'resets after the screen and swings it to');
}

/** After a drive: finish, dunk, floater, kick-out or dump-off. */
function driveRead(ctx: Ctx, driver: Player, assistedBy?: Player): void {
  const { state, kit } = ctx, man = defenderOf(ctx, driver), help = rimProtector(ctx, man);
  const shooter = shooterFrom(ctx, others(ctx, driver)), big = others(ctx, driver).filter(isBig).sort((a, b) => b.attributes.twoPoint - a.attributes.twoPoint || a.id.localeCompare(b.id))[0];
  const finish = .8 + (driver.attributes.twoPoint - help.attributes.defense) * .05, dunk = driver.heightCm >= 200 && driver.attributes.twoPoint >= 14;
  const reads: Read[] = [
    { key: 'finish', weight: 1.2, value: lookValue(ctx, driver, help, dunk ? 'dunk' : 'rim', 2, finish - (dunk ? .3 : 0), 1) * (dunk ? .85 : 1) },
    { key: 'floater', weight: .55, value: lookValue(ctx, driver, help, 'floater', 2, 1.3, 3.6) },
    { key: 'kick', weight: shooter ? .8 : 0, value: shooter ? lookValue(ctx, shooter, defenderOf(ctx, shooter), 'catchThree', 3, 1.8, 7.1) : 0 },
    { key: 'dump', weight: big && big.id !== driver.id ? .5 : 0, value: big ? lookValue(ctx, big, defenderOf(ctx, big), 'rim', 2, 1.1, 1) : 0 },
  ];
  const choice = pickRead(ctx, driver, reads), angle = angleOf(ctx, pos(ctx, driver.id));
  if (choice === 'kick' && shooter) {
    const guard = defenderOf(ctx, shooter);
    if (risk(ctx, driver, 'pass', guard)) return;
    pass(ctx, driver, shooter, threeSpot(ctx, shooter), `${nameOf(driver)} drives and kicks it out to ${nameOf(shooter)}.`, { defender: guard, separation: space(ctx, driver.attributes.passing, guard, 1.7, 1.6) });
    return shoot(ctx, { shooter, kind: 'catchThree', value: 3, contest: guard, assist: driver });
  }
  if (choice === 'dump' && big) {
    const guard = defenderOf(ctx, big);
    if (risk(ctx, driver, 'pass', guard)) return;
    pass(ctx, driver, big, spot(ctx, 1, -angle * .4 || .4), `${nameOf(driver)} dumps it off to ${nameOf(big)} under the basket.`, { defender: help.id === man.id ? guard : help, separation: space(ctx, driver.attributes.passing, guard, 1, 1.2) });
    return shoot(ctx, { shooter: big, kind: big.heightCm >= 205 && kit.draw(state) < .2 ? 'dunk' : 'rim', value: 2, contest: help.id === man.id ? guard : help, assist: driver });
  }
  const floater = choice === 'floater';
  const next = copyPositions(ctx); setAt(next, driver.id, spot(ctx, floater ? 3.6 : dunk ? .7 : 1.1, angle * .4));
  settle(ctx, next, driver, help, space(ctx, driver.attributes.twoPoint, help, floater ? 1.3 : finish, 1.2));
  move(ctx, 'drive', driver, next, floater ? `${nameOf(driver)} stops in the lane for a floater.` : `${nameOf(driver)} attacks the rim.`, { from: driver.id, to: driver.id });
  shoot(ctx, { shooter: driver, kind: floater ? 'floater' : dunk && kit.draw(state) < .3 ? 'dunk' : 'rim', value: 2, contest: help, offDribble: true, ...(assistedBy && kit.draw(state) < .25 ? { assist: assistedBy } : {}) });
}

function isolation(ctx: Ctx, handler: Player): void {
  if (risk(ctx, handler, 'drive')) return;
  const man = defenderOf(ctx, handler), angle = angleOf(ctx, pos(ctx, handler.id));
  const pull = handler.attributes.threePoint >= 13 && ctx.kit.draw(ctx.state) < .35 + ctx.state.tactics[ctx.offense].outsideShare * .2;
  if (pull) {
    drive(ctx, handler, spot(ctx, 7.4, clamp(angle, -1.1, 1.1)), `${nameOf(handler)} sizes up ${nameOf(man)} and steps back.`, { defender: man, separation: space(ctx, handler.attributes.threePoint, man, 1.1, 1.6) });
    return shoot(ctx, { shooter: handler, kind: 'pullThree', value: 3, contest: man, offDribble: true });
  }
  drive(ctx, handler, spot(ctx, 3, angle * .6), `${nameOf(handler)} attacks ${nameOf(man)} off the dribble.`);
  driveRead(ctx, handler);
}

/** Post-up: entry pass, back down, then a hook, drop step, face-up jumper or kick-out from a double team. */
function postUp(ctx: Ctx, handler: Player): void {
  const { state, kit } = ctx, team = attackers(ctx), bigs = team.filter(isBig);
  const big = isBig(handler) ? handler : kit.choose(state, bigs.length ? bigs : team.filter(p => p.id !== handler.id).length ? team.filter(p => p.id !== handler.id) : team, p => Math.max(.5, p.attributes.twoPoint - defenderOf(ctx, p).attributes.defense + 6) ** 2);
  const man = defenderOf(ctx, big), side = (angleOf(ctx, pos(ctx, big.id)) >= 0 ? 1 : -1);
  if (big.id !== handler.id) {
    if (risk(ctx, handler, 'pass', man)) return;
    pass(ctx, handler, big, spot(ctx, 4.2, side * 1.05), `${nameOf(handler)} feeds ${nameOf(big)} in the post.`, { defender: man, separation: .6 });
  }
  if (risk(ctx, big, 'post')) return;
  const entry = big.id !== handler.id ? handler : undefined;
  drive(ctx, big, spot(ctx, 2.6, side * .95), `${nameOf(big)} backs down ${nameOf(man)} in the post.`, { defender: man, separation: .55 });
  const shooter = shooterFrom(ctx, others(ctx, big));
  const edge = big.attributes.twoPoint - man.attributes.defense;
  const reads: Read[] = [
    { key: 'hook', weight: 1.2, value: lookValue(ctx, big, man, 'post', 2, .65 + edge * .04, 2.6) },
    { key: 'drop', weight: .7, value: lookValue(ctx, big, man, 'rim', 2, .5 + edge * .05, 1.1) },
    { key: 'face', weight: big.attributes.threePoint >= 10 ? .45 : .2, value: lookValue(ctx, big, man, 'mid', 2, 1.1, 4.2) },
    { key: 'double', weight: shooter ? .55 + Math.max(0, edge) * .08 : 0, value: shooter ? lookValue(ctx, shooter, defenderOf(ctx, shooter), 'catchThree', 3, 2.1, 7.1) * (big.attributes.passing >= 10 ? 1 : .85) : 0 },
  ];
  const choice = pickRead(ctx, big, reads);
  const assist = entry && kit.draw(state) < .2 ? entry : undefined;
  if (choice === 'double' && shooter) {
    const guard = defenderOf(ctx, shooter);
    if (risk(ctx, big, 'pass', guard)) return;
    pass(ctx, big, shooter, threeSpot(ctx, shooter), `${nameOf(big)} is doubled and kicks it out to ${nameOf(shooter)}.`, { defender: guard, separation: space(ctx, big.attributes.passing, guard, 2, 1.6) });
    return shoot(ctx, { shooter, kind: 'catchThree', value: 3, contest: guard, assist: big });
  }
  const drop = choice === 'drop', face = choice === 'face';
  const next = copyPositions(ctx); setAt(next, big.id, spot(ctx, drop ? 1 : face ? 4.2 : 2.6, side * (drop ? .5 : face ? .9 : .7)));
  settle(ctx, next, big, man, space(ctx, big.attributes.twoPoint, man, drop ? .5 : face ? 1.1 : .65, 1));
  move(ctx, 'drive', big, next, drop ? `${nameOf(big)} spins baseline with a drop step.` : face ? `${nameOf(big)} faces up ${nameOf(man)}.` : `${nameOf(big)} turns into a hook shot.`, { from: big.id, to: big.id });
  shoot(ctx, { shooter: big, kind: drop ? big.heightCm >= 205 && kit.draw(state) < .2 ? 'dunk' : 'rim' : face ? 'mid' : 'post', value: 2, contest: man, ...(assist ? { assist } : {}) });
}

/** Ball movement: swing passes, off-ball screens and cuts for a catch-and-shoot look, an extra pass or a backdoor layup. */
function motion(ctx: Ctx, handler: Player): void {
  const { state, kit } = ctx, mates = others(ctx, handler);
  if (!mates.length) return late(ctx, handler, false, false);
  const outside = state.tactics[ctx.offense].outsideShare;
  const receiver = kit.choose(state, mates, p => (outside * p.attributes.threePoint + (1 - outside) * p.attributes.twoPoint) * (isBig(p) ? 1.2 - outside : .62 + outside));
  const guard = defenderOf(ctx, receiver);
  if (risk(ctx, handler, 'pass', guard)) return;
  const separation = space(ctx, (handler.attributes.passing + (handler.attributes.intelligence ?? EXTRA_MATCH.centre)) / 2, guard, 1.35, 1.8);
  const wide = !isBig(receiver) || receiver.attributes.threePoint >= 11;
  pass(ctx, handler, receiver, wide ? threeSpot(ctx, receiver) : spot(ctx, 4.6, angleOf(ctx, pos(ctx, receiver.id))), wide ? `${nameOf(handler)} finds ${nameOf(receiver)} coming off a screen.` : `${nameOf(handler)} swings it to ${nameOf(receiver)}.`, { defender: guard, separation });
  const cutter = others(ctx, receiver, handler).sort((a, b) => b.attributes.twoPoint - defenderOf(ctx, b).attributes.defense - (a.attributes.twoPoint - defenderOf(ctx, a).attributes.defense) || a.id.localeCompare(b.id))[0];
  const extra = shooterFrom(ctx, others(ctx, receiver));
  const reads: Read[] = [
    { key: 'shoot', weight: 1, value: lookValue(ctx, receiver, guard, wide ? 'catchThree' : 'mid', wide ? 3 : 2, separation, wide ? 7.1 : 4.6) },
    { key: 'cut', weight: cutter ? .25 : 0, value: cutter ? lookValue(ctx, cutter, defenderOf(ctx, cutter), 'rim', 2, .9 + (receiver.attributes.passing - 12) * .05, 1) : 0 },
    { key: 'extra', weight: extra ? .35 : 0, value: extra ? lookValue(ctx, extra, defenderOf(ctx, extra), 'catchThree', 3, 1.9, 7.1) : 0 },
    { key: 'attack', weight: .6, value: lookValue(ctx, receiver, rimProtector(ctx, guard), 'rim', 2, .8 + (receiver.attributes.twoPoint - guard.attributes.defense) * .05 + Math.max(0, 1.2 - separation) * .5, 1) },
    { key: 'reset', weight: 1, value: resetValue(ctx) },
  ];
  const choice = pickRead(ctx, receiver, reads);
  if (choice === 'shoot') return shoot(ctx, { shooter: receiver, kind: wide ? 'catchThree' : 'mid', value: wide ? 3 : 2, contest: guard, assist: handler });
  if (choice === 'cut' && cutter) {
    const man = defenderOf(ctx, cutter);
    if (risk(ctx, receiver, 'pass', man)) return;
    pass(ctx, receiver, cutter, spot(ctx, 1, (angleOf(ctx, pos(ctx, cutter.id)) || .5) * .4), `${nameOf(cutter)} cuts backdoor and ${nameOf(receiver)} finds him.`, { defender: man, separation: space(ctx, receiver.attributes.passing, man, 1, 1.4) });
    return shoot(ctx, { shooter: cutter, kind: cutter.heightCm >= 203 && kit.draw(state) < .2 ? 'dunk' : 'rim', value: 2, contest: man, assist: receiver });
  }
  if (choice === 'extra' && extra) {
    const man = defenderOf(ctx, extra);
    if (risk(ctx, receiver, 'pass', man)) return;
    pass(ctx, receiver, extra, threeSpot(ctx, extra), `${nameOf(receiver)} makes the extra pass to ${nameOf(extra)}.`, { defender: man, separation: space(ctx, receiver.attributes.passing, man, 1.9, 1.6) });
    return shoot(ctx, { shooter: extra, kind: 'catchThree', value: 3, contest: man, assist: receiver });
  }
  if (choice === 'attack') {
    if (risk(ctx, receiver, 'drive')) return;
    drive(ctx, receiver, spot(ctx, 2.8, angleOf(ctx, pos(ctx, receiver.id)) * .5), `${nameOf(receiver)} attacks the closeout.`);
    return driveRead(ctx, receiver, handler);
  }
  // Reset: the ball stays with the receiver for the next action.
}
function swing(ctx: Ctx, handler: Player, words: string): void {
  const receiver = shooterFrom(ctx, others(ctx, handler));
  if (!receiver) return;
  if (risk(ctx, handler, 'pass', defenderOf(ctx, receiver))) return;
  pass(ctx, handler, receiver, threeSpot(ctx, receiver), `${nameOf(handler)} ${words} ${nameOf(receiver)}.`);
}
/** Early offense: a quick three before the defense is set. */
function early(ctx: Ctx, handler: Player): void {
  const shooter = shooterFrom(ctx, attackers(ctx))!;
  const guard = defenderOf(ctx, shooter);
  if (shooter.id === handler.id) {
    drive(ctx, handler, spot(ctx, 7.6, clamp(angleOf(ctx, pos(ctx, handler.id)), -1, 1)), `${nameOf(handler)} pulls up early in the possession.`, { defender: guard, separation: space(ctx, handler.attributes.threePoint, guard, 1.4, 1.6) });
    return shoot(ctx, { shooter, kind: 'pullThree', value: 3, contest: guard, offDribble: true });
  }
  if (risk(ctx, handler, 'pass', guard)) return;
  pass(ctx, handler, shooter, threeSpot(ctx, shooter), `${nameOf(handler)} hits ${nameOf(shooter)} in early offense.`, { defender: guard, separation: space(ctx, handler.attributes.passing, guard, 1.6, 1.8) });
  shoot(ctx, { shooter, kind: 'catchThree', value: 3, contest: guard, assist: handler });
}


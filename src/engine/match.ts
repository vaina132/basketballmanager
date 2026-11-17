/** Deterministic FIBA-2024 rules subset. Probability and fatigue parameters remain uncalibrated; injury rates follow research (sprint 4). */
import { FICTIONAL_AWAY, FICTIONAL_HOME } from '../data/fictional-teams';
import type { CourtPoint, CourtPosition, CourtScene, EngineVersion, InjuryMode, MatchEvent, MatchState, Player, PlayerStats, Position, PossessionPlay, Side, Tactics, Team } from '../domain/types';
import { nextRandom, normalizeSeed } from './random';
import { injuryPhrase, injuryRiskTotal, isInjuryKind, isMatchInjuryKind, pickInjuryKind, type InjuryKind, type InjuryRisk } from '../domain/injuries';
import { actionScene, freeThrowPosition, passScene, reboundScene, setupScene, shotScene, turnoverScene } from './court-events';
import { basketPoint, courtDistance, createPossessionPlay, matchedDefender, moveForAction, positionOf, possessionFormation, primaryHandler, shotContext } from './possession';
import { ACTION_SECONDS, BLOCKS, DEFENDER_ROLES, DEFENSIVE_FOULS, LATE_GAME, REBOUNDS, ROTATION, SHOOTING_FOULS, SHOT_MAKING, SHOT_SELECTION, TEAM_REBOUND_OFFENSIVE_SHARE, TEAM_REBOUND_SHARE, TURNOVERS } from './calibration';
import { overallRating } from '../world/overall-rating';
import { asPlayedIn, courtCircles, COURT_POSITIONS, isCourtPosition } from './positions';
export const MAX_MATCH_PERIODS = 24;
const MAX_SIMULATION_STEPS = 20_000;
const SIDES: readonly Side[] = ['home', 'away'];
const DEFAULT_TACTICS: Tactics = { tempo: 0.5, outsideShare: 0.45, pressure: 0.5 };
/** Time-loss game injuries: about 0.00085 per minute played (2.5% for a 30-minute starter), sprint 4. */
export const INJURY_RATE_PER_MINUTE = 0.00085;
export const INJURY_HAZARD_PER_PLAYER_SECOND = INJURY_RATE_PER_MINUTE / 60;
/** Minutes beyond 32 in one game carry 1.3 times the risk; the reduced setting keeps 0.3 times the standard rate. */
export const INJURY_LATE_MINUTES_SECONDS = 32 * 60;
export const INJURY_LATE_MINUTES_FACTOR = 1.3;
export const REDUCED_INJURY_FACTOR = 0.3;
/** Upper bound for one kind's recurrence multiplier (a muscle strain soon after return, times two after a concussion). */
export const MAX_INJURY_RISK = 20;
const other = (side: Side): Side => side === 'home' ? 'away' : 'home';
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const elapsed = (state: MatchState): number => state.period <= 4 ? state.period * 600 - state.clockSeconds : 2400 + (state.period - 4) * 300 - state.clockSeconds;
const lateGame = (state: MatchState): boolean => state.period >= 4 && state.clockSeconds <= 120;
/** Focus changes decision errors only, capped at half a percentage point; no extra random draw. */
export function moraleTurnoverAdjustment(state: Pick<MatchState, 'morale'>, playerId: string): number {
  return clamp((50 - (state.morale?.values[playerId] ?? 50)) / 10_000, -.005, .005);
}
function emptyStats(): PlayerStats {
  return { secondsPlayed: 0, points: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, threePointersMade: 0, threePointersAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0, condition: 100 };
}
function copy(state: MatchState): MatchState {
  return { ...state, score: { ...state.score },
    ...(state.engineVersion === 'possession-3' ? { possessionPlay: state.possessionPlay ? { ...state.possessionPlay, positions: state.possessionPlay.positions.map(point => ({ ...point })), matchups: state.possessionPlay.matchups.map(pair => ({ ...pair })) } : null } : {}),
    lineups: { home: [...state.lineups.home], away: [...state.lineups.away] },
    ...(state.slots ? { slots: copySlots(state.slots) } : {}),
    ...(state.startingSlots ? { startingSlots: copySlots(state.startingSlots) } : {}),
    tactics: { home: { ...state.tactics.home }, away: { ...state.tactics.away } },
    stats: Object.fromEntries(Object.entries(state.stats).map(([id, value]) => [id, { ...value }])),
    events: [...state.events], teamFouls: { ...state.teamFouls },
    timeoutUsage: { home: { ...state.timeoutUsage.home }, away: { ...state.timeoutUsage.away } },
    timeoutRequested: { ...state.timeoutRequested },
    pendingSubstitutions: { home: state.pendingSubstitutions.home.map(r => ({ ...r })), away: state.pendingSubstitutions.away.map(r => ({ ...r })) },
    requiredSubstitutions: state.requiredSubstitutions.map(r => ({ ...r })),
    freeThrows: state.freeThrows ? { ...state.freeThrows } : null,
    stoppage: state.stoppage ? { ...state.stoppage, substitutionSides: [...state.stoppage.substitutionSides], timeoutSides: [...state.stoppage.timeoutSides] } : null,
    substitutionLocks: [...state.substitutionLocks], autoSubstitutions: { ...state.autoSubstitutions },
    injuries: Object.fromEntries(Object.entries(state.injuries).map(([id, injury]) => [id, { ...injury }])),
    ...(state.preExistingInjuries ? { preExistingInjuries: [...state.preExistingInjuries] } : {}),
    ...(state.injuryRisk ? { injuryRisk: Object.fromEntries(Object.entries(state.injuryRisk).map(([id, risk]) => [id, { ...risk }])) } : {}),
    ...(state.morale ? { morale: { ...state.morale, values: { ...state.morale.values } } } : {}),
    courtSeconds: { ...state.courtSeconds }, result: state.result ? { ...state.result, officialScore: { ...state.result.officialScore } } : null,
  };
}
function copySlots(slots: NonNullable<MatchState['slots']>): NonNullable<MatchState['slots']> {
  return Object.fromEntries(Object.entries(slots).map(([side, circles]) => [side, { ...circles }]));
}
/** A player the manager put in a circle plays that circle's position while on court; everyone else plays as listed. */
function circlePlayer(state: MatchState, side: Side, result: Player): Player {
  const circle = state.slots?.[side]?.[result.id];
  return circle && state.lineups[side].includes(result.id) ? asPlayedIn(result, circle) : result;
}
/** Chosen circles belong to players on court and to reserves queued for a circle; anything else is dropped. */
function pruneCircles(state: MatchState): void {
  for (const side of SIDES) {
    const circles = state.slots?.[side];
    if (circles) for (const id of Object.keys(circles)) if (!state.lineups[side].includes(id) && !state.pendingSubstitutions[side].some(request => request.inId === id)) delete circles[id];
  }
}
function draw(state: MatchState): number { const next = nextRandom(state.rngState); state.rngState = next.state; return next.value; }
function emit(state: MatchState, event: Omit<MatchEvent, 'id' | 'period' | 'clockSeconds' | 'score'>): void { state.events.push({ ...event, id: state.events.length + 1, period: state.period, clockSeconds: state.clockSeconds, score: { ...state.score } }); }
function assertSide(side: Side): void { if (side !== 'home' && side !== 'away') throw new Error('Choose a valid team.'); }
function assertOpen(state: MatchState): void { if (state.status === 'finished') throw new Error('The match has finished.'); }
function assertBoundary(state: MatchState): void {
  for (const side of SIDES) {
    const ids = state.lineups[side], available = new Set(state[side].players.map(player => player.id));
    if (ids.length < 2 || ids.length > 5 || new Set(ids).size !== ids.length || ids.some(id => !available.has(id) || !state.stats[id])) throw new Error(`${side} must have two to five unique players from its own roster.`);
  }
  if (state.lineups.home.some(id => state.lineups.away.includes(id))) throw new Error('A player cannot appear for both teams.');
  if (!Number.isInteger(state.clockSeconds) || state.clockSeconds < 0 || state.clockSeconds > (state.period <= 4 ? 600 : 300)) throw new Error('The game clock is outside the current period.');
  if (!Number.isInteger(state.shotClockSeconds) || state.shotClockSeconds < 0 || state.shotClockSeconds > 24) throw new Error('The shot clock is outside its legal range.');
}
function player(state: MatchState, side: Side, id: string): Player { const result = state[side].players.find(p => p.id === id); if (!result) throw new Error('A player is missing from the roster.'); return circlePlayer(state, side, result); }
function activePlayers(state: MatchState, side: Side): Player[] { return state.lineups[side].map(id => player(state, side, id)); }
function mean(players: readonly Player[], skill: keyof Player['attributes']): number { return players.reduce((sum, player) => sum + player.attributes[skill], 0) / Math.max(1, players.length); }
function choose(state: MatchState, players: readonly Player[], weight: (player: Player) => number): Player {
  if (!players.length) throw new Error('Cannot choose a player from an empty lineup.');
  const weights = players.map(player => Math.max(0.01, weight(player))); let target = draw(state) * weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < players.length; index += 1) { target -= weights[index]!; if (target < 0) return players[index]!; }
  return players[players.length - 1]!;
}
export function isPlayerEligible(state: MatchState, id: string): boolean { return Boolean(state.stats[id]) && state.stats[id]!.fouls < 5 && !state.injuries[id]; }
export function attackingDirection(state: Pick<MatchState, 'period'>, side: Side): 1 | -1 { return (side === 'home') === (state.period <= 2) ? 1 : -1; }
export function defensiveFoulShotClock(remaining: number, frontcourt: boolean): number { return frontcourt ? Math.max(14, remaining) : 24; }
export function remainingTimeouts(state: MatchState, side: Side): number {
  assertSide(side); const used = state.timeoutUsage[side];
  if (state.period <= 2) return Math.max(0, 2 - used.firstHalf);
  if (state.period > 4) return Math.max(0, 1 - used.overtime);
  const remaining = 3 - used.secondHalf;
  return Math.max(0, state.period === 4 && state.clockSeconds <= 120 ? Math.min(remaining, 2 - used.lateFourth) : remaining);
}
export function canSubstituteNow(state: MatchState, side: Side, outId?: string): boolean {
  if (state.status === 'finished' || !state.stoppage?.substitutionSides.includes(side)) return false;
  if (outId && state.freeThrows?.shooterId === outId && isPlayerEligible(state, outId)) return false;
  if (outId && state.substitutionLocks.includes(outId) && isPlayerEligible(state, outId)) return false;
  return true;
}
function whistle(state: MatchState, reason: 'whistle' | 'free-throws' | 'timeout' = 'whistle'): void {
  clearPossessionPlay(state);
  state.phase = state.freeThrows ? 'free-throws' : 'dead-ball';
  state.stoppage = { reason, substitutionSides: ['home', 'away'], timeoutSides: state.stepCount > 0 && state.clockSeconds > 0 ? ['home', 'away'] : [] };
}
function clearPossessionPlay(state: MatchState): void { if (state.engineVersion === 'possession-3') state.possessionPlay = null; }
function resetPossession(state: MatchState, side: Side, shotClock = 24): void {
  const positions = state.possessionPlay?.positions;
  state.possession = side; state.shotClockSeconds = shotClock; state.frontcourt = false;
  if (state.engineVersion === 'possession-3') {
    state.possessionPlay = createPossessionPlay(state);
    if (positions) state.possessionPlay.positions = positions.map(point => ({ ...point }));
  }
}
function madeBasketWindow(state: MatchState, scoring: Side): void {
  const receiving = other(scoring); resetPossession(state, receiving); state.phase = 'live-ball';
  state.stoppage = { reason: 'made-basket', substitutionSides: lateGame(state) ? [receiving] : [], timeoutSides: [receiving] };
}
function creditPoints(state: MatchState, side: Side, shooter: Player, value: number): void { state.stats[shooter.id]!.points += value; state.score[side] += value; }
function exposure(state: MatchState, seconds: number): void {
  state.substitutionLocks = [];
  for (const side of SIDES) {
    const active = new Set(state.lineups[side]); state.courtSeconds[side] += seconds * active.size;
    for (const player of state[side].players) {
      const stats = state.stats[player.id]!;
      if (active.has(player.id)) {
        if (!isPlayerEligible(state, player.id)) throw new Error('An ineligible player cannot receive court time.');
        stats.secondsPlayed += seconds;
        const intensity = 0.85 + 0.4 * state.tactics[side].tempo + 0.35 * state.tactics[side].pressure;
        stats.condition = Math.round(Math.max(35, stats.condition - seconds * 0.014 * (1.4 - player.attributes.stamina / 40) * intensity) * 1000) / 1000;
      } else stats.condition = Math.round(Math.min(100, stats.condition + seconds * 0.012) * 1000) / 1000;
    }
  }
}
function recovery(state: MatchState, amount: number): void { for (const stats of Object.values(state.stats)) stats.condition = Math.min(100, stats.condition + amount); }
function applySubstitution(state: MatchState, side: Side, outId: string, inId: string, mandatory = false): void {
  const outgoing = player(state, side, outId), incoming = player(state, side, inId), index = state.lineups[side].indexOf(outId);
  if (index < 0 || state.lineups[side].includes(inId) || !isPlayerEligible(state, inId)) throw new Error('Substitution no longer matches the available lineup.');
  // A reserve the manager queued for a circle (court picture) takes the circle the outgoing player is shown in; any
  // other incoming player plays his listed position.
  const circles = state.slots?.[side], circle = circles && Object.hasOwn(circles, inId) ? courtCircles(state, side)[outId] : undefined;
  state.lineups[side][index] = inId;
  if (circles) { delete circles[outId]; if (circle) circles[inId] = circle; else delete circles[inId]; }
  if (mandatory && state.freeThrows?.shooterId === outId) state.freeThrows.shooterId = inId;
  // Before tip-off the starting five is still being chosen (court picture, format 74): a change then locks nobody, so
  // a player brought in can be moved out again at once. Locks apply from the first live action. The legacy exhibition
  // engine keeps its original contract.
  if (state.stepCount > 0 || state.engineVersion === 'rules-2') state.substitutionLocks = [...new Set([...state.substitutionLocks, outId, inId])];
  const scene = state.engineVersion === 'possession-3' ? lineupScene(state, outId, inId) : setupScene(state, state.possession, state.lineups[state.possession][0]!);
  emit(state, { type: 'substitution', side, playerId: inId, outgoingPlayerId: outId, text: `${incoming.name} replaces ${outgoing.name}${mandatory ? ' after becoming ineligible' : ''}.`, scene });
}
function bestReplacement(state: MatchState, side: Side, outgoing: Player): Player | undefined {
  // The legacy exhibition engine keeps its original condition-first choice.
  const need = state.engineVersion === 'rules-2' ? null : rotationNeeds(state, side);
  return state[side].players.filter(p => !state.lineups[side].includes(p.id) && isPlayerEligible(state, p.id)).sort((a, b) => replacementScore(b) - replacementScore(a) || a.id.localeCompare(b.id))[0];
  function replacementScore(p: Player): number {
    if (need) return need.get(p.id)! - positionGap(outgoing, p) * ROTATION.positionStep;
    return state.stats[p.id]!.condition - state.stats[p.id]!.fouls * 5 + (p.position === outgoing.position ? 12 : 0) + (p.attributes.defense + p.attributes.twoPoint) / 4;
  }
}
const POSITION_ORDER: Readonly<Record<Player['position'], number>> = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
const positionGap = (a: Player, b: Player): number => Math.abs(POSITION_ORDER[a.position] - POSITION_ORDER[b.position]);
/** The starting five: the tip-off court positions, then any change made before the clock first ran. */
function startingFive(state: MatchState, side: Side): Set<string> {
  const roster = new Set(state[side].players.map(p => p.id)), tip = state.events[0];
  let starters = tip?.type === 'tipoff' && tip.scene ? tip.scene.start.map(point => point.playerId).filter(id => roster.has(id)) : state[side].players.slice(0, 5).map(p => p.id);
  for (let index = 1; index < state.events.length; index += 1) {
    const event = state.events[index]!;
    if (event.period !== 1 || event.clockSeconds !== 600) break;
    if (event.type === 'substitution' && event.side === side && event.outgoingPlayerId && event.playerId) starters = starters.map(id => id === event.outgoingPlayerId ? event.playerId! : id);
  }
  return new Set(starters);
}
/**
 * The five a side started the game with (`startingFive`: the tip-off five and each change made before the clock first
 * ran, in place) and whether such a change was made, for example a substitution chosen before tip-off. Reads events only.
 */
export function preTipoffLineup(state: MatchState, side: Side): { five: string[]; changed: boolean } {
  const roster = new Set(state[side].players.map(p => p.id)), tip = state.events[0];
  const opening = tip?.type === 'tipoff' && tip.scene ? tip.scene.start.map(point => point.playerId).filter(id => roster.has(id)) : state[side].players.slice(0, 5).map(p => p.id);
  const five = [...startingFive(state, side)];
  return { five, changed: five.length !== opening.length || five.some(id => !opening.includes(id)) };
}
/**
 * The automatic rotation's need for each player to be on court, in minutes (calibration.ts, ROTATION). Players are
 * ranked by overall rating with the starters ahead; each rank plans a share of the team's minutes. Need is the planned
 * time not yet played, less fatigue and foul trouble; the best five close tight games and the deep bench plays out
 * blowouts. Reads state only: no random draws.
 */
function rotationNeeds(state: MatchState, side: Side): Map<string, number> {
  const starters = startingFive(state, side), unavailable = new Set(state.preExistingInjuries ?? []);
  const ranked = state[side].players.filter(p => !unavailable.has(p.id)).map(player => ({ player, quality: overallRating(player.attributes, player.position) + (starters.has(player.id) ? ROTATION.starterBonus : 0), base: overallRating(player.attributes, player.position) }))
    .sort((a, b) => b.quality - a.quality || a.player.id.localeCompare(b.player.id));
  const core = ranked.slice(0, 10), average = core.reduce((sum, entry) => sum + entry.base, 0) / Math.max(1, core.length);
  const minutes = ranked.map((entry, rank) => Math.max(0, (ROTATION.plannedMinutes[rank] ?? 0) + ROTATION.qualityMinutes * (entry.base - average)));
  const total = minutes.reduce((sum, value) => sum + value, 0) || 1, played = elapsed(state), margin = Math.abs(state.score.home - state.score.away);
  const garbage = state.period === 4 && state.clockSeconds <= ROTATION.garbageSeconds && margin >= ROTATION.garbageMargin;
  const closing = !garbage && state.period >= 4 && state.clockSeconds <= ROTATION.closingSeconds && margin <= ROTATION.closingMargin;
  const closers = new Set(ranked.filter(entry => isPlayerEligible(state, entry.player.id)).slice(0, 5).map(entry => entry.player.id));
  const foulLimit = state.period === 1 ? 2 : state.period === 2 ? 3 : 4;
  const needs = new Map<string, number>(state[side].players.map(p => [p.id, -100]));
  ranked.forEach((entry, rank) => {
    const stats = state.stats[entry.player.id]!;
    const deficit = (minutes[rank]! / total * 12_000 * played / 2400 - stats.secondsPlayed) / 60;
    const fatigue = Math.max(0, ROTATION.restCondition - stats.condition) * ROTATION.fatigueWeight * (closing ? .5 : 1);
    const fouls = stats.fouls >= foulLimit && !closing ? ROTATION.foulTrouble : 0;
    const role = closing ? (closers.has(entry.player.id) ? ROTATION.closingBonus : 0) : garbage ? (rank >= ROTATION.garbageRank ? ROTATION.garbageBonus : rank < 5 ? -ROTATION.garbageBonus : 0) : rank >= ROTATION.rotationSize ? -ROTATION.depthPenalty : 0;
    needs.set(entry.player.id, deficit - fatigue - fouls + role);
  });
  return needs;
}
/** Up to ROTATION.maxSwaps changes whose gain in rotation need clears the threshold, best first. */
function automaticSwaps(state: MatchState, side: Side): [Player, Player][] {
  const need = rotationNeeds(state, side), swaps: [Player, Player][] = [];
  let court = activePlayers(state, side).filter(p => !state.substitutionLocks.includes(p.id) && state.freeThrows?.shooterId !== p.id);
  let bench = state[side].players.filter(p => !state.lineups[side].includes(p.id) && isPlayerEligible(state, p.id) && !state.substitutionLocks.includes(p.id));
  for (let count = 0; count < ROTATION.maxSwaps; count += 1) {
    let best: { out: Player; incoming: Player; gain: number } | null = null;
    for (const out of court) for (const incoming of bench) {
      const gain = need.get(incoming.id)! - need.get(out.id)! - positionGap(out, incoming) * ROTATION.positionStep;
      if (gain > ROTATION.swapThreshold && (!best || gain > best.gain)) best = { out, incoming, gain };
    }
    if (!best) break;
    const chosen = best;
    swaps.push([chosen.out, chosen.incoming]);
    court = court.filter(p => p.id !== chosen.out.id); bench = bench.filter(p => p.id !== chosen.incoming.id);
  }
  return swaps;
}
function clearCommands(state: MatchState): void { state.pendingSubstitutions = { home: [], away: [] }; state.timeoutRequested = { home: false, away: false }; state.requiredSubstitutions = []; }
function finishDefault(state: MatchState, losing: Side): void {
  clearPossessionPlay(state);
  const winner = other(losing), officialScore = state.score[winner] > state.score[losing] ? { ...state.score } : { [winner]: 2, [losing]: 0 } as Record<Side, number>;
  for (const side of SIDES) state.lineups[side] = state.lineups[side].filter(id => isPlayerEligible(state, id));
  state.result = { winner, kind: 'default', officialScore }; state.status = 'finished'; state.freeThrows = null; state.stoppage = null; state.phase = 'dead-ball'; clearCommands(state); pruneCircles(state);
  emit(state, { type: 'final', side: winner, text: `${state[losing].name} have fewer than two eligible players. ${state[winner].name} win by default, official score ${officialScore.home}–${officialScore.away}. Recorded player statistics are retained.` });
}
function resolveEligibility(state: MatchState): void {
  state.requiredSubstitutions = []; if (state.status === 'finished') return;
  for (const side of SIDES) {
    for (const outId of [...state.lineups[side]]) {
      if (isPlayerEligible(state, outId)) continue;
      const reason = state.stats[outId]!.fouls >= 5 ? 'fouled-out' : 'injured', incoming = bestReplacement(state, side, player(state, side, outId));
      if (incoming && state.autoSubstitutions[side]) applySubstitution(state, side, outId, incoming.id, true);
      else if (incoming) state.requiredSubstitutions.push({ side, playerId: outId, reason });
      else {
        state.lineups[side] = state.lineups[side].filter(id => id !== outId); pruneCircles(state);
        emit(state, { type: 'substitution', side, outgoingPlayerId: outId, text: `${player(state, side, outId).name} leaves; no eligible substitute remains.`, ...(SIDES.every(team => state.lineups[team].length >= 2) ? { scene: state.engineVersion === 'possession-3' ? lineupScene(state) : setupScene(state, state.possession, state.lineups[state.possession][0]!) } : {}) });
        if (state.freeThrows?.shooterId === outId) { const replacement = state.lineups[side].find(id => isPlayerEligible(state, id)); if (replacement) state.freeThrows.shooterId = replacement; }
      }
    }
    if (state[side].players.filter(p => isPlayerEligible(state, p.id)).length < 2 || state.lineups[side].length < 2) { finishDefault(state, side); return; }
  }
  if (state.requiredSubstitutions.length && state.phase !== 'period-end') whistle(state, state.freeThrows ? 'free-throws' : 'whistle');
}
function grantTimeout(state: MatchState, side: Side): void {
  const used = state.timeoutUsage[side];
  if (state.period <= 2) used.firstHalf += 1; else if (state.period > 4) used.overtime += 1;
  else { used.secondHalf += 1; if (state.period === 4 && state.clockSeconds <= 120) used.lateFourth += 1; }
  state.timeoutRequested[side] = false; recovery(state, 1.5); whistle(state, 'timeout');
  emit(state, { type: 'timeout', side, text: `${state[side].name} take a timeout. ${remainingTimeouts(state, side)} remaining in this allowance.` });
}
function serviceStoppage(state: MatchState): void {
  if (!state.stoppage || state.status === 'finished') return;
  resolveEligibility(state);
  if (state.result) return;
  const rotated = new Set<Side>();
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    const first = state.stoppage!.reason === 'made-basket' ? [state.possession, other(state.possession)] : [...SIDES];
    for (const side of first) for (const request of [...state.pendingSubstitutions[side]]) {
      if (!state.lineups[side].includes(request.outId) || state.lineups[side].includes(request.inId) || !isPlayerEligible(state, request.inId)) {
        state.pendingSubstitutions[side] = state.pendingSubstitutions[side].filter(r => r.outId !== request.outId);
        pruneCircles(state);
        emit(state, { type: 'command', side, text: 'A queued substitution is cancelled because the lineup or eligibility changed.' }); changed = true; continue;
      }
      const mandatory = !isPlayerEligible(state, request.outId);
      if (!canSubstituteNow(state, side, request.outId) || !mandatory && state.substitutionLocks.includes(request.inId)) continue;
      applySubstitution(state, side, request.outId, request.inId, mandatory);
      state.pendingSubstitutions[side] = state.pendingSubstitutions[side].filter(r => r.outId !== request.outId);
      if (state.stoppage!.reason === 'made-basket') whistle(state);
      changed = true;
    }
    resolveEligibility(state);
    if (state.result || state.requiredSubstitutions.length) return;
    // Mandatory excluded/injured-player replacement precedes granting any timeout.
    for (const side of SIDES) {
      if (state.timeoutRequested[side] && state.stoppage!.timeoutSides.includes(side) && state.stepCount > 0 && state.clockSeconds > 0) {
        if (remainingTimeouts(state, side) > 0) grantTimeout(state, side);
        else { state.timeoutRequested[side] = false; emit(state, { type: 'command', side, text: 'The queued timeout has no remaining allowance and is cancelled.' }); }
        changed = true;
      }
    }
    for (const side of SIDES) {
      if (state.engineVersion === 'rules-2') { if (legacyRotation(state, side, rotated)) changed = true; continue; }
      // The prepared starting five plays the tip; the rotation starts once the clock has run.
      if (rotated.has(side) || !state.autoSubstitutions[side] || !canSubstituteNow(state, side) || state.stepCount === 0) continue;
      const swaps = automaticSwaps(state, side);
      if (!swaps.length) continue;
      for (const [out, incoming] of swaps) applySubstitution(state, side, out.id, incoming.id);
      rotated.add(side); changed = true;
      if (state.stoppage!.reason === 'made-basket') whistle(state);
    }
    if (!changed) return;
  }
}
/** The legacy exhibition engine's condition-first rotation, unchanged: one change per stoppage. */
function legacyRotation(state: MatchState, side: Side, rotated: Set<Side>): boolean {
  if (rotated.has(side) || !state.autoSubstitutions[side] || !canSubstituteNow(state, side)) return false;
  const foulLimit = state.period === 1 ? 2 : state.period === 2 ? 3 : 4;
  const priority = (p: Player) => state.stats[p.id]!.condition - (state.stats[p.id]!.fouls >= foulLimit ? 35 : 0);
  const tired = activePlayers(state, side).filter(p => !state.substitutionLocks.includes(p.id) && state.freeThrows?.shooterId !== p.id).sort((a, b) => priority(a) - priority(b))[0];
  if (!tired) return false; const incoming = bestReplacement(state, side, tired);
  const current = state.stats[tired.id]!;
  const reserve = incoming ? state.stats[incoming.id]! : null;
  const needsRest = reserve && current.condition < 85 && reserve.condition >= current.condition + 7;
  const foulTrouble = reserve && current.fouls >= foulLimit && reserve.fouls < current.fouls && reserve.condition >= current.condition - 3;
  if (!incoming || state.substitutionLocks.includes(incoming.id) || !(needsRest || foulTrouble)) return false;
  applySubstitution(state, side, tired.id, incoming.id); rotated.add(side);
  if (state.stoppage!.reason === 'made-basket') whistle(state);
  return true;
}
/** Players with three or four fouls defend more carefully (calibration.ts, DEFENDER_ROLES.caution). */
function foulCaution(state: MatchState, p: Player): number { const fouls = state.stats[p.id]!.fouls; return fouls >= 4 ? DEFENDER_ROLES.caution[4] : fouls === 3 ? DEFENDER_ROLES.caution[3] : 1; }
function personalFoul(state: MatchState, side: Side, offender: Player, text: string): void {
  state.stats[offender.id]!.fouls += 1; state.teamFouls[side] += 1;
  emit(state, { type: 'foul', side, playerId: offender.id, text });
  if (state.stats[offender.id]!.fouls === 5) emit(state, { type: 'foul-out', side, playerId: offender.id, text: `${offender.name} is excluded after five personal fouls.` });
}
/** A player's injury hazard relative to the base rate: late-game minutes and his earlier injuries (recurrence). */
function injuryExposure(state: MatchState, id: string): number {
  return (state.stats[id]!.secondsPlayed > INJURY_LATE_MINUTES_SECONDS ? INJURY_LATE_MINUTES_FACTOR : 1) * injuryRiskTotal(state.injuryRisk?.[id]);
}
function sampleInjuries(state: MatchState, seconds: number): void {
  if (state.injuryMode === 'off' || seconds <= 0 || state.clockSeconds === 0 && !state.freeThrows) return;
  const multiplier = state.injuryMode === 'reduced' ? REDUCED_INJURY_FACTOR : 1;
  for (const side of SIDES) {
    const exposed = activePlayers(state, side).filter(p => isPlayerEligible(state, p.id));
    const exposure = exposed.reduce((sum, p) => sum + injuryExposure(state, p.id), 0);
    const chance = 1 - Math.exp(-INJURY_HAZARD_PER_PLAYER_SECOND * seconds * exposure * multiplier);
    if (draw(state) >= chance || !exposed.length) continue;
    // Fatigue decides which exposed player is hurt; it does not change the team's rate.
    const injured = choose(state, exposed, p => injuryExposure(state, p.id) * (1 + (100 - state.stats[p.id]!.condition) / 100)), kind = pickInjuryKind(draw(state), state.injuryRisk?.[injured.id]);
    state.injuries[injured.id] = { kind, occurredAtSeconds: elapsed(state) };
    emit(state, { type: 'injury', side, playerId: injured.id, text: `${injured.name} leaves with ${injuryPhrase(kind)} and cannot return in this ${state.engineVersion === 'rules-2' ? 'exhibition' : 'match'}.` });
    if (!state.freeThrows && side !== state.possession) state.shotClockSeconds = defensiveFoulShotClock(state.shotClockSeconds, state.frontcourt);
    whistle(state, state.freeThrows ? 'free-throws' : 'whistle');
  }
}
function rebound(state: MatchState, offense: Side, rimContact = true): void {
  const attackers = activePlayers(state, offense).filter(p => isPlayerEligible(state, p.id)), defenders = activePlayers(state, other(offense)).filter(p => isPlayerEligible(state, p.id));
  const offensiveChance = clamp(0.24 + (mean(attackers, 'rebounding') - mean(defenders, 'rebounding')) * 0.012 + (attackers.length - defenders.length) * 0.04, 0.05, 0.45);
  const offensive = draw(state) < offensiveChance, side = offensive ? offense : other(offense), rebounder = choose(state, offensive ? attackers : defenders, p => p.attributes.rebounding ** 1.5);
  state.stats[rebounder.id]!.rebounds += 1; resetPossession(state, side, offensive ? (rimContact ? 14 : state.shotClockSeconds) : 24); state.frontcourt = offensive; state.phase = 'live-ball'; state.stoppage = null;
  emit(state, { type: 'rebound', side, playerId: rebounder.id, text: `${rebounder.name} collects the ${offensive ? 'offensive' : 'defensive'} rebound. Shot clock: ${state.shotClockSeconds}.`, scene: reboundScene(state, offense, rebounder.id) });
}
function shotLocation(state: MatchState, side: Side, three: boolean, random: number): { x: number; y: number } {
  const radius = three ? 7 + random * 0.3 : 1 + random * 4, angle = -1.1 + random * 2.2, direction = attackingDirection(state, side), hoop = direction === 1 ? 26.425 : 1.575;
  return { x: (hoop - direction * radius * Math.cos(angle)) / 28, y: (7.5 + radius * Math.sin(angle)) / 15 };
}
function creditAssist(state: MatchState, shooter: Player, teammates: Player[]): Player | undefined {
  if (teammates.length > 1 && draw(state) < clamp(0.48 + (mean(teammates, 'passing') - 10) * 0.015, 0.3, 0.75)) {
    const passer = choose(state, teammates.filter(p => p.id !== shooter.id), p => p.attributes.passing); state.stats[passer.id]!.assists += 1;
    return passer;
  }
  return undefined;
}
function startFreeThrows(state: MatchState, side: Side, shooter: Player, total: 1 | 2 | 3): void { state.freeThrows = { side, shooterId: shooter.id, total, remaining: total }; whistle(state, 'free-throws'); }
function finishPeriod(state: MatchState): void {
  if (state.clockSeconds !== 0 || state.freeThrows || state.phase === 'period-end' || state.status === 'finished') return;
  clearPossessionPlay(state); state.phase = 'period-end'; state.shotClockSeconds = 0;
  state.stoppage = { reason: 'period-end', substitutionSides: ['home', 'away'], timeoutSides: [] }; state.timeoutRequested = { home: false, away: false };
  emit(state, { type: 'period-end', text: state.period <= 4 ? `End of quarter ${state.period}.` : `End of overtime ${state.period - 4}.` });
  if (state.period >= 4 && state.score.home !== state.score.away) {
    const winner = state.score.home > state.score.away ? 'home' : 'away'; state.status = 'finished'; state.result = { winner, kind: 'normal', officialScore: { ...state.score } }; clearCommands(state);
    for (const side of SIDES) state.lineups[side] = state.lineups[side].filter(id => isPlayerEligible(state, id));
    pruneCircles(state);
    emit(state, { type: 'final', side: winner, text: `${state[winner].name} win ${state.score[winner]}–${state.score[other(winner)]}.` });
  }
}
function resolveFreeThrow(state: MatchState): void {
  const sequence = state.freeThrows!, shooter = player(state, sequence.side, sequence.shooterId), stats = state.stats[shooter.id]!;
  if (!isPlayerEligible(state, shooter.id)) throw new Error('Replace the ineligible free-throw shooter first.');
  const location = freeThrowPosition(state, sequence.side);
  emit(state, { type: 'command', side: sequence.side, playerId: shooter.id, text: `${shooter.name} sets at the free-throw line.`, scene: setupScene(state, sequence.side, shooter.id, location, true) });
  const made = draw(state) < clamp(0.45 + shooter.attributes.freeThrow * 0.025 - (100 - stats.condition) / 100 * 0.021, 0.4, 0.95);
  stats.freeThrowsAttempted += 1; if (made) { stats.freeThrowsMade += 1; creditPoints(state, sequence.side, shooter, 1); }
  const index = sequence.total - sequence.remaining + 1;
  emit(state, { type: 'free-throw', side: sequence.side, playerId: shooter.id, text: `${shooter.name} ${made ? 'makes' : 'misses'} free throw ${index} of ${sequence.total}.`, scene: shotScene(state, sequence.side, shooter.id, location, made, undefined, true) });
  sequence.remaining -= 1; state.stoppage = null;
  if (sequence.remaining > 0) return;
  state.freeThrows = null;
  if (state.clockSeconds === 0) { finishPeriod(state); return; }
  if (made) { resetPossession(state, other(sequence.side)); whistle(state); } else rebound(state, sequence.side);
}
function resolveAction(state: MatchState): void {
  const offense = state.possession, defense = other(offense), attackers = activePlayers(state, offense), defenders = activePlayers(state, defense);
  const tactics = state.tactics[offense], pressure = state.tactics[defense].pressure;
  const setup = !state.frontcourt && state.shotClockSeconds > 14 && draw(state) < 0.22;
  let proposed = setup ? 4 : clamp(Math.round(19 - tactics.tempo * 10 + (draw(state) - 0.5) * 10), 3, 24);
  const deadlinePressure = proposed >= state.shotClockSeconds;
  // Players react to the remaining clock; an offensive rebound does not start
  // a fresh 24-second plan. A bounded execution failure still permits violations.
  if (deadlinePressure && state.shotClockSeconds > 1 && draw(state) < 0.96) proposed = state.shotClockSeconds - 1;
  const shotClockExpired = proposed >= state.shotClockSeconds && state.shotClockSeconds < state.clockSeconds;
  const seconds = Math.min(state.clockSeconds, state.shotClockSeconds, proposed);
  if (seconds <= 0) throw new Error('A live action must have time on both clocks.');
  exposure(state, seconds); state.clockSeconds -= seconds; state.shotClockSeconds -= seconds; state.stepCount += 1; state.phase = 'live-ball'; state.stoppage = null;
  const shooter = choose(state, attackers, p => p.attributes.twoPoint * (1 - tactics.outsideShare) + p.attributes.threePoint * tactics.outsideShare), stats = state.stats[shooter.id]!;
  if (shotClockExpired) {
    emit(state, { type: 'command', side: offense, playerId: shooter.id, text: `${shooter.name} controls the ball as the shot clock runs down.`, scene: setupScene(state, offense, shooter.id) });
    stats.turnovers += 1; resetPossession(state, defense); whistle(state);
    emit(state, { type: 'shot-clock', side: offense, playerId: shooter.id, text: `${state[offense].name} fail to release a shot before the shot-clock signal. Turnover.`, scene: turnoverScene(state, offense, shooter.id) });
  } else if (setup && state.clockSeconds > 0) {
    state.frontcourt = true; emit(state, { type: 'command', side: offense, playerId: shooter.id, text: `${state[offense].name} bring the ball into the frontcourt. ${state.shotClockSeconds} on the shot clock.`, scene: setupScene(state, offense, shooter.id) });
  } else {
    state.frontcourt = true;
    const turnoverChance = clamp(0.065 + pressure * 0.075 + (12 - shooter.attributes.passing) * 0.004, 0.035, 0.24), roll = draw(state);
    if (roll < turnoverChance) {
      stats.turnovers += 1;
      const defender = choose(state, defenders, p => p.attributes.defense), stolen = draw(state) < 0.65;
      if (stolen) state.stats[defender.id]!.steals += 1;
      emit(state, { type: 'command', side: offense, playerId: shooter.id, text: `${shooter.name} brings the ball forward.`, scene: setupScene(state, offense, shooter.id) });
      resetPossession(state, defense); if (!stolen) whistle(state);
      emit(state, { type: 'turnover', side: offense, playerId: shooter.id, text: stolen ? `${defender.name} steals the ball from ${shooter.name}.` : `${shooter.name} loses the ball out of bounds.`, scene: turnoverScene(state, offense, shooter.id, stolen ? defender.id : undefined, !stolen) });
    } else if (roll < turnoverChance + 0.025) {
      personalFoul(state, offense, shooter, `${shooter.name} commits a team-control offensive foul. No free throws.`);
      stats.turnovers += 1; resetPossession(state, defense); whistle(state);
    } else if (roll < turnoverChance + 0.065 + pressure * 0.045) {
      const defender = choose(state, defenders, p => p.attributes.defense);
      personalFoul(state, defense, defender, `${defender.name} commits a non-shooting defensive foul on ${shooter.name}.`);
      if (state.teamFouls[defense] >= 5) startFreeThrows(state, offense, shooter, 2);
      else { state.shotClockSeconds = defensiveFoulShotClock(state.shotClockSeconds, state.frontcourt); whistle(state); }
    } else if (roll < turnoverChance + 0.075 + pressure * 0.045) {
      const receiving = state.possessionArrow; state.possessionArrow = other(state.possessionArrow);
      if (receiving !== offense) resetPossession(state, receiving); else state.possession = receiving;
      whistle(state);
      emit(state, { type: 'held-ball', side: state.possession, text: `Held ball. The possession arrow awards the throw-in to ${state[state.possession].name}.` });
    } else resolveShot(state, offense, shooter, attackers, defenders, deadlinePressure || seconds < proposed);
  }
  sampleInjuries(state, seconds); finishPeriod(state); resolveEligibility(state);
}
function resolveShot(state: MatchState, offense: Side, shooter: Player, attackers: Player[], defenders: Player[], rushed: boolean): void {
  const defense = other(offense), tactics = state.tactics[offense], stats = state.stats[shooter.id]!;
  const three = draw(state) < clamp(0.08 + tactics.outsideShare * 0.76 + (shooter.attributes.threePoint - 12) * 0.025, 0.03, 0.92);
  const value: 2 | 3 = three ? 3 : 2, skill = three ? shooter.attributes.threePoint : shooter.attributes.twoPoint, fatigue = (100 - stats.condition) / 100 * 0.07;
  const makeChance = clamp((three ? 0.19 : 0.35) + skill * (three ? 0.013 : 0.015) - (mean(defenders, 'defense') - 12) * 0.008 - fatigue - (rushed ? 0.12 : 0) + (attackers.length - defenders.length) * 0.04, 0.08, three ? 0.65 : 0.82);
  const defender = choose(state, defenders, p => p.attributes.defense), fouled = draw(state) < 0.075 + state.tactics[defense].pressure * 0.07 + (three ? 0 : 0.02);
  const blocked = !fouled && draw(state) < 0.015 + defender.attributes.defense * 0.0015, made = !blocked && draw(state) < makeChance * (fouled ? 0.65 : 1), location = shotLocation(state, offense, three, draw(state));
  // The assist decision uses precisely the pre-existing draws, before any score is
  // credited. Its authored pass can therefore be played before the made basket.
  const passer = made ? creditAssist(state, shooter, attackers) : undefined;
  const handler = passer ?? shooter;
  emit(state, { type: 'command', side: offense, playerId: handler.id, text: `${handler.name} ${passer ? 'organizes the attack' : 'moves into shooting position'}.`, scene: setupScene(state, offense, handler.id, passer ? undefined : location) });
  if (passer) emit(state, { type: 'pass', side: offense, playerId: passer.id, receiverId: shooter.id, text: `${passer.name} finds ${shooter.name} with the pass.`, scene: passScene(state, offense, passer.id, shooter.id, location) });
  if (fouled) personalFoul(state, defense, defender, `${defender.name} fouls ${shooter.name} on the shot.`);
  if (!fouled || made) {
    stats.fieldGoalsAttempted += 1; if (three) stats.threePointersAttempted += 1;
    if (made) { stats.fieldGoalsMade += 1; if (three) stats.threePointersMade += 1; creditPoints(state, offense, shooter, value); }
    if (blocked) state.stats[defender.id]!.blocks += 1;
    emit(state, { type: 'shot', side: offense, playerId: shooter.id, text: blocked ? `${defender.name} blocks ${shooter.name}.` : `${shooter.name} ${made ? 'makes' : 'misses'} a ${three ? 'three-pointer' : 'two-point shot'}${state.clockSeconds === 0 ? ' released before the period horn' : ''}.`, shot: { ...location, made, value }, scene: shotScene(state, offense, shooter.id, location, made, blocked ? defender.id : undefined) });
  }
  if (fouled) startFreeThrows(state, offense, shooter, made ? 1 : value); else if (made) madeBasketWindow(state, offense); else if (state.clockSeconds > 0) rebound(state, offense, !blocked);
}
const ballAt = (point: CourtPoint, height = 1.25) => ({ x: point.x, y: point.y, height });
function settledScene(play: PossessionPlay): CourtScene {
  const ball = ballAt(positionOf(play, play.handlerId));
  return actionScene('setup', play.offense, play.positions, play.positions, ball, ball);
}
/** Only animation starts may consult prior scenes. Sporting positions never do. */
function visualStart(state: MatchState, fallback: CourtPosition[]): CourtPosition[] {
  let previous: CourtPosition[] | undefined;
  for (let index = state.events.length - 1; index >= 0; index -= 1) if (state.events[index]!.scene) { previous = state.events[index]!.scene!.end; break; }
  return fallback.map(point => ({ ...(previous?.find(p => p.playerId === point.playerId) ?? point) }));
}
function visualBallStart(state: MatchState, fallback: CourtPoint): ReturnType<typeof ballAt> {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const scene = state.events[index]!.scene;
    if (scene) return { ...scene.ball.to };
  }
  return ballAt(fallback);
}
function lineupScene(state: MatchState, outId?: string, inId?: string): CourtScene {
  const old = state.possessionPlay, play = createPossessionPlay(state, old?.handlerId === outId ? inId : old?.handlerId);
  play.positions = play.positions.map(point => ({ ...(old?.positions.find(p => p.playerId === point.playerId) ?? point) }));
  if (old && outId && inId) {
    const outgoing = old.positions.find(point => point.playerId === outId), incoming = play.positions.find(point => point.playerId === inId);
    if (outgoing && incoming) { incoming.x = outgoing.x; incoming.y = outgoing.y; }
  }
  state.possessionPlay = state.freeThrows || state.phase === 'period-end' || state.requiredSubstitutions.length ? null : play;
  return actionScene('setup', play.offense, visualStart(state, play.positions), play.positions, visualBallStart(state, positionOf(play, play.handlerId)), ballAt(positionOf(play, play.handlerId)));
}
function installControl(state: MatchState, side: Side, handlerId: string, positions: CourtPosition[], frontcourt: boolean, clock = 24): void {
  resetPossession(state, side, clock); state.frontcourt = frontcourt;
  state.possessionPlay = createPossessionPlay(state, handlerId);
  state.possessionPlay.positions = positions.map(point => ({ ...point }));
  state.phase = 'live-ball'; state.stoppage = null;
}
function possessionTurnover(state: MatchState, play: PossessionPlay, shotClock = false): void {
  const offense = play.offense, defense = other(offense), handler = player(state, offense, play.handlerId), defender = matchedDefender(state, play);
  const stolen = !shotClock && draw(state) < TURNOVERS.stealShare;
  state.stats[handler.id]!.turnovers += 1;
  if (stolen) state.stats[defender.id]!.steals += 1;
  const from = ballAt(positionOf(play, handler.id)), to = stolen ? ballAt(positionOf(play, defender.id)) : { ...from, y: from.y < .5 ? 0 : 1, height: .2 };
  installControl(state, defense, defender.id, play.positions, false);
  if (!stolen) whistle(state);
  emit(state, { type: shotClock ? 'shot-clock' : 'turnover', side: offense, playerId: handler.id,
    text: shotClock ? `${state[offense].name} fail to release a shot before the shot-clock signal. Turnover.` : stolen ? `${defender.name} steals the ball from ${handler.name}.` : `${handler.name} loses the ball out of bounds.`,
    scene: actionScene('turnover', offense, play.positions, play.positions, from, to, .1) });
}
function possessionRebound(state: MatchState, play: PossessionPlay, landing: CourtPoint, rimContact = true): void {
  const offense = play.offense, defense = other(offense), attackers = activePlayers(state, offense), defenders = activePlayers(state, defense);
  const proximity = (candidate: Player) => 1 / (1 + courtDistance(positionOf(play, candidate.id), landing) * .2);
  const strength = (players: Player[]) => players.reduce((total, p) => total + p.attributes.rebounding * proximity(p), 0) / Math.max(1, players.length);
  if (draw(state) < TEAM_REBOUND_SHARE) {
    // Out of bounds: a team rebound, credited to no player, and a throw-in (in the frontcourt for the attack).
    const offensive = draw(state) < TEAM_REBOUND_OFFENSIVE_SHARE, side = offensive ? offense : defense;
    resetPossession(state, side, offensive ? rimContact ? 14 : defensiveFoulShotClock(state.shotClockSeconds, true) : 24); state.frontcourt = offensive; whistle(state);
    emit(state, { type: 'command', side, text: `The rebound goes out of bounds off ${offensive ? 'a defender' : 'an attacker'}: team rebound, ${state[side].name} ${offensive ? 'keep' : 'take'} possession.` });
    return;
  }
  const offensive = draw(state) < clamp(REBOUNDS.offensiveBase + (strength(attackers) - strength(defenders)) * REBOUNDS.strength + (attackers.length - defenders.length) * REBOUNDS.numbers, REBOUNDS.min, REBOUNDS.max);
  const side = offensive ? offense : defense;
  const rebounder = choose(state, offensive ? attackers : defenders, p => p.attributes.rebounding * proximity(p));
  const positions = play.positions.map(point => point.playerId === rebounder.id ? { ...point, ...landing } : { ...point });
  state.stats[rebounder.id]!.rebounds += 1;
  installControl(state, side, rebounder.id, positions, offensive, offensive ? rimContact ? 14 : state.shotClockSeconds : 24);
  emit(state, { type: 'rebound', side, playerId: rebounder.id, text: `${rebounder.name} collects the ${offensive ? 'offensive' : 'defensive'} rebound.`,
    scene: actionScene('rebound', offense, play.positions, positions, ballAt(landing, .45), ballAt(landing), .12) });
}
function resolvePossessionShot(state: MatchState, play: PossessionPlay, rushed: boolean): void {
  const offense = play.offense, defense = other(offense), shooter = player(state, offense, play.handlerId), stats = state.stats[shooter.id]!;
  const context = shotContext(state, play), defender = matchedDefender(state, play), three = context.value === 3;
  const fouled = draw(state) < clamp(SHOOTING_FOULS.base + state.tactics[defense].pressure * SHOOTING_FOULS.pressure + (three ? 0 : SHOOTING_FOULS.twoPoint) - Math.max(0, context.separationM - 1.5) * SHOOTING_FOULS.separation, SHOOTING_FOULS.min, SHOOTING_FOULS.max);
  // Inside, help defenders (mostly bigs) foul and block as well as the shooter's own defender; threes stay with him.
  const defenders = activePlayers(state, defense), helper = (weights: Readonly<Record<Player['position'], number>>, matched: number, careful: boolean) => three ? defender : choose(state, defenders, p => weights[p.position] * (p.id === defender.id ? matched : 1) * (careful ? foulCaution(state, p) : 1));
  const fouler = fouled ? helper(DEFENDER_ROLES.foul, DEFENDER_ROLES.matchedFoul, true) : defender, blocker = fouled ? defender : helper(DEFENDER_ROLES.block, DEFENDER_ROLES.matchedBlock, false);
  const blockChance = clamp(BLOCKS.base + blocker.attributes.defense * BLOCKS.defense + Math.max(0, blocker.heightCm - shooter.heightCm) * BLOCKS.height - Math.max(0, context.separationM - .75) * BLOCKS.separation, BLOCKS.min, BLOCKS.max) * (three ? BLOCKS.threeFactor : 1);
  const blocked = !fouled && draw(state) < blockChance;
  const made = !blocked && draw(state) < context.makeChance * (fouled ? SHOT_MAKING.andOne : 1) - (rushed ? SHOT_MAKING.rushed : 0);
  const origin = positionOf(play, shooter.id), hoop = basketPoint(state, offense);
  const landing: CourtPoint = made ? hoop : { x: clamp(hoop.x - attackingDirection(state, offense) * (.5 + draw(state) * 1.4) / 28, .025, .975), y: clamp(.5 + (draw(state) - .5) * .22, .08, .92) };
  // A final completed pass is credited only if no whistle or control change
  // intervened (the receiver's own drive keeps it). It exists before this attempt's outcome is sampled.
  const passerId = made ? play.passerId : null;
  if (!fouled || made) {
    stats.fieldGoalsAttempted += 1; if (three) stats.threePointersAttempted += 1;
    if (made) { stats.fieldGoalsMade += 1; if (three) stats.threePointersMade += 1; creditPoints(state, offense, shooter, context.value); }
    if (blocked) state.stats[blocker.id]!.blocks += 1;
    if (passerId) state.stats[passerId]!.assists += 1;
    emit(state, { type: 'shot', side: offense, playerId: shooter.id, ...(passerId ? { assistPlayerId: passerId } : {}),
      text: blocked ? `${blocker.name} blocks ${shooter.name}.` : `${shooter.name} ${made ? 'makes' : 'misses'} ${context.contest === 'open' ? 'an open' : `a ${context.contest}`} ${three ? 'three-pointer' : 'two-point shot'}${state.clockSeconds === 0 ? ' released before the period horn' : ''}.`,
      shot: { x: origin.x, y: origin.y, made, value: context.value, defenderId: context.defenderId, contest: context.contest, distanceM: context.distanceM },
      scene: actionScene('shot', offense, play.positions, play.positions, ballAt(origin, 2.1), ballAt(landing, made ? 3.05 : .45), made ? 3.1 : 2.8) });
  }
  if (fouled) { personalFoul(state, defense, fouler, `${fouler.name} fouls ${shooter.name} on the shot.`); startFreeThrows(state, offense, shooter, made ? 1 : context.value); }
  else if (made) madeBasketWindow(state, offense);
  else if (state.clockSeconds > 0) possessionRebound(state, play, landing, !blocked);
}
function resolvePossessionAction(state: MatchState): void {
  const restarted = !state.possessionPlay;
  const play = state.possessionPlay ?? createPossessionPlay(state); state.possessionPlay = play;
  const offense = play.offense, defense = other(offense), handler = player(state, offense, play.handlerId), defender = matchedDefender(state, play);
  const tactics = state.tactics[offense], pressure = state.tactics[defense].pressure;
  const distance = courtDistance(positionOf(play, handler.id), basketPoint(state, offense));
  let action: 'advance' | 'pass' | 'drive' | 'shot';
  // The last possession of the fourth quarter or an overtime, tied or down by three or less: the attack holds the ball
  // for a last shot, a three when down three. Decided from the score and clocks, without a random draw.
  const lead = state.score[offense] - state.score[defense];
  const lastShot = state.period >= 4 && state.frontcourt && !restarted && state.clockSeconds <= state.shotClockSeconds + LATE_GAME.shotClockGrace && lead <= 0 && lead >= -LATE_GAME.maxDeficit;
  const threeNeeded = lastShot && lead === -3, holdFor = Math.min(state.clockSeconds, state.shotClockSeconds);
  // Late in a close game a defense that trails fouls at once to stop the clock.
  const stopClock = state.period >= 4 && state.clockSeconds <= LATE_GAME.foulSeconds && lead >= 1 && lead <= LATE_GAME.foulMaxLead;
  if (restarted || !state.frontcourt) action = 'advance';
  else if (lastShot) action = holdFor > LATE_GAME.shootAt || threeNeeded && distance < 6.75 && holdFor > 1 ? 'pass' : 'shot';
  // Leave room to release after the longer creation windows. A new pass or
  // drive with only a few seconds left should not routinely strand the ball.
  else if (state.shotClockSeconds <= 8 || play.actions >= 4) action = 'shot';
  else {
    const roll = draw(state), shootChance = distance < 4.5 ? SHOT_SELECTION.closeRange : clamp(SHOT_SELECTION.base + (play.actions - 1) * SHOT_SELECTION.perAction + tactics.outsideShare * SHOT_SELECTION.outsideShare, SHOT_SELECTION.base, SHOT_SELECTION.max);
    const passShare = clamp(SHOT_SELECTION.passBase - (play.actions - 1) * SHOT_SELECTION.passDecay + tactics.outsideShare * SHOT_SELECTION.passOutside, .15, .9);
    action = roll < shootChance ? 'shot' : roll < shootChance + (1 - shootChance) * passShare ? 'pass' : 'drive';
  }
  // Include organizing, reading the defense and executing each action. Tempo
  // changes these windows modestly; animation duration is unrelated to them.
  // A throw-in in the frontcourt (after a foul or a team rebound) is set up faster than bringing the ball up.
  const actionSeconds = action === 'advance' && state.frontcourt ? ACTION_SECONDS.frontcourtInbound : ACTION_SECONDS[action];
  let proposed = clamp(Math.round(actionSeconds + (.5 - tactics.tempo) + (draw(state) - .5) * 2), 1, action === 'advance' ? 8 : 7);
  const rushed = action === 'shot' && state.shotClockSeconds <= 5;
  if (action === 'shot' && state.shotClockSeconds <= 8 && state.shotClockSeconds > 1) proposed = Math.min(proposed, state.shotClockSeconds - 1);
  if (lastShot && action === 'pass') proposed = Math.max(1, Math.min(proposed, holdFor - 1));
  if (stopClock) proposed = Math.min(proposed, LATE_GAME.foulDelay);
  // A shot with the game clock running out is released at the horn rather than stranded.
  if (action === 'shot' && proposed > state.clockSeconds && state.clockSeconds <= state.shotClockSeconds) proposed = state.clockSeconds;
  const shotClockExpired = proposed >= state.shotClockSeconds && state.shotClockSeconds < state.clockSeconds;
  const seconds = Math.min(state.clockSeconds, state.shotClockSeconds, proposed);
  if (seconds <= 0) throw new Error('A live action must have time on both clocks.');
  exposure(state, seconds); state.clockSeconds -= seconds; state.shotClockSeconds -= seconds; state.stepCount += 1; state.phase = 'live-ball'; state.stoppage = null;
  if (shotClockExpired) possessionTurnover(state, play, true);
  else if (seconds < proposed || state.clockSeconds === 0 && action !== 'shot') {
    emit(state, { type: 'command', side: offense, playerId: handler.id, text: `The period horn interrupts ${handler.name}'s ${action === 'advance' ? 'advance' : action === 'shot' ? 'shot preparation' : action}.`, scene: settledScene(play) });
  } else {
    // Every action can end in a turnover or a whistle (the advance: backcourt pressure); the rates are calibrated.
    const fatigue = (100 - state.stats[handler.id]!.condition) / 100;
    const turnoverChance = clamp(TURNOVERS[action] + pressure * TURNOVERS.pressure + (defender.attributes.defense - handler.attributes.passing) * TURNOVERS.skillGap + fatigue * TURNOVERS.fatigue + moraleTurnoverAdjustment(state, handler.id), .006, TURNOVERS.max);
    const offensiveFoul = action === 'advance' ? 0 : TURNOVERS.offensiveFoul, heldBall = action === 'advance' ? 0 : .004;
    const foulChance = stopClock ? 1 : DEFENSIVE_FOULS[action] + pressure * DEFENSIVE_FOULS.pressure;
    const roll = draw(state);
    if (roll < turnoverChance) possessionTurnover(state, play);
    else if (roll < turnoverChance + offensiveFoul) {
      personalFoul(state, offense, handler, `${handler.name} commits a team-control offensive foul. No free throws.`);
      state.stats[handler.id]!.turnovers += 1; resetPossession(state, defense); whistle(state);
    } else if (roll < turnoverChance + offensiveFoul + foulChance) {
      // Off the ball, screens and boxing out spread these fouls over the defense, mostly to its bigs.
      const fouler = stopClock ? defender : choose(state, activePlayers(state, defense), p => DEFENDER_ROLES.foul[p.position] * (p.id === defender.id ? DEFENDER_ROLES.matchedFoul : 1) * foulCaution(state, p));
      personalFoul(state, defense, fouler, stopClock ? `${fouler.name} fouls ${handler.name} to stop the clock.` : `${fouler.name} commits a non-shooting defensive foul on ${handler.name}.`);
      if (state.teamFouls[defense] >= 5) startFreeThrows(state, offense, handler, 2);
      else { state.shotClockSeconds = defensiveFoulShotClock(state.shotClockSeconds, state.frontcourt); whistle(state); }
    } else if (roll < turnoverChance + offensiveFoul + foulChance + heldBall) {
      const receiving = state.possessionArrow; state.possessionArrow = other(receiving);
      if (receiving !== offense) resetPossession(state, receiving);
      whistle(state); emit(state, { type: 'held-ball', side: receiving, text: `Held ball. The possession arrow awards the throw-in to ${state[receiving].name}.` });
    } else if (action === 'advance') {
      const start = restarted ? visualStart(state, play.positions) : play.positions;
      // The ball is brought up by the primary handler (a rebounder or a stealing big makes the outlet pass).
      const positions = moveForAction(state, play, 'advance'), carrier = player(state, offense, primaryHandler(state, offense));
      const from = visualBallStart(state, start.find(point => point.playerId === handler.id)!), to = ballAt(positions.find(point => point.playerId === carrier.id)!);
      play.positions = positions; play.handlerId = carrier.id; play.actions += 1; play.passerId = null; state.frontcourt = true;
      emit(state, { type: 'command', side: offense, playerId: carrier.id, text: `${carrier.name} brings ${state[offense].name} into their half-court offense.`, scene: actionScene('setup', offense, start, positions, from, to) });
    } else if (action === 'shot') resolvePossessionShot(state, play, rushed);
    else {
      const receiver = action === 'pass' ? choose(state, activePlayers(state, offense).filter(p => p.id !== handler.id), p => {
        if (threeNeeded) return POSITION_ORDER[p.position] <= 2 ? p.attributes.threePoint ** 2 : .01;
        const rangePreference = tactics.outsideShare * p.attributes.threePoint + (1 - tactics.outsideShare) * p.attributes.twoPoint;
        const rolePreference = p.position === 'PF' || p.position === 'C' ? SHOT_SELECTION.bigReceiver - tactics.outsideShare : SHOT_SELECTION.wingReceiver + tactics.outsideShare;
        const separation = courtDistance(positionOf(play, p.id), positionOf(play, matchedDefender(state, play, p.id).id));
        return rangePreference * rolePreference * clamp(.8 + separation * .15, .8, 1.35);
      }) : handler;
      const start = play.positions, positions = moveForAction(state, play, action, receiver.id, draw(state));
      const from = ballAt(positionOf(play, handler.id)), to = ballAt(positions.find(point => point.playerId === receiver.id)!);
      play.positions = positions; play.handlerId = receiver.id; play.passerId = action === 'pass' ? handler.id : play.passerId; play.actions += 1;
      emit(state, { type: action, side: offense, playerId: handler.id, ...(action === 'pass' ? { receiverId: receiver.id } : {}),
        text: action === 'pass' ? `${handler.name} finds ${receiver.name} with the pass.` : `${handler.name} drives toward the basket.`, scene: actionScene(action, offense, start, positions, from, to, action === 'pass' ? .35 : .08) });
    }
  }
  sampleInjuries(state, seconds); finishPeriod(state); resolveEligibility(state);
}
function resolvePossessionFreeThrow(state: MatchState): void {
  const sequence = state.freeThrows!, shooter = player(state, sequence.side, sequence.shooterId), stats = state.stats[shooter.id]!;
  if (!isPlayerEligible(state, shooter.id)) throw new Error('Replace the ineligible free-throw shooter first.');
  const location = freeThrowPosition(state, sequence.side);
  const positions = possessionFormation(state, sequence.side, true);
  for (const side of SIDES) positions.filter(point => state.lineups[side].includes(point.playerId) && point.playerId !== shooter.id).forEach((point, index) => {
    const x = .87 - Math.floor(index / 2) * .045 - (side === sequence.side ? .02 : 0);
    point.x = attackingDirection(state, sequence.side) === 1 ? x : 1 - x; point.y = index % 2 ? .69 : .31;
  });
  Object.assign(positions.find(point => point.playerId === shooter.id)!, location);
  const play = { ...createPossessionPlay({ ...state, possession: sequence.side }, shooter.id), positions };
  emit(state, { type: 'command', side: sequence.side, playerId: shooter.id, text: `${shooter.name} sets at the free-throw line.`,
    scene: actionScene('setup', sequence.side, visualStart(state, positions), positions, visualBallStart(state, location), ballAt(location)) });
  const made = draw(state) < clamp(.45 + shooter.attributes.freeThrow * .025 - (100 - stats.condition) / 100 * .021, .4, .95);
  stats.freeThrowsAttempted += 1; if (made) { stats.freeThrowsMade += 1; creditPoints(state, sequence.side, shooter, 1); }
  const hoop = basketPoint(state, sequence.side), landing = made ? hoop : { x: hoop.x - attackingDirection(state, sequence.side) / 28, y: .46 + draw(state) * .08 };
  const index = sequence.total - sequence.remaining + 1;
  emit(state, { type: 'free-throw', side: sequence.side, playerId: shooter.id, text: `${shooter.name} ${made ? 'makes' : 'misses'} free throw ${index} of ${sequence.total}.`,
    scene: actionScene('free-throw', sequence.side, positions, positions, ballAt(location, 2.1), ballAt(landing, made ? 3.05 : .45), 2.7) });
  sequence.remaining -= 1; state.stoppage = null;
  if (sequence.remaining > 0) return;
  state.freeThrows = null;
  if (state.clockSeconds === 0) { finishPeriod(state); return; }
  if (made) { resetPossession(state, other(sequence.side)); whistle(state); } else possessionRebound(state, play, landing);
}
function beginPeriod(state: MatchState): void {
  if (state.period >= MAX_MATCH_PERIODS) throw new Error('Simulation stopped after 20 overtimes; no winner was fabricated.');
  state.period += 1; state.clockSeconds = state.period <= 4 ? 600 : 300;
  if (state.period <= 4) state.teamFouls = { home: 0, away: 0 };
  if (state.period > 4) for (const side of SIDES) state.timeoutUsage[side].overtime = 0;
  resetPossession(state, state.possessionArrow); state.possessionArrow = other(state.possessionArrow);
  state.phase = 'dead-ball'; state.stoppage = { reason: 'whistle', substitutionSides: ['home', 'away'], timeoutSides: [] };
  recovery(state, state.period === 3 ? 8 : 3);
  emit(state, { type: 'period-start', text: state.period <= 4 ? `Quarter ${state.period} begins.` : `Overtime ${state.period - 4} begins.` });
}
export interface FixtureMatchOptions {
  morale?: MatchState['morale'];
  lineups?: Partial<Record<Side, readonly string[]>>;
  tactics?: Partial<Record<Side, Tactics>>;
  conditions?: Readonly<Record<string, number>>;
  autoSubstitutions?: Partial<Record<Side, boolean>>;
  injuryMode?: InjuryMode;
  preExistingInjuries?: Readonly<Record<string, InjuryKind>>;
  /** Career fixtures: per-kind risk multipliers from each player's earlier injuries. Omit for normal risk. */
  injuryRisk?: Readonly<Record<string, InjuryRisk>>;
  /**
   * Format 74: the circles the manager chose on the court picture for his planned five. A starter named here plays
   * that circle's position; everyone else plays his listed position.
   */
  slots?: Partial<Record<Side, Readonly<Record<string, Position>>>>;
}

function initializeMatch(seed: number, engineVersion: EngineVersion, home: Team, away: Team, options: FixtureMatchOptions = {}): MatchState {
  if (engineVersion !== 'rules-2' && engineVersion !== 'possession-3') throw new Error('Choose a supported match engine.');
  const state: MatchState = {
    ...(options.morale ? { morale: { ...options.morale, values: { ...options.morale.values } } } : {}),
    schemaVersion: 2, engineVersion, seed, rngState: normalizeSeed(seed), home, away, score: { home: 0, away: 0 },
    period: 1, clockSeconds: 600, status: 'ready', phase: 'dead-ball', possession: 'home', possessionArrow: 'away', shotClockSeconds: 24, frontcourt: false, teamFouls: { home: 0, away: 0 },
    timeoutUsage: { home: { firstHalf: 0, secondHalf: 0, overtime: 0, lateFourth: 0 }, away: { firstHalf: 0, secondHalf: 0, overtime: 0, lateFourth: 0 } },
    timeoutRequested: { home: false, away: false }, pendingSubstitutions: { home: [], away: [] }, requiredSubstitutions: [], freeThrows: null,
    stoppage: { reason: 'pre-game', substitutionSides: ['home', 'away'], timeoutSides: [] }, substitutionLocks: [], autoSubstitutions: { home: false, away: true, ...options.autoSubstitutions }, injuryMode: options.injuryMode ?? 'standard', injuries: {}, courtSeconds: { home: 0, away: 0 }, result: null,
    lineups: { home: [...(options.lineups?.home ?? home.players.slice(0, 5).map(p => p.id))], away: [...(options.lineups?.away ?? away.players.slice(0, 5).map(p => p.id))] },
    tactics: { home: { ...DEFAULT_TACTICS, ...options.tactics?.home }, away: { ...DEFAULT_TACTICS, ...options.tactics?.away } }, stats: Object.fromEntries([...home.players, ...away.players].map(p => [p.id, { ...emptyStats(), condition: options.conditions?.[p.id] ?? 100 }])), events: [], stepCount: 0,
  };
  // Carried health never consumes an injury roll or creates a new injury event.
  // Use roster order for deterministic metadata and reserve selection.
  const unavailable = [...home.players, ...away.players].filter(p => Object.hasOwn(options.preExistingInjuries ?? {}, p.id));
  if (unavailable.length) {
    state.preExistingInjuries = unavailable.map(p => p.id);
    for (const p of unavailable) state.injuries[p.id] = { kind: options.preExistingInjuries![p.id]!, occurredAtSeconds: 0 };
    for (const side of SIDES) state.lineups[side] = [...new Set([...state.lineups[side], ...state[side].players.map(p => p.id)])].filter(id => isPlayerEligible(state, id)).slice(0, 5);
  }
  for (const side of SIDES) {
    const planned = options.slots?.[side];
    const chosen = planned ? Object.fromEntries(state.lineups[side].flatMap(id => planned[id] ? [[id, planned[id]!]] : [])) : {};
    if (Object.keys(chosen).length) state.slots = { ...state.slots, [side]: chosen };
  }
  const risks = Object.entries(options.injuryRisk ?? {}).filter(([, risk]) => Object.keys(risk).length);
  if (risks.length) state.injuryRisk = Object.fromEntries(risks.map(([id, risk]) => [id, { ...risk }]));
  state.possession = draw(state) < 0.5 ? 'home' : 'away'; state.possessionArrow = other(state.possession);
  // The development league retains the existing two-player default threshold.
  // No live action or fabricated court exposure precedes a pre-match default.
  const shortSide = SIDES.find(side => state.lineups[side].length < 2);
  if (shortSide) { finishDefault(state, shortSide); return state; }
  if (engineVersion === 'possession-3') state.possessionPlay = createPossessionPlay(state);
  const scene = state.possessionPlay ? settledScene(state.possessionPlay) : setupScene(state, state.possession, state.lineups[state.possession][0]!);
  emit(state, { type: 'tipoff', side: state.possession, text: `${state[state.possession].name} win the opening tip. FIBA-2024 exhibition rules subset.`, scene }); return state;
}

/** Existing exhibition construction remains stable for both supported engines. */
export function createMatch(seed = 42, engineVersion: EngineVersion = 'possession-3'): MatchState {
  return initializeMatch(seed, engineVersion, FICTIONAL_HOME, FICTIONAL_AWAY);
}

/** A scheduled game starts with fresh match statistics and explicit club preparation. */
export function createFixtureMatch(seed: number, home: Team, away: Team, options: FixtureMatchOptions = {}): MatchState {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('Choose a valid fixture seed.');
  if (home.id === away.id) throw new Error('A fixture must contain two different clubs.');
  const allIds = new Set<string>();
  for (const [side, team] of [['home', home], ['away', away]] as const) {
    if (team.players.length < 5 || team.players.length > 20) throw new Error('A fixture roster must contain five to twenty players.');
    const ownIds = new Set(team.players.map(p => p.id));
    for (const player of team.players) {
      if (allIds.has(player.id)) throw new Error('Every fixture player must have a distinct identity.');
      allIds.add(player.id);
    }
    const lineup = options.lineups?.[side] ?? team.players.slice(0, 5).map(p => p.id);
    if (lineup.length !== 5 || new Set(lineup).size !== 5 || lineup.some(id => !ownIds.has(id))) throw new Error('A starting lineup must contain five distinct players from its club.');
    const tactics = options.tactics?.[side];
    if (tactics && (Object.keys(tactics).length !== 3 || ['tempo', 'outsideShare', 'pressure'].some(key => !Number.isFinite(tactics[key as keyof Tactics]) || tactics[key as keyof Tactics] < 0 || tactics[key as keyof Tactics] > 1))) throw new Error('Fixture tactics must contain three values between zero and one.');
    if (options.autoSubstitutions?.[side] !== undefined && typeof options.autoSubstitutions[side] !== 'boolean') throw new Error('Choose a valid fixture assistant policy.');
  }
  for (const [id, condition] of Object.entries(options.conditions ?? {})) {
    if (!allIds.has(id) || !Number.isFinite(condition) || condition < 0 || condition > 100) throw new Error('Fixture condition must identify its players and stay between zero and one hundred.');
  }
  if (options.morale !== undefined) {
    const morale = options.morale;
    if (!morale || typeof morale !== 'object' || Array.isArray(morale) || Object.keys(morale).length !== 3 || morale.model !== 'morale-1' || !Number.isSafeInteger(morale.eventCount) || morale.eventCount < 1 || morale.eventCount > 1_000_000 || !morale.values || typeof morale.values !== 'object' || Array.isArray(morale.values) || Object.keys(morale.values).length !== allIds.size || [...allIds].some(id => !Object.hasOwn(morale.values, id)) || Object.entries(morale.values).some(([id, value]) => !allIds.has(id) || !Number.isInteger(value) || value < 0 || value > 100)) throw new Error('Fixture morale must retain its prepared relationship history and an assessment from zero to one hundred for every player.');
  }
  if (options.preExistingInjuries !== undefined) {
    if (options.preExistingInjuries === null || typeof options.preExistingInjuries !== 'object' || Array.isArray(options.preExistingInjuries)) throw new Error('Fixture injuries must identify unavailable players.');
    for (const [id, kind] of Object.entries(options.preExistingInjuries)) {
      if (!allIds.has(id) || !isInjuryKind(kind)) throw new Error('Fixture injuries must identify known players and supported injury kinds.');
    }
  }
  if (options.injuryRisk !== undefined) {
    if (options.injuryRisk === null || typeof options.injuryRisk !== 'object' || Array.isArray(options.injuryRisk)) throw new Error('Fixture injury risk must identify players.');
    for (const [id, risk] of Object.entries(options.injuryRisk)) {
      if (!allIds.has(id) || risk === null || typeof risk !== 'object' || Array.isArray(risk) || Object.entries(risk).some(([kind, value]) => !isMatchInjuryKind(kind) || !Number.isFinite(value) || value <= 0 || value > MAX_INJURY_RISK)) throw new Error('Fixture injury risk must identify known players, supported injury kinds and multipliers above zero.');
    }
  }
  if (options.injuryMode !== undefined && !['standard', 'reduced', 'off'].includes(options.injuryMode)) throw new Error('Choose a valid fixture injury setting.');
  if (options.slots !== undefined) {
    if (options.slots === null || typeof options.slots !== 'object' || Array.isArray(options.slots) || Object.keys(options.slots).some(side => side !== 'home' && side !== 'away')) throw new Error('Fixture circles must name a team.');
    for (const [side, circles] of Object.entries(options.slots) as [Side, Readonly<Record<string, Position>> | undefined][]) {
      if (circles === undefined) continue;
      const own = new Set((side === 'home' ? home : away).players.map(p => p.id)), values = Object.values(circles ?? {});
      if (!circles || typeof circles !== 'object' || Array.isArray(circles) || Object.keys(circles).some(id => !own.has(id)) || values.some(value => !isCourtPosition(value)) || new Set(values).size !== values.length) throw new Error('Fixture circles must give players of their own team one different court position each.');
    }
  }
  return initializeMatch(seed, 'possession-3', home, away, options);
}
/** One deterministic live action or free throw; critical decisions stop every playback mode. */
export function stepMatch(state: MatchState): MatchState {
  if (state.status === 'finished') return state;
  assertBoundary(state); const next = copy(state); resolveEligibility(next);
  if (next.status === 'finished') return next;
  serviceStoppage(next); if (next.requiredSubstitutions.length) return next;
  // The circles set before tip-off are kept for the next game (format 74).
  if (next.stepCount === 0 && next.slots && !next.startingSlots) { pruneCircles(next); next.startingSlots = Object.fromEntries(Object.entries(next.slots).map(([side, circles]) => [side, Object.fromEntries(Object.entries(circles).filter(([id]) => next.lineups[side as Side].includes(id)))])); }
  if (next.phase === 'period-end' || next.clockSeconds === 0 && !next.freeThrows) beginPeriod(next);
  next.status = 'playing';
  if (next.freeThrows) { if (next.engineVersion === 'possession-3') resolvePossessionFreeThrow(next); else resolveFreeThrow(next); }
  else { next.stoppage = null; if (next.engineVersion === 'possession-3') resolvePossessionAction(next); else resolveAction(next); }
  if (!next.result) serviceStoppage(next); return next;
}
export function simulateToQuarterEnd(state: MatchState): MatchState {
  if (state.status === 'finished') return state;
  const target = state.phase === 'period-end' ? state.period + 1 : state.period; let next = state;
  for (let steps = 0; steps < MAX_SIMULATION_STEPS; steps += 1) {
    if (next.status === 'finished' || next.requiredSubstitutions.length || next.period === target && next.phase === 'period-end') return next;
    next = stepMatch(next);
  }
  throw new Error('Period simulation exceeded its step limit.');
}
export function simulateToEnd(state: MatchState): MatchState {
  let next = state;
  for (let steps = 0; steps < MAX_SIMULATION_STEPS; steps += 1) { if (next.status === 'finished' || next.requiredSubstitutions.length) return next; next = stepMatch(next); }
  throw new Error('Match simulation exceeded its step limit.');
}
export function setTactics(state: MatchState, side: Side, partial: Partial<Tactics>): MatchState {
  assertSide(side); assertOpen(state); assertBoundary(state);
  for (const [key, value] of Object.entries(partial)) if (!['tempo', 'outsideShare', 'pressure'].includes(key) || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Tactical values must be finite numbers between 0 and 1.');
  const next = copy(state); next.tactics[side] = { ...next.tactics[side], ...partial }; emit(next, { type: 'tactics', side, text: `${next[side].name} change their instructions for the next live action.` }); return next;
}
export function substitutePlayer(state: MatchState, side: Side, outId: string, inId: string): MatchState {
  assertSide(side); assertOpen(state); assertBoundary(state);
  if (!state.lineups[side].includes(outId)) throw new Error('The outgoing player must be on the court.');
  if (!state[side].players.some(p => p.id === inId)) throw new Error('The incoming player must belong to this team.');
  if (state.lineups[side].includes(inId)) throw new Error('The incoming player is already on the court.');
  if (!isPlayerEligible(state, inId)) throw new Error('The incoming player is excluded or injured.');
  if (state.pendingSubstitutions[side].some(r => r.inId === inId && r.outId !== outId)) throw new Error('The incoming player already has a queued substitution.');
  const next = copy(state); next.pendingSubstitutions[side] = next.pendingSubstitutions[side].filter(r => r.outId !== outId); next.pendingSubstitutions[side].push({ outId, inId });
  pruneCircles(next);
  emit(next, { type: 'command', side, text: `${player(next, side, inId).name} is requested for ${player(next, side, outId).name}; changes apply at a legal opportunity.` }); serviceStoppage(next); return next;
}
export function cancelSubstitution(state: MatchState, side: Side, outId: string): MatchState {
  assertSide(side); assertOpen(state); const next = copy(state); next.pendingSubstitutions[side] = next.pendingSubstitutions[side].filter(r => r.outId !== outId);
  pruneCircles(next);
  emit(next, { type: 'command', side, text: 'Queued substitution cancelled.' }); return next;
}
/**
 * Two players on the floor trade places in the five (owner feedback, 16 November 2026). The five's order sets each
 * player's lane and side of the floor; positions and abilities stay the same. Nobody enters or leaves, so, as in
 * real basketball, no stoppage is needed: the change applies from the next action.
 */
export function swapActivePlayers(state: MatchState, side: Side, firstId: string, secondId: string): MatchState {
  assertSide(side); assertOpen(state); assertBoundary(state);
  const first = state.lineups[side].indexOf(firstId), second = state.lineups[side].indexOf(secondId);
  if (first < 0 || second < 0) throw new Error('Both players must be on the court.');
  if (first === second) throw new Error('Choose two different players on the court.');
  const next = copy(state); next.lineups[side][first] = secondId; next.lineups[side][second] = firstId;
  emit(next, { type: 'command', side, text: `${player(next, side, firstId).name} and ${player(next, side, secondId).name} swap places on the floor.` }); return next;
}
/**
 * The court picture (format 74): a player on court is put in a circle and plays that position from the next action
 * (nobody enters or leaves, so no stoppage is needed). The player shown in that circle, if any, takes the mover's
 * circle. Both are then players the manager placed: out of their listed position they play with the penalty.
 */
export function setCourtPosition(state: MatchState, side: Side, playerId: string, position: Position): MatchState {
  assertSide(side); assertOpen(state); assertBoundary(state);
  if (!state.lineups[side].includes(playerId)) throw new Error('The player must be on the court.');
  if (!isCourtPosition(position)) throw new Error('Choose a court position.');
  const shown = courtCircles(state, side);
  if (shown[playerId] === position) return state;
  const occupant = Object.keys(shown).find(id => shown[id] === position);
  const next = copy(state), circles = (next.slots ??= {})[side] ??= {};
  circles[playerId] = position;
  if (occupant) circles[occupant] = shown[playerId]!;
  emit(next, { type: 'command', side, text: occupant ? `${player(next, side, playerId).name} moves to ${position}; ${player(next, side, occupant).name} takes ${shown[playerId]}.` : `${player(next, side, playerId).name} moves to ${position}.` }); return next;
}
/**
 * The court picture (format 74): a player is put in a circle. A player on court moves there (`setCourtPosition`). A
 * reserve replaces the player shown in the circle through the normal substitution queue and takes his circle: at
 * once before tip-off, otherwise at the next legal stoppage. A reserve already queued for another player is re-queued.
 */
export function placeInCircle(state: MatchState, side: Side, playerId: string, position: Position): MatchState {
  assertSide(side); assertOpen(state); assertBoundary(state);
  if (!isCourtPosition(position)) throw new Error('Choose a court position.');
  if (state.lineups[side].includes(playerId)) return setCourtPosition(state, side, playerId, position);
  if (!state[side].players.some(p => p.id === playerId)) throw new Error('The incoming player must belong to this team.');
  const shown = courtCircles(state, side), occupant = Object.keys(shown).find(id => shown[id] === position);
  if (!occupant) throw new Error('Bring a reserve on for a player on the court.');
  const earlier = state.pendingSubstitutions[side].find(request => request.inId === playerId && request.outId !== occupant);
  // The reserve is marked for a circle before the request is queued: he takes the outgoing player's circle when he comes on.
  const marked = copy(earlier ? cancelSubstitution(state, side, earlier.outId) : state);
  ((marked.slots ??= {})[side] ??= {})[playerId] = position;
  return substitutePlayer(marked, side, occupant, playerId);
}
/**
 * The court picture's "Best five" (format 74): one healthy, eligible player for each circle, the highest total of
 * overall ratings in the circle's position (out-of-position cost included) weighted by current condition, as the
 * automatic matchday selection weighs them. Ties keep the five on the floor and their circles. Reads state only.
 */
export function bestCircles(state: MatchState, side: Side): Record<string, Position> {
  assertSide(side);
  const candidates = state[side].players.filter(p => isPlayerEligible(state, p.id)), circles = COURT_POSITIONS;
  const current = courtCircles(state, side), onCourt = new Set(state.lineups[side]);
  const value = (p: Player, circle: Position) => overallRating(asPlayedIn(p, circle).attributes, circle) * (.55 + .45 * (state.stats[p.id]?.condition ?? 100) / 100) + (current[p.id] === circle ? .001 : 0) + (onCourt.has(p.id) ? .001 : 0);
  // Five candidates per circle are enough: a better choice for one circle can be taken by at most four other circles.
  const shortlist = circles.map(circle => [...candidates].sort((a, b) => value(b, circle) - value(a, circle) || candidates.indexOf(a) - candidates.indexOf(b)).slice(0, circles.length));
  let best: { ids: string[]; total: number } | null = null;
  // With fewer than five eligible players some circles stay empty ('').
  const search = (index: number, ids: string[], total: number) => {
    if (index === circles.length) { if (!best || total > best.total + 1e-9) best = { ids: [...ids], total }; return; }
    for (const p of shortlist[index]!) if (!ids.includes(p.id)) { ids.push(p.id); search(index + 1, ids, total + value(p, circles[index]!)); ids.pop(); }
    if (circles.length - index > candidates.length - ids.filter(Boolean).length) { ids.push(''); search(index + 1, ids, total); ids.pop(); }
  };
  search(0, [], 0);
  return Object.fromEntries((best as { ids: string[] } | null)?.ids.flatMap((id, index) => id ? [[id, circles[index]!]] : []) ?? []);
}
/**
 * Fills the court picture's circles with `bestCircles`: players already on court take their circles at once; each
 * reserve comes on for the player shown in his circle through the normal substitution queue (at once before tip-off,
 * otherwise at the next legal stoppage). Queued changes for this side are replaced. Already the best five: no change.
 */
export function arrangeBestFive(state: MatchState, side: Side): MatchState {
  assertSide(side); assertOpen(state); assertBoundary(state);
  const target = bestCircles(state, side), shown = courtCircles(state, side), chosen = state.slots?.[side] ?? {};
  const listed = (id: string) => state[side].players.find(p => p.id === id)!.position;
  const staying = Object.entries(target).filter(([id]) => state.lineups[side].includes(id));
  if (!state.pendingSubstitutions[side].length && staying.length === Object.keys(target).length && staying.every(([id, circle]) => shown[id] === circle && (circle === listed(id) || chosen[id] === circle))) return state;
  let next = copy(state);
  if (next.pendingSubstitutions[side].length) { next.pendingSubstitutions[side] = []; emit(next, { type: 'command', side, text: 'Queued substitutions are replaced by the best five.' }); }
  (next.slots ??= {})[side] = Object.fromEntries(staying);
  emit(next, { type: 'command', side, text: `${next[side].name} take their best five's circles.` });
  for (const [id, circle] of Object.entries(target)) if (!next.lineups[side].includes(id)) next = placeInCircle(next, side, id, circle);
  return next;
}
export function requestTimeout(state: MatchState, side: Side): MatchState {
  assertSide(side); assertOpen(state);
  if (remainingTimeouts(state, side) <= 0) throw new Error('No timeouts remain in this allowance.');
  if (state.timeoutRequested[side]) return state;
  const next = copy(state); next.timeoutRequested[side] = true; emit(next, { type: 'command', side, text: `${next[side].name} request a timeout at the next legal opportunity.` }); serviceStoppage(next); return next;
}
export function cancelTimeoutRequest(state: MatchState, side: Side): MatchState {
  assertSide(side); assertOpen(state); const next = copy(state); next.timeoutRequested[side] = false; emit(next, { type: 'command', side, text: 'Queued timeout cancelled.' }); return next;
}
export function setAutoSubstitutions(state: MatchState, side: Side, enabled: boolean): MatchState {
  assertSide(side); assertOpen(state); if (typeof enabled !== 'boolean') throw new Error('Choose a valid assistant policy.');
  const next = copy(state); next.autoSubstitutions[side] = enabled; emit(next, { type: 'command', side, text: `${next[side].name}: assistant substitutions ${enabled ? 'enabled' : 'disabled'}.` }); resolveEligibility(next); serviceStoppage(next); return next;
}
export function setInjuryMode(state: MatchState, mode: InjuryMode): MatchState {
  if (state.status !== 'ready' || state.stepCount !== 0) throw new Error('Choose the injury setting before tipoff.');
  if (!['standard', 'reduced', 'off'].includes(mode)) throw new Error('Choose a valid injury setting.');
  const next = copy(state); next.injuryMode = mode; emit(next, { type: 'command', text: `Injury setting: ${mode}, applied equally to both teams.` }); return next;
}

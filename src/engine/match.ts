/** Deterministic FIBA-2024 rules subset. Probability, fatigue and injury parameters remain uncalibrated. */
import { FICTIONAL_AWAY, FICTIONAL_HOME } from '../data/fictional-teams';
import type { CourtPoint, CourtPosition, CourtScene, EngineVersion, InjuryMode, MatchEvent, MatchState, Player, PlayerStats, PossessionPlay, Side, Tactics } from '../domain/types';
import { nextRandom, normalizeSeed } from './random';
import { actionScene, freeThrowPosition, passScene, reboundScene, setupScene, shotScene, turnoverScene } from './court-events';
import { basketPoint, courtDistance, createPossessionPlay, matchedDefender, moveForAction, positionOf, possessionFormation, shotContext } from './possession';
export const MAX_MATCH_PERIODS = 24;
const MAX_SIMULATION_STEPS = 20_000;
const SIDES: readonly Side[] = ['home', 'away'];
const DEFAULT_TACTICS: Tactics = { tempo: 0.5, outsideShare: 0.45, pressure: 0.5 };
export const INJURY_HAZARD_PER_PLAYER_SECOND = 0.000006;
const other = (side: Side): Side => side === 'home' ? 'away' : 'home';
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const elapsed = (state: MatchState): number => state.period <= 4 ? state.period * 600 - state.clockSeconds : 2400 + (state.period - 4) * 300 - state.clockSeconds;
const lateGame = (state: MatchState): boolean => state.period >= 4 && state.clockSeconds <= 120;
function emptyStats(): PlayerStats {
  return { secondsPlayed: 0, points: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 0, threePointersMade: 0, threePointersAttempted: 0, freeThrowsMade: 0, freeThrowsAttempted: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0, condition: 100 };
}
function copy(state: MatchState): MatchState {
  return { ...state, score: { ...state.score },
    ...(state.engineVersion === 'possession-3' ? { possessionPlay: state.possessionPlay ? { ...state.possessionPlay, positions: state.possessionPlay.positions.map(point => ({ ...point })), matchups: state.possessionPlay.matchups.map(pair => ({ ...pair })) } : null } : {}),
    lineups: { home: [...state.lineups.home], away: [...state.lineups.away] },
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
    courtSeconds: { ...state.courtSeconds }, result: state.result ? { ...state.result, officialScore: { ...state.result.officialScore } } : null,
  };
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
function player(state: MatchState, side: Side, id: string): Player { const result = state[side].players.find(p => p.id === id); if (!result) throw new Error('A player is missing from the roster.'); return result; }
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
  state.lineups[side][index] = inId;
  if (mandatory && state.freeThrows?.shooterId === outId) state.freeThrows.shooterId = inId;
  state.substitutionLocks = [...new Set([...state.substitutionLocks, outId, inId])];
  const scene = state.engineVersion === 'possession-3' ? lineupScene(state, outId, inId) : setupScene(state, state.possession, state.lineups[state.possession][0]!);
  emit(state, { type: 'substitution', side, playerId: inId, outgoingPlayerId: outId, text: `${incoming.name} replaces ${outgoing.name}${mandatory ? ' after becoming ineligible' : ''}.`, scene });
}
function bestReplacement(state: MatchState, side: Side, outgoing: Player): Player | undefined {
  return state[side].players.filter(p => !state.lineups[side].includes(p.id) && isPlayerEligible(state, p.id)).sort((a, b) => replacementScore(b) - replacementScore(a) || a.id.localeCompare(b.id))[0];
  function replacementScore(p: Player): number { return state.stats[p.id]!.condition - state.stats[p.id]!.fouls * 5 + (p.position === outgoing.position ? 12 : 0) + (p.attributes.defense + p.attributes.twoPoint) / 4; }
}
function clearCommands(state: MatchState): void { state.pendingSubstitutions = { home: [], away: [] }; state.timeoutRequested = { home: false, away: false }; state.requiredSubstitutions = []; }
function finishDefault(state: MatchState, losing: Side): void {
  clearPossessionPlay(state);
  const winner = other(losing), officialScore = state.score[winner] > state.score[losing] ? { ...state.score } : { [winner]: 2, [losing]: 0 } as Record<Side, number>;
  for (const side of SIDES) state.lineups[side] = state.lineups[side].filter(id => isPlayerEligible(state, id));
  state.result = { winner, kind: 'default', officialScore }; state.status = 'finished'; state.freeThrows = null; state.stoppage = null; state.phase = 'dead-ball'; clearCommands(state);
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
        state.lineups[side] = state.lineups[side].filter(id => id !== outId);
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
      if (rotated.has(side) || !state.autoSubstitutions[side] || !canSubstituteNow(state, side)) continue;
      const foulLimit = state.period === 1 ? 2 : state.period === 2 ? 3 : 4;
      const priority = (p: Player) => state.stats[p.id]!.condition - (state.stats[p.id]!.fouls >= foulLimit ? 35 : 0);
      const tired = activePlayers(state, side).filter(p => !state.substitutionLocks.includes(p.id) && state.freeThrows?.shooterId !== p.id).sort((a, b) => priority(a) - priority(b))[0];
      if (!tired) continue; const incoming = bestReplacement(state, side, tired);
      const current = state.stats[tired.id]!;
      const reserve = incoming ? state.stats[incoming.id]! : null;
      const needsRest = reserve && current.condition < 85 && reserve.condition >= current.condition + 7;
      const foulTrouble = reserve && current.fouls >= foulLimit && reserve.fouls < current.fouls && reserve.condition >= current.condition - 3;
      if (incoming && !state.substitutionLocks.includes(incoming.id) && (needsRest || foulTrouble)) {
        applySubstitution(state, side, tired.id, incoming.id); rotated.add(side); changed = true;
        if (state.stoppage!.reason === 'made-basket') whistle(state);
      }
    }
    if (!changed) return;
  }
}
function personalFoul(state: MatchState, side: Side, offender: Player, text: string): void {
  state.stats[offender.id]!.fouls += 1; state.teamFouls[side] += 1;
  emit(state, { type: 'foul', side, playerId: offender.id, text });
  if (state.stats[offender.id]!.fouls === 5) emit(state, { type: 'foul-out', side, playerId: offender.id, text: `${offender.name} is excluded after five personal fouls.` });
}
function sampleInjuries(state: MatchState, seconds: number): void {
  if (state.injuryMode === 'off' || seconds <= 0 || state.clockSeconds === 0 && !state.freeThrows) return;
  const multiplier = state.injuryMode === 'reduced' ? 0.3 : 1;
  for (const side of SIDES) {
    const exposed = activePlayers(state, side).filter(p => isPlayerEligible(state, p.id));
    const chance = 1 - Math.exp(-INJURY_HAZARD_PER_PLAYER_SECOND * seconds * exposed.length * multiplier);
    if (draw(state) >= chance || !exposed.length) continue;
    const injured = choose(state, exposed, p => 1 + (100 - state.stats[p.id]!.condition) / 100), kind = draw(state) < 0.5 ? 'ankle' : 'muscle';
    state.injuries[injured.id] = { kind, occurredAtSeconds: elapsed(state) };
    emit(state, { type: 'injury', side, playerId: injured.id, text: `${injured.name} leaves with a ${kind} problem and cannot return in this exhibition.` });
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
  const stolen = !shotClock && draw(state) < .68;
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
  const offensive = draw(state) < clamp(.25 + (strength(attackers) - strength(defenders)) * .014 + (attackers.length - defenders.length) * .035, .12, .46);
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
  const fouled = draw(state) < clamp(.055 + state.tactics[defense].pressure * .065 + (three ? 0 : .025) - Math.max(0, context.separationM - 1.5) * .025, .025, .16);
  const blocked = !fouled && draw(state) < clamp(.008 + defender.attributes.defense * .0012 + Math.max(0, defender.heightCm - shooter.heightCm) * .0008 - Math.max(0, context.separationM - .75) * .012, .002, .065);
  const made = !blocked && draw(state) < context.makeChance * (fouled ? .65 : 1) - (rushed ? .06 : 0);
  const origin = positionOf(play, shooter.id), hoop = basketPoint(state, offense);
  const landing: CourtPoint = made ? hoop : { x: clamp(hoop.x - attackingDirection(state, offense) * (.5 + draw(state) * 1.4) / 28, .025, .975), y: clamp(.5 + (draw(state) - .5) * .22, .08, .92) };
  // A final completed pass is credited only if no drive, whistle or control
  // change intervened. It exists before this attempt's outcome is sampled.
  const passerId = made ? play.passerId : null;
  if (!fouled || made) {
    stats.fieldGoalsAttempted += 1; if (three) stats.threePointersAttempted += 1;
    if (made) { stats.fieldGoalsMade += 1; if (three) stats.threePointersMade += 1; creditPoints(state, offense, shooter, context.value); }
    if (blocked) state.stats[defender.id]!.blocks += 1;
    if (passerId) state.stats[passerId]!.assists += 1;
    emit(state, { type: 'shot', side: offense, playerId: shooter.id, ...(passerId ? { assistPlayerId: passerId } : {}),
      text: blocked ? `${defender.name} blocks ${shooter.name}.` : `${shooter.name} ${made ? 'makes' : 'misses'} ${context.contest === 'open' ? 'an open' : `a ${context.contest}`} ${three ? 'three-pointer' : 'two-point shot'}${state.clockSeconds === 0 ? ' released before the period horn' : ''}.`,
      shot: { x: origin.x, y: origin.y, made, value: context.value, defenderId: context.defenderId, contest: context.contest, distanceM: context.distanceM },
      scene: actionScene('shot', offense, play.positions, play.positions, ballAt(origin, 2.1), ballAt(landing, made ? 3.05 : .45), made ? 3.1 : 2.8) });
  }
  if (fouled) { personalFoul(state, defense, defender, `${defender.name} fouls ${shooter.name} on the shot.`); startFreeThrows(state, offense, shooter, made ? 1 : context.value); }
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
  if (restarted || !state.frontcourt) action = 'advance';
  // Leave room to release after the longer creation windows. A new pass or
  // drive with only a few seconds left should not routinely strand the ball.
  else if (state.shotClockSeconds <= 8 || play.actions >= 4) action = 'shot';
  else {
    const roll = draw(state), shootChance = distance < 4.5 ? .66 : clamp(.12 + play.actions * .12 + tactics.outsideShare * .13, .12, .68);
    action = roll < shootChance ? 'shot' : roll < shootChance + (1 - shootChance) * (.3 + tactics.outsideShare * .58) ? 'pass' : 'drive';
  }
  // Include organizing, reading the defense and executing each action. Tempo
  // changes these windows modestly; animation duration is unrelated to them.
  const actionSeconds = action === 'advance' || action === 'drive' ? 6 : 5;
  let proposed = clamp(Math.round(actionSeconds + (.5 - tactics.tempo) + (draw(state) - .5) * 2), 1, action === 'advance' ? 8 : 7);
  const rushed = action === 'shot' && state.shotClockSeconds <= 5;
  if (action === 'shot' && state.shotClockSeconds <= 8 && state.shotClockSeconds > 1) proposed = Math.min(proposed, state.shotClockSeconds - 1);
  const shotClockExpired = proposed >= state.shotClockSeconds && state.shotClockSeconds < state.clockSeconds;
  const seconds = Math.min(state.clockSeconds, state.shotClockSeconds, proposed);
  if (seconds <= 0) throw new Error('A live action must have time on both clocks.');
  exposure(state, seconds); state.clockSeconds -= seconds; state.shotClockSeconds -= seconds; state.stepCount += 1; state.phase = 'live-ball'; state.stoppage = null;
  if (shotClockExpired) possessionTurnover(state, play, true);
  else if (seconds < proposed || state.clockSeconds === 0 && action !== 'shot') {
    emit(state, { type: 'command', side: offense, playerId: handler.id, text: `The period horn interrupts ${handler.name}'s ${action === 'advance' ? 'advance' : action === 'shot' ? 'shot preparation' : action}.`, scene: settledScene(play) });
  } else if (action === 'advance') {
    const start = restarted ? visualStart(state, play.positions) : play.positions;
    const positions = moveForAction(state, play, 'advance');
    const from = visualBallStart(state, start.find(point => point.playerId === handler.id)!), to = ballAt(positions.find(point => point.playerId === handler.id)!);
    play.positions = positions; play.actions += 1; play.passerId = null; state.frontcourt = true;
    emit(state, { type: 'command', side: offense, playerId: handler.id, text: `${handler.name} brings ${state[offense].name} into their half-court offense.`, scene: actionScene('setup', offense, start, positions, from, to) });
  } else {
    const fatigue = (100 - state.stats[handler.id]!.condition) / 100;
    const turnoverChance = clamp((action === 'shot' ? .008 : .018) + pressure * .024 + (defender.attributes.defense - handler.attributes.passing) * .002 + fatigue * .014, .006, .095);
    const foulChance = (action === 'drive' ? .028 : .012) + pressure * .018;
    const roll = draw(state);
    if (roll < turnoverChance) possessionTurnover(state, play);
    else if (roll < turnoverChance + .007) {
      personalFoul(state, offense, handler, `${handler.name} commits a team-control offensive foul. No free throws.`);
      state.stats[handler.id]!.turnovers += 1; resetPossession(state, defense); whistle(state);
    } else if (roll < turnoverChance + .007 + foulChance) {
      personalFoul(state, defense, defender, `${defender.name} commits a non-shooting defensive foul on ${handler.name}.`);
      if (state.teamFouls[defense] >= 5) startFreeThrows(state, offense, handler, 2);
      else { state.shotClockSeconds = defensiveFoulShotClock(state.shotClockSeconds, state.frontcourt); whistle(state); }
    } else if (roll < turnoverChance + .011 + foulChance) {
      const receiving = state.possessionArrow; state.possessionArrow = other(receiving);
      if (receiving !== offense) resetPossession(state, receiving);
      whistle(state); emit(state, { type: 'held-ball', side: receiving, text: `Held ball. The possession arrow awards the throw-in to ${state[receiving].name}.` });
    } else if (action === 'shot') resolvePossessionShot(state, play, rushed);
    else {
      const receiver = action === 'pass' ? choose(state, activePlayers(state, offense).filter(p => p.id !== handler.id), p => {
        const rangePreference = tactics.outsideShare * p.attributes.threePoint + (1 - tactics.outsideShare) * p.attributes.twoPoint;
        const rolePreference = p.position === 'PF' || p.position === 'C' ? 1.5 - tactics.outsideShare : .5 + tactics.outsideShare;
        const separation = courtDistance(positionOf(play, p.id), positionOf(play, matchedDefender(state, play, p.id).id));
        return rangePreference * rolePreference * clamp(.8 + separation * .15, .8, 1.35);
      }) : handler;
      const start = play.positions, positions = moveForAction(state, play, action, receiver.id, draw(state));
      const from = ballAt(positionOf(play, handler.id)), to = ballAt(positions.find(point => point.playerId === receiver.id)!);
      play.positions = positions; play.handlerId = receiver.id; play.passerId = action === 'pass' ? handler.id : null; play.actions += 1;
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
export function createMatch(seed = 42, engineVersion: EngineVersion = 'possession-3'): MatchState {
  if (engineVersion !== 'rules-2' && engineVersion !== 'possession-3') throw new Error('Choose a supported match engine.');
  const state: MatchState = {
    schemaVersion: 2, engineVersion, seed, rngState: normalizeSeed(seed), home: FICTIONAL_HOME, away: FICTIONAL_AWAY, score: { home: 0, away: 0 },
    period: 1, clockSeconds: 600, status: 'ready', phase: 'dead-ball', possession: 'home', possessionArrow: 'away', shotClockSeconds: 24, frontcourt: false, teamFouls: { home: 0, away: 0 },
    timeoutUsage: { home: { firstHalf: 0, secondHalf: 0, overtime: 0, lateFourth: 0 }, away: { firstHalf: 0, secondHalf: 0, overtime: 0, lateFourth: 0 } },
    timeoutRequested: { home: false, away: false }, pendingSubstitutions: { home: [], away: [] }, requiredSubstitutions: [], freeThrows: null,
    stoppage: { reason: 'pre-game', substitutionSides: ['home', 'away'], timeoutSides: [] }, substitutionLocks: [], autoSubstitutions: { home: false, away: true }, injuryMode: 'standard', injuries: {}, courtSeconds: { home: 0, away: 0 }, result: null,
    lineups: { home: FICTIONAL_HOME.players.slice(0, 5).map(p => p.id), away: FICTIONAL_AWAY.players.slice(0, 5).map(p => p.id) },
    tactics: { home: { ...DEFAULT_TACTICS }, away: { ...DEFAULT_TACTICS } }, stats: Object.fromEntries([...FICTIONAL_HOME.players, ...FICTIONAL_AWAY.players].map(p => [p.id, emptyStats()])), events: [], stepCount: 0,
  };
  state.possession = draw(state) < 0.5 ? 'home' : 'away'; state.possessionArrow = other(state.possession);
  if (engineVersion === 'possession-3') state.possessionPlay = createPossessionPlay(state);
  const scene = state.possessionPlay ? settledScene(state.possessionPlay) : setupScene(state, state.possession, state.lineups[state.possession][0]!);
  emit(state, { type: 'tipoff', side: state.possession, text: `${state[state.possession].name} win the opening tip. FIBA-2024 exhibition rules subset.`, scene }); return state;
}
/** One deterministic live action or free throw; critical decisions stop every playback mode. */
export function stepMatch(state: MatchState): MatchState {
  if (state.status === 'finished') return state;
  assertBoundary(state); const next = copy(state); resolveEligibility(next);
  if (next.status === 'finished') return next;
  serviceStoppage(next); if (next.requiredSubstitutions.length) return next;
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
  emit(next, { type: 'command', side, text: `${player(next, side, inId).name} is requested for ${player(next, side, outId).name}; changes apply at a legal opportunity.` }); serviceStoppage(next); return next;
}
export function cancelSubstitution(state: MatchState, side: Side, outId: string): MatchState {
  assertSide(side); assertOpen(state); const next = copy(state); next.pendingSubstitutions[side] = next.pendingSubstitutions[side].filter(r => r.outId !== outId);
  emit(next, { type: 'command', side, text: 'Queued substitution cancelled.' }); return next;
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
  const next = copy(state); next.injuryMode = mode; emit(next, { type: 'command', text: `Injury setting: ${mode}, applied equally to both teams. Incidence is provisional.` }); return next;
}

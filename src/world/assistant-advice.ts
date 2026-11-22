import type { AssistantCoach } from '../domain/assistant';
import type { MatchState, Player, PlayerAttributes, SkillAttributes, Position, Side, Tactics } from '../domain/types';
import { isPlayerEligible, setTactics, substitutePlayer } from '../engine/match';
import { assistantEffects } from './assistant-policy';
import { playerPIR } from './performance-rating';

export interface AssistantRotation {
  outId: string;
  inId: string;
  reason: string;
  priority: 'required' | 'fatigue' | 'fouls' | 'fit';
}
export interface AssistantAdvice {
  assistantId: string;
  side: Side;
  tactics: Tactics | null;
  reasons: Record<keyof Tactics, string>;
  tacticsChanged: boolean;
  rotation: AssistantRotation | null;
  rotationNote: string;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const compareId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const slider = (value: number) => Math.round(clamp(value, .2, .75) * 20) / 20;
const positions: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const fitWeights: Record<Position, Partial<Record<keyof SkillAttributes, number>>> = {
  PG: { passing: .35, twoPoint: .15, threePoint: .2, defense: .2, stamina: .1 },
  SG: { threePoint: .35, twoPoint: .25, passing: .1, defense: .2, stamina: .1 },
  SF: { twoPoint: .25, threePoint: .25, defense: .2, rebounding: .2, stamina: .1 },
  PF: { twoPoint: .3, rebounding: .3, defense: .25, stamina: .15 },
  C: { twoPoint: .3, rebounding: .35, defense: .25, stamina: .1 },
};

/** Assessment changes precision, never access to another club's private attributes. */
function assessed(player: Player, attribute: keyof SkillAttributes, coach: AssistantCoach): number {
  const step = assistantEffects(coach).skillStep;
  return clamp(Math.round(player.attributes[attribute] / step) * step, 1, 20);
}

function rotationValue(match: MatchState, player: Player, position: Position, coach: AssistantCoach): number {
  const stats = match.stats[player.id]!;
  const fit = Object.entries(fitWeights[position]).reduce((total, [key, weight]) => total + assessed(player, key as keyof SkillAttributes, coach) * weight!, 0);
  const positionalDistance = Math.abs(positions.indexOf(position) - positions.indexOf(player.position));
  const foulRisk = stats.fouls >= 4 ? 3 : stats.fouls === 3 && match.period < 4 ? 1.5 : 0;
  // Recorded form is bounded and only considered after five actual minutes.
  const form = stats.secondsPlayed >= 300 ? clamp(playerPIR(stats) / 10, -2, 2) : 0;
  return fit * (.5 + stats.condition / 200) - positionalDistance * 1.5 - foulRisk + form;
}

/** Read-only recommendations from this side's owned squad and recorded game state. */
export function getAssistantAdvice(match: MatchState, side: Side, coach: AssistantCoach): AssistantAdvice {
  const report: AssistantAdvice = { assistantId: coach.id, side, tactics: null, reasons: { tempo: '', outsideShare: '', pressure: '' }, tacticsChanged: false, rotation: null, rotationNote: 'No change recommended.' };
  if (match.status === 'finished') return { ...report, rotationNote: 'Match finished. Advice resumes with the next fixture.' };
  const squad = match[side].players;
  const active = match.lineups[side].map(id => squad.find(player => player.id === id)!).filter(Boolean);
  const available = active.filter(player => isPlayerEligible(match, player.id));
  if (available.length) {
    const skill = (key: keyof SkillAttributes) => mean(available.map(player => assessed(player, key, coach)));
    const condition = mean(available.map(player => match.stats[player.id]!.condition));
    const fouls = mean(available.map(player => match.stats[player.id]!.fouls));
    const passing = skill('passing'), shooting = skill('threePoint') - skill('twoPoint');
    report.tactics = {
      tempo: slider(.5 + (passing - 10) * .02 + (condition - 85) * .008),
      outsideShare: slider(.45 + shooting * .04),
      pressure: slider(.5 + (skill('defense') - 10) * .025 + (skill('stamina') - 10) * .01 - (100 - condition) * .006 - fouls * .05),
    };
    report.reasons = {
      tempo: `Current five: ${Math.round(condition)}% average stamina; assessed passing ${passing.toFixed(1)}/20.`,
      outsideShare: `Current five: assessed perimeter shooting ${skill('threePoint').toFixed(1)}/20 and inside shooting ${skill('twoPoint').toFixed(1)}/20.`,
      pressure: `Current five: assessed defense ${skill('defense').toFixed(1)}/20; ${fouls.toFixed(1)} fouls per player and ${Math.round(condition)}% stamina.`,
    };
    report.tacticsChanged = (Object.keys(report.tactics) as (keyof Tactics)[]).some(key => report.tactics![key] !== match.tactics[side][key]);
  }
  if (match.pendingSubstitutions[side].length) return { ...report, rotationNote: 'A substitution is already queued. Review it on the floor.' };
  const bench = squad.filter(player => !match.lineups[side].includes(player.id) && isPlayerEligible(match, player.id));
  if (!bench.length) return { ...report, rotationNote: 'No eligible reserves available.' };
  const candidates: { suggestion: AssistantRotation; rank: number; gain: number }[] = [];
  for (const out of active) {
    const stats = match.stats[out.id]!;
    const required = !isPlayerEligible(match, out.id);
    const fresher = stats.condition < 75 ? bench.filter(player => match.stats[player.id]!.condition >= stats.condition + 8) : [];
    const lowerFoulRisk = stats.fouls >= 4 || stats.fouls === 3 && match.period < 4 ? bench.filter(player => match.stats[player.id]!.fouls < stats.fouls) : [];
    // First solve the actual concern; a talented but equally tired reserve must not hide a fresh alternative.
    const pool = required ? bench : fresher.length ? fresher : lowerFoulRisk.length ? lowerFoulRisk : bench;
    const incoming = [...pool].sort((left, right) => rotationValue(match, right, out.position, coach) - rotationValue(match, left, out.position, coach) || compareId(left.id, right.id))[0]!;
    const inStats = match.stats[incoming.id]!;
    const gain = rotationValue(match, incoming, out.position, coach) - rotationValue(match, out, out.position, coach);
    let priority: AssistantRotation['priority'] = 'fit', reason = '', rank = 0;
    if (required) {
      priority = 'required'; rank = 1000;
      reason = `${out.name} ${match.injuries[out.id] ? 'is injured' : 'has fouled out'}. ${incoming.name} is eligible to replace him.`;
    } else if (stats.condition < 75 && inStats.condition >= stats.condition + 8) {
      priority = 'fatigue'; rank = 500 + (75 - stats.condition);
      reason = `${out.name} is at ${Math.round(stats.condition)}% stamina; ${incoming.name} is at ${Math.round(inStats.condition)}%.`;
    } else if ((stats.fouls >= 4 || stats.fouls === 3 && match.period < 4) && inStats.fouls < stats.fouls) {
      priority = 'fouls'; rank = 300 + stats.fouls;
      reason = `${out.name} has ${stats.fouls} fouls; ${incoming.name} has ${inStats.fouls}. Protect against exclusion.`;
    } else if (gain > (match.status === 'ready' ? 1.5 : 3)) {
      rank = gain;
      reason = `${incoming.name} offers a stronger assessed fit at ${out.position}, considering skills, stamina, fouls and recorded form.`;
    } else continue;
    candidates.push({ suggestion: { outId: out.id, inId: incoming.id, priority, reason }, rank, gain });
  }
  candidates.sort((left, right) => right.rank - left.rank || right.gain - left.gain || compareId(left.suggestion.outId, right.suggestion.outId));
  report.rotation = candidates[0]?.suggestion ?? null;
  return report;
}

/** Annotate the existing command's event without changing any sporting field. */
function attributed(before: MatchState, after: MatchState, coach: AssistantCoach, side: Side, type: 'tactics' | 'command'): MatchState {
  if (after === before) return before;
  const index = after.events.findIndex((event, index) => index >= before.events.length && event.side === side && event.type === type);
  if (index < 0) return after;
  return { ...after, events: after.events.map((event, position) => position === index ? { ...event, text: `${coach.name}'s advice: ${event.text}` } : event) };
}

/** Recompute at execution, then use the same authoritative commands as manual coaching. */
export function applyAssistantTactics(match: MatchState, side: Side, coach: AssistantCoach): MatchState {
  if (match.status === 'finished') throw new Error('The match has finished.');
  const advice = getAssistantAdvice(match, side, coach);
  return advice.tactics && advice.tacticsChanged ? attributed(match, setTactics(match, side, advice.tactics), coach, side, 'tactics') : match;
}

export function applyAssistantRotation(match: MatchState, side: Side, coach: AssistantCoach): MatchState {
  if (match.status === 'finished') throw new Error('The match has finished.');
  const rotation = getAssistantAdvice(match, side, coach).rotation;
  return rotation ? attributed(match, substitutePlayer(match, side, rotation.outId, rotation.inId), coach, side, 'command') : match;
}

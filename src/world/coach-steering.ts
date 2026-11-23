import { draftDateOfBirth } from './draft-index';
import type { SeasonDraft } from '../domain/draft';
import type { CoachAttributes, CoachStyle } from '../domain/coaches';
import type { SeasonState } from '../domain/season';
import type { TrainingFocus, TrainingIntensity, TrainingPlan } from '../domain/training';
import type { CoachRotation, Player, SkillAttributes, Team } from '../domain/types';
import type { WorldContext } from '../domain/world';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { worldOf } from './career-world';
import { OVR_POSITION_WEIGHTS } from './overall-rating';

/**
 * Format 86 (owner, 22 November 2026, item E follow-up): head coaches steer their clubs. New real-club careers only
 * (`coaches.model` 'coaches-2', option `coachSteering`); careers created before keep the earlier rules exactly.
 *
 * - Training: a computer club's delegated weekly plan follows its head coach: his style picks the focus of some weeks
 *   (pressing coach: defence; three-point coach: three-point shooting; inside coach: two-point shooting; fast coach:
 *   stamina), Adaptability works on the squad's weakest skill, Development and Youth give young players their own
 *   focus, Discipline and Motivation decide when the squad trains light or hard.
 * - Every head coach (the manager too) adds a little practice by his Development (`practicePercent`) and a little
 *   morale by his Motivation (`moraleImpact`).
 * - Rotation: a computer side's automatic rotation follows its coach (`coachRotation`): bench depth, trust in young
 *   players, rest and foul-trouble thresholds, how quickly a good tactician changes, when his best five close and when
 *   he stops a run with a timeout.
 * - Signings: a computer club prefers players who fit its coach's style (`styleFit`), inside the usual budget and
 *   squad-need rules.
 * Pure rules only (no career state): who coaches where is in `head-coaches.ts`. Never random; screens never change it.
 */
export const COACH_STEERING_MODEL = 'coaches-2' as const;

export const COACH_STEERING = Object.freeze({
  /** Players of this age or younger are "young" for training focus, rotation trust and signings. */
  youngAge: 22,
  training: {
    /** Below this average condition the squad trains light: 75 for a neutral coach, higher with Motivation, lower with Discipline. */
    tiredBase: 75, tiredPerPoint: .6, tiredMin: 68, tiredMax: 82,
    /** A coach with this much Discipline trains hard (balanced weeks only) when the squad is fresh. */
    heavyFrom: 14, heavyFresh: 90,
    /** The style's focus weeks repeat every `cycle` weeks; a strong lean (`strongFrom` above the threshold) takes two of them. */
    cycle: 4, strongLean: 4,
    /** A player trains a focus only while it has this many training points of room below his potential's limit. */
    room: 40,
    /** Adaptability, Development or Youth from this value use their week or the young players' own focus. */
    adaptFrom: 13, developFrom: 13,
  },
  /** Practice per point of Development above or below 10, in percent, and its bounds. */
  practice: { perPoint: .6, min: -3, max: 4 },
  /** Morale per point of Motivation above or below 10, and its bounds. */
  morale: { perPoint: .4, min: -3, max: 3 },
  /** How strongly a signing's fit counts against the club's rating of players (sum of the seven skills, about 70 to 140). */
  fit: { perPoint: .8, youngBonus: 6, max: 10 },
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const SKILLS = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;

/** A club's head coach for these rules: a person's attributes and style, or the manager's attributes (no style: he decides). */
export interface SteeringCoach { attributes: CoachAttributes; style: CoachStyle | null }

/** A player's date of birth: the world's profile, else the academy record (prospects and graduates). Unknown: null. */
export function steeringDateOfBirth(context: WorldContext & Partial<Pick<SeasonState, 'academy'>>, playerId: string): string | null {
  const profiles = worldOf(context).playerProfiles;
  if (Object.hasOwn(profiles, playerId)) return profiles[playerId]!.dateOfBirth;
  return context.academy?.prospects.find(prospect => prospect.player.id === playerId)?.dateOfBirth ?? context.academy?.graduates.find(graduate => graduate.player.id === playerId)?.dateOfBirth ?? draftDateOfBirth(context as { draft?: SeasonDraft }, playerId);
}

/** Whether a player is young (22 or under) on a date; unknown ages are never young. */
export function isSteeringYoung(context: WorldContext & Partial<Pick<SeasonState, 'academy'>>, playerId: string, date: string): boolean {
  const age = playerAgeOnDate(steeringDateOfBirth(context, playerId), date);
  return age !== null && age <= COACH_STEERING.youngAge;
}

/** Extra practice from a head coach's Development, in percent (-3 to +4). */
export function practicePercent(attributes: Pick<CoachAttributes, 'development'>): number {
  const rule = COACH_STEERING.practice;
  return Math.round(clamp((attributes.development - 10) * rule.perPoint, rule.min, rule.max));
}

/** Morale from a head coach's Motivation (-3 to +3, whole points). */
export function moraleImpact(attributes: Pick<CoachAttributes, 'motivation'>): number {
  const rule = COACH_STEERING.morale;
  return Math.round(clamp((attributes.motivation - 10) * rule.perPoint, rule.min, rule.max));
}

/** The training focuses a coach's style leans to, strongest first, with how strong each lean is. */
export function trainingLeans(coach: { attributes: CoachAttributes; style: CoachStyle }): { focus: TrainingFocus; strength: number }[] {
  const { attributes: a, style: s } = coach;
  const leans: { focus: TrainingFocus; strength: number }[] = [
    { focus: 'defense', strength: Math.max(s.pressure - 12, a.defence - a.offence - 2) },
    { focus: 'threePoint', strength: s.shooting - 12 },
    { focus: 'twoPoint', strength: 8 - s.shooting },
    { focus: 'stamina', strength: s.pace - 12 },
    { focus: 'passing', strength: a.offence - a.defence - 2 },
  ];
  return leans.filter(lean => lean.strength >= 1).sort((x, y) => y.strength - x.strength);
}

/** The skill the squad's best players lack most for their positions (two-point, three-point, passing, defence or rebounding). */
export function weakestSkill(players: readonly Player[]): keyof SkillAttributes {
  const core = players.slice(0, 10), candidates = ['twoPoint', 'threePoint', 'passing', 'defense', 'rebounding'] as const;
  const need = (skill: typeof candidates[number]) => core.reduce((sum, player) => {
    const average = SKILLS.reduce((total, key) => total + player.attributes[key], 0) / SKILLS.length;
    return sum + OVR_POSITION_WEIGHTS[player.position][skill] * (average - player.attributes[skill]);
  }, 0);
  return [...candidates].sort((x, y) => need(y) - need(x) || candidates.indexOf(x) - candidates.indexOf(y))[0]!;
}

/** A young player's own focus: the weakest of the skills his position needs most (weight 0.1 or more). */
export function developmentFocus(player: Player, hasRoom: (skill: keyof SkillAttributes) => boolean = () => true): keyof SkillAttributes | null {
  const weights = OVR_POSITION_WEIGHTS[player.position];
  const needed = SKILLS.filter(key => weights[key] >= .1 && hasRoom(key));
  return [...needed].sort((x, y) => player.attributes[x] - player.attributes[y] || weights[y] - weights[x] || SKILLS.indexOf(x) - SKILLS.indexOf(y))[0] ?? null;
}

/**
 * A computer club's weekly plan from its head coach (format 86), replacing the delegated rule (light when tired,
 * otherwise standard and balanced). The four-week cycle: week one the style's strongest focus, week three Adaptability's
 * weakest skill (or the second lean), week four the strongest focus again for a strong lean, the rest balanced. Light
 * below the coach's tiredness line; hard in a balanced week when a disciplined coach has a fresh squad; young players
 * train their own focus with a coach strong in Development or Youth (never in a hard week). A player with no room left
 * to grow in the week's focus (`hasRoom`: his potential's limit is near), or whose position hardly needs it (weight under
 * 0.1: a centre's three-point shooting), trains balanced instead, so development is not lost.
 */
export function coachTrainingPlan(coach: { attributes: CoachAttributes; style: CoachStyle }, plan: TrainingPlan, club: Team, conditions: Readonly<Record<string, number>>, afterRound: number, isYoung: (playerId: string) => boolean, hasRoom: (playerId: string, skill: keyof SkillAttributes) => boolean = () => true): TrainingPlan {
  const rule = COACH_STEERING.training, a = coach.attributes;
  const average = club.players.reduce((sum, player) => sum + conditions[player.id]!, 0) / club.players.length;
  const tired = clamp(rule.tiredBase + (a.motivation - 10) * rule.tiredPerPoint - (a.discipline - 10) * rule.tiredPerPoint, rule.tiredMin, rule.tiredMax);
  const leans = trainingLeans(coach), first = leans[0]?.focus ?? 'balanced';
  const adapted = a.adaptability >= rule.adaptFrom ? weakestSkill(club.players) : leans[1]?.focus ?? 'balanced';
  const cycle: TrainingFocus[] = [first, 'balanced', adapted, (leans[0]?.strength ?? 0) >= rule.strongLean ? first : 'balanced'];
  const focus = cycle[(afterRound - 1) % rule.cycle]!;
  const intensity: TrainingIntensity = average < tired ? 'light' : focus === 'balanced' && a.discipline >= rule.heavyFrom && average >= rule.heavyFresh - (a.discipline - rule.heavyFrom) ? 'heavy' : 'standard';
  const develops = (a.development >= rule.developFrom || a.youth >= rule.developFrom) && intensity !== 'heavy';
  const individual = Object.fromEntries(club.players.map(player => {
    const own = develops && isYoung(player.id) ? developmentFocus(player, skill => hasRoom(player.id, skill)) : null;
    // The week's focus is for the players whose position needs it (weight 0.1 or more) and who can still grow in it.
    return [player.id, own ?? (focus !== 'balanced' && (OVR_POSITION_WEIGHTS[player.position][focus] < .1 || !hasRoom(player.id, focus)) ? 'balanced' : 'team')];
  })) as TrainingPlan['individual'];
  return { delegated: plan.delegated, intensity, focus, individual };
}

/**
 * How a computer side's head coach runs the automatic rotation (format 86). Bench depth from pace, Motivation against
 * Discipline and youth trust; young players moved up the rotation by youth trust; rest from Motivation against
 * Discipline; foul trouble, change timing, closing time and timeouts from Tactics. A neutral coach (all 10) plays the
 * usual rotation.
 */
export function coachRotation(coach: { attributes: CoachAttributes; style: CoachStyle }, young: readonly string[]): CoachRotation {
  const { attributes: a, style: s } = coach;
  const depth = Math.round(clamp((s.pace - 10) * .15 + (a.motivation - a.discipline) * .1 + (s.youthTrust - 10) * .08, -2, 2));
  const youthBonus = s.youthTrust >= 14 ? s.youthTrust - 11 : s.youthTrust <= 6 ? -2 : 0;
  return {
    depth: depth === 0 ? 0 : depth, youthBonus, young: youthBonus === 0 ? [] : [...young],
    restCondition: Math.round(clamp(92 + (a.motivation - 10) * .25 - (a.discipline - 10) * .25, 89, 95)),
    foulTrouble: Math.round(clamp(5 - (a.tactics - 10) * .3, 3, 6.5) * 2) / 2,
    swapThreshold: Math.round(clamp(3 - (a.tactics - 10) * .1, 2.2, 3.6) * 10) / 10,
    closingSeconds: Math.round(clamp(180 + (a.tactics - 10) * 12, 120, 240) / 10) * 10,
    timeoutRun: a.tactics >= 15 ? -1 : a.tactics <= 6 ? 1 : 0,
  };
}

/**
 * How well a player fits a coach's style, in the units clubs rate players by (the sum of seven skills): three-point
 * shooting for a three-point coach, defence and rebounding for a pressing or defensive coach, inside scoring and
 * rebounding for an inside coach, stamina for a fast coach, and youth for a coach who trusts young players. `skill`
 * gives what the club knows of the player (scouted ranges or estimates); 0 for a neutral coach; at most ±10.
 */
export function styleFit(coach: { attributes: CoachAttributes; style: CoachStyle }, skill: (key: keyof SkillAttributes) => number, young: boolean): number {
  const { attributes: a, style: s } = coach, rule = COACH_STEERING.fit, around = (key: keyof SkillAttributes) => skill(key) - 12;
  let fit = 0;
  if (s.shooting >= 13) fit += around('threePoint') * rule.perPoint;
  if (s.shooting <= 7) fit += (around('twoPoint') + around('rebounding') / 2) * rule.perPoint;
  if (s.pressure >= 13 || a.defence - a.offence >= 3) fit += (around('defense') + around('rebounding') / 2) * rule.perPoint;
  if (s.pace >= 13) fit += around('stamina') * rule.perPoint / 2;
  if (s.youthTrust >= 14 && young) fit += rule.youngBonus * (s.youthTrust - 13) / 4;
  if (s.youthTrust <= 6 && young) fit -= rule.youngBonus / 2;
  return Math.round(clamp(fit, -rule.max, rule.max) * 100) / 100;
}

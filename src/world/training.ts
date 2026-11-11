import type { SeasonInjury, SeasonState } from '../domain/season';
import type { SeasonTraining, TrainingFocus, TrainingIntensity, TrainingPlan, TrainingPoints, TrainingWeekReport } from '../domain/training';
import type { PlayerAttributes, Team } from '../domain/types';
import { isRecovering } from './health';
import type { SeasonCoaching } from '../domain/coaching';
import type { RosterSnapshot } from '../domain/roster';
import type { SeasonFitness } from '../domain/fitness';
import type { SeasonPhysio } from '../domain/physio';
import { coachingAssignments, coachingRatingForAttribute } from './coaching';
import { createRosterSnapshots, rosterForRound } from './rosters';
import { fitnessAssignments } from './fitness-policy';

export const TRAINING_ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
export const TRAINING_FOCUSES = ['balanced', ...TRAINING_ATTRIBUTES] as const;
export const TRAINING_INTENSITIES = ['recovery', 'light', 'standard', 'heavy'] as const;
export const TRAINING_FOCUS_LABELS: Record<TrainingFocus, string> = {
  balanced: 'Balanced', twoPoint: 'Two-point shooting', threePoint: 'Three-point shooting', freeThrow: 'Free throws',
  passing: 'Passing', defense: 'Defense', rebounding: 'Rebounding', stamina: 'Stamina',
};
export const TRAINING_INTENSITY_LABELS: Record<TrainingIntensity, string> = { recovery: 'Recovery', light: 'Light', standard: 'Standard', heavy: 'Heavy' };
const DAY_MS = 86_400_000;
const WORKLOAD = {
  recovery: { recovery: 4, cost: 0, points: 0 }, light: { recovery: 3, cost: 0, points: 2 },
  standard: { recovery: 3, cost: 2, points: 4 }, heavy: { recovery: 3, cost: 4, points: 5 },
} as const;
const emptyPoints = (): TrainingPoints => Object.fromEntries(TRAINING_ATTRIBUTES.map(key => [key, 0])) as TrainingPoints;
const copyPlan = (plan: TrainingPlan): TrainingPlan => ({ ...plan, individual: { ...plan.individual } });

/** The first development model permits two rating increases, never above 20. */
export function trainingPointCap(baseRating: number): number { return Math.min(200, (20 - baseRating) * 100); }

function isFocus(value: unknown): value is TrainingFocus { return TRAINING_FOCUSES.includes(value as TrainingFocus); }
function validatePlan(plan: TrainingPlan, club: Team): void {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).length !== 4 || typeof plan.delegated !== 'boolean' || !TRAINING_INTENSITIES.includes(plan.intensity) || !isFocus(plan.focus)) throw new Error('Choose a valid training plan.');
  if (!plan.individual || typeof plan.individual !== 'object' || Array.isArray(plan.individual) || Object.keys(plan.individual).length !== club.players.length || club.players.some(player => !Object.hasOwn(plan.individual, player.id) || plan.individual[player.id] !== 'team' && !isFocus(plan.individual[player.id]))) throw new Error('Individual training must identify every player in this club exactly once.');
}

export function createTraining(clubs: readonly Team[], enabled = true): SeasonTraining {
  return {
    model: 'training-1', enabledSince: enabled ? { seasonNumber: 1, round: 1 } : null,
    plans: Object.fromEntries(clubs.map(club => [club.id, { delegated: true, intensity: 'standard', focus: 'balanced', individual: Object.fromEntries(club.players.map(player => [player.id, 'team'])) }])),
    points: Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, emptyPoints()]))), lastWeek: null,
  };
}

/** Project training progress into a new match squad; authored identities stay immutable. */
export function developClub(club: Team, training: SeasonTraining): Team {
  return {
    ...club,
    players: club.players.map(player => ({
      ...player, attributes: Object.fromEntries(TRAINING_ATTRIBUTES.map(attribute => {
        const points = training.points[player.id]?.[attribute];
        if (!Number.isInteger(points) || points < 0 || points > trainingPointCap(player.attributes[attribute])) throw new Error('Training progress is outside its supported development limits.');
        return [attribute, Math.min(20, player.attributes[attribute] + Math.floor(points / 100))];
      })) as unknown as PlayerAttributes,
    })),
  };
}

/** Enabling affects future weekly boundaries, never an already prepared match. */
export function enableTraining(state: SeasonState): SeasonState {
  if (state.training.enabledSince) return state;
  return { ...state, training: { ...state.training, enabledSince: { seasonNumber: state.seasonNumber, round: state.round } } };
}

export function setTrainingPlan(state: SeasonState, plan: TrainingPlan): SeasonState {
  if (!state.training.enabledSince) throw new Error('Enable training before changing the weekly plan.');
  const club = state.clubs.find(club => club.id === state.managedClubId);
  if (!club) throw new Error('Choose a managed club before changing training.');
  validatePlan(plan, club);
  return { ...state, training: { ...state.training, plans: { ...state.training.plans, [club.id]: copyPlan(plan) } } };
}

/** Both AI clubs and delegated human plans use the same post-match readiness rule. */
export function resolveTrainingPlan(plan: TrainingPlan, club: Team, conditions: Record<string, number>): TrainingPlan {
  validatePlan(plan, club);
  if (!plan.delegated) return copyPlan(plan);
  const average = club.players.reduce((sum, player) => sum + conditions[player.id]!, 0) / club.players.length;
  return { ...copyPlan(plan), intensity: average < 75 ? 'light' : 'standard', focus: 'balanced' };
}

function trainingDates(fromDate: string, toDate: string): string[] {
  const start = Date.parse(`${fromDate}T00:00:00.000Z`), end = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== fromDate || new Date(end).toISOString().slice(0, 10) !== toDate || end - start !== 7 * DAY_MS) throw new Error('Training must resolve one seven-day calendar interval.');
  return Array.from({ length: 7 }, (_, index) => new Date(start + (index + 1) * DAY_MS).toISOString().slice(0, 10));
}

export function trainingAvailableDays(injuries: readonly SeasonInjury[], playerId: string, fromDate: string, toDate: string, physio?: SeasonPhysio): number {
  return trainingDates(fromDate, toDate).filter(date => !injuries.some(injury => injury.playerId === playerId && isRecovering(injury, date, physio))).length;
}

export interface TrainingWeekInput {
  training: SeasonTraining;
  clubs: readonly Team[];
  conditions: Record<string, number>;
  injuries: readonly SeasonInjury[];
  seasonNumber: number;
  afterRound: number;
  fromDate: string;
  toDate: string;
  coaching?: SeasonCoaching;
  rosters?: readonly RosterSnapshot[];
  fitness?: SeasonFitness;
  physio?: SeasonPhysio;
}

/** One authoritative weekly pass updates every club; it consumes no match RNG. */
export function processTrainingWeek(input: TrainingWeekInput): { training: SeasonTraining; conditions: Record<string, number> } {
  const { training, clubs, conditions, injuries, seasonNumber, afterRound, fromDate, toDate } = input;
  if (!training.enabledSince) throw new Error('Enable training before resolving a training week.');
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(afterRound) || afterRound < 1 || afterRound > 9) throw new Error('Training requires a supported season and a round between one and nine.');
  if (seasonNumber < training.enabledSince.seasonNumber || seasonNumber === training.enabledSince.seasonNumber && afterRound < training.enabledSince.round) throw new Error('Training cannot run before it was enabled.');
  if (training.lastWeek && (seasonNumber < training.lastWeek.seasonNumber || seasonNumber === training.lastWeek.seasonNumber && afterRound <= training.lastWeek.afterRound)) throw new Error('This training interval has already been processed.');
  const dates = trainingDates(fromDate, toDate);
  const nextConditions = { ...conditions }, nextPoints = { ...training.points };
  const appliedCoaching = input.coaching ? coachingAssignments(input.coaching, clubs, seasonNumber, afterRound) : null;
  const appliedFitness = input.fitness ? fitnessAssignments(input.fitness, clubs, seasonNumber, afterRound) : null;
  const rosters = input.rosters ?? createRosterSnapshots(clubs, seasonNumber);
  const report: TrainingWeekReport = { seasonNumber, afterRound, fromDate, toDate, rosterIds: {}, plans: {}, players: {}, coaching: appliedCoaching, ...(appliedFitness ? { fitness: appliedFitness } : {}) };
  for (const club of clubs) {
    const registered = rosterForRound(rosters, club.id, afterRound);
    const registeredIds = new Set(registered.players.map(player => player.id));
    if (registeredIds.size !== registered.players.length || club.players.length !== registeredIds.size || club.players.some(player => !registeredIds.has(player.id))) throw new Error('Training must use the players registered for its completed interval.');
    report.rosterIds[club.id] = registered.id;
    const plan = resolveTrainingPlan(training.plans[club.id]!, club, conditions);
    report.plans[club.id] = plan;
    for (const player of club.players) {
      const individual = plan.individual[player.id]!;
      const focus = individual === 'team' ? plan.focus : individual;
      const workload = WORKLOAD[plan.intensity], conditionBefore = conditions[player.id]!;
      if (!Number.isFinite(conditionBefore) || conditionBefore < 35 || conditionBefore > 100) throw new Error('Training needs valid post-match condition for every player.');
      const fitness = appliedFitness?.[club.id];
      let condition = conditionBefore, conditionWithoutCoach = conditionBefore, budget = 0, availableDays = 0;
      for (const date of dates) {
        const available = !injuries.some(injury => injury.playerId === player.id && isRecovering(injury, date, input.physio));
        if (available) {
          availableDays += 1;
          budget += condition < 70 ? Math.floor(workload.points / 2) : workload.points;
        }
        const recoveryBonus = available ? fitness?.recoveryPerDay ?? 0 : 0;
        const practiceCost = available ? workload.cost * (1 - (fitness?.practiceCostReductionPercent ?? 0) / 100) : 0;
        condition = Math.max(35, Math.min(100, Math.round((condition + workload.recovery + recoveryBonus - practiceCost) * 1000) / 1000));
        conditionWithoutCoach = Math.max(35, Math.min(100, Math.round((conditionWithoutCoach + workload.recovery - (available ? workload.cost : 0)) * 1000) / 1000));
      }
      const desired = emptyPoints(), gains = emptyPoints(), coachingGains = emptyPoints(), previous = training.points[player.id];
      if (focus === 'balanced') {
        for (const key of TRAINING_ATTRIBUTES) desired[key] = Math.floor(budget / TRAINING_ATTRIBUTES.length);
        for (let index = 0; index < budget % TRAINING_ATTRIBUTES.length; index += 1) desired[TRAINING_ATTRIBUTES[(afterRound - 1 + index) % TRAINING_ATTRIBUTES.length]!] += 1;
      } else desired[focus] = budget;
      // Allocate the whole weekly coaching budget before rounding individual
      // skills, so balanced practice still benefits from broad coaching.
      const bonusDesired = emptyPoints();
      const bonusUnits = TRAINING_ATTRIBUTES.map(attribute => desired[attribute] * coachingRatingForAttribute(appliedCoaching?.[club.id] ?? [], attribute) * 2);
      for (const [index, attribute] of TRAINING_ATTRIBUTES.entries()) bonusDesired[attribute] = Math.floor(bonusUnits[index]! / 80);
      const extra = Math.floor(bonusUnits.reduce((sum, units) => sum + units, 0) / 80) - Object.values(bonusDesired).reduce((sum, points) => sum + points, 0);
      const rotation = (afterRound - 1) % TRAINING_ATTRIBUTES.length;
      const priority = TRAINING_ATTRIBUTES.map((attribute, index) => ({ attribute, remainder: bonusUnits[index]! % 80, order: (index - rotation + TRAINING_ATTRIBUTES.length) % TRAINING_ATTRIBUTES.length })).sort((left, right) => right.remainder - left.remainder || left.order - right.order);
      for (let index = 0; index < extra; index += 1) bonusDesired[priority[index]!.attribute] += 1;
      const progress = emptyPoints();
      for (const attribute of TRAINING_ATTRIBUTES) {
        const points = previous?.[attribute], cap = trainingPointCap(player.attributes[attribute]);
        if (!Number.isInteger(points) || points < 0 || points > cap) throw new Error('Training progress is outside its supported development limits.');
        const baseProgress = Math.min(cap, points + desired[attribute]);
        progress[attribute] = Math.min(cap, baseProgress + bonusDesired[attribute]);
        coachingGains[attribute] = progress[attribute] - baseProgress;
        gains[attribute] = progress[attribute] - points;
      }
      nextConditions[player.id] = condition;
      nextPoints[player.id] = progress;
      report.players[player.id] = { focus, intensity: plan.intensity, availableDays, conditionBefore, conditionAfter: condition, gains, coachingGains, ...(appliedFitness ? { fitness: { conditionWithoutCoach, conditionBenefit: Math.round((condition - conditionWithoutCoach) * 1000) / 1000 } } : {}) };
    }
  }
  return { training: { ...training, points: nextPoints, lastWeek: report }, conditions: nextConditions };
}

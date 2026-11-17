import { facilityPracticeBonusPercent } from './facilities-policy';
import type { SeasonInjury, SeasonState } from '../domain/season';
import type { SeasonTraining, TrainingFocus, TrainingIntensity, TrainingPlan, TrainingPoints, TrainingWeekReport } from '../domain/training';
import type { Player, PlayerAttributes, Team } from '../domain/types';
import { isRecovering } from './health';
import type { SeasonCoaching } from '../domain/coaching';
import type { RosterSnapshot } from '../domain/roster';
import type { SeasonFitness } from '../domain/fitness';
import type { SeasonPhysio } from '../domain/physio';
import { coachingAssignments, coachingRatingForAttribute } from './coaching';
import { createRosterSnapshots, rosterForRound } from './rosters';
import { fitnessAssignments } from './fitness-policy';
import { ageTrainingRate, applyAgingAttributes, type LifecycleContext } from './lifecycle-policy';
import { seasonRounds } from './career-world';
import type { CareerWorld } from '../domain/world';
import { potentialPointCap, trainingHeadroom, type PotentialContext } from './potential';

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

/**
 * Training points one skill may hold: 100 per rating point of headroom, never above 20. New careers (`training-2`) use
 * each player's hidden potential (sprint 4, `src/world/potential.ts`); older careers keep the fixed two rating points.
 */
export function trainingPointCap(context: PotentialContext & { training: Pick<SeasonTraining, 'model'> }, player: Pick<Player, 'id' | 'attributes'>, attribute: keyof PlayerAttributes): number {
  return potentialPointCap(trainingHeadroom(context, player.id), player.attributes[attribute]);
}

function isFocus(value: unknown): value is TrainingFocus { return TRAINING_FOCUSES.includes(value as TrainingFocus); }
function validatePlan(plan: TrainingPlan, club: Team): void {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).length !== 4 || typeof plan.delegated !== 'boolean' || !TRAINING_INTENSITIES.includes(plan.intensity) || !isFocus(plan.focus)) throw new Error('Choose a valid training plan.');
  if (!plan.individual || typeof plan.individual !== 'object' || Array.isArray(plan.individual) || Object.keys(plan.individual).length !== club.players.length || club.players.some(player => !Object.hasOwn(plan.individual, player.id) || plan.individual[player.id] !== 'team' && !isFocus(plan.individual[player.id]))) throw new Error('Individual training must identify every player in this club exactly once.');
}

export function createTraining(clubs: readonly Team[], enabled = true): SeasonTraining {
  return {
    model: 'training-2', enabledSince: enabled ? { seasonNumber: 1, round: 1 } : null,
    plans: Object.fromEntries(clubs.map(club => [club.id, { delegated: true, intensity: 'standard', focus: 'balanced', individual: Object.fromEntries(club.players.map(player => [player.id, 'team'])) }])),
    points: Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, emptyPoints()]))), lastWeek: null,
  };
}

/** Empty progress for players new to the career (a club joining the full world, step 3.4d-2); existing progress is kept. */
export function withTrainingPoints(training: SeasonTraining, players: readonly Pick<Player, 'id'>[]): SeasonTraining {
  const missing = players.filter(player => !Object.hasOwn(training.points, player.id));
  return missing.length ? { ...training, points: { ...training.points, ...Object.fromEntries(missing.map(player => [player.id, emptyPoints()])) } } : training;
}

/** Project training progress into a new match squad; authored identities stay immutable. */
export function developClub(club: Team, training: SeasonTraining, context: PotentialContext & LifecycleContext): Team {
  return {
    ...club,
    players: club.players.map(player => {
      const headroom = trainingHeadroom({ ...context, training }, player.id);
      return {
        ...player, attributes: applyAgingAttributes(context, player.id, Object.fromEntries(TRAINING_ATTRIBUTES.map(attribute => {
          const points = training.points[player.id]?.[attribute];
          if (!Number.isInteger(points) || points < 0 || points > potentialPointCap(headroom, player.attributes[attribute])) throw new Error('Training progress is outside its supported development limits.');
          return [attribute, Math.min(20, player.attributes[attribute] + Math.floor(points / 100))];
        })) as unknown as PlayerAttributes, context.date ?? ''),
      };
    }),
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
  // Step 3.4a: after a week with a midweek game day, practice runs from that week's last game day, so 1-7 days.
  const days = (end - start) / DAY_MS;
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0, 10) !== fromDate || new Date(end).toISOString().slice(0, 10) !== toDate || !Number.isInteger(days) || days < 1 || days > 7) throw new Error('Training must resolve one seven-day calendar interval (shorter after a midweek game day).');
  return Array.from({ length: days }, (_, index) => new Date(start + (index + 1) * DAY_MS).toISOString().slice(0, 10));
}

export function trainingAvailableDays(injuries: readonly SeasonInjury[], playerId: string, fromDate: string, toDate: string, physio?: SeasonPhysio): number {
  return trainingDates(fromDate, toDate).filter(date => !injuries.some(injury => injury.playerId === playerId && isRecovering(injury, date, physio))).length;
}

export interface TrainingWeekInput {
  /** The career seed: each player's hidden potential limits his progress (`src/world/potential.ts`). */
  seed: number;
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
  lifecycle?: SeasonState['lifecycle'];
  academy?: SeasonState['academy'];
  facilities?: SeasonState['facilities'];
  /** The career's world, for player ages (built-in league when omitted). */
  world?: CareerWorld;
  dataPackId?: string;
}

/** One authoritative weekly pass updates every club; it consumes no match RNG. */
export function processTrainingWeek(input: TrainingWeekInput): { training: SeasonTraining; conditions: Record<string, number> } {
  const { training, clubs, conditions, injuries, seasonNumber, afterRound, fromDate, toDate } = input;
  if (!training.enabledSince) throw new Error('Enable training before resolving a training week.');
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(afterRound) || afterRound < 1 || afterRound > seasonRounds(input) - 1) throw new Error('Training requires a supported season and a matchday before the final one.');
  if (seasonNumber < training.enabledSince.seasonNumber || seasonNumber === training.enabledSince.seasonNumber && afterRound < training.enabledSince.round) throw new Error('Training cannot run before it was enabled.');
  if (training.lastWeek && (seasonNumber < training.lastWeek.seasonNumber || seasonNumber === training.lastWeek.seasonNumber && afterRound <= training.lastWeek.afterRound)) throw new Error('This training interval has already been processed.');
  const dates = trainingDates(fromDate, toDate);
  const nextConditions = { ...conditions }, nextPoints = { ...training.points };
  const appliedCoaching = input.coaching ? coachingAssignments(input.coaching, clubs, seasonNumber, afterRound) : null;
  const appliedFitness = input.fitness ? fitnessAssignments(input.fitness, clubs, seasonNumber, afterRound) : null;
  const rosters = input.rosters ?? createRosterSnapshots(clubs, seasonNumber);
  const report: TrainingWeekReport = { seasonNumber, afterRound, fromDate, toDate, rosterIds: {}, plans: {}, players: {}, coaching: appliedCoaching, ...(appliedFitness ? { fitness: appliedFitness } : {}) };
  const agingActive = !!input.lifecycle?.enabledSince && fromDate >= input.lifecycle.enabledSince.date;
  const facilitiesActive = !!input.facilities?.enabledSince && fromDate >= input.facilities.enabledSince.date;
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
      let condition = conditionBefore, conditionWithoutCoach = conditionBefore, budget = 0, weightedBudget = 0, facilityUnits = 0, availableDays = 0;
      for (const date of dates) {
        const available = !injuries.some(injury => injury.playerId === player.id && isRecovering(injury, date, input.physio));
        if (available) {
          availableDays += 1;
          const practice = condition < 70 ? Math.floor(workload.points / 2) : workload.points;
          budget += practice;
          const ageRate = agingActive ? ageTrainingRate(input, player.id, date) : 10_000;
          weightedBudget += practice * ageRate;
          if (facilitiesActive) facilityUnits += practice * ageRate * facilityPracticeBonusPercent(input, 'training', club.id, date);
        }
        const recoveryBonus = available ? fitness?.recoveryPerDay ?? 0 : 0;
        const practiceCost = available ? workload.cost * (1 - (fitness?.practiceCostReductionPercent ?? 0) / 100) : 0;
        condition = Math.max(35, Math.min(100, Math.round((condition + workload.recovery + recoveryBonus - practiceCost) * 1000) / 1000));
        conditionWithoutCoach = Math.max(35, Math.min(100, Math.round((conditionWithoutCoach + workload.recovery - (available ? workload.cost : 0)) * 1000) / 1000));
      }
      const ordinaryPracticePoints = budget;
      if (agingActive) budget = Math.floor(weightedBudget / 10_000);
      const aging = agingActive ? { ordinaryPracticePoints, adjustedPracticePoints: budget, rateBasisPoints: ordinaryPracticePoints > 0 ? Math.floor(weightedBudget / ordinaryPracticePoints) : ageTrainingRate(input, player.id, toDate) } : undefined;
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
      // Format 74 (`facilities-3`): Very Poor and Poor facilities cost practice. Lost points are whole points, rounded
      // towards zero like earned ones, spread like earned ones, and never take away progress already made.
      const facilityMagnitude = Math.floor(Math.abs(facilityUnits) / 1_000_000), facilitySign = facilityUnits < 0 && facilityMagnitude > 0 ? -1 : 1, facilityPoints = facilitySign * facilityMagnitude;
      const facilityDesired = emptyPoints(), facilityGains = emptyPoints();
      if (focus === 'balanced') {
        for (const key of TRAINING_ATTRIBUTES) facilityDesired[key] = facilitySign * Math.floor(facilityMagnitude / TRAINING_ATTRIBUTES.length);
        for (let index = 0; index < facilityMagnitude % TRAINING_ATTRIBUTES.length; index += 1) facilityDesired[TRAINING_ATTRIBUTES[(afterRound - 1 + budget % TRAINING_ATTRIBUTES.length + index) % TRAINING_ATTRIBUTES.length]!] += facilitySign;
      } else facilityDesired[focus] = facilityPoints;
      const progress = emptyPoints(), headroom = trainingHeadroom(input, player.id);
      for (const attribute of TRAINING_ATTRIBUTES) {
        const points = previous?.[attribute], cap = potentialPointCap(headroom, player.attributes[attribute]);
        if (!Number.isInteger(points) || points < 0 || points > cap) throw new Error('Training progress is outside its supported development limits.');
        const baseProgress = Math.min(cap, points + desired[attribute]);
        const coached = Math.min(cap, baseProgress + bonusDesired[attribute]);
        progress[attribute] = Math.max(points, Math.min(cap, coached + facilityDesired[attribute]));
        coachingGains[attribute] = coached - baseProgress;
        facilityGains[attribute] = progress[attribute] - coached;
        gains[attribute] = progress[attribute] - points;
      }
      nextConditions[player.id] = condition;
      nextPoints[player.id] = progress;
      report.players[player.id] = { focus, intensity: plan.intensity, availableDays, conditionBefore, conditionAfter: condition, gains, coachingGains, ...(appliedFitness ? { fitness: { conditionWithoutCoach, conditionBenefit: Math.round((condition - conditionWithoutCoach) * 1000) / 1000 } } : {}), ...(aging ? { aging } : {}), ...(facilitiesActive ? { facility: { earnedPoints: facilityPoints, gains: facilityGains } } : {}) };
    }
  }
  return { training: { ...training, points: nextPoints, lastWeek: report }, conditions: nextConditions };
}

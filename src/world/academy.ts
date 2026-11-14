import { facilityPracticeBonusPercent } from './facilities-policy';
import type { AcademyGraduate, AcademyWeek, SeasonAcademy } from '../domain/academy';
import type { SeasonState } from '../domain/season';
import type { SeasonYouth } from '../domain/youth';
import type { SeasonYouthCompetition } from '../domain/youth-competition';
import type { Team } from '../domain/types';
import type { TrainingFocus, TrainingPoints } from '../domain/training';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { generateAcademyProspects } from './academy-generation';
import { ACADEMY_GRADUATION_AGE, ACADEMY_WEEKLY_POINTS, academyPointCap, developAcademyPlayer, emptyAcademyPoints, getAcademyCapacity, getAcademyProspect } from './academy-policy';
import { submitInSeasonOffer, withdrawInSeasonOffer } from './recruitment';
import { dateForRound } from './season';
import { TRAINING_ATTRIBUTES, TRAINING_FOCUSES } from './training';
import { youthCoachAssignments } from './youth-policy';
import { getYouthPlayerStatus } from './youth-competition';
import { roundKey, seasonRounds } from './career-world';
import type { CareerWorld } from '../domain/world';

export function createAcademy(): SeasonAcademy { return { model: 'academy-1', enabledSince: null, prospects: [], intakes: [], focus: {}, points: {}, weeks: [], graduates: [] }; }

function intake(state: SeasonState, initial: boolean): SeasonState {
  let academy = state.academy;
  for (const club of state.clubs) {
    if (academy.intakes.some(record => record.clubId === club.id && record.seasonNumber === state.seasonNumber && !record.source)) continue;
    const active = academy.prospects.filter(prospect => prospect.clubId === club.id && !academy.graduates.some(graduate => graduate.prospectId === prospect.player.id)).length;
    const count = initial ? 3 : Math.min(2, Math.max(0, getAcademyCapacity(state) - active));
    const prospects = generateAcademyProspects(state.seed, club.id, state.seasonNumber, state.round, initial, count);
    academy = { ...academy, prospects: [...academy.prospects, ...prospects], intakes: [...academy.intakes, { id: `academy-intake-${academy.intakes.length + 1}`, clubId: club.id, seasonNumber: state.seasonNumber, round: state.round, date: state.date, initial, prospectIds: prospects.map(prospect => prospect.player.id) }], focus: { ...academy.focus, ...Object.fromEntries(prospects.map(prospect => [prospect.player.id, 'balanced' as const])) }, points: { ...academy.points, ...Object.fromEntries(prospects.map(prospect => [prospect.player.id, emptyAcademyPoints()])) } };
  }
  return academy === state.academy ? state : { ...state, academy };
}

/** A future-only opt-in; prospects do not enter senior rosters or salary commitments yet. */
export function enableAcademy(state: SeasonState): SeasonState {
  if (state.academy.enabledSince) return state;
  if (!state.recruitment.enabledSince || !state.finance.enabledSince || !state.employment.enabledSince || !state.payroll.enabledSince || !state.negotiations.enabledSince) throw new Error('Enable finances, player contracts, payroll and in-season recruitment before the academy.');
  if (state.status !== 'active' || state.round === seasonRounds(state)) throw new Error('Enable the academy before the final matchday, or start the next season.');
  const academy = { ...state.academy, enabledSince: { seasonNumber: state.seasonNumber, round: state.round, ledgerIndex: state.finance.ledger.length, contractCount: state.employment.contracts.length, negotiationCount: state.negotiations.records.length } };
  return intake({ ...state, academy }, true);
}

export function setAcademyFocus(state: SeasonState, playerId: string, focus: TrainingFocus): SeasonState {
  const prospect = getAcademyProspect(state, playerId);
  if (!prospect || prospect.clubId !== state.managedClubId) throw new Error('Choose a current prospect in your academy.');
  if (state.status !== 'active' || state.round === seasonRounds(state)) throw new Error('Academy development resumes with the next season.');
  if (!TRAINING_FOCUSES.includes(focus)) throw new Error('Choose a supported academy training focus.');
  return state.academy.focus[playerId] === focus ? state : { ...state, academy: { ...state.academy, focus: { ...state.academy.focus, [playerId]: focus } } };
}
export function offerAcademyPromotion(state: SeasonState, playerId: string, seasonWage: number, clubId = state.managedClubId): SeasonState {
  return submitInSeasonOffer(state, playerId, seasonWage, clubId, {}, playerId);
}
export function cancelAcademyPromotion(state: SeasonState, offerId: string): SeasonState {
  const offer = state.recruitment.offers.find(offer => offer.id === offerId);
  if (!offer?.academyProspectId) throw new Error('Choose a pending academy promotion offer.');
  return withdrawInSeasonOffer(state, offerId);
}

/** Called inside accepted recruitment resolution, before payroll and grouped registration. */
export function graduateAcademyProspect(state: SeasonState, playerId: string, kind: AcademyGraduate['kind'], offerId: string | null = null, contractId: string | null = null): SeasonState {
  const prospect = getAcademyProspect(state, playerId);
  if (!prospect || !['promotion', 'age-out'].includes(kind)) throw new Error('Choose an active academy prospect to graduate.');
  if (kind === 'promotion') {
    const offer = state.recruitment.offers.find(offer => offer.id === offerId), contract = state.employment.contracts.find(contract => contract.id === contractId);
    if (!offer || offer.status !== 'pending' || offer.academyProspectId !== playerId || offer.clubId !== prospect.clubId || offer.responseRound !== state.round || !contract || contract.playerId !== playerId || contract.clubId !== prospect.clubId || contract.kind !== 'midseason' || contract.startsSeason !== state.seasonNumber || contract.startsRound !== state.round) throw new Error('Graduate a promoted prospect only with his accepted next-matchday contract.');
  } else if (state.round !== 1 || playerAgeOnDate(prospect.dateOfBirth, state.date)! < ACADEMY_GRADUATION_AGE || offerId !== null || contractId !== null) throw new Error('Release over-age prospects only on the new season opening day.');
  const sourcePoints = { ...state.academy.points[playerId]! };
  const medical = kind === 'promotion' && state.youthCompetition?.enabledSince ? getYouthPlayerStatus(state, playerId) : null;
  if (medical?.injury) throw new Error('This academy player must recover before joining the senior squad.');
  const condition = medical?.condition ?? 100;
  const graduate: AcademyGraduate = { id: `academy-graduate-${state.academy.graduates.length + 1}`, prospectId: playerId, player: developAcademyPlayer(prospect, sourcePoints), dateOfBirth: prospect.dateOfBirth, seasonWage: prospect.seasonWage, clubId: prospect.clubId, availableSince: { seasonNumber: state.seasonNumber, round: state.round }, graduatedOn: state.date, kind, sourcePoints, offerId, contractId, ...(medical ? { condition } : {}) };
  if (Object.hasOwn(state.conditions, playerId) || Object.hasOwn(state.training.points, playerId)) throw new Error('A graduate must enter senior condition and development exactly once.');
  return { ...state, academy: { ...state.academy, graduates: [...state.academy.graduates, graduate] }, conditions: { ...state.conditions, [playerId]: condition }, training: { ...state.training, points: { ...state.training.points, [playerId]: emptyAcademyPoints() } } };
}

export function prepareAcademySeason(state: SeasonState): SeasonState {
  if (!state.academy.enabledSince) return state;
  if (state.status !== 'active' || state.round !== 1) throw new Error('Prepare academy intake on the new season opening day.');
  let next = state;
  for (const prospect of state.academy.prospects) if (getAcademyProspect(next, prospect.player.id) && playerAgeOnDate(prospect.dateOfBirth, state.date)! >= ACADEMY_GRADUATION_AGE) next = graduateAcademyProspect(next, prospect.player.id, 'age-out');
  return intake(next, false);
}

export interface AcademyWeekInput { facilities?: SeasonState['facilities']; academy: SeasonAcademy; youth: SeasonYouth; youthCompetition?: SeasonYouthCompetition; clubs: readonly Pick<Team, 'id'>[]; seasonNumber: number; afterRound: number; fromDate: string; toDate: string; /** Matchdays in the season. */ rounds: number; /** The career's world (built-in league when omitted). */ world?: CareerWorld }
/** One real calendar interval; youth sessions do not borrow senior fixtures or match RNG. */
export function processAcademyWeek(input: AcademyWeekInput): SeasonAcademy {
  const { academy, youth, clubs, seasonNumber, afterRound, fromDate, toDate, rounds } = input;
  if (!academy.enabledSince) return academy;
  const at = roundKey(seasonNumber, afterRound), enabled = roundKey(academy.enabledSince.seasonNumber, academy.enabledSince.round);
  if (!Number.isInteger(afterRound) || afterRound < 1 || afterRound > rounds - 1 || fromDate !== dateForRound(afterRound, seasonNumber) || toDate !== dateForRound(afterRound + 1, seasonNumber) || at < enabled) throw new Error('Academy development needs an enabled, real between-matchday week.');
  if (academy.weeks.some(week => roundKey(week.seasonNumber, week.afterRound) >= at)) throw new Error('This academy interval has already been processed.');
  const previous = academy.weeks.at(-1);
  const expectedYear = previous ? previous.afterRound === rounds - 1 ? previous.seasonNumber + 1 : previous.seasonNumber : academy.enabledSince.seasonNumber;
  const expectedRound = previous ? previous.afterRound === rounds - 1 ? 1 : previous.afterRound + 1 : academy.enabledSince.round;
  if (seasonNumber !== expectedYear || afterRound !== expectedRound) throw new Error('Process every academy training interval in calendar order.');
  const coaches = youthCoachAssignments(youth, clubs, seasonNumber, afterRound);
  const points = { ...academy.points };
  const week: AcademyWeek = { id: `academy-week-${academy.weeks.length + 1}`, seasonNumber, afterRound, fromDate, toDate, coaches, players: {} };
  for (const prospect of academy.prospects) {
    const id = prospect.player.id;
    if (roundKey(prospect.intakeSeason, prospect.intakeRound) > at || academy.graduates.some(graduate => graduate.prospectId === id && roundKey(graduate.availableSince.seasonNumber, graduate.availableSince.round) <= at)) continue;
    if (!clubs.some(club => club.id === prospect.clubId)) throw new Error('Academy development requires each prospect\'s registered academy club.');
    const focus = academy.focus[id]!;
    if (!TRAINING_FOCUSES.includes(focus)) throw new Error('Every prospect needs a supported development focus.');
    const before = academy.points[id]!, gains = emptyAcademyPoints(), coachingGains = emptyAcademyPoints(), after = emptyAcademyPoints();
    const base = emptyAcademyPoints(), bonus = emptyAcademyPoints();
    const competition = input.youthCompetition?.enabledSince && input.youthCompetition.enabledSince.date <= fromDate;
    const eligibleDates = Array.from({ length: 7 }, (_, index) => new Date(Date.parse(`${fromDate}T00:00:00Z`) + (index + 1) * 86_400_000).toISOString().slice(0, 10)).filter(date => !competition || getYouthPlayerStatus(input, id, date).available);
    const availableDays = eligibleDates.length;
    const ordinaryPoints = competition ? 4 * availableDays : ACADEMY_WEEKLY_POINTS;
    const availability = competition ? { availableDays, conditionBefore: getYouthPlayerStatus(input, id, fromDate).condition, conditionAfter: getYouthPlayerStatus(input, id, toDate).condition } : undefined;
    const bonusTotal = Math.floor(ordinaryPoints * (coaches[prospect.clubId]?.bonusPercent ?? 0) / 100);
    const allocate = (amount: number, target: TrainingPoints, offset: number) => {
      if (focus !== 'balanced') target[focus] = amount;
      else { for (const key of TRAINING_ATTRIBUTES) target[key] = Math.floor(amount / TRAINING_ATTRIBUTES.length); for (let n = 0; n < amount % TRAINING_ATTRIBUTES.length; n += 1) target[TRAINING_ATTRIBUTES[(afterRound - 1 + offset + n) % TRAINING_ATTRIBUTES.length]!] += 1; }
    };
    allocate(ordinaryPoints, base, 0); allocate(bonusTotal, bonus, ordinaryPoints % TRAINING_ATTRIBUTES.length);
    const facilitiesActive = !!input.facilities?.enabledSince && input.facilities.enabledSince.date <= fromDate;
    const facilityPoints = facilitiesActive ? Math.floor(eligibleDates.reduce((sum, date) => sum + 4 * facilityPracticeBonusPercent(input, 'youth', prospect.clubId, date), 0) / 100) : 0;
    const facilityDesired = emptyAcademyPoints(), facilityGains = emptyAcademyPoints();
    allocate(facilityPoints, facilityDesired, ordinaryPoints % TRAINING_ATTRIBUTES.length);
    for (const key of TRAINING_ATTRIBUTES) {
      const cap = academyPointCap(prospect.player.attributes[key]);
      if (!Number.isInteger(before[key]) || before[key] < 0 || before[key] > cap) throw new Error('Academy development exceeds its supported limits.');
      const withoutCoach = Math.min(cap, before[key] + base[key]);
      const coached = Math.min(cap, withoutCoach + bonus[key]);
      after[key] = Math.min(cap, coached + facilityDesired[key]);
      gains[key] = after[key] - before[key]; coachingGains[key] = coached - withoutCoach;
      facilityGains[key] = after[key] - coached;
    }
    points[id] = after;
    week.players[id] = { clubId: prospect.clubId, focus, pointsBefore: { ...before }, gains, coachingGains, pointsAfter: { ...after }, ...(availability ? { availability } : {}), ...(facilitiesActive ? { facility: { earnedPoints: facilityPoints, gains: facilityGains } } : {}) };
  }
  return { ...academy, points, weeks: [...academy.weeks, week] };
}

/** Historical journals must not see future intakes, training or unaccepted promotions. */
export function academyAtBoundary(academy: SeasonAcademy, seasonNumber: number, round: number, contractCountPrefix?: number, intakeCountPrefix = academy.intakes.length): SeasonAcademy {
  const at = roundKey(seasonNumber, round);
  if (!academy.enabledSince || roundKey(academy.enabledSince.seasonNumber, academy.enabledSince.round) > at) return createAcademy();
  const intakes = academy.intakes.slice(0, intakeCountPrefix).filter(record => roundKey(record.seasonNumber, record.round) <= at);
  const retainedIds = new Set(intakes.flatMap(intake => intake.prospectIds));
  const prospects = academy.prospects.filter(prospect => roundKey(prospect.intakeSeason, prospect.intakeRound) <= at && retainedIds.has(prospect.player.id));
  const ids = new Set(prospects.map(prospect => prospect.player.id));
  const weeks = academy.weeks.filter(week => roundKey(week.seasonNumber, week.afterRound) < at);
  const points = Object.fromEntries(prospects.map(prospect => [prospect.player.id, emptyAcademyPoints()]));
  const focus = Object.fromEntries(prospects.map(prospect => [prospect.player.id, academy.focus[prospect.player.id]!])) as Record<string, TrainingFocus>;
  for (const week of weeks) for (const [id, report] of Object.entries(week.players)) if (ids.has(id)) points[id] = { ...report.pointsAfter };
  const graduates = academy.graduates.filter(graduate => roundKey(graduate.availableSince.seasonNumber, graduate.availableSince.round) <= at && (graduate.kind === 'age-out' || contractCountPrefix === undefined || Number(graduate.contractId?.replace('employment-contract-', '')) <= contractCountPrefix));
  return { ...academy, prospects, intakes, weeks, graduates: graduates.filter(graduate => ids.has(graduate.prospectId)), points, focus };
}

import type { SeasonState } from '../domain/season';
import type { SeasonCoaching } from '../domain/coaching';
import { DEVELOPMENT_ASSISTANTS } from '../data/development-assistants';
import { DEVELOPMENT_FITNESS_COACHES } from '../data/development-fitness';
import { DEVELOPMENT_PHYSIOS } from '../data/development-physios';
import { DEVELOPMENT_SCOUTS } from '../data/development-scouts';
import { DEVELOPMENT_YOUTH_COACHES } from '../data/development-youth';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY, staffMember } from '../data/staff-directory';
import { coachRating, coachRatingRange } from './coaching';
import { scoutRating } from './scout-policy';
import { fitnessRating } from './fitness-policy';
import { physioRating } from './physio-policy';
import { assistantRating } from './assistant-policy';
import { youthCoachRating } from './youth-policy';
import { ratingRange, staffTargetRating, type StaffRole } from './staff-levels';
import { staffReach, SURPLUS_SPENDING_RULES } from './surplus-spending';

type Rated = { id: string };
const ROLES: Readonly<Record<StaffRole, { directory: readonly Rated[]; rating: (member: never) => number; range: () => readonly [number, number] }>> = {
  coaches: { directory: COACH_DIRECTORY, rating: coachRating as (member: never) => number, range: coachRatingRange },
  scouts: { directory: SCOUT_DIRECTORY, rating: scoutRating as (member: never) => number, range: once(() => ratingRange(DEVELOPMENT_SCOUTS, scoutRating)) },
  fitness: { directory: FITNESS_DIRECTORY, rating: fitnessRating as (member: never) => number, range: once(() => ratingRange(DEVELOPMENT_FITNESS_COACHES, fitnessRating)) },
  physio: { directory: PHYSIO_DIRECTORY, rating: physioRating as (member: never) => number, range: once(() => ratingRange(DEVELOPMENT_PHYSIOS, physioRating)) },
  assistant: { directory: ASSISTANT_DIRECTORY, rating: assistantRating as (member: never) => number, range: once(() => ratingRange(DEVELOPMENT_ASSISTANTS, assistantRating)) },
  youth: { directory: YOUTH_COACH_DIRECTORY, rating: youthCoachRating as (member: never) => number, range: once(() => ratingRange(DEVELOPMENT_YOUTH_COACHES, youthCoachRating)) },
};
function once<T>(compute: () => T): () => T { let value: T | undefined; return () => value ??= compute(); }

/**
 * Format 88: whether a computer club spending from its surplus lets a person go at the end of his contract to hire
 * better (`previous`: the ending season's staff and their contract terms): his contract has ended (no term reaches the
 * new season, so no compensation is due) and his rating is more than `staffUpgradeGap` of the role's rating range below
 * the higher rating the club now aims at (`staffTargetRating` with its reach). The role is then filled again at that aim,
 * within its staff budget share and Wages left. False otherwise.
 */
export function staffUpgradeCheck(state: SeasonState, previous: SeasonCoaching): (clubId: string, role: StaffRole, personId: string) => boolean {
  return (clubId, role, personId) => {
    if (staffReach(state, clubId) <= 0) return false;
    const term = previous.terms?.[personId];
    if (term && term.clubId === clubId && term.untilSeason >= state.seasonNumber) return false;
    const spec = ROLES[role], member = staffMember(spec.directory, personId);
    if (!member) return false;
    const range = spec.range();
    return spec.rating(member as never) < staffTargetRating(state, clubId, role, range) - SURPLUS_SPENDING_RULES.staffUpgradeGap * (range[1] - range[0]);
  };
}

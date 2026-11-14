import type { AcademyProspect, AcademyWeek, AcademyWeekPlayer } from '../domain/academy';
import type { SeasonState } from '../domain/season';
import type { Player, PlayerAttributes } from '../domain/types';
import type { TrainingFocus, TrainingPoints } from '../domain/training';
import type { InSeasonOffer, InSeasonOfferQuote } from '../domain/recruitment';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { getInSeasonOffers, quoteInSeasonOffer } from './recruitment-policy';
import { TRAINING_ATTRIBUTES } from './training';
import { roundKey } from './career-world';

export const ACADEMY_CAPACITY = 6;
export const YOUTH_ACADEMY_CAPACITY = 8;
export function getAcademyCapacity(state: Partial<Pick<SeasonState, 'youthCompetition'>>): number { return state.youthCompetition?.enabledSince ? YOUTH_ACADEMY_CAPACITY : ACADEMY_CAPACITY; }
export const ACADEMY_WEEKLY_POINTS = 28;
export const ACADEMY_GRADUATION_AGE = 21;
export function academyPointCap(base: number): number { return Math.min(300, (20 - base) * 100); }
export function emptyAcademyPoints(): TrainingPoints { return Object.fromEntries(TRAINING_ATTRIBUTES.map(key => [key, 0])) as TrainingPoints; }

export function getAcademyProspect(state: Pick<SeasonState, 'academy' | 'seasonNumber' | 'round'>, playerId: string): AcademyProspect | null {
  if (!state.academy.enabledSince) return null;
  const at = roundKey(state.seasonNumber, state.round);
  return state.academy.prospects.find(prospect => prospect.player.id === playerId && roundKey(prospect.intakeSeason, prospect.intakeRound) <= at && !state.academy.graduates.some(graduate => graduate.prospectId === playerId && roundKey(graduate.availableSince.seasonNumber, graduate.availableSince.round) <= at)) ?? null;
}
export function developAcademyPlayer(prospect: AcademyProspect, points: TrainingPoints): Player {
  return { ...prospect.player, attributes: Object.fromEntries(TRAINING_ATTRIBUTES.map(key => {
    const progress = points[key];
    if (!Number.isInteger(progress) || progress < 0 || progress > academyPointCap(prospect.player.attributes[key])) throw new Error('Academy development is outside its supported limits.');
    return [key, prospect.player.attributes[key] + Math.floor(progress / 100)];
  })) as unknown as PlayerAttributes };
}

export interface AcademyPlayerView {
  prospect: AcademyProspect;
  player: Player;
  age: number;
  focus: TrainingFocus;
  points: TrainingPoints;
  lastWeek: { week: AcademyWeek; player: AcademyWeekPlayer } | null;
  pendingOffer: InSeasonOffer | null;
}
export function getClubAcademy(state: SeasonState, clubId = state.managedClubId): AcademyPlayerView[] {
  return state.academy.prospects.filter(prospect => prospect.clubId === clubId && getAcademyProspect(state, prospect.player.id)).map(prospect => {
    const id = prospect.player.id, points = state.academy.points[id]!;
    const week = state.academy.weeks.filter(week => Object.hasOwn(week.players, id)).at(-1);
    return { prospect, player: developAcademyPlayer(prospect, points), age: playerAgeOnDate(prospect.dateOfBirth, state.date)!, focus: state.academy.focus[id]!, points, lastWeek: week ? { week, player: week.players[id]! } : null, pendingOffer: getInSeasonOffers(state, clubId, true).find(offer => offer.academyProspectId === id) ?? null };
  });
}
export function getAcademyPlayer(state: SeasonState, playerId: string): AcademyPlayerView | null {
  const prospect = getAcademyProspect(state, playerId);
  return prospect ? getClubAcademy(state, prospect.clubId).find(row => row.player.id === playerId) ?? null : null;
}
export function quoteAcademyPromotion(state: SeasonState, playerId: string, seasonWage: number, clubId = state.managedClubId): InSeasonOfferQuote {
  return quoteInSeasonOffer(state, playerId, seasonWage, clubId, undefined, {}, playerId);
}

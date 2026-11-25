import type { AcademyProspect, AcademyWeek, AcademyWeekFullPlayer } from '../domain/academy';
import { isAcademyOutcome } from './academy-history';
import type { SeasonState } from '../domain/season';
import { storedExtras } from './extra-attributes';
import type { Player, PlayerAttributes } from '../domain/types';
import type { TrainingFocus, TrainingPoints } from '../domain/training';
import type { InSeasonOffer, InSeasonOfferQuote } from '../domain/recruitment';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { getInSeasonOffers, quoteInSeasonOffer } from './recruitment-policy';
import { TRAINING_ATTRIBUTES } from './training';
import { roundKey } from './career-world';
import { growthShares, splitByShares } from './position-profiles';
import type { CareerWorld } from '../domain/world';

export const ACADEMY_CAPACITY = 6;
export const YOUTH_ACADEMY_CAPACITY = 8;
export function getAcademyCapacity(state: Partial<Pick<SeasonState, 'youthCompetition'>>): number { return state.youthCompetition?.enabledSince ? YOUTH_ACADEMY_CAPACITY : ACADEMY_CAPACITY; }
export const ACADEMY_WEEKLY_POINTS = 28;
export const ACADEMY_GRADUATION_AGE = 21;
export function academyPointCap(base: number): number { return Math.min(300, (20 - base) * 100); }

/**
 * Format 108 (owner decision 25 November 2026, new careers with position profiles, `world.academyPositionTraining`):
 * academy practice follows the prospect's position, as a senior balanced week does since format 106. A balanced academy
 * week splits its points by the position's real development shares (`growthShares`, European leagues: academies belong
 * to European clubs), and each skill's academy limit is the position's share of the same whole allowance as before
 * (seven skills of three points: 21 points), so a centre can still gain 21 points in the academy, but five in two-point
 * shooting and defence and one in three-point shooting, free throws and passing, instead of three in every skill. A
 * skill never passes 20. A focus week still trains its one skill, up to that skill's limit.
 */
export const ACADEMY_POSITION_TRAINING = Object.freeze({ allowance: 21, region: 'europe' as const });
/** Whether the career's world shapes academy practice by position (format 108; pass the career's stored world). */
export function usesAcademyPositionTraining(world: Pick<CareerWorld, 'academyPositionTraining'> | undefined): boolean {
  return world?.academyPositionTraining === true;
}
/** Format 108: a position's balanced academy shares in basis points (those of a senior balanced week in Europe). */
export function academyShares(position: Player['position']): Readonly<TrainingPoints> {
  return growthShares(ACADEMY_POSITION_TRAINING.region, position);
}
/** A prospect's academy limit for one skill in practice points: 300 (three points) before format 108, the position's share after. */
export function academySkillCap(player: Pick<Player, 'position' | 'attributes'>, key: keyof TrainingPoints, world: Pick<CareerWorld, 'academyPositionTraining'> | undefined): number {
  const base = player.attributes[key];
  if (!usesAcademyPositionTraining(world)) return academyPointCap(base);
  return Math.max(0, Math.min(splitByShares(ACADEMY_POSITION_TRAINING.allowance, academyShares(player.position), 0)[key] * 100, (20 - base) * 100));
}
export function emptyAcademyPoints(): TrainingPoints { return Object.fromEntries(TRAINING_ATTRIBUTES.map(key => [key, 0])) as TrainingPoints; }

export function getAcademyProspect(state: Pick<SeasonState, 'academy' | 'seasonNumber' | 'round'>, playerId: string): AcademyProspect | null {
  if (!state.academy.enabledSince) return null;
  const at = roundKey(state.seasonNumber, state.round);
  return state.academy.prospects.find(prospect => prospect.player.id === playerId && roundKey(prospect.intakeSeason, prospect.intakeRound) <= at && !state.academy.graduates.some(graduate => graduate.prospectId === playerId && roundKey(graduate.availableSince.seasonNumber, graduate.availableSince.round) <= at)) ?? null;
}
/** The prospect with his academy progress; `world` is the career's stored world (format 108 limits). */
export function developAcademyPlayer(prospect: AcademyProspect, points: TrainingPoints, world: Pick<CareerWorld, 'academyPositionTraining'> | undefined): Player {
  return { ...prospect.player, attributes: { ...Object.fromEntries(TRAINING_ATTRIBUTES.map(key => {
    const progress = points[key];
    if (!Number.isInteger(progress) || progress < 0 || progress > academySkillCap(prospect.player, key, world)) throw new Error('Academy development is outside its supported limits.');
    return [key, prospect.player.attributes[key] + Math.floor(progress / 100)];
  })), ...storedExtras(prospect.player.attributes) } as PlayerAttributes };
}

export interface AcademyPlayerView {
  prospect: AcademyProspect;
  player: Player;
  age: number;
  focus: TrainingFocus;
  points: TrainingPoints;
  lastWeek: { week: AcademyWeek; player: AcademyWeekFullPlayer } | null;
  pendingOffer: InSeasonOffer | null;
}
export function getClubAcademy(state: SeasonState, clubId = state.managedClubId): AcademyPlayerView[] {
  return state.academy.prospects.filter(prospect => prospect.clubId === clubId && getAcademyProspect(state, prospect.player.id)).map(prospect => {
    const id = prospect.player.id, points = state.academy.points[id]!;
    const week = state.academy.weeks.filter(week => Object.hasOwn(week.players, id)).at(-1);
    const report = week?.players[id];
    const lastWeek = week && report && !isAcademyOutcome(report) ? { week, player: report } : null;
    return { prospect, player: developAcademyPlayer(prospect, points, state.world), age: playerAgeOnDate(prospect.dateOfBirth, state.date)!, focus: state.academy.focus[id]!, points, lastWeek, pendingOffer: getInSeasonOffers(state, clubId, true).find(offer => offer.academyProspectId === id) ?? null };
  });
}
export function getAcademyPlayer(state: SeasonState, playerId: string): AcademyPlayerView | null {
  const prospect = getAcademyProspect(state, playerId);
  return prospect ? getClubAcademy(state, prospect.clubId).find(row => row.player.id === playerId) ?? null : null;
}
export function quoteAcademyPromotion(state: SeasonState, playerId: string, seasonWage: number, clubId = state.managedClubId): InSeasonOfferQuote {
  return quoteInSeasonOffer(state, playerId, seasonWage, clubId, undefined, {}, playerId);
}

import type { PlayerAging, RetirementNotice } from '../domain/lifecycle';
import type { SeasonState } from '../domain/season';
import type { PlayerAttributes } from '../domain/types';
import type { TrainingPoints } from '../domain/training';
import { DEVELOPMENT_PLAYER_PROFILES, playerAgeOnDate } from '../data/development-player-profiles';

export type LifecycleContext = Partial<Pick<SeasonState, 'lifecycle' | 'academy' | 'seasonNumber' | 'round' | 'date'>>;
const ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
const DAY_MS = 86_400_000;
export const MIN_LIFECYCLE_POPULATION = 60;
export const MAX_PENDING_CLUB_RETIREMENTS = 2;
export const AGING_RATES: Readonly<Record<keyof PlayerAttributes, { fromAge: number; annualPoints: number }>> = {
  twoPoint: { fromAge: 35, annualPoints: 10 }, threePoint: { fromAge: 35, annualPoints: 10 },
  freeThrow: { fromAge: 35, annualPoints: 10 }, passing: { fromAge: 35, annualPoints: 10 },
  defense: { fromAge: 32, annualPoints: 20 }, rebounding: { fromAge: 32, annualPoints: 20 },
  stamina: { fromAge: 30, annualPoints: 40 },
};
const zeroPoints = (): TrainingPoints => Object.fromEntries(ATTRIBUTES.map(key => [key, 0])) as TrainingPoints;
const dateNumber = (date: string): number => {
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid player-development date.');
  return value;
};

export function lifecycleDateOfBirth(context: LifecycleContext, playerId: string): string | null {
  return DEVELOPMENT_PLAYER_PROFILES[playerId]?.dateOfBirth ?? context.academy?.prospects.find(prospect => prospect.player.id === playerId)?.dateOfBirth ?? null;
}

/** Match the public calendar-age convention: leap-day birthdays fall on March 1 otherwise. */
function birthday(dateOfBirth: string, age: number): string {
  const year = Number(dateOfBirth.slice(0, 4)) + age;
  if (year > 9999) return '9999-12-31';
  const month = Number(dateOfBirth.slice(5, 7)), day = Number(dateOfBirth.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) return `${String(year).padStart(4, '0')}-03-01`;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function agingStart(context: LifecycleContext, playerId: string, onDate: string): string | null {
  const anchor = context.lifecycle?.enabledSince;
  if (!anchor || onDate < anchor.date) return null;
  if (DEVELOPMENT_PLAYER_PROFILES[playerId]) return anchor.date;
  const graduate = context.academy?.graduates.find(entry => entry.player.id === playerId && entry.graduatedOn <= onDate);
  return graduate ? (graduate.graduatedOn > anchor.date ? graduate.graduatedOn : anchor.date) : null;
}

export function getPlayerRetirement(context: LifecycleContext, playerId: string, onDate = context.date ?? '9999-12-31'): { status: 'active' | 'announced' | 'retired'; notice: RetirementNotice | null } {
  const notice = context.lifecycle?.enabledSince ? context.lifecycle.notices.find(entry => entry.playerId === playerId && entry.announcedOn <= onDate) ?? null : null;
  return { status: !notice ? 'active' : onDate >= notice.retiredOn ? 'retired' : 'announced', notice };
}

export function isPlayerRetired(context: LifecycleContext, playerId: string, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? 10): boolean {
  return !!context.lifecycle?.enabledSince && context.lifecycle.notices.some(notice => notice.playerId === playerId && notice.announcedSeason * 10 + notice.announcedRound <= seasonNumber * 10 + round && notice.retirementSeason <= seasonNumber);
}

export function retirementContractReason(context: LifecycleContext, playerId: string, endsSeason: number): string | null {
  const notice = getPlayerRetirement(context, playerId).notice;
  if (!notice) return null;
  if (isPlayerRetired(context, playerId)) return 'This player has retired from senior basketball.';
  return endsSeason > notice.lastSeason ? `This player will retire after season ${notice.lastSeason}; his contract cannot extend beyond that season.` : null;
}

/** A separate deterministic stream: retirement planning never consumes match randomness. */
export function retirementTargetAge(seed: number, playerId: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of `retirement:${playerId}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return 37 + hash % 4;
}

/** Smooth age curves affect real practice only, expressed in integer basis points. */
export function ageTrainingRate(context: LifecycleContext, playerId: string, onDate: string): number {
  const dateOfBirth = lifecycleDateOfBirth(context, playerId);
  if (!dateOfBirth || !agingStart(context, playerId, onDate)) return 10_000;
  if (getPlayerRetirement(context, playerId, onDate).status === 'retired') return 0;
  const at = dateNumber(onDate), at16 = dateNumber(birthday(dateOfBirth, 16)), at23 = dateNumber(birthday(dateOfBirth, 23)), at29 = dateNumber(birthday(dateOfBirth, 29)), at39 = dateNumber(birthday(dateOfBirth, 39));
  if (at <= at16) return 12_500;
  if (at < at23) return 12_500 - Math.floor(2_500 * (at - at16) / (at23 - at16));
  if (at <= at29) return 10_000;
  if (at < at39) return 10_000 - Math.floor(5_000 * (at - at29) / (at39 - at29));
  return 5_000;
}

export function getPlayerAging(context: LifecycleContext, playerId: string, onDate = context.date ?? ''): PlayerAging {
  dateNumber(onDate);
  const dateOfBirth = lifecycleDateOfBirth(context, playerId), startedOn = agingStart(context, playerId, onDate);
  const lossPoints = zeroPoints(), skillLoss = zeroPoints();
  const retirement = getPlayerRetirement(context, playerId, onDate);
  const until = retirement.status === 'retired' ? retirement.notice!.retiredOn : onDate;
  if (startedOn && dateOfBirth) for (const key of ATTRIBUTES) {
    const rule = AGING_RATES[key], threshold = birthday(dateOfBirth, rule.fromAge);
    const from = threshold > startedOn ? threshold : startedOn;
    const days = Math.max(0, Math.round((dateNumber(until) - dateNumber(from)) / DAY_MS));
    // 365.25-day year, integer hundredths; no annual or birthday jump is awarded.
    lossPoints[key] = Math.floor(days * rule.annualPoints * 4 / 1461);
    skillLoss[key] = Math.floor(lossPoints[key] / 100);
  }
  return { active: startedOn !== null, age: playerAgeOnDate(dateOfBirth, onDate), asOf: onDate, startedOn, trainingPercent: ageTrainingRate(context, playerId, onDate) / 100, lossPoints, skillLoss };
}

/** Combine dated decline with already developed skills without changing the authored base. */
export function applyAgingAttributes(context: LifecycleContext, playerId: string, attributes: PlayerAttributes, onDate: string): PlayerAttributes {
  if (!context.lifecycle?.enabledSince || onDate < context.lifecycle.enabledSince.date) return { ...attributes };
  const aging = getPlayerAging(context, playerId, onDate);
  return Object.fromEntries(ATTRIBUTES.map(key => [key, Math.max(1, Math.min(20, attributes[key] - aging.skillLoss[key]))])) as unknown as PlayerAttributes;
}

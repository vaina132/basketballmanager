import type { PlayerAging, RetirementNotice } from '../domain/lifecycle';
import type { SeasonState } from '../domain/season';
import type { ExtraAttributes, PlayerAttributes, SkillAttributes } from '../domain/types';
import { EXTRA_AGING, EXTRA_ATTRIBUTES, hasExtraAttributes } from './extra-attributes';
import type { TrainingPoints } from '../domain/training';
import type { WorldContext } from '../domain/world';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { roundKey, seasonRounds, worldOf } from './career-world';
import { memoizePure } from './pure-cache';
import { draftDateOfBirth, draftProspect } from './draft-index';
import { birthdaySetback, declineBetween, developmentTraits, fractionalAge, playerGrowthRate, usesPlayerDevelopment } from './player-development';
import { DEFAULT_PLAYER_AGE } from '../data/development-player-profiles';

export type LifecycleContext = Partial<Pick<SeasonState, 'lifecycle' | 'academy' | 'seasonNumber' | 'round' | 'date' | 'draft' | 'seed'>> & WorldContext;
/** An original player's profile in the career's world, if the player is one. */
const originalProfile = (context: LifecycleContext, playerId: string) => { const profiles = worldOf(context).playerProfiles; return Object.hasOwn(profiles, playerId) ? profiles[playerId] : undefined; };
const ATTRIBUTES = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
const DAY_MS = 86_400_000;
export const MIN_LIFECYCLE_POPULATION = 60;
export const MAX_PENDING_CLUB_RETIREMENTS = 2;
export const AGING_RATES: Readonly<Record<keyof SkillAttributes, { fromAge: number; annualPoints: number }>> = {
  twoPoint: { fromAge: 35, annualPoints: 10 }, threePoint: { fromAge: 35, annualPoints: 10 },
  freeThrow: { fromAge: 35, annualPoints: 10 }, passing: { fromAge: 35, annualPoints: 10 },
  defense: { fromAge: 32, annualPoints: 20 }, rebounding: { fromAge: 32, annualPoints: 20 },
  stamina: { fromAge: 30, annualPoints: 40 },
};
const zeroPoints = (): TrainingPoints => Object.fromEntries(ATTRIBUTES.map(key => [key, 0])) as TrainingPoints;
// Pure calendar conversions are replayed for every player-week during save validation, so they are cached.
const dateNumber = memoizePure((date: string): number => {
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid player-development date.');
  return value;
});

export function lifecycleDateOfBirth(context: LifecycleContext, playerId: string): string | null {
  return originalProfile(context, playerId)?.dateOfBirth ?? context.academy?.prospects.find(prospect => prospect.player.id === playerId)?.dateOfBirth ?? draftDateOfBirth(context, playerId);
}

/** Match the public calendar-age convention: leap-day birthdays fall on March 1 otherwise. */
const birthdays = memoizePure((key: string): string => {
  const separator = key.indexOf('|'), dateOfBirth = key.slice(0, separator), age = Number(key.slice(separator + 1));
  const year = Number(dateOfBirth.slice(0, 4)) + age;
  if (year > 9999) return '9999-12-31';
  const month = Number(dateOfBirth.slice(5, 7)), day = Number(dateOfBirth.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) return `${String(year).padStart(4, '0')}-03-01`;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
});
function birthday(dateOfBirth: string, age: number): string { return birthdays(`${dateOfBirth}|${age}`); }

function agingStart(context: LifecycleContext, playerId: string, onDate: string): string | null {
  const anchor = context.lifecycle?.enabledSince;
  if (!anchor || onDate < anchor.date) return null;
  if (originalProfile(context, playerId)) return anchor.date;
  // NBA step 8: a draft prospect ages from his draft day.
  const drafted = draftProspect(context, playerId);
  if (drafted) return drafted.date <= onDate ? (drafted.date > anchor.date ? drafted.date : anchor.date) : null;
  const graduate = context.academy?.graduates.find(entry => entry.player.id === playerId && entry.graduatedOn <= onDate);
  return graduate ? (graduate.graduatedOn > anchor.date ? graduate.graduatedOn : anchor.date) : null;
}

export function getPlayerRetirement(context: LifecycleContext, playerId: string, onDate = context.date ?? '9999-12-31'): { status: 'active' | 'announced' | 'retired'; notice: RetirementNotice | null } {
  const notice = context.lifecycle?.enabledSince ? context.lifecycle.notices.find(entry => entry.playerId === playerId && entry.announcedOn <= onDate) ?? null : null;
  return { status: !notice ? 'active' : onDate >= notice.retiredOn ? 'retired' : 'announced', notice };
}

export function isPlayerRetired(context: LifecycleContext, playerId: string, seasonNumber = context.seasonNumber ?? 7974, round = context.round ?? seasonRounds(context)): boolean {
  return !!context.lifecycle?.enabledSince && context.lifecycle.notices.some(notice => notice.playerId === playerId && roundKey(notice.announcedSeason, notice.announcedRound) <= roundKey(seasonNumber, round) && notice.retirementSeason <= seasonNumber);
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

/** Format 100: the career seed, which development traits and setbacks are drawn from. */
function developmentSeed(context: LifecycleContext): number {
  if (!Number.isInteger(context.seed)) throw new Error('Player development needs the career seed.');
  return context.seed!;
}

/**
 * Format 100: a player's decline and setbacks from his aging start to a date, hundredths per skill (key: seed, player,
 * birth date, aging start and the date). Setbacks fall on birthdays after the aging start.
 */
const developmentLoss = memoizePure((key: string): TrainingPoints => {
  const [seedText, playerId, dateOfBirth, startedOn, until] = key.split('|') as [string, string, string, string, string];
  const seed = Number(seedText), traits = developmentTraits(seed, playerId), from = fractionalAge(dateOfBirth, startedOn), to = fractionalAge(dateOfBirth, until);
  const loss = zeroPoints();
  for (const skill of ATTRIBUTES) loss[skill] = Math.floor(declineBetween(skill, traits, from, to));
  for (let age = Math.max(1, Math.floor(from)); age <= Math.floor(to) + 1; age += 1) {
    const day = birthday(dateOfBirth, age);
    if (day <= startedOn || day > until) continue;
    const setback = birthdaySetback(seed, playerId, age);
    for (const skill of ATTRIBUTES) loss[skill] += setback[skill];
  }
  return loss;
});

/** Smooth age curves affect real practice only, expressed in integer basis points. */
export function ageTrainingRate(context: LifecycleContext, playerId: string, onDate: string): number {
  const dateOfBirth = lifecycleDateOfBirth(context, playerId);
  if (!dateOfBirth && usesPlayerDevelopment(context) && context.lifecycle?.enabledSince && onDate >= context.lifecycle.enabledSince.date) return playerGrowthRate(developmentSeed(context), playerId, DEFAULT_PLAYER_AGE);
  if (!dateOfBirth || !agingStart(context, playerId, onDate)) return 10_000;
  if (getPlayerRetirement(context, playerId, onDate).status === 'retired') return 0;
  // Format 100 (`player-development.ts`): the realistic age curve with the player's own traits.
  if (usesPlayerDevelopment(context)) return playerGrowthRate(developmentSeed(context), playerId, fractionalAge(dateOfBirth, onDate));
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
  if (startedOn && dateOfBirth && usesPlayerDevelopment(context)) {
    const loss = developmentLoss(`${developmentSeed(context)}|${playerId}|${dateOfBirth}|${startedOn}|${until}`);
    for (const key of ATTRIBUTES) { lossPoints[key] = loss[key]; skillLoss[key] = Math.floor(loss[key] / 100); }
  } else if (startedOn && dateOfBirth) for (const key of ATTRIBUTES) {
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
  const skills = Object.fromEntries(ATTRIBUTES.map(key => [key, Math.max(1, Math.min(20, attributes[key] - aging.skillLoss[key]))])) as unknown as PlayerAttributes;
  return hasExtraAttributes(attributes) ? { ...skills, ...agedExtras(context, playerId, attributes, onDate) } : skills;
}

/**
 * The five further abilities (stored in new careers) change with age from the same dated start as the skills:
 * Intelligence and Mental grow until 30, Blocking and Stealing fade from 32 and 31, Intelligence a little from 35
 * (`EXTRA_AGING`). Whole points only, from integer hundredths over a 365.25-day year, like the skills.
 */
function agedExtras(context: LifecycleContext, playerId: string, attributes: ExtraAttributes, onDate: string): ExtraAttributes {
  const dateOfBirth = lifecycleDateOfBirth(context, playerId), startedOn = agingStart(context, playerId, onDate);
  if (!dateOfBirth || !startedOn) return Object.fromEntries(EXTRA_ATTRIBUTES.map(key => [key, attributes[key]])) as unknown as ExtraAttributes;
  const retirement = getPlayerRetirement(context, playerId, onDate);
  const until = dateNumber(retirement.status === 'retired' ? retirement.notice!.retiredOn : onDate), start = dateNumber(startedOn);
  const daysBetween = (from: number, to: number) => Math.max(0, Math.round((Math.min(to, until) - Math.max(from, start)) / DAY_MS));
  return Object.fromEntries(EXTRA_ATTRIBUTES.map(key => {
    const rule = EXTRA_AGING[key];
    const growth = rule.growPoints ? Math.floor(daysBetween(-Infinity, dateNumber(birthday(dateOfBirth, rule.growUntilAge))) * rule.growPoints * 4 / 1461 / 100) : 0;
    const loss = rule.annualPoints ? Math.floor(daysBetween(dateNumber(birthday(dateOfBirth, rule.fromAge)), Infinity) * rule.annualPoints * 4 / 1461 / 100) : 0;
    return [key, Math.max(1, Math.min(20, attributes[key] + growth - loss))];
  })) as unknown as ExtraAttributes;
}

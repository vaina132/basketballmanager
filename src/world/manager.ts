import type { ManagerProfile } from '../domain/manager';
import type { SeasonState } from '../domain/season';
import { DEVELOPMENT_START_DATE } from '../data/development-league';

export const MAX_MANAGER_NAME_LENGTH = 80;
export const MAX_MANAGER_NATIONALITY_LENGTH = 60;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function calendarDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) throw new Error(`${label} must be a real date in YYYY-MM-DD format.`);
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error(`${label} must be a real date in YYYY-MM-DD format.`);
  return value;
}

/** Calendar birthdays use UTC dates, independent of browser locale or wall-clock time. */
export function managerAge(profile: ManagerProfile, date: string): number {
  const birth = calendarDate(profile.dateOfBirth, 'Date of birth'), reference = calendarDate(date, 'Reference date');
  return Number(reference.slice(0, 4)) - Number(birth.slice(0, 4)) - (reference.slice(5) < birth.slice(5) ? 1 : 0);
}

function profileText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) throw new Error(`${label} must be text without control characters or line breaks.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  return normalized;
}

export function validateManagerProfile(profile: unknown, referenceDate: string): ManagerProfile {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || ![Object.prototype, null].includes(Object.getPrototypeOf(profile)) || Object.keys(profile).length !== 3 || !['name', 'dateOfBirth', 'nationality'].every(key => Object.hasOwn(profile, key))) throw new Error('A manager profile needs a name, date of birth and nationality.');
  const fields = profile as Record<string, unknown>;
  const normalized: ManagerProfile = {
    name: profileText(fields.name, 'Manager name', MAX_MANAGER_NAME_LENGTH),
    dateOfBirth: calendarDate(fields.dateOfBirth, 'Date of birth'),
    nationality: profileText(fields.nationality, 'Nationality', MAX_MANAGER_NATIONALITY_LENGTH),
  };
  const age = managerAge(normalized, referenceDate);
  if (age < 18 || age > 100) throw new Error('The manager must be aged 18 to 100 on the first day of the career.');
  return normalized;
}

/** Updating identity cannot alter the calendar, match state or simulation randomness. */
export function setManagerProfile(season: SeasonState, profile: ManagerProfile): SeasonState {
  return { ...season, manager: validateManagerProfile(profile, DEVELOPMENT_START_DATE) };
}

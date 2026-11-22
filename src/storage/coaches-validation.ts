import { COACH_ATTRIBUTES, type CoachAttribute, type SeasonCoaches } from '../domain/coaches';
import type { SeasonState } from '../domain/season';
import { worldOf, seasonRounds } from '../world/career-world';
import { managedClubFor } from '../world/career';
import { seasonVerdict } from '../world/board-consequences';
import { coachHash } from '../world/coach-ratings';
import { COACHES_MODEL, COACH_RULES, headCoachWorld } from '../world/head-coaches';
import { COACH_STEERING_MODEL } from '../world/coach-steering';

/**
 * Format 82 save checks for real head coaches. Who coaches where is not saved: it is replayed from the opening coaches
 * and `board.restarts` (checked by the career check), so only the manager's own attributes are stored. Exact: the
 * model, the career (format 82, a real-club world with job changes), the start values (the formula for one of the three
 * age bands, since the profile's birth date may be edited later), one entry for each completed season in order, and
 * each season's board-verdict and dismissal changes where the season's final review is kept. Bounded: at most one
 * point per attribute and two up and two down per season, every attribute 1-20 after each season, one reason per change.
 */
function fail(path: string, reason: string): never { throw new Error(`Invalid season save: ${path} ${reason}.`); }
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!isObject(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key))) fail(path, 'must be an object with the supported fields');
  return value;
}
const AGE_BANDS: readonly Partial<Record<CoachAttribute, number>>[] = [{}, { adaptability: 1, youth: 1, discipline: -1 }, { discipline: 1, motivation: 1, adaptability: -1 }];

export function validateCoachesShape(value: unknown, state: SeasonState, version: number): SeasonCoaches {
  if (version < 82) fail('coaches', 'need format 82 or later');
  if (!headCoachWorld(worldOf(state)) || !state.career?.enabledSince || !state.board?.enabledSince) fail('coaches', 'belong only to real-club careers with board reviews and job changes');
  const coaches = record(value, 'coaches', ['model', 'manager']);
  if (coaches.model !== COACHES_MODEL && coaches.model !== COACH_STEERING_MODEL) fail('coaches.model', 'must be a supported model');
  // Format 86: head coaches who steer their clubs (`coaches-2`) are a rule of new careers only.
  if (coaches.model === COACH_STEERING_MODEL && version < 86) fail('coaches.model', 'needs format 86 or later to steer clubs');
  const manager = record(coaches.manager, 'coaches.manager', ['start', 'seasons']);
  const start = record(manager.start, 'coaches.manager.start', COACH_ATTRIBUTES);
  const spread = (key: CoachAttribute) => 10 + (coachHash(`manager|${state.seed}|${key}`) % 3) - 1;
  if (!AGE_BANDS.some(band => COACH_ATTRIBUTES.every(key => start[key] === Math.max(1, Math.min(20, spread(key) + (band[key] ?? 0)))))) fail('coaches.manager.start', 'must follow the starting formula');
  if (!Array.isArray(manager.seasons) || manager.seasons.length !== state.seasonNumber - 1) fail('coaches.manager.seasons', 'must hold one entry for each completed season');
  const current = { ...(start as Record<CoachAttribute, number>) }, rounds = seasonRounds(state);
  manager.seasons.forEach((entry, index) => {
    const path = `coaches.manager.seasons.${index}`, season = record(entry, path, ['seasonNumber', 'changes', 'reasons']);
    if (season.seasonNumber !== index + 1) fail(`${path}.seasonNumber`, 'must follow the seasons in order');
    if (!isObject(season.changes) || Object.keys(season.changes).some(key => !(COACH_ATTRIBUTES as readonly string[]).includes(key))) fail(`${path}.changes`, 'must name coaching attributes');
    const changes = season.changes as Partial<Record<CoachAttribute, number>>;
    let up = 0, down = 0;
    const before = { ...current };
    for (const [key, change] of Object.entries(changes) as [CoachAttribute, number][]) {
      if (change !== 1 && change !== -1) fail(`${path}.changes.${key}`, 'must be one point up or down');
      if (change === 1) up += 1; else down += 1;
      current[key] += change;
      if (current[key] < 1 || current[key] > 20) fail(`${path}.changes.${key}`, 'must keep the attribute between 1 and 20');
    }
    if (up > COACH_RULES.seasonBudget || down > COACH_RULES.seasonBudget) fail(`${path}.changes`, 'must stay within the season\'s limit');
    if (!Array.isArray(season.reasons) || season.reasons.length !== up + down || season.reasons.some(reason => typeof reason !== 'string' || reason.length < 1 || reason.length > 120)) fail(`${path}.reasons`, 'must give one short reason for each change');
    // The board-verdict changes come first, so they are exact wherever the season's final review is kept.
    const clubId = managedClubFor(state, index + 1, false), verdict = clubId ? seasonVerdict(state.board, clubId, index + 1, rounds) : null;
    if (verdict && verdict.confidence >= 70 && (changes.tactics !== 1 && before.tactics < 20 || changes.motivation !== 1 && before.motivation < 20)) fail(`${path}.changes`, 'must reward a season the board was very pleased with');
    if (verdict && verdict.confidence < 70 && (changes.tactics === 1 || changes.motivation === 1)) fail(`${path}.changes`, 'can reward tactics and motivation only after a very good season');
    if (verdict && verdict.confidence >= 35 && Object.values(changes).filter(change => change === -1).length > (state.career.moves.some(move => move.seasonNumber === index + 1 && move.reason === 'dismissed') ? 1 : 0) + 1) fail(`${path}.changes`, 'cannot lower attributes after a season without a poor verdict');
  });
  return value as SeasonCoaches;
}

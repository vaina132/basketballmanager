import type { SeasonFixture, SeasonInjury, SeasonState } from '../domain/season';
import type { MatchState } from '../domain/types';
import type { PlayerMedicalSummary, SeasonPhysio } from '../domain/physio';
import { injuryDurationRange, injuryType, isMatchInjuryKind, MATCH_INJURY_TYPES, type InjuryModel, type InjuryRisk, type MatchInjuryKind } from '../domain/injuries';
import { effectiveReturnOn, latestRehabilitation, rehabilitationCreditCap } from './rehabilitation-policy';
import { medicalRecoveryPercent, type FacilitiesContext } from './facilities-policy';

const DAY_MS = 86_400_000;

/** UTC calendar days, independent of browser timezone and presentation time. */
export function daysUntilReturn(date: string, returnOn: string): number {
  return Math.max(0, Math.round((Date.parse(`${returnOn}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS));
}

export function isRecovering(injury: SeasonInjury, date: string, physio?: SeasonPhysio): boolean {
  return injury.occurredOn <= date && date < effectiveReturnOn(physio, injury, date);
}

/** Recurrence (sprint 4): a same-kind injury after an earlier one, counted from the earlier return date. */
export const RECURRENCE_DURATION_FACTOR = 1.3;
export const CONCUSSION_LOWER_LIMB_DAYS = 90;
export const CONCUSSION_LOWER_LIMB_FACTOR = 2;
/** The upper end of a recovery range sits about two standard deviations above the median (log-normal). */
const DURATION_SPREAD_DEVIATIONS = 2.05;

/** Whole days from an earlier injury's original return date; zero while he is still out or back early. */
function daysSinceReturn(injury: Pick<SeasonInjury, 'returnOn'>, date: string): number {
  return Math.max(0, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${injury.returnOn}T00:00:00Z`)) / DAY_MS));
}

/** The first 1 July after a date: the end of the season (September to June) in which that date falls. */
function seasonEndAfter(date: string): string {
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  return `${month >= 7 ? year + 1 : year}-07-01`;
}

/**
 * The risk multiplier one earlier injury gives a new injury of the same kind on `date`. Muscle strains: x4 in weeks
 * 0-3 after return, x2.5 in weeks 4-8, x1.5 until 12 months. Ankle sprains: x2 for 6 weeks, then x1.4 until 12 months.
 * Minor knee, back and tendon injuries: x2 for 8 weeks, then x1.3 until the season ends. Legacy kinds never recur.
 */
export function recurrenceFactor(earlier: Pick<SeasonInjury, 'kind' | 'occurredOn' | 'returnOn'>, kind: MatchInjuryKind, date: string): number {
  if (earlier.kind !== kind || !(earlier.occurredOn < date)) return 1;
  const days = daysSinceReturn(earlier, date), recurrence = injuryType(kind).recurrence;
  if (recurrence === 'muscle') return days < 28 ? 4 : days < 63 ? 2.5 : days < 365 ? 1.5 : 1;
  if (recurrence === 'ankle') return days < 42 ? 2 : days < 365 ? 1.4 : 1;
  if (recurrence === 'overuse') return days < 56 ? 2 : date < seasonEndAfter(earlier.returnOn) ? 1.3 : 1;
  return 1;
}

/** One player's earlier injuries (before `date`). */
function earlierInjuries(injuries: readonly SeasonInjury[], playerId: string, date: string): SeasonInjury[] {
  return injuries.filter(injury => injury.playerId === playerId && injury.occurredOn < date);
}

/** Whether a new injury of this kind on `date` repeats an earlier one inside its recurrence window. */
export function isRecurrence(injuries: readonly SeasonInjury[], playerId: string, kind: MatchInjuryKind, date: string): boolean {
  return earlierInjuries(injuries, playerId, date).some(injury => recurrenceFactor(injury, kind, date) > 1);
}

/**
 * Per-kind risk multipliers for one player on `date` from his earlier injuries: the largest same-kind recurrence
 * factor, times two for lower-limb kinds within 90 days of returning from a concussion. Normal-risk kinds are omitted.
 */
export function injuryRiskFor(injuries: readonly SeasonInjury[], playerId: string, date: string): InjuryRisk {
  const own = earlierInjuries(injuries, playerId, date), risk: InjuryRisk = {};
  if (!own.length) return risk;
  const concussion = own.some(injury => injury.kind === 'concussion' && daysSinceReturn(injury, date) < CONCUSSION_LOWER_LIMB_DAYS);
  for (const type of MATCH_INJURY_TYPES) {
    let factor = 1;
    for (const injury of own) factor = Math.max(factor, recurrenceFactor(injury, type.kind, date));
    if (concussion && type.lowerLimb) factor *= CONCUSSION_LOWER_LIMB_FACTOR;
    if (factor !== 1) risk[type.kind] = factor;
  }
  return risk;
}

/** Match option `injuryRisk` for a fixture's players: only players with a raised risk appear. */
export function injuryRiskMap(injuries: readonly SeasonInjury[], playerIds: Iterable<string>, date: string): Record<string, InjuryRisk> {
  const ids = new Set(playerIds), byPlayer = new Map<string, SeasonInjury[]>();
  for (const injury of injuries) if (ids.has(injury.playerId) && injury.occurredOn < date) byPlayer.set(injury.playerId, [...(byPlayer.get(injury.playerId) ?? []), injury]);
  const result: Record<string, InjuryRisk> = {};
  for (const [playerId, own] of byPlayer) {
    const risk = injuryRiskFor(own, playerId, date);
    if (Object.keys(risk).length) result[playerId] = risk;
  }
  return result;
}

/**
 * Format 65: a club's medical centre removes `percent` of each of its players' extra recurrence risk (a factor of 2
 * becomes 1.85 at 15%). Players of clubs without one, and every player in older careers, keep their factors.
 */
export function withMedicalRecurrence(risks: Record<string, InjuryRisk>, clubs: readonly { playerIds: readonly string[]; percent: number }[]): Record<string, InjuryRisk> {
  // Format 74: a Very Poor or Poor medical centre (a negative percent) raises the extra risk instead.
  if (!clubs.some(club => club.percent !== 0)) return risks;
  const result: Record<string, InjuryRisk> = {};
  for (const [playerId, risk] of Object.entries(risks)) {
    const percent = clubs.find(club => club.playerIds.includes(playerId))?.percent ?? 0;
    result[playerId] = percent !== 0 ? Object.fromEntries(Object.entries(risk).map(([kind, factor]) => [kind, 1 + (factor! - 1) * (100 - percent) / 100])) as InjuryRisk : risk;
  }
  return result;
}

function stableHash(seed: number, key: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
  return hash;
}

/** MurmurHash3's finalizer: spreads every input bit over the 32-bit result. */
function mix(value: number): number {
  let hash = value >>> 0;
  hash = Math.imul(hash ^ hash >>> 16, 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ hash >>> 13, 0xc2b2ae35) >>> 0;
  return (hash ^ hash >>> 16) >>> 0;
}

/**
 * Recovery days for a new injury: log-normal around the type's median, clamped to its range, from a stable hash
 * (never match randomness). A recurrence lasts 1.3 times as long.
 */
export function injuryDays(kind: MatchInjuryKind, hash: number, recurrence = false, model?: InjuryModel): number {
  const type = injuryDurationRange(kind, model);
  const first = (mix(hash) + 0.5) / 4_294_967_296, second = (mix(hash ^ 0x9e3779b9) + 0.5) / 4_294_967_296;
  const normal = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  const spread = Math.log(type.maxDays / type.medianDays) / DURATION_SPREAD_DEVIATIONS;
  const days = Math.min(type.maxDays, Math.max(type.minDays, Math.round(type.medianDays * Math.exp(spread * normal))));
  return recurrence ? Math.round(days * RECURRENCE_DURATION_FACTOR) : days;
}

/**
 * A diagnosed recovery episode. Realistic kinds (format 61) draw their duration with `injuryDays`, using the player's
 * earlier injuries for recurrence; the legacy kinds keep their provisional durations (ankle 7-28 days, muscle 7-21)
 * so older careers keep their diagnoses. The separate stable hash consumes no sporting RNG. `recoveryPercent` is the
 * club's medical centre (format 65, `medicalRecoveryPercent`): that much shorter, never below one day. `model` is the
 * career's injury model (`injuries-2` for new careers, 22 November 2026; absent: the research durations).
 */
export function createSeasonInjury(seed: number, fixture: Pick<SeasonFixture, 'id' | 'date'>, clubId: string, playerId: string, kind: SeasonInjury['kind'], earlier: readonly SeasonInjury[] = [], recoveryPercent = 0, model?: InjuryModel): SeasonInjury {
  const hash = stableHash(seed, `health:${fixture.id}:${playerId}:${kind}`);
  const diagnosed = isMatchInjuryKind(kind) ? injuryDays(kind, hash, isRecurrence(earlier, playerId, kind, fixture.date), model) : 7 + hash % (kind === 'ankle' ? 22 : 15);
  // Format 74: a Very Poor or Poor medical centre (a negative percent) makes recovery longer.
  const duration = recoveryPercent !== 0 ? Math.max(1, Math.round(diagnosed * (100 - recoveryPercent) / 100)) : diagnosed;
  const returnOn = new Date(Date.parse(`${fixture.date}T00:00:00Z`) + duration * DAY_MS).toISOString().slice(0, 10);
  return { id: `${fixture.id}:${playerId}`, playerId, clubId, kind, fixtureId: fixture.id, occurredOn: fixture.date, returnOn };
}

/**
 * New incidents only. Carried absences do not restart their recovery clock. `earlier` holds the recorded history;
 * `recoveryPercent` gives each club's medical-centre shortening on the fixture date (format 65).
 */
export function injuriesFromMatch(seed: number, fixture: Pick<SeasonFixture, 'id' | 'date'>, match: MatchState, earlier: readonly SeasonInjury[] = [], recoveryPercent: (clubId: string) => number = () => 0, model?: InjuryModel): SeasonInjury[] {
  const carried = new Set(match.preExistingInjuries ?? []);
  return Object.entries(match.injuries).filter(([id]) => !carried.has(id)).map(([playerId, injury]) => {
    const club = [match.home, match.away].find(team => team.players.some(player => player.id === playerId));
    if (!club) throw new Error('A match injury refers to a player outside its squads.');
    return createSeasonInjury(seed, fixture, club.id, playerId, injury.kind, earlier, recoveryPercent(club.id), model);
  });
}

/** Each club's medical-centre shortening on a fixture's date (format 65), for `injuriesFromMatch`; zero in older careers. */
export function clubRecoveryPercent(state: FacilitiesContext, date: string): (clubId: string) => number {
  return clubId => medicalRecoveryPercent(state, clubId, date);
}

/** Read-only projection includes today's uncommitted match incidents for the UI. */
export function getSeasonInjuries(season: SeasonState): SeasonInjury[] {
  if (!season.activeMatch) return [...season.injuries];
  const fixture = season.fixtures.find(item => item.id === season.activeFixtureId);
  if (!fixture) throw new Error('The active season fixture is missing.');
  const injuries = new Map(season.injuries.map(injury => [injury.id, injury]));
  for (const injury of injuriesFromMatch(season.seed, fixture, season.activeMatch, season.injuries, clubRecoveryPercent(season, fixture.date), season.injuryModel)) if (!injuries.has(injury.id)) injuries.set(injury.id, injury);
  return [...injuries.values()];
}

/**
 * The day the medical screens read: the season's date, or in the offseason the latest summer tournament day already
 * played (format 80: its days, 21 August on, come after the offseason date), so its injuries show from their day.
 */
export function medicalViewDate(state: Pick<SeasonState, 'date' | 'status' | 'seasonNumber' | 'national'>): string {
  let date = state.date;
  if (state.status !== 'complete') return date;
  for (const competition of state.national?.competitions ?? []) {
    if (competition.seasonNumber !== state.seasonNumber) continue;
    for (const fixture of competition.fixtures) if (fixture.result && fixture.date > date) date = fixture.date;
  }
  return date;
}

export function getPlayerHealth(season: SeasonState, playerId: string): SeasonInjury | null {
  const today = medicalViewDate(season);
  return getSeasonInjuries(season).reverse().find(injury => injury.playerId === playerId && isRecovering(injury, today, season.physio)) ?? null;
}

export function getInjuryMedicalSummary(state: SeasonState, injury: SeasonInjury): PlayerMedicalSummary {
  const today = medicalViewDate(state);
  const returnOn = effectiveReturnOn(state.physio, injury, today);
  const elapsed = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${injury.occurredOn}T00:00:00Z`)) / DAY_MS));
  const duration = Math.max(1, Math.round((Date.parse(`${returnOn}T00:00:00Z`) - Date.parse(`${injury.occurredOn}T00:00:00Z`)) / DAY_MS));
  const registered = state.clubs.find(club => club.players.some(player => player.id === injury.playerId));
  const contract = state.physio?.contracts.find(contract => contract.clubId === registered?.id && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null);
  const lastReview = latestRehabilitation(state.physio, injury.id, today);
  return { injury, originalReturnOn: injury.returnOn, effectiveReturnOn: returnOn, daysRemaining: daysUntilReturn(today, returnOn), daysSaved: daysUntilReturn(returnOn, injury.returnOn), progress: Math.min(100, Math.round(elapsed / duration * 100)), credit: lastReview?.creditAfter ?? 0, creditCap: rehabilitationCreditCap(injury), physioId: contract?.physioId ?? null, lastReview, pending: !state.injuries.some(existing => existing.id === injury.id) };
}

/** Latest recorded or current-match episode, including a recently completed recovery. */
export function getPlayerMedicalSummary(state: SeasonState, playerId: string): PlayerMedicalSummary | null {
  const injury = getSeasonInjuries(state).filter(injury => injury.playerId === playerId).sort((left, right) => right.occurredOn.localeCompare(left.occurredOn, 'en') || right.id.localeCompare(left.id, 'en'))[0];
  return injury ? getInjuryMedicalSummary(state, injury) : null;
}

export function getClubMedicalCases(state: SeasonState, clubId = state.managedClubId): PlayerMedicalSummary[] {
  const club = state.clubs.find(club => club.id === clubId);
  if (!club) throw new Error('Choose a club in this career.');
  const registered = new Set(club.players.map(player => player.id));
  const today = medicalViewDate(state);
  return getSeasonInjuries(state).filter(injury => registered.has(injury.playerId) && isRecovering(injury, today, state.physio)).map(injury => getInjuryMedicalSummary(state, injury));
}

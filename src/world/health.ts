import type { SeasonFixture, SeasonInjury, SeasonState } from '../domain/season';
import type { MatchState } from '../domain/types';
import type { PlayerMedicalSummary, SeasonPhysio } from '../domain/physio';
import { effectiveReturnOn, latestRehabilitation, rehabilitationCreditCap } from './rehabilitation-policy';

const DAY_MS = 86_400_000;

/** UTC calendar days, independent of browser timezone and presentation time. */
export function daysUntilReturn(date: string, returnOn: string): number {
  return Math.max(0, Math.round((Date.parse(`${returnOn}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS));
}

export function isRecovering(injury: SeasonInjury, date: string, physio?: SeasonPhysio): boolean {
  return injury.occurredOn <= date && date < effectiveReturnOn(physio, injury, date);
}

/**
 * Provisional recovery durations: ankle 7–28 days, muscle 7–21 days.
 * The separate stable hash consumes no sporting RNG and is not a medical model.
 */
export function createSeasonInjury(seed: number, fixture: Pick<SeasonFixture, 'id' | 'date'>, clubId: string, playerId: string, kind: SeasonInjury['kind']): SeasonInjury {
  const key = `health:${fixture.id}:${playerId}:${kind}`;
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
  const duration = 7 + hash % (kind === 'ankle' ? 22 : 15);
  const returnOn = new Date(Date.parse(`${fixture.date}T00:00:00Z`) + duration * DAY_MS).toISOString().slice(0, 10);
  return { id: `${fixture.id}:${playerId}`, playerId, clubId, kind, fixtureId: fixture.id, occurredOn: fixture.date, returnOn };
}

/** New incidents only. Carried absences do not restart their recovery clock. */
export function injuriesFromMatch(seed: number, fixture: Pick<SeasonFixture, 'id' | 'date'>, match: MatchState): SeasonInjury[] {
  const carried = new Set(match.preExistingInjuries ?? []);
  return Object.entries(match.injuries).filter(([id]) => !carried.has(id)).map(([playerId, injury]) => {
    const club = [match.home, match.away].find(team => team.players.some(player => player.id === playerId));
    if (!club) throw new Error('A match injury refers to a player outside its squads.');
    return createSeasonInjury(seed, fixture, club.id, playerId, injury.kind);
  });
}

/** Read-only projection includes today's uncommitted match incidents for the UI. */
export function getSeasonInjuries(season: SeasonState): SeasonInjury[] {
  const fixture = season.fixtures.find(item => item.id === season.activeFixtureId);
  if (!fixture) throw new Error('The active season fixture is missing.');
  const injuries = new Map(season.injuries.map(injury => [injury.id, injury]));
  for (const injury of injuriesFromMatch(season.seed, fixture, season.activeMatch)) if (!injuries.has(injury.id)) injuries.set(injury.id, injury);
  return [...injuries.values()];
}

export function getPlayerHealth(season: SeasonState, playerId: string): SeasonInjury | null {
  return getSeasonInjuries(season).reverse().find(injury => injury.playerId === playerId && isRecovering(injury, season.date, season.physio)) ?? null;
}

export function getInjuryMedicalSummary(state: SeasonState, injury: SeasonInjury): PlayerMedicalSummary {
  const returnOn = effectiveReturnOn(state.physio, injury, state.date);
  const elapsed = Math.max(0, Math.round((Date.parse(`${state.date}T00:00:00Z`) - Date.parse(`${injury.occurredOn}T00:00:00Z`)) / DAY_MS));
  const duration = Math.max(1, Math.round((Date.parse(`${returnOn}T00:00:00Z`) - Date.parse(`${injury.occurredOn}T00:00:00Z`)) / DAY_MS));
  const registered = state.clubs.find(club => club.players.some(player => player.id === injury.playerId));
  const contract = state.physio?.contracts.find(contract => contract.clubId === registered?.id && contract.seasonNumber === state.seasonNumber && contract.releasedRound === null);
  const lastReview = latestRehabilitation(state.physio, injury.id, state.date);
  return { injury, originalReturnOn: injury.returnOn, effectiveReturnOn: returnOn, daysRemaining: daysUntilReturn(state.date, returnOn), daysSaved: daysUntilReturn(returnOn, injury.returnOn), progress: Math.min(100, Math.round(elapsed / duration * 100)), credit: lastReview?.creditAfter ?? 0, creditCap: rehabilitationCreditCap(injury), physioId: contract?.physioId ?? null, lastReview, pending: !state.injuries.some(existing => existing.id === injury.id) };
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
  return getSeasonInjuries(state).filter(injury => registered.has(injury.playerId) && isRecovering(injury, state.date, state.physio)).map(injury => getInjuryMedicalSummary(state, injury));
}

import type { Rivalry, RivalryAnchor, SeasonRivalries } from '../domain/rivalries';
import type { SeasonState } from '../domain/season';
import type { CareerWorld, WorldContext } from '../domain/world';
import { ordinalRound, roundOrdinal, seasonRounds, worldRivalryBetween, worldRivalryFor, worldRounds, lastCommittedWeek } from './career-world';
import { grownRivalryBetween } from './rivalry-growth';

/** Derby crowds grow by this percentage per point of rivalry intensity (5% to 15%). */
export const RIVALRY_CROWD_PERCENT = 5;
/** Board assessment points per derby win or loss in the counted games, capped in either direction. */
export const RIVALRY_BOARD_POINTS = 3;
export const RIVALRY_BOARD_CAP = 6;
/** A derby result counts this many times in the recent-results part of player morale (still capped there). */
export const RIVALRY_MORALE_WEIGHT = 2;

/** Matchdays as one sequence across seasons; stored in anchors and counted forward, so it uses the season length. */
const ordinal = (year: number, round: number, rounds: number) => roundOrdinal(year, round, rounds);

/** Careers saved before format 68 (and their migrations) keep the world's fixed rivalries; new careers use `createGrownRivalries`. */
export function createRivalries(): SeasonRivalries { return { model: 'rivalries-1', enabledSince: null }; }

export function rivalryBetween(firstClubId: string, secondClubId: string, world: CareerWorld): Rivalry | null {
  return worldRivalryBetween(world, firstClubId, secondClubId);
}

export function rivalryFor(clubId: string, world: CareerWorld): { rivalry: Rivalry; rivalId: string } | null {
  return worldRivalryFor(world, clubId);
}

/**
 * The rivalry a fixture belongs to when rivalries govern that matchday; earlier matchdays never become derbies.
 * Format 68 careers ('rivalries-2') read the season's grown table, whose intensity sets the derby effects' 1-3 scale.
 */
export function governingDerby(rivalries: SeasonRivalries | undefined, homeClubId: string, awayClubId: string, seasonNumber: number, round: number, world: CareerWorld): Rivalry | null {
  const from = rivalries?.enabledSince?.effectiveFrom;
  if (!from || ordinal(seasonNumber, round, worldRounds(world)) < ordinal(from.seasonNumber, from.round, worldRounds(world))) return null;
  if (rivalries!.model === 'rivalries-2') return grownRivalryBetween(rivalries, homeClubId, awayClubId, seasonNumber, world)?.rivalry ?? null;
  return rivalryBetween(homeClubId, awayClubId, world);
}

export function rivalryEventAnchor(state: Pick<SeasonState, 'seasonNumber' | 'round' | 'date' | 'fixtures'> & WorldContext, mode: 'career' | 'prospective'): RivalryAnchor {
  const completed = lastCommittedWeek(state);
  const next = ordinal(state.seasonNumber, state.round, seasonRounds(state)) + 1;
  const effectiveFrom = mode === 'career' ? { seasonNumber: 1, round: 1 } : ordinalRound(next, seasonRounds(state));
  return { seasonNumber: state.seasonNumber, round: state.round, date: state.date, completedRounds: ordinal(state.seasonNumber, completed, seasonRounds(state)), effectiveFrom };
}

/** New careers count derbies from the opening matchday; older careers from the next uncommitted matchday. */
export function enableRivalries(state: SeasonState, mode: 'career' | 'prospective' = 'prospective'): SeasonState {
  if (state.rivalries?.enabledSince) return state;
  if (mode === 'career' && (state.seasonNumber !== 1 || state.round !== 1 || state.fixtures.some(fixture => fixture.result))) throw new Error('Rivalries can include the opening matchday only at the start of a new career.');
  return { ...state, rivalries: { ...(state.rivalries ?? createRivalries()), enabledSince: rivalryEventAnchor(state, mode) } };
}

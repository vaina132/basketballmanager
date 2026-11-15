import type { CareerWorld } from '../domain/world';
import type { DomesticDivisions } from '../domain/season';
import type { PostseasonFormat, postseasonOutcome } from './postseason';

/**
 * Division memberships by season (step 3.4c). The world keeps its opening leagues; each season carries the clubs of
 * every division that season (`SeasonState.divisions`, copied into its archive). At a season's end the clubs relegated
 * from a country's first division and those promoted from its second division change places, by each league's own
 * postseason outcome. Clubs leaving the game's leagues altogether (below a second division, or below a first division
 * whose country has no second one in the game) are step 3.4d; until then they stay.
 */
export type DomesticLeague = NonNullable<CareerWorld['domesticLeagues']>[number];

/** The world's leagues with this season's clubs (the opening memberships when no divisions are recorded). */
export function seasonLeagues(world: CareerWorld, divisions?: DomesticDivisions | null): DomesticLeague[] {
  const leagues = world.domesticLeagues ?? [];
  if (!divisions) return leagues;
  return leagues.map(league => ({ ...league, clubIds: [...divisions.leagues.find(entry => entry.id === league.id)!.clubIds] }));
}

/** A new career's divisions: recorded only when its leagues have postseasons (and so can move clubs). */
export function openingDivisions(world: CareerWorld, changesFrom = 1): DomesticDivisions | undefined {
  if (!world.domesticLeagues?.some(league => league.postseason)) return undefined;
  return { changesFrom, leagues: world.domesticLeagues.map(league => ({ id: league.id, clubIds: [...league.clubIds] })) };
}

export interface DivisionMove { clubId: string; fromLeagueId: string; toLeagueId: string }
type Outcome = ReturnType<typeof postseasonOutcome>;
export interface SeasonPostseason { league: DomesticLeague; format: PostseasonFormat; series: readonly { id: string; winner: string | null }[]; outcome: Outcome }

/**
 * The next season's memberships after a completed season: within each country, the first division's relegated clubs
 * and the second division's promoted clubs change places. A first-division club relegated "unless it wins the lower
 * final" (France's 15th) stays up when it does, and then takes no promotion place. The counts must balance.
 */
export function divisionChanges(leagues: readonly DomesticLeague[], postseasons: readonly SeasonPostseason[]): { leagues: { id: string; clubIds: string[] }[]; moves: DivisionMove[] } {
  const next = new Map(leagues.map(league => [league.id, [...league.clubIds]]));
  const moves: DivisionMove[] = [];
  const byLeague = new Map(postseasons.map(entry => [entry.league.id, entry]));
  for (const top of leagues.filter(league => league.tier === 1)) {
    const second = leagues.find(league => league.country === top.country && league.tier === 2);
    if (!second) continue;
    const upper = byLeague.get(top.id), lower = byLeague.get(second.id);
    if (!upper || !lower) throw new Error('Division changes need both divisions\' postseasons.');
    const lowerFinal = lower.series.find(series => series.id === 'final')?.winner ?? null;
    const relegated = upper.outcome.relegated.filter(entry => !(entry.unlessWinsLowerFinal && entry.clubId !== null && entry.clubId === lowerFinal)).map(entry => entry.clubId);
    const promoted = lower.outcome.promoted.filter(clubId => clubId === null || second.clubIds.includes(clubId));
    if (relegated.some(clubId => clubId === null) || promoted.some(clubId => clubId === null)) throw new Error('Complete both divisions\' postseasons before moving clubs between them.');
    if (relegated.length !== promoted.length) throw new Error(`${top.country}'s promotion and relegation places do not balance.`);
    next.set(top.id, [...top.clubIds.filter(id => !relegated.includes(id)), ...promoted as string[]]);
    next.set(second.id, [...second.clubIds.filter(id => !promoted.includes(id)), ...relegated as string[]]);
    for (const clubId of relegated as string[]) moves.push({ clubId, fromLeagueId: top.id, toLeagueId: second.id });
    for (const clubId of promoted as string[]) moves.push({ clubId, fromLeagueId: second.id, toLeagueId: top.id });
  }
  return { leagues: leagues.map(league => ({ id: league.id, clubIds: next.get(league.id)! })), moves };
}

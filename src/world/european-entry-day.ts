import type { SeasonEurope, SeasonState } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { managedClubAtRound } from './career';
import { clubCountry, clubFinanceDefinition, seasonRounds, worldOf } from './career-world';
import { seasonLeagues } from './divisions';
import { clubEconomy, moneyAt } from './economy';
import { backgroundSide, getEuropeanCompetitions } from './europe';
import { playedEuropeanCompetitions } from './european-formats';
import { decidePlaces, openingEuropeTwo, type ClubFacts, type EuropeanStage } from './european-entry';
import { estimatedTable, strengthOf } from './european-places';
import { getArenaFullCapacity } from './facilities-policy';
import { dateForRound, foreseeEconomy, getPostseasons, getStandings, MAX_SEASON_NUMBER, nextSeasonDivisions } from './season';
import type { PostseasonSeriesState } from './postseason';

/** What the places day reads from a career at a season's end (the current season, or an archived one in a save check). */
export type PlacesDayState = Pick<SeasonState, 'seed' | 'seasonNumber' | 'history' | 'fixtures' | 'clubs' | 'europe'>
  & Partial<Pick<SeasonState, 'divisions' | 'background' | 'lifecycle' | 'academy' | 'board' | 'facilities' | 'economySeasons' | 'managedClubId' | 'career'>> & WorldContext;

export interface PlacesDayOptions {
  /** Unpaid costs to use instead of the season's final board review (the board's evidence at that review). */
  unpaidOf?: (clubId: string) => number | null;
  /** Ignore the manager's answers (the places as offered). */
  withoutAnswers?: boolean;
}

const DEPTH: Readonly<Record<string, number>> = { 'play-in': 1, 'quarter-final': 2, 'semi-final': 3, 'third-place': 3, final: 4 };

/**
 * A top division's final ranking (owner decision, 22 November 2026: European places use the ranking after the
 * playoffs): the champion, the other finalist, then each club by the furthest playoff round it reached (the third-place
 * winner before its loser), ties and the clubs outside the playoffs by regular-season place.
 */
export function finalRanking(order: readonly string[], series: readonly PostseasonSeriesState[], champion: string | null): string[] {
  const depth = new Map<string, number>();
  for (const item of series) {
    const value = DEPTH[item.stage];
    if (value === undefined) continue;
    for (const side of [item.higher, item.lower]) if (side) depth.set(side.clubId, Math.max(depth.get(side.clubId) ?? 0, value + (item.stage === 'third-place' && item.winner === side.clubId ? 0.5 : 0)));
  }
  if (champion) depth.set(champion, 10);
  const place = new Map(order.map((clubId, index) => [clubId, index]));
  return [...order].sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0) || place.get(a)! - place.get(b)!);
}

/** How far a club went in a competition, from its knockout series. */
function stageOf(kind: 'euroleague' | 'eurocup' | 'bcl', clubId: string, series: readonly PostseasonSeriesState[], champion: string | null, roundOf16: readonly { clubIds: readonly string[] }[]): EuropeanStage {
  if (champion === clubId) return 'champion';
  const reached = new Set(series.filter(item => item.higher?.clubId === clubId || item.lower?.clubId === clubId).map(item => item.stage));
  if (reached.has('final')) return 'final';
  if (reached.has('semi-final') || reached.has('third-place')) return kind === 'eurocup' ? 'semi-final' : 'final-four';
  if (reached.has('quarter-final')) return kind === 'euroleague' ? 'playoffs' : 'quarter-final';
  if (kind === 'eurocup' && reached.has('round-of-16')) return 'eighth-final';
  if (kind === 'euroleague' && reached.has('play-in')) return 'play-in';
  if (kind === 'bcl' && roundOf16.some(group => group.clubIds.includes(clubId))) return 'other';
  return 'other';
}

/** Format 83: next season's places from a completed season (the places day). */
export function europeanEntryAfter(state: PlacesDayState, options: PlacesDayOptions = {}): SeasonEurope {
  const world = worldOf(state), N = state.seasonNumber, europe = state.europe!, rounds = seasonRounds(state);
  const competitions = playedEuropeanCompetitions(world);
  const outcomes = getEuropeanCompetitions({ ...state, europe }, N);
  const leaguesNow = seasonLeagues(world, state.divisions), leaguesNext = seasonLeagues(world, nextSeasonDivisions(state as Parameters<typeof nextSeasonDivisions>[0]));
  const background = world.backgroundLeagues ?? [];
  const leagueClubs = new Set([...(world.domesticLeagues ?? []).flatMap(league => league.clubIds), ...(world.lowerDivisions ?? []).flatMap(list => 'clubIds' in list ? list.clubIds : []), ...leaguesNow.flatMap(league => league.clubIds), ...background.flatMap(league => league.clubIds)]);
  const europeanOnly = world.clubs.map(club => club.id).filter(clubId => !leagueClubs.has(clubId));
  const topNow = new Set([...leaguesNow.filter(league => league.tier === 1).flatMap(league => league.clubIds), ...background.flatMap(league => league.clubIds), ...europeanOnly]);
  const topNext = new Set([...leaguesNext.filter(league => league.tier === 1).flatMap(league => league.clubIds), ...background.flatMap(league => league.clubIds), ...europeanOnly]);
  // Each country's final ranking: the chosen top division's (after its playoffs) or the estimated table.
  const rankings = new Map<string, readonly string[]>();
  const postseasons = getPostseasons(state as Parameters<typeof getPostseasons>[0], N);
  const standings = getStandings(state as Parameters<typeof getStandings>[0]);
  for (const league of leaguesNow.filter(item => item.tier === 1)) {
    const post = postseasons.find(entry => entry.league.id === league.id);
    const order = post?.order ?? standings.filter(row => league.clubIds.includes(row.clubId)).sort((a, b) => a.position - b.position).map(row => row.clubId);
    rankings.set(league.country, post ? finalRanking(order, post.series, post.outcome.champion) : order);
  }
  for (const league of background) rankings.set(league.country, estimatedTable(state, league, N).map(row => row.clubId));
  const rankOf = new Map<string, { rank: number; size: number }>();
  for (const order of rankings.values()) order.forEach((clubId, index) => rankOf.set(clubId, { rank: index + 1, size: order.length }));
  // European results and the seasons each club played the EuroLeague or the EuroCup (this one and the two before).
  const stages = new Map<string, ClubFacts['europe']>();
  for (const entry of outcomes) {
    const kind = entry.competition.kind;
    const clubs = new Set([...(europe.entrants.find(item => item.competitionId === entry.competition.id)?.clubIds ?? entry.competition.clubIds)]);
    const roundOf16 = 'roundOf16' in entry ? (entry.roundOf16 as { clubIds: string[] }[]) : [];
    for (const clubId of clubs) stages.set(clubId, { kind, stage: stageOf(kind, clubId, entry.series, entry.outcome.champion, roundOf16) });
  }
  const seasonsIn = (kind: 'euroleague' | 'eurocup') => {
    const competition = competitions.find(item => item.kind === kind), map = new Map<string, number[]>();
    if (!competition) return map;
    for (let year = N; year >= Math.max(1, N - 2); year -= 1) {
      const record = year === N ? europe : state.history.find(archive => archive.seasonNumber === year)?.europe;
      for (const clubId of record?.entrants.find(item => item.competitionId === competition.id)?.clubIds ?? []) map.set(clubId, [...(map.get(clubId) ?? []), year]);
    }
    return map;
  };
  const euroleagueSeasons = seasonsIn('euroleague'), eurocupSeasons = seasonsIn('eurocup');
  const endDate = dateForRound(rounds, N);
  const review = state.board?.reviews.filter(item => item.seasonNumber === N && item.round === rounds).at(-1);
  const unpaidOf = options.unpaidOf ?? ((clubId: string) => review?.clubs[clubId]?.unpaid ?? null);
  const money = moneyAt(state, N);
  const seatsOf = (clubId: string) => {
    if (!state.facilities?.enabledSince) return clubFinanceDefinition(world, clubId).capacity;
    try { return getArenaFullCapacity({ world, facilities: state.facilities, date: endDate }, clubId, endDate); } catch { return clubFinanceDefinition(world, clubId).capacity; }
  };
  const fullWorld = new Set(state.clubs.map(club => club.id));
  const facts = new Map<string, ClubFacts>();
  for (const club of world.clubs) {
    const clubId = club.id, country = clubCountry(world, clubId), ranked = rankOf.get(clubId);
    facts.set(clubId, {
      clubId, country, data: country !== null && rankings.has(country), topNow: topNow.has(clubId), topNext: topNext.has(clubId),
      rank: ranked?.rank ?? null, rankSize: ranked?.size ?? null, seats: seatsOf(clubId), budget: clubEconomy(money, clubId)?.budget ?? null,
      // Clubs outside the full world keep no accounts, so the money check passes.
      unpaid: fullWorld.has(clubId) ? unpaidOf(clubId) : null,
      europe: stages.get(clubId) ?? null, euroleagueSeasons: euroleagueSeasons.get(clubId) ?? [], eurocupSeasons: eurocupSeasons.get(clubId) ?? [],
    });
  }
  const outcomeOf = (kind: string) => outcomes.find(entry => entry.competition.kind === kind);
  const euroleague = outcomeOf('euroleague'), final = outcomeOf('eurocup')?.series.find(series => series.id === 'final');
  const playoffs = new Set((euroleague?.series ?? []).filter(series => series.stage === 'quarter-final').flatMap(series => [series.higher?.clubId, series.lower?.clubId]).filter((id): id is string => !!id));
  // The manager answering: the club managed when the next season starts (the current club for the season being played).
  const current = state.managedClubId !== undefined && !state.history.some(archive => archive.seasonNumber === N);
  const managedClubId = current ? state.managedClubId ?? '' : managedClubAtRound(state as Parameters<typeof managedClubAtRound>[0], N + 1, 0);
  return decidePlaces({
    seasonNumber: N, date: endDate, competitions, europe, opening: openingEuropeTwo(world), facts, rankings, euroleaguePlayoffs: playoffs,
    eurocupFinal: { winner: final?.winner ?? null, loser: final?.loser ?? null }, bclChampion: outcomeOf('bcl')?.outcome.champion ?? null,
    europeanOnly, managedClubId, answers: options.withoutAnswers ? [] : europe.answers ?? [],
    strength: clubId => strengthOf(backgroundSide(state, clubId, N).players),
  });
}

/**
 * Format 83: the manager answers an offered place for next season (no answer means accept). Answers that no longer match
 * an offer (a later answer changed what is offered) are dropped, and next season's club money follows the new places.
 */
export function answerEuropeanOffer(state: SeasonState, competitionId: string, accept: boolean): SeasonState {
  if (state.europe?.model !== 'places-2') throw new Error('This career uses the earlier European places.');
  if (state.status !== 'complete' || state.seasonNumber >= MAX_SEASON_NUMBER) throw new Error('European places are offered at the end of the season.');
  if (typeof accept !== 'boolean') throw new Error('Choose Accept or Decline.');
  const clubId = state.managedClubId;
  if (!clubId) throw new Error('Without a club there is no European place to answer.');
  const offers = (europe: SeasonEurope) => europeanEntryAfter({ ...state, europe }).decision!.offers.filter(offer => offer.clubId === clubId);
  if (!offers(state.europe).some(offer => offer.competitionId === competitionId)) throw new Error('Your club has no offer in that competition.');
  let answers = [...(state.europe.answers ?? []).filter(answer => answer.clubId === clubId && answer.competitionId !== competitionId), { clubId, competitionId, accept }];
  for (let step = 0; step < 4; step += 1) {
    const open = offers({ ...state.europe, answers });
    const kept = answers.filter(answer => open.some(offer => offer.competitionId === answer.competitionId));
    if (kept.length === answers.length) break;
    answers = kept;
  }
  return foreseeEconomy({ ...state, europe: { ...state.europe, answers } });
}

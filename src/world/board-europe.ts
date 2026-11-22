import type { BoardClubMandate, BoardEuropeanAim } from '../domain/board';
import type { SeasonEurope, SeasonFixture } from '../domain/season';
import type { WorldContext } from '../domain/world';
import { worldOf } from './career-world';
import { clubEconomy } from './economy';
import { clubStrength, getEuropeanCompetitions } from './europe';
import { EUROPEAN_ENTRY_RULES, usesEuropeanEntry } from './european-entry';

/**
 * Format 83 (owner decision, 22 November 2026): the board's European aim. At the season opening each board of a career
 * with European entry rules sets one aim from the club's place and its budget rank among the competition's clubs:
 * - EuroLeague: a EuroCup-route holder must reach the playoffs to keep its place; the six richest clubs aim for the
 *   playoffs, the next four for the Play-In; the rest have no European aim;
 * - EuroCup: the eight richest the quarter-finals, the others the eighth-finals;
 * - BCL: the eight richest the quarter-finals, the next eight the Round of 16;
 * - a club outside Europe in the top third of its top division (by squad strength) aims to earn a European place.
 * A met aim adds `boardPoints` to each later review's assessment, a missed one takes them away; open aims count nothing.
 */
export const BOARD_EUROPE_RULES = Object.freeze({ euroleague: { playoffs: 6, playIn: 10 }, eurocup: { quarterFinals: 8 }, bcl: { quarterFinals: 8, roundOf16: 16 } });

/** Each full-world club's European aim for the season, or null. `topThird` tells whether a club outside Europe is in its league's top third. */
export function europeanAims(context: WorldContext & { europe?: SeasonEurope }, clubIds: readonly string[], topThird: (clubId: string) => boolean): Map<string, BoardEuropeanAim | null> {
  const aims = new Map<string, BoardEuropeanAim | null>();
  const europe = context.europe, world = worldOf(context);
  if (!usesEuropeanEntry(europe)) return aims;
  const budget = (clubId: string) => clubEconomy(context, clubId)?.budget ?? 0;
  const kindOf = (competitionId: string) => world.europeanCompetitions?.find(competition => competition.id === competitionId)?.kind;
  for (const clubId of clubIds) {
    const entry = europe!.entrants.find(item => item.clubIds.includes(clubId));
    if (!entry) { aims.set(clubId, topThird(clubId) ? { kind: 'european-place', competitionId: null } : null); continue; }
    const ranked = [...entry.clubIds].sort((a, b) => budget(b) - budget(a) || clubStrength(world, b) - clubStrength(world, a) || (a < b ? -1 : a > b ? 1 : 0));
    const rank = ranked.indexOf(clubId) + 1, place = entry.places?.[entry.clubIds.indexOf(clubId)], competitionId = entry.competitionId;
    const kind = kindOf(competitionId), rules = BOARD_EUROPE_RULES;
    let aim: BoardEuropeanAim | null = null;
    if (kind === 'euroleague') aim = place?.type === 'route' ? { kind: 'euroleague-playoffs', competitionId, keep: true } : rank <= rules.euroleague.playoffs ? { kind: 'euroleague-playoffs', competitionId } : rank <= rules.euroleague.playIn ? { kind: 'euroleague-play-in', competitionId } : null;
    else if (kind === 'eurocup') aim = { kind: rank <= rules.eurocup.quarterFinals ? 'eurocup-quarter-finals' : 'eurocup-eighth-finals', competitionId };
    else if (kind === 'bcl') aim = rank <= rules.bcl.quarterFinals ? { kind: 'bcl-quarter-finals', competitionId } : rank <= rules.bcl.roundOf16 ? { kind: 'bcl-round-of-16', competitionId } : null;
    aims.set(clubId, aim);
  }
  return aims;
}

export type EuropeAimContext = WorldContext & { seed?: number; europe?: SeasonEurope; seasonNumber: number; fixtures: readonly SeasonFixture[]; europeanPlaceIds?: readonly string[] };

/** The aims' progress at a review, from the season's European games so far (and the places day at the last review). */
export function europeanAimProgress(context: EuropeAimContext): (clubId: string, objective: BoardClubMandate) => { europeProgress: 'open' | 'met' | 'missed'; europeImpact: number } | null {
  let outcomes: ReturnType<typeof getEuropeanCompetitions> | null = null;
  const points = EUROPEAN_ENTRY_RULES.boardPoints;
  const result = (status: 'open' | 'met' | 'missed') => ({ europeProgress: status, europeImpact: status === 'met' ? points : status === 'missed' ? -points : 0 });
  return (clubId, objective) => {
    const aim = objective.europe;
    if (!aim) return null;
    if (aim.kind === 'european-place') return result(context.europeanPlaceIds ? context.europeanPlaceIds.includes(clubId) ? 'met' : 'missed' : 'open');
    if (context.seed === undefined || !context.europe) return result('open');
    outcomes ??= getEuropeanCompetitions({ ...context, seed: context.seed, europe: context.europe }, context.seasonNumber);
    const entry = outcomes.find(item => item.competition.id === aim.competitionId);
    if (!entry) return result('open');
    const stage = (name: string, count: number) => {
      const series = entry.series.filter(item => item.stage === name);
      if (series.some(item => item.higher?.clubId === clubId || item.lower?.clubId === clubId)) return 'met' as const;
      return series.length >= count && series.every(item => item.higher && item.lower) ? 'missed' as const : 'open' as const;
    };
    switch (aim.kind) {
      case 'euroleague-playoffs': case 'eurocup-quarter-finals': case 'bcl-quarter-finals': return result(stage('quarter-final', 4));
      case 'eurocup-eighth-finals': return result(stage('round-of-16', 8));
      case 'euroleague-play-in': return result(entry.order ? entry.order.indexOf(clubId) < 10 ? 'met' : 'missed' : 'open');
      case 'bcl-round-of-16': {
        const groups = 'roundOf16' in entry ? (entry.roundOf16 as { clubIds: string[] }[]) : [];
        if (groups.some(group => group.clubIds.includes(clubId))) return result('met');
        return result(groups.length && groups.every(group => group.clubIds.length) ? 'missed' : 'open');
      }
    }
  };
}

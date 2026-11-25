import type { SeasonState } from '../domain/season';
import type { TrainingPoints } from '../domain/training';
import type { Player, PlayerAttributes } from '../domain/types';
import { getAcademyProspect, developAcademyPlayer, emptyAcademyPoints } from './academy-policy';
import { roundKey } from './career-world';
import { overallRating } from './overall-rating';
import { scoutingActualAttributes, scoutingExtraAttributes } from './scouting-policy';
import { TRAINING_ATTRIBUTES } from './training';
import { getYouthFixtures } from './youth-competition';

/**
 * How a player has grown (owner feedback, 22 November 2026): the change in the overall rating and in each ability
 * between two moments. Only changes that are not zero are listed in `attributes`.
 */
export interface PlayerGrowth {
  since: 'last week' | 'last youth match';
  overall: number;
  attributes: Partial<Record<keyof PlayerAttributes, number>>;
}

function difference(before: PlayerAttributes, after: PlayerAttributes, position: Player['position'], since: PlayerGrowth['since']): PlayerGrowth {
  const attributes: PlayerGrowth['attributes'] = {};
  for (const key of Object.keys(after) as (keyof PlayerAttributes)[]) {
    const change = (after[key] ?? 0) - (before[key] ?? after[key] ?? 0);
    if (change) attributes[key] = change;
  }
  return { since, overall: overallRating(after, position) - overallRating(before, position), attributes };
}

/**
 * A first-team player's growth since last week. There is no weekly snapshot: the week before is rebuilt from the last
 * training report, which records each player's points gained (current points minus last week's gains, on the date the
 * training week began, so ageing counts too). Null without a report for him this season (for example in week one).
 */
export function seniorGrowthSinceLastWeek(state: SeasonState, playerId: string): PlayerGrowth | null {
  const week = state.training.lastWeek, report = week?.players[playerId];
  if (!week || !report || week.seasonNumber !== state.seasonNumber) return null;
  const player = state.clubs.flatMap(club => club.players).find(item => item.id === playerId);
  const points = state.training.points[playerId];
  if (!player || !points) return null;
  const before = Object.fromEntries(TRAINING_ATTRIBUTES.map(key => [key, Math.max(0, points[key] - report.gains[key])])) as TrainingPoints;
  const earlier = { ...state, date: week.fromDate, training: { ...state.training, points: { ...state.training.points, [playerId]: before } } };
  const now = { ...scoutingActualAttributes(state, playerId), ...scoutingExtraAttributes(state, playerId) };
  const then = { ...scoutingActualAttributes(earlier, playerId), ...scoutingExtraAttributes(earlier, playerId) };
  return difference(then, now, player.position, 'last week');
}

/**
 * An academy prospect's growth since his club's last played youth match this season: his academy points then are the
 * last weekly report before that match. Without a youth match yet, since last week (the last weekly report's start).
 */
export function youthGrowth(state: SeasonState, playerId: string): PlayerGrowth | null {
  const prospect = getAcademyProspect(state, playerId);
  const current = state.academy.points[playerId];
  if (!prospect || !current) return null;
  const club = prospect.clubId;
  const lastMatch = getYouthFixtures(state).filter(fixture => fixture.result?.played && fixture.round <= state.round && (fixture.homeClubId === club || fixture.awayClubId === club)).sort((a, b) => a.round - b.round).at(-1);
  const weeks = state.academy.weeks.filter(week => Object.hasOwn(week.players, playerId));
  let baseline: TrainingPoints | null;
  if (lastMatch) {
    const before = weeks.filter(week => roundKey(week.seasonNumber, week.afterRound) < roundKey(lastMatch.seasonNumber, lastMatch.round)).at(-1);
    baseline = before ? before.players[playerId]!.pointsAfter : emptyAcademyPoints();
  } else {
    const last = weeks.at(-1), report = last?.players[playerId];
    if (!last || !report || last.seasonNumber !== state.seasonNumber) return null;
    baseline = 'pointsBefore' in report ? report.pointsBefore : weeks.at(-2)?.players[playerId]?.pointsAfter ?? emptyAcademyPoints();
  }
  const now = developAcademyPlayer(prospect, current, state.world), then = developAcademyPlayer(prospect, baseline, state.world);
  return difference(then.attributes, now.attributes, prospect.player.position, lastMatch ? 'last youth match' : 'last week');
}

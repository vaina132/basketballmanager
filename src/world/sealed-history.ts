import type { AcademyWeek, AcademyWeekPlayer } from '../domain/academy';
import type { BoardClubReview, BoardReview } from '../domain/board';
import type { RelationshipEvent } from '../domain/relationships';
import type { ClubScouting } from '../domain/scouting';
import type { ArchivedFixture, SeasonArchive, SeasonState } from '../domain/season';
import type { Side } from '../domain/types';
import type { YouthCompetitionSeason, YouthFixture, YouthFixtureSealed } from '../domain/youth-competition';
import { managedClubFor } from './career';
import { archivedSidePlayerIds, fixturePlayerEvidence } from './senior-history';

/**
 * Format 73 (step 3.7, save size): completed seasons are sealed at each rollover, so a save stops growing by every
 * historical box score, youth line and weekly academy report. What the game reads later stays:
 * - Senior games: the latest completed season keeps the format-45 record (rival games keep per-player appearances,
 *   which morale reads across the season boundary). Older seasons keep, for rival games, the result, diagnoses and
 *   each side's personal fouls (tie-break rules) beside the exact season totals; the manager's games keep full box
 *   scores.
 * - Youth games of completed seasons keep their results and diagnoses (later availability); rival squads and player
 *   lines do not. The managed club's games stay complete.
 * - Academy weeks of completed seasons keep each prospect's last report of the season (its accumulated points at the
 *   season end), every week's identity and the final week's staff.
 * - Scouting reports of the seasons whose senior games are sealed keep their observer and evidence but not the
 *   ledger position at assignment (an audit anchor nothing reads later).
 * - Only the latest board review lists each club's counted games, and only the latest morale snapshot frozen before a
 *   matchday keeps its values: nothing reads earlier ones (`withoutCountedGames`, `withoutEarlierMorale`, also applied
 *   every week).
 * Strict checks replay the current season from these records and check sealed seasons by their shape and totals.
 */
export const SEALED_HISTORY_FORMAT = 73;

/** The latest completed season whose rival senior games are sealed (0: none). */
export const seniorSealedThrough = (seasonNumber: number): number => Math.max(0, seasonNumber - 2);

export function isSealedSeniorResult(result: ArchivedFixture['result'] | null | undefined): boolean {
  return !!result && Object.hasOwn(result, 'fouls');
}

export function isSealedYouthFixture(fixture: YouthFixture): fixture is YouthFixtureSealed {
  return 'detail' in fixture && fixture.detail === 'season';
}

/** Each side's personal fouls from the retained per-player evidence of its selected (or registered) players. */
export function archivedSideFouls(archive: Pick<SeasonArchive, 'rosters'>, fixture: ArchivedFixture): Record<Side, number> {
  const side = (which: Side) => {
    const ids = fixture.result.selection ? fixture.result.selection[which] : archivedSidePlayerIds(archive, fixture, which);
    return ids.reduce((sum, id) => sum + (fixturePlayerEvidence(fixture, id)?.fouls ?? 0), 0);
  };
  return { home: side('home'), away: side('away') };
}

function sealSeniorArchive(archive: SeasonArchive): SeasonArchive {
  // Only format-45 season totals can be sealed: their appearances become the season totals already kept.
  if (!archive.summary || !archive.fixtures.some(fixture => fixture.result.appearances)) return archive;
  const fixtures = archive.fixtures.map((fixture): ArchivedFixture => {
    const result = fixture.result;
    if (!result.appearances) return fixture;
    return { ...fixture, result: { score: result.score, officialScore: result.officialScore, winnerClubId: result.winnerClubId, kind: result.kind, periods: result.periods, injuries: result.injuries, stats: null, fouls: archivedSideFouls(archive, fixture) } };
  });
  return { ...archive, fixtures };
}

function sealYouthSeason(season: YouthCompetitionSeason, managedClubId: string): YouthCompetitionSeason {
  let changed = false;
  const fixtures = season.fixtures.map((fixture): YouthFixture => {
    if (!fixture.result || isSealedYouthFixture(fixture) || fixture.homeClubId === managedClubId || fixture.awayClubId === managedClubId) return fixture;
    changed = true;
    const { id, seasonNumber, round, date, homeClubId, awayClubId, result } = fixture;
    return { id, seasonNumber, round, date, homeClubId, awayClubId, detail: 'season', home: null, away: null, startingConditions: null, result: { ...result, stats: {} } };
  });
  return changed ? { ...season, fixtures } : season;
}

/** Keep each prospect's last report of every completed season, and the staff of each season's final week. */
function sealAcademyWeeks(weeks: readonly AcademyWeek[], currentSeason: number): AcademyWeek[] | null {
  const last = new Map<string, number>(), finalWeek = new Map<number, number>();
  for (const [index, week] of weeks.entries()) {
    if (week.seasonNumber >= currentSeason) continue;
    finalWeek.set(week.seasonNumber, index);
    for (const id of Object.keys(week.players)) last.set(`${week.seasonNumber}|${id}`, index);
  }
  let changed = false;
  const sealed = weeks.map((week, index) => {
    if (week.seasonNumber >= currentSeason) return week;
    const keep = finalWeek.get(week.seasonNumber) === index;
    const players: Record<string, AcademyWeekPlayer> = {};
    for (const [id, player] of Object.entries(week.players)) if (last.get(`${week.seasonNumber}|${id}`) === index) players[id] = player;
    const coaches = keep ? week.coaches : {};
    if (Object.keys(players).length === Object.keys(week.players).length && coaches === week.coaches) return week;
    changed = true;
    return { ...week, coaches, players };
  });
  return changed ? sealed : null;
}

/** Board reviews without each club's list of counted games (kept on the latest review only). */
export function withoutCountedGames(reviews: readonly BoardReview[]): BoardReview[] {
  return reviews.map(review => Object.values(review.clubs).some(club => club.fixtureIds) ? { ...review, clubs: Object.fromEntries(Object.entries(review.clubs).map(([clubId, club]): [string, BoardClubReview] => { const { fixtureIds: _ids, ...rest } = club; return [clubId, rest]; })) } : review);
}

/** Every morale snapshot frozen before a matchday but the latest is emptied; the same list when nothing changes. */
export function withoutEarlierMorale(events: readonly RelationshipEvent[]): RelationshipEvent[] {
  let last = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) if (events[index]!.type === 'prepare') { last = index; break; }
  let changed = false;
  const next = events.map((event, index) => {
    if (event.type !== 'prepare' || index === last || !Object.keys(event.rosterIds).length && !Object.keys(event.values).length) return event;
    changed = true;
    return { ...event, rosterIds: {}, values: {} };
  });
  return changed ? next : events as RelationshipEvent[];
}

/** Seal every completed season as described above. Idempotent and immutable. */
export function sealCompletedHistory(state: SeasonState): SeasonState {
  let next = state;
  const through = seniorSealedThrough(state.seasonNumber);
  if (state.history.some(archive => archive.seasonNumber <= through)) {
    let changed = false;
    const history = state.history.map(archive => {
      if (archive.seasonNumber > through) return archive;
      const sealed = sealSeniorArchive(archive);
      changed ||= sealed !== archive;
      return sealed;
    });
    if (changed) next = { ...next, history };
  }
  const youth = next.youthCompetition;
  if (youth?.seasons.some(season => season.seasonNumber < next.seasonNumber)) {
    let changed = false;
    const seasons = youth.seasons.map(season => {
      if (season.seasonNumber >= next.seasonNumber) return season;
      const sealed = sealYouthSeason(season, managedClubFor(next, season.seasonNumber, false));
      changed ||= sealed !== season;
      return sealed;
    });
    if (changed) next = { ...next, youthCompetition: { ...youth, seasons } };
  }
  const weeks = next.academy?.weeks.length ? sealAcademyWeeks(next.academy.weeks, next.seasonNumber) : null;
  if (weeks) next = { ...next, academy: { ...next.academy, weeks } };
  if (next.scouting?.enabledSince && Object.values(next.scouting.clubs).some(club => club.reviews.some(review => review.seasonNumber <= through && review.observer?.assignedLedgerIndex !== undefined))) {
    const clubs = Object.fromEntries(Object.entries(next.scouting.clubs).map(([clubId, club]): [string, ClubScouting] => [clubId, club.reviews.some(review => review.seasonNumber <= through && review.observer?.assignedLedgerIndex !== undefined)
      ? { ...club, reviews: club.reviews.map(review => {
        if (review.seasonNumber > through || review.observer?.assignedLedgerIndex === undefined) return review;
        const { assignedLedgerIndex: _index, ...observer } = review.observer;
        return { ...review, observer };
      }) } : club]));
    next = { ...next, scouting: { ...next.scouting, clubs } };
  }
  if (next.board?.reviews.length) {
    const reviews = withoutCountedGames(next.board.reviews.slice(0, -1));
    if (reviews.some((review, index) => review !== next.board.reviews[index])) next = { ...next, board: { ...next.board, reviews: [...reviews, next.board.reviews.at(-1)!] } };
  }
  if (next.relationships?.events.length) {
    const events = withoutEarlierMorale(next.relationships.events);
    if (events !== next.relationships.events) next = { ...next, relationships: { ...next.relationships, events } };
  }
  return next;
}

import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { compactJson3 } from '../src/storage/compact-json';
import { packSeasonForSave } from '../src/storage/save-packing';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { getYouthStandings } from '../src/world/youth-competition';
import { getSeasonPerformance } from '../src/world/performance';
import { managedClubFor } from '../src/world/career';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { isSealedSeniorResult, isSealedYouthFixture } from '../src/world/sealed-history';
import { createSeason, getStandings, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { advanceMatchday } from './helpers/board-funding';

// Format 73 (step 3.7): completed seasons are sealed at rollover so a long career's save stops growing by every
// historical box score, youth line and weekly academy report, while the screens that read them keep working.
function playSeason(state: SeasonState): SeasonState {
  while (state.status === 'active') state = advanceMatchday(state);
  for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
  return state;
}
const withoutSummaryGames = (rows: ReturnType<typeof getSeasonPerformance>) => rows.map(({ summaryGames: _games, ...row }) => row);
const archiveTable = (state: SeasonState, seasonNumber: number) => {
  const archive = state.history.find(item => item.seasonNumber === seasonNumber)!;
  return getStandings({ ...state, fixtures: archive.fixtures, ...(archive.divisions ? { divisions: archive.divisions } : {}) });
};

describe('sealed completed seasons (format 73)', () => {
  it('seals older seasons at rollover, keeps the screens that read them and round-trips after two rollovers', () => {
    const manager = { name: 'Sealed Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
    let state = setEmploymentDelegation(createSeason({ seed: 31, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS }), true);
    state = rolloverSeason(playSeason(state));

    // Season 2 opening: season 1's senior games keep their per-game appearances (morale reads across the boundary);
    // its youth games and academy weeks are sealed already.
    const managed1 = managedClubFor(state, 1, false);
    const first = state.history[0]!;
    expect(first.fixtures.some(fixture => fixture.result.appearances)).toBe(true);
    expect(first.fixtures.some(fixture => isSealedSeniorResult(fixture.result))).toBe(false);
    const youth1 = state.youthCompetition.seasons.find(season => season.seasonNumber === 1)!;
    for (const fixture of youth1.fixtures) {
      const own = [fixture.homeClubId, fixture.awayClubId].includes(managed1);
      expect(isSealedYouthFixture(fixture)).toBe(!own);
      if (!own) expect(fixture.result!.stats).toEqual({});
    }
    const weeks1 = state.academy.weeks.filter(week => week.seasonNumber === 1);
    const lastWeek = weeks1.at(-1)!, seen = new Set<string>();
    for (const week of [...weeks1].reverse()) for (const id of Object.keys(week.players)) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(Object.keys(lastWeek.coaches).length).toBeGreaterThan(0);
    expect(weeks1.slice(0, -1).every(week => Object.keys(week.coaches).length === 0)).toBe(true);
    const table1 = archiveTable(state, 1), performance1 = getSeasonPerformance(state, 1), youthTable1 = getYouthStandings(state, 1);
    expect(performance1.some(row => row.games > 0)).toBe(true);

    state = playSeason(state);
    const end2 = parseSeason(serializeSeasonCompact(state));
    expect(end2).toEqual(state);
    state = rolloverSeason(state);

    // Season 3 opening: season 1's rival senior games are sealed; the manager's games keep full box scores.
    const sealed = state.history[0]!;
    let rival = 0, own = 0;
    for (const fixture of sealed.fixtures) {
      if ([fixture.homeClubId, fixture.awayClubId].includes(managed1)) { expect(fixture.result.stats).not.toBeNull(); own += 1; continue; }
      expect(isSealedSeniorResult(fixture.result)).toBe(true);
      expect(Object.keys(fixture.result).sort()).toEqual(['fouls', 'injuries', 'kind', 'officialScore', 'periods', 'score', 'stats', 'winnerClubId']);
      rival += 1;
    }
    expect(rival).toBeGreaterThan(0);
    expect(own).toBeGreaterThan(0);
    expect(state.history[1]!.fixtures.some(fixture => fixture.result.appearances)).toBe(true);
    // Board reviews of the sealed season keep every club's assessment but not its list of counted games; morale
    // frozen before its matchdays is emptied; the latest completed season keeps both.
    const reviews = (year: number) => state.board.reviews.filter(review => review.seasonNumber === year);
    expect(reviews(1).length).toBeGreaterThan(0);
    expect(reviews(1).every(review => Object.values(review.clubs).every(club => club.fixtureIds === undefined && typeof club.confidence === 'number'))).toBe(true);
    // Only the latest review keeps the lists (every week, not only at rollover).
    expect(state.board.reviews.slice(0, -1).every(review => Object.values(review.clubs).every(club => club.fixtureIds === undefined))).toBe(true);
    expect(Object.values(state.board.reviews.at(-1)!.clubs).every(club => Array.isArray(club.fixtureIds))).toBe(true);
    const prepared = (year: number) => state.relationships.events.filter(event => event.type === 'prepare' && event.seasonNumber === year);
    expect(prepared(1).length).toBeGreaterThan(0);
    expect(prepared(1).every(event => event.type === 'prepare' && Object.keys(event.values).length === 0)).toBe(true);
    // Only the snapshot frozen for the current matchday keeps its values.
    const snapshots = state.relationships.events.filter(event => event.type === 'prepare');
    expect(snapshots.slice(0, -1).every(event => event.type === 'prepare' && Object.keys(event.values).length === 0)).toBe(true);
    expect(snapshots.at(-1)!.seasonNumber).toBe(3);
    expect(Object.keys((snapshots.at(-1) as Extract<typeof snapshots[number], { type: 'prepare' }>).values).length).toBeGreaterThan(0);
    // Season leaders, club tables, player career rows and youth tables of the sealed season are unchanged.
    expect(archiveTable(state, 1)).toEqual(table1);
    expect(withoutSummaryGames(getSeasonPerformance(state, 1))).toEqual(withoutSummaryGames(performance1));
    expect(getYouthStandings(state, 1)).toEqual(youthTable1);
    const totals = new Map(sealed.summary!.players.map(row => [`${row.clubId}|${row.playerId}`, row.games]));
    for (const row of getSeasonPerformance(state, 1)) expect(row.summaryGames ?? 0).toBe(totals.get(`${row.club.id}|${row.player.id}`) ?? 0);

    // A strict save round trip after two rollovers, and again a week into the new season.
    const text = serializeSeasonCompact(state);
    expect(parseSeason(text)).toEqual(state);
    // Season two's history unsealed encodes larger (encoding only: the mixed history is not a career the check accepts).
    const encodedLength = (career: SeasonState) => JSON.stringify(compactJson3(packSeasonForSave(career))).length;
    expect(encodedLength(state)).toBeLessThan(encodedLength({ ...state, history: [end2.history[0]!, state.history[1]!] }));
    const next = advanceMatchday(advanceMatchday(state));
    expect(parseSeason(serializeSeasonCompact(next))).toEqual(next);
  }, 1_800_000);
});

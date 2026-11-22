import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isSealedYouthFixture } from '../src/world/sealed-history';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { offerAcademyPromotion } from '../src/world/academy';
import { getClubAcademy } from '../src/world/academy-policy';
import { managedClubFor } from '../src/world/career';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, previewSeasonEnd, rolloverSeason } from '../src/world/season';
import { getYouthFixtureTeams, getYouthPlayerPerformance, youthCompetitionAtBoundary } from '../src/world/youth-competition';
import { canSummarizeYouthFixture, createYouthHistoryContext, isYouthOutcome, summarizeYouthFixture, summarizeYouthHistory } from '../src/world/youth-history';
import { advanceMatchday } from './helpers/board-funding';

// Genuine pre-change inputs; synthetic cases below exercise retention/read policy, never forged save validation.
const original = name => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/season42-board-${name}.json.gz`, import.meta.url))).toString('utf8')).state;
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const fixtures = state => state.youthCompetition.seasons.flatMap(season => season.fixtures);
const projected = fixture => ({ ...fixture, home: null, away: null, startingConditions: null, detail: 'outcome', playerIds: { home: fixture.home.players.map(player => player.id), away: fixture.away.players.map(player => player.id) } });

describe('historical youth fixture retention', () => {
  it('retains exact result evidence and independent ordered membership while removing only reproducible snapshots', () => {
    const full = freeze(fixtures(original('opening'))[0]);
    const outcome = summarizeYouthFixture(full);
    expect(outcome).toEqual(projected(full));
    expect(outcome.result).toBe(full.result);
    expect(isYouthOutcome(outcome)).toBe(true);
    expect(isYouthOutcome(full)).toBe(false);
    outcome.playerIds.home.reverse();
    expect(full.home.players.map(player => player.id)).toEqual(projected(full).playerIds.home);
    expect(outcome.playerIds.home).not.toEqual(full.home.players.map(player => player.id));
  });

  it('leaves current seasons and empty histories unchanged', () => {
    const current = freeze(original('career'));
    expect(fixtures(current).some(fixture => fixture.result)).toBe(true);
    expect(summarizeYouthHistory(current)).toBe(current);
    const empty = freeze({ ...current, youthCompetition: { ...current.youthCompetition, seasons: [] } });
    expect(summarizeYouthHistory(empty)).toBe(empty);
  });

  it('reduces only older rivals, protects every club latest completed fixture and is immutable and idempotent', () => {
    const state = freeze(original('opening')), before = structuredClone(state);
    const latestByClub = new Map();
    for (const fixture of fixtures(state)) if (fixture.result) for (const id of [fixture.homeClubId, fixture.awayClubId]) latestByClub.set(id, fixture.id);
    const reduced = summarizeYouthHistory(state), after = new Map(fixtures(reduced).map(fixture => [fixture.id, fixture]));
    let outcomes = 0, protectedFixtures = 0;
    for (const fixture of fixtures(state)) {
      const protect = fixture.seasonNumber === state.seasonNumber || !fixture.result || [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId) || [fixture.homeClubId, fixture.awayClubId].some(id => latestByClub.get(id) === fixture.id);
      if (protect) { expect(after.get(fixture.id)).toBe(fixture); protectedFixtures += 1; }
      else { expect(after.get(fixture.id)).toEqual(projected(fixture)); outcomes += 1; }
    }
    expect(outcomes).toBeGreaterThan(0);
    expect(protectedFixtures).toBeGreaterThan(0);
    expect({ ...reduced, youthCompetition: state.youthCompetition }).toEqual(state);
    expect(state).toEqual(before);
    expect(summarizeYouthHistory(reduced)).toBe(reduced);
  });

  it('protects each club latest completed fixture even when another club has played later', () => {
    const state = original('opening'), oldSeason = state.youthCompetition.seasons[0];
    const protectedCandidate = oldSeason.fixtures.filter(fixture => fixture.round < 9 && ![fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId)).at(-1);
    const rival = protectedCandidate.homeClubId;
    oldSeason.fixtures = oldSeason.fixtures.filter(fixture => fixture.round <= protectedCandidate.round || ![fixture.homeClubId, fixture.awayClubId].includes(rival));
    const latest = oldSeason.fixtures.filter(fixture => fixture.result && [fixture.homeClubId, fixture.awayClubId].includes(rival)).at(-1);
    expect(latest.id).toBe(protectedCandidate.id);
    expect(oldSeason.fixtures.at(-1).round).toBeGreaterThan(latest.round);
    expect(canSummarizeYouthFixture(createYouthHistoryContext(state), latest)).toBe(false);
    const reduced = summarizeYouthHistory(freeze(state));
    expect(fixtures(reduced).find(fixture => fixture.id === latest.id)).toEqual(latest);
  });

  it('reconstructs exact original teams after later practice and age-out using the historical player order', () => {
    const source = freeze(original('opening')), reduced = summarizeYouthHistory(source);
    const sourceById = new Map(fixtures(source).map(fixture => [fixture.id, fixture]));
    let oldGraduateSeen = false, count = 0;
    for (const fixture of fixtures(reduced)) if (isYouthOutcome(fixture)) {
      const full = sourceById.get(fixture.id), expected = { home: full.home, away: full.away };
      expect(getYouthFixtureTeams(fixture, reduced)).toEqual(expected);
      expect(getYouthFixtureTeams(full)).toEqual(expected);
      oldGraduateSeen ||= [...full.home.players, ...full.away.players].some(player => source.academy.graduates.some(graduate => graduate.prospectId === player.id));
      count += 1;
    }
    expect(count).toBeGreaterThan(0);
    expect(oldGraduateSeen).toBe(true);
  });

  it('reconstructs both sides of an ordinary promotion boundary without adding or removing a historical player', () => {
    let state = createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
    const prospect = getClubAcademy(state)[0];
    state = advanceMatchday(offerAcademyPromotion(state, prospect.player.id, prospect.prospect.seasonWage));
    expect(state.academy.graduates.find(graduate => graduate.prospectId === prospect.player.id)).toMatchObject({ kind: 'promotion', availableSince: { seasonNumber: 1, round: 2 } });
    state = advanceMatchday(state);
    const before = fixtures(state).find(fixture => fixture.round === 1 && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId));
    const after = fixtures(state).find(fixture => fixture.round === 2 && [fixture.homeClubId, fixture.awayClubId].includes(state.managedClubId));
    expect([...before.home.players, ...before.away.players].some(player => player.id === prospect.player.id)).toBe(true);
    expect([...after.home.players, ...after.away.players].some(player => player.id === prospect.player.id)).toBe(false);
    for (const full of [before, after]) expect(getYouthFixtureTeams(summarizeYouthFixture(full), freeze(state))).toEqual({ home: full.home, away: full.away });
  }, 120_000);

  it('resolves colliding jersey numbers in exact squad order and rejects a mismatched source order', () => {
    const state = original('opening'), context = createYouthHistoryContext(state);
    const full = structuredClone(fixtures(state).find(fixture => canSummarizeYouthFixture(context, fixture)));
    const ids = new Set(full.home.players.map(player => player.id));
    for (const prospect of state.academy.prospects) if (ids.has(prospect.player.id)) prospect.player.number = 9;
    full.home.players = full.home.players.map((player, index) => ({ ...player, number: index === 0 ? 9 : index }));
    const summary = summarizeYouthFixture(full), teams = getYouthFixtureTeams(summary, state);
    expect(teams).toEqual({ home: full.home, away: full.away });
    expect(teams.home.players.map(player => player.number)).toEqual([9, 1, 2, 3, 4, 5, 6, 7]);
    state.academy.prospects.reverse();
    expect(() => getYouthFixtureTeams(summary, freeze(state))).toThrow(/membership|squad/i);
  });

  it('hides future summarized fixtures without leaking outcome markers or membership at earlier boundaries', () => {
    const reduced = summarizeYouthHistory(freeze(original('opening')));
    const hidden = youthCompetitionAtBoundary(reduced.youthCompetition, 1, 1);
    expect(hidden.seasons).toHaveLength(1);
    for (const fixture of hidden.seasons[0].fixtures) {
      expect(fixture).toMatchObject({ home: null, away: null, startingConditions: null, result: null });
      expect(Object.hasOwn(fixture, 'detail')).toBe(false);
      expect(Object.hasOwn(fixture, 'playerIds')).toBe(false);
    }
    const visible = youthCompetitionAtBoundary(reduced.youthCompetition, 1, 1, true);
    for (const fixture of visible.seasons[0].fixtures.filter(fixture => fixture.round === 1)) expect(fixture).toEqual(fixtures(reduced).find(original => original.id === fixture.id));
  });

  it('preserves unplayed squad membership without inventing statistics or player appearances', () => {
    const state = original('opening'), context = createYouthHistoryContext(state);
    const full = structuredClone(fixtures(state).find(fixture => canSummarizeYouthFixture(context, fixture)));
    const absent = new Set(full.home.players.slice(4).map(player => player.id));
    state.academy.prospects = state.academy.prospects.filter(prospect => !absent.has(prospect.player.id));
    full.home.players = full.home.players.slice(0, 4);
    full.result = { kind: 'default', played: false, score: { home: 0, away: 20 }, officialScore: { home: 0, away: 20 }, winnerClubId: full.awayClubId, periods: 0, stats: {}, injuries: [], reason: 'Insufficient available players.' };
    const outcome = summarizeYouthFixture(freeze(full));
    expect(outcome.playerIds.home).toHaveLength(4);
    expect(outcome.result).toEqual(full.result);
    expect(getYouthFixtureTeams(outcome, state)).toEqual({ home: full.home, away: full.away });
    const view = { ...state, youthCompetition: { ...state.youthCompetition, seasons: [{ ...state.youthCompetition.seasons[0], fixtures: [outcome] }] } };
    expect(getYouthPlayerPerformance(view, full.home.players[0].id, 1)).toEqual({ appearances: 0, secondsPlayed: 0, points: 0, rebounds: 0, assists: 0 });
  });

  it('preserves the former managed club after a real accepted job offer, offseason and validated rollover', () => {
    const from = 'rhine-falcons';
    // Seed 11 (8 before squad roles everywhere, 2 before the planned starting five of 16 November 2026, 10 before the
    // relationships-2 rules of format 66): another club offers Rhine Falcons' manager its job.
    let state = createSeason({ seed: 11, managedClubId: from, injuryMode: 'standard', manager: { name: 'Moving Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' }, ...NEW_CAREER_SYSTEMS, injuryLengths: false, calmPlayingTime: false, staffing: false, careerMoves: true, presidents: false });
    while (state.round < 10) state = advanceMatchday(state);
    const finished = { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) };
    const offer = previewSeasonEnd(finished)?.offers[0];
    expect(offer).toBeDefined();
    state = advanceSeason(finished, { moveTo: offer.clubId });
    const originalFixtures = new Map(fixtures(state).map(fixture => [fixture.id, structuredClone(fixture)]));
    state = setEmploymentDelegation(state, true);
    for (let steps = 0; steps < 120 && getMarketStartReason(state); steps += 1) state = advanceMarket(state);
    expect(getMarketStartReason(state)).toBeNull();
    const opened = rolloverSeason(state);
    expect(opened.managedClubId).not.toBe(from);
    expect(managedClubFor(opened, 1, false)).toBe(from);
    let protectedCount = 0, outcomes = 0;
    for (const fixture of fixtures(opened)) if (fixture.seasonNumber === 1) {
      if ([fixture.homeClubId, fixture.awayClubId].includes(from)) { expect(fixture).toEqual(originalFixtures.get(fixture.id)); expect(isYouthOutcome(fixture)).toBe(false); protectedCount += 1; }
      // Format 73: other clubs' completed-season games keep their results and diagnoses only.
      if (isSealedYouthFixture(fixture)) outcomes += 1;
    }
    expect(protectedCount).toBe(10);
    expect(outcomes).toBeGreaterThan(0);
    const loaded = parseSeason(serializeSeasonCompact(opened));
    expect(loaded).toEqual(opened);
    const next = advanceMatchday(loaded);
    expect(fixtures(next).filter(fixture => fixture.seasonNumber === 2).some(isYouthOutcome)).toBe(false);
  }, 120_000);
});

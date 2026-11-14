import { describe, expect, it } from 'vitest';
import { createSeason, advanceSeason, rolloverSeason, NEW_CAREER_SYSTEMS, managedSide, setMatchdaySelection } from '../src/world/season';
import { simulateToEnd, setAutoSubstitutions, stepMatch } from '../src/engine/match';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { clubSalaryBudget } from '../src/world/club-roster-policy';
import { getClubContractSummary } from '../src/world/employment-policy';
import { setEmploymentDelegation } from '../src/world/employment';
import { getFixtureTeams } from '../src/world/rosters';
import { getSeasonPerformance } from '../src/world/performance';
import { assignScouting } from '../src/world/scouting';
import { fixturePlayerEvidence } from '../src/world/senior-history';
import { fullRosterWorld } from './full-roster-fixtures';
import type { SeasonState } from '../src/domain/season';
import { advanceMarket } from '../src/world/market';
import { getNextMarketDate } from '../src/world/market-policy';
import { submitInSeasonTransferOffer } from '../src/world/recruitment';
import { requiredInSeasonTransferFee } from '../src/world/recruitment-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { contractForRound } from '../src/world/employment-policy';
import { getPlayerPayroll } from '../src/world/payroll';
import { getPlayerRelationship } from '../src/world/relationships';

const world = fullRosterWorld();
const opening = () => createSeason({ seed: 8083, world, managedClubId: world.clubs[2]!.id, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
const completeRound = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });

describe('full club rosters and separate matchday selection', () => {
  it('retains every player and funds/payrolls the full club while fielding no more than twelve', () => {
    const state = opening();
    expect(state.clubs.map(club => club.players.length)).toEqual([9, 14, 17, 25]);
    expect(state.employment.contracts).toHaveLength(65);
    expect(Object.keys(state.training.points)).toHaveLength(65);
    for (const club of state.clubs) {
      expect(getClubContractSummary(state, club.id, 1).seasonWages).toBe(club.players.length * 1_200_000);
      expect(getClubContractSummary(state, club.id, 1).budget).toBe(clubSalaryBudget(state, club.id));
    }
    expect(state.activeMatch[managedSide(state)].players).toHaveLength(12);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
  });
  it('changes the selected twelve before tipoff without spending money and rejects invalid or late changes', () => {
    const state = opening(), side = managedSide(state), current = state.activeMatch[side].players.map(player => player.id);
    const outsider = state.clubs[2]!.players.find(player => !current.includes(player.id))!.id;
    const requested = [...current.slice(1), outsider], next = setMatchdaySelection(state, requested);
    expect(next.activeMatch[side].players.map(player => player.id)).toContain(outsider);
    expect(next.finance).toBe(state.finance);
    expect(next.payroll).toBe(state.payroll);
    expect(state.activeMatch[side].players.map(player => player.id)).toEqual(current);
    expect(setMatchdaySelection(state, [...requested].reverse())).toEqual(next);
    expect(() => setMatchdaySelection(state, current.slice(0, 4))).toThrow(/five to twelve/);
    expect(() => setMatchdaySelection(state, [...current, outsider])).toThrow(/five to twelve/);
    expect(() => setMatchdaySelection(state, [...current.slice(1), current[1]!])).toThrow(/different registered/);
    expect(() => setMatchdaySelection(state, [...current.slice(1), state.clubs[0]!.players[0]!.id])).toThrow(/registered/);
    expect(() => setMatchdaySelection({ ...state, activeMatch: stepMatch(state.activeMatch) }, null)).toThrow(/before tipoff/);
    expect(parseSeason(serializeSeasonCompact(next))).toEqual(next);
  });
  it('retains non-selected members through training, wages, results and repeated save/load', () => {
    let state = opening();
    const selected = state.activeMatch[managedSide(state)].players.map(player => player.id);
    state = setMatchdaySelection(state, selected);
    const resting = state.clubs[2]!.players.filter(player => !selected.includes(player.id));
    for (let round = 0; round < 3; round++) {
      const before = state;
      state = completeRound(state);
      const fixture = state.fixtures.find(fixture => fixture.id === before.activeFixtureId)!;
      expect(fixture.result!.selection!.rested).toMatchObject(Object.fromEntries(resting.map(player => [player.id, before.conditions[player.id]])));
      for (const player of resting) {
        expect(fixture.result!.stats[player.id]).toBeUndefined();
        expect(fixturePlayerEvidence(fixture, player.id)).toEqual({ secondsPlayed: 0, fouls: 0, appeared: false });
        expect(state.training.lastWeek!.players[player.id]).toBeDefined();
      }
      expect(getFixtureTeams(state, fixture)[managedSide(before)].players.map(player => player.id)).toEqual(selected);
      expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
    }
    expect(state.clubs[2]!.players).toHaveLength(17);
    const records = getSeasonPerformance(state);
    expect(records.find(row => row.player.id === resting[0]!.id)?.games).toBe(0);
  });
  it('does not reveal ability when a scouting target was outside the matchday squad', () => {
    let state = opening();
    const side = managedSide(state) === 'home' ? 'away' : 'home', opponent = state.clubs.find(club => club.id === state.activeMatch[side].id)!;
    const selected = new Set(state.activeMatch[side].players.map(player => player.id));
    const target = opponent.players.find(player => !selected.has(player.id))!;
    state = assignScouting(state, target.id);
    state = completeRound(state);
    expect(state.scouting.clubs[state.managedClubId]!.reviews.find(review => review.playerId === target.id)).toMatchObject({ outcome: 'no-minutes', attributes: null });
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
  });
  it('accepts a transfer into a roster already larger than twelve and retains the old match squad', () => {
    let state = opening();
    const selected = state.activeMatch[managedSide(state)].players.map(player => player.id);
    state = setMatchdaySelection(state, selected);
    const seller = state.clubs[1]!, target = seller.players[0]!.id;
    const wage = requiredNegotiationWage(target, 1, undefined, state), fee = requiredInSeasonTransferFee(state, target);
    const pending = submitInSeasonTransferOffer(state, target, wage, 1, fee);
    const next = completeRound(pending);
    expect(contractForRound(next.employment, target, 1, 2)?.clubId).toBe(state.managedClubId);
    expect(next.clubs[2]!.players).toHaveLength(18);
    expect(next.activeMatch[managedSide(next)].players.map(player => player.id)).toEqual(selected);
    expect(getPlayerPayroll(next, target)?.agreement).toMatchObject({ clubId: state.managedClubId, startsRound: 2 });
    const previous = next.fixtures.find(fixture => fixture.id === state.activeFixtureId)!;
    expect(getFixtureTeams(next, previous)[managedSide(state)].players.map(player => player.id)).toEqual(selected);
    expect(next.training.plans[state.managedClubId]!.individual[target]).toBe('team');
    expect(parseSeason(serializeSeasonCompact(next))).toEqual(next);
  });
  it('counts healthy players left outside the twelve as zero-minute games', () => {
    let state = opening();
    const selected = state.activeMatch[managedSide(state)].players.map(player => player.id);
    state = setMatchdaySelection(state, selected);
    const player = state.clubs[2]!.players.find(player => !selected.includes(player.id))!;
    for (let i = 0; i < 3; i++) state = completeRound(state);
    const relationship = getPlayerRelationship(state, player.id);
    expect(relationship).toMatchObject({ eligibleGames: 3, averageMinutes: 0 });
  });
  it('rejects damaged or inconsistent selections in strict imports', () => {
    const state = completeRound(opening());
    const parse = (value: SeasonState, version: number = value.schemaVersion) => parseSeason(JSON.stringify({ format: 'basketball-manager-season', formatVersion: version, engineVersion: 'possession-3', state: value }));
    const corrupt = (edit: (copy: SeasonState) => void) => { const copy = structuredClone(state); edit(copy); expect(() => parse(copy)).toThrow(); };
    const result = (copy: SeasonState) => copy.fixtures.find(fixture => fixture.result)!.result!;
    corrupt(copy => { result(copy).selection!.home[0] = 'foreign-player'; });
    corrupt(copy => { result(copy).selection!.home[0] = result(copy).selection!.home[1]!; });
    corrupt(copy => { result(copy).selection!.home.push(...result(copy).selection!.away); });
    corrupt(copy => { const rested = result(copy).selection!.rested; delete rested[Object.keys(rested)[0]!]; });
    corrupt(copy => { const rested = result(copy).selection!.rested; rested[Object.keys(rested)[0]!] = -1; });
    corrupt(copy => { delete copy.plans[copy.managedClubId]!.matchday; });
    corrupt(copy => { copy.plans[copy.managedClubId]!.matchday = copy.clubs[0]!.players.slice(0, 5).map(player => player.id); });
    expect(() => parse({ ...state, schemaVersion: 45 } as unknown as SeasonState, 45)).toThrow();
  });
  it('preserves original match selections and season totals after rollover and retirement/market processing', () => {
    let state = opening();
    while (state.status !== 'complete') state = completeRound(state);
    const before = getSeasonPerformance(state), original = state.fixtures[0]!;
    state = setEmploymentDelegation(state, true);
    for (let day = 0; getNextMarketDate(state) && day < 40; day++) state = advanceMarket(state);
    state = rolloverSeason(state);
    expect(state.seasonNumber).toBe(2);
    const totals = (rows: ReturnType<typeof getSeasonPerformance>) => rows.map(({ log, summaryGames, ...row }) => row);
    expect(totals(getSeasonPerformance(state, 1))).toEqual(totals(before));
    const archived = state.history[0]!.fixtures.find(fixture => fixture.id === original.id)!;
    expect(archived.result.selection).toEqual(original.result!.selection);
    expect(parseSeason(serializeSeasonCompact(state))).toEqual(state);
  }, 120_000);
});


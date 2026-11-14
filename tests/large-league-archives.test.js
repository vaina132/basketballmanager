import { beforeAll, describe, expect, it } from 'vitest';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { seasonRounds } from '../src/world/career-world';
import { offerPlayerContract, setEmploymentDelegation } from '../src/world/employment';
import { getAvailablePlayers, quotePlayerContract } from '../src/world/employment-policy';
import { getCareerWage } from '../src/world/player-catalog';
import { getFixtureTeams } from '../src/world/rosters';
import { advanceSeason, createSeason, managedSide, rolloverSeason } from '../src/world/season';
import { testWorld } from './world-fixtures';

// A 24-club league has 46 rounds: the old `version >= rounds - 1` check skipped format-41 archive rosters.
// Generate the actual season and a real offseason signing. No version edits or fabricated historical results.
let nextSeason, text, signedPlayerId, departedPlayerId;
beforeAll(() => {
  const world = testWorld(24);
  let state = createSeason({
    seed: 83, managedClubId: world.clubs[0].id, world, injuryMode: 'off',
    training: false, coaching: false, finance: true, payroll: true, employment: true,
  });
  const originalSquad = new Set(state.clubs[0].players.map(player => player.id));
  expect(seasonRounds(state)).toBe(46);
  for (let count = 0; state.status === 'active' && count < 46; count += 1) {
    state = advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
  }
  expect(state.status).toBe('complete');
  expect(state.fixtures).toHaveLength(552);
  const signing = getAvailablePlayers(state).find(player => !originalSquad.has(player.id)
    && quotePlayerContract(state, player.id, getCareerWage(state, player.id), 1).canOffer);
  expect(signing).toBeDefined();
  signedPlayerId = signing.id;
  state = offerPlayerContract(state, signedPlayerId, getCareerWage(state, signedPlayerId), 1);
  nextSeason = rolloverSeason(setEmploymentDelegation(state, true));
  const currentSquad = new Set(nextSeason.clubs.find(club => club.id === nextSeason.managedClubId).players.map(player => player.id));
  departedPlayerId = [...originalSquad].find(id => !currentSquad.has(id));
  expect(currentSquad.has(signedPlayerId)).toBe(true);
  expect(departedPlayerId).toBeDefined();
  text = serializeSeason(nextSeason);
}, 120_000);

describe('archived rosters in a league longer than the save-format number', () => {
  it('loads the genuine second season and reviews the old squad rather than its offseason replacement', () => {
    const restored = parseSeason(text);
    expect(restored).toEqual(nextSeason);
    expect(restored.seasonNumber).toBe(2);
    const archive = restored.history[0];
    const fixture = archive.fixtures.find(game => [game.homeClubId, game.awayClubId].includes(restored.managedClubId));
    const teams = getFixtureTeams(restored, fixture, archive.seasonNumber);
    const historicalSquad = [teams.home, teams.away].find(team => team.id === restored.managedClubId);
    expect(historicalSquad.players.some(player => player.id === departedPlayerId)).toBe(true);
    expect(historicalSquad.players.some(player => player.id === signedPlayerId)).toBe(false);
    expect(fixture.result.stats[departedPlayerId]).toBeDefined();
  }, 120_000);

  it.each([
    ['snapshot identity', roster => { roster.id = 'invented-old-roster'; }],
    ['original player identity', roster => { roster.players[0].name = 'Changed historical name'; }],
    ['original ability', roster => { roster.players[0].attributes.passing = roster.players[0].attributes.passing === 20 ? 19 : 20; }],
    ['original membership', roster => { roster.players.pop(); }],
  ])('rejects damaged historical %s even after the current squad has changed', (_label, damage) => {
    const file = JSON.parse(text);
    const roster = file.state.history[0].rosters.find(entry => entry.clubId === file.state.managedClubId);
    damage(roster);
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/history\[0\]\.rosters/);
  });
});

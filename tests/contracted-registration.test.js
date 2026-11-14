import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';
import { getContractedClubsForRound } from '../src/world/employment-policy';

const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
// Isolated registration timelines. Small squads make ordering and shirt collisions explicit;
// real accepted transfer/academy saves are exercised by the storage and continuation suites.
function scenario() {
  const clubs = structuredClone(DEVELOPMENT_WORLD.clubs).map((club, index) => ({ ...club, players: club.players.slice(0, index === 0 ? 3 : 1) }));
  const [a, b, c] = clubs;
  a.players.forEach((player, index) => { player.number = [7, 7, 1][index]; });
  b.players[0].number = 7; c.players[0].number = 7;
  const contracts = clubs.flatMap(club => club.players.map(player => ({ id: `opening-${player.id}`, clubId: club.id, playerId: player.id, startsSeason: 1, endsSeason: 2, startsRound: 1 })));
  const contract = (id, player, club, round) => ({ id, playerId: player.id, clubId: club.id, startsSeason: 1, endsSeason: 2, startsRound: round });
  contracts.push(contract('arrival-b', b.players[0], a, 2), contract('arrival-c', c.players[0], a, 3), contract('return-a', a.players[0], a, 3));
  const transfers = [
    { startsSeason: 1, startsRound: 2, releasedContractIds: [`opening-${a.players[0].id}`, `opening-${b.players[0].id}`] },
    { startsSeason: 1, startsRound: 3, releasedContractIds: [`opening-${a.players[1].id}`, `opening-${c.players[0].id}`] },
  ];
  return { world: { ...DEVELOPMENT_WORLD, id: 'registration-order', clubs }, clubs, employment: { enabledSince: { seasonNumber: 1, round: 1 }, contracts, transfers, buyouts: [] } };
}
const shirts = (state, year, round) => getContractedClubsForRound(state, year, round)[0].players.map(player => [player.id, player.number]);

describe('historical registration order', () => {
  it('keeps catalog order at opening and chronological contract order for arrivals and returns', () => {
    const state = freeze(scenario()), [a, b, c] = state.clubs, [first, second, third] = a.players;
    expect(shirts(state, 1, 1)).toEqual([[first.id, 7], [second.id, 1], [third.id, 2]]);
    expect(shirts(state, 1, 2)).toEqual([[second.id, 1], [third.id, 2], [b.players[0].id, 7]]);
    const later = [[third.id, 2], [b.players[0].id, 7], [c.players[0].id, 1], [first.id, 3]];
    expect(shirts(state, 1, 3)).toEqual(later);
    expect(shirts(state, 1, 10)).toEqual(later);
    // Asking about later registrations never rewrites a prior squad or its source attributes.
    expect(shirts(state, 1, 1)).toEqual([[first.id, 7], [second.id, 1], [third.id, 2]]);
    const returned = getContractedClubsForRound(state, 1, 3)[0].players.at(-1);
    expect(returned.attributes).toEqual(first.attributes);
    expect(returned.attributes).not.toBe(first.attributes);
    expect(Object.isFrozen(returned.attributes)).toBe(true);
  });

  it('introduces a graduate at the actual arrival boundary, after earlier senior arrivals', () => {
    const state = scenario(), a = state.clubs[0];
    const player = { ...structuredClone(a.players[0]), id: 'graduated-prospect', number: 7 };
    state.academy = { enabledSince: { seasonNumber: 1, round: 1 }, graduates: [{ player, availableSince: { seasonNumber: 1, round: 4 } }] };
    state.employment.contracts.push({ id: 'graduate-contract', playerId: player.id, clubId: a.id, startsSeason: 1, endsSeason: 1, startsRound: 4 });
    freeze(state);
    expect(shirts(state, 1, 3).some(([id]) => id === player.id)).toBe(false);
    expect(shirts(state, 1, 4).at(-1)).toEqual([player.id, 4]);
    expect(shirts(state, 1, 10).at(-1)).toEqual([player.id, 4]);
  });

  it('keeps next-season buyouts out of historical registration and resets opening jersey assignment', () => {
    const state = scenario(), [a, b, c] = state.clubs;
    state.employment.buyouts.push({ startsSeason: 2, releasedContractIds: ['arrival-b'] });
    freeze(state);
    expect(shirts(state, 1, 3).some(([id]) => id === b.players[0].id)).toBe(true);
    expect(shirts(state, 2, 1)).toEqual([[a.players[0].id, 7], [a.players[2].id, 1], [c.players[0].id, 2]]);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { PlayerKnowledge } from '../src/domain/scouting';
import { DEVELOPMENT_PLAYERS } from '../src/data/development-players';
import { DEVELOPMENT_SCOUTS } from '../src/data/development-scouts';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { serializeSeason } from '../src/storage/season-storage';
import { abilityRating } from '../src/world/performance-rating';
import { getClubScouts } from '../src/world/scout-policy';
import { hireScout, releaseScout } from '../src/world/scouts';
import { assignScouting, cancelScoutingAssignment, setShortlisted } from '../src/world/scouting';
import { compareScoutingPlayers, getScoutingDiscovery, scoutDiscoveryGain, type ScoutingSortEntry } from '../src/world/scouting-discovery';
import { getPlayerKnowledge, quoteScoutingAssignment, SCOUTING_ATTRIBUTES } from '../src/world/scouting-policy';
import { advanceSeason, createSeason, managedSide } from '../src/world/season';

const club = 'rhine-falcons';
const scout = (id: string) => DEVELOPMENT_SCOUTS.find(scout => scout.id === id)!;
const play = (state: SeasonState) => advanceSeason({ ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) });
let baseline: SeasonState, low: SeasonState, high: SeasonState;
beforeAll(() => {
  baseline = createSeason(19, club, 'off', true, false, true, true, null, false, true, false, false, true);
  low = hireScout(baseline, 'scout-06');
  high = hireScout(baseline, 'scout-19');
});

describe('scout discovery range', () => {
  it('starts with20 outsiders plus the own squad without using hidden ability or match randomness', () => {
    const before = serializeSeason(baseline), discovery = getScoutingDiscovery(baseline);
    expect(discovery).toMatchObject({ networkOutsideCount: 20, totalOutsideCount: 50, scoutCount: 0, retainedOutsideCount: 0 });
    expect(discovery.playerIds).toHaveLength(30);
    for (const player of baseline.clubs.find(team => team.id === club)!.players) expect(discovery.playerIds).toContain(player.id);
    const differentSkills = { ...baseline, seed: 123, training: { ...baseline.training, points: Object.fromEntries(Object.entries(baseline.training.points).map(([id, points]) => [id, Object.fromEntries(Object.keys(points).map(key => [key, 100]))])) } } as SeasonState;
    expect(getScoutingDiscovery(differentSkills)).toEqual(discovery);
    expect(serializeSeason(baseline)).toBe(before);
  });

  it('expands a stable prefix with scout quality and headcount', () => {
    const initial = getScoutingDiscovery(baseline), weaker = getScoutingDiscovery(low), stronger = getScoutingDiscovery(high);
    expect(weaker.networkOutsideCount).toBe(26);
    expect(stronger.networkOutsideCount).toBe(32);
    expect(weaker.networkPlayerIds.slice(0, 20)).toEqual(initial.networkPlayerIds);
    expect(stronger.networkPlayerIds.slice(0, 26)).toEqual(weaker.networkPlayerIds);
    const both = getScoutingDiscovery(hireScout(low, 'scout-19'));
    expect(both.networkOutsideCount).toBe(38);
    expect(both.networkPlayerIds.slice(0, 32)).toEqual(stronger.networkPlayerIds);
  });

  it('caps coverage at actual outsiders without duplicate names', () => {
    const staffed = hireScout(hireScout(high, 'scout-20'), 'scout-21');
    const discovery = getScoutingDiscovery(staffed);
    expect(discovery.networkOutsideCount).toBe(50);
    expect(discovery.playerIds).toHaveLength(DEVELOPMENT_PLAYERS.length);
    expect(new Set(discovery.playerIds).size).toBe(discovery.playerIds.length);
    expect(scoutDiscoveryGain(staffed, scout('scout-06'))).toEqual({ rangeIncrease: 0, newPlayers: 0 });
  });

  it('reveals identities without revealing ability and leaves observation command permissions intact', () => {
    const known = new Set(getScoutingDiscovery(baseline).playerIds);
    const newlyVisible = getScoutingDiscovery(high).playerIds.filter(id => !known.has(id));
    expect(newlyVisible.length).toBe(12);
    for (const id of newlyVisible) {
      expect(getPlayerKnowledge(high, id)).toMatchObject({ kind: 'unknown', attributes: null, ranges: null });
      expect(abilityRating(getPlayerKnowledge(high, id))).toEqual({ kind: 'unknown', min: null, max: null, low: null, high: null });
      expect(quoteScoutingAssignment(baseline, id).canAssign).toBe(true);
    }
  });

  it('keeps shortlisted and queued outside-range players visible when a scout leaves', () => {
    const expanded = getScoutingDiscovery(high).networkPlayerIds.slice(20), savedId = expanded[0]!, queuedId = expanded[1]!;
    const followed = assignScouting(setShortlisted(high, savedId, true), queuedId, null);
    const released = releaseScout(followed, getClubScouts(followed)[0]!.id);
    const discovery = getScoutingDiscovery(released);
    expect(discovery.networkOutsideCount).toBe(20);
    expect(discovery.retainedOutsideCount).toBe(2);
    expect(discovery.playerIds).toEqual(expect.arrayContaining([savedId, queuedId]));
    const cleared = cancelScoutingAssignment(setShortlisted(released, savedId, false), queuedId);
    expect(getScoutingDiscovery(cleared).playerIds).not.toContain(savedId);
    expect(getScoutingDiscovery(cleared).playerIds).not.toContain(queuedId);
  });

  it('retains actual completed reviews outside a reduced range', () => {
    const target = getScoutingDiscovery(high).networkPlayerIds[20]!;
    const observed = play(assignScouting(high, target));
    expect(observed.scouting.clubs[club]!.reviews.some(review => review.playerId === target)).toBe(true);
    const released = releaseScout(observed, getClubScouts(observed)[0]!.id);
    expect(getScoutingDiscovery(released).networkPlayerIds).not.toContain(target);
    expect(getScoutingDiscovery(released).playerIds).toContain(target);
    expect(getPlayerKnowledge(released, target)).toEqual(getPlayerKnowledge(observed, target));
  });

  it('retains former squad memories after a player leaves the current squad', () => {
    const player = baseline.clubs.find(team => team.id === club)!.players[0]!;
    const moved = { ...baseline, clubs: baseline.clubs.map(team => team.id === club ? { ...team, players: team.players.filter(item => item.id !== player.id) } : team.id === 'aegean-waves' ? { ...team, players: [...team.players, player] } : team) };
    expect(getScoutingDiscovery(moved).playerIds).toContain(player.id);
    expect(getPlayerKnowledge(moved, player.id).kind).toBe('report');
  });

  it('previews only genuinely new names rather than counting followed targets twice', () => {
    const future = getScoutingDiscovery(high).networkPlayerIds[20]!;
    const followed = setShortlisted(baseline, future, true);
    expect(scoutDiscoveryGain(followed, scout('scout-19'))).toEqual({ rangeIncrease: 12, newPlayers: 11 });
    expect(getScoutingDiscovery(hireScout(followed, 'scout-19')).playerIds.length - getScoutingDiscovery(followed).playerIds.length).toBe(11);
  });
});

describe('scouting list sorting', () => {
  function row(id: string, name: string, age: number | null, bounds?: [number, number]): ScoutingSortEntry {
    const knowledge: PlayerKnowledge = { playerId: id, kind: bounds ? 'report' : 'unknown', level: bounds ? 1 : 0, attributes: null, ranges: bounds ? Object.fromEntries(SCOUTING_ATTRIBUTES.map(attribute => [attribute, { min: bounds[0], max: bounds[1] }])) as PlayerKnowledge['ranges'] : null, observedOn: null, observedClubId: null, ageDays: null, freshness: 'unknown', source: null, observations: 0 };
    return { id, name, position: 'SF', age, knowledge };
  }

  it('sorts youngest and oldest first, keeping unknown ages last and equal ages stable by name', () => {
    const rows = [row('u', 'Unknown', null), row('b', 'Bela', 21), row('a', 'Aron', 21), row('v', 'Viktor', 35)];
    expect([...rows].sort((left, right) => compareScoutingPlayers(left, right, 'age-asc')).map(row => row.id)).toEqual(['a', 'b', 'v', 'u']);
    expect([...rows].sort((left, right) => compareScoutingPlayers(left, right, 'age-desc')).map(row => row.id)).toEqual(['v', 'a', 'b', 'u']);
  });

  it('uses reported bounds for ability sorting and never promotes unknown players by their true skills', () => {
    const rows = [row('unknown', 'A hidden star', 25), row('broad', 'Broad estimate', 24, [8, 20]), row('confident', 'Reliable estimate', 28, [12, 16]), row('low', 'Low estimate', 22, [4, 8])];
    expect([...rows].sort((left, right) => compareScoutingPlayers(left, right, 'rating-desc')).map(row => row.id)).toEqual(['confident', 'broad', 'low', 'unknown']);
    expect([...rows].sort((left, right) => compareScoutingPlayers(left, right, 'rating-asc')).map(row => row.id)).toEqual(['low', 'confident', 'broad', 'unknown']);
  });

  it('supports both name directions without changing the underlying entries', () => {
    const rows = [row('b', 'Bela', 21), row('a', 'Aron', 21)];
    expect([...rows].sort((left, right) => compareScoutingPlayers(left, right, 'name-asc')).map(row => row.id)).toEqual(['a', 'b']);
    expect([...rows].sort((left, right) => compareScoutingPlayers(left, right, 'name-desc')).map(row => row.id)).toEqual(['b', 'a']);
    expect(rows.map(row => row.id)).toEqual(['b', 'a']);
  });
});

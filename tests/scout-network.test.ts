import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerKnowledge } from '../src/domain/scouting';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { worldFromPack } from '../src/world/real-world';
import { getPlayerKnowledge, getPotentialKnowledge, scoutNetworkQuality, scoutNetworkRange } from '../src/world/scouting-policy';
import { getScoutingDiscovery } from '../src/world/scouting-discovery';
import { assignScouting } from '../src/world/scouting';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { advanceMatchday } from './helpers/board-funding';
import { economyPack } from './helpers/economy-pack';

/**
 * Format 78 (owner feedback, 22 November 2026): the scouts' total quality widens the network and sharpens the
 * estimated ratings of players inside it; a scout report on a player sharpens them further.
 */
const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 8] }], null, 13);
const world = worldFromPack(pack, 'bbl');
const clubId = 'bbl-1';
let start: SeasonState;
const width = (knowledge: PlayerKnowledge) => Object.values(knowledge.ranges ?? {}).reduce((sum, range) => sum + range.max - range.min, 0);
const withoutScouts = (state: SeasonState): SeasonState => ({ ...state, scouts: { ...state.scouts, contracts: state.scouts.contracts.filter(contract => contract.clubId !== clubId) } });

beforeAll(() => { start = createSeason({ seed: 7, world, managedClubId: clubId, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS }); }, 120_000);

describe('scouting network', () => {
  it('shows an estimate for players inside the network and nothing for players outside it', () => {
    expect(start.scouting.model).toBe('scouting-2');
    const discovery = getScoutingDiscovery(start);
    const inside = discovery.networkPlayerIds[0]!;
    const outside = start.clubs.flatMap(club => club.players).find(player => player.id && !discovery.playerIds.includes(player.id))!;
    const known = getPlayerKnowledge(start, inside);
    expect(known).toMatchObject({ kind: 'report', source: 'network', level: 0, attributes: null });
    expect(getPotentialKnowledge(start, inside).kind).toBe('unknown');
    expect(getPlayerKnowledge(start, outside.id).kind).toBe('unknown');
    // Computer clubs keep their own knowledge rules.
    expect(getPlayerKnowledge(start, inside, 'bbl-2').source === 'network').toBe(false);
  });

  it('widens the network and sharpens estimates with the scouts\' total quality', () => {
    const bare = withoutScouts(start);
    expect(scoutNetworkQuality(start)).toBeGreaterThan(0);
    expect(scoutNetworkRange(bare)).toBe(5);
    expect(scoutNetworkRange(start)).toBeLessThan(5);
    expect(getScoutingDiscovery(start).networkOutsideCount).toBeGreaterThan(getScoutingDiscovery(bare).networkOutsideCount);
    const inside = getScoutingDiscovery(bare).networkPlayerIds[0]!;
    expect(width(getPlayerKnowledge(start, inside))).toBeLessThan(width(getPlayerKnowledge(bare, inside)));
  });

  it('a scout report sharpens the reading of a player', () => {
    const playing = new Set(start.fixtures.filter(fixture => fixture.round === start.round).flatMap(fixture => [fixture.homeClubId, fixture.awayClubId]));
    const target = start.clubs.filter(club => club.id !== clubId && playing.has(club.id)).map(club => club.players[0]!).find(player => getPlayerKnowledge(start, player.id).source === 'network')
      ?? start.clubs.find(club => club.id !== clubId && playing.has(club.id))!.players[0]!;
    const before = getPlayerKnowledge(start, target.id);
    const after = advanceMatchday(assignScouting(start, target.id));
    const report = getPlayerKnowledge(after, target.id);
    expect(report.source).toBe('observation');
    expect(width(report)).toBeLessThan(before.kind === 'unknown' ? Infinity : width(before));
    expect(parseSeason(serializeSeason(after))).toEqual(after);
  }, 120_000);

  it('older careers keep unknown players unknown', () => {
    const old = createSeason({ seed: 7, world, managedClubId: clubId, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, scoutNetwork: false });
    expect(old.scouting.model).toBe('scouting-1');
    expect(getPlayerKnowledge(old, getScoutingDiscovery(old).networkPlayerIds[0]!).kind).toBe('unknown');
  }, 120_000);
});

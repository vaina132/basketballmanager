import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setEmploymentDelegation } from '../src/world/employment';
import { worldFromPack } from '../src/world/real-world';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { getInboxItems } from '../src/ui/inbox-items';
import { submitInSeasonTransferOffer } from '../src/world/recruitment';
import { requiredInSeasonTransferFee } from '../src/world/recruitment-policy';
import { requiredNegotiationWage } from '../src/world/negotiations-policy';
import { advanceMatchday } from './helpers/board-funding';
import { economyPack } from './helpers/economy-pack';
import { currentSeasonFile } from './helpers/season-format';

/**
 * Calmer playing time (format 77) over a whole season with the automatic rotation and no manager conversations: a
 * handful of playing-time messages at most, and the strict save check replays quiet adjustments and calm concerns. A
 * signing on a Rotation contract who rarely makes the matchday squad accepts a smaller role quietly.
 */
const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 8] }], null, 15);
const world = worldFromPack(pack, 'bbl');
const clubId = 'bbl-1';
const PLAYING_TIME = /minutes|role|leave|playing-time/i;

const signing = 'bbl-14-p6';
let end: SeasonState;
const messages = new Set<string>();
beforeAll(() => {
  const start = createSeason({ seed: 5, world, managedClubId: clubId, injuryMode: 'standard', ...NEW_CAREER_SYSTEMS, matchFlow: false });
  const offered = submitInSeasonTransferOffer(start, signing, requiredNegotiationWage(signing, 2, undefined, start, 'rotation'), 2, requiredInSeasonTransferFee(start, signing), clubId, 'upfront', { role: 'rotation' });
  let state = setEmploymentDelegation(offered, true);
  while (state.status === 'active') {
    for (const item of getInboxItems(state)) if (item.category === 'players' && PLAYING_TIME.test(item.title)) messages.add(item.id);
    state = advanceMatchday(state);
  }
  end = state;
}, 300_000);

describe('a season of calmer playing time', () => {
  it('sends the manager at most a handful of playing-time messages', () => {
    expect(messages.size).toBeLessThanOrEqual(3);
    // Every club is judged by the same rules; quiet adjustments far outnumber complaints.
    const events = end.relationships.events;
    const adjusts = events.filter(event => event.type === 'role-adjust').length, concerns = events.filter(event => event.type === 'role-request' && event.stage === 'concern').length;
    expect(events.some(event => event.type === 'role-adjust' && event.clubId === clubId && event.playerId === signing)).toBe(true);
    expect(adjusts).toBeGreaterThan(0);
    expect(concerns).toBeLessThanOrEqual(adjusts);
  });

  it('round-trips through the strict save check, which replays every quiet adjustment', () => {
    expect(parseSeason(serializeSeason(end))).toEqual(end);
    const index = end.relationships.events.findIndex(event => event.type === 'role-adjust');
    const copy = structuredClone(end), event = copy.relationships.events[index]!;
    if (event.type === 'role-adjust') event.role = event.role === 'development' ? 'rotation' : 'development';
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/);
  });
});

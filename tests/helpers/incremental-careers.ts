import type { SeasonState } from '../../src/domain/season';
import type { CareerWorld } from '../../src/domain/world';
import { setAutoSubstitutions, simulateToEnd } from '../../src/engine/match';
import { setEmploymentDelegation } from '../../src/world/employment';
import { nationalManagedSide } from '../../src/world/national';
import { worldFromPack } from '../../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../../src/world/season';
import { economyPack } from './economy-pack';

/**
 * A real-club world for incremental checkpoint checks: Turkey's top division of `clubs` clubs with Turkish players (so
 * the national team calls them up in the FIBA windows) and a listed EuroLeague of the two strongest clubs and four
 * foreign clubs. Every system of a new career is on (formats 77-80 included: calm playing time, longer injuries,
 * transfer lists and loans, the scout network, the richer play model and national teams).
 */
export function incrementalWorld(clubs = 16): CareerWorld {
  const levels = Array.from({ length: clubs }, (_, index) => Math.max(6, 17 - Math.floor(index * 11 / clubs)));
  const pack = economyPack([{ id: 'bsl', name: 'Basketbol Super Ligi', country: 'Turkey', tier: 1, levels }], {
    members: ['bsl-1', 'bsl-2'],
    foreign: [{ id: 'srb-1', country: 'Serbia', level: 16 }, { id: 'esp-1', country: 'Spain', level: 16 }, { id: 'gre-1', country: 'Greece', level: 15 }, { id: 'isr-1', country: 'Israel', level: 14 }],
  }, 13);
  const nationality = (clubId: string) => clubId.startsWith('bsl-') ? 'Turkey' : clubId.startsWith('srb-') ? 'Serbia' : clubId.startsWith('esp-') ? 'Spain' : clubId.startsWith('gre-') ? 'Greece' : 'Israel';
  return worldFromPack({ ...pack, players: pack.players.map(player => ({ ...player, nationality: nationality(player.clubId!) })) }, 'bsl');
}

/** A delegated career at a mid-table club of the world, with standard injuries. */
export function incrementalCareer(world: CareerWorld, seed = 7): SeasonState {
  return setEmploymentDelegation(createSeason({ seed, world, managedClubId: 'bsl-5', injuryMode: 'standard', ...NEW_CAREER_SYSTEMS }), true);
}

/** One week: the manager's open games (club and national) finish automatically, then the calendar advances. */
export function playWeek(state: SeasonState): SeasonState {
  let next = state;
  const national = next.national?.activeMatch;
  if (national && national.status !== 'finished') next = { ...next, national: { ...next.national!, activeMatch: simulateToEnd(setAutoSubstitutions(national, nationalManagedSide(next), true)) } };
  if (next.activeMatch && next.activeMatch.status !== 'finished') next = { ...next, activeMatch: simulateToEnd(setAutoSubstitutions(next.activeMatch, managedSide(next), true)) };
  return advanceSeason(next);
}

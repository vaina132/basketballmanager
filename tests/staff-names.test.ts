import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY, staffNationality } from '../src/data/staff-directory';
import { PRESIDENT_RANGE, countryName, nameCapacity } from '../src/data/people-names';
import { REAL_CLUB_PEOPLE, realClubPerson } from '../src/data/real-club-people';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { roleStaff, STAFF_ROLES } from '../src/world/staff-roster';
import { economyPack } from './helpers/economy-pack';

// Owner play-test feedback (18 November 2026): one person per job, names mostly from the club's country, real people where Wikipedia lists them.
const efesAssistant = REAL_CLUB_PEOPLE.find(person => person.club === 'Anadolu Efes' && person.role === 'assistant-coach')!;
const efes = efesAssistant.clubId;
const pack = economyPack([
  { id: 'bsl', name: 'Basketbol Süper Ligi', country: 'Turkey', tier: 1, levels: [16, 15, 14, 13, 12, 11, 10, 9, 8, 7] },
  { id: 'acb', name: 'Liga ACB', country: 'Spain', tier: 1, levels: [16, 15, 14, 13, 12, 11, 10, 9, 8, 7] },
]);
// Give one Turkish club the real Anadolu Efes identity, so the real-people list applies to it.
const swap = (id: string) => id === 'bsl-1' ? efes : id;
pack.clubs = pack.clubs.map(club => ({ ...club, id: swap(club.id), playerIds: club.playerIds }));
pack.players = pack.players.map(player => ({ ...player, clubId: swap(player.clubId) }));
pack.competitions = pack.competitions.map(item => ({ ...item, clubIds: item.clubIds.map(swap) }));
const world = worldFromPack(pack, ['bsl', 'acb']);

let start: SeasonState;
beforeAll(() => { start = createSeason({ seed: 9, world, managedClubId: 'acb-2', injuryMode: 'off', ...NEW_CAREER_SYSTEMS }); });

describe('real-looking club people', () => {
  it('gives every name in the six staff directories to one person only', () => {
    const people = [COACH_DIRECTORY, SCOUT_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, ASSISTANT_DIRECTORY, YOUTH_COACH_DIRECTORY].flat(), names = people.map(person => person.name);
    expect(new Set(people.map(person => person.id)).size).toBe(people.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('staffs every club with different people in every role, mostly from the club\'s country', () => {
    const seen = new Map<string, string>();
    let local = 0, total = 0;
    for (const club of start.clubs) {
      const country = club.id.startsWith('acb') ? 'Spain' : 'Turkey';
      for (const role of STAFF_ROLES) for (const member of roleStaff(start, role, club.id)) {
        expect(seen.get(member.name), `${member.name} at ${club.id} as ${role}`).toBeUndefined();
        seen.set(member.name, `${club.id}/${role}`);
        total += 1;
        if (staffNationality(member.personId) === country) local += 1;
      }
    }
    expect(total).toBeGreaterThanOrEqual(start.clubs.length * STAFF_ROLES.length);
    expect(local / total).toBeGreaterThan(0.6);
    expect(local / total).toBeLessThan(0.95);
    // Presidents never share a name with staff or with each other.
    const presidents = world.presidents.filter(president => start.clubs.some(club => club.id === president.clubId)).map(president => president.name);
    expect(new Set(presidents).size).toBe(presidents.length);
    for (const name of presidents) expect(seen.has(name)).toBe(false);
  });

  it('uses the real president and assistant coach where Wikipedia lists them', () => {
    expect(world.presidents.find(president => president.clubId === efes)!.name).toBe(realClubPerson(efes, 'president')!.name);
    expect(roleStaff(start, 'assistant', efes).map(member => member.name)).toEqual([realClubPerson(efes, 'assistant-coach')!.name]);
    // Other clubs' presidents are generated, mostly with names of their own country.
    const generated = world.presidents.filter(president => president.clubId !== efes);
    const spanish = generated.filter(president => president.clubId.startsWith('acb'));
    expect(spanish.filter(president => Array.from({ length: PRESIDENT_RANGE }, (_, k) => countryName('Spain', nameCapacity('Spain') - 1 - k)).includes(president.name)).length).toBeGreaterThanOrEqual(7);
  });

  it('keeps the people through a strict save round trip', () => {
    const loaded = parseSeason(serializeSeason(start));
    for (const role of STAFF_ROLES) expect(roleStaff(loaded, role, efes)).toEqual(roleStaff(start, role, efes));
    expect(loaded.world!.presidents).toEqual(start.world!.presidents);
  });
});

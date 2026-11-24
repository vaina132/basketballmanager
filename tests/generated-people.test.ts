import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { countryFlagCode } from '../src/data/country-flags';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY } from '../src/data/staff-directory';
import { FAMOUS_NAMES, GENERATED_NATIONALITIES, generatedNationality, generatedPersonName, kindCapacity, kindName, nameKey, NATIONALITY_ORIGINS, originOf, type NameKind, type NameOrigin } from '../src/data/generated-names';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { coachWorld } from '../src/world/head-coaches';
import { careerPlayerNationality, peopleCountry, reservedNames, usesGeneratedPeople } from '../src/world/generated-people';
import { draftClassProspects } from '../src/world/nba-draft';
import { generateAcademyProspects } from '../src/world/academy-generation';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { withLowerDivisions } from '../src/world/lower-division';
import { testWorld } from './world-fixtures';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { economyPack } from './helpers/economy-pack';

/**
 * Format 106 (owner data check, 24 November 2026, `world.generatedPeople`): generated people have a nationality, mostly
 * the club's country, and names from much larger lists; no full name is used twice in a world. Older careers keep their
 * names exactly.
 */
const levels = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5];
// Four playable countries with their real next divisions (Turkey and Spain third tiers, Germany ProA, Greece Elite League).
const WORLD = worldFromPack(economyPack([
  { id: 'bsl', name: 'Basketbol Süper Ligi', country: 'Turkey', tier: 1, levels },
  { id: 'tbl', name: 'Türkiye Basketbol Ligi', country: 'Turkey', tier: 2, levels },
  { id: 'acb', name: 'Liga ACB', country: 'Spain', tier: 1, levels },
  { id: 'feb', name: 'Primera FEB', country: 'Spain', tier: 2, levels },
  { id: 'bbl', name: 'Basketball Bundesliga', country: 'Germany', tier: 1, levels },
  { id: 'gbl', name: 'Greek Basket League', country: 'Greece', tier: 1, levels },
]), ['bsl', 'tbl', 'acb', 'feb', 'bbl', 'gbl']);
const create = (generatedPeople: boolean) => createSeason({ seed: 9, world: WORLD, managedClubId: 'acb-3', injuryMode: 'off', ...NEW_CAREER_SYSTEMS, generatedPeople });

const generatedPlayers = (world: CareerWorld) => world.clubs.flatMap(club => club.players.filter(player => world.playerProfiles[player.id]?.source === 'generated').map(player => ({ player, clubId: club.id })));
/** Names used by more than one person, per 1,000 people. */
const collisionsPer1000 = (names: readonly string[]) => {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(nameKey(name), (counts.get(nameKey(name)) ?? 0) + 1);
  const repeated = [...counts.values()].filter(count => count > 1).reduce((sum, count) => sum + count, 0);
  return repeated / names.length * 1000;
};

const repeated = (names: readonly string[]) => { const seen = new Set<string>(); return names.filter(name => seen.has(nameKey(name)) || !seen.add(nameKey(name))); };

let start: SeasonState, older: SeasonState;
beforeAll(() => { start = create(true); older = create(false); });

describe('name lists (format 106)', () => {
  it('gives every nationality a flag and the playable countries large lists', () => {
    for (const nationality of GENERATED_NATIONALITIES) expect(countryFlagCode(nationality), nationality).not.toBeNull();
    for (const origin of ['spain', 'turkey', 'italy', 'france', 'greece', 'germany', 'usa'] as NameOrigin[]) {
      // Every kind has at least about a thousand names in a playable country's lists (academies three times as many).
      for (const kind of ['lower', 'draft', 'coach', 'coach-hire', 'president'] as NameKind[]) expect(kindCapacity(origin, kind), `${origin}/${kind}`).toBeGreaterThan(1500);
      expect(kindCapacity(origin, 'academy')).toBeGreaterThan(4500);
    }
  });

  it('never gives two kinds, two origins or two positions the same name', () => {
    const seen = new Map<string, string>();
    for (const origin of new Set(Object.values(NATIONALITY_ORIGINS))) for (const kind of ['lower', 'academy', 'draft', 'coach', 'coach-hire', 'president'] as NameKind[]) {
      const capacity = kindCapacity(origin, kind);
      for (let j = 0; j < capacity; j += 1) {
        const name = kindName(origin, kind, j);
        if (!name) continue;
        const key = nameKey(name);
        expect(seen.get(key), `${name} (${origin}/${kind}/${j})`).toBeUndefined();
        seen.set(key, `${origin}/${kind}/${j}`);
      }
    }
    for (const famous of FAMOUS_NAMES) expect(seen.has(nameKey(famous))).toBe(false);
    expect(seen.size).toBeGreaterThan(120_000);
  });

  it('picks nationalities by the rules: mostly local, foreigners from the weighted list, draft mostly American', () => {
    const share = (kind: 'lower' | 'academy' | 'coach' | 'president' | 'draft', country: string | null) => {
      let local = 0;
      for (let k = 0; k < 4000; k += 1) if (generatedNationality(kind, country, (k * 2654435761) >>> 0) === (kind === 'draft' ? 'USA' : country)) local += 1;
      return 1 - local / 4000;
    };
    expect(share('lower', 'Spain')).toBeGreaterThan(0.2);
    expect(share('lower', 'Spain')).toBeLessThan(0.3);
    expect(share('academy', 'Turkey')).toBeLessThan(0.16);
    expect(share('coach', 'Greece')).toBeGreaterThan(0.15);
    expect(share('president', 'Italy')).toBeLessThan(0.08);
    expect(share('draft', null)).toBeGreaterThan(0.2);
    expect(share('draft', null)).toBeLessThan(0.3);
    // A country without a list: everyone foreign.
    expect(share('lower', 'United Arab Emirates')).toBe(1);
    expect(originOf('Montenegro')).toBe('serbia');
  });

  it('is deterministic and keeps names unique against the names in use', () => {
    const taken = new Set<string>();
    const a = Array.from({ length: 2000 }, (_, k) => generatedPersonName('Spain', 'academy', k % 7, taken));
    expect(new Set(a.map(nameKey)).size).toBe(2000);
    const again = new Set<string>();
    expect(Array.from({ length: 2000 }, (_, k) => generatedPersonName('Spain', 'academy', k % 7, again))).toEqual(a);
  });
});

describe('new careers (format 106)', () => {
  it('marks the world and gives next-division players a nationality, about a quarter foreign', () => {
    expect(start.world!.generatedPeople).toBe(true);
    expect(older.world!.generatedPeople).toBeUndefined();
    const players = generatedPlayers(start.world!);
    expect(players.length).toBeGreaterThan(900);
    let foreign = 0;
    const byCountry = new Map<string, { local: number; total: number }>();
    for (const { player, clubId } of players) {
      const nationality = start.world!.playerProfiles[player.id]!.nationality!;
      expect(countryFlagCode(nationality), nationality).not.toBeNull();
      const country = peopleCountry(start.world!, clubId)!, entry = byCountry.get(country) ?? { local: 0, total: 0 };
      entry.total += 1;
      if (nationality === country) entry.local += 1; else foreign += 1;
      byCountry.set(country, entry);
    }
    expect(foreign / players.length).toBeGreaterThan(0.18);
    expect(foreign / players.length).toBeLessThan(0.32);
    for (const [country, { local, total }] of byCountry) expect(1 - local / total, country).toBeLessThan(0.38);
    expect([...byCountry.keys()].sort()).toEqual(['Germany', 'Greece', 'Spain', 'Turkey']);
  });

  it('uses no full name twice across players, prospects, coaches, staff and presidents', () => {
    const world = start.world!, coaches = coachWorld(world);
    for (let season = 1; season <= 6; season += 1) coaches.marketIds(season);
    const generated = [
      ...generatedPlayers(world).map(item => item.player.name),
      ...world.presidents.map(president => president.name),
      ...[...coaches.coaches.values()].filter(coach => /^coach-(gen|market|hire)-/u.test(coach.id)).map(coach => coach.name),
      ...start.academy.prospects.map(prospect => prospect.player.name),
    ];
    const staff = [COACH_DIRECTORY, SCOUT_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, ASSISTANT_DIRECTORY, YOUTH_COACH_DIRECTORY].flat().map(person => person.name);
    const real = world.clubs.flatMap(club => club.players.filter(player => world.playerProfiles[player.id]?.source !== 'generated').map(player => player.name));
    const realCoaches = [...coaches.coaches.values()].filter(coach => !/^coach-(gen|market|hire)-/u.test(coach.id)).map(coach => coach.name);
    // Generated people never repeat a name, nor take a real person's or a staff member's (accents and case aside).
    expect(repeated([...generated, ...real, ...realCoaches])).toEqual([]);
    const others = new Set([...staff, ...real, ...realCoaches].map(nameKey));
    expect(generated.filter(name => others.has(nameKey(name)))).toEqual([]);
    expect(collisionsPer1000([...generated, ...real, ...realCoaches])).toBe(0);
    // Staff keep their fixed directory names (unique as written; shared by every career): a handful differ only by an
    // accent ("Daniel Martin" and "Daniel Martín") and one repeats a real coach. Recorded, not changed.
    expect(repeated([...staff, ...realCoaches]).length).toBeLessThanOrEqual(6);
    expect(generated.length).toBeGreaterThan(1300);
    // The older lists: next-division names alone repeat often (the owner's data check: 928 of 1,008 shared 283 names).
    expect(collisionsPer1000(generatedPlayers(older.world!).map(item => item.player.name))).toBeGreaterThan(300);
  });

  it('gives academy prospects a nationality, mostly the club country, and shows it', () => {
    const prospects = start.academy.prospects;
    expect(prospects.length).toBeGreaterThan(100);
    let local = 0;
    for (const prospect of prospects) {
      expect(countryFlagCode(prospect.nationality)).not.toBeNull();
      if (prospect.nationality === peopleCountry(start.world!, prospect.clubId)) local += 1;
      expect(careerPlayerNationality(start, prospect.player.id)).toBe(prospect.nationality);
    }
    expect(local / prospects.length).toBeGreaterThan(0.8);
    expect(older.academy.prospects.every(prospect => !Object.hasOwn(prospect, 'nationality'))).toBe(true);
  });

  it('gives generated coaches the larger lists and a pack nationality', () => {
    const coaches = [...coachWorld(start.world!).coaches.values()].filter(coach => coach.id.startsWith('coach-gen-') || coach.id.startsWith('coach-market-'));
    expect(coaches.length).toBeGreaterThan(20);
    for (const coach of coaches) expect(countryFlagCode(coach.nationality), coach.name).not.toBeNull();
  });

  it('keeps every name through a strict save round trip', () => {
    const loaded = parseSeason(serializeSeason(start));
    expect(loaded.world).toEqual(start.world);
    expect(loaded.academy.prospects).toEqual(start.academy.prospects);
    // Coaches are derived from the world: the loaded world names the same coaches, whichever market is asked for first.
    const names = (world: CareerWorld, seasons: number[]) => { const pool = coachWorld(world); return seasons.flatMap(season => pool.marketIds(season)).map(id => pool.coaches.get(id)!.name); };
    expect(names(loaded.world!, [4, 1, 2, 3])).toEqual(names(start.world!, [4, 1, 2, 3]));
    expect([...coachWorld(loaded.world!).opening.values()].map(id => coachWorld(loaded.world!).coaches.get(id)!.name)).toEqual([...coachWorld(start.world!).opening.values()].map(id => coachWorld(start.world!).coaches.get(id)!.name));
  });

  it('refuses the marker in an older format and a prospect nationality without it', () => {
    const file = JSON.parse(serializeSeason(start));
    expect(() => parseSeason(JSON.stringify({ ...file, formatVersion: 102, state: { ...file.state, schemaVersion: 102 } }))).toThrow(/generatedPeople/);
    const plain = JSON.parse(serializeSeason(older));
    plain.state.academy.prospects[0].nationality = 'Spain';
    expect(() => parseSeason(JSON.stringify(plain))).toThrow(/academy\.prospects/);
  });
});

describe('older careers', () => {
  it('keep next-division names, presidents and academy names exactly', () => {
    const input = generatedPlayers(WORLD).map(item => item.player.name);
    expect(generatedPlayers(older.world!).map(item => item.player.name)).toEqual(input);
    expect(older.world!.presidents).toEqual(WORLD.presidents);
    expect(generatedPlayers(older.world!).every(item => older.world!.playerProfiles[item.player.id]!.nationality === undefined)).toBe(true);
    const first = older.academy.prospects[0]!;
    const intake = older.academy.intakes.find(item => item.prospectIds.includes(first.player.id))!;
    expect(generateAcademyProspects(older.seed, first.clubId, intake.seasonNumber, intake.round, intake.initial, intake.prospectIds.length)[0]!.player.name).toBe(first.player.name);
  });
});

describe('NBA draft classes (format 106)', () => {
  const marked = { ...WORLD, generatedPeople: true as const };
  it('names ten classes without a repeat, about three quarters American, with flags', () => {
    const names: string[] = [];
    let american = 0;
    for (let season = 1; season <= 10; season += 1) for (const prospect of draftClassProspects(7, season, `${2026 + season}-06-25`, true, marked)) {
      names.push(prospect.player.name);
      if (prospect.nationality === 'USA') american += 1;
      expect(countryFlagCode(prospect.nationality)).not.toBeNull();
      expect(reservedNames(marked).has(nameKey(prospect.player.name))).toBe(false);
    }
    expect(names).toHaveLength(900);
    expect(collisionsPer1000(names)).toBe(0);
    expect(american / 900).toBeGreaterThan(0.68);
    expect(american / 900).toBeLessThan(0.82);
  });

  it('derives the same class again from an equal world and keeps older classes as they were', () => {
    const again = draftClassProspects(7, 4, '2030-06-25', true, structuredClone(marked));
    expect(again).toEqual(draftClassProspects(7, 4, '2030-06-25', true, marked));
    const legacy = draftClassProspects(7, 4, '2030-06-25', true, WORLD);
    expect(legacy).toBe(draftClassProspects(7, 4, '2030-06-25', true));
    // Ratings, positions and ages are those of the older class; only names and nationalities are new.
    expect(again.map(prospect => [prospect.player.position, prospect.player.attributes, prospect.dateOfBirth])).toEqual(legacy.map(prospect => [prospect.player.position, prospect.player.attributes, prospect.dateOfBirth]));
  });
});

describe('a format-106 career into its second season', () => {
  // Testland: two divisions of six and a next division of four; play season one and roll over (academy intake replayed by the save check).
  function smallWorld(): CareerWorld {
    const base = testWorld(12);
    return withLowerDivisions({ ...base, id: 'generated-people-test', rosterModel: 'club-roster-1', domesticLeagues: [
      { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
      { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-2', standingsRule: 'fiba-2026-d' },
    ] } as CareerWorld, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: 4 }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]);
  }
  const play = (state: SeasonState) => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

  it('names the new intake clear of every name and passes the strict check after the rollover', () => {
    const world = smallWorld();
    let state = setEmploymentDelegation(createSeason({ seed: 21, world, managedClubId: world.clubs[0]!.id, injuryMode: 'off', ...NEW_CAREER_SYSTEMS }), true);
    expect(usesGeneratedPeople(state.world)).toBe(true);
    for (let step = 0; step < 400 && state.status !== 'complete'; step += 1) state = play(state);
    expect(state.status).toBe('complete');
    for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    state = rolloverSeason(state);
    expect(state.seasonNumber).toBe(2);
    const loaded = parseSeason(serializeSeasonCompact(state));
    expect(loaded.academy.prospects).toEqual(state.academy.prospects);
    const names = state.academy.prospects.map(prospect => prospect.player.name);
    expect(state.academy.prospects.some(prospect => prospect.intakeSeason === 2)).toBe(true);
    expect(collisionsPer1000([...names, ...state.world!.clubs.flatMap(club => club.players.map(player => player.name)), ...state.world!.presidents.map(president => president.name)])).toBe(0);
    expect(state.academy.prospects.every(prospect => countryFlagCode(prospect.nationality))).toBe(true);
  }, 600_000);
});

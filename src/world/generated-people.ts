import type { CareerWorld } from '../domain/world';
import { gamePersonName } from './game-names';
import type { SeasonAcademy } from '../domain/academy';
import type { SeasonState } from '../domain/season';
import { ASSISTANT_DIRECTORY, COACH_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, SCOUT_DIRECTORY, YOUTH_COACH_DIRECTORY } from '../data/staff-directory';
import { REAL_COACHES, REAL_NBA_COACHES } from '../data/real-coaches';
import { REAL_CLUB_PEOPLE, realClubPerson } from '../data/real-club-people';
import { NATIONAL_TEAMS, nationalPersonName } from '../data/national-teams';
import { generatedNationality, generatedPersonName, nameKey, peopleHash } from '../data/generated-names';

/**
 * Format 105 (owner data check, 24 November 2026; new real-club careers, option `generatedPeople`, stored as
 * `world.generatedPeople`): every generated person has a nationality, mostly the club's country, and a name from the
 * much larger lists of `src/data/generated-names.ts`, and no full name is used twice in a world across players, coaches,
 * staff and presidents.
 *
 * - The opening world: next-division squads and generated club presidents are named again when the career is created
 *   (`withGeneratedPeople`), in club order, clear of every real person of the world.
 * - Head coaches (`head-coaches.ts`), academy and youth prospects (`academy.ts`, `youth-competition.ts`) and NBA draft
 *   prospects (`nba-draft.ts`) are named as they are generated, from the career seed and the names already in use, so
 *   the strict save check derives the same names again.
 * - Each kind of person reads its own share of every name list, so kinds generated at different moments never meet;
 *   within a kind, the names already in use are those of the same kind generated earlier.
 * - Staff keep their directory names (already unique and with a nationality); generated people stay clear of them.
 *
 * Older careers keep their names exactly.
 */
export const usesGeneratedPeople = (world: CareerWorld | null | undefined): boolean => world?.generatedPeople === true;

/** Names generated national-team coaches and players can take (the national counters' generous range). */
const NATIONAL_COACH_NAMES = 200, NATIONAL_PLAYER_NAMES = 60;
let staticNames: ReadonlySet<string> | null = null;
/** Every name outside the world a generated person must not take: staff, real coaches and club people, national-team people. */
function outsideNames(): ReadonlySet<string> {
  if (staticNames) return staticNames;
  const names = new Set<string>();
  for (const person of [COACH_DIRECTORY, SCOUT_DIRECTORY, FITNESS_DIRECTORY, PHYSIO_DIRECTORY, ASSISTANT_DIRECTORY, YOUTH_COACH_DIRECTORY].flat()) names.add(nameKey(person.name));
  for (const coach of [...REAL_COACHES, ...REAL_NBA_COACHES]) names.add(nameKey(coach.name));
  for (const person of REAL_CLUB_PEOPLE) names.add(nameKey(person.name));
  for (const team of NATIONAL_TEAMS) {
    for (let k = 0; k < NATIONAL_COACH_NAMES; k += 1) names.add(nameKey(nationalPersonName(team.country, k)));
    for (let k = 1; k <= NATIONAL_PLAYER_NAMES; k += 1) names.add(nameKey(nationalPersonName(team.country, 500 + k)));
  }
  return staticNames = names;
}

const reserved = new WeakMap<CareerWorld, ReadonlySet<string>>();
/** The names of a world no generated person can take: its players and presidents and every name outside the world. */
export function reservedNames(world: CareerWorld): ReadonlySet<string> {
  let names = reserved.get(world);
  if (!names) {
    const all = new Set(outsideNames());
    for (const club of world.clubs) for (const player of club.players) all.add(nameKey(player.name));
    for (const president of world.presidents) all.add(nameKey(president.name));
    names = all;
    reserved.set(world, names);
  }
  return names;
}

/** A club's country for its generated people: its league's, its next division's or as a European competition lists it. */
export function peopleCountry(world: CareerWorld, clubId: string): string | null {
  const league = world.domesticLeagues?.find(item => item.clubIds.includes(clubId)) ?? world.backgroundLeagues?.find(item => item.clubIds.includes(clubId));
  if (league) return league.country;
  const division = world.lowerDivisions?.find(item => 'clubIds' in item ? item.clubIds.includes(clubId) : item.clubs.some(club => club.id === clubId));
  if (division) return division.country;
  for (const competition of world.europeanCompetitions ?? []) if (competition.countries && Object.hasOwn(competition.countries, clubId)) return competition.countries[clubId]!;
  return null;
}

/** The names already in use for generated academy and youth prospects: the world's reserved names and every prospect so far. */
export function academyTakenNames(world: CareerWorld, academy: SeasonAcademy): Set<string> {
  const taken = new Set(reservedNames(world));
  for (const prospect of academy.prospects) taken.add(nameKey(prospect.player.name));
  return taken;
}

/** Whether a president is generated (the real-people list names nobody else for the club). */
// A real president keeps the real name in careers from before 27 November 2026 and the game name since.
const generatedPresident = (clubId: string, name: string) => { const real = realClubPerson(clubId, 'president')?.name; return real !== name && (real === undefined || gamePersonName(real) !== name); };

/**
 * The opening world of a format-105 career: next-division squads and generated presidents named again with a
 * nationality, clear of the world's real people; marked `generatedPeople`. Real players and presidents keep theirs.
 */
export function withGeneratedPeople(world: CareerWorld): CareerWorld {
  if (world.generatedPeople) return world;
  const seed = peopleHash(0, `generated-people:${world.id}`);
  const generatedIds = new Set(Object.entries(world.playerProfiles).filter(([, profile]) => profile.source === 'generated').map(([id]) => id));
  const taken = new Set(outsideNames());
  for (const club of world.clubs) for (const player of club.players) if (!generatedIds.has(player.id)) taken.add(nameKey(player.name));
  for (const president of world.presidents) if (!generatedPresident(president.clubId, president.name)) taken.add(nameKey(president.name));
  const profiles = { ...world.playerProfiles };
  const clubs = world.clubs.map(club => {
    if (!club.players.some(player => generatedIds.has(player.id))) return club;
    const country = peopleCountry(world, club.id);
    return { ...club, players: club.players.map(player => {
      if (!generatedIds.has(player.id)) return player;
      const nationality = generatedNationality('lower', country, peopleHash(seed, `${player.id}:nationality`));
      profiles[player.id] = { ...profiles[player.id]!, nationality };
      return { ...player, name: generatedPersonName(nationality, 'lower', peopleHash(seed, `${player.id}:name`), taken) };
    }) };
  });
  const presidents = world.presidents.map(president => {
    if (!generatedPresident(president.clubId, president.name)) return president;
    const nationality = generatedNationality('president', peopleCountry(world, president.clubId), peopleHash(seed, `president:${president.clubId}:nationality`));
    return { ...president, name: generatedPersonName(nationality, 'president', peopleHash(seed, `president:${president.clubId}:name`), taken) };
  });
  return { ...world, clubs, playerProfiles: profiles, presidents, generatedPeople: true as const };
}

/**
 * A player's nationality wherever the career keeps it: the world's profiles (the data pack's and next-division
 * players'), then format-105 academy prospects and NBA draft prospects. Null when unknown.
 */
export function careerPlayerNationality(state: Pick<SeasonState, 'academy'> & Partial<Pick<SeasonState, 'draft'>> & { world?: CareerWorld }, playerId: string): string | null {
  const profiles = state.world?.playerProfiles;
  if (profiles && Object.hasOwn(profiles, playerId) && profiles[playerId]!.nationality) return profiles[playerId]!.nationality!;
  const prospect = state.academy.prospects.find(item => item.player.id === playerId);
  if (prospect) return prospect.nationality ?? null;
  for (const entry of state.draft?.classes ?? []) {
    const drafted = entry.prospects.find(item => item.player.id === playerId);
    if (drafted) return drafted.nationality;
  }
  return null;
}

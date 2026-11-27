import type { AssistantCoach } from '../domain/assistant';
import { gamePersonName } from '../world/game-names';
import type { Coach } from '../domain/coaching';
import type { FitnessCoach } from '../domain/fitness';
import type { Physio } from '../domain/physio';
import type { Scout } from '../domain/scouts';
import type { YouthCoach } from '../domain/youth';
import { DEVELOPMENT_ASSISTANTS } from './development-assistants';
import { DEVELOPMENT_COACHES, ELITE_COACH_TERMS } from './development-coaches';
import { DEVELOPMENT_FITNESS_COACHES } from './development-fitness';
import { DEVELOPMENT_PHYSIOS } from './development-physios';
import { DEVELOPMENT_SCOUTS } from './development-scouts';
import { DEVELOPMENT_YOUTH_COACHES } from './development-youth';
import { countryName, NAME_COUNTRIES, nameCapacity, nameHash, PRESIDENT_RANGE } from './people-names';
import { REAL_CLUB_PEOPLE } from './real-club-people';

/**
 * Every staff member a career can meet. The built-in league's authored candidates come first; larger leagues add
 * generated candidates that repeat the authored skills and fees in order, so each club meets the same mix of quality
 * and price. A league's market is the first part of a directory (`staffMarket`).
 *
 * Names (owner play-test feedback, 18 November 2026): every generated person has a nationality and a common name of
 * that country (`src/data/people-names.ts`), and no name repeats anywhere in the six directories, so one person
 * holds one job. Real-club worlds with club-level staff (format 74 and later) also meet a pool of local candidates
 * for each of their countries and the clubs' real assistant coaches (`src/data/real-club-people.ts`).
 */
const BUILT_IN_CLUBS = 6;
/**
 * The largest full world the directory serves. Format 74: every club starts with one person in each staff role, so a
 * market needs candidates for every club of the largest world (the world validator allows 400 clubs).
 */
const DIRECTORY_CLUBS = 400;
/** Clubs of one country a local pool serves (the largest country's two divisions have about 36). */
const COUNTRY_POOL_CLUBS = 40;
/** Countries with a local pool: the playable countries, spelled as their leagues spell them. */
export const STAFF_POOL_COUNTRIES: readonly string[] = Object.freeze(['Spain', 'Germany', 'Turkey', 'Greece', 'Italy', 'France']);
const POOL_CODES: Readonly<Record<string, string>> = { Spain: 'es', Germany: 'de', Turkey: 'tr', Greece: 'gr', Italy: 'it', France: 'fr' };
const NATIONALITY_CODES: Readonly<Record<string, string>> = { ESP: 'Spain', GER: 'Germany', DEU: 'Germany', TUR: 'Turkey', GRE: 'Greece', GRC: 'Greece', ITA: 'Italy', FRA: 'France', SRB: 'Serbia', LTU: 'Lithuania', CRO: 'Croatia', HRV: 'Croatia', ISR: 'Israel', SLO: 'Slovenia', SVN: 'Slovenia', POL: 'Poland', BEL: 'Belgium', USA: 'United States' };

/** Every name in use, so no person appears twice (authored and real names first). */
const usedNames = new Set<string>([DEVELOPMENT_COACHES, DEVELOPMENT_SCOUTS, DEVELOPMENT_FITNESS_COACHES, DEVELOPMENT_PHYSIOS, DEVELOPMENT_ASSISTANTS, DEVELOPMENT_YOUTH_COACHES].flatMap(list => list.map(item => item.name)));
for (const person of REAL_CLUB_PEOPLE) usedNames.add(person.name);
const nextIndex = new Map<string, number>();
/** The next unused name of a country (each country's shuffle is read from its start; presidents read from its end). */
function nextName(country: string): string {
  const limit = nameCapacity(country) - PRESIDENT_RANGE;
  for (let k = nextIndex.get(country) ?? 0; k < limit; k += 1) {
    const name = countryName(country, k);
    if (name && !usedNames.has(name)) { usedNames.add(name); nextIndex.set(country, k + 1); return name; }
  }
  throw new Error(`The staff directory has run out of ${country} names.`);
}
const nationalities = new Map<string, string>();

function extend<T extends { id: string; name: string }>(authored: readonly T[]): readonly T[] {
  const total = Math.ceil(authored.length * DIRECTORY_CLUBS / BUILT_IN_CLUBS);
  const prefix = authored[0]!.id.replace(/-\d+$/, '');
  const generated: T[] = [];
  for (let index = authored.length; index < total; index += 1) {
    const id = `${prefix}-${String(index + 1).padStart(2, '0')}`, country = NAME_COUNTRIES[nameHash(id) % NAME_COUNTRIES.length]!;
    nationalities.set(id, country);
    generated.push(Object.freeze({ ...authored[index % authored.length]!, id, name: nextName(country) }));
  }
  return Object.freeze([...authored, ...generated]);
}
/** Each pool country's local candidates, repeating the authored skills in order. */
function countryPools<T extends { id: string; name: string }>(authored: readonly T[]): ReadonlyMap<string, readonly T[]> {
  const size = Math.ceil(authored.length * COUNTRY_POOL_CLUBS / BUILT_IN_CLUBS), prefix = authored[0]!.id.replace(/-\d+$/, '');
  return new Map(STAFF_POOL_COUNTRIES.map(country => [country, Object.freeze(Array.from({ length: size }, (_, index) => {
    const id = `${prefix}-${POOL_CODES[country]}-${String(index + 1).padStart(2, '0')}`;
    nationalities.set(id, country);
    return Object.freeze({ ...authored[index % authored.length]!, id, name: nextName(country) });
  }))]));
}
/** The clubs' real assistant coaches, on an authored assistant's terms (the stronger one for a top division). */
function realAssistants(): readonly (AssistantCoach & { clubId: string })[] {
  return Object.freeze(REAL_CLUB_PEOPLE.filter(person => person.role === 'assistant-coach').map(person => {
    // Keyed by club, so later edits to the list never move a saved appointment to another person.
    const id = `assistant-real-${person.clubId.replace(/^club-/, '').slice(0, 8)}`;
    nationalities.set(id, (person.nationality && NATIONALITY_CODES[person.nationality]) ?? person.country);
    const terms = DEVELOPMENT_ASSISTANTS[Math.min(DEVELOPMENT_ASSISTANTS.length - 1, person.tier === 1 ? 8 : 6)]!;
    // Game name (owner decision, 27 November 2026).
    return Object.freeze({ ...terms, id, name: gamePersonName(person.name), clubId: person.clubId });
  }));
}

const BASES = new Map<readonly unknown[], readonly unknown[]>();
const POOLS = new Map<readonly unknown[], ReadonlyMap<string, readonly unknown[]>>();
const REAL_ASSISTANTS = realAssistants();
function directory<T extends { id: string; name: string }>(authored: readonly T[], extra: readonly T[] = []): readonly T[] {
  const base = extend(authored), pools = countryPools(authored);
  const all = Object.freeze([...base, ...[...pools.values()].flat(), ...extra]);
  POOLS.set(all, pools);
  BASES.set(all, base);
  return all;
}

const COACH_STAFF: readonly Coach[] = directory(DEVELOPMENT_COACHES);
export const SCOUT_DIRECTORY: readonly Scout[] = directory(DEVELOPMENT_SCOUTS);
export const FITNESS_DIRECTORY: readonly FitnessCoach[] = directory(DEVELOPMENT_FITNESS_COACHES);
export const PHYSIO_DIRECTORY: readonly Physio[] = directory(DEVELOPMENT_PHYSIOS);
export const ASSISTANT_DIRECTORY: readonly AssistantCoach[] = directory(DEVELOPMENT_ASSISTANTS, REAL_ASSISTANTS);
export const YOUTH_COACH_DIRECTORY: readonly YouthCoach[] = directory(DEVELOPMENT_YOUTH_COACHES);

/**
 * Top candidates a club-level market adds (owner play-test feedback, 18 November 2026): one set of the elite terms for
 * every `ELITE_CLUBS` clubs, plus one. Their names are drawn after every other directory, so no earlier name moves.
 */
const ELITE_CLUBS = 24;
const ELITES = new Map<readonly unknown[], readonly unknown[]>();
function eliteCoaches(): readonly Coach[] {
  const total = ELITE_COACH_TERMS.length * (1 + Math.floor(DIRECTORY_CLUBS / ELITE_CLUBS));
  return Object.freeze(Array.from({ length: total }, (_, index) => {
    const id = `coach-elite-${String(index + 1).padStart(2, '0')}`, country = NAME_COUNTRIES[nameHash(id) % NAME_COUNTRIES.length]!;
    nationalities.set(id, country);
    return Object.freeze({ ...ELITE_COACH_TERMS[index % ELITE_COACH_TERMS.length]!, id, name: nextName(country) });
  }));
}
function withElite<T>(staff: readonly T[], elite: readonly T[]): readonly T[] {
  const all = Object.freeze([...staff, ...elite]);
  POOLS.set(all, POOLS.get(staff)!);
  BASES.set(all, BASES.get(staff)!);
  ELITES.set(all, elite);
  return all;
}
export const COACH_DIRECTORY: readonly Coach[] = withElite(COACH_STAFF, eliteCoaches());

const AUTHORED = new Map<readonly unknown[], number>([
  [COACH_DIRECTORY, DEVELOPMENT_COACHES.length], [SCOUT_DIRECTORY, DEVELOPMENT_SCOUTS.length], [FITNESS_DIRECTORY, DEVELOPMENT_FITNESS_COACHES.length],
  [PHYSIO_DIRECTORY, DEVELOPMENT_PHYSIOS.length], [ASSISTANT_DIRECTORY, DEVELOPMENT_ASSISTANTS.length], [YOUTH_COACH_DIRECTORY, DEVELOPMENT_YOUTH_COACHES.length],
]);

/** A person's nationality (a country of `src/data/people-names.ts`), or null for the authored development staff. */
export function staffNationality(id: string): string | null { return nationalities.get(id) ?? null; }
/** The real assistant coach of a club, when the real-people list names one. */
export function realAssistantOf(clubId: string): AssistantCoach | undefined { return REAL_ASSISTANTS.find(item => item.clubId === clubId); }

/**
 * The clubs a market serves. With `countries` (one per club; club-level staff in a world whose countries are known),
 * the market adds each country's local pool, sized to that country's clubs, and the real assistant coaches of the
 * clubs listed.
 */
export interface StaffMarketScope { clubs: readonly { id: string }[]; countries?: readonly (string | null)[]; elite?: boolean }

/**
 * The candidates a league's clubs can meet: as many per club as the built-in league offers its six clubs. With `elite`
 * (club-level staff), a directory with top candidates adds one set of them per 24 clubs, plus one.
 */
export function staffMarket<T>(directory: readonly T[], world: StaffMarketScope): readonly T[] {
  const authored = AUTHORED.get(directory);
  if (authored === undefined) throw new Error('Choose a staff directory.');
  const base = BASES.get(directory)! as readonly T[];
  const size = Math.min(base.length, Math.max(authored, Math.ceil(authored * world.clubs.length / BUILT_IN_CLUBS)));
  let markets = MARKETS.get(directory);
  if (!markets) { markets = new Map(); MARKETS.set(directory, markets); }
  const elite = world.elite ? ELITES.get(directory) ?? [] : [];
  const eliteCount = Math.min(elite.length, elite.length && ELITE_COACH_TERMS.length * (1 + Math.floor(world.clubs.length / ELITE_CLUBS)));
  const key = size * 1_000 + eliteCount;
  let market = markets.get(key);
  if (!market) { market = Object.freeze([...base.slice(0, size), ...elite.slice(0, eliteCount)]); markets.set(key, market); }
  if (!world.countries) return market as readonly T[];
  let byScope = SCOPED.get(directory);
  if (!byScope) { byScope = new WeakMap(); SCOPED.set(directory, byScope); }
  const known = byScope.get(world);
  if (known) return known as readonly T[];
  const counts = new Map<string, number>();
  for (const country of world.countries) if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
  const pools = POOLS.get(directory)!;
  const local = [...counts].flatMap(([country, clubs]) => (pools.get(country) ?? []).slice(0, Math.ceil(authored * clubs / BUILT_IN_CLUBS)));
  const clubIds = new Set(world.clubs.map(club => club.id));
  const real = directory === (ASSISTANT_DIRECTORY as readonly unknown[]) ? REAL_ASSISTANTS.filter(item => clubIds.has(item.clubId)) : [];
  const scoped = Object.freeze([...market, ...local, ...real]);
  byScope.set(world, scoped);
  return scoped as readonly T[];
}
const MARKETS = new WeakMap<readonly unknown[], Map<number, readonly unknown[]>>();
const SCOPED = new WeakMap<readonly unknown[], WeakMap<object, readonly unknown[]>>();

const INDEXES = new WeakMap<readonly unknown[], ReadonlyMap<string, unknown>>();
/** A directory member by identity (a map lookup; format 74 directories hold up to 2,000 people), or undefined. */
export function staffMember<T extends { id: string }>(directory: readonly T[], id: unknown): T | undefined {
  if (typeof id !== 'string') return undefined;
  let index = INDEXES.get(directory) as ReadonlyMap<string, T> | undefined;
  if (!index) { index = new Map(directory.map(member => [member.id, member])); INDEXES.set(directory, index); }
  return index.get(id);
}

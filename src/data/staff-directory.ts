import type { AssistantCoach } from '../domain/assistant';
import type { Coach } from '../domain/coaching';
import type { FitnessCoach } from '../domain/fitness';
import type { Physio } from '../domain/physio';
import type { Scout } from '../domain/scouts';
import type { CareerWorld } from '../domain/world';
import type { YouthCoach } from '../domain/youth';
import { DEVELOPMENT_ASSISTANTS } from './development-assistants';
import { DEVELOPMENT_COACHES } from './development-coaches';
import { DEVELOPMENT_FITNESS_COACHES } from './development-fitness';
import { DEVELOPMENT_PHYSIOS } from './development-physios';
import { DEVELOPMENT_SCOUTS } from './development-scouts';
import { DEVELOPMENT_YOUTH_COACHES } from './development-youth';

/**
 * Every fictional staff member a career can meet. The built-in league's authored candidates come first; larger
 * leagues add generated fictional candidates that repeat the authored skills and fees in order, so each club
 * meets the same mix of quality and price. A league's market is the first part of a directory (`staffMarket`).
 */
const BUILT_IN_CLUBS = 6;
/** The largest supported league (MAX_WORLD_CLUBS in world/career-world.ts). */
const DIRECTORY_CLUBS = 40;
const FIRST_NAMES = ['Adrian', 'Bruno', 'Caspar', 'Dorian', 'Emil', 'Fabian', 'Gideon', 'Henrik', 'Ilian', 'Jonas', 'Kasimir', 'Lennart', 'Matteo', 'Nikolai', 'Oren', 'Pavel', 'Quentin', 'Rafael', 'Silas', 'Tobias', 'Urban', 'Valentin', 'Wendel', 'Xaver', 'Yannick', 'Zoran', 'Anton', 'Bastian', 'Cyril', 'Darius', 'Elias', 'Florin', 'Gregor', 'Hugo', 'Ivo', 'Jasper', 'Konrad', 'Laurin', 'Milo', 'Noah'];
const SURNAMES = ['Ardel', 'Brevan', 'Corlin', 'Delmar', 'Eskel', 'Farran', 'Gessel', 'Harlow', 'Ismen', 'Jarvik', 'Kestrel', 'Lorvan', 'Marlek', 'Norden', 'Orlick', 'Penrith', 'Quarry', 'Roswin', 'Sarnell', 'Tavik', 'Ulmer', 'Vessin', 'Wardell', 'Yarrow', 'Zennor', 'Altan', 'Bexley', 'Calder', 'Dunmore', 'Elvan', 'Fenwick', 'Galen', 'Hollis', 'Iverson', 'Jaskell', 'Kirwan', 'Lindqvist', 'Merrow', 'Navarre', 'Oakes'];

function extend<T extends { id: string; name: string }>(authored: readonly T[]): readonly T[] {
  const total = Math.ceil(authored.length * DIRECTORY_CLUBS / BUILT_IN_CLUBS);
  const prefix = authored[0]!.id.replace(/-\d+$/, '');
  const names = new Set(authored.map(item => item.name));
  const generated: T[] = [];
  for (let index = authored.length; index < total; index += 1) {
    let name = '', step = index * 37;
    do { name = `${FIRST_NAMES[step % FIRST_NAMES.length]} ${SURNAMES[Math.floor(step / FIRST_NAMES.length) % SURNAMES.length]}`; step += 1; } while (names.has(name));
    names.add(name);
    generated.push(Object.freeze({ ...authored[index % authored.length]!, id: `${prefix}-${String(index + 1).padStart(2, '0')}`, name }));
  }
  return Object.freeze([...authored, ...generated]);
}

export const COACH_DIRECTORY: readonly Coach[] = extend(DEVELOPMENT_COACHES);
export const SCOUT_DIRECTORY: readonly Scout[] = extend(DEVELOPMENT_SCOUTS);
export const FITNESS_DIRECTORY: readonly FitnessCoach[] = extend(DEVELOPMENT_FITNESS_COACHES);
export const PHYSIO_DIRECTORY: readonly Physio[] = extend(DEVELOPMENT_PHYSIOS);
export const ASSISTANT_DIRECTORY: readonly AssistantCoach[] = extend(DEVELOPMENT_ASSISTANTS);
export const YOUTH_COACH_DIRECTORY: readonly YouthCoach[] = extend(DEVELOPMENT_YOUTH_COACHES);

const AUTHORED = new Map<readonly unknown[], number>([
  [COACH_DIRECTORY, DEVELOPMENT_COACHES.length], [SCOUT_DIRECTORY, DEVELOPMENT_SCOUTS.length], [FITNESS_DIRECTORY, DEVELOPMENT_FITNESS_COACHES.length],
  [PHYSIO_DIRECTORY, DEVELOPMENT_PHYSIOS.length], [ASSISTANT_DIRECTORY, DEVELOPMENT_ASSISTANTS.length], [YOUTH_COACH_DIRECTORY, DEVELOPMENT_YOUTH_COACHES.length],
]);

/** The candidates a league's clubs can meet: as many per club as the built-in league offers its six clubs. */
export function staffMarket<T>(directory: readonly T[], world: Pick<CareerWorld, 'clubs'>): readonly T[] {
  const authored = AUTHORED.get(directory);
  if (authored === undefined) throw new Error('Choose a staff directory.');
  return directory.slice(0, Math.max(authored, Math.ceil(authored * world.clubs.length / BUILT_IN_CLUBS)));
}

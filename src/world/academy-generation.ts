import type { AcademyProspect } from '../domain/academy';
import type { PlayerAttributes, SkillAttributes, Position } from '../domain/types';
import { DEVELOPMENT_START_DATE } from '../data/development-league';
import { MAX_SEASON_ROUNDS } from './career-world';
import { OVR_POSITION_WEIGHTS, OVR_SCALE } from './overall-rating';
import { profileAtLevel, profiledSkills } from './position-profiles';
import { generatedNationality, generatedPersonName, peopleHash } from '../data/generated-names';

/**
 * Format 105 (`world.generatedPeople`): the club's country and the names already in use; prospects then get a
 * nationality and a name from the larger lists (`src/data/generated-names.ts`), and `taken` holds the new names.
 */
export interface ProspectPeople { country: string | null; taken: Set<string> }

const firstNames = ['Arin', 'Lio', 'Emir', 'Noel', 'Ivo', 'Miro', 'Luca', 'Sami', 'Niko', 'Theo', 'Eren', 'Milo', 'Ruben', 'Deni', 'Elian', 'Leon'];
const surnames = ['Varen', 'Talin', 'Berin', 'Soren', 'Meren', 'Dalin', 'Feran', 'Neris', 'Selan', 'Korin', 'Arven', 'Leris', 'Vellis', 'Rovan', 'Toren', 'Sarin'];
const positions: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const attributes: readonly (keyof SkillAttributes)[] = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
function hash(seed: number, key: string): number { let value = (2166136261 ^ seed) >>> 0; for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; }

/**
 * Fictional identities from a separate stable stream; generation never consumes match RNG. `profiles` (format 106,
 * `world.positionProfiles`): skills shaped like real European players of the position (`position-profiles.ts`), at the
 * same position-weighted level as the earlier rule; otherwise the earlier flat shape. Names never depend on skills.
 */
export function generateAcademyProspects(seed: number, clubId: string, seasonNumber: number, round: number, initial: boolean, count: number, people?: ProspectPeople, profiles = false): AcademyProspect[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff || typeof clubId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(clubId) || !Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 7974 || !Number.isInteger(round) || round < 1 || round > MAX_SEASON_ROUNDS || !Number.isInteger(count) || count < 0 || count > (initial ? 3 : 2)) throw new Error('Choose a supported fictional academy intake.');
  return Array.from({ length: count }, (_, index) => withPeople(seed, makeProspect(seed, clubId, seasonNumber, round, index, initial ? 16 + index : 16, `academy-${clubId}-s${seasonNumber}-p${index + 1}`, undefined, profiles), people));
}

/** Fill a playing squad at a recorded activation/opening, without redefining older intake identities. */
export function generateYouthSquadProspects(seed: number, clubId: string, seasonNumber: number, round: number, existing: readonly AcademyProspect[], count: number, people?: ProspectPeople, profiles = false): AcademyProspect[] {
  generateAcademyProspects(seed, clubId, seasonNumber, round, false, 0);
  if (!Number.isInteger(count) || count < 0 || count > 8 || existing.some(prospect => prospect.clubId !== clubId)) throw new Error('Choose a supported supplemental youth squad.');
  const year = Number(DEVELOPMENT_START_DATE.slice(0, 4)) + seasonNumber - 1;
  const ages = new Map(Array.from({ length: 5 }, (_, index) => [16 + index, existing.filter(prospect => year - Number(prospect.dateOfBirth.slice(0, 4)) === 16 + index).length]));
  const positionCounts = new Map(positions.map(position => [position, existing.filter(prospect => prospect.player.position === position).length]));
  const names = new Set(existing.map(prospect => prospect.player.name));
  const numbers = new Set(existing.map(prospect => prospect.player.number));
  return Array.from({ length: count }, (_, index) => {
    const age = [...ages].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0]![0];
    ages.set(age, ages.get(age)! + 1);
    const position = [...positions].sort((a, b) => positionCounts.get(a)! - positionCounts.get(b)! || positions.indexOf(a) - positions.indexOf(b))[0]!;
    positionCounts.set(position, positionCounts.get(position)! + 1);
    const prospect = makeProspect(seed, clubId, seasonNumber, round, index, age, `academy-youth-${clubId}-s${seasonNumber}-p${index + 1}`, position, profiles);
    // Format 105: a nationality and a name from the larger lists, clear of every name in use.
    if (people) {
      let number = 1; while (numbers.has(number)) number += 1;
      numbers.add(number);
      const named = withPeople(seed, prospect, people);
      return { ...named, player: { ...named.player, number } };
    }
    let name = prospect.player.name;
    const offset = hash(seed, `${prospect.player.id}:unique-name`) % (firstNames.length * surnames.length);
    for (let n = 0; names.has(name) && n < firstNames.length * surnames.length; n += 1) {
      const value = (offset + n) % (firstNames.length * surnames.length);
      name = `${firstNames[Math.floor(value / surnames.length)]} ${surnames[value % surnames.length]}`;
    }
    names.add(name);
    // Supplemental shirts use their own small range; ordinary intake keeps 20–99.
    let number = 1; while (numbers.has(number)) number += 1;
    numbers.add(number);
    return { ...prospect, player: { ...prospect.player, name, number } };
  });
}

/** The earlier rule's bonus: two points on passing for a point guard, three-point shooting for guards, inside skills for big men. */
const flatBonus = (attribute: keyof SkillAttributes, positionIndex: number) => attribute === 'passing' && positionIndex === 0 || attribute === 'threePoint' && positionIndex <= 1 || attribute === 'rebounding' && positionIndex >= 3 || attribute === 'twoPoint' && positionIndex >= 3 ? 2 : 0;
/** The earlier rule's mean skill (7-11) and the position-weighted bonus it gave, which shaped prospects keep. */
const FLAT_MEAN = 9;
const flatWeightedBonus = (position: Position) => attributes.reduce((sum, attribute) => sum + OVR_POSITION_WEIGHTS[position][attribute] * flatBonus(attribute, positions.indexOf(position)), 0);

/** A prospect with a format-105 nationality and name (unchanged without `people`). */
function withPeople(seed: number, prospect: AcademyProspect, people: ProspectPeople | undefined): AcademyProspect {
  if (!people) return prospect;
  const id = prospect.player.id, nationality = generatedNationality('academy', people.country, peopleHash(seed, `${id}:nationality`));
  const name = generatedPersonName(nationality, 'academy', peopleHash(seed, `${id}:name`), people.taken);
  return { ...prospect, player: { ...prospect.player, name }, nationality };
}

function makeProspect(seed: number, clubId: string, seasonNumber: number, round: number, index: number, age: number, id: string, chosenPosition?: Position, profiles = false): AcademyProspect {
    const year = Number(DEVELOPMENT_START_DATE.slice(0, 4)) + seasonNumber - 1;
    const value = (key: string, count: number) => hash(seed, `${id}:${key}`) % count;
    const position = chosenPosition ?? positions[value('position', positions.length)]!;
    const positionIndex = positions.indexOf(position);
    // Format 106: shaped like real European players of the position at the earlier rule's mean rating, at its position-
    // weighted level, with the same five-point spread (the same draws, so identities and variation are unchanged).
    const level = FLAT_MEAN + flatWeightedBonus(position), shaped = profiles ? profileAtLevel('europe', position, OVR_SCALE.perSkillPoint * level + OVR_SCALE.offset, level) : null;
    const skills = (shaped
      ? profiledSkills(shaped.profile, shaped.shift, attribute => value(attribute, 5) - 2)
      : Object.fromEntries(attributes.map(attribute => [attribute, 7 + value(attribute, 5) + flatBonus(attribute, positionIndex)]))) as unknown as PlayerAttributes;
    return { player: { id, name: `${firstNames[value('first', firstNames.length)]} ${surnames[value('last', surnames.length)]}`, position, number: 20 + (seasonNumber * 3 + index) % 80, heightCm: 177 + positionIndex * 7 + value('height', 11), weightKg: 72 + positionIndex * 8 + value('weight', 10), skinTone: ['#e8b58e', '#c98c62', '#a96f49', '#774d35', '#edc5a1'][value('skin', 5)]!, hairColor: ['#29201b', '#553b29', '#191919', '#8b6744'][value('hair', 4)]!, attributes: skills }, dateOfBirth: `${year - age}-${String(1 + value('month', 8)).padStart(2, '0')}-${String(1 + value('day', 28)).padStart(2, '0')}`, seasonWage: 500_000 + value('wage', 7) * 50_000, clubId, intakeSeason: seasonNumber, intakeRound: round };
}

import type { Player, PlayerAttributes, Position, SkillAttributes } from '../domain/types';
import type { CareerWorld, WorldContext } from '../domain/world';
import { DEVELOPMENT_START_DATE } from '../data/development-league';
import { countryName, nameCapacity, NAME_COUNTRIES } from '../data/people-names';
import { backgroundLeagueClubIds, clubCountry, europeanOnlyClubIds, worldOf } from './career-world';
import { firstSeasonSaturday } from './competition-calendar';
import { hasExtraAttributes, storedExtras, withExtraAttributes } from './extra-attributes';
import { agedExtrasBetween, developmentLossBetween, retirementTargetAge, type LifecycleContext } from './lifecycle-policy';
import { attributesFor, squadStrength } from './lower-division';
import { overallRating } from './overall-rating';
import { developmentHash, fractionalAge, levelFactor, playerGrowthRate, seasonForm, stochasticShare, usesPlayerDevelopment } from './player-development';
import { maximumHeadroomForAge, playerHeadroom, potentialShareBasisPoints } from './potential';

/**
 * Format 104 (owner request after the ten-season checks, 24 November 2026; new careers, marker
 * `world.backgroundSquads`): background clubs' squads change from season to season, as a lighter level of detail than
 * full clubs. Background clubs are the European entrants outside the chosen leagues and the unchosen countries' top
 * divisions; before format 104 they kept their real squad for the whole career, so with the realistic decline (format
 * 101) they weakened visibly, and before it they stayed frozen (one background club won the EuroLeague five times in ten
 * seasons).
 *
 * At each season change, for every background club:
 *
 * 1. **Development** with the format-101 rules in a cheap form: a season of ordinary practice per skill turned into skill
 *    by the player's age, growth and timing traits, the season's form and the skill already reached, up to his hidden
 *    potential; decline and birthday setbacks exactly as for every other player.
 * 2. **Retirement** at the same target age as full-world players (37-40).
 * 3. **Departures**: a veteran (30 or older) who has fallen well below his role in the squad leaves; a player who has
 *    clearly outgrown it may move to a stronger club; and a few players a season change clubs at random.
 * 4. **Replacements** keep the squad's size and positions: each vacancy keeps the level of the role it leaves, nudged by
 *    how far the club's best eight has drifted from its starting strength. A departing player of another background club
 *    near that level (same position) is signed first; otherwise a generated player of that level joins.
 *
 * Nothing is stored: every squad is derived from the career's world, seed and aging start, so the simulation, the
 * screens and the strict save check agree, and saves do not grow. Moves to or from full-world clubs are not modelled
 * (they would need contracts and records). Older careers keep their squads exactly.
 */
export const BACKGROUND_SQUAD_RULES = Object.freeze({
  /** A season's practice per skill, in hundredths of a rating point, before the age curve (standard week, usual coaching). */
  practice: 170,
  /** A player of 30 or older leaves once his overall rating is this far below his role's level. */
  releaseGap: 6,
  releaseAge: 30,
  /** A player whose overall is this far above his role's level may move on, with this chance (basis points). */
  outgrownGap: 5,
  outgrownShare: 5_000,
  /** Players from `moveAges[0]` to `moveAges[1]` change clubs at random with this chance a season (basis points). */
  moveShare: 800,
  moveAges: Object.freeze([22, 31] as const),
  /** At most this many players leave a club in one season change, retirements aside. */
  maxDepartures: 3,
  /**
   * A newcomer's level: the role's level plus the club's shortfall from its level for the season (best eight), spread
   * over the vacancies (x 8 / vacancies, as each moves the best eight's mean by an eighth), within `maxDrift`.
   */
  maxDrift: 10,
  /**
   * Good and bad spells: each club's level moves from its starting strength by a seeded cycle, each season keeping
   * `cycleKeep` of the last one plus up to `cycleStep` either way, never beyond `cycleMax` (overall points).
   */
  cycleKeep: 0.7,
  cycleStep: 4,
  cycleMax: 8,
  /**
   * A club this far above its level for the season sells its best player; this far below it, it releases its weakest
   * to sign a better one (two players at twice the gap; overall points of the best eight).
   */
  trackGap: 1.5,
  /** A departing player is signed when his overall is within `window` of the level sought. */
  window: 3,
  /** Generated newcomers: overall within `noise` either way of the level sought, aged `ages[0]` to `ages[1]`. */
  noise: 3,
  ages: Object.freeze([21, 30] as const),
  /** One generated player in this share (basis points) has an international name; the rest a name of the club's country. */
  foreignNameShare: 4_000,
});

const SKILLS = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const satisfies readonly (keyof SkillAttributes)[];
const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Whether the career's background clubs change squads at season changes (format 104). */
export function usesBackgroundSquads(context: WorldContext & Pick<LifecycleContext, 'lifecycle' | 'seed'>): boolean {
  return worldOf(context).backgroundSquads === true && usesPlayerDevelopment(context) && !!context.lifecycle?.enabledSince && Number.isInteger(context.seed);
}

/** The clubs this applies to: European entrants outside the domestic leagues and the background leagues' clubs. */
export function backgroundSquadClubIds(world: CareerWorld): ReadonlySet<string> {
  return new Set([...europeanOnlyClubIds(world), ...backgroundLeagueClubIds(world)]);
}

/** A season's first Saturday, as European squads use it. */
export const backgroundSeasonStart = (seasonNumber: number) => firstSeasonSaturday(Number(DEVELOPMENT_START_DATE.slice(0, 4)) + seasonNumber - 1);

interface Member {
  /** The player as he joined: skills before development and decline, the five further abilities. */
  player: Player;
  dateOfBirth: string;
  /** The day his development and decline start (the aging start, or the day he was generated). */
  since: string;
  /** Development gained so far per skill, hundredths. */
  grown: Record<keyof SkillAttributes, number>;
  /** The most development each skill can still hold, hundredths (hidden potential, never above 20). */
  cap: Record<keyof SkillAttributes, number>;
  /** The level of his role in his club's squad (overall rating). */
  role: number;
  /** A real player of the data pack (not generated). */
  original: boolean;
}
interface ClubBook { id: string; strength: number; size: number; members: Member[]; cycle: number[] }
interface Book { seed: number; context: LifecycleContext; clubs: Map<string, ClubBook>; seasons: Map<string, Member[]>[]; teams: Map<string, Player[]>; attributes: Map<string, PlayerAttributes> }

const books = new WeakMap<CareerWorld, Map<string, Book>>();

function bookFor(context: LifecycleContext): Book {
  const world = worldOf(context), seed = context.seed!, anchor = context.lifecycle!.enabledSince!.date;
  let byKey = books.get(world);
  if (!byKey) { byKey = new Map(); books.set(world, byKey); }
  const key = `${seed}|${anchor}`;
  let book = byKey.get(key);
  if (book) return book;
  // A context of its own: only the world, the seed and the aging start enter (never later career records).
  const own: LifecycleContext = { world, seed, lifecycle: { model: 'lifecycle-1', enabledSince: context.lifecycle!.enabledSince, reviews: [], notices: [] } };
  const pool = backgroundSquadClubIds(world), clubs = new Map<string, ClubBook>(), first = new Map<string, Member[]>();
  for (const club of world.clubs) {
    if (!pool.has(club.id)) continue;
    const members = club.players.map(player => originalMember(own, seed, player, anchor));
    clubs.set(club.id, { id: club.id, strength: squadStrength(club.players), size: club.players.length, members, cycle: [0] });
    first.set(club.id, members);
  }
  book = { seed, context: own, clubs, seasons: [first], teams: new Map(), attributes: new Map() };
  byKey.set(key, book);
  return book;
}

function zero(): Record<keyof SkillAttributes, number> { return Object.fromEntries(SKILLS.map(key => [key, 0])) as Record<keyof SkillAttributes, number>; }

function originalMember(context: LifecycleContext, seed: number, player: Player, anchor: string): Member {
  const profile = worldOf(context).playerProfiles[player.id];
  const dateOfBirth = profile?.dateOfBirth ?? `${Number(anchor.slice(0, 4)) - 26}${anchor.slice(4)}`;
  const headroom = playerHeadroom({ ...context, seed } as Parameters<typeof playerHeadroom>[0], player.id);
  return { player, dateOfBirth, since: anchor, grown: zero(), cap: capOf(player.attributes, headroom), role: overallRating(player.attributes, player.position), original: true };
}

function capOf(attributes: PlayerAttributes, headroom: number): Record<keyof SkillAttributes, number> {
  return Object.fromEntries(SKILLS.map(key => [key, Math.max(0, Math.min(headroom, 20 - attributes[key])) * 100])) as Record<keyof SkillAttributes, number>;
}

/** The member's skills on a date: as he joined, plus development, less decline and setbacks since he joined. */
function skillsOn(book: Book, member: Member, date: string): Record<keyof SkillAttributes, number> {
  const loss = date > member.since ? developmentLossBetween(book.seed, member.player.id, member.dateOfBirth, member.since, date) : zero();
  return Object.fromEntries(SKILLS.map(key => [key, Math.max(1, Math.min(20, member.player.attributes[key] + Math.floor(member.grown[key] / 100) - Math.floor(loss[key] / 100)))])) as Record<keyof SkillAttributes, number>;
}

/** The member's abilities on a date (cached: the same player, date and development give the same abilities). */
function attributesOn(book: Book, member: Member, date: string): PlayerAttributes {
  const key = `${member.player.id}|${member.since}|${date}|${SKILLS.map(skill => member.grown[skill]).join(',')}`;
  const known = book.attributes.get(key);
  if (known) return known;
  const skills = skillsOn(book, member, date), base = member.player.attributes;
  // The five further abilities age with the usual dated rules from the same start.
  const attributes = (hasExtraAttributes(base) ? { ...skills, ...(date > member.since ? agedExtrasBetween(base, member.dateOfBirth, member.since, date) : storedExtras(base)) } : skills) as PlayerAttributes;
  book.attributes.set(key, attributes);
  return attributes;
}

const ratingOn = (book: Book, member: Member, date: string) => overallRating(attributesOn(book, member, date) as PlayerAttributes, member.player.position);
const chance = (seed: number, key: string, share: number) => developmentHash(seed, key) % 10_000 < share;

/** One season's practice: each skill grows by the player's age curve, traits, form and the skill already reached. */
function practise(book: Book, member: Member, seasonNumber: number, start: string): void {
  const age = fractionalAge(member.dateOfBirth, start);
  const rate = playerGrowthRate(book.seed, member.player.id, age) * seasonForm(book.seed, member.player.id, seasonNumber) / 10_000;
  if (rate <= 0) return;
  const skills = skillsOn(book, member, start);
  for (const key of SKILLS) {
    if (member.grown[key] >= member.cap[key]) continue;
    const basis = Math.floor(rate * levelFactor(skills[key]) / 10_000);
    const gain = stochasticShare(BACKGROUND_SQUAD_RULES.practice, basis, book.seed, `background-practice:${member.player.id}:${seasonNumber}:${key}`);
    member.grown[key] = Math.min(member.cap[key], member.grown[key] + gain);
  }
}

/** The club's good or bad spell in a season, overall points around its starting strength (0 in the opening season). */
function clubCycle(book: Book, club: ClubBook, seasonNumber: number): number {
  const rules = BACKGROUND_SQUAD_RULES;
  while (club.cycle.length < seasonNumber) {
    const step = (developmentHash(book.seed, `background-cycle:${club.id}:${club.cycle.length + 1}`) % 10_001 / 10_000 * 2 - 1) * rules.cycleStep;
    club.cycle.push(Math.round(Math.max(-rules.cycleMax, Math.min(rules.cycleMax, rules.cycleKeep * club.cycle.at(-1)! + step)) * 100) / 100);
  }
  return club.cycle[seasonNumber - 1]!;
}

const copyMember = (member: Member): Member => ({ ...member, grown: { ...member.grown } });

/** The best eight's strength with the vacancies filled at their roles' levels. */
function strengthWith(ratings: readonly number[]): number {
  const best = [...ratings].sort((a, b) => b - a).slice(0, 8);
  return best.reduce((sum, value) => sum + value, 0) / Math.max(1, best.length);
}

function freeNumber(seed: number, key: string, taken: ReadonlySet<number>): number {
  const start = developmentHash(seed, `${key}:number`) % 100;
  for (let step = 0; step < 100; step += 1) { const number = (start + step * 7) % 100; if (!taken.has(number)) return number; }
  throw new Error('A background squad has no free shirt number.');
}

function generatedName(seed: number, id: string, country: string | null): string {
  const local = country && nameCapacity(country) > 0 && !chance(seed, `${id}:foreign`, BACKGROUND_SQUAD_RULES.foreignNameShare);
  const chosen = local ? country! : NAME_COUNTRIES[developmentHash(seed, `${id}:name-country`) % NAME_COUNTRIES.length]!;
  const size = nameCapacity(chosen);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const name = countryName(chosen, (developmentHash(seed, `${id}:name`) + attempt) % size);
    if (name) return name;
  }
  return `Player ${id.slice(-6)}`;
}

/** A generated newcomer of a level and position joining before `seasonNumber`. */
function generatedMember(book: Book, world: CareerWorld, clubId: string, seasonNumber: number, index: number, position: Position, level: number, role: number, taken: ReadonlySet<number>): Member {
  const seed = book.seed, rules = BACKGROUND_SQUAD_RULES, start = backgroundSeasonStart(seasonNumber);
  const id = `${clubId}-bgen-s${seasonNumber}-${index}`.slice(0, 80);
  const value = (key: string, count: number) => developmentHash(seed, `${id}:${key}`) % count;
  const target = Math.max(1, Math.min(99, level + value('level', 2 * rules.noise + 1) - rules.noise));
  const skills = attributesFor(target, position, key => value(key, 3) - 1);
  const age = rules.ages[0] + value('age', rules.ages[1] - rules.ages[0] + 1);
  const positionIndex = POSITIONS.indexOf(position);
  const heightCm = 182 + positionIndex * 6 + value('height', 9);
  const attributes = withExtraAttributes({ id, position, heightCm, attributes: skills, age, minutes: 0 });
  const birthday = `${String(1 + value('month', 12)).padStart(2, '0')}-${String(1 + value('day', 28)).padStart(2, '0')}`;
  const dateOfBirth = `${Number(start.slice(0, 4)) - age - (birthday > start.slice(5) ? 1 : 0)}-${birthday}`;
  const player: Player = {
    id, name: generatedName(seed, id, clubCountry(world, clubId)), number: freeNumber(seed, id, taken), position, heightCm, weightKg: 78 + positionIndex * 7 + value('weight', 10),
    skinTone: ['#e8b58e', '#c98c62', '#a96f49', '#774d35', '#edc5a1'][value('skin', 5)]!, hairColor: ['#29201b', '#553b29', '#191919', '#8b6744'][value('hair', 4)]!, attributes,
  };
  const headroom = Math.floor((maximumHeadroomForAge(age) * potentialShareBasisPoints(seed, id) + 5_000) / 10_000);
  return { player, dateOfBirth, since: start, grown: zero(), cap: capOf(attributes, headroom), role, original: false };
}

interface Leaver { member: Member; from: string; rating: number; order: number }

/** The squads before `seasonNumber + 1` from those of `seasonNumber`. */
function nextSeason(book: Book, world: CareerWorld, seasonNumber: number): Map<string, Member[]> {
  const rules = BACKGROUND_SQUAD_RULES, seed = book.seed, previous = book.seasons[seasonNumber - 1]!;
  const start = backgroundSeasonStart(seasonNumber), next = backgroundSeasonStart(seasonNumber + 1);
  const stay = new Map<string, Member[]>(), vacancies = new Map<string, { index: number; position: Position; role: number }[]>(), pool: Leaver[] = [];
  for (const [clubId, members] of previous) {
    const kept: Member[] = [], open: { index: number; position: Position; role: number }[] = [];
    const candidates: { member: Member; index: number; rating: number; priority: number }[] = [], rated: { member: Member; index: number; rating: number }[] = [];
    members.forEach((given, index) => {
      const member = copyMember(given), id = member.player.id;
      practise(book, member, seasonNumber, start);
      if (fractionalAge(member.dateOfBirth, next) >= retirementTargetAge(seed, id)) { open.push({ index, position: member.player.position, role: member.role }); return; }
      const rating = ratingOn(book, member, next), age = fractionalAge(member.dateOfBirth, next);
      const key = `background-move:${id}:${seasonNumber}`;
      // Departures, most pressing first: a veteran below his role, a player who outgrew it, a random move.
      const priority = age >= rules.releaseAge && rating <= member.role - rules.releaseGap ? 3
        : rating >= member.role + rules.outgrownGap && chance(seed, `${key}:outgrown`, rules.outgrownShare) ? 2
          : age >= rules.moveAges[0] && age <= rules.moveAges[1] && chance(seed, key, rules.moveShare) ? 1 : 0;
      if (priority) candidates.push({ member, index, rating, priority });
      rated.push({ member, index, rating });
      kept[index] = member;
    });
    // Following the club's level for the season: above it, its best player is sold; below it, its weakest makes room.
    const club = book.clubs.get(clubId)!;
    const excess = strengthWith([...rated.map(row => row.rating), ...open.map(slot => slot.role)]) - club.strength - clubCycle(book, club, seasonNumber + 1);
    if (Math.abs(excess) >= rules.trackGap && rated.length) {
      const ranked = [...rated].sort((a, b) => b.rating - a.rating || a.index - b.index);
      // Two players when the club is twice the gap away from its level.
      const picks = (excess > 0 ? ranked : [...ranked].reverse()).slice(0, Math.abs(excess) >= 2 * rules.trackGap ? 2 : 1);
      for (const pick of picks) {
        const known = candidates.find(row => row.index === pick.index);
        if (known) known.priority = Math.max(known.priority, 2.5); else candidates.push({ ...pick, priority: 2.5 });
      }
    }
    const leaving = candidates.sort((a, b) => b.priority - a.priority || Math.abs(b.rating - b.member.role) - Math.abs(a.rating - a.member.role) || a.index - b.index).slice(0, rules.maxDepartures);
    for (const { member, index, rating } of leaving) {
      delete kept[index];
      open.push({ index, position: member.player.position, role: member.role });
      pool.push({ member, from: clubId, rating, order: developmentHash(seed, `background-pool:${member.player.id}:${seasonNumber}`) });
    }
    stay.set(clubId, kept);
    vacancies.set(clubId, open.sort((a, b) => a.index - b.index));
  }
  // Clubs fill their vacancies in a seeded order each season, so no club always chooses first.
  const order = [...previous.keys()].sort((a, b) => developmentHash(seed, `background-order:${seasonNumber}:${a}`) - developmentHash(seed, `background-order:${seasonNumber}:${b}`) || (a < b ? -1 : 1));
  const taken = new Set<string>(), result = new Map<string, Member[]>();
  for (const clubId of order) {
    const club = book.clubs.get(clubId)!, kept = stay.get(clubId)!, open = vacancies.get(clubId)!;
    const ratings = kept.flatMap(member => member ? [ratingOn(book, member, next)] : []);
    const shortfall = club.strength + clubCycle(book, club, seasonNumber + 1) - strengthWith([...ratings, ...open.map(slot => slot.role)]);
    const nudge = Math.max(-rules.maxDrift, Math.min(rules.maxDrift, Math.round(shortfall * 8 / Math.max(1, open.length))));
    const numbers = new Set(kept.flatMap(member => member ? [member.player.number] : []));
    let generated = 0;
    for (const slot of open) {
      const level = slot.role + nudge;
      const signing = pool.filter(leaver => !taken.has(leaver.member.player.id) && leaver.from !== clubId && leaver.member.player.position === slot.position && Math.abs(leaver.rating - level) <= rules.window)
        .sort((a, b) => Math.abs(a.rating - level) - Math.abs(b.rating - level) || a.order - b.order)[0];
      let member: Member;
      if (signing) {
        taken.add(signing.member.player.id);
        const number = numbers.has(signing.member.player.number) ? freeNumber(seed, `${signing.member.player.id}:${clubId}:${seasonNumber}`, numbers) : signing.member.player.number;
        member = { ...signing.member, player: number === signing.member.player.number ? signing.member.player : { ...signing.member.player, number }, role: slot.role };
      } else member = generatedMember(book, world, clubId, seasonNumber + 1, (generated += 1), slot.position, level, slot.role, numbers);
      numbers.add(member.player.number);
      kept[slot.index] = member;
    }
    result.set(clubId, kept.filter(Boolean));
  }
  // The same club order as the opening season, for stable iteration.
  return new Map([...previous.keys()].map(clubId => [clubId, result.get(clubId)!]));
}

/**
 * A background club's players for a season (aged and developed to its first day), or null when the club is not one of
 * the career's background clubs. Squads stay the same through a season.
 */
export function developedBackgroundPlayers(context: LifecycleContext, clubId: string, seasonNumber: number): readonly Player[] | null {
  const world = worldOf(context);
  if (!backgroundSquadClubIds(world).has(clubId)) return null;
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || seasonNumber > 400) throw new Error('Choose a supported season for a background squad.');
  const book = bookFor(context);
  const key = `${clubId}|${seasonNumber}`;
  const known = book.teams.get(key);
  if (known) return known;
  while (book.seasons.length < seasonNumber) book.seasons.push(nextSeason(book, world, book.seasons.length));
  const date = backgroundSeasonStart(seasonNumber);
  const players = book.seasons[seasonNumber - 1]!.get(clubId)!.map(member => ({ ...member.player, attributes: attributesOn(book, member, date) }));
  book.teams.set(key, players);
  return players;
}

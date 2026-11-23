import type { Player, PlayerAttributes, SkillAttributes, Position, Team } from '../domain/types';
import { overallRating } from './performance-rating';
import { withExtraAttributes } from './extra-attributes';

/**
 * Real-data game packs (scripts/real-data-pack.mjs). A pack is a private file loaded from the player's own computer;
 * it never ships with the game. This pilot uses packs for friendly matches between real clubs.
 */
export const DATA_PACK_FORMAT = 'basketball-manager-data-pack';
export const MAX_DATA_PACK_BYTES = 20 * 1024 * 1024;
/** Real players are drawn as neutral figures, never with a guessed appearance. */
export const NEUTRAL_APPEARANCE = Object.freeze({ skinTone: '#9aa0a8', hairColor: '#3b3f45' });
/** Clubs whose colours are not yet verified use a neutral colour. */
export const NEUTRAL_CLUB_COLOR = '#6b7280';
export const MATCHDAY_SQUAD = 12;

export interface DataPackPlayer {
  id: string; name: string; clubId: string; number: number | null; position: Position; nationality: string | null; age: number | null;
  heightCm: number; weightKg: number; attributes: PlayerAttributes; estimated: string[];
  /** Optional researched profile facts; older packs keep their original estimates. */
  birthDate?: string;
  /** Minutes of play the ratings rest on (sprint 4 rating fairness); absent in older packs. */
  ratingMinutes?: number;
  profileEvidence?: { observedAt: string; positionSource: 'estimated' | 'official' | 'provider'; membership: 'needs-review' | 'official-registration-observed' | 'provider-observed'; sources: string[] };
}
export interface DataPackClub {
  id: string; name: string; shortName: string; country: string | null; city: string | null; arena: string | null;
  color: string | null; secondaryColor: string | null; identitySource: string | null; playerIds: string[];
  /** NBA step 4 (optional, pack v8): the arena's seats when known. Older packs and clients ignore it. */
  capacity?: number;
}
/**
 * NBA step 4 (optional, pack v8): a competition's groups. The NBA lists its two conferences (no `parentId`), then the
 * six divisions with the conference as `parentId`. The groups without a parent partition the clubs, and the groups of
 * each parent partition that parent's clubs. Older packs and clients ignore it.
 */
export interface DataPackGroup { id: string; name: string; parentId?: string; clubIds: string[] }
export interface DataPackCompetition { id: string; name: string; country: string | null; tier: number; kind: 'domestic' | 'european'; season: string; clubIds: string[]; groups?: DataPackGroup[] }
export interface DataPack {
  format: typeof DATA_PACK_FORMAT; formatVersion: 1; version: string; season: string; source: Record<string, unknown>; notice: string;
  competitions: DataPackCompetition[]; clubs: DataPackClub[]; players: DataPackPlayer[];
}

const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const ATTRIBUTES: readonly (keyof SkillAttributes)[] = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'];
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u;
const COLOR = /^#[0-9a-f]{6}$/u;

function fail(reason: string): never { throw new Error(`This data pack cannot be used: ${reason}.`); }
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, label: string, max = 120): string => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} is missing or too long`); return value; };

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Reads a pack file, refusing it unless its fingerprint matches its contents and every club and player is complete. */
export async function parseDataPack(fileText: string): Promise<DataPack> {
  if (fileText.length > MAX_DATA_PACK_BYTES) fail('the file is larger than 20 MB');
  let file: unknown;
  try { file = JSON.parse(fileText); } catch { fail('it is not a data pack file'); }
  if (!isObject(file) || typeof file.checksum !== 'string' || !isObject(file.pack)) fail('it is not a data pack file');
  const pack = file.pack as Record<string, unknown>;
  if (pack.format !== DATA_PACK_FORMAT || pack.formatVersion !== 1) fail('it uses an unsupported pack format');
  if (await sha256(JSON.stringify(pack)) !== file.checksum) fail('its contents do not match its fingerprint (the file was changed or damaged)');
  text(pack.version, 'the version'); text(pack.season, 'the season');
  if (!Array.isArray(pack.clubs) || !Array.isArray(pack.players) || !Array.isArray(pack.competitions)) fail('clubs, players or competitions are missing');
  const players = new Map<string, DataPackPlayer>();
  for (const raw of pack.players) {
    if (!isObject(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || players.has(raw.id)) fail('a player has a missing or repeated identity');
    text(raw.name, 'a player name');
    if (!POSITIONS.includes(raw.position as Position)) fail(`${raw.name} has an unknown position`);
    if (!Array.isArray(raw.estimated) || raw.estimated.some(field => typeof field !== 'string')) fail(`${raw.name} has invalid estimate labels`);
    if (raw.birthDate !== undefined && (typeof raw.birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.birthDate) || !Number.isFinite(Date.parse(raw.birthDate)) || new Date(raw.birthDate).toISOString().slice(0, 10) !== raw.birthDate || raw.birthDate < `${Number(String(pack.season).slice(0, 4)) - 61}-09-05` || raw.birthDate > `${Number(String(pack.season).slice(0, 4)) - 12}-09-05`)) fail(`${raw.name} has an invalid birth date`);
    if (raw.ratingMinutes !== undefined && (typeof raw.ratingMinutes !== 'number' || !Number.isFinite(raw.ratingMinutes) || raw.ratingMinutes < 0 || raw.ratingMinutes > 1_000_000)) fail(`${raw.name} has invalid rating minutes`);
    if (raw.profileEvidence !== undefined) {
      const evidence = raw.profileEvidence;
      if (!isObject(evidence) || typeof evidence.observedAt !== 'string' || !Number.isFinite(Date.parse(evidence.observedAt)) || !['estimated', 'official', 'provider'].includes(evidence.positionSource as string) || !['needs-review', 'official-registration-observed', 'provider-observed'].includes(evidence.membership as string) || !Array.isArray(evidence.sources) || evidence.sources.some(url => typeof url !== 'string' || !url.startsWith('https://'))) fail(`${raw.name} has invalid profile evidence`);
      if ((evidence.positionSource === 'estimated') !== raw.estimated.includes('game_position')) fail(`${raw.name} has inconsistent position evidence`);
    }
    if (!isObject(raw.attributes) || ATTRIBUTES.some(key => !Number.isInteger((raw.attributes as Record<string, unknown>)[key]) || ((raw.attributes as Record<string, number>)[key]! < 1 || (raw.attributes as Record<string, number>)[key]! > 20))) fail(`${raw.name} has abilities outside 1-20`);
    if (!Number.isInteger(raw.heightCm) || (raw.heightCm as number) < 150 || (raw.heightCm as number) > 240 || !Number.isInteger(raw.weightKg) || (raw.weightKg as number) < 50 || (raw.weightKg as number) > 180) fail(`${raw.name} has an impossible height or weight`);
    players.set(raw.id, raw as unknown as DataPackPlayer);
  }
  const clubIds = new Set<string>();
  for (const raw of pack.clubs) {
    if (!isObject(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || clubIds.has(raw.id)) fail('a club has a missing or repeated identity');
    text(raw.name, 'a club name'); text(raw.shortName, 'a club short name', 12);
    if (raw.color !== null && (typeof raw.color !== 'string' || !COLOR.test(raw.color))) fail(`${raw.name} has an invalid colour`);
    const competing = pack.competitions.some(competition => isObject(competition) && Array.isArray(competition.clubIds) && competition.clubIds.includes(raw.id));
    if (!Array.isArray(raw.playerIds) || (competing && raw.playerIds.length < 5) || new Set(raw.playerIds).size !== raw.playerIds.length || raw.playerIds.some(id => !players.has(id as string) || players.get(id as string)!.clubId !== raw.id)) fail(`${raw.name} has an incomplete squad`);
    clubIds.add(raw.id);
  }
  for (const raw of pack.competitions) if (!isObject(raw) || !Array.isArray(raw.clubIds) || raw.clubIds.some(id => !clubIds.has(id as string))) fail('a competition lists an unknown club');
  for (const raw of pack.competitions as Record<string, unknown>[]) if (raw.groups !== undefined) checkGroups(raw.groups, raw.clubIds as string[], String(raw.name));
  for (const raw of pack.clubs as Record<string, unknown>[]) if (raw.capacity !== undefined && (!Number.isInteger(raw.capacity) || (raw.capacity as number) < 500 || (raw.capacity as number) > 60_000)) fail(`${raw.name} has an invalid arena capacity`);
  for (const player of players.values()) if (!pack.clubs.some(raw => isObject(raw) && raw.id === player.clubId && Array.isArray(raw.playerIds) && raw.playerIds.includes(player.id))) fail(`${player.name} has an inconsistent club membership`);
  return pack as unknown as DataPack;
}

/** A competition's groups: top-level groups partition its clubs, and each parent's groups partition the parent's clubs. */
function checkGroups(value: unknown, clubIds: readonly string[], name: string): void {
  if (!Array.isArray(value) || value.length < 2 || value.length > 64) fail(`${name} has invalid groups`);
  const groups = value as Record<string, unknown>[], ids = new Set<string>();
  for (const group of groups) {
    if (!isObject(group) || typeof group.id !== 'string' || !ID.test(group.id) || ids.has(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80 || !Array.isArray(group.clubIds) || group.clubIds.length < 1 || (group.parentId !== undefined && typeof group.parentId !== 'string')) fail(`${name} has an invalid group`);
    ids.add(group.id as string);
  }
  const partitions = (members: readonly Record<string, unknown>[], of: readonly string[]) => {
    const listed = members.flatMap(group => group.clubIds as string[]);
    return listed.length === of.length && new Set(listed).size === listed.length && listed.every(id => of.includes(id));
  };
  const top = groups.filter(group => group.parentId === undefined);
  if (top.length < 2 || !partitions(top, clubIds)) fail(`${name}'s groups must divide its clubs`);
  for (const group of groups) {
    if (group.parentId !== undefined && !top.some(parent => parent.id === group.parentId)) fail(`${name} has a group under an unknown parent`);
    const children = groups.filter(child => child.parentId === group.id);
    if (children.length && !partitions(children, group.clubIds as string[])) fail(`${name}'s groups must divide each parent's clubs`);
  }
}

/** The same position-weighted overall rating the player sees next to the stars. */
const overall = (player: DataPackPlayer) => overallRating(player.attributes, player.position);

/** Every imported member, with stable ordering/jersey collision handling shared with friendly selections. */
export function clubTeam(pack: DataPack, clubId: string): Team {
  const club = pack.clubs.find(club => club.id === clubId);
  if (!club) throw new Error('Choose a club from the loaded data pack.');
  return matchdayTeam(pack, clubId, club.playerIds.length);
}

/**
 * A club's matchday squad: its twelve best-rated players (those without any statistics last), with a starting five
 * covering the five positions where possible. Shirt numbers stay unless missing or repeated.
 */
export function matchdayTeam(pack: DataPack, clubId: string, size = MATCHDAY_SQUAD): Team {
  const club = pack.clubs.find(item => item.id === clubId);
  if (!club) throw new Error('Choose a club from the loaded data pack.');
  const byId = new Map(pack.players.map(player => [player.id, player]));
  const ranked = club.playerIds.map(id => byId.get(id)!).sort((a, b) => Number(a.estimated.includes('all-abilities')) - Number(b.estimated.includes('all-abilities')) || overall(b) - overall(a) || a.name.localeCompare(b.name));
  const chosen = ranked.slice(0, Math.min(size, ranked.length));
  const starters: DataPackPlayer[] = [];
  for (const position of POSITIONS) {
    const best = chosen.find(player => player.position === position && !starters.includes(player));
    if (best) starters.push(best);
  }
  for (const player of chosen) if (starters.length < 5 && !starters.includes(player)) starters.push(player);
  const ordered = [...starters, ...chosen.filter(player => !starters.includes(player))];
  const used = new Set<number>();
  const numbered = ordered.map(player => {
    let number = player.number !== null && player.number >= 0 && player.number <= 99 && !used.has(player.number) ? player.number : -1;
    if (number < 0) { number = 0; while (used.has(number)) number += 1; }
    used.add(number);
    return Object.freeze({ id: player.id, name: player.name, number, position: player.position, heightCm: player.heightCm, weightKg: player.weightKg, ...NEUTRAL_APPEARANCE, attributes: Object.freeze(withExtraAttributes({ id: player.id, position: player.position, heightCm: player.heightCm, attributes: { ...player.attributes }, age: player.age, minutes: player.ratingMinutes })) }) satisfies Player;
  });
  return Object.freeze({ id: club.id, name: club.name, shortName: club.shortName, color: club.color ?? NEUTRAL_CLUB_COLOR, players: Object.freeze(numbered) });
}

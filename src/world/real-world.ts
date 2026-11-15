import type { CareerWorld, EuropeanCompetition, EuropeanCompetitionKind } from '../domain/world';
import { EUROPEAN_FORMATS, fieldFits } from './european-formats';
import type { Team } from '../domain/types';
import type { ClubFinanceDefinition } from '../data/development-finances';
import type { DevelopmentPlayerProfile } from '../data/development-player-profiles';
import { playerAgeOnDate } from '../data/development-player-profiles';
import { standingsRuleFor } from '../domain/competition';
import { FULL_ROSTER_MODEL, MAX_CLUB_ROSTER_SIZE } from '../domain/roster';
import type { DevelopmentPresident } from '../data/development-presidents';
import { sponsorMarket } from '../data/development-sponsors';
import { DEVELOPMENT_WORLD } from '../data/development-world';
import { MIN_WORLD_CLUBS, validateWorld } from './career-world';
import { clubTeam, type DataPack, type DataPackCompetition } from './data-pack';
import { overallRating } from './overall-rating';
import { POSTSEASON_FORMATS, postseasonFormatAllowed, postseasonFormatFor } from './postseason';

/**
 * A career world from a private real-data pack: one domestic league's real clubs, squads, positions and ratings.
 * Wages, budgets, presidents and sponsors are fictional estimates. Researched birth dates are retained;
 * missing dates are estimated from ages. Derbies are left out rather than invented between real clubs.
 */
export const REAL_WORLD_RULES = Object.freeze({
  /** Players without a known age are assumed to be this old. */
  defaultAge: 26,
  /** Fictional season wages in euros: 9,000 plus 220 per overall-rating point above 40, in 500 steps, within 5,000-30,000. */
  wage: Object.freeze({ base: 9_000, perPoint: 220, from: 40, step: 500, min: 5_000, max: 30_000 }),
  /** Arena size and usual crowd follow squad strength within the league (no real capacities in the pack yet). */
  arena: Object.freeze({ smallest: 3_000, largest: 6_500, step: 100, fillFrom: 0.72, fillRange: 0.1 }),
  /**
   * Estimated seasons left on an opening contract (owner feedback, 15 November 2026; no real contract data exists in
   * the sources): 22 or younger 2-3, 23-29 1-3, 30-32 1-2, 33 or older 1, chosen by a stable per-player value. About
   * four in ten squads' contracts end after the first season instead of every one.
   */
  contractYears: (age: number, stable: number): number => {
    const choices = age <= 22 ? [2, 3, 3, 2] : age <= 29 ? [1, 2, 2, 3] : age <= 32 ? [1, 1, 2, 2] : [1, 1, 1, 1];
    return choices[stable % choices.length]!;
  },
});
const PRESIDENT_FIRST = ['Anna', 'Bernd', 'Clara', 'Dieter', 'Elena', 'Frank', 'Greta', 'Holger', 'Ines', 'Jürgen', 'Karin', 'Lukas', 'Monika', 'Norbert', 'Olga', 'Peter', 'Rita', 'Stefan', 'Tanja', 'Uwe'];
const PRESIDENT_LAST = ['Albrecht', 'Brandt', 'Conrad', 'Dorn', 'Engel', 'Falk', 'Gerber', 'Hahn', 'Imhof', 'Jansen', 'Kessler', 'Lorenz', 'Mertens', 'Nagel', 'Ostrow', 'Pohl', 'Quandt', 'Rieger', 'Seidel', 'Thiel'];

function hash(text: string): number { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; }
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Domestic leagues in the pack that a career can be played in (an even number of 4 to 40 clubs). */
export function careerCompetitions(pack: DataPack): DataPackCompetition[] {
  return pack.competitions.filter(item => item.kind === 'domestic' && item.clubIds.length >= MIN_WORLD_CLUBS && item.clubIds.length <= 20);
}

/** New worlds change prefix whenever they gain a rule: `real-tables-` (format 48), `real-playoffs-` (49), `real-tiebreak-` (51), `real-rules-` (52), `real-europe-` (56), `real-europlay-` (57), `real-bcl-` (59). */
export function realWorldId(pack: DataPack, competitionId: string): string {
  return `real-bcl-${pack.version.replace(/[^a-zA-Z0-9]+/g, '-')}-${competitionId}`.slice(0, 80);
}

/** The fictional season wage for a player of this overall rating, in euro cents. */
export function realWorldWage(overall: number): number {
  const rule = REAL_WORLD_RULES.wage;
  return clamp(Math.round((rule.base + (overall - rule.from) * rule.perPoint) / rule.step) * rule.step, rule.min, rule.max) * 100;
}

/** Recognises generated reserves retained in older careers; new worlds never add them. */
export const isGeneratedReserve = (playerId: string) => playerId.includes('-reserve-');

export function worldFromPack(pack: DataPack, competitionId: string | readonly string[]): CareerWorld {
  const ids = typeof competitionId === 'string' ? [competitionId] : [...competitionId];
  const competitions = careerCompetitions(pack).filter(item => ids.includes(item.id));
  if (!ids.length || new Set(ids).size !== ids.length || competitions.length !== ids.length) throw new Error('Choose supported domestic leagues from the loaded data pack.');
  const competition = competitions[0]!;
  const clubIds = competitions.flatMap(item => item.clubIds);
  if (new Set(clubIds).size !== clubIds.length) throw new Error('A club cannot enter two domestic leagues.');
  const byId = new Map(pack.players.map(player => [player.id, player]));
  const teams = clubIds.map(clubId => {
    const club = pack.clubs.find(club => club.id === clubId)!;
    if (club.playerIds.length < 8 || club.playerIds.length > MAX_CLUB_ROSTER_SIZE) throw new Error(`${club.name} needs 8–${MAX_CLUB_ROSTER_SIZE} imported players for this career. Check the roster data; no players have been added or discarded.`);
    return clubTeam(pack, clubId);
  });
  // Squad strength: the average overall rating of each club's best eight.
  const strength = new Map(teams.map(team => {
    const best = team.players.map(player => overallRating(player.attributes, player.position)).sort((a, b) => b - a).slice(0, 8);
    return [team.id, best.reduce((sum, value) => sum + value, 0) / best.length];
  }));
  const values = [...strength.values()], weakest = Math.min(...values), strongest = Math.max(...values);
  const share = (clubId: string) => strongest > weakest ? (strength.get(clubId)! - weakest) / (strongest - weakest) : 0.5;
  const market = sponsorMarket(teams.length);
  const { arena } = REAL_WORLD_RULES;
  const capitals = DEVELOPMENT_WORLD.presidents.map(president => president.seasonCapital);
  const presidents: DevelopmentPresident[] = teams.map((team, index) => {
    const h = hash(team.id);
    return { clubId: team.id, name: `${PRESIDENT_FIRST[h % PRESIDENT_FIRST.length]} ${PRESIDENT_LAST[Math.floor(h / PRESIDENT_FIRST.length) % PRESIDENT_LAST.length]}`, generosity: (1 + (h >>> 8) % 5) as DevelopmentPresident['generosity'], seasonCapital: capitals[index % capitals.length]! };
  });
  // Step 3.4b: each league's real postseason, when every chosen league's size fits its format (all or none).
  const formats = competitions.map(item => [item.id, postseasonFormatFor(item.country ?? 'Other', item.tier)] as const);
  const fits = formats.every(([id, format]) => format && postseasonFormatAllowed(format, competitions.find(item => item.id === id)!.country ?? 'Other', competitions.find(item => item.id === id)!.tier, competitions.find(item => item.id === id)!.clubIds.length))
    && competitions.every(item => !POSTSEASON_FORMATS[postseasonFormatFor(item.country ?? 'Other', item.tier) ?? 'top4-1'].series.some(spec => [spec.a, spec.b].some(ref => 'otherTier' in ref && ref.otherTier)) || competitions.some(other => other.country === item.country && other.tier !== item.tier));
  const postseasons = fits ? new Map(formats.map(([id, format]) => [id, format!])) : null;
  // Opening contracts (owner feedback, 15 November 2026): no source has real contract data, so lengths are estimated.
  // Young players tend to have longer deals and veterans shorter ones; a stable per-player choice spreads the expiries.
  const ageOf = (playerId: string) => byId.get(playerId)?.age ?? REAL_WORLD_RULES.defaultAge;
  const playerContracts = Object.fromEntries(teams.flatMap(team => team.players.map(player => [player.id, REAL_WORLD_RULES.contractYears(ageOf(player.id), hash(player.id))])));
  const profileOf = (playerId: string): DevelopmentPlayerProfile => ({ dateOfBirth: byId.get(playerId)?.birthDate ?? `${2026 - (byId.get(playerId)?.age ?? REAL_WORLD_RULES.defaultAge)}-01-01`, source: byId.get(playerId)?.birthDate ? 'official-profile' as const : 'estimated-from-age' as const,
    positionSource: byId.get(playerId)?.profileEvidence?.positionSource ?? (byId.get(playerId)?.estimated.includes('game_position') ? 'estimated' as const : 'unverified' as const) });
  const world: CareerWorld = {
    id: realWorldId(pack, competitions.length === 1 ? competition.id : `leagues-${hash(competitions.map(item => item.id).sort().join('|')).toString(16)}`), name: competitions.length === 1 ? `${competition.name} ${competition.season}` : `European domestic leagues ${competition.season}`, source: 'real-data-pack', rosterModel: FULL_ROSTER_MODEL, startDate: DEVELOPMENT_WORLD.startDate,
    domesticLeagues: competitions.map(item => ({ id: item.id, name: item.name, country: item.country ?? 'Other', tier: item.tier, clubIds: [...item.clubIds], standingsRule: standingsRuleFor(item.country ?? 'Other', item.tier), ...(postseasons ? { postseason: postseasons.get(item.id)! } : {}) })),
    clubs: teams,
    playerProfiles: Object.fromEntries(teams.flatMap(team => team.players.map(player => [player.id, profileOf(player.id)]))),
    playerContracts,
    wages: Object.fromEntries(teams.flatMap(team => team.players.map(player => [player.id, realWorldWage(overallRating(player.attributes, player.position))]))),
    finances: teams.map((team, index) => {
      const club = pack.clubs.find(item => item.id === team.id)!, t = share(team.id);
      const capacity = Math.round((arena.smallest + t * (arena.largest - arena.smallest)) / arena.step) * arena.step;
      return { clubId: team.id, venue: club.arena ?? `${team.name} Arena`, sponsor: market[index]!.name, capacity, referenceDemand: Math.round(capacity * (arena.fillFrom + arena.fillRange * t) / arena.step) * arena.step };
    }),
    presidents,
    sponsors: [...market],
    rivalries: [],
  };
  validateWorld(world);
  // Step 3.5a: the season's European competitions (each kind once, a club in one competition) and their entrants.
  const seen = new Set<string>(), kinds = new Set<string>();
  const european: EuropeanCompetition[] = pack.competitions.filter(item => item.kind === 'european' && item.season === competition.season).flatMap(item => {
    const kind = europeanKind(item.name);
    if (!kind || kinds.has(kind)) return [];
    kinds.add(kind);
    const listed = [...new Set(item.clubIds)].filter(clubId => !seen.has(clubId) && (clubIds.includes(clubId) || (pack.clubs.find(club => club.id === clubId)?.playerIds.length ?? 0) >= 8));
    // Steps 3.5b-d (formats 57-58): a competition is played in its real format when its field fits. A field larger than
    // the format (or not dividing into its groups) keeps the chosen leagues' clubs and the strongest others, in listed order.
    const format = Object.values(EUROPEAN_FORMATS).find(entry => entry.kind === kind && listed.length >= entry.clubs.min);
    const size = format ? Array.from({ length: Math.min(listed.length, format.clubs.max) }, (_, index) => Math.min(listed.length, format.clubs.max) - index).find(count => fieldFits(format, count)) : undefined;
    const strength = (clubId: string) => clubIds.includes(clubId) ? Infinity : bestEightStrength(clubTeam(pack, clubId).players);
    const kept = size === undefined ? listed : new Set([...listed].sort((a, b) => strength(b) - strength(a) || listed.indexOf(a) - listed.indexOf(b)).slice(0, size));
    const entrantIds = size === undefined ? listed : listed.filter(clubId => (kept as Set<string>).has(clubId));
    entrantIds.forEach(clubId => seen.add(clubId));
    // Format 59: the BCL's protected draw needs each entrant's country (a league club's league country; the pack's otherwise, or the club itself when unknown).
    const countries = size !== undefined && format!.staged ? { countries: Object.fromEntries(entrantIds.map(clubId => [clubId, world.domesticLeagues!.find(league => league.clubIds.includes(clubId))?.country ?? pack.clubs.find(club => club.id === clubId)?.country ?? `unknown-${clubId}`])) } : {};
    return entrantIds.length >= 2 ? [{ id: item.id, name: item.name, kind, season: item.season, clubIds: entrantIds, ...(size !== undefined ? { format: format!.id } : {}), ...countries }] : [];
  });
  if (!european.length) return world;
  const entrants = [...seen].filter(clubId => !clubIds.includes(clubId)).map(clubId => {
    const team = clubTeam(pack, clubId);
    return { team, venue: pack.clubs.find(club => club.id === clubId)!.arena, profiles: Object.fromEntries(team.players.map(player => [player.id, profileOf(player.id)])) };
  });
  return withEuropeanCompetitions(world, european, entrants);
}

/**
 * European competitions (step 3.5a). A world carries the three competitions and their entrants for the opening season.
 * Entrants that play in none of the world's domestic leagues (leagues not chosen, countries outside the six) are clubs of
 * the world outside the full world: background clubs with their real squads, colours and arena. Like next-division clubs
 * they get estimated wages, contract lengths, venue figures and a president so the world stays complete, but no system
 * runs for them; their players cannot be signed in sprint 3.
 */
export interface EuropeanEntrant {
  team: Team;
  /** Every player's date of birth and its source. */
  profiles: Record<string, DevelopmentPlayerProfile>;
  /** The club's arena when the data knows it. */
  venue?: string | null;
}

/** The competition kind from a provider's competition name (EuroLeague, EuroCup, Basketball Champions League). */
export function europeanKind(name: string): EuropeanCompetitionKind | null {
  return /euro\s*league/i.test(name) ? 'euroleague' : /euro\s*cup/i.test(name) ? 'eurocup' : /champions/i.test(name) ? 'bcl' : null;
}

/** The average position-weighted overall rating of a squad's best eight (as in career setup). */
const bestEightStrength = (players: readonly Team['players'][number][]) => { const best = players.map(player => overallRating(player.attributes, player.position)).sort((a, b) => b - a).slice(0, 8); return best.reduce((sum, value) => sum + value, 0) / best.length; };
const FIRST = ['Aldo', 'Berta', 'Ciro', 'Dora', 'Emil', 'Flora', 'Gino', 'Hanna', 'Ivan', 'Jana', 'Karl', 'Lena', 'Mario', 'Nora', 'Oscar', 'Petra'];
const LAST = ['Arnold', 'Bianchi', 'Costa', 'Dumas', 'Eriksen', 'Fischer', 'Garcia', 'Horvat', 'Ivanov', 'Jansen', 'Kovac', 'Lindqvist', 'Moreau', 'Novak', 'Olsen', 'Petrov'];

/** A world with its European competitions; European-only entrants are added outside the full world. */
export function withEuropeanCompetitions(world: CareerWorld, competitions: readonly EuropeanCompetition[], entrants: readonly EuropeanEntrant[]): CareerWorld {
  if (world.europeanCompetitions?.length) throw new Error('This world already has its European competitions.');
  const known = new Set(world.clubs.map(club => club.id));
  const added = entrants.filter(entrant => !known.has(entrant.team.id));
  // Venue figures follow squad strength within the domestic clubs' range, as for real-club worlds.
  const strengths = world.clubs.map(club => bestEightStrength(club.players)), weakest = Math.min(...strengths), strongest = Math.max(...strengths);
  const { arena } = REAL_WORLD_RULES;
  const capital = Math.min(...world.presidents.map(president => president.seasonCapital));
  const finances: ClubFinanceDefinition[] = [], presidents: DevelopmentPresident[] = [];
  const profiles: Record<string, DevelopmentPlayerProfile> = {}, wages: Record<string, number> = {}, contracts: Record<string, number> = {};
  for (const { team, profiles: own, venue } of added) {
    const t = strongest > weakest ? Math.max(0, Math.min(1, (bestEightStrength(team.players) - weakest) / (strongest - weakest))) : 0.5;
    const capacity = Math.round((arena.smallest + t * (arena.largest - arena.smallest)) / arena.step) * arena.step, h = hash(team.id);
    finances.push({ clubId: team.id, venue: venue ?? `${team.name} Arena`, sponsor: world.sponsors[h % world.sponsors.length]!.name, capacity, referenceDemand: Math.round(capacity * (arena.fillFrom + arena.fillRange * t) / arena.step) * arena.step });
    presidents.push({ clubId: team.id, name: `${FIRST[(h >>> 4) % FIRST.length]} ${LAST[(h >>> 12) % LAST.length]}`, generosity: (1 + (h >>> 20) % 5) as DevelopmentPresident['generosity'], seasonCapital: capital });
    for (const player of team.players) {
      profiles[player.id] = own[player.id]!;
      wages[player.id] = realWorldWage(overallRating(player.attributes, player.position));
      contracts[player.id] = REAL_WORLD_RULES.contractYears(playerAgeOnDate(own[player.id]!.dateOfBirth, world.startDate) ?? REAL_WORLD_RULES.defaultAge, hash(player.id));
    }
  }
  const next: CareerWorld = {
    ...world, clubs: [...world.clubs, ...added.map(entrant => entrant.team)], playerProfiles: { ...world.playerProfiles, ...profiles }, wages: { ...world.wages, ...wages },
    ...(world.playerContracts ? { playerContracts: { ...world.playerContracts, ...contracts } } : {}),
    finances: [...world.finances, ...finances], presidents: [...world.presidents, ...presidents], europeanCompetitions: competitions.map(item => ({ ...item, clubIds: [...item.clubIds] })),
  };
  validateWorld(next);
  return next;
}

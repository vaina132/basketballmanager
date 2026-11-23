import type { BackgroundLeague, CareerWorld, EuropeanCompetition, EuropeanCompetitionKind, NbaConference } from '../domain/world';
import { EUROPEAN_FORMATS, fieldFits } from './european-formats';
import type { Team } from '../domain/types';
import type { ClubFinanceDefinition } from '../data/development-finances';
import type { DevelopmentPlayerProfile } from '../data/development-player-profiles';
import { DEFAULT_PLAYER_AGE, playerAgeOnDate } from '../data/development-player-profiles';
import { standingsRuleFor } from '../domain/competition';
import { FULL_ROSTER_MODEL, MAX_CLUB_ROSTER_SIZE } from '../domain/roster';
import type { DevelopmentPresident } from '../data/development-presidents';
import { derivePresidentTraits } from './presidents';
import { presidentName } from '../data/people-names';
import { realClubPerson } from '../data/real-club-people';
import { sponsorMarket } from '../data/development-sponsors';
import { DEVELOPMENT_WORLD } from '../data/development-world';
import { MIN_WORLD_CLUBS, validateWorld } from './career-world';
import { clubTeam, type DataPack, type DataPackCompetition } from './data-pack';
import { withFairRatings } from './rating-fairness';
import { LOWER_DIVISIONS_2026 } from '../data/lower-divisions-2026';
import { withLowerDivisions } from './lower-division';
import { NO_LOWER_DIVISION_COUNTRIES } from './career-world';
import { overallRating } from './overall-rating';
import { POSTSEASON_FORMATS, postseasonFormatAllowed, postseasonFormatFor } from './postseason';
import { withRealEconomy } from './economy';

/**
 * A career world from a private real-data pack: one domestic league's real clubs, squads, positions and ratings.
 * Since format 62 its wages, budgets, arenas and ticket prices follow researched 2025-27 club budgets (`withRealEconomy`
 * in `./economy`); presidents and sponsors are fictional. Researched birth dates are retained; missing dates are
 * estimated from ages. Derbies are left out rather than invented between real clubs.
 */
export const REAL_WORLD_RULES = Object.freeze({
  /** Players without a known age are assumed to be this old. */
  defaultAge: DEFAULT_PLAYER_AGE,
  /**
   * The development-scale season wage in euros (9,000 plus 220 per overall-rating point above 40, in 500 steps, within
   * 5,000-30,000), used by worlds built without an economy (`withLowerDivisions` and `withEuropeanCompetitions` on their
   * own); `worldFromPack` replaces every wage with the economy's.
   */
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

export type ContractLevel = 'euroleague' | 'top' | 'second';
/**
 * Opening contract lengths of new real-club worlds (sprint 4, 15 November 2026), replacing `contractYears` there.
 * Free sources list real contract ends only for EuroLeague clubs (BasketNews and Eurohoops trackers; importing them is
 * the owner's decision), so lengths stay estimates calibrated on published figures:
 * - EuroLeague contracts running in November 2026 end after 1 season for 45%, 2 for 39%, 3 or more for 16%
 *   (BasketNews tracker, 272 players); among new 2026 deals, two-thirds of players aged 33 or older signed for one
 *   season and players aged 22 or younger for about three (Eurohoops index, 160 deals);
 * - domestic top divisions keep only 27-42% of their players a year later (FIBA/CIES migration report 2025), so most
 *   deals there are short, and second divisions shorter still (estimate);
 * - US imports outside the EuroLeague mostly sign for one season (lowest retention in the same report).
 * Shares are percentages of one, two and three seasons in 5% steps, chosen by a stable per-player value; four-year
 * deals count as three, the game's limit. `contractYears` stays for generated next-division squads and joining clubs,
 * so careers already saved replay unchanged.
 */
export const OPENING_CONTRACT_SHARES: Readonly<Record<ContractLevel, readonly (readonly [maxAge: number, shares: readonly [number, number, number]])[]>> = Object.freeze({
  euroleague: [[22, [15, 35, 50]], [29, [45, 40, 15]], [32, [50, 35, 15]], [Infinity, [65, 35, 0]]],
  top: [[22, [35, 40, 25]], [29, [60, 30, 10]], [32, [65, 30, 5]], [Infinity, [80, 20, 0]]],
  second: [[22, [55, 35, 10]], [29, [75, 20, 5]], [Infinity, [85, 15, 0]]],
});
const US_IMPORT_SHARES = [80, 20, 0] as const;

export function openingContractYears(age: number, stable: number, level: ContractLevel, nationality?: string | null): number {
  const shares = level !== 'euroleague' && nationality === 'USA' && age > 22 ? US_IMPORT_SHARES : OPENING_CONTRACT_SHARES[level].find(([maxAge]) => age <= maxAge)![1];
  const slot = (stable % 20) * 5;
  return slot < shares[0] ? 1 : slot < shares[0] + shares[1] ? 2 : 3;
}

function hash(text: string): number { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; }
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * NBA step 5: the NBA is offered in the career setup like any other league. A pack without a USA league (every pack
 * published before the NBA data) simply offers none.
 */
export const NBA_PLAYABLE = true;
/** NBA step 4: the pack's NBA (the USA's 30-club league with its conferences and divisions). */
export const isNbaCompetition = (item: Pick<DataPackCompetition, 'kind' | 'country' | 'clubIds'>): boolean => item.kind === 'domestic' && item.country === 'USA' && item.clubIds.length === NBA_CLUBS;
export const NBA_CLUBS = 30;

/** Domestic leagues in the pack that a career can be played in (4 to 20 clubs; the NBA's 30 when `nba` is on). */
export function careerCompetitions(pack: DataPack, options: { nba?: boolean } = { nba: NBA_PLAYABLE }): DataPackCompetition[] {
  return pack.competitions.filter(item => item.kind === 'domestic' && (item.clubIds.length >= MIN_WORLD_CLUBS && item.clubIds.length <= 20 && item.country !== 'USA' || !!options.nba && isNbaCompetition(item) && !!nbaConferences(item)));
}

/**
 * NBA step 4: the NBA's two conferences and their six divisions from the pack's groups (conferences without a parent,
 * divisions under them), or null when the pack does not give them in that shape (two conferences of three divisions).
 */
export function nbaConferences(item: Pick<DataPackCompetition, 'groups' | 'clubIds'>): NbaConference[] | null {
  const groups = item.groups ?? [];
  const conferences = groups.filter(group => group.parentId === undefined);
  if (conferences.length !== 2) return null;
  const built = conferences.map(conference => ({ id: conference.id, name: conference.name, divisions: groups.filter(group => group.parentId === conference.id).map(division => ({ id: division.id, name: division.name, clubIds: [...division.clubIds] })) }));
  return built.every(conference => conference.divisions.length === 3 && conference.divisions.every(division => division.clubIds.length === 5)) ? built : null;
}

/** New worlds change prefix whenever they gain a rule: `real-tables-` (format 48), `real-playoffs-` (49), `real-tiebreak-` (51), `real-rules-` (52), `real-europe-` (56), `real-europlay-` (57), `real-bcl-` (59), `real-places-` (60), `real-economy-` (62). */
export function realWorldId(pack: DataPack, competitionId: string): string {
  return `real-economy-${pack.version.replace(/[^a-zA-Z0-9]+/g, '-')}-${competitionId}`.slice(0, 80);
}

/** The fictional season wage for a player of this overall rating, in euro cents. */
export function realWorldWage(overall: number): number {
  const rule = REAL_WORLD_RULES.wage;
  return clamp(Math.round((rule.base + (overall - rule.from) * rule.perPoint) / rule.step) * rule.step, rule.min, rule.max) * 100;
}

/** Recognises generated reserves retained in older careers; new worlds never add them. */
export const isGeneratedReserve = (playerId: string) => playerId.includes('-reserve-');

export function worldFromPack(original: DataPack, competitionId: string | readonly string[]): CareerWorld {
  // Sprint 4: ratings resting on few minutes are pulled towards their club's level.
  const pack = withFairRatings(original);
  const ids = typeof competitionId === 'string' ? [competitionId] : [...competitionId];
  const competitions = careerCompetitions(pack, { nba: true }).filter(item => ids.includes(item.id));
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
  // Owner feedback (18 November 2026): the club's real president where Wikipedia lists one, else a name mostly from the club's country.
  const leagueCountry = new Map(competitions.flatMap(item => item.clubIds.map(clubId => [clubId, item.country ?? null] as const)));
  const presidentNames = new Set(teams.flatMap(team => realClubPerson(team.id, 'president')?.name ?? []));
  const presidents: DevelopmentPresident[] = teams.map((team, index) => {
    const h = hash(team.id);
    return { clubId: team.id, name: realClubPerson(team.id, 'president')?.name ?? presidentName(team.id, leagueCountry.get(team.id) ?? null, presidentNames), generosity: (1 + (h >>> 8) % 5) as DevelopmentPresident['generosity'], seasonCapital: capitals[index % capitals.length]!, traits: derivePresidentTraits(team.id) };
  });
  // Step 3.4b: each league's real postseason, when every chosen league's size fits its format (all or none).
  const formats = competitions.map(item => [item.id, postseasonFormatFor(item.country ?? 'Other', item.tier)] as const);
  const fits = formats.every(([id, format]) => format && postseasonFormatAllowed(format, competitions.find(item => item.id === id)!.country ?? 'Other', competitions.find(item => item.id === id)!.tier, competitions.find(item => item.id === id)!.clubIds.length))
    && competitions.every(item => !POSTSEASON_FORMATS[postseasonFormatFor(item.country ?? 'Other', item.tier) ?? 'top4-1'].series.some(spec => [spec.a, spec.b].some(ref => 'otherTier' in ref && ref.otherTier)) || competitions.some(other => other.country === item.country && other.tier !== item.tier));
  const postseasons = fits ? new Map(formats.map(([id, format]) => [id, format!])) : null;
  // Opening contracts (owner feedback, 15 November 2026): no source has real contract data, so lengths are estimated.
  // Young players tend to have longer deals and veterans shorter ones; a stable per-player choice spreads the expiries.
  const ageOf = (playerId: string) => byId.get(playerId)?.age ?? REAL_WORLD_RULES.defaultAge;
  // Sprint 4: lengths by level (EuroLeague, top or second division), age and US import status.
  // NBA step 4: NBA deals are long (estimates on the EuroLeague's shares).
  const nbaLeague = competitions.find(isNbaCompetition);
  const euroleagueClubs = new Set(nbaLeague?.clubIds ?? []);
  for (const clubId of pack.competitions.filter(item => item.kind === 'european' && item.season === competition.season && europeanKind(item.name) === 'euroleague').flatMap(item => item.clubIds)) euroleagueClubs.add(clubId);
  const tierOf = new Map(competitions.flatMap(item => item.clubIds.map(clubId => [clubId, item.tier] as const)));
  const levelOf = (clubId: string): ContractLevel => euroleagueClubs.has(clubId) ? 'euroleague' : (tierOf.get(clubId) ?? 1) >= 2 ? 'second' : 'top';
  const playerContracts = Object.fromEntries(teams.flatMap(team => team.players.map(player => [player.id, openingContractYears(ageOf(player.id), hash(player.id), levelOf(team.id), byId.get(player.id)?.nationality)])));
  const profileOf = (playerId: string): DevelopmentPlayerProfile => ({ dateOfBirth: byId.get(playerId)?.birthDate ?? `${2026 - (byId.get(playerId)?.age ?? REAL_WORLD_RULES.defaultAge)}-01-01`, source: byId.get(playerId)?.birthDate ? 'official-profile' as const : 'estimated-from-age' as const,
    positionSource: byId.get(playerId)?.profileEvidence?.positionSource ?? (byId.get(playerId)?.estimated.includes('game_position') ? 'estimated' as const : 'unverified' as const),
    ...(byId.get(playerId)?.nationality ? { nationality: byId.get(playerId)!.nationality! } : {}) });
  const domesticWorld: CareerWorld = {
    id: realWorldId(pack, competitions.length === 1 ? competition.id : `leagues-${hash(competitions.map(item => item.id).sort().join('|')).toString(16)}`), name: competitions.length === 1 ? `${competition.name} ${competition.season}` : nbaLeague ? `NBA and European leagues ${competition.season}` : `European domestic leagues ${competition.season}`, source: 'real-data-pack', rosterModel: FULL_ROSTER_MODEL, startDate: DEVELOPMENT_WORLD.startDate,
    domesticLeagues: competitions.map(item => ({ id: item.id, name: item.name, country: item.country ?? 'Other', tier: item.tier, clubIds: [...item.clubIds], standingsRule: standingsRuleFor(item.country ?? 'Other', item.tier), ...(postseasons ? { postseason: postseasons.get(item.id)! } : {}) })),
    clubs: teams,
    playerProfiles: Object.fromEntries(teams.flatMap(team => team.players.map(player => [player.id, profileOf(player.id)]))),
    playerContracts,
    wages: Object.fromEntries(teams.flatMap(team => team.players.map(player => [player.id, realWorldWage(overallRating(player.attributes, player.position))]))),
    finances: teams.map((team, index) => {
      const club = pack.clubs.find(item => item.id === team.id)!, t = share(team.id);
      const capacity = nbaLeague?.clubIds.includes(team.id) && club.capacity ? club.capacity : Math.round((arena.smallest + t * (arena.largest - arena.smallest)) / arena.step) * arena.step;
      return { clubId: team.id, venue: club.arena ?? `${team.name} Arena`, sponsor: market[index]!.name, capacity, referenceDemand: Math.round(capacity * (arena.fillFrom + arena.fillRange * t) / arena.step) * arena.step };
    }),
    presidents,
    sponsors: [...market],
    rivalries: [],
    ...(nbaLeague ? { nba: { model: 'nba-1' as const, leagueId: nbaLeague.id, conferences: nbaConferences(nbaLeague)!, ruleset: 'nba-2026' as const, cap: 'nba-cap-1' as const, draft: 'nba-draft-1' as const } } : {}),
  };
  validateWorld(domesticWorld);
  // Step 3.4d-4: each chosen country's real next division (researched names, generated squads), never Italy or France.
  const lowerLists = LOWER_DIVISIONS_2026.flatMap(list => {
    const own = domesticWorld.domesticLeagues!.filter(league => league.country === list.country);
    if (!own.length || NO_LOWER_DIVISION_COUNTRIES.includes(list.country) || list.tier !== Math.max(...own.map(league => league.tier)) + 1) return [];
    const slug = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return [{ country: list.country, tier: list.tier, name: list.name, clubs: list.clubs.map(item => ({ id: `lower-${slug(list.country)}-${slug(item.name)}`.slice(0, 80), name: item.name, shortName: item.shortName, color: item.color ?? LOWER_DIVISION_COLOUR })) }];
  });
  const world = lowerLists.length ? withLowerDivisions(domesticWorld, lowerLists) : domesticWorld;
  // Format 62 (sprint 4): every club's money follows researched club budgets, once the world has all its clubs.
  const priced = (complete: CareerWorld) => { const next = withRealEconomy(complete, clubId => pack.clubs.find(club => club.id === clubId)?.country ?? null, clubId => pack.clubs.find(club => club.id === clubId)?.capacity ?? null); validateWorld(next); return next; };
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
  // NBA: a world of the NBA alone has no European competitions (they belong to the European countries' clubs).
  if (!european.length || world.domesticLeagues!.every(league => league.country === 'USA')) return priced(world);
  // Step 3.5f (format 60): when a competition is played, the unchosen countries' top divisions join the world for their
  // estimated tables, every played competition gives its entrants' countries and the EuroLeague its one-year places.
  const played = european.some(item => item.format);
  const chosenCountries = new Set(competitions.map(item => item.country));
  // Only leagues the game can play as a background league become unchosen top divisions: the NBA (30 clubs,
  // docs/nba-plan.md) is never a background league in European worlds; it is chosen like any league instead.
  const playable = new Set(careerCompetitions(pack).map(item => item.id));
  const backgroundLeagues: BackgroundLeague[] = played ? pack.competitions.filter(item => item.kind === 'domestic' && item.tier === 1 && playable.has(item.id) && item.season === competition.season && item.country && !chosenCountries.has(item.country) && item.country !== 'USA').flatMap(item => {
    const members = [...new Set(item.clubIds)].filter(clubId => !clubIds.includes(clubId) && (pack.clubs.find(club => club.id === clubId)?.playerIds.length ?? 0) >= 8);
    return members.length >= 2 ? [{ id: item.id, name: item.name, country: item.country!, tier: 1 as const, clubIds: members }] : [];
  }) : [];
  const countryOf = (clubId: string) => world.domesticLeagues!.find(league => league.clubIds.includes(clubId))?.country ?? backgroundLeagues.find(league => league.clubIds.includes(clubId))?.country ?? pack.clubs.find(club => club.id === clubId)?.country ?? `unknown-${clubId}`;
  const plain = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const placed = played ? european.map(item => item.format ? { ...item, countries: Object.fromEntries(item.clubIds.map(clubId => [clubId, countryOf(clubId)])), ...(item.kind === 'euroleague' ? { oneYear: item.clubIds.filter(clubId => ONE_YEAR_EUROLEAGUE_2026.some(name => plain(pack.clubs.find(club => club.id === clubId)?.name ?? '').includes(name))) } : {}) } : item) : european;
  const built = new Set([...seen].filter(clubId => !clubIds.includes(clubId)));
  for (const league of backgroundLeagues) for (const clubId of league.clubIds) built.add(clubId);
  const entrants = [...built].map(clubId => {
    const team = clubTeam(pack, clubId);
    return { team, venue: pack.clubs.find(club => club.id === clubId)!.arena, profiles: Object.fromEntries(team.players.map(player => [player.id, profileOf(player.id)])) };
  });
  return priced(withEuropeanCompetitions(world, placed, entrants, played ? { backgroundLeagues } : undefined));
}

/** Next-division clubs without a known colour. */
const LOWER_DIVISION_COLOUR = '#6B7280';

/** The EuroLeague's one-year places in 2026-27 (research of 15 November 2026): the wildcards Paris and Beşiktaş and the EuroCup route's Hapoel Tel Aviv. */
export const ONE_YEAR_EUROLEAGUE_2026: readonly string[] = ['paris', 'besiktas', 'hapoel tel aviv'];

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

/** A world with its European competitions; European-only entrants are added outside the full world. */
/** With `places` (format 60), the world records European places and the unchosen top divisions, whose clubs are among `entrants`. */
export function withEuropeanCompetitions(world: CareerWorld, competitions: readonly EuropeanCompetition[], entrants: readonly EuropeanEntrant[], places?: { backgroundLeagues: readonly BackgroundLeague[] }): CareerWorld {
  if (world.europeanCompetitions?.length) throw new Error('This world already has its European competitions.');
  const known = new Set(world.clubs.map(club => club.id));
  const added = entrants.filter(entrant => !known.has(entrant.team.id));
  // Venue figures follow squad strength within the domestic clubs' range, as for real-club worlds.
  const strengths = world.clubs.map(club => bestEightStrength(club.players)), weakest = Math.min(...strengths), strongest = Math.max(...strengths);
  const { arena } = REAL_WORLD_RULES;
  const capital = Math.min(...world.presidents.map(president => president.seasonCapital));
  const finances: ClubFinanceDefinition[] = [], presidents: DevelopmentPresident[] = [];
  const presidentNames = new Set(world.presidents.map(president => president.name));
  const entrantCountry = (clubId: string) => competitions.find(item => item.countries && Object.hasOwn(item.countries, clubId))?.countries?.[clubId] ?? null;
  const profiles: Record<string, DevelopmentPlayerProfile> = {}, wages: Record<string, number> = {}, contracts: Record<string, number> = {};
  const euroleague = new Set(competitions.filter(item => item.kind === 'euroleague').flatMap(item => item.clubIds));
  for (const { team, profiles: own, venue } of added) {
    const t = strongest > weakest ? Math.max(0, Math.min(1, (bestEightStrength(team.players) - weakest) / (strongest - weakest))) : 0.5;
    const capacity = Math.round((arena.smallest + t * (arena.largest - arena.smallest)) / arena.step) * arena.step, h = hash(team.id);
    finances.push({ clubId: team.id, venue: venue ?? `${team.name} Arena`, sponsor: world.sponsors[h % world.sponsors.length]!.name, capacity, referenceDemand: Math.round(capacity * (arena.fillFrom + arena.fillRange * t) / arena.step) * arena.step });
    presidents.push({ clubId: team.id, name: presidentName(team.id, entrantCountry(team.id), presidentNames), generosity: (1 + (h >>> 20) % 5) as DevelopmentPresident['generosity'], seasonCapital: capital, traits: derivePresidentTraits(team.id) });
    for (const player of team.players) {
      profiles[player.id] = own[player.id]!;
      wages[player.id] = realWorldWage(overallRating(player.attributes, player.position));
      contracts[player.id] = openingContractYears(playerAgeOnDate(own[player.id]!.dateOfBirth, world.startDate) ?? REAL_WORLD_RULES.defaultAge, hash(player.id), euroleague.has(team.id) ? 'euroleague' : 'top');
    }
  }
  const next: CareerWorld = {
    ...world, clubs: [...world.clubs, ...added.map(entrant => entrant.team)], playerProfiles: { ...world.playerProfiles, ...profiles }, wages: { ...world.wages, ...wages },
    ...(world.playerContracts ? { playerContracts: { ...world.playerContracts, ...contracts } } : {}),
    finances: [...world.finances, ...finances], presidents: [...world.presidents, ...presidents], europeanCompetitions: competitions.map(item => ({ ...item, clubIds: [...item.clubIds] })),
    ...(places ? { europeanPlaces: 'places-2026-1' as const, ...(places.backgroundLeagues.length ? { backgroundLeagues: places.backgroundLeagues.map(league => ({ ...league, clubIds: [...league.clubIds] })) } : {}) } : {}),
  };
  validateWorld(next);
  return next;
}

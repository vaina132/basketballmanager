import type { ManagerEarnings, NationalPayment, NationalCoach, NationalCompetition, NationalFixture, NationalGroup, NationalOffer, NationalResult, NationalTeamInfo, NationalVerdict, SeasonNational } from '../domain/national';
import type { SeasonInjury, SeasonState } from '../domain/season';
import type { MatchState, Player, Position, Side, Team } from '../domain/types';
import type { CareerWorld } from '../domain/world';
import { NATIONAL_TEAMS, NATIONALITY_ALIASES, QUALIFIER_GROUPS_2026, nationalPersonName } from '../data/national-teams';
import { createFixtureMatch, simulateToEnd } from '../engine/match';
import { legacyNationalTournamentName, NATIONAL_RULES, nationalAwayDays, nationalTournamentDays, nationalTournamentName, nationalWindowDays, nationalWindowSaturday } from './national-calendar';
import { addCalendarDays } from './competition-calendar';
import { isNbaClub, worldOf } from './career-world';
import { createSeasonInjury, injuryRiskMap, isRecovering } from './health';
import { medicalRecoveryPercent } from './facilities-policy';
import { overallRating } from './overall-rating';
import { developClub } from './training';
import { managerReputation } from './career-policy';
import { isUnemployed } from './career-rules';
import { coachPlaces, coachWorld, headCoach } from './head-coaches';

/**
 * Format 80 (owner feedback item 13, 22 November 2026): national teams, their competitions and coaches, and national
 * jobs for the manager. New real-club careers whose leagues include one of the national teams' countries. Every
 * season: qualifier groups of six with a November and a February window (two games each), then a summer tournament
 * of the twelve qualifiers. Season one's groups are the real second-round groups of the 2027 World Cup European
 * Qualifiers; the game plays their last two windows and its table starts at zero (the earlier windows are not carried).
 */
export const NATIONAL_MODEL = 'national-1' as const;

/** Whether a world gets national teams: a real-club world with leagues in at least one national team's country. */
export function usesNationalTeams(world: CareerWorld): boolean {
  return world.source === 'real-data-pack' && !!world.domesticLeagues?.some(league => NATIONAL_TEAMS.some(team => team.country === league.country));
}

export const nationalTeam = (national: Pick<SeasonNational, 'teams'>, teamId: string): NationalTeamInfo => {
  const team = national.teams.find(item => item.id === teamId);
  if (!team) throw new Error('This national team is not in the game.');
  return team;
};

/** FNV-1a of a text, mixed with the career seed: names, draws and seeds never use match randomness. */
export function nationalHash(seed: number, text: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  return hash;
}

/** A new generated head coach for a team: the next name of the team's country. */
export function generatedCoach(national: Pick<SeasonNational, 'teams' | 'coachCount'>, teamId: string, seasonNumber: number, date: string): { coach: NationalCoach; coachCount: number } {
  const team = nationalTeam(national, teamId);
  return { coach: { teamId, name: nationalPersonName(team.country, national.coachCount), since: { seasonNumber, date }, confidence: NATIONAL_RULES.startingConfidence }, coachCount: national.coachCount + 1 };
}

/**
 * Format 82: the coach a federation appoints. With real head coaches, the free agent of the team's country with the
 * best reputation who coaches no other national team (a free agent from abroad when none is from the country); else
 * a generated coach, as before.
 */
export function replacementCoach(state: Pick<SeasonState, 'coaches' | 'board' | 'seasonNumber' | 'world' | 'dataPackId'>, national: Pick<SeasonNational, 'teams' | 'coachCount' | 'coaches'>, teamId: string, seasonNumber: number, date: string): { coach: NationalCoach; coachCount: number } {
  if (state.coaches) {
    const team = nationalTeam(national, teamId), names = new Set(national.coaches.filter(coach => coach.teamId !== teamId).map(coach => coach.name));
    const free = coachPlaces({ ...state, seasonNumber }).free.map(id => headCoach({ ...state, seasonNumber }, id)!).filter(coach => !names.has(coach.name));
    const best = (list: typeof free) => [...list].sort((a, b) => b.reputation - a.reputation || (a.id < b.id ? -1 : 1))[0];
    const chosen = best(free.filter(coach => coach.nationality === team.country)) ?? best(free);
    if (chosen) return { coach: { teamId, name: chosen.name, since: { seasonNumber, date }, confidence: NATIONAL_RULES.startingConfidence }, coachCount: national.coachCount };
  }
  return generatedCoach(national, teamId, seasonNumber, date);
}

/** Format 82: the national teams' real head coaches replace the generated names at a career's start (unknown ones stay generated). */
export function withRealNationalCoaches(national: SeasonNational, world: CareerWorld): SeasonNational {
  const real = coachWorld(world).national;
  return { ...national, coaches: national.coaches.map(coach => { const id = real.get(coach.teamId); return id && !coach.manager ? { ...coach, name: coachWorld(world).coaches.get(id)!.name } : coach; }) };
}

/** Format 82: the person behind a national coach entry (a real or market coach of this career), when there is one. */
export function nationalCoachPerson(state: Pick<SeasonState, 'coaches' | 'world' | 'dataPackId' | 'seasonNumber' | 'national'>, teamId: string): string | null {
  if (!state.coaches || !state.national) return null;
  const entry = state.national.coaches.find(coach => coach.teamId === teamId);
  if (!entry || entry.manager) return null;
  for (const [id, coach] of coachWorld(worldOf(state)).coaches) if (coach.name === entry.name) return id;
  return null;
}

/**
 * A group's games in a season: four rounds of the circle method over its six teams, two in each window. Each team plays
 * four of its five rivals once (the game's own draw), home or away by the circle's rule.
 */
export function groupFixtures(competitionId: string, group: NationalGroup, seasonNumber: number): NationalFixture[] {
  const fixtures: NationalFixture[] = [];
  let ring = [...group.teamIds];
  for (let round = 1; round <= 2 * NATIONAL_RULES.windowGames; round += 1) {
    const window = round <= NATIONAL_RULES.windowGames ? 1 : 2, date = nationalWindowDays(seasonNumber, window)[(round - 1) % NATIONAL_RULES.windowGames]!;
    for (let game = 0; game < ring.length / 2; game += 1) {
      const pair = [ring[game]!, ring[ring.length - 1 - game]!] as const, reverse = (round + game) % 2 === 0;
      fixtures.push({ id: `${competitionId}-${group.id.toLowerCase()}-r${round}-g${game + 1}`, competitionId, window, stage: 'group', groupId: group.id, date, homeTeamId: pair[reverse ? 1 : 0], awayTeamId: pair[reverse ? 0 : 1], result: null });
    }
    ring = [ring[0]!, ring.at(-1)!, ...ring.slice(1, -1)];
  }
  return fixtures;
}

/** A season's qualifiers from its groups. */
export function qualifierCompetition(seasonNumber: number, groups: NationalGroup[]): NationalCompetition {
  const id = `nq-s${seasonNumber}`;
  const name = seasonNumber === 1 ? 'World Championship 2027 European Qualifiers · Second round' : `${nationalTournamentName(seasonNumber).replace(/ \(.*\)$/u, '')} European Qualifiers`;
  return { id, seasonNumber, kind: 'qualifiers', name, groups, fixtures: groups.flatMap(group => groupFixtures(id, group, seasonNumber)) };
}

/** The qualifiers' name saved careers from before 27 November 2026 recorded. */
export function legacyQualifierName(seasonNumber: number): string {
  return seasonNumber === 1 ? 'World Cup 2027 European Qualifiers · Second round' : `${legacyNationalTournamentName(seasonNumber).replace(/ \(.*\)$/u, '')} European Qualifiers`;
}

/** The national teams, coaches and season one's qualifiers of a new career. */
export function createNational(seed: number, date: string): SeasonNational {
  const teams = NATIONAL_TEAMS.map(team => ({ ...team }));
  let national: SeasonNational = { model: NATIONAL_MODEL, teams, coaches: [], coachCount: 0, competitions: [], job: null, offers: [], verdicts: [], events: [], earnings: { paidThrough: null, payments: [] }, activeFixtureId: null, activeMatch: null };
  for (const team of teams) {
    const { coach, coachCount } = generatedCoach(national, team.id, 1, date);
    national = { ...national, coaches: [...national.coaches, coach], coachCount };
  }
  const byShort = new Map(teams.map(team => [team.shortName, team.id]));
  const groups = QUALIFIER_GROUPS_2026.map(group => ({ id: group.id, name: group.name, teamIds: group.teams.map(short => byShort.get(short)!) }));
  void seed;
  return { ...national, competitions: [qualifierCompetition(1, groups)] };
}

/** The coach of a national team now. */
export function nationalCoach(national: Pick<SeasonNational, 'coaches'>, teamId: string): NationalCoach {
  const coach = national.coaches.find(item => item.teamId === teamId);
  if (!coach) throw new Error('This national team has no head coach.');
  return coach;
}

/** The season's competitions (qualifiers first). */
export function seasonNationalCompetitions(national: Pick<SeasonNational, 'competitions'>, seasonNumber: number): NationalCompetition[] {
  return national.competitions.filter(item => item.seasonNumber === seasonNumber);
}

const SIDES: readonly Side[] = ['home', 'away'];
const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const byDate = (a: NationalFixture, b: NationalFixture) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** A player a national coach can pick: his club (null for a generated player), current abilities and overall rating. */
export interface NationalCandidate { player: Player; clubId: string | null; ovr: number; generated?: true }

/** The team's country of a nationality as the pack spells it (aliases such as "Türkiye" included). */
export function nationalCountry(nationality: string | null | undefined): string | null {
  return nationality ? NATIONALITY_ALIASES[nationality] ?? nationality : null;
}

/** A player's national team country in this career, from the world's player profiles (null: unknown or none). */
export function playerNationalCountry(state: Pick<SeasonState, 'world' | 'dataPackId'>, playerId: string): string | null {
  const profiles = worldOf(state).playerProfiles;
  return Object.hasOwn(profiles, playerId) ? nationalCountry(profiles[playerId]!.nationality) : null;
}

const GENERATED_POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C', 'C', 'PF', 'SF', 'SG', 'PG', 'SF', 'PF'];
const GENERATED_BASE: Readonly<Record<1 | 2 | 3, number>> = { 1: 12.5, 2: 11, 3: 9.5 };
const SKIN_TONES = ['#f1c7a5', '#e0ac85', '#c68863', '#9c6644', '#6f4a33'];
const HAIR_COLORS = ['#2b2118', '#4a3426', '#7a5a3a', '#b08d57', '#1d1d1d'];
const HEIGHTS: Readonly<Record<Position, number>> = { PG: 188, SG: 194, SF: 201, PF: 206, C: 211 };

/**
 * The k-th generated player of a national team (k from 1): a stand-in for real players the pack does not have, used
 * only when fewer than twelve real players can be picked. Abilities follow the team's level; marked as generated.
 */
export function generatedNationalPlayer(team: NationalTeamInfo, k: number, seed: number): Player {
  const position = GENERATED_POSITIONS[(k - 1) % GENERATED_POSITIONS.length]!, base = GENERATED_BASE[team.level];
  const hash = nationalHash(seed, `${team.id}|generated|${k}`);
  const vary = (index: number) => ((hash >>> (index * 2)) & 3) - 1.5;
  const guard = position === 'PG' || position === 'SG', big = position === 'PF' || position === 'C';
  const value = (index: number, shift: number) => clamp(Math.round(base + vary(index % 16) + shift), 1, 20);
  const attributes = {
    twoPoint: value(0, big ? 1 : 0), threePoint: value(1, guard ? 1 : big ? -2 : 0), freeThrow: value(2, 0), passing: value(3, position === 'PG' ? 2 : big ? -1 : 0),
    defense: value(4, 0), rebounding: value(5, big ? 2 : guard ? -2 : 0), stamina: value(6, 0),
    blocking: value(7, big ? 2 : -2), stealing: value(8, guard ? 1 : -1), intelligence: value(9, 0), mental: value(10, 0), discipline: value(11, 0),
  };
  const height = HEIGHTS[position] + (hash >>> 24) % 5;
  return { id: `${team.id}-generated-${k}`, name: nationalPersonName(team.country, 500 + k), number: 0, position, heightCm: height, weightKg: Math.round(height * 0.48), skinTone: SKIN_TONES[hash % SKIN_TONES.length]!, hairColor: HAIR_COLORS[(hash >>> 8) % HAIR_COLORS.length]!, attributes };
}

/** Whether a fixture id is a national game's (qualifiers `nq-s<season>-…`, tournaments `nt-s<season>-…`). */
export const isNationalFixtureId = (fixtureId: string) => /^n[qt]-s\d+-/u.test(fixtureId);

export const isGeneratedNationalPlayer = (playerId: string) => playerId.startsWith('nation-') && playerId.includes('-generated-');

/** Clubs with a game in a window's week (Sunday to the window Saturday): their players stay with them. */
function clubsBusyInWindow(state: Pick<SeasonState, 'fixtures'>, saturday: string): Set<string> {
  const from = addCalendarDays(saturday, -6), busy = new Set<string>();
  for (const fixture of state.fixtures) if (fixture.date >= from && fixture.date <= saturday) { busy.add(fixture.homeClubId); busy.add(fixture.awayClubId); }
  return busy;
}

/**
 * Every player a national coach could pick, by country, best first: the full world's players with their current
 * (trained and aged) abilities, then the other clubs of the world as the pack has them. In a window (`saturday`),
 * players injured on the first game day and players of clubs with a game in the window's week are left out.
 */
export function nationalPlayerPool(state: SeasonState, date: string, window: { saturday: string } | null): Map<string, NationalCandidate[]> {
  const world = worldOf(state), profiles = world.playerProfiles, countries = new Set((state.national?.teams ?? NATIONAL_TEAMS).map(team => team.country));
  const busy = window ? clubsBusyInWindow(state, window.saturday) : new Set<string>();
  const firstGame = window ? addCalendarDays(window.saturday, -NATIONAL_RULES.firstGame) : date;
  const injured = new Set(window ? state.injuries.filter(injury => isRecovering(injury, firstGame, state.physio)).map(injury => injury.playerId) : []);
  const pool = new Map<string, NationalCandidate[]>(), seen = new Set<string>();
  const add = (player: Player, clubId: string) => {
    if (seen.has(player.id)) return;
    seen.add(player.id);
    const country = Object.hasOwn(profiles, player.id) ? nationalCountry(profiles[player.id]!.nationality) : null;
    // NBA step 4: NBA clubs do not release their players for the FIBA windows.
    if (!country || !countries.has(country) || busy.has(clubId) || injured.has(player.id) || window && isNbaClub(world, clubId)) return;
    const list = pool.get(country) ?? [];
    list.push({ player, clubId, ovr: overallRating(player.attributes, player.position) });
    pool.set(country, list);
  };
  const full = new Set(state.clubs.map(club => club.id));
  for (const club of state.clubs) {
    let developed: Team = club;
    if (state.training?.enabledSince) try { developed = developClub(club, state.training, { ...state, date }); } catch { developed = club; }
    for (const player of developed.players) add(player, club.id);
  }
  for (const club of world.clubs) if (!full.has(club.id)) for (const player of club.players) add(player, club.id);
  for (const list of pool.values()) list.sort((a, b) => b.ovr - a.ovr || (a.player.id < b.player.id ? -1 : 1));
  return pool;
}

/**
 * A coach's twelve: the manager's own picks first (when he coaches the team), then the best two of each position, then
 * the best others; generated players fill the squad only when fewer than twelve real players can be picked.
 */
export function pickNationalSquad(team: NationalTeamInfo, candidates: readonly NationalCandidate[], seed: number, chosen: readonly string[] = []): NationalCandidate[] {
  const squad: NationalCandidate[] = [], ids = new Set<string>(), size = NATIONAL_RULES.squadSize;
  const take = (candidate: NationalCandidate) => { squad.push(candidate); ids.add(candidate.player.id); };
  for (const id of chosen) { const candidate = candidates.find(item => item.player.id === id); if (candidate && !ids.has(id) && squad.length < size) take(candidate); }
  for (const position of POSITIONS) {
    while (squad.length < size && squad.filter(item => item.player.position === position).length < 2) {
      const next = candidates.find(item => !ids.has(item.player.id) && item.player.position === position);
      if (!next) break;
      take(next);
    }
  }
  for (const candidate of candidates) { if (squad.length >= size) break; if (!ids.has(candidate.player.id)) take(candidate); }
  for (let k = 1; squad.length < size; k += 1) {
    const player = generatedNationalPlayer(team, k, seed);
    if (!ids.has(player.id)) take({ player, clubId: null, ovr: overallRating(player.attributes, player.position), generated: true });
  }
  return squad;
}

/** The manager's national team, when he has a national job. */
export const managerNationalTeamId = (state: Pick<SeasonState, 'national'>): string | null => state.national?.job?.teamId ?? null;

/** A team's squad for a game in this state (the manager's picks for his team). */
export function nationalSquadFor(state: SeasonState, teamId: string, pool: Map<string, NationalCandidate[]>, unavailable: ReadonlySet<string> = new Set()): NationalCandidate[] {
  const national = state.national!, team = nationalTeam(national, teamId), candidates = pool.get(team.country) ?? [];
  return pickNationalSquad(team, unavailable.size ? candidates.filter(item => !unavailable.has(item.player.id)) : candidates, state.seed, national.job?.teamId === teamId ? national.job.selection : []);
}

/**
 * Players who cannot play a national game: club players recovering from an injury on its date, and every player
 * injured in an earlier game of the same window or tournament (he misses the rest of it).
 */
export function nationalUnavailable(state: SeasonState, fixture: NationalFixture): Set<string> {
  const competition = findCompetition(state.national!, fixture.competitionId), out = new Set<string>();
  for (const injury of state.injuries) if (isRecovering(injury, fixture.date, state.physio)) out.add(injury.playerId);
  for (const earlier of competition.fixtures) if (earlier.window === fixture.window && earlier.result && earlier.date < fixture.date) for (const id of Object.keys(earlier.result.injuries)) out.add(id);
  return out;
}

/** A squad's strength: the average overall rating of its best eight. */
export function nationalStrength(squad: readonly NationalCandidate[]): number {
  const best = squad.map(item => item.ovr).sort((a, b) => b - a).slice(0, 8);
  return best.length ? Math.round(best.reduce((sum, ovr) => sum + ovr, 0) / best.length) : 0;
}

/** The condition a national game costs a player who played `minutes`. */
export const nationalGameCost = (minutes: number) => NATIONAL_RULES.gameCostBase + Math.round(minutes * NATIONAL_RULES.gameCostPerMinute * 10) / 10;

function startingFive(squad: readonly NationalCandidate[]): string[] {
  const sorted = [...squad].sort((a, b) => b.ovr - a.ovr), five: string[] = [];
  for (const position of POSITIONS) { const best = sorted.find(item => item.player.position === position && !five.includes(item.player.id)); if (best) five.push(best.player.id); }
  for (const item of sorted) { if (five.length >= 5) break; if (!five.includes(item.player.id)) five.push(item.player.id); }
  return five;
}

/** Players' condition at tip-off: fresh, less part of what earlier games of the same window or tournament cost them. */
function nationalConditions(competition: NationalCompetition, fixture: NationalFixture, squads: readonly NationalCandidate[][]): Record<string, number> {
  const spent: Record<string, number> = {};
  for (const earlier of competition.fixtures) if (earlier.window === fixture.window && earlier.result && earlier.date < fixture.date) for (const [id, minutes] of Object.entries(earlier.result.minutes)) spent[id] = (spent[id] ?? 0) + nationalGameCost(minutes);
  return Object.fromEntries(squads.flat().map(item => [item.player.id, clamp(Math.round(100 - 0.6 * (spent[item.player.id] ?? 0)), 60, 100)]));
}

function findCompetition(national: Pick<SeasonNational, 'competitions'>, id: string): NationalCompetition {
  const competition = national.competitions.find(item => item.id === id);
  if (!competition) throw new Error('This national competition is not in the game.');
  return competition;
}

type PoolCache = Map<string, Map<string, NationalCandidate[]>>;

/** The pool a game picks from: its window's (club conflicts and injuries apply) or the summer's. */
function poolForFixture(state: SeasonState, fixture: NationalFixture, cache: PoolCache): Map<string, NationalCandidate[]> {
  const competition = findCompetition(state.national!, fixture.competitionId);
  const saturday = fixture.window === 3 ? null : nationalWindowSaturday(competition.seasonNumber, fixture.window);
  const key = saturday ?? `summer-${competition.seasonNumber}`;
  let pool = cache.get(key);
  if (!pool) { pool = nationalPlayerPool(state, saturday ?? fixture.date, saturday ? { saturday } : null); cache.set(key, pool); }
  return pool;
}

/** The squads a window's games would use now (call-ups shown before the window). */
export function projectedNationalSquads(state: SeasonState, seasonNumber: number, window: 1 | 2): Map<string, NationalCandidate[]> {
  const national = state.national!, saturday = nationalWindowSaturday(seasonNumber, window), pool = nationalPlayerPool(state, saturday, { saturday });
  return new Map(national.teams.map(team => [team.id, nationalSquadFor(state, team.id, pool)]));
}

/**
 * A national game's match: both coaches' squads, numbered 4-15, with the career's play model. `live`: the manager's
 * team plays under his control (the Match center); otherwise every side has a computer coach. Injuries are drawn with
 * the career's injury setting.
 */
export function prepareNationalGame(state: SeasonState, fixture: NationalFixture, live: string | null, cache: PoolCache = new Map()): { match: MatchState; squads: Record<Side, NationalCandidate[]> } {
  const national = state.national!, competition = findCompetition(national, fixture.competitionId), pool = poolForFixture(state, fixture, cache), unavailable = nationalUnavailable(state, fixture);
  const squads = { home: nationalSquadFor(state, fixture.homeTeamId, pool, unavailable), away: nationalSquadFor(state, fixture.awayTeamId, pool, unavailable) };
  const team = (side: Side): Team => { const info = nationalTeam(national, side === 'home' ? fixture.homeTeamId : fixture.awayTeamId); return { id: info.id, name: info.name, shortName: info.shortName, color: info.color, players: squads[side].map((item, index) => ({ ...item.player, number: index + 4 })) }; };
  const computer = SIDES.filter(side => (side === 'home' ? fixture.homeTeamId : fixture.awayTeamId) !== live);
  // Owner (22 November 2026): national games draw injuries like club games, with each player's recurrence risk.
  const injuryRisk = injuryRiskMap(state.injuries, [...squads.home, ...squads.away].map(item => item.player.id), fixture.date);
  const match = createFixtureMatch(nationalHash(state.seed, fixture.id), team('home'), team('away'), {
    lineups: { home: startingFive(squads.home), away: startingFive(squads.away) },
    conditions: nationalConditions(competition, fixture, [squads.home, squads.away]),
    injuryMode: state.injuryMode,
    ...(Object.keys(injuryRisk).length ? { injuryRisk } : {}),
    autoSubstitutions: { home: computer.includes('home'), away: computer.includes('away') },
    ...(state.matchModel ? { playModel: state.matchModel, computerCoach: computer } : {}),
  });
  return { match, squads };
}

/** A finished national match as stored: score, squads, whole minutes and points of those who played, strengths. */
export function nationalResult(match: MatchState, squads: Record<Side, readonly NationalCandidate[]>): NationalResult {
  if (match.status !== 'finished' || !match.result) throw new Error('Finish the national game first.');
  const score = match.result.kind === 'default' ? match.result.officialScore : match.score, minutes: Record<string, number> = {}, points: Record<string, number> = {};
  for (const side of SIDES) for (const player of match[side].players) {
    const stats = match.stats[player.id];
    if (!stats || stats.secondsPlayed <= 0) continue;
    minutes[player.id] = Math.min(60, Math.round(stats.secondsPlayed / 60));
    points[player.id] = stats.points;
  }
  const carried = new Set(match.preExistingInjuries ?? []);
  const injuries = Object.fromEntries(Object.entries(match.injuries).filter(([id]) => !carried.has(id) && Object.hasOwn(minutes, id)).map(([id, injury]) => [id, injury.kind]));
  return { home: score.home, away: score.away, squads: { home: squads.home.map(item => item.player.id), away: squads.away.map(item => item.player.id) }, minutes, points, strength: { home: nationalStrength(squads.home), away: nationalStrength(squads.away) }, injuries };
}

/** The club a player of the full world belongs to now (null: a generated player or one of a club outside the full world). */
function fullWorldClubOf(state: Pick<SeasonState, 'clubs'>, playerId: string): string | null {
  return state.clubs.find(club => club.players.some(player => player.id === playerId))?.id ?? null;
}

/**
 * The club injuries of a national game: a full-world club's player injured with his national team gets a recorded
 * injury with the career's injury model and his club's medical centre, as in a club game (owner, 22 November 2026).
 */
export function nationalGameInjuries(state: SeasonState, fixture: Pick<NationalFixture, 'id' | 'date'>, result: Pick<NationalResult, 'injuries'>): SeasonInjury[] {
  const recorded: SeasonInjury[] = [];
  for (const [playerId, kind] of Object.entries(result.injuries)) {
    const clubId = fullWorldClubOf(state, playerId);
    if (!clubId) continue;
    recorded.push(createSeasonInjury(state.seed, fixture, clubId, playerId, kind, [...state.injuries, ...recorded], medicalRecoveryPercent(state, clubId, fixture.date), state.injuryModel));
  }
  return recorded;
}

function withFixtureResult(national: SeasonNational, fixtureId: string, result: NationalResult): SeasonNational {
  return { ...national, competitions: national.competitions.map(competition => competition.fixtures.some(fixture => fixture.id === fixtureId) ? { ...competition, fixtures: competition.fixtures.map(fixture => fixture.id === fixtureId ? { ...fixture, result } : fixture) } : competition) };
}

/** A national game's result recorded, with its club players' injuries. */
function recordNationalGame(state: SeasonState, fixture: NationalFixture, result: NationalResult): SeasonState {
  const injuries = nationalGameInjuries(state, fixture, result);
  return { ...state, national: withFixtureResult(state.national!, fixture.id, result), ...(injuries.length ? { injuries: [...state.injuries, ...injuries] } : {}) };
}

/** Play every unplayed national game dated on or before `through` (in date order), except the manager's open live game. */
export function playNationalGames(state: SeasonState, through: string, onlyDate?: string): SeasonState {
  let next = state;
  const cache: PoolCache = new Map();
  const due = next.national!.competitions.flatMap(competition => competition.fixtures).filter(fixture => !fixture.result && fixture.date <= through && (!onlyDate || fixture.date === onlyDate) && fixture.id !== next.national!.activeFixtureId).sort(byDate);
  for (const fixture of due) {
    const { match, squads } = prepareNationalGame(next, fixture, null, cache);
    next = recordNationalGame(next, fixture, nationalResult(simulateToEnd(match), squads));
  }
  return next;
}

/** One row of a national group table. */
export interface NationalRow { teamId: string; played: number; wins: number; losses: number; pointsFor: number; pointsAgainst: number; points: number }

/** A group's table: FIBA points (2 a win, 1 a loss), then point difference, then points scored, then name. */
export function nationalTable(national: Pick<SeasonNational, 'teams'>, competition: NationalCompetition, groupId: string): NationalRow[] {
  const group = competition.groups.find(item => item.id === groupId);
  if (!group) throw new Error('This group is not in the competition.');
  const rows = new Map(group.teamIds.map(teamId => [teamId, { teamId, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, points: 0 }]));
  for (const fixture of competition.fixtures) {
    if (fixture.groupId !== groupId || !fixture.result) continue;
    const homeWon = fixture.result.home > fixture.result.away;
    const entries: [NationalRow, number, number, boolean][] = [[rows.get(fixture.homeTeamId)!, fixture.result.home, fixture.result.away, homeWon], [rows.get(fixture.awayTeamId)!, fixture.result.away, fixture.result.home, !homeWon]];
    for (const [row, own, other, won] of entries) {
      row.played += 1; row.pointsFor += own; row.pointsAgainst += other;
      if (won) { row.wins += 1; row.points += 2; } else { row.losses += 1; row.points += 1; }
    }
  }
  const name = (teamId: string) => nationalTeam(national, teamId).name;
  return [...rows.values()].sort((a, b) => b.points - a.points || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst) || b.pointsFor - a.pointsFor || name(a.teamId).localeCompare(name(b.teamId)));
}

/** The chance the home side wins, from the squads' strengths (a small home edge, none at a neutral tournament). */
export function nationalWinChance(fixture: Pick<NationalFixture, 'window'>, strength: { home: number; away: number }): number {
  const edge = fixture.window === 3 ? 0 : 1.5;
  return 1 / (1 + Math.exp(-(strength.home + edge - strength.away) / 5));
}

/** How a team's results moved its federation's confidence: wins against the odds count up, losses against them down. */
export function nationalConfidenceChange(fixtures: readonly NationalFixture[], teamId: string): number {
  let change = 0;
  for (const fixture of fixtures) {
    if (!fixture.result || fixture.homeTeamId !== teamId && fixture.awayTeamId !== teamId) continue;
    const home = fixture.homeTeamId === teamId, chance = nationalWinChance(fixture, fixture.result.strength), expected = home ? chance : 1 - chance;
    const won = home ? fixture.result.home > fixture.result.away : fixture.result.away > fixture.result.home;
    change += (fixture.window === 3 ? 18 : 15) * ((won ? 1 : 0) - expected);
  }
  return Math.round(change);
}

/** The reputation a federation looks for in a new coach (less for the manager's own country). */
export function nationalRequirement(state: Pick<SeasonState, 'manager'>, team: NationalTeamInfo): number {
  return NATIONAL_RULES.requirement[team.level] - (nationalCountry(state.manager?.nationality) === team.country ? NATIONAL_RULES.ownCountryBonus : 0);
}

/** The manager's reputation for national jobs: his club career's, from completed seasons. */
export function nationalReputation(state: SeasonState): number {
  return managerReputation(state, Math.max(0, state.seasonNumber - 1)).value;
}

/**
 * After a window or a tournament: each federation judges its coach. The manager gets a verdict (dismissed below 25);
 * computer coaches below 30 are replaced, and a few step down (seeded). A federation needing a coach offers the
 * manager its job when he has none and his reputation reaches its requirement (one open offer at a time).
 */
function reviewNational(state: SeasonState, national: SeasonNational, fixtures: readonly NationalFixture[], key: string, date: string, window: 1 | 2 | 3): SeasonNational {
  const seasonNumber = state.seasonNumber, playing = new Set(fixtures.flatMap(fixture => [fixture.homeTeamId, fixture.awayTeamId]));
  const next: SeasonNational = { ...national, coaches: [...national.coaches], verdicts: [...national.verdicts], events: [...national.events], offers: [...national.offers] };
  const vacancies: string[] = [];
  for (const [index, coach] of next.coaches.entries()) {
    if (!playing.has(coach.teamId)) continue;
    const change = nationalConfidenceChange(fixtures, coach.teamId), confidence = clamp(coach.confidence + change, 0, 100);
    if (coach.manager) {
      const dismissed = confidence < NATIONAL_RULES.dismissBelow;
      next.verdicts.push({ id: `national-verdict-${key}`, teamId: coach.teamId, date, confidence, change, outcome: dismissed ? 'dismissed' : 'kept' });
      if (dismissed) {
        next.events.push({ id: `national-event-${key}`, teamId: coach.teamId, date, kind: 'dismissed' });
        next.job = null;
        const replaced = replacementCoach(state, next, coach.teamId, seasonNumber, date);
        next.coaches[index] = replaced.coach; next.coachCount = replaced.coachCount;
      } else next.coaches[index] = { ...coach, confidence };
      continue;
    }
    const stepsDown = nationalHash(state.seed, `${coach.teamId}|${key}|steps-down`) % 100 < (window === 3 ? 15 : 6);
    if (confidence < NATIONAL_RULES.replaceBelow || stepsDown) {
      const replaced = replacementCoach(state, next, coach.teamId, seasonNumber, date);
      next.coaches[index] = replaced.coach; next.coachCount = replaced.coachCount;
      vacancies.push(coach.teamId);
    } else next.coaches[index] = { ...coach, confidence };
  }
  if (!next.job && !next.offers.some(offer => offer.status === 'open')) {
    const reputation = nationalReputation(state);
    const offered = vacancies.map(teamId => nationalTeam(next, teamId)).filter(team => nationalRequirement(state, team) <= reputation).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))[0];
    if (offered) next.offers.push({ id: `national-offer-${key}`, teamId: offered.id, date, expiresOn: addCalendarDays(date, NATIONAL_RULES.offerDays), status: 'open' });
  }
  return next;
}

/** Offers left unanswered past their date expire. */
function expireOffers(national: SeasonNational, date: string): SeasonNational {
  return national.offers.some(offer => offer.status === 'open' && offer.expiresOn < date) ? { ...national, offers: national.offers.map(offer => offer.status === 'open' && offer.expiresOn < date ? { ...offer, status: 'expired' as const } : offer) } : national;
}

/** A month's salary payment: a twelfth of the season's salary. */
export const monthlyNationalSalary = (salary: number) => Math.round(salary / 12);

/** The first days of months after `from` up to and including `through`. */
function monthStarts(from: string, through: string): string[] {
  const days: string[] = [];
  let year = Number(from.slice(0, 4)), month = Number(from.slice(5, 7));
  for (;;) {
    month += 1; if (month > 12) { month = 1; year += 1; }
    const day = `${year}-${String(month).padStart(2, '0')}-01`;
    if (day > through) return days;
    days.push(day);
  }
}

/**
 * The national salary paid up to `through`: each first day of a month since the last payment, while the manager holds
 * the job (owner, 22 November 2026). Without a job the record waits unchanged.
 */
export function payNationalSalary(national: SeasonNational, through: string): SeasonNational {
  const job = national.job, paid = national.earnings.paidThrough;
  if (!job || !paid || through <= paid) return national;
  const payments: NationalPayment[] = monthStarts(paid, through).map(date => ({ date, teamId: job.teamId, amount: monthlyNationalSalary(job.salary) }));
  return { ...national, earnings: { paidThrough: through, payments: [...national.earnings.payments, ...payments] } };
}

/** The manager's career earnings: the total and the payments, newest last (null in careers without national teams). */
export function careerEarnings(state: Pick<SeasonState, 'national'>): (ManagerEarnings & { total: number }) | null {
  const earnings = state.national?.earnings;
  return earnings ? { ...earnings, total: earnings.payments.reduce((sum, payment) => sum + payment.amount, 0) } : null;
}

/**
 * The week's national business, run before the week's training (`toDate` is the next Saturday): offers expire, every
 * national game up to that Saturday is played (a manager without a club has his games simulated), and each window
 * finished by then is reviewed by the federations.
 */
export function advanceNationalWeek(state: SeasonState, fromDate: string, toDate: string): SeasonState {
  if (!state.national) return state;
  // The month's salary first: a dismissal after the window comes after the payments due by then.
  let next: SeasonState = { ...state, national: payNationalSalary(expireOffers(state.national, toDate), toDate) };
  next = playNationalGames(next, toDate);
  for (const competition of next.national!.competitions) {
    if (competition.kind !== 'qualifiers') continue;
    for (const window of [1, 2] as const) {
      const saturday = nationalWindowSaturday(competition.seasonNumber, window);
      if (!(saturday > fromDate && saturday <= toDate)) continue;
      const fixtures = competition.fixtures.filter(fixture => fixture.window === window);
      next = { ...next, national: reviewNational(next, next.national!, fixtures, `s${competition.seasonNumber}-w${window}`, saturday, window) };
      // The qualifiers are complete: the summer tournament's groups are drawn from the final tables.
      if (window === 2 && !nationalTournament(next.national!, competition.seasonNumber)) next = createTournament(next, findCompetition(next.national!, competition.id));
    }
  }
  return next;
}

/** A season's summer tournament, once drawn. */
export function nationalTournament(national: Pick<SeasonNational, 'competitions'>, seasonNumber: number): NationalCompetition | null {
  return national.competitions.find(item => item.seasonNumber === seasonNumber && item.kind === 'tournament') ?? null;
}

/** The next game day of this season's summer tournament (null before the draw or once it is played). */
export function nextTournamentDay(state: Pick<SeasonState, 'national' | 'seasonNumber'>): string | null {
  const tournament = state.national ? nationalTournament(state.national, state.seasonNumber) : null;
  return tournament?.fixtures.filter(fixture => !fixture.result).map(fixture => fixture.date).sort()[0] ?? null;
}

/**
 * The offseason's next national game day when the manager coaches a team of this season's summer tournament (owner, 22
 * November 2026): the tournament is then played day by day in the offseason, after recruitment and before the season
 * change. Without such a team the tournament is played at the season change.
 */
export function offseasonNationalDay(state: SeasonState): string | null {
  const national = state.national, teamId = national?.job?.teamId;
  if (!national || !teamId || state.status !== 'complete') return null;
  const tournament = nationalTournament(national, state.seasonNumber);
  return tournament?.groups.some(group => group.teamIds.includes(teamId)) ? nextTournamentDay(state) : null;
}

/**
 * The manager's next national game to open in the Match center: in the season, his team's earliest unplayed window
 * game up to the next Saturday (played before the week's training); in the offseason, his team's game on the
 * tournament's next game day. With or without a club (owner, 22 November 2026: an unemployed manager plays live too).
 */
export function dueManagerNationalGame(state: SeasonState): NationalFixture | null {
  const national = state.national, teamId = national?.job?.teamId;
  if (!national || !teamId || national.activeMatch) return null;
  const own = (fixture: NationalFixture) => !fixture.result && (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId);
  if (state.status === 'complete') {
    const day = offseasonNationalDay(state);
    return day ? nationalTournament(national, state.seasonNumber)!.fixtures.find(fixture => own(fixture) && fixture.date === day) ?? null : null;
  }
  if (state.status !== 'active') return null;
  const nextSaturday = addCalendarDays(state.date, 7);
  return national.competitions.flatMap(competition => competition.fixtures).filter(fixture => own(fixture) && fixture.window !== 3 && fixture.date > state.date && fixture.date <= nextSaturday).sort(byDate)[0] ?? null;
}

/** The day the next national step plays: the open game's, the manager's due game, or the offseason tournament's next day. */
export function nationalStepDay(state: SeasonState): string | null {
  return activeNationalFixture(state)?.date ?? dueManagerNationalGame(state)?.date ?? offseasonNationalDay(state);
}

/**
 * One national step of Continue: open the manager's due game in the Match center; in the offseason, a tournament day
 * without his team's game is played in full.
 */
export function startNationalMatch(state: SeasonState): SeasonState {
  const fixture = dueManagerNationalGame(state);
  if (fixture) {
    const { match } = prepareNationalGame(state, fixture, state.national!.job!.teamId);
    return { ...state, national: { ...state.national!, activeFixtureId: fixture.id, activeMatch: match } };
  }
  const day = offseasonNationalDay(state);
  if (day) return playNationalDay(state, day);
  throw new Error('Your national team has no game to play now.');
}

/** The open national game's fixture. */
export function activeNationalFixture(state: Pick<SeasonState, 'national'>): NationalFixture | null {
  const national = state.national;
  return national?.activeFixtureId ? national.competitions.flatMap(competition => competition.fixtures).find(item => item.id === national.activeFixtureId) ?? null : null;
}

/** The national side the manager coaches in the open national match. */
export function nationalManagedSide(state: Pick<SeasonState, 'national'>): Side {
  const match = state.national?.activeMatch, fixture = activeNationalFixture(state);
  if (!match || !fixture) throw new Error('No national game is open.');
  return match.home.id === state.national?.job?.teamId ? 'home' : match.away.id === state.national?.job?.teamId ? 'away' : 'home';
}

/** Record the finished national game and play that day's other national games. */
export function commitNationalMatch(state: SeasonState): SeasonState {
  const national = state.national, match = national?.activeMatch, fixture = activeNationalFixture(state);
  if (!national || !match || !fixture) throw new Error('No national game is open.');
  if (match.status !== 'finished' || match.requiredSubstitutions.length) throw new Error('Finish the national game and resolve required decisions before continuing.');
  // The squads are the match's players, in the coaches' order.
  const squad = (side: Side): NationalCandidate[] => match[side].players.map(player => ({ player, clubId: null, ovr: overallRating(player.attributes, player.position) }));
  const recorded = recordNationalGame(state, fixture, nationalResult(match, { home: squad('home'), away: squad('away') }));
  const next: SeasonState = { ...recorded, national: { ...recorded.national!, activeFixtureId: null, activeMatch: null } };
  return playNationalDay(next, fixture.date);
}

/** Accept a federation's offer: the national job runs alongside any club job. */
export function acceptNationalOffer(state: SeasonState, offerId: string): SeasonState {
  const national = state.national, offer = national?.offers.find(item => item.id === offerId);
  if (!national || !offer || offer.status !== 'open' || offer.expiresOn < state.date) throw new Error('This national job offer is no longer open.');
  if (national.job) throw new Error('You are already head coach of a national team.');
  if (national.activeMatch) throw new Error('Finish the national game first.');
  const team = nationalTeam(national, offer.teamId), since = { seasonNumber: state.seasonNumber, date: state.date };
  return { ...state, national: {
    ...national,
    job: { teamId: team.id, since, untilSeason: state.seasonNumber + NATIONAL_RULES.contractSeasons - 1, salary: NATIONAL_RULES.salary[team.level], selection: [] },
    earnings: { ...national.earnings, paidThrough: state.date },
    coaches: national.coaches.map(coach => coach.teamId === team.id ? { teamId: team.id, name: state.manager?.name ?? 'You', manager: true as const, since, confidence: NATIONAL_RULES.startingConfidence } : coach),
    offers: national.offers.map(item => item.id === offerId ? { ...item, status: 'accepted' as const } : item.status === 'open' ? { ...item, status: 'declined' as const } : item),
    events: [...national.events, { id: `national-event-${offerId}`, teamId: team.id, date: state.date, kind: 'appointed' as const }],
  } };
}

export function declineNationalOffer(state: SeasonState, offerId: string): SeasonState {
  const national = state.national, offer = national?.offers.find(item => item.id === offerId);
  if (!national || !offer || offer.status !== 'open') throw new Error('This national job offer is no longer open.');
  return { ...state, national: { ...national, offers: national.offers.map(item => item.id === offerId ? { ...item, status: 'declined' as const } : item) } };
}

/** Leave the national job; the federation names a new coach. The club job is not affected. */
export function resignNationalJob(state: SeasonState): SeasonState {
  const national = state.national, job = national?.job;
  if (!national || !job) throw new Error('You are not head coach of a national team.');
  if (national.activeMatch) throw new Error('Finish the national game first.');
  const replaced = replacementCoach(state, national, job.teamId, state.seasonNumber, state.date);
  return { ...state, national: { ...payNationalSalary(national, state.date), job: null, coaches: national.coaches.map(coach => coach.teamId === job.teamId ? replaced.coach : coach), coachCount: replaced.coachCount, events: [...national.events, { id: `national-event-resigned-s${state.seasonNumber}-${state.date}`, teamId: job.teamId, date: state.date, kind: 'resigned' as const }] } };
}

/** The manager's own picks for his national team (up to twelve players of its country); the rest is picked automatically. */
export function setNationalSelection(state: SeasonState, playerIds: readonly string[]): SeasonState {
  const national = state.national, job = national?.job;
  if (!national || !job) throw new Error('You are not head coach of a national team.');
  if (national.activeMatch) throw new Error('Finish the national game first.');
  const country = nationalTeam(national, job.teamId).country;
  if (playerIds.length > NATIONAL_RULES.squadSize || new Set(playerIds).size !== playerIds.length || playerIds.some(id => typeof id !== 'string' || playerNationalCountry(state, id) !== country)) throw new Error(`Pick up to ${NATIONAL_RULES.squadSize} players of ${country}.`);
  return { ...state, national: { ...national, job: { ...job, selection: [...playerIds] } } };
}

/** Test hook (not reachable from the interface): a federation offers the manager its job now. */
export function offerNationalJob(state: SeasonState, teamId: string): SeasonState {
  const national = state.national;
  if (!national || national.job) throw new Error('A national job offer needs a career with national teams and no national job.');
  nationalTeam(national, teamId);
  const offer: NationalOffer = { id: `national-offer-test-${teamId}-${state.date}`, teamId, date: state.date, expiresOn: addCalendarDays(state.date, NATIONAL_RULES.offerDays), status: 'open' };
  return { ...state, national: { ...national, offers: [...national.offers.map(item => item.status === 'open' ? { ...item, status: 'declined' as const } : item), offer] } };
}

/**
 * Called-up players' days away from their clubs between two dates (`from` excluded): null for a day without a game, the
 * whole minutes played on a national game day. Only finished window games count (the summer has no club training).
 */
export function nationalDutyDays(national: SeasonNational | undefined, fromDate: string, toDate: string): Record<string, Record<string, number | null>> | undefined {
  if (!national) return undefined;
  const duty: Record<string, Record<string, number | null>> = {};
  for (const competition of national.competitions) {
    if (competition.kind !== 'qualifiers') continue;
    for (const window of [1, 2] as const) {
      const days = nationalAwayDays(competition.seasonNumber, window).filter(day => day > fromDate && day <= toDate);
      if (!days.length) continue;
      for (const fixture of competition.fixtures) {
        if (fixture.window !== window || !fixture.result) continue;
        for (const id of [...fixture.result.squads.home, ...fixture.result.squads.away]) {
          const own = duty[id] ??= {};
          for (const day of days) if (!Object.hasOwn(own, day)) own[day] = null;
          if (days.includes(fixture.date)) own[fixture.date] = fixture.result.minutes[id] ?? 0;
        }
      }
    }
  }
  return Object.keys(duty).length ? duty : undefined;
}

const tournamentFixture = (id: string, suffix: string, stage: NationalFixture['stage'], groupId: string | null, date: string, home: string, away: string): NationalFixture => ({ id: `${id}-${suffix}`, competitionId: id, window: 3, stage, groupId, date, homeTeamId: home, awayTeamId: away, result: null });

/**
 * The summer tournament of a season's completed qualifiers: the top three of each group in four groups of three (one
 * team from each of three groups), each group's three games on the first three tournament days.
 */
function createTournament(state: SeasonState, qualifiers: NationalCompetition): SeasonState {
  const national = state.national!, seasonNumber = qualifiers.seasonNumber, days = nationalTournamentDays(seasonNumber), id = `nt-s${seasonNumber}`;
  const tables = qualifiers.groups.map(group => nationalTable(national, qualifiers, group.id).map(row => row.teamId));
  const groups: NationalGroup[] = tables.map((_, index) => ({ id: 'ABCD'[index]!, name: `Group ${'ABCD'[index]!}`, teamIds: [tables[index]![0]!, tables[(index + 1) % 4]![1]!, tables[(index + 2) % 4]![2]!] }));
  const pairs: readonly (readonly [number, number])[] = [[0, 1], [2, 0], [1, 2]];
  const competition: NationalCompetition = { id, seasonNumber, kind: 'tournament', name: nationalTournamentName(seasonNumber), groups, fixtures: groups.flatMap(group => pairs.map(([a, b], round) => tournamentFixture(id, `${group.id.toLowerCase()}-r${round + 1}`, 'group', group.id, days[round]!, group.teamIds[a]!, group.teamIds[b]!))) };
  return { ...state, national: { ...national, competitions: [...national.competitions, competition] } };
}

/** A tournament's next round once the one before is complete: the semi-finals (group winners), then the final and the game for third. */
function extendTournament(national: SeasonNational, competition: NationalCompetition): SeasonNational {
  const days = nationalTournamentDays(competition.seasonNumber), id = competition.id, add: NationalFixture[] = [];
  const groupGames = competition.fixtures.filter(item => item.stage === 'group'), semis = competition.fixtures.filter(item => item.stage === 'semi');
  const winner = (item: NationalFixture) => item.result!.home > item.result!.away ? item.homeTeamId : item.awayTeamId;
  const loser = (item: NationalFixture) => winner(item) === item.homeTeamId ? item.awayTeamId : item.homeTeamId;
  if (!semis.length && groupGames.every(item => item.result)) {
    const winners = competition.groups.map(group => nationalTable(national, competition, group.id)[0]!.teamId);
    add.push(tournamentFixture(id, 'semi-1', 'semi', null, days[3]!, winners[0]!, winners[3]!), tournamentFixture(id, 'semi-2', 'semi', null, days[3]!, winners[1]!, winners[2]!));
  } else if (semis.length && semis.every(item => item.result) && !competition.fixtures.some(item => item.stage === 'final')) {
    add.push(tournamentFixture(id, 'final', 'final', null, days[4]!, winner(semis[0]!), winner(semis[1]!)), tournamentFixture(id, 'third', 'third', null, days[4]!, loser(semis[0]!), loser(semis[1]!)));
  }
  return add.length ? { ...national, competitions: national.competitions.map(item => item.id === id ? { ...item, fixtures: [...item.fixtures, ...add] } : item) } : national;
}

/**
 * Every national game up to `through` (only that day unless `onlyDate` is empty), the manager's open game excepted; a
 * summer tournament adds its next round as each one is completed, and those games are played too when they are due.
 */
function playNationalDay(state: SeasonState, through: string, onlyDate: string = through): SeasonState {
  let next = state;
  for (let guard = 0; guard < 6; guard += 1) {
    next = playNationalGames(next, through, onlyDate || undefined);
    let national = next.national!;
    for (const competition of national.competitions) if (competition.kind === 'tournament') national = extendTournament(national, findCompetition(national, competition.id));
    if (national === next.national) break;
    next = { ...next, national };
  }
  return next;
}

/**
 * The summer tournament of the completed season played to its end (the games not already played in the offseason),
 * with its club players' injuries. Called at the season change; it does nothing once the tournament is over.
 */
export function playSummerTournament(state: SeasonState): SeasonState {
  const national = state.national, seasonNumber = state.seasonNumber;
  const qualifiers = national?.competitions.find(item => item.seasonNumber === seasonNumber && item.kind === 'qualifiers');
  if (!national || !qualifiers) return state;
  if (national.activeMatch) throw new Error('Finish the national game first.');
  let next = playNationalGames(state, nationalWindowSaturday(seasonNumber, 2));
  if (!nationalTournament(next.national!, seasonNumber)) next = createTournament(next, findCompetition(next.national!, qualifiers.id));
  return playNationalDay(next, nationalTournamentDays(seasonNumber).at(-1)!, '');
}

/** A tournament's final order of the top four (champion first), when its final and game for third are played. */
export function nationalPodium(competition: NationalCompetition): string[] | null {
  const final = competition.fixtures.find(item => item.stage === 'final'), third = competition.fixtures.find(item => item.stage === 'third');
  if (!final?.result || !third?.result) return null;
  const order = (item: NationalFixture) => item.result!.home > item.result!.away ? [item.homeTeamId, item.awayTeamId] : [item.awayTeamId, item.homeTeamId];
  return [...order(final), ...order(third)];
}

/** Next season's qualifier groups: every team by its current strength, snake-seeded into four groups of six. */
function seededGroups(state: SeasonState): NationalGroup[] {
  const national = state.national!, pool = nationalPlayerPool(state, state.date, null);
  const ranked = national.teams.map(team => ({ id: team.id, strength: nationalStrength(pickNationalSquad(team, pool.get(team.country) ?? [], state.seed)) })).sort((a, b) => b.strength - a.strength || (a.id < b.id ? -1 : 1));
  const groups: NationalGroup[] = ['A', 'B', 'C', 'D'].map(id => ({ id, name: `Group ${id}`, teamIds: [] }));
  ranked.forEach((team, index) => { const pot = Math.floor(index / 4), slot = index % 4; groups[pot % 2 === 0 ? slot : 3 - slot]!.teamIds.push(team.id); });
  return groups;
}

/**
 * At the season's rollover (`state` is the completed season): the summer tournament is played, the federations judge
 * it, the manager's contract ends or is renewed, and next season's qualifiers are drawn. Older seasons are dropped.
 */
export function rolloverNational(state: SeasonState, nextSeasonDate?: string): SeasonNational {
  if (!state.national) throw new Error('This career has no national teams.');
  const seasonNumber = state.seasonNumber, qualifiers = state.national.competitions.find(item => item.seasonNumber === seasonNumber && item.kind === 'qualifiers');
  let next: SeasonState = playSummerTournament(state);
  next = { ...next, national: expireOffers(next.national!, addCalendarDays(state.date, 1)) };
  if (qualifiers) {
    // The salary up to the tournament's end comes before the federation's verdict on it.
    const tournament = findCompetition(next.national!, `nt-s${seasonNumber}`), last = nationalTournamentDays(seasonNumber).at(-1)!;
    next = { ...next, national: payNationalSalary(next.national!, last) };
    next = { ...next, national: reviewNational(next, next.national!, tournament.fixtures, `s${seasonNumber}-w3`, last, 3) };
  }
  // The salary up to the tournament's end, when a contract can end; a kept job is paid on to the new season's first day.
  let national = payNationalSalary(next.national!, nationalTournamentDays(seasonNumber).at(-1)!);
  const job = national.job;
  if (job && job.untilSeason <= seasonNumber) {
    const coach = nationalCoach(national, job.teamId), date = nationalTournamentDays(seasonNumber).at(-1)!, renewed = coach.confidence >= NATIONAL_RULES.renewFrom;
    const verdict: NationalVerdict = { id: `national-contract-s${seasonNumber}`, teamId: job.teamId, date, confidence: coach.confidence, change: 0, outcome: renewed ? 'renewed' : 'left' };
    if (renewed) national = { ...national, job: { ...job, untilSeason: seasonNumber + NATIONAL_RULES.contractSeasons }, verdicts: [...national.verdicts, verdict] };
    else {
      const replaced = replacementCoach(next, national, job.teamId, seasonNumber + 1, date);
      national = { ...national, job: null, coaches: national.coaches.map(item => item.teamId === job.teamId ? replaced.coach : item), coachCount: replaced.coachCount, verdicts: [...national.verdicts, verdict], events: [...national.events, { id: `national-event-ended-s${seasonNumber}`, teamId: job.teamId, date, kind: 'ended' as const }] };
    }
  }
  if (nextSeasonDate) national = payNationalSalary(national, nextSeasonDate);
  const groups = seededGroups({ ...next, national });
  return { ...national, competitions: [...national.competitions.filter(item => item.seasonNumber >= seasonNumber), qualifierCompetition(seasonNumber + 1, groups)] };
}

/** One of a club's players on national duty in a window: his team and, once played, his minutes over the window. */
export interface ClubCallUp { playerId: string; teamId: string; minutes: number | null }
export interface ClubCallUps { seasonNumber: number; window: 1 | 2; saturday: string; played: boolean; players: ClubCallUp[] }

/** A club's players in a window's squads (`played`: from the games; otherwise as the coaches would pick them now). */
export function clubWindowCallUps(state: SeasonState, clubId: string, seasonNumber: number, window: 1 | 2): ClubCallUps | null {
  const national = state.national, club = state.clubs.find(item => item.id === clubId);
  const competition = national?.competitions.find(item => item.seasonNumber === seasonNumber && item.kind === 'qualifiers');
  if (!national || !club || !competition) return null;
  const own = new Set(club.players.map(player => player.id)), fixtures = competition.fixtures.filter(fixture => fixture.window === window);
  const played = fixtures.every(fixture => fixture.result), players = new Map<string, ClubCallUp>();
  if (fixtures.some(fixture => fixture.result)) {
    for (const fixture of fixtures) if (fixture.result) for (const side of SIDES) for (const id of fixture.result.squads[side]) {
      if (!own.has(id)) continue;
      const teamId = side === 'home' ? fixture.homeTeamId : fixture.awayTeamId, entry = players.get(id) ?? { playerId: id, teamId, minutes: 0 };
      players.set(id, { ...entry, minutes: (entry.minutes ?? 0) + (fixture.result.minutes[id] ?? 0) });
    }
  } else for (const [teamId, squad] of projectedNationalSquads(state, seasonNumber, window)) for (const item of squad) if (own.has(item.player.id)) players.set(item.player.id, { playerId: item.player.id, teamId, minutes: null });
  return { seasonNumber, window, saturday: nationalWindowSaturday(seasonNumber, window), played, players: [...players.values()] };
}

/** The window of this week or the next two (call-ups are shown at the club then), or null outside them. */
export function upcomingNationalWindow(state: Pick<SeasonState, 'national' | 'seasonNumber' | 'date' | 'status'>): { seasonNumber: number; window: 1 | 2; saturday: string } | null {
  if (!state.national || state.status !== 'active') return null;
  for (const window of [1, 2] as const) {
    const saturday = nationalWindowSaturday(state.seasonNumber, window);
    if (saturday > state.date && saturday <= addCalendarDays(state.date, 14)) return { seasonNumber: state.seasonNumber, window, saturday };
  }
  return null;
}

/** The next unplayed window or tournament game day of the season, for the screens (null once the season's games are played). */
export function nextNationalDate(state: Pick<SeasonState, 'national' | 'seasonNumber'>): string | null {
  const dates = (state.national?.competitions ?? []).filter(item => item.seasonNumber === state.seasonNumber).flatMap(item => item.fixtures).filter(fixture => !fixture.result).map(fixture => fixture.date).sort();
  return dates[0] ?? null;
}

/** A national squad player's name and club for the screens: club players by their club, generated players by their team. */
export function nationalPlayerInfo(state: SeasonState, playerId: string): { name: string; clubId: string | null; generated: boolean } {
  if (isGeneratedNationalPlayer(playerId)) {
    const match = /^(nation-[a-z]+)-generated-(\d+)$/u.exec(playerId), team = match ? state.national?.teams.find(item => item.id === match[1]) : undefined;
    return { name: team ? generatedNationalPlayer(team, Number(match![2]), state.seed).name : 'Generated player', clubId: null, generated: true };
  }
  for (const club of state.clubs) { const player = club.players.find(item => item.id === playerId); if (player) return { name: player.name, clubId: club.id, generated: false }; }
  for (const club of worldOf(state).clubs) { const player = club.players.find(item => item.id === playerId); if (player) return { name: player.name, clubId: club.id, generated: false }; }
  return { name: 'Unknown player', clubId: null, generated: false };
}

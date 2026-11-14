import type { CareerWorld } from '../domain/world';
import type { DevelopmentPresident } from '../data/development-presidents';
import { sponsorMarket } from '../data/development-sponsors';
import { DEVELOPMENT_WORLD } from '../data/development-world';
import { MAX_WORLD_CLUBS, MIN_WORLD_CLUBS, validateWorld } from './career-world';
import type { Player, Team } from '../domain/types';
import { matchdayTeam, NEUTRAL_APPEARANCE, type DataPack, type DataPackCompetition } from './data-pack';
import { MAX_ROSTER_SIZE } from './employment-policy';
import { overallRating } from './overall-rating';

/**
 * A career world from a private real-data pack: one domestic league's real clubs, squads, positions and ratings.
 * Wages, budgets, presidents and sponsors are fictional estimates. Researched birth dates are retained;
 * missing dates are estimated from ages. Derbies are left out rather than invented between real clubs.
 */
export const REAL_WORLD_RULES = Object.freeze({
  /** Every club starts with the game's full registration of twelve: its best-rated players with statistics. */
  squadSize: MAX_ROSTER_SIZE,
  /** Players without a known age are assumed to be this old. */
  defaultAge: 26,
  /** Fictional season wages in euros: 9,000 plus 220 per overall-rating point above 40, in 500 steps, within 5,000-30,000. */
  wage: Object.freeze({ base: 9_000, perPoint: 220, from: 40, step: 500, min: 5_000, max: 30_000 }),
  /** Arena size and usual crowd follow squad strength within the league (no real capacities in the pack yet). */
  arena: Object.freeze({ smallest: 3_000, largest: 6_500, step: 100, fillFrom: 0.72, fillRange: 0.1 }),
  /**
   * Some provider squads list fewer than twelve players (sprint 3): the missing places go to generated reserves,
   * young fictional players one point below the average of the club's three weakest real players in each ability,
   * in the positions the squad has fewest of. Their profiles say 'generated-reserve'.
   */
  reserves: Object.freeze({ ages: Object.freeze([19, 20, 21, 22]), belowWeakest: 1, build: Object.freeze({ PG: [188, 84], SG: [194, 89], SF: [200, 97], PF: [206, 106], C: [211, 113] }) }),
});
/** Fictional name parts for generated reserves, by the club's country (any other country uses the last list). */
const RESERVE_NAMES: Readonly<Record<string, readonly [readonly string[], readonly string[]]>> = Object.freeze({
  Turkey: [['Emre', 'Burak', 'Kaan', 'Mert', 'Arda', 'Yiğit', 'Ozan', 'Berk', 'Eren', 'Tolga'], ['Aksoy', 'Demirel', 'Kalkan', 'Yalın', 'Toprak', 'Erdem', 'Sezer', 'Karaca', 'Ünal', 'Bozkurt']],
  Spain: [['Pablo', 'Álvaro', 'Hugo', 'Mario', 'Iker', 'Diego', 'Adrián', 'Marcos', 'Rubén', 'Javier'], ['Ortega', 'Navarro', 'Prieto', 'Vidal', 'Campos', 'Rojas', 'Serrano', 'Molina', 'Peña', 'Lozano']],
  Andorra: [['Pau', 'Arnau', 'Marc', 'Jordi', 'Oriol', 'Pol', 'Biel', 'Roger', 'Àlex', 'Nil'], ['Puig', 'Font', 'Serra', 'Vila', 'Roca', 'Soler', 'Pujol', 'Riera', 'Casals', 'Mas']],
  Italy: [['Luca', 'Matteo', 'Andrea', 'Davide', 'Simone', 'Lorenzo', 'Riccardo', 'Tommaso', 'Federico', 'Pietro'], ['Ferraro', 'Galli', 'Marchetti', 'Rinaldi', 'Bellini', 'Caruso', 'Fontana', 'Moretti', 'Testa', 'Vitale']],
  France: [['Hugo', 'Théo', 'Lucas', 'Nathan', 'Mathis', 'Enzo', 'Louis', 'Jules', 'Maxime', 'Clément'], ['Lefèvre', 'Garnier', 'Rousseau', 'Mercier', 'Faure', 'Chevalier', 'Gauthier', 'Perrin', 'Morel', 'Brunet']],
  Greece: [['Giorgos', 'Nikos', 'Dimitris', 'Kostas', 'Christos', 'Panagiotis', 'Vasilis', 'Thanasis', 'Stelios', 'Yannis'], ['Papadakis', 'Karalis', 'Mavridis', 'Stavrou', 'Galanis', 'Kyriakou', 'Lambrou', 'Nikolaou', 'Raptis', 'Vlachos']],
  Germany: [['Jonas', 'Lukas', 'Felix', 'Moritz', 'Tim', 'Niklas', 'Paul', 'Jan', 'Leon', 'Erik'], ['Kramer', 'Vogel', 'Lindner', 'Seifert', 'Brandt', 'Winkler', 'Hartmann', 'Busch', 'Kühn', 'Roth']],
  other: [['Alex', 'Daniel', 'David', 'Mark', 'Adam', 'Martin', 'Filip', 'Luka', 'Tomas', 'Ivan'], ['Novak', 'Horvat', 'Kovač', 'Petrov', 'Marin', 'Varga', 'Nielsen', 'Silva', 'Janssen', 'Popescu']],
});
const PRESIDENT_FIRST = ['Anna', 'Bernd', 'Clara', 'Dieter', 'Elena', 'Frank', 'Greta', 'Holger', 'Ines', 'Jürgen', 'Karin', 'Lukas', 'Monika', 'Norbert', 'Olga', 'Peter', 'Rita', 'Stefan', 'Tanja', 'Uwe'];
const PRESIDENT_LAST = ['Albrecht', 'Brandt', 'Conrad', 'Dorn', 'Engel', 'Falk', 'Gerber', 'Hahn', 'Imhof', 'Jansen', 'Kessler', 'Lorenz', 'Mertens', 'Nagel', 'Ostrow', 'Pohl', 'Quandt', 'Rieger', 'Seidel', 'Thiel'];

function hash(text: string): number { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; }
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Domestic leagues in the pack that a career can be played in (an even number of 4 to 40 clubs). */
export function careerCompetitions(pack: DataPack): DataPackCompetition[] {
  return pack.competitions.filter(item => item.kind === 'domestic' && item.clubIds.length >= MIN_WORLD_CLUBS && item.clubIds.length <= MAX_WORLD_CLUBS && item.clubIds.length % 2 === 0);
}

export function realWorldId(pack: DataPack, competitionId: string): string {
  return `real-${pack.version.replace(/[^a-zA-Z0-9]+/g, '-')}-${competitionId}`.slice(0, 80);
}

/** The fictional season wage for a player of this overall rating, in euro cents. */
export function realWorldWage(overall: number): number {
  const rule = REAL_WORLD_RULES.wage;
  return clamp(Math.round((rule.base + (overall - rule.from) * rule.perPoint) / rule.step) * rule.step, rule.min, rule.max) * 100;
}

const POSITION_ORDER: readonly Player['position'][] = ['PG', 'SG', 'SF', 'PF', 'C'];
const reserveSuffix = '-reserve-';
/** Whether a player is a generated reserve added by `withReserves`. */
export const isGeneratedReserve = (playerId: string) => playerId.includes(reserveSuffix);

/**
 * A club's squad filled up to the full registration with generated reserves (REAL_WORLD_RULES.reserves), and each
 * reserve's age. Deterministic: the same club always gets the same reserves. A full squad is returned unchanged.
 */
export function withReserves(team: Team, country: string | null): { team: Team; ages: Record<string, number> } {
  const missing = REAL_WORLD_RULES.squadSize - team.players.length;
  if (missing <= 0) return { team, ages: {} };
  const rules = REAL_WORLD_RULES.reserves, h = hash(team.id);
  const [firstNames, lastNames] = RESERVE_NAMES[country ?? ''] ?? RESERVE_NAMES.other!;
  const weakest = [...team.players].sort((a, b) => overallRating(a.attributes, a.position) - overallRating(b.attributes, b.position)).slice(0, 3);
  const attributes = Object.freeze(Object.fromEntries(Object.keys(team.players[0]!.attributes).map(key => {
    const average = weakest.reduce((sum, player) => sum + player.attributes[key as keyof Player['attributes']], 0) / weakest.length;
    return [key, clamp(Math.round(average) - rules.belowWeakest, 1, 20)];
  })) as unknown as Player['attributes']);
  const players = [...team.players], ages: Record<string, number> = {};
  const usedNumbers = new Set(players.map(player => player.number)), usedNames = new Set(players.map(player => player.name));
  for (let index = 0; index < missing; index += 1) {
    const counts = new Map(POSITION_ORDER.map(position => [position, players.filter(player => player.position === position).length]));
    const position = [...POSITION_ORDER].sort((a, b) => counts.get(a)! - counts.get(b)! || POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b))[0]!;
    let number = 30 + index;
    while (usedNumbers.has(number)) number = (number + 1) % 100;
    usedNumbers.add(number);
    let name = '';
    for (let attempt = 0; !name || usedNames.has(name); attempt += 1) name = `${firstNames[(h + index * 3 + attempt) % firstNames.length]} ${lastNames[(Math.floor(h / 7) + index * 5 + attempt * 3) % lastNames.length]}`;
    usedNames.add(name);
    const id = `${team.id}${reserveSuffix}${index + 1}`;
    const [heightCm, weightKg] = rules.build[position];
    players.push(Object.freeze({ id, name, number, position, heightCm, weightKg, ...NEUTRAL_APPEARANCE, attributes }));
    ages[id] = rules.ages[(h + index) % rules.ages.length]!;
  }
  return { team: Object.freeze({ ...team, players: Object.freeze(players) }), ages };
}

export function worldFromPack(pack: DataPack, competitionId: string): CareerWorld {
  const competition = careerCompetitions(pack).find(item => item.id === competitionId);
  if (!competition) throw new Error('Choose a domestic league with an even number of clubs from the loaded data pack.');
  const byId = new Map(pack.players.map(player => [player.id, player]));
  const reserveAges: Record<string, number> = {};
  const teams = competition.clubIds.map(clubId => {
    const filled = withReserves(matchdayTeam(pack, clubId, REAL_WORLD_RULES.squadSize), pack.clubs.find(club => club.id === clubId)?.country ?? null);
    Object.assign(reserveAges, filled.ages);
    return filled.team;
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
  const world: CareerWorld = {
    id: realWorldId(pack, competition.id), name: `${competition.name} ${competition.season}`, source: 'real-data-pack', startDate: DEVELOPMENT_WORLD.startDate,
    clubs: teams,
    playerProfiles: Object.fromEntries(teams.flatMap(team => team.players.map(player => [player.id, Object.hasOwn(reserveAges, player.id)
      ? { dateOfBirth: `${2026 - reserveAges[player.id]!}-01-01`, source: 'generated-reserve' as const }
      : { dateOfBirth: byId.get(player.id)?.birthDate ?? `${2026 - (byId.get(player.id)?.age ?? REAL_WORLD_RULES.defaultAge)}-01-01`, source: byId.get(player.id)?.birthDate ? 'official-profile' as const : 'estimated-from-age' as const,
        positionSource: byId.get(player.id)?.profileEvidence?.positionSource ?? (byId.get(player.id)?.estimated.includes('game_position') ? 'estimated' as const : 'unverified' as const) }]))),
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
  return world;
}

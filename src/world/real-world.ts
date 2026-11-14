import type { CareerWorld } from '../domain/world';
import type { DevelopmentPresident } from '../data/development-presidents';
import { sponsorMarket } from '../data/development-sponsors';
import { DEVELOPMENT_WORLD } from '../data/development-world';
import { MAX_WORLD_CLUBS, MIN_WORLD_CLUBS, validateWorld } from './career-world';
import { matchdayTeam, type DataPack, type DataPackCompetition } from './data-pack';
import { MAX_ROSTER_SIZE } from './employment-policy';
import { overallRating } from './overall-rating';

/**
 * A career world from a private real-data pack: one domestic league's real clubs, squads, positions and ratings.
 * The pack has no wages, budgets, presidents, sponsors or birth dates, so those are fictional or estimated here,
 * by visible rules, and labelled as such; derbies are left out rather than invented between real clubs.
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

export function worldFromPack(pack: DataPack, competitionId: string): CareerWorld {
  const competition = careerCompetitions(pack).find(item => item.id === competitionId);
  if (!competition) throw new Error('Choose a domestic league with an even number of clubs from the loaded data pack.');
  const byId = new Map(pack.players.map(player => [player.id, player]));
  const teams = competition.clubIds.map(clubId => matchdayTeam(pack, clubId, REAL_WORLD_RULES.squadSize));
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
    playerProfiles: Object.fromEntries(teams.flatMap(team => team.players.map(player => [player.id, { dateOfBirth: `${2026 - (byId.get(player.id)?.age ?? REAL_WORLD_RULES.defaultAge)}-01-01`, source: 'estimated-from-age' as const }]))),
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

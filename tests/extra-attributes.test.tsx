import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Player, PlayerAttributes, Position, Team } from '../src/domain/types';
import { createFixtureMatch, simulateToEnd } from '../src/engine/match';
import { deriveExtraAttributes, EXTRA_ATTRIBUTES, hasExtraAttributes, withExtraAttributes } from '../src/world/extra-attributes';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, dateForRound, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { createTraining, disciplinedPractice, processTrainingWeek } from '../src/world/training';
import { DEVELOPMENT_CLUBS } from '../src/data/development-league';
import { getPlayerKnowledge } from '../src/world/scouting-policy';
import { ScoutingKnowledge } from '../src/ui/ScoutingKnowledge';
import { economyPack } from './helpers/economy-pack';

const skills = (value: number, overrides: Partial<PlayerAttributes> = {}): PlayerAttributes => ({ twoPoint: value, threePoint: value, freeThrow: value, passing: value, defense: value, rebounding: value, stamina: value, ...overrides });
const SQUAD: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C', 'SF', 'PF'];
const HEIGHT: Record<Position, number> = { PG: 188, SG: 194, SF: 200, PF: 206, C: 211 };
function team(id: string, extras: Partial<Record<typeof EXTRA_ATTRIBUTES[number], number>>): Team {
  const players: Player[] = SQUAD.map((position, slot) => {
    const base = skills(12);
    return { id: `${id}-${slot}`, name: `${id} ${slot}`, number: slot + 4, position, heightCm: HEIGHT[position], weightKg: 95, skinTone: '#9aa0a8', hairColor: '#3b3f45',
      attributes: { ...base, ...deriveExtraAttributes({ id: `${id}-${slot}`, position, heightCm: HEIGHT[position], attributes: base }), ...extras } };
  });
  return { id, name: id, shortName: id.slice(0, 3).toUpperCase(), color: '#6b7280', players };
}
/** Totals for the side `side` of many games between two squads that differ only in the five abilities. */
function totals(home: Team, away: Team, games: number) {
  const sum = { blocks: 0, turnovers: 0, steals: 0 };
  for (let seed = 1; seed <= games; seed += 1) {
    const end = simulateToEnd(createFixtureMatch(9000 + seed, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off' }));
    for (const player of home.players) { const line = end.stats[player.id]!; sum.blocks += line.blocks; sum.turnovers += line.turnovers; sum.steals += line.steals; }
  }
  return sum;
}

describe('five further abilities: derivation', () => {
  it('derives the same values every time, within 1-20, from size, position and skills', () => {
    const centre = { id: 'c1', position: 'C' as const, heightCm: 214, attributes: skills(12, { rebounding: 17, defense: 15, passing: 8 }), age: 29, minutes: 1800 };
    const guard = { id: 'g1', position: 'PG' as const, heightCm: 186, attributes: skills(12, { rebounding: 6, defense: 15, passing: 17 }), age: 21, minutes: 200 };
    expect(deriveExtraAttributes(centre)).toEqual(deriveExtraAttributes({ ...centre }));
    const big = deriveExtraAttributes(centre), small = deriveExtraAttributes(guard);
    for (const value of [...Object.values(big), ...Object.values(small)]) { expect(Number.isInteger(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(1); expect(value).toBeLessThanOrEqual(20); }
    expect(big.blocking).toBeGreaterThan(small.blocking + 6);
    expect(small.stealing).toBeGreaterThan(big.stealing);
    // Experience: the same player older and with more minutes reads the game better.
    expect(deriveExtraAttributes({ ...guard, age: 30, minutes: 2400 }).intelligence).toBeGreaterThan(small.intelligence);
    const player = { id: 'x', position: 'SF' as const, heightCm: 200, attributes: skills(11) };
    expect(withExtraAttributes(player)).toEqual({ ...skills(11), ...deriveExtraAttributes(player) });
  });

  it('stores all five on every player of a new real-club world and keeps them through a strict save', () => {
    const pack = economyPack([{ id: 'bbl', name: 'easyCredit BBL', country: 'Germany', tier: 1, levels: [16, 14, 13, 12, 11, 10, 9, 8] }]);
    const world = worldFromPack(pack, 'bbl');
    expect(world.clubs.every(club => club.players.every(player => hasExtraAttributes(player.attributes)))).toBe(true);
    const state = createSeason({ seed: 5, world, managedClubId: world.clubs[0]!.id, injuryMode: 'off', ...NEW_CAREER_SYSTEMS });
    const restored = parseSeason(serializeSeason(state));
    expect(restored).toEqual(state);
    expect(hasExtraAttributes(restored.clubs[0]!.players[0]!.attributes)).toBe(true);
    // A record with only some of the five is refused.
    const broken = structuredClone(state) as any;
    delete broken.world.clubs[0].players[0].attributes.mental;
    expect(() => parseSeason(serializeSeason(broken))).toThrow(/five further abilities/);
    // The squad view shows them for the manager's own players.
    const knowledge = getPlayerKnowledge(state, world.clubs[0]!.players[0]!.id);
    const html = renderToStaticMarkup(<ScoutingKnowledge knowledge={knowledge} position={world.clubs[0]!.players[0]!.position} />);
    for (const label of ['Blocking', 'Stealing', 'Intelligence', 'Mental', 'Discipline']) expect(html).toContain(label);
    expect(html).toContain(`data-scouting-attribute="blocking">${world.clubs[0]!.players[0]!.attributes.blocking}<`);
  });
});

describe('five further abilities: match engine and training', () => {
  const opponent = team('opp', {});
  it('better blockers block more, better stealers steal more, smarter handlers lose fewer balls', () => {
    const games = 24;
    const strong = totals(team('strong', { blocking: 19, stealing: 19, intelligence: 19 }), opponent, games);
    const weak = totals(team('weak', { blocking: 4, stealing: 4, intelligence: 4 }), opponent, games);
    expect(strong.blocks).toBeGreaterThan(weak.blocks * 1.3);
    expect(strong.steals).toBeGreaterThan(weak.steals * 1.1);
    expect(strong.turnovers).toBeLessThan(weak.turnovers * .9);
  });

  it('Discipline speeds weekly training progress', () => {
    expect(disciplinedPractice(100, 20)).toBe(120);
    expect(disciplinedPractice(100, 10)).toBe(100);
    expect(disciplinedPractice(100, 1)).toBe(82);
    const withDiscipline = (value: number) => DEVELOPMENT_CLUBS.map(club => ({ ...club, players: club.players.map(player => ({ ...player, attributes: { ...withExtraAttributes(player), discipline: value } })) }));
    const week = (clubs: Team[]) => {
      const training = createTraining(clubs);
      for (const plan of Object.values(training.plans)) Object.assign(plan, { delegated: false, intensity: 'heavy', focus: 'passing' });
      const result = processTrainingWeek({ seed: 42, training, clubs, conditions: Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, 100]))), injuries: [], seasonNumber: 1, afterRound: 1, fromDate: dateForRound(1), toDate: dateForRound(2) });
      return Object.values(result.training.points).reduce((sum, points) => sum + points.passing, 0);
    };
    expect(week(withDiscipline(20))).toBeGreaterThan(week(withDiscipline(5)));
  });
});

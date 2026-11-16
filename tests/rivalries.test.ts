import { beforeAll, describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import { DEVELOPMENT_RIVALRIES } from '../src/data/development-rivalries';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { forecastGate } from '../src/world/finance';
import { getPlayerRelationship } from '../src/world/relationships';
import { createRivalries, enableRivalries, governingDerby, rivalryFor } from '../src/world/rivalries';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { advanceMatchday } from './helpers/board-funding';
import { currentSeasonFile } from './helpers/season-format';
import { DEVELOPMENT_WORLD } from '../src/data/development-world';

const manager = { name: 'Derby Manager', dateOfBirth: '1984-03-17', nationality: 'Germany' };
// The career without rivalries stands for an older save, so it also has no press and media record (format 67) and no president board (format 70).
const career = (rivalries: boolean) => createSeason({ seed: 227, managedClubId: 'rhine-falcons', injuryMode: 'standard', manager, ...NEW_CAREER_SYSTEMS, rivalries, media: rivalries, presidents: rivalries });
const resultsReason = (state: SeasonState, playerId: string) => getPlayerRelationship(state, playerId).reasons.find(reason => reason.label === 'Recent team results')!.impact;
let derbyWeek: SeasonState, legacy: SeasonState, switched: SeasonState;

beforeAll(() => {
  // Seed 227: Rhine Falcons win the river derby away at Danube Lynx on matchday 2.
  derbyWeek = career(true);
  while (derbyWeek.round <= 3) derbyWeek = advanceMatchday(derbyWeek);
  legacy = career(false);
  while (legacy.round < 4) legacy = advanceMatchday(legacy);
  switched = enableRivalries(legacy);
  for (let step = 0; step < 4; step += 1) switched = advanceMatchday(switched);
}, 120_000);

describe('rivalry rules', () => {
  it('gives every club exactly one fictional rival', () => {
    const clubs = createSeason().clubs.map(club => club.id);
    for (const club of clubs) expect(DEVELOPMENT_RIVALRIES.filter(rivalry => rivalry.clubIds.includes(club))).toHaveLength(1);
    expect(rivalryFor('rhine-falcons', DEVELOPMENT_WORLD)).toMatchObject({ rivalId: 'danube-lynx', rivalry: { name: 'River derby', intensity: 3 } });
    expect(DEVELOPMENT_RIVALRIES.every(rivalry => rivalry.origin === 'fictional-development-league')).toBe(true);
  });

  it('counts derbies only from the matchday the rivalries govern', () => {
    const fresh = career(true).rivalries;
    expect(fresh.enabledSince?.effectiveFrom).toEqual({ seasonNumber: 1, round: 1 });
    expect(governingDerby(fresh, 'danube-lynx', 'rhine-falcons', 1, 1, DEVELOPMENT_WORLD)?.id).toBe('river-derby');
    expect(governingDerby(fresh, 'danube-lynx', 'aegean-waves', 1, 1, DEVELOPMENT_WORLD)).toBeNull();
    expect(switched.rivalries.enabledSince?.effectiveFrom).toEqual({ seasonNumber: 1, round: 5 });
    expect(governingDerby(switched.rivalries, 'danube-lynx', 'rhine-falcons', 1, 4, DEVELOPMENT_WORLD)).toBeNull();
    expect(governingDerby(createRivalries(), 'danube-lynx', 'rhine-falcons', 1, 5, DEVELOPMENT_WORLD)).toBeNull();
  });

  it('draws a bigger derby crowd by 5% per point of intensity', () => {
    const fixture = derbyWeek.fixtures.find(item => item.homeClubId === 'rhine-falcons' && item.awayClubId === 'danube-lynx')!;
    const price = 4000;
    const plain = forecastGate({ ...derbyWeek, rivalries: createRivalries() }, fixture, price);
    const derby = forecastGate(derbyWeek, fixture, price);
    expect(plain.attendance).toBeLessThan(plain.capacity);
    expect(derby.attendance / plain.attendance).toBeGreaterThan(1.14);
    expect(derby.attendance / plain.attendance).toBeLessThan(1.16);
  });
});

describe('rivalries in a career', () => {
  it('lets the board weigh derby results within limits', () => {
    const review = derbyWeek.board.reviews.find(item => item.round === 2)!;
    expect(review.clubs['rhine-falcons']!.rivalryImpact).toBe(3);
    expect(review.clubs['danube-lynx']!.rivalryImpact).toBe(-3);
    expect(review.clubs['aegean-waves']!.rivalryImpact).toBe(0);
    expect(review.clubs['rhine-falcons']!.assessment).toBe(50 + review.clubs['rhine-falcons']!.resultsImpact + review.clubs['rhine-falcons']!.injuryRelief + review.clubs['rhine-falcons']!.financeImpact + 3);
  });

  it('makes a derby result count double in the team-results part of morale', () => {
    const player = derbyWeek.clubs.find(club => club.id === 'rhine-falcons')!.players[0]!.id;
    expect(resultsReason(derbyWeek, player)).not.toBe(resultsReason({ ...derbyWeek, rivalries: createRivalries() }, player));
  });

  it('switches on prospectively in older careers, leaving earlier reviews unchanged, and the save validates', () => {
    expect(switched.board.reviews.find(item => item.round === 4)!.clubs['rhine-falcons']).not.toHaveProperty('rivalryImpact');
    expect(switched.board.reviews.find(item => item.round === 5)!.clubs['rhine-falcons']).toHaveProperty('rivalryImpact');
    expect(parseSeason(serializeSeason(switched))).toEqual(switched);
    expect(enableRivalries(switched)).toBe(switched);
  });

  it.each([
    ['a backdated start', (copy: SeasonState) => { copy.rivalries.enabledSince!.effectiveFrom = { seasonNumber: 1, round: 1 }; }],
    ['an invented date', (copy: SeasonState) => { copy.rivalries.enabledSince!.date = '2026-12-24'; }],
    ['a removed derby assessment', (copy: SeasonState) => { delete copy.board.reviews.find(item => item.round === 5)!.clubs['rhine-falcons']!.rivalryImpact; }],
  ])('rejects %s', (_label, mutate) => {
    const copy = structuredClone(switched);
    mutate(copy);
    expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/);
  });

  it('rejects rivalries in a format-34 file', () => {
    const file = JSON.parse(serializeSeason(legacy));
    file.formatVersion = 34; file.state.schemaVersion = 34;
    // Format 34 also predates upkeep plans and club changes; this career has made no upkeep choice and no move.
    expect(file.state.facilities.events.some((event: { type: string }) => event.type === 'maintenance')).toBe(false);
    delete file.state.facilities.maintenanceSince;
    delete file.state.career;
    expect(() => parseSeason(JSON.stringify(file))).toThrow(/unsupported fields/);
    delete file.state.rivalries;
    expect(parseSeason(JSON.stringify(file)).rivalries).toEqual(createRivalries());
  });
});

import { describe, expect, it } from 'vitest';
import type { SeasonState } from '../src/domain/season';
import type { CareerWorld } from '../src/domain/world';
import { nbaPack, NBA_CLUB_IDS } from './helpers/nba-pack';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { placesDayInput } from '../src/world/european-entry-day';
import { decidePlaces } from '../src/world/european-entry';
import { usesLongCareers } from '../src/world/long-careers';
import { clubEconomy } from '../src/world/economy';
import { fullWorldClubsIn } from '../src/world/career-world';
import { seasonSalaryBudget } from '../src/world/board-consequences';
import { spendingAppetite, SURPLUS_SPENDING_RULES, surplusWageRoom } from '../src/world/surplus-spending';

/**
 * Format 97 (release check "long careers", `world.longCareers`): the fixes found by ten-season automatic careers on the
 * live pack. NBA clubs take no European places; a club the manager takes over during an offseason keeps a computer
 * club's wage room for the rest of that window. Worlds without the marker (format 96 and earlier) keep their rules.
 */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [16, 16, 15, 15, 14, 14, 13, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8] };
const withoutMarker = (world: CareerWorld): CareerWorld => { const { longCareers: _marker, ...rest } = world; return rest as CareerWorld; };
const play = (state: SeasonState) => advanceSeason(state.activeMatch && state.activeMatch.status !== 'finished' ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);

describe('the long-careers marker (format 97)', () => {
  const world = worldFromPack(economyPack([SPAIN]), 'acb');

  it('marks new careers in worlds with club money, and format 96 refuses the marker', () => {
    const state = createSeason({ seed: 5, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS });
    expect(state.world!.longCareers).toBe(true);
    expect(usesLongCareers(state)).toBe(true);
    expect(createSeason({ seed: 5, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS, longCareers: false }).world!.longCareers).toBeUndefined();
    expect(createSeason({ seed: 5, ...NEW_CAREER_SYSTEMS }).world?.longCareers).toBeUndefined();
    expect(() => createSeason({ seed: 5, world, longCareers: 'yes' as unknown as boolean })).toThrow(/long careers setting/);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 96; envelope.state.schemaVersion = 96;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/longCareers.*format 97/);
    // A format-96 career (no marker) still loads.
    const older = JSON.parse(serializeSeason(createSeason({ seed: 5, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS, longCareers: false, careerBalance: false, cashBalance: false, squadRefresh: false, generatedPeople: false })));
    older.formatVersion = 96; older.state.schemaVersion = 96;
    expect(parseSeason(JSON.stringify(older)).world!.longCareers).toBeUndefined();
    const unpriced = JSON.parse(serializeSeason(state));
    delete unpriced.state.world.economy;
    expect(() => parseSeason(JSON.stringify(unpriced))).toThrow();
  });
});

describe('NBA clubs and European places (format 97)', () => {
  // The NBA with Spain's top division and a EuroLeague of three Spanish and fifteen other clubs.
  const foreign = Array.from({ length: 15 }, (_, index) => ({ id: `el-${index + 1}`, country: index % 2 ? 'Greece' : 'Turkey', level: 15 - (index % 4) }));
  const world = worldFromPack(nbaPack([SPAIN], { members: ['acb-1', 'acb-2', 'acb-3'], foreign }), ['acb', 'nba']);

  it('keeps NBA clubs out of every top division the places day reads, so no NBA club is offered a place', () => {
    expect(world.europeanCompetitions!.some(item => item.format)).toBe(true);
    const state = createSeason({ seed: 7, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS });
    expect(usesLongCareers(state)).toBe(true);
    const input = placesDayInput(state, { provisional: true });
    for (const clubId of NBA_CLUB_IDS) expect(input.facts.get(clubId)).toMatchObject({ topNow: false, topNext: false });
    expect(input.rankings.has('USA')).toBe(false);
    expect(input.facts.get('acb-5')!.topNow).toBe(true);
    const decided = decidePlaces(input);
    expect(decided.entrants.flatMap(entry => entry.clubIds).filter(clubId => NBA_CLUB_IDS.includes(clubId))).toEqual([]);
    // Format 96 and earlier: NBA clubs counted as top-division clubs (an NBA club could win a EuroLeague wild card).
    const older = createSeason({ seed: 7, world: withoutMarker(world), managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS, longCareers: false });
    const before = placesDayInput(older, { provisional: true });
    expect(before.facts.get(NBA_CLUB_IDS[0]!)!.topNow).toBe(true);
    expect(before.rankings.has('USA')).toBe(true);
  }, 120_000);
});

describe('a club taken over during an offseason keeps its wage room (format 97)', () => {
  const world = worldFromPack(economyPack([SPAIN]), 'acb');

  it('gives the taken-over club a computer club\'s room for the rest of the window, and none in format 96', () => {
    let state = createSeason({ seed: 9, world, managedClubId: 'acb-9', ...NEW_CAREER_SYSTEMS });
    while (state.status === 'active') state = play(state);
    const club = fullWorldClubsIn(state, 1).map(item => item.id).find(clubId => clubId !== state.managedClubId && spendingAppetite(world, clubId) === 1)!;
    // Plenty of season-end cash: the computer club has wage room for next season's contracts.
    const amount = Math.round(clubEconomy(state, club)!.budget * 2);
    const flush: SeasonState = { ...state, finance: { ...state.finance, ledger: [{ id: `finance-test-${club}`, clubId: club, seasonNumber: 1, round: 1, kind: 'opening', amount, sourceId: 'test', ticket: null, coach: null, payroll: null }, ...state.finance.ledger] } };
    const room = surplusWageRoom(flush, club, 2);
    expect(room).toBe(Math.floor(seasonSalaryBudget(flush, club, 2) * SURPLUS_SPENDING_RULES.maxWageRaise / 50_000) * 50_000);
    // The manager takes the club over in this offseason (from no club).
    const move = { seasonNumber: 1, date: flush.date, fromClubId: '', toClubId: club, reason: 'appointed' as const, ledgerCount: 0, round: 43, phase: 'offseason' as const };
    const takenOver: SeasonState = { ...flush, managedClubId: club, career: { ...flush.career, moves: [...flush.career.moves, move] } };
    expect(surplusWageRoom(takenOver, club, 2)).toBe(room);
    // Not for a club he ran before this offseason, nor for a takeover recorded for another season, nor in format 96.
    expect(surplusWageRoom({ ...takenOver, career: flush.career }, club, 2)).toBe(0);
    expect(surplusWageRoom({ ...takenOver, career: { ...flush.career, moves: [...flush.career.moves, { ...move, seasonNumber: 0 }] } }, club, 2)).toBe(0);
    expect(surplusWageRoom({ ...takenOver, career: { ...flush.career, moves: [...flush.career.moves, { ...move, phase: 'end' as const }] } }, club, 2)).toBe(0);
    expect(surplusWageRoom({ ...takenOver, world: withoutMarker(takenOver.world!) }, club, 2)).toBe(0);
    // Once the next season starts, the manager's club has no room of its own again.
    expect(surplusWageRoom({ ...takenOver, status: 'active' }, club, 2)).toBe(0);
  }, 300_000);
});

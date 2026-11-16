import { describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { advanceSeason, createSeason, managedSide, NEW_CAREER_SYSTEMS, rolloverSeason } from '../src/world/season';
import { parseSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { setEmploymentDelegation } from '../src/world/employment';
import { advanceMarket } from '../src/world/market';
import { getMarketStartReason } from '../src/world/market-policy';
import { fullWorldClubs, validateWorld, worldPlayers } from '../src/world/career-world';
import { getActiveCareerPlayers } from '../src/world/player-catalog';
import { LOWER_DIVISION_RULES, squadStrength, withLowerDivisions } from '../src/world/lower-division';
import { currentSeasonFile } from './helpers/season-format';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PostseasonPanel } from '../src/ui/PostseasonPanel';
import { GeneratedTag } from '../src/ui/GeneratedTag';
import { ScoutingWorkspace } from '../src/ui/ScoutingWorkspace';

/** Testland's two divisions (six clubs each, with postseasons) and its real third division of four clubs. */
export function lowerWorld(clubs = 4, secondFormat = 'test-tier2-2') {
  // Six clubs in each division: the second division's last place is relegated into the third (test-tier2-2).
  const base = testWorld(12);
  const world = { ...base, id: 'lower-division-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: base.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1', standingsRule: 'fiba-2026-d' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: base.clubs.slice(6).map(club => club.id), postseason: secondFormat, standingsRule: 'fiba-2026-d' },
  ] };
  return withLowerDivisions(world, [{ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: clubs }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) }]);
}
const play = state => advanceSeason(state.activeMatch ? { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) } : state);
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

describe('next-division clubs built into the world (step 3.4d-2)', () => {
  it('gives each a labelled generated squad just below the division above, with estimated club data', () => {
    const world = lowerWorld();
    expect(() => validateWorld(world)).not.toThrow();
    const lower = world.clubs.filter(club => club.id.startsWith('third-'));
    expect(lower).toHaveLength(4);
    const second = world.domesticLeagues[1].clubIds.map(id => squadStrength(world.clubs.find(club => club.id === id).players));
    for (const club of lower) {
      expect(club.players.every(player => world.playerProfiles[player.id].source === 'generated' && player.id.includes('-generated-'))).toBe(true);
      expect(Math.abs(squadStrength(club.players) - (Math.min(...second) - LOWER_DIVISION_RULES.generatedBelow))).toBeLessThanOrEqual(2);
      expect(world.finances.some(item => item.clubId === club.id) && world.presidents.some(item => item.clubId === club.id)).toBe(true);
      expect(club.players.every(player => world.wages[player.id] > 0 && [1, 2, 3].includes(world.playerContracts?.[player.id] ?? 1))).toBe(true);
    }
    expect(fullWorldClubs(world).map(club => club.id)).toEqual(world.domesticLeagues.flatMap(league => league.clubIds).sort((a, b) => world.clubs.findIndex(club => club.id === a) - world.clubs.findIndex(club => club.id === b)));
    expect(worldPlayers(world).some(player => player.id.includes('-generated-'))).toBe(false);
    // Generated squads must stay labelled, and a next-division club cannot also be in a league.
    const relabelled = structuredClone(world); relabelled.playerProfiles[lower[0].players[0].id].source = 'official-profile';
    expect(() => validateWorld(relabelled)).toThrow(/generated squads/);
    const doubled = structuredClone(world); doubled.domesticLeagues[1].clubIds[0] = 'third-1';
    expect(() => validateWorld(doubled)).toThrow(/domesticLeagues|outside every league/);
    expect(() => withLowerDivisions(world, [])).toThrow(/already/);
  });

  it('exchanges clubs with the next division at each season end: leaving, returning and first-time clubs, with strict saves', () => {
    const world = lowerWorld();
    // Seed 2 (31 before the saved ideas level): a first-time club joins in season one, the relegated club returns in
    // season two and another first-time club comes up in season three.
    let state = setEmploymentDelegation(createSeason({ world, seed: 2, managedClubId: world.clubs[0].id, ...NEW_CAREER_SYSTEMS }), true);
    const generated = new Set(world.clubs.filter(club => club.id.startsWith('third-')).flatMap(club => club.players.map(player => player.id)));
    const finishSeason = () => {
      while (state.status === 'active') { state = play(state); if (state.round === 5) expect(roundTrip(state)).toEqual(state); }
      expect(roundTrip(state)).toEqual(state);
      for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
      expect(getMarketStartReason(state)).toBeNull();
      expect(roundTrip(state)).toEqual(state);
    };
    // Season one: the second division's last club leaves with its squad; a first-time club joins with its generated squad.
    expect(getActiveCareerPlayers(state).some(player => generated.has(player.id))).toBe(false);
    finishSeason();
    // The relegated club follows from the season's results.
    const relegated = state.background.exchanges[0]?.leaving[0];
    expect(state.background.exchanges).toEqual([{ seasonNumber: 1, leagueId: 'second', leaving: [relegated], joining: ['third-1'] }]);
    expect(world.domesticLeagues[1].clubIds).toContain(relegated);
    const leaving = state.clubs.find(club => club.id === relegated);
    state = rolloverSeason(state);
    expect(roundTrip(state)).toEqual(state);
    expect(state.divisions.leagues[1].clubIds).toContain('third-1');
    expect(state.clubs.map(club => club.id)).toContain('third-1');
    expect(state.clubs.map(club => club.id)).not.toContain(relegated);
    expect(state.background.clubs).toMatchObject([{ id: relegated, origin: 'relegated', since: 2, country: 'Testland' }]);
    expect(state.background.clubs[0].players.every(player => leaving.players.some(item => item.id === player.id))).toBe(true);
    expect(state.employment.departures).toMatchObject([{ clubId: relegated, seasonNumber: 1, startsSeason: 2 }]);
    const joined = state.employment.contracts.filter(contract => contract.kind === 'joined');
    expect(joined.map(contract => contract.playerId)).toEqual(world.clubs.find(club => club.id === 'third-1').players.map(player => player.id));
    expect(joined.every(contract => contract.clubId === 'third-1' && contract.startsSeason === 2 && contract.seasonWage === world.wages[contract.playerId])).toBe(true);
    expect(state.finance.ledger.some(entry => entry.clubId === 'third-1' && entry.kind === 'opening' && entry.sourceId === 'opening-s2')).toBe(true);
    // Players away with their club cannot be signed or scouted; the joining club's players are contracted career players.
    const away = new Set(state.background.clubs[0].players.map(player => player.id));
    expect(getActiveCareerPlayers(state).some(player => away.has(player.id))).toBe(false);
    expect(getActiveCareerPlayers(state).some(player => generated.has(player.id))).toBe(true);
    // Screens (step 3.4d-3): the playoff panel names who left and who joined; generated players are labelled.
    const panel = (seasonNumber, leagueId = 'second') => renderToStaticMarkup(createElement(PostseasonPanel, { season: state, seasonNumber, leagueId, managedId: state.managedClubId }));
    const name = id => world.clubs.find(club => club.id === id).name;
    expect(panel(1)).toContain(`<strong>Leaving</strong>${name(relegated)}`);
    expect(panel(1)).toContain(`<strong>Joining</strong>${name('third-1')} (generated squad)`);
    expect(panel(1)).toContain('from Third division');
    expect(panel(1)).not.toContain('they stay');
    const generatedId = world.clubs.find(club => club.id === 'third-1').players[0].id, realId = world.clubs[0].players[0].id;
    expect(renderToStaticMarkup(createElement(GeneratedTag, { season: state, playerId: generatedId }))).toContain('Generated');
    expect(renderToStaticMarkup(createElement(GeneratedTag, { season: state, playerId: realId }))).toBe('');
    const scouting = renderToStaticMarkup(createElement(ScoutingWorkspace, { season: state, disabled: false, selectedPlayerId: generatedId, onSelectPlayer() {}, onEnable() {}, onAssign() {}, onCancel() {}, onShortlist() {}, onDelegation() {}, onOpenTransfers() {}, onOpenScouts() {} }));
    expect(scouting).toMatch(/id="scouting-player-title">[^<]+<small class="generated-tag"/);
    // Season two: the club that left comes back with its squad.
    finishSeason();
    const second = state.background.exchanges.at(-1)?.leaving[0];
    expect(state.background.exchanges.at(-1)).toEqual({ seasonNumber: 2, leagueId: 'second', leaving: [second], joining: [relegated] });
    expect(second).not.toBe(relegated);
    state = rolloverSeason(state);
    expect(roundTrip(state)).toEqual(state);
    expect(state.background.clubs.map(club => [club.id, club.since, club.until])).toEqual([[relegated, 2, 3], [second, 3, undefined]]);
    expect(state.clubs.find(club => club.id === relegated).players.map(player => player.id).sort()).toEqual([...away].sort());
    expect(state.finance.ledger.some(entry => entry.clubId === relegated && entry.sourceId === 'opening-s3')).toBe(false);
    expect(panel(2)).toContain(`${name(relegated)} (returning)`);
    // Season three: the division's last club goes down and another first-time club comes up.
    finishSeason();
    const third = state.background.exchanges.at(-1)?.leaving[0];
    expect(state.background.exchanges.at(-1)).toEqual({ seasonNumber: 3, leagueId: 'second', leaving: [third], joining: ['third-3'] });
    state = rolloverSeason(state);
    expect(roundTrip(state)).toEqual(state);
    expect(state.background.clubs.at(-1)).toMatchObject({ id: third, since: 4 });
    expect(state.divisions.leagues.map(league => league.clubIds.length)).toEqual([6, 6]);
    // Saves whose exchanges, records or released terms do not follow the career are refused.
    const tamper = change => { const copy = structuredClone(state); change(copy); expect(() => parseSeason(currentSeasonFile(copy))).toThrow(/Invalid season save/); };
    tamper(copy => { copy.background.exchanges[0].joining = ['third-2']; });
    tamper(copy => { copy.background.clubs[0].players.pop(); });
    tamper(copy => { copy.background.clubs[0].until = 4; });
    tamper(copy => { copy.employment.departures[0].releasedContractIds.push('employment-contract-1'); });
    tamper(copy => { delete copy.employment.departures; });
    tamper(copy => { const contract = copy.employment.contracts.find(item => item.kind === 'joined'); contract.seasonWage += 50_000; });
  }, 900_000);

  it('treats a manager whose club leaves the full world as dismissed, with a job offer at a full-world club (owner decision a)', () => {
    const world = lowerWorld();
    // Seed 33 (11 before the match calibration of sprint 4): the managed club finishes last in the second division.
    let state = setEmploymentDelegation(createSeason({ world, seed: 33, managedClubId: 'w1-rhine-falcons', ...NEW_CAREER_SYSTEMS }), true);
    while (state.status === 'active') state = play(state);
    expect(state.background.exchanges[0].leaving).toEqual(['w1-rhine-falcons']);
    expect(state.career.moves).toMatchObject([{ seasonNumber: 1, fromClubId: 'w1-rhine-falcons', reason: 'dismissed' }]);
    expect(state.managedClubId).not.toBe('w1-rhine-falcons');
    expect(state.clubs.some(club => club.id === state.managedClubId)).toBe(true);
    expect(roundTrip(state)).toEqual(state);
    for (let step = 0; step < 120 && getMarketStartReason(state); step += 1) state = advanceMarket(state);
    state = rolloverSeason(state);
    expect(state.background.clubs.map(club => club.id)).toEqual(['w1-rhine-falcons']);
    expect(roundTrip(state)).toEqual(state);
  }, 600_000);
});

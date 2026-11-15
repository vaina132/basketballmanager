import { describe, expect, it } from 'vitest';
import { testWorld } from './world-fixtures';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { validateWorld } from '../src/world/career-world';
import { withLowerDivisions } from '../src/world/lower-division';
import { backgroundClubFrom, backgroundMatchday, backgroundSquad, createBackground, validateBackgroundClub } from '../src/world/background';
import { currentSeasonFile } from './helpers/season-format';

/** Testland's two divisions (six and five clubs, with postseasons) and, optionally, its real third division. */
function divisionWorld(lowerDivisions) {
  const world = testWorld(11);
  return { ...world, id: 'background-test', rosterModel: 'club-roster-1', domesticLeagues: [
    { id: 'first', name: 'First division', country: 'Testland', tier: 1, clubIds: world.clubs.slice(0, 6).map(club => club.id), postseason: 'test-tier1-1' },
    { id: 'second', name: 'Second division', country: 'Testland', tier: 2, clubIds: world.clubs.slice(6).map(club => club.id), postseason: 'test-tier2-1' },
  ], ...(lowerDivisions ? { lowerDivisions } : {}) };
}
const third = (clubs = 4) => ({ country: 'Testland', tier: 3, name: 'Third division', clubs: Array.from({ length: clubs }, (_, index) => ({ id: `third-${index + 1}`, name: `Third Club ${index + 1}`, shortName: `TC${index + 1}`, color: '#336699' })) });
const roundTrip = state => parseSeason(serializeSeasonCompact(state));

describe('the world\'s lower-division lists (step 3.4d-1)', () => {
  it('accepts a format-53 identity list in the world, but saves carry the clubs themselves from format 54', () => {
    const world = divisionWorld([third()]);
    expect(() => validateWorld(world)).not.toThrow();
    const state = createSeason({ world, managedClubId: world.clubs[0].id });
    expect(() => serializeSeasonCompact(state)).toThrow(/must list clubs of the world from format 54/);
    const built = withLowerDivisions(divisionWorld(), [third()]);
    expect(built.lowerDivisions).toEqual([{ country: 'Testland', tier: 3, name: 'Third division', clubIds: third().clubs.map(club => club.id) }]);
    const career = createSeason({ world: built, managedClubId: built.clubs[0].id });
    expect(roundTrip(career)).toEqual(career);
    const envelope = JSON.parse(serializeSeason(career));
    envelope.formatVersion = 53; envelope.state.schemaVersion = 53;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/requires format 54/);
  });

  it('refuses a wrong tier, a country outside the world, Italy and France, and clubs already in the world or listed twice', () => {
    expect(() => validateWorld(divisionWorld([{ ...third(), tier: 2 }]))).toThrow(/lowerDivisions\[0\]\.tier/);
    expect(() => validateWorld(divisionWorld([{ ...third(), country: 'Elsewhere' }]))).toThrow(/tier/);
    const italian = divisionWorld([{ ...third(), country: 'Italy' }]);
    italian.domesticLeagues = italian.domesticLeagues.map(league => ({ ...league, country: 'Italy', postseason: undefined })).map(({ postseason, ...league }) => league);
    expect(() => validateWorld(italian)).toThrow(/no relegation out of the full world/);
    const taken = third(); taken.clubs[0].id = divisionWorld().clubs[0].id;
    expect(() => validateWorld(divisionWorld([taken]))).toThrow(/lowerDivisions\[0\]\.clubs/);
    const twice = third(); twice.clubs[1].id = twice.clubs[0].id;
    expect(() => validateWorld(divisionWorld([twice]))).toThrow(/clubs/);
    expect(() => validateWorld(divisionWorld([third(), third()]))).toThrow(/country once/);
    expect(() => validateWorld(divisionWorld([{ ...third(), extra: true }]))).toThrow(/country once/);
  });

  it('refuses lower-division lists disguised as format 52', () => {
    const envelope = JSON.parse(serializeSeason(createSeason({ world: withLowerDivisions(divisionWorld(), [third()]) })));
    envelope.formatVersion = 52; envelope.state.schemaVersion = 52; delete envelope.state.background;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/requires format 53/);
  });
});

describe('the record of clubs outside the full world (step 3.4d-1)', () => {
  it('starts empty exactly in careers that record divisions, and is checked in saves', () => {
    const state = createSeason({ world: divisionWorld(), seed: 4, ...NEW_CAREER_SYSTEMS });
    expect(state.background).toEqual(createBackground());
    expect(roundTrip(state)).toEqual(state);
    const plain = testWorld(6);
    const withoutPostseason = createSeason({ world: { ...plain, rosterModel: 'club-roster-1', domesticLeagues: [{ id: 'only', name: 'Only league', country: 'Testland', tier: 1, clubIds: plain.clubs.map(club => club.id) }] } });
    expect(withoutPostseason.background).toBeUndefined();
    expect(roundTrip(withoutPostseason)).toEqual(withoutPostseason);
    const missing = structuredClone(state); delete missing.background;
    expect(() => parseSeason(currentSeasonFile(missing))).toThrow(/background must record/);
    const extra = { ...structuredClone(withoutPostseason), background: createBackground() };
    expect(() => parseSeason(currentSeasonFile(extra))).toThrow(/background requires/);
    const model = structuredClone(state); model.background.model = 'background-0';
    expect(() => parseSeason(currentSeasonFile(model))).toThrow(/background must be a background-1 record/);
    const envelope = JSON.parse(serializeSeason(state));
    envelope.formatVersion = 52; envelope.state.schemaVersion = 52;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/Invalid season save/);
  });

  it('refuses any listed club until clubs can leave the full world (step 3.4d-2)', () => {
    const state = createSeason({ world: divisionWorld(), seed: 4, ...NEW_CAREER_SYSTEMS });
    const listed = structuredClone(state);
    listed.background.clubs.push(backgroundClubFrom(state, state.divisions.leagues[1].clubIds[0], 2));
    expect(() => parseSeason(currentSeasonFile(listed))).toThrow(/Invalid season save: background/);
  });

  it('makes a background club from a full-world club with its world identity, country and an independent copy of its squad', () => {
    const state = createSeason({ world: divisionWorld(), seed: 4, ...NEW_CAREER_SYSTEMS });
    const clubId = state.divisions.leagues[1].clubIds.at(-1);
    const club = backgroundClubFrom(state, clubId, 2);
    const identity = state.world.clubs.find(item => item.id === clubId);
    expect(club).toMatchObject({ id: clubId, name: identity.name, shortName: identity.shortName, color: identity.color, country: 'Testland', origin: 'relegated', since: 2 });
    expect(club.players).toEqual(state.clubs.find(item => item.id === clubId).players);
    club.players[0].attributes.defense = 1;
    expect(state.clubs.find(item => item.id === clubId).players[0].attributes.defense).not.toBe(1);
    expect(() => backgroundClubFrom(state, 'nobody', 2)).toThrow(/not in the full world/);
  });

  it('checks a background club against the season: outside its divisions, same identity, an earlier departure and players nobody else holds', () => {
    const state = createSeason({ world: divisionWorld(), seed: 4, ...NEW_CAREER_SYSTEMS });
    const clubId = state.divisions.leagues[1].clubIds.at(-1);
    const club = backgroundClubFrom(state, clubId, 2);
    // The season after the club left: it is in no division and no longer among the full world's clubs.
    const later = { ...state, seasonNumber: 2, clubs: state.clubs.filter(item => item.id !== clubId), divisions: { ...state.divisions, leagues: state.divisions.leagues.map(league => ({ ...league, clubIds: league.clubIds.filter(id => id !== clubId) })) } };
    expect(() => validateBackgroundClub(club, 'club', later, new Set())).not.toThrow();
    const check = (change, pattern, context = later) => { const copy = structuredClone(club); change(copy); expect(() => validateBackgroundClub(copy, 'club', context, new Set())).toThrow(pattern); };
    check(copy => { copy.name = 'Renamed'; }, /identity/);
    check(copy => { copy.country = 'Elsewhere'; }, /identity/);
    check(copy => { copy.since = 1; }, /since/);
    check(copy => { copy.since = 3; }, /since/);
    check(copy => { copy.origin = 'european'; }, /origin/);
    check(copy => { copy.players = copy.players.slice(0, 4); }, /players/);
    check(copy => { copy.players[1] = { ...copy.players[1], id: copy.players[0].id }; }, /unique/);
    check(copy => { copy.players[0] = { ...copy.players[0], id: state.clubs[0].players[0].id }; }, /registered with a full-world club/);
    check(() => {}, /outside this season's divisions/, { ...later, divisions: state.divisions });
  });

  it('ages a squad by the dated decline without training, and picks a legal matchday selection', () => {
    const state = createSeason({ world: divisionWorld(), seed: 4, ...NEW_CAREER_SYSTEMS });
    expect(state.lifecycle.enabledSince).not.toBeNull();
    const club = backgroundClubFrom(state, state.divisions.leagues[0].clubIds[0], 2);
    const now = backgroundSquad(state, club, state.date), later = backgroundSquad(state, club, '2030-09-07');
    expect(now.players).toEqual(club.players);
    const keys = Object.keys(club.players[0].attributes);
    for (const [index, player] of later.players.entries()) for (const key of keys) expect(player.attributes[key]).toBeLessThanOrEqual(now.players[index].attributes[key]);
    expect(later.players.some((player, index) => keys.some(key => player.attributes[key] < now.players[index].attributes[key]))).toBe(true);
    const selection = backgroundMatchday(state, club, state.date);
    expect(selection.players.length).toBe(Math.min(12, club.players.length));
    for (const position of new Set(club.players.map(player => player.position))) expect(selection.players.some(player => player.position === position)).toBe(true);
    const injured = new Set(club.players.slice(0, 3).map(player => player.id));
    const fit = backgroundMatchday(state, club, state.date, injured);
    if (club.players.length - 3 >= 12) expect(fit.players.some(player => injured.has(player.id))).toBe(false);
    const almostAll = new Set(club.players.slice(0, club.players.length - 2).map(player => player.id));
    expect(backgroundMatchday(state, club, state.date, almostAll).players.length).toBeGreaterThanOrEqual(5);
  });
});

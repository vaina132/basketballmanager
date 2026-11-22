import { describe, expect, it } from 'vitest';
import type { CareerWorld } from '../src/domain/world';
import type { SeasonState } from '../src/domain/season';
import { createSeason, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { REAL_COACHES, REAL_COACH_POSTS } from '../src/data/real-coaches';
import { coachOverall, estimateCoach, NO_TITLES, recordScore } from '../src/world/coach-ratings';
import { clubHeadCoach, coachPlaces, coachTactics, coachWorld, headCoach, managerAttributes, managerSeasonChange, managerStartAttributes, MANAGER_COACH, recordManagerSeason, youthTrustFive } from '../src/world/head-coaches';
import { restartBoard } from '../src/world/career';
import { validateCoachesShape } from '../src/storage/coaches-validation';
import { nationalWorld } from './helpers/national-world';
import { setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { managedSide } from '../src/world/season';
import { runContinueStep } from '../src/world/continue-step';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';

/** Continue until `until` holds, finishing the manager's matches automatically. */
function playUntil(start: SeasonState, until: (state: SeasonState) => boolean): SeasonState {
  let state = start;
  for (let guard = 0; guard < 400 && !until(state); guard += 1) {
    if (state.activeMatch && state.activeMatch.status !== 'finished') { state = { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) }; continue; }
    const result = runContinueStep(state, { decided: true });
    if ('outlook' in result) throw new Error('No board decision is expected here.');
    state = result.state;
  }
  if (!until(state)) throw new Error('The career did not reach the expected point.');
  return state;
}

const FENERBAHCE = REAL_COACH_POSTS.find(post => post.team === 'Fenerbahçe')!.teamId;
const EFES = REAL_COACH_POSTS.find(post => post.team === 'Anadolu Efes')!.teamId;
const BESIKTAS = REAL_COACH_POSTS.find(post => post.team === 'Beşiktaş')!.teamId;

/** The national test world with its first three clubs given the real ids of Fenerbahçe, Anadolu Efes and Beşiktaş. */
function realWorld(): CareerWorld {
  const base = nationalWorld();
  let text = JSON.stringify(base);
  [FENERBAHCE, EFES, BESIKTAS].forEach((id, index) => { text = text.replaceAll(`"${base.clubs[index]!.id}"`, `"${id}"`); });
  return JSON.parse(text) as CareerWorld;
}
const world = realWorld();
const create = (options: Record<string, unknown> = {}) => createSeason({ seed: 11, world, managedClubId: FENERBAHCE, ...NEW_CAREER_SYSTEMS, manager: { name: 'Test Manager', dateOfBirth: '1980-05-01', nationality: 'Turkey' }, ...options });

describe('real head coaches (format 82)', () => {
  it('keeps the gathered facts complete and the formula reproducible', () => {
    expect(REAL_COACHES.length).toBeGreaterThan(150);
    const ids = new Set(REAL_COACHES.map(coach => coach.id));
    expect(ids.size).toBe(REAL_COACHES.length);
    for (const post of REAL_COACH_POSTS) expect(ids.has(post.coachId)).toBe(true);
    // 221 of 222 clubs (not MKE Ankaragücü, whose coach left on 10 November 2026; no successor found by 22 November)
    // and all 24 national teams; a coach holds at most one club post, and a post checked against a current source wins
    // over an older page (Rémy Valin left Fos for Nantes; Sacripanti coaches Urania; Pete Strobl replaced Giorgio Valli
    // at Pesaro on 17 November 2026).
    expect(REAL_COACH_POSTS.filter(post => !post.teamId.startsWith('nation-'))).toHaveLength(221);
    expect(REAL_COACH_POSTS.filter(post => post.teamId.startsWith('nation-'))).toHaveLength(24);
    const clubPosts = REAL_COACH_POSTS.filter(post => !post.teamId.startsWith('nation-')).map(post => post.coachId);
    expect(new Set(clubPosts).size).toBe(clubPosts.length);
    const coachOf = (team: string) => REAL_COACHES.find(coach => coach.id === REAL_COACH_POSTS.find(post => post.team === team)?.coachId)?.name;
    expect(coachOf('Hermine Nantes')).toBe('Rémy Valin');
    expect(coachOf('Fos Provence')).toBe('Abgué Barakaou');
    expect(coachOf('Urania Milano')).toBe('Stefano Sacripanti');
    expect(coachOf('Tizona Burgos')).toBe('Denis Pombar');
    expect(coachOf('Victoria Libertas Pesaro')).toBe('Pete Strobl');
    expect(REAL_COACHES.some(coach => coach.name === 'Giorgio Valli')).toBe(false);
    const jasikevicius = REAL_COACHES.find(coach => coach.name === 'Šarūnas Jasikevičius')!;
    const once = estimateCoach(jasikevicius.id, jasikevicius, jasikevicius.level, '2026-09-05'), again = estimateCoach(jasikevicius.id, jasikevicius, jasikevicius.level, '2026-09-05');
    expect(once).toEqual(again);
    // A EuroLeague coach with titles rates well above a second-division coach without any.
    const unknown = estimateCoach('coach-x', { name: 'Nobody Known', born: '1985', nationality: 'Spain', since: null, titles: NO_TITLES }, 0.5, '2026-09-05');
    expect(coachOverall(once.attributes)).toBeGreaterThan(coachOverall(unknown.attributes) + 3);
    expect(once.reputation).toBeGreaterThan(unknown.reputation + 20);
    expect(recordScore(NO_TITLES)).toBe(0);
    for (const value of Object.values(once.attributes)) expect(value).toBeGreaterThanOrEqual(1);
  });

  it('gives every club a head coach and makes the real coach of the manager\'s club a free agent', () => {
    const state = create();
    // Format 86: new careers' head coaches also steer training, rotation and signings.
    expect(state.coaches?.model).toBe('coaches-2');
    expect(create({ coachSteering: false }).coaches?.model).toBe('coaches-1');
    const pool = coachWorld(world);
    expect(pool.coaches.get(pool.opening.get(FENERBAHCE)!)!.name).toBe('Šarūnas Jasikevičius');
    expect(pool.coaches.get(pool.opening.get(EFES)!)!.name).toBe('Pablo Laso');
    expect(pool.coaches.get(pool.opening.get(BESIKTAS)!)!.name).toBe('Dušan Alimpijević');
    const places = coachPlaces(state);
    expect(places.clubs[FENERBAHCE]).toBe(MANAGER_COACH);
    const jasikevicius = pool.opening.get(FENERBAHCE)!;
    expect(places.free).toContain(jasikevicius);
    expect(places.spells[jasikevicius]!.at(-1)).toMatchObject({ clubId: null, reason: 'displaced' });
    expect(clubHeadCoach(state, EFES)).toMatchObject({ name: 'Pablo Laso' });
    // Every club of the world has exactly one coach; no coach holds two clubs.
    const held = Object.values(places.clubs).filter(id => id !== MANAGER_COACH);
    expect(new Set(held).size).toBe(held.length);
    expect(Object.keys(places.clubs)).toHaveLength(world.clubs.length);
    // Older careers and worlds without job changes are unchanged.
    expect(create({ realCoaches: false }).coaches).toBeUndefined();
    expect(createSeason({ seed: 11, ...NEW_CAREER_SYSTEMS }).coaches).toBeUndefined();
  });

  it('replaces coaches through the board\'s changes: a sacked coach is free and the club hires from the market', () => {
    const state = create();
    const efesCoach = coachPlaces(state).clubs[EFES]!;
    const changed = restartBoard(state, EFES, 'ai', 'season');
    const places = coachPlaces(changed);
    expect(places.free).toContain(efesCoach);
    expect(places.clubs[EFES]).not.toBe(efesCoach);
    expect(places.clubs[EFES]).not.toBe(MANAGER_COACH);
    // The best free coach within the club's reach is hired: here the displaced Jasikevičius.
    expect(headCoach(changed, places.clubs[EFES]!)!.name).toBe('Šarūnas Jasikevičius');
    // The manager leaving a club leaves it to hire a coach; taking a club displaces its coach.
    const moved = restartBoard(restartBoard(changed, FENERBAHCE, 'ai', 'end'), BESIKTAS, 'manager', 'end');
    const after = coachPlaces(moved);
    expect(after.clubs[BESIKTAS]).toBe(MANAGER_COACH);
    expect(after.clubs[FENERBAHCE]).not.toBe(MANAGER_COACH);
    expect(after.free).toContain(coachPlaces(state).clubs[BESIKTAS]);
  });

  it('steers computer clubs by their coach\'s style', () => {
    const defensive = { ...estimateCoach('d', { name: 'Defence Coach', born: '1970', nationality: 'Greece', since: 2000, titles: NO_TITLES, hints: ['defence', 'defence'] }, 2, '2026-09-05') };
    const attacking = { ...estimateCoach('o', { name: 'Offence Coach', born: '1970', nationality: 'Spain', since: 2000, titles: NO_TITLES, hints: ['pace', 'threes'] }, 2, '2026-09-05') };
    const five = world.clubs[5]!.players.slice(0, 5);
    const d = coachTactics(defensive, five), o = coachTactics(attacking, five);
    expect(d.pressure).toBeGreaterThan(o.pressure);
    expect(o.tempo).toBeGreaterThan(d.tempo);
    expect(o.outsideShare).toBeGreaterThan(d.outsideShare);
    for (const value of [...Object.values(d), ...Object.values(o)]) { expect(value).toBeGreaterThanOrEqual(0.2); expect(value).toBeLessThanOrEqual(0.75); }
    // A coach who trusts youth starts a young player close enough to the five; others keep the five.
    const players = world.clubs[5]!.players, planned = players.slice(0, 5).map(player => player.id), young = players[6]!.id;
    const trusting = { ...defensive, style: { ...defensive.style, youthTrust: 18 } }, wary = { ...defensive, style: { ...defensive.style, youthTrust: 8 } };
    expect(youthTrustFive(wary, players, planned, new Set(), id => id === young)).toEqual(planned);
    const five2 = youthTrustFive(trusting, players, planned, new Set(), id => id === young);
    expect(five2.length).toBe(5);
  });

  it('starts the manager from his profile and changes his attributes a little each season, bounded', () => {
    const start = managerStartAttributes({ name: 'A', dateOfBirth: '1995-01-01', nationality: 'Spain' }, 3, '2026-09-05');
    for (const value of Object.values(start)) { expect(value).toBeGreaterThanOrEqual(8); expect(value).toBeLessThanOrEqual(12); }
    const great = managerSeasonChange(start, { confidence: 85, trophy: true, scoredMore: true, youthGain: 4, dismissed: false, age: 31 }, 1);
    expect(Object.values(great.changes).filter(change => change === 1)).toHaveLength(2);
    expect(great.reasons).toHaveLength(2);
    const poor = managerSeasonChange(start, { confidence: 20, trophy: false, scoredMore: false, youthGain: null, dismissed: true, age: 64 }, 2);
    expect(Object.values(poor.changes).filter(change => change === -1).length).toBeLessThanOrEqual(2);
    const state = create();
    expect(managerAttributes(state.coaches!)).toEqual(state.coaches!.manager.start);
    validateCoachesShape(state.coaches, state, 86);
    expect(() => validateCoachesShape({ ...state.coaches, manager: { ...state.coaches!.manager, start: { ...state.coaches!.manager.start, tactics: 19 } } }, state, 86)).toThrow(/starting formula/);
    expect(() => validateCoachesShape(state.coaches, state, 80)).toThrow(/format 82/);
    expect(() => validateCoachesShape(state.coaches, state, 85)).toThrow(/format 86/);
  });

  it('saves and loads a real-coach career under the strict check; computer clubs play their coach\'s style', () => {
    const start = create();
    const played = playUntil(start, state => state.round >= 3 && state.activeMatch?.status === 'ready');
    // The opponent's instructions in the prepared match come from its head coach.
    const match = played.activeMatch!, side = match.home.id === played.managedClubId ? 'away' : 'home';
    const coach = clubHeadCoach(played, match[side].id);
    if (coach && coach !== MANAGER_COACH) expect(match.tactics[side]).toEqual(coachTactics(coach, match.lineups[side].map(id => match[side].players.find(player => player.id === id)!)));
    for (const text of [serializeSeason(played), serializeSeasonCompact(played)]) expect(parseSeason(text).coaches).toEqual(played.coaches);
    const forged = JSON.parse(serializeSeason(played));
    forged.state.coaches.manager.start.offence = 16;
    expect(() => parseSeason(JSON.stringify(forged))).toThrow(/coaches/);
    // Format 86: a steering career written as format 85 is refused by its own guard.
    const before86 = JSON.parse(serializeSeason(played));
    before86.formatVersion = 85; before86.state.schemaVersion = 85;
    expect(() => parseSeason(JSON.stringify(before86))).toThrow(/format 86/);
    // Format 82's guard, on a career without steering (format 86) at its opening.
    const older = JSON.parse(serializeSeason(create({ coachSteering: false })));
    older.formatVersion = 80; older.state.schemaVersion = 80;
    delete older.state.coaching.fullStaff; // format 84's staffing rule, refused on its own in a format-80 save delete older.state.world.neutralVenues; delete older.state.world.nextDivisionCountries;
    expect(() => parseSeason(JSON.stringify(older))).toThrow(/format 82/);
  }, 600_000);

  it('records a season\'s change at the rollover from the season\'s facts', () => {
    const state = create();
    const recorded = recordManagerSeason({ ...state, seasonNumber: 1 } as SeasonState)!;
    expect(recorded.manager.seasons).toHaveLength(1);
    expect(recorded.manager.seasons[0]!.seasonNumber).toBe(1);
  });
});

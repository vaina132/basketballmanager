import { beforeAll, describe, expect, it } from 'vitest';
import type { HeadCoach } from '../src/domain/coaches';
import type { SeasonState } from '../src/domain/season';
import type { TrainingPlan } from '../src/domain/training';
import type { CoachRotation, Side, Team } from '../src/domain/types';
import type { CareerWorld } from '../src/domain/world';
import { REAL_COACHES, REAL_COACH_POSTS } from '../src/data/real-coaches';
import { createFixtureMatch, setAutoSubstitutions, simulateToEnd } from '../src/engine/match';
import { parseSeason, serializeSeason, serializeSeasonCompact } from '../src/storage/season-storage';
import { estimateCoach, NO_TITLES, type CoachHint } from '../src/world/coach-ratings';
import { coachRotation, coachTrainingPlan, COACH_STEERING, moraleImpact, practicePercent, styleFit } from '../src/world/coach-steering';
import { runContinueStep } from '../src/world/continue-step';
import { getActiveCareerPlayers } from '../src/world/player-catalog';
import { clubStyleFit, coachTactics, steeringCoaches } from '../src/world/head-coaches';
import { OVR_POSITION_WEIGHTS } from '../src/world/overall-rating';
import { getPlayerRelationship } from '../src/world/relationships';
import { coachRecruitmentRating } from '../src/world/scouting-policy';
import { createSeason, managedSide, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { TRAINING_ATTRIBUTES } from '../src/world/training';
import { calibrationSummary, calibrationTeam, gameLine, type GameLine } from './helpers/match-calibration';
import { nationalWorld } from './helpers/national-world';

/**
 * Format 86 (owner, 22 November 2026): head coaches steer their clubs. Computer clubs' training follows the coach
 * (defence-minded coaches train defence more, development coaches give young players their own focus) while the
 * league's development stays where it was; a youth-trusting coach's rotation gives young players more minutes and a
 * league of real coaches' rotations keeps the match calibration; signings prefer players who fit the coach's style; the
 * manager's Development and Motivation help his club a little. Careers without the option keep the earlier rules.
 */
const date = '2026-09-05';
const coach = (name: string, hints: CoachHint[], level = 2) => estimateCoach(`coach-${name}`, { name, born: '1972', nationality: 'Spain', since: 2005, titles: NO_TITLES, hints }, level, date);
const defensive = coach('Defence First', ['defence', 'discipline']);
const shooter = coach('Threes Always', ['threes', 'pace']);
const youngster = coach('Youth Builder', ['youth'], 4);
const neutralCoach = { attributes: { offence: 10, defence: 10, tactics: 10, development: 10, motivation: 10, discipline: 10, youth: 10, adaptability: 10 }, style: { pace: 10, shooting: 10, pressure: 10, youthTrust: 10 } };

describe('head coaches plan computer clubs\' training (format 86)', () => {
  const team = calibrationTeam(1, 0);
  const fresh = Object.fromEntries(team.players.map(player => [player.id, 92]));
  const base: TrainingPlan = { delegated: true, intensity: 'standard', focus: 'balanced', individual: Object.fromEntries(team.players.map(player => [player.id, 'team' as const])) };
  const weeks = (head: { attributes: HeadCoach['attributes']; style: HeadCoach['style'] }, young = () => false, conditions = fresh) => [1, 2, 3, 4, 5, 6, 7, 8].map(round => coachTrainingPlan(head, base, team, conditions, round, young));

  it('a defence-minded coach trains defence; a three-point coach three-point shooting; a neutral coach stays balanced', () => {
    expect(weeks(defensive).filter(plan => plan.focus === 'defense').length).toBeGreaterThanOrEqual(2);
    expect(weeks(shooter).filter(plan => plan.focus === 'threePoint' || plan.focus === 'stamina').length).toBeGreaterThanOrEqual(2);
    expect(weeks(neutralCoach).every(plan => plan.focus === 'balanced' && plan.intensity === 'standard')).toBe(true);
    // A centre hardly needs three-point shooting: he trains balanced in the shooting coach's weeks.
    const centre = team.players.find(player => player.position === 'C')!;
    for (const plan of weeks(shooter)) if (plan.focus === 'threePoint') expect(plan.individual[centre.id]).toBe('balanced');
    expect(OVR_POSITION_WEIGHTS.C.threePoint).toBeLessThan(.1);
  });

  it('gives young players their own focus with a development coach, and reads tiredness by Motivation and Discipline', () => {
    const youngIds = new Set(team.players.slice(8).map(player => player.id));
    const steady = Object.fromEntries(team.players.map(player => [player.id, 85]));
    const plan = weeks(youngster, () => true, steady)[1]!;
    for (const player of team.players) expect(plan.individual[player.id] === 'team' || plan.individual[player.id] === 'balanced').toBe(false);
    const some = coachTrainingPlan(youngster, base, team, steady, 2, id => youngIds.has(id));
    expect(team.players.filter(player => some.individual[player.id] !== 'team').map(player => player.id).sort()).toEqual([...youngIds].sort());
    // A tired squad (average 76): a motivating coach rests it, a disciplined one keeps training.
    const tired = Object.fromEntries(team.players.map(player => [player.id, 76]));
    const motivator = { ...neutralCoach, attributes: { ...neutralCoach.attributes, motivation: 16, discipline: 8 } }, driller = { ...neutralCoach, attributes: { ...neutralCoach.attributes, motivation: 8, discipline: 16 } };
    expect(coachTrainingPlan(motivator, base, team, tired, 2, () => false).intensity).toBe('light');
    expect(coachTrainingPlan(driller, base, team, tired, 2, () => false).intensity).toBe('standard');
    // A disciplined coach works a fresh squad hard in a balanced week.
    expect(coachTrainingPlan(driller, base, team, Object.fromEntries(team.players.map(player => [player.id, 95])), 2, () => false).intensity).toBe('heavy');
  });

  it('keeps Development and Motivation small and bounded', () => {
    expect(practicePercent({ development: 10 })).toBe(0);
    expect(practicePercent({ development: 20 })).toBe(COACH_STEERING.practice.max);
    expect(practicePercent({ development: 1 })).toBe(COACH_STEERING.practice.min);
    expect(moraleImpact({ motivation: 10 })).toBe(0);
    expect(moraleImpact({ motivation: 20 })).toBe(3);
    expect(moraleImpact({ motivation: 1 })).toBe(-3);
  });
});

describe('head coaches run computer sides\' rotation (format 86)', () => {
  const PLAYS = { playModel: 'plays-3', computerCoach: ['home', 'away'] } as const;
  const strengths = [-1, -.5, -.25, 0, .25, .5, 1, 0];
  const teams: Team[] = strengths.map((strength, index) => calibrationTeam(index, strength));
  const realCoaches = REAL_COACHES.map(real => estimateCoach(real.id, real, real.level, date));
  const youngMinutes = { trusted: 0, usual: 0, games: 0 };
  const league: GameLine[] = [];
  const neutral = coachRotation(neutralCoach, []);
  beforeAll(() => {
    let seed = 8600;
    for (const home of teams) for (const away of teams) {
      if (home === away) continue;
      // The home side's last four players are young; once its coach trusts youth (style 18), once the usual rotation.
      const young = home.players.slice(8).map(player => player.id);
      for (const variant of ['trusted', 'usual'] as const) {
        const rotation: Partial<Record<Side, CoachRotation>> | undefined = variant === 'trusted' ? { home: coachRotation(youngster, young) } : undefined;
        const end = simulateToEnd(createFixtureMatch(seed, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', ...PLAYS, ...(rotation ? { coachRotation: rotation } : {}) }));
        youngMinutes[variant] += young.reduce((sum, id) => sum + end.stats[id]!.secondsPlayed, 0) / 60;
      }
      youngMinutes.games += 1;
      // A league where every side plays a real coach's style and rotation.
      const homeCoach = realCoaches[seed % realCoaches.length]!, awayCoach = realCoaches[(seed * 7 + 3) % realCoaches.length]!;
      const match = createFixtureMatch(seed + 50_000, home, away, { autoSubstitutions: { home: true, away: true }, injuryMode: 'off', tactics: { home: coachTactics(homeCoach, home.players.slice(0, 5)), away: coachTactics(awayCoach, away.players.slice(0, 5)) }, coachRotation: { home: coachRotation(homeCoach, home.players.slice(9).map(player => player.id)), away: coachRotation(awayCoach, away.players.slice(9).map(player => player.id)) }, ...PLAYS });
      league.push(gameLine(simulateToEnd(match), { home: match.lineups.home, away: match.lineups.away }));
      seed += 1;
    }
  }, 600_000);

  it('a neutral coach plays the usual rotation', () => {
    expect(neutral).toEqual({ depth: 0, youthBonus: 0, young: [], restCondition: 92, foulTrouble: 5, swapThreshold: 3, closingSeconds: 180, timeoutRun: 0 });
    expect(youngster.style.youthTrust).toBeGreaterThanOrEqual(14);
    expect(coachRotation(youngster, ['a']).youthBonus).toBeGreaterThan(0);
  });

  it('a youth-trusting coach gives young players clearly more minutes', () => {
    const trusted = youngMinutes.trusted / youngMinutes.games, usual = youngMinutes.usual / youngMinutes.games;
    expect(trusted).toBeGreaterThan(usual + 8);
  });

  it('a league of real coaches\' styles and rotations keeps the calibration bands', () => {
    const s = calibrationSummary(league);
    expect(s.possessions).toBeGreaterThanOrEqual(71); expect(s.possessions).toBeLessThanOrEqual(79);
    expect(s.points).toBeGreaterThanOrEqual(80); expect(s.points).toBeLessThanOrEqual(90);
    expect(s.offensiveRating).toBeGreaterThanOrEqual(107); expect(s.offensiveRating).toBeLessThanOrEqual(118);
    expect(s.threeShare).toBeGreaterThanOrEqual(37); expect(s.threeShare).toBeLessThanOrEqual(46);
    expect(s.ftaPerFga).toBeGreaterThanOrEqual(.28); expect(s.ftaPerFga).toBeLessThanOrEqual(.4);
    expect(s.turnovers).toBeGreaterThanOrEqual(11.5); expect(s.turnovers).toBeLessThanOrEqual(15);
    expect(s.steals).toBeGreaterThanOrEqual(5.5); expect(s.steals).toBeLessThanOrEqual(8.5);
  });
});

describe('signings fit the head coach\'s style (format 86)', () => {
  it('a three-point coach rates shooters up, a defensive coach defenders, a youth coach young players', () => {
    const skills = (values: Partial<Record<string, number>>) => (key: string) => values[key] ?? 12;
    expect(styleFit(shooter, skills({ threePoint: 17 }), false)).toBeGreaterThan(styleFit(shooter, skills({ threePoint: 9 }), false) + 5);
    expect(styleFit(defensive, skills({ defense: 17, rebounding: 15 }), false)).toBeGreaterThan(styleFit(defensive, skills({ defense: 9 }), false) + 5);
    expect(styleFit(youngster, skills({}), true)).toBeGreaterThan(styleFit(youngster, skills({}), false));
    expect(styleFit(neutralCoach, skills({ threePoint: 20, defense: 20 }), true)).toBe(0);
  });
});

const FENERBAHCE = REAL_COACH_POSTS.find(post => post.team === 'Fenerbahçe')!.teamId;
const EFES = REAL_COACH_POSTS.find(post => post.team === 'Anadolu Efes')!.teamId;
const BESIKTAS = REAL_COACH_POSTS.find(post => post.team === 'Beşiktaş')!.teamId;
function realWorld(): CareerWorld {
  const base = nationalWorld();
  let text = JSON.stringify(base);
  [FENERBAHCE, EFES, BESIKTAS].forEach((id, index) => { text = text.replaceAll(`"${base.clubs[index]!.id}"`, `"${id}"`); });
  return JSON.parse(text) as CareerWorld;
}
const world = realWorld();
const manager = { name: 'Test Manager', dateOfBirth: '1980-05-01', nationality: 'Turkey' };

/** Half a season (through week 16) with every system, recording each week's applied training plans. */
function halfSeason(steering: boolean) {
  // Measured before format 106, whose new names give generated coaches other styles, so it runs without it.
  let state: SeasonState = createSeason({ seed: 11, world, managedClubId: FENERBAHCE, ...NEW_CAREER_SYSTEMS, coachSteering: steering, manager, generatedPeople: false });
  const weeks: Record<string, TrainingPlan>[] = [];
  for (let guard = 0; guard < 400 && state.round < 16; guard += 1) {
    if (state.activeMatch && state.activeMatch.status !== 'finished') { state = { ...state, activeMatch: simulateToEnd(setAutoSubstitutions(state.activeMatch, managedSide(state), true)) }; continue; }
    const result = runContinueStep(state, { decided: true });
    if ('outlook' in result) throw new Error('No board decision is expected here.');
    const before = state.training.lastWeek;
    state = result.state;
    if (state.training.lastWeek && state.training.lastWeek !== before) weeks.push(state.training.lastWeek.plans);
  }
  let points = 0, defense = 0, value = 0;
  for (const club of state.clubs) for (const player of club.players) {
    const earned = state.training.points[player.id];
    if (!earned) continue;
    for (const key of TRAINING_ATTRIBUTES) { points += earned[key]; value += 8 * OVR_POSITION_WEIGHTS[player.position][key] * earned[key] / 100; }
    defense += earned.defense;
  }
  return { state, weeks, points, defenseShare: defense / points, value };
}

describe('a career where head coaches steer (format 86)', () => {
  let on: ReturnType<typeof halfSeason>, off: ReturnType<typeof halfSeason>;
  beforeAll(() => { on = halfSeason(true); off = halfSeason(false); }, 900_000);

  it('defence-minded coaches\' clubs train defence more, and the league develops as much as before', () => {
    const coaches = steeringCoaches(on.state, { seasonNumber: 1, round: 2, phase: 'season' })!;
    const defenders = on.state.clubs.filter(club => coaches[club.id]?.style && (coaches[club.id]!.style!.pressure >= 15));
    expect(defenders.length).toBeGreaterThan(0);
    const defenceWeeks = (clubs: readonly { id: string }[]) => on.weeks.reduce((sum, week) => sum + clubs.filter(club => week[club.id]?.focus === 'defense').length, 0) / Math.max(1, clubs.length);
    const others = on.state.clubs.filter(club => coaches[club.id]?.style && coaches[club.id]!.style!.pressure <= 10 && coaches[club.id]!.attributes.defence - coaches[club.id]!.attributes.offence < 3);
    expect(defenceWeeks(defenders)).toBeGreaterThan(defenceWeeks(others) + 2);
    // Without steering every computer club trains balanced; with it the league trains defence more.
    expect(off.weeks.every(week => Object.values(week).every(plan => plan.focus === 'balanced'))).toBe(true);
    expect(on.defenseShare).toBeGreaterThan(off.defenseShare + .01);
    // Development stays realistic: the same practice (within 3%) and its value for the players' positions within 5%.
    expect(Math.abs(on.points / off.points - 1)).toBeLessThan(.03);
    expect(Math.abs(on.value / off.value - 1)).toBeLessThan(.05);
  }, 600_000);

  it('checks the steered training and rotation exactly and round-trips the save', () => {
    for (const text of [serializeSeason(on.state), serializeSeasonCompact(on.state)]) expect(parseSeason(text)).toEqual(on.state);
    const match = on.state.activeMatch!, opponent: Side = match.home.id === on.state.managedClubId ? 'away' : 'home';
    expect(match.coachRotation?.[opponent]).toBeDefined();
    expect(match.coachRotation?.[opponent === 'home' ? 'away' : 'home']).toBeUndefined();
    const forged = JSON.parse(serializeSeason(on.state));
    forged.state.activeMatch.coachRotation[opponent].depth = forged.state.activeMatch.coachRotation[opponent].depth === 2 ? 1 : 2;
    expect(() => parseSeason(JSON.stringify(forged))).toThrow(/coachRotation/);
    const lastPlan = JSON.parse(serializeSeason(on.state));
    const club = on.state.clubs.find(item => item.id !== on.state.managedClubId && lastPlan.state.training.lastWeek.plans[item.id].focus !== 'balanced');
    if (club) {
      lastPlan.state.training.lastWeek.plans[club.id].focus = 'balanced';
      expect(() => parseSeason(JSON.stringify(lastPlan))).toThrow(/training/);
    }
    // The career without steering keeps the earlier rules: no rotation in its matches.
    expect(off.state.coaches?.model).toBe('coaches-1');
    expect(off.state.activeMatch?.coachRotation).toBeUndefined();
  }, 600_000);

  it('adds the head coach\'s Motivation to morale and fits signings to his style', () => {
    const coaches = steeringCoaches(on.state, { seasonNumber: on.state.seasonNumber, round: on.state.round, phase: 'season' })!;
    const motivated = on.state.clubs.find(club => coaches[club.id] && moraleImpact(coaches[club.id]!.attributes) !== 0)!;
    const relationship = getPlayerRelationship(on.state, motivated.players[0]!.id, motivated.id);
    expect(relationship.reasons.find(reason => reason.label === 'Head coach\'s motivation')?.impact).toBe(moraleImpact(coaches[motivated.id]!.attributes));
    // Signings: for clubs whose coach leans to three-point shooting, defence or youth, the ten best-rated players of
    // the world (outside the club) fit that lean better when the club rates them with its coach's style.
    const pool = getActiveCareerPlayers(on.state).slice(0, 400);
    let better = 0, worse = 0, compared = 0;
    for (const club of on.state.clubs) {
      const head = coaches[club.id];
      const fit = clubStyleFit(on.state, club.id);
      if (!head?.style || !fit) continue;
      const lean = head.style.shooting >= 13 ? 'threePoint' : head.style.pressure >= 13 ? 'defense' : null;
      if (!lean) continue;
      const own = new Set(club.players.map(player => player.id)), candidates = pool.filter(player => !own.has(player.id));
      const usual = coachRecruitmentRating(on.state, club.id, null), fitted = coachRecruitmentRating(on.state, club.id, fit);
      const top = (rate: (id: string) => number) => [...candidates].sort((a, b) => rate(b.id) - rate(a.id) || a.id.localeCompare(b.id)).slice(0, 10);
      const mean = (players: typeof candidates) => players.reduce((sum, player) => sum + player.attributes[lean], 0) / players.length;
      compared += 1;
      const gain = mean(top(fitted)) - mean(top(usual));
      if (gain > 0) better += 1; else if (gain < 0) worse += 1;
    }
    expect(compared).toBeGreaterThan(2);
    expect(worse).toBe(0);
    expect(better).toBeGreaterThanOrEqual(compared / 2);
  }, 600_000);
});

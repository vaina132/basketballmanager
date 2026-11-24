import { describe, expect, it } from 'vitest';
import type { SeasonLifecycle } from '../src/domain/lifecycle';
import type { Player, Position, Team } from '../src/domain/types';
import type { CareerWorld } from '../src/domain/world';
import type { DevelopmentPlayerProfile } from '../src/data/development-player-profiles';
import { economyPack } from './helpers/economy-pack';
import { worldFromPack } from '../src/world/real-world';
import { createSeason, dateForRound, NEW_CAREER_SYSTEMS } from '../src/world/season';
import { parseSeason, serializeSeason } from '../src/storage/season-storage';
import { createTraining, processTrainingWeek, TRAINING_ATTRIBUTES, withTrainingPoints } from '../src/world/training';
import type { SeasonTraining } from '../src/domain/training';
import { ageTrainingRate, applyAgingAttributes, getPlayerAging } from '../src/world/lifecycle-policy';
import { overallRating } from '../src/world/overall-rating';
import { seasonRounds } from '../src/world/career-world';
import {
  birthdaySetback, declineBetween, developmentTraits, growthAtAge, levelFactor, minutesFactor, PLAYER_DEVELOPMENT_RULES, playerGrowthRate, seasonForm, usesPlayerDevelopment,
} from '../src/world/player-development';

/**
 * Format 101 (owner decision 24 November 2026, `world.playerDevelopment`): realistic player development. Young players
 * grow toward their potential, most quickly before 22; growth fades by the late twenties; decline starts with the
 * athletic skills around 29-30 and speeds up; each player has his own traits and each season its own form; high skills
 * are harder to raise; and over ten seasons a league keeps its level while individuals move a lot.
 */
const SPAIN = { id: 'acb', name: 'Liga Endesa', country: 'Spain', tier: 1 as const, levels: [14, 14, 14, 13, 13, 13, 12, 12, 12, 11, 11, 11, 10, 10, 10, 9, 9, 9, 8, 8] };
const packWorld = worldFromPack(economyPack([SPAIN]), 'acb');
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) / 2)]!; };
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

describe('the player development marker (format 101)', () => {
  it('marks new real-data careers only, and format 100 refuses the marker', () => {
    const state = createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS });
    expect(state.world!.playerDevelopment).toBe(true);
    expect(usesPlayerDevelopment(state)).toBe(true);
    expect(createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS, playerDevelopment: false }).world!.playerDevelopment).toBeUndefined();
    // The built-in league keeps its rules (the golden matches and older tests).
    expect(createSeason({ seed: 5, ...NEW_CAREER_SYSTEMS }).world?.playerDevelopment).toBeUndefined();
    expect(() => createSeason({ seed: 5, world: packWorld, playerDevelopment: 'yes' as unknown as boolean })).toThrow(/player development setting/);
    expect(parseSeason(serializeSeason(state)).world!.playerDevelopment).toBe(true);
    const envelope = JSON.parse(serializeSeason(state));
    // Later markers (squad refresh, format 102) are removed so the check under test is the one that fails.
    delete envelope.state.world.squadRefresh;
    envelope.formatVersion = 100; envelope.state.schemaVersion = 100;
    expect(() => parseSeason(JSON.stringify(envelope))).toThrow(/playerDevelopment.*format 101/);
    const older = JSON.parse(serializeSeason(createSeason({ seed: 5, world: packWorld, managedClubId: 'acb-6', ...NEW_CAREER_SYSTEMS, playerDevelopment: false })));
    delete older.state.world.squadRefresh;
    older.formatVersion = 100; older.state.schemaVersion = 100;
    expect(parseSeason(JSON.stringify(older)).world!.playerDevelopment).toBeUndefined();
  }, 120_000);
});

describe('the development curve', () => {
  it('grows young players fastest, fades by the late twenties and stops after thirty-two', () => {
    const rates = [17, 19, 21, 23, 25, 27, 29, 31, 33].map(growthAtAge);
    for (let index = 1; index < rates.length; index += 1) expect(rates[index]!).toBeLessThanOrEqual(rates[index - 1]!);
    expect(growthAtAge(19)).toBeGreaterThan(2 * growthAtAge(26));
    expect(growthAtAge(33)).toBe(0);
  });

  it('declines athletic skills earlier than shooting and passing, faster with age', () => {
    const usual = { agingOnset: 0, agingScale: 10_000 };
    expect(declineBetween('stamina', usual, 29, 30)).toBeGreaterThan(0);
    expect(declineBetween('threePoint', usual, 29, 30)).toBe(0);
    expect(declineBetween('freeThrow', usual, 31, 32)).toBe(0);
    for (const skill of TRAINING_ATTRIBUTES) expect(declineBetween(skill, usual, 35, 36)).toBeGreaterThan(declineBetween(skill, usual, 33, 34));
    expect(declineBetween('defense', usual, 33, 34)).toBeGreaterThan(declineBetween('passing', usual, 33, 34));
    // An early ager starts sooner and a slow one later.
    expect(declineBetween('stamina', { agingOnset: -1.5, agingScale: 10_000 }, 26, 27)).toBeGreaterThan(0);
    expect(declineBetween('stamina', { agingOnset: 1.5, agingScale: 10_000 }, 27, 29.5)).toBe(0);
  });

  it('makes high skills harder to raise and 20 the end of the scale', () => {
    const factors = [10, 13, 14, 15, 16, 17, 18, 19, 20].map(levelFactor);
    for (let index = 1; index < factors.length; index += 1) expect(factors[index]!).toBeLessThanOrEqual(factors[index - 1]!);
    expect(levelFactor(13)).toBe(10_000);
    expect(levelFactor(18)).toBeLessThan(levelFactor(13) * 0.6);
    expect(levelFactor(19)).toBeLessThan(levelFactor(16) / 1.5);
    expect(levelFactor(20)).toBe(0);
  });

  it('rewards young players who play and leaves veterans to their practice', () => {
    expect(minutesFactor(20, 30)).toBeGreaterThan(minutesFactor(20, 10));
    expect(minutesFactor(20, 10)).toBeGreaterThan(minutesFactor(20, 0));
    expect(minutesFactor(20, 0)).toBeLessThan(10_000);
    expect(minutesFactor(30, 0)).toBe(10_000);
    expect(minutesFactor(20, null)).toBe(10_000);
  });
});

describe('individual variation', () => {
  const ids = Array.from({ length: 2_000 }, (_, index) => `player-${index}`);

  it('gives players stable traits: fast and slow developers, early and late ones, early and late agers', () => {
    const traits = ids.map(id => developmentTraits(7, id));
    expect(developmentTraits(7, 'player-1')).toEqual(developmentTraits(7, 'player-1'));
    expect(developmentTraits(8, 'player-1')).not.toEqual(developmentTraits(7, 'player-1'));
    const growth = traits.map(trait => trait.growth);
    expect(Math.min(...growth)).toBeLessThan(5_000);
    expect(Math.max(...growth)).toBeGreaterThan(15_000);
    expect(Math.abs(mean(growth) - 10_000)).toBeLessThan(300);
    const late = traits.filter(trait => trait.timing > 0).length / traits.length, early = traits.filter(trait => trait.timing < 0).length / traits.length;
    expect(late).toBeGreaterThan(0.15); expect(late).toBeLessThan(0.25);
    expect(early).toBeGreaterThan(0.15); expect(early).toBeLessThan(0.25);
    // A late bloomer still grows at 24 like an ordinary 22-year-old (same growth trait).
    const bloomer = ids.find(id => developmentTraits(7, id).timing === PLAYER_DEVELOPMENT_RULES.timing.late)!;
    expect(playerGrowthRate(7, bloomer, 24)).toBe(Math.floor(growthAtAge(22) * developmentTraits(7, bloomer).growth / 10_000));
  });

  it('draws a form for every season: lost seasons, ordinary ones and breakouts', () => {
    const forms = ids.map(id => seasonForm(7, id, 3));
    expect(forms.filter(form => form < 3_000).length / forms.length).toBeGreaterThan(0.05);
    const breakouts = forms.filter(form => form >= PLAYER_DEVELOPMENT_RULES.form.breakoutMin).length / forms.length;
    expect(breakouts).toBeGreaterThan(0.09); expect(breakouts).toBeLessThan(0.15);
    expect(Math.abs(mean(forms) - 10_000)).toBeLessThan(1_000);
    expect(seasonForm(7, 'player-1', 3)).not.toBe(seasonForm(7, 'player-1', 4));
  });

  it('gives a setback in about one year in eight from 21, to one to three skills', () => {
    const setbacks = ids.map(id => birthdaySetback(7, id, 26)), hit = setbacks.filter(loss => Object.values(loss).some(Boolean));
    expect(hit.length / ids.length).toBeGreaterThan(0.09); expect(hit.length / ids.length).toBeLessThan(0.15);
    expect(ids.every(id => Object.values(birthdaySetback(7, id, 20)).every(value => value === 0))).toBe(true);
    for (const loss of hit) {
      const skills = Object.values(loss).filter(Boolean).length;
      expect(skills).toBeGreaterThanOrEqual(1); expect(skills).toBeLessThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A synthetic world, ten seasons: real weekly training (processTrainingWeek) and dated decline (getPlayerAging) for a
// league of twenty clubs whose players span 19-37 with the flat age profile of the real data; players retire at 37
// and are replaced by 19-year-olds at the youngest players' level.
// ---------------------------------------------------------------------------------------------------------------------
const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const CLUBS = 20, SQUAD = 12, SEASONS = 10, SEED = 11;

function synthetic() {
  const profiles: Record<string, DevelopmentPlayerProfile> = {};
  let next = 0;
  const hash = (text: string) => { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0; return value; };
  const make = (clubIndex: number, age: number, born: number): Player => {
    const id = `dev-${next++}`, h = hash(id);
    // Real data: the age profile is nearly flat (young players about 5 points below the late twenties).
    const level = 9 + clubIndex % 4 + (h % 5) - (age < 23 ? 1 : 0);
    const attributes = Object.fromEntries(TRAINING_ATTRIBUTES.map((key, index) => [key, Math.max(3, Math.min(18, level + ((h >>> (index * 3)) % 5) - 2))])) as unknown as Player['attributes'];
    profiles[id] = { dateOfBirth: `${born}-0${1 + h % 9}-1${h % 9}`, source: 'official-profile' };
    return { id, name: id, number: 4 + next % 90, position: POSITIONS[h % 5]!, attributes, heightCm: 200, weightKg: 97, skinTone: 'medium', hairColor: 'black' } as Player;
  };
  const clubs: Team[] = Array.from({ length: CLUBS }, (_, clubIndex) => ({
    id: `acb-${clubIndex + 1}`, name: `Club ${clubIndex + 1}`, shortName: `C${clubIndex + 1}`, color: '#336699',
    players: Array.from({ length: SQUAD }, (_, index) => { const age = 19 + (index * 7 + clubIndex * 5) % 19; return make(clubIndex, age, 2026 - age); }),
  }));
  // Replacements for every future season, made now so the world knows their birth dates.
  const replacements: Player[][] = Array.from({ length: SEASONS }, (_, season) => Array.from({ length: CLUBS * 2 }, (_, index) => make(index % CLUBS, 19, 2026 + season - 19)));
  const world: CareerWorld = { ...packWorld, playerDevelopment: true, playerProfiles: { ...packWorld.playerProfiles, ...profiles } };
  return { world, clubs, replacements };
}

function runSyntheticWorld() {
  const { world, clubs: initial, replacements } = synthetic();
  const lifecycle: SeasonLifecycle = { model: 'lifecycle-1', enabledSince: { seasonNumber: 1, round: 1, date: world.startDate, ledgerIndex: 0, contractCount: 0, negotiationCount: 0, recruitmentEventCount: 0, marketEventCount: 0 }, reviews: [], notices: [] };
  let clubs = initial;
  let training: SeasonTraining = createTraining(clubs);
  const rounds = seasonRounds({ world });
  const context = (date: string) => ({ world, seed: SEED, lifecycle, date, training });
  const ovr = (player: Player, date: string) => {
    const trained = Object.fromEntries(TRAINING_ATTRIBUTES.map(key => [key, Math.min(20, player.attributes[key] + Math.floor((training.points[player.id]?.[key] ?? 0) / 100))])) as unknown as Player['attributes'];
    return overallRating(applyAgingAttributes(context(date), player.id, trained, date), player.position);
  };
  const age = (player: Player, date: string) => (Date.parse(date) - Date.parse(world.playerProfiles[player.id]!.dateOfBirth)) / 31_557_600_000;
  const seasons: { median: number; p90: number; top: number; at99: number; ratings: Map<string, { ovr: number; age: number }> }[] = [];
  const record = (date: string) => {
    const ratings = new Map(clubs.flatMap(club => club.players.map(player => [player.id, { ovr: ovr(player, date), age: age(player, date) }] as const)));
    const values = [...ratings.values()].map(row => row.ovr).sort((a, b) => a - b);
    seasons.push({ median: median(values), p90: values[Math.floor(values.length * 0.9)]!, top: values.at(-1)!, at99: values.filter(value => value >= 99).length, ratings });
  };
  for (let season = 1; season <= SEASONS; season += 1) {
    if (season > 1) {
      // Retire everyone 37 or older at the season start; 19-year-olds take their places.
      const start = dateForRound(1, season), pool = [...replacements[season - 2]!];
      clubs = clubs.map(club => ({ ...club, players: club.players.map(player => age(player, start) >= 37 ? pool.shift()! : player) }));
      training = { ...withTrainingPoints(training, clubs.flatMap(club => club.players)), plans: createTraining(clubs).plans, lastWeek: null };
    }
    record(dateForRound(1, season));
    const conditions = Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, 90])));
    for (let round = 1; round < rounds; round += 1) {
      // No games are played in this world: every young player counts as unknown minutes (factor 1).
      training = processTrainingWeek({ world, seed: SEED, training, clubs, conditions, injuries: [], seasonNumber: season, afterRound: round, fromDate: dateForRound(round, season), toDate: dateForRound(round + 1, season), lifecycle, fixtures: [] }).training;
    }
  }
  record(dateForRound(1, SEASONS + 1));
  return seasons;
}

describe('ten seasons in a synthetic world', () => {
  const seasons = runSyntheticWorld();

  it('keeps the league level within about two points while individuals move a lot', () => {
    const first = seasons[0]!;
    for (const season of seasons) {
      expect(Math.abs(season.median - first.median)).toBeLessThanOrEqual(2.5);
      expect(Math.abs(season.p90 - first.p90)).toBeLessThanOrEqual(3);
    }
    const last = seasons.at(-1)!;
    // 99 stays rare: at most three players in a league of 240.
    for (const season of seasons) expect(season.at99).toBeLessThanOrEqual(3);
    const stayed = [...first.ratings].filter(([id]) => last.ratings.has(id)).map(([id, row]) => last.ratings.get(id)!.ovr - row.ovr);
    expect(Math.max(...stayed)).toBeGreaterThanOrEqual(15);
    expect(Math.min(...stayed)).toBeLessThanOrEqual(-15);
  });

  it('grows the young, keeps the late twenties near level and lowers the thirties, with players moving both ways', () => {
    const bands = new Map<string, number[]>();
    for (let index = 0; index + 1 < seasons.length; index += 1) for (const [id, row] of seasons[index]!.ratings) {
      const after = seasons[index + 1]!.ratings.get(id);
      if (!after) continue;
      const band = row.age < 23 ? 'young' : row.age < 27 ? 'developing' : row.age < 30 ? 'peak' : row.age < 33 ? 'early thirties' : 'veteran';
      bands.set(band, [...(bands.get(band) ?? []), after.ovr - row.ovr]);
    }
    const change = (band: string) => mean(bands.get(band)!), share = (band: string, test: (value: number) => boolean) => bands.get(band)!.filter(test).length / bands.get(band)!.length;
    expect(change('young')).toBeGreaterThan(0.8);
    expect(change('young')).toBeGreaterThan(change('peak') + 0.5);
    expect(change('developing')).toBeGreaterThan(change('peak'));
    expect(Math.abs(change('peak'))).toBeLessThan(1);
    expect(change('early thirties')).toBeLessThan(-0.5);
    expect(change('veteran')).toBeLessThan(change('early thirties'));
    // Individual variation: in the peak years some improve and some decline; some young players stagnate or regress.
    expect(share('peak', value => value > 0)).toBeGreaterThan(0.1);
    expect(share('peak', value => value < 0)).toBeGreaterThan(0.06);
    expect(share('young', value => value <= 0)).toBeGreaterThan(0.05);
    expect(share('veteran', value => value > 0)).toBeLessThan(0.1);
  });
});

describe('training still matters within the curve', () => {
  const { world, clubs } = synthetic();
  const lifecycle: SeasonLifecycle = { model: 'lifecycle-1', enabledSince: { seasonNumber: 1, round: 1, date: world.startDate, ledgerIndex: 0, contractCount: 0, negotiationCount: 0, recruitmentEventCount: 0, marketEventCount: 0 }, reviews: [], notices: [] };
  const seasonOf = (intensity: 'light' | 'standard', youngMinutes: number | null) => {
    let training = createTraining(clubs);
    for (const plan of Object.values(training.plans)) Object.assign(plan, { delegated: false, intensity });
    const conditions = Object.fromEntries(clubs.flatMap(club => club.players.map(player => [player.id, 90])));
    for (let round = 1; round < 20; round += 1) {
      const fixtures = youngMinutes === null ? [] : [{ round, homeClubId: clubs[0]!.id, awayClubId: clubs[1]!.id, result: { stats: Object.fromEntries([...clubs[0]!.players, ...clubs[1]!.players].map(player => [player.id, { secondsPlayed: youngMinutes * 60 }])) } }] as never;
      training = processTrainingWeek({ world, seed: SEED, training, clubs, conditions, injuries: [], seasonNumber: 1, afterRound: round, fromDate: dateForRound(round), toDate: dateForRound(round + 1), lifecycle, fixtures }).training;
    }
    return training;
  };
  const total = (training: SeasonTraining, players: readonly Player[]) => players.reduce((sum, player) => sum + Object.values(training.points[player.id]!).reduce((a, b) => a + b, 0), 0);
  const young = clubs.flatMap(club => club.players).filter(player => Number(world.playerProfiles[player.id]!.dateOfBirth.slice(0, 4)) >= 2004);

  it('gives more progress for harder practice and for regular minutes', () => {
    expect(total(seasonOf('standard', null), young)).toBeGreaterThan(total(seasonOf('light', null), young) * 1.4);
    const regular = seasonOf('standard', 30), bench = seasonOf('standard', 0);
    const playing = [...clubs[0]!.players, ...clubs[1]!.players].filter(player => young.includes(player));
    expect(total(regular, playing)).toBeGreaterThan(total(bench, playing) * 1.15);
  });

  it('slows practice with age and stops raising skills after thirty-two, while older careers keep their rates', () => {
    const date = dateForRound(3);
    const rate = (born: number) => { const player = clubs.flatMap(club => club.players).find(item => world.playerProfiles[item.id]!.dateOfBirth.startsWith(`${born}-`))!; return ageTrainingRate({ world, seed: SEED, lifecycle }, player.id, date); };
    expect(rate(2006)).toBeGreaterThan(rate(2000));
    expect(rate(1990)).toBe(0);
    const older = { ...world }; delete (older as { playerDevelopment?: true }).playerDevelopment;
    const veteran = clubs.flatMap(club => club.players).find(item => world.playerProfiles[item.id]!.dateOfBirth.startsWith('1990-'))!;
    expect(ageTrainingRate({ world: older, lifecycle }, veteran.id, date)).toBeGreaterThan(5_000);
    // The new decline is stronger than the format-100 rule for a 34-year-old over two seasons.
    const later = dateForRound(1, 3);
    const lossNew = getPlayerAging({ world, seed: SEED, lifecycle }, veteran.id, later).lossPoints, lossOld = getPlayerAging({ world: older, lifecycle }, veteran.id, later).lossPoints;
    expect(Object.values(lossNew).reduce((a, b) => a + b, 0)).toBeGreaterThan(Object.values(lossOld).reduce((a, b) => a + b, 0));
  });
});

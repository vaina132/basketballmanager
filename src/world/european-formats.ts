import type { CareerWorld, EuropeanCompetitionKind, EuropeanFormatId } from '../domain/world';
import { bracket, places, playIn, postseasonSlots, type PostseasonFormat, type PostseasonRef, type PostseasonSeriesSpec } from './postseason';

/**
 * The European competitions' real 2026-27 formats as data (steps 3.5b-e). Each competition plays on midweek days of
 * the career's weeks (days counted from the week's Saturday: Tuesday 3, Wednesday 4, Thursday 5), so a club always has
 * at least one full day between a European game and a domestic Saturday. Every European game ends before the domestic
 * postseasons begin: the domestic regular season lasts at least until the last European week (`europeanWeeks`).
 * Sources and the assumptions taken where a rule is not published are listed per format and in
 * docs/competition-rules-2026.md.
 */
export interface EuropeanFormat {
  id: EuropeanFormatId;
  kind: EuropeanCompetitionKind;
  label: string;
  source: string;
  /** Entrants allowed (the real competition has the maximum; smaller fields keep the same stages for test worlds). With groups, the field divides into equal groups of at least four. */
  clubs: { min: number; max: number };
  /**
   * A double round robin from `firstWeek` to `lastWeek` on `day`; when there are more rounds than weeks, evenly spread
   * weeks have two rounds, on `doubleDays`. With `groups`, the drawn field is split into these groups, each a double
   * round robin of its own on its own day.
   */
  regular: { firstWeek: number; lastWeek: number; day: number; doubleDays?: readonly [number, number]; groups?: readonly { id: string; day: number }[] };
  /** The regular-season ranking (the FIBA Appendix D default where the competition's own text was not checked). */
  standingsRule: 'fiba-2026-d';
  /**
   * The knockout stage, with the domestic postseason machinery: each series reserves a slot for every possible game.
   * Places count down the regular-season order: with groups, group after group (the first group's places, then the
   * second's), so the stage is built for the group size.
   */
  knockout: PostseasonFormat | ((groupSize: number) => PostseasonFormat);
  /** Each knockout slot's week and day, in slot order. */
  slots: readonly { week: number; day: number }[];
}

const EUROLEAGUE_SOURCES = 'EuroLeague format (20 clubs, 38 rounds, play-in 7-10, best-of-five playoffs 2-2-1, Final Four): https://www.euroleaguebasketball.net/euroleague/news/format-el; 2026-27 schedule (24 September 2026 to 16 April 2027): https://eurohoops.net/en/euroleague/1994855/euroleague-releases-full-schedule-for-the-2026-27-season; no third-place game since 2025-26: https://www.eurohoops.net/en/euroleague/1839488/euroleague-to-introduce-new-penalties-including-win-deduction-for-actions-of-team-officials. Assumed: the EuroLeague\'s own tie-break text was not checked, so the FIBA Appendix D default ranks the regular season; double-round weeks are spread evenly.';

const EUROCUP_SOURCES = 'BKT EuroCup 2026-27: 32 clubs in four groups of eight, home and away within the group, top four to best-of-three eighth-finals, quarter-finals, semi-finals and finals (https://www.eurohoops.net/en/eurocup/1984959/eurocup-confirms-32-team-field-for-2026-27-season-two-rome-clubs-among-participants/); schedule: regular season 29 September 2026 to 13 January 2027 on Tuesdays and Wednesdays, eighth-finals 2-12 February, quarter-finals 9-19 March, semi-finals 31 March to 9 April, finals 21, 27 and 30 April 2027 (https://eurohoops.net/en/eurocup/1994861/bkt-eurocup-announces-the-2026-27-schedule). Assumed (not published there): groups drawn without pots or country protection; groups A and B on Tuesdays, C and D on Wednesdays; eighth-finals A1-B4, B2-A3, B1-A4, A2-B3 (C and D alike), quarter-finals and semi-finals within each half; home advantage (games 1 and 3) to the better seed by group place, then wins, point difference and points scored; the FIBA Appendix D default ranks each group.';

/** Eighth-finals across paired groups (A with B, C with D), then quarter-finals and semi-finals within each half; all best of three. */
function eurocupKnockout(groupSize: number): PostseasonFormat {
  const at = (group: number, place: number): PostseasonRef => ({ place: group * groupSize + place });
  const series = (id: string, stage: PostseasonSeriesSpec['stage'], step: string, a: PostseasonRef, b: PostseasonRef): PostseasonSeriesSpec => ({ id, stage, step, bestOf: 3, a, b });
  const pairs = [[0, 1], [2, 3]] as const, ids = 'abcdefgh';
  const eighths = pairs.flatMap(([x, y], half) => [[at(x, 1), at(y, 4)], [at(y, 2), at(x, 3)], [at(y, 1), at(x, 4)], [at(x, 2), at(y, 3)]].map(([a, b], index) => series(`ef-${ids[half * 4 + index]}`, 'round-of-16', 'eighth', a!, b!)));
  const quarters = ['a', 'b', 'c', 'd'].map((id, index) => series(`qf-${id}`, 'quarter-final', 'quarter', { winner: `ef-${ids[2 * index]}` }, { winner: `ef-${ids[2 * index + 1]}` }));
  return {
    id: 'eurocup-2026-1', label: 'EuroCup playoffs', verified: true, source: EUROCUP_SOURCES,
    series: [...eighths, ...quarters, series('sf-a', 'semi-final', 'semi', { winner: 'qf-a' }, { winner: 'qf-b' }), series('sf-b', 'semi-final', 'semi', { winner: 'qf-c' }, { winner: 'qf-d' }), series('final', 'final', 'final', { winner: 'sf-a' }, { winner: 'sf-b' })],
    champion: { series: 'final' }, promoted: [], relegated: [],
  };
}

export const EUROPEAN_FORMATS: Readonly<Record<EuropeanFormatId, EuropeanFormat>> = Object.freeze({
  'euroleague-2026-1': {
    id: 'euroleague-2026-1', kind: 'euroleague', label: 'EuroLeague', source: EUROLEAGUE_SOURCES,
    clubs: { min: 10, max: 20 },
    // Thursdays of weeks 3-32 (24 September 2026 to 15 April 2027); Tuesday and Thursday in double-round weeks.
    regular: { firstWeek: 3, lastWeek: 32, day: 5, doubleDays: [3, 5] },
    standingsRule: 'fiba-2026-d',
    knockout: {
      id: 'euroleague-2026-1', label: 'EuroLeague Play-In, Playoffs and Final Four', verified: true, source: EUROLEAGUE_SOURCES,
      // Play-In 7 v 8 and 9 v 10, then the loser of 7 v 8 against the winner of 9 v 10; playoffs 1-8, 2-7, 3-6, 4-5 best of
      // five; Final Four semi-finals (1-8 winner v 4-5 winner, 2-7 v 3-6) and final at one venue, no third-place game.
      series: [...playIn(7, 8, 9, 10), ...bracket([...places(1, 2, 3, 4, 5, 6), { winner: 'pi-a', rank: 7 }, { winner: 'pi-c', rank: 8 }], [5, 1, 1], { neutralFrom: 'semi-final' })],
      champion: { series: 'final' }, promoted: [], relegated: [],
    },
    // Play-In 20 and 22 April 2027; playoffs 27 April to 11 May; Final Four 25 and 27 May (the real one is 28 and 30 May).
    slots: [{ week: 33, day: 3 }, { week: 33, day: 5 }, { week: 34, day: 3 }, { week: 34, day: 5 }, { week: 35, day: 3 }, { week: 35, day: 5 }, { week: 36, day: 3 }, { week: 38, day: 3 }, { week: 38, day: 5 }],
  },
  'eurocup-2026-1': {
    id: 'eurocup-2026-1', kind: 'eurocup', label: 'EuroCup', source: EUROCUP_SOURCES,
    clubs: { min: 16, max: 32 },
    // Fourteen rounds in weeks 4-19 (29 September 2026 to 13 January 2027), two weeks without a round spread evenly.
    regular: { firstWeek: 4, lastWeek: 19, day: 3, groups: [{ id: 'A', day: 3 }, { id: 'B', day: 3 }, { id: 'C', day: 4 }, { id: 'D', day: 4 }] },
    standingsRule: 'fiba-2026-d',
    knockout: eurocupKnockout,
    // Eighth-finals 2, 4 and 10 February 2027; quarter-finals 9, 11 and 17 March; semi-finals 31 March, 6 and 8 April;
    // finals 21, 27 and 29 April (the real third game is on Friday 30 April).
    slots: [{ week: 22, day: 3 }, { week: 22, day: 5 }, { week: 23, day: 4 }, { week: 27, day: 3 }, { week: 27, day: 5 }, { week: 28, day: 4 },
      { week: 30, day: 4 }, { week: 31, day: 3 }, { week: 31, day: 5 }, { week: 33, day: 4 }, { week: 34, day: 3 }, { week: 34, day: 5 }],
  },
} satisfies Record<EuropeanFormatId, EuropeanFormat>);

/** The save format that introduced each European format (format 57: the EuroLeague; 58: the EuroCup). */
export const EUROPEAN_FORMAT_VERSION: Readonly<Record<EuropeanFormatId, number>> = Object.freeze({ 'euroleague-2026-1': 57, 'eurocup-2026-1': 58 });

/** A format's knockout stage for a field (group formats build it for their group size). */
export function knockoutOf(format: EuropeanFormat, clubs: number): PostseasonFormat {
  return typeof format.knockout === 'function' ? format.knockout(clubs / (format.regular.groups?.length ?? 1)) : format.knockout;
}

/** A field the format can play: within its limits and, with groups, equal groups of at least four. */
export function fieldFits(format: EuropeanFormat, clubs: number): boolean {
  const groups = format.regular.groups?.length ?? 1;
  return clubs >= format.clubs.min && clubs <= format.clubs.max && clubs % groups === 0 && clubs / groups >= 4;
}

/** Every format reserves exactly one slot per knockout game slot (checked once at load). */
for (const format of Object.values(EUROPEAN_FORMATS)) {
  const knockout = knockoutOf(format, format.clubs.max);
  const starts = postseasonSlots(knockout), last = Math.max(...knockout.series.map(spec => starts.get(spec.id)! + spec.bestOf - 1));
  if (last !== format.slots.length) throw new Error(`European format ${format.id} must reserve a day for each of its ${last} knockout slots.`);
}

/** The European competitions whose games are played (format 57); format-56 worlds list theirs without playing them. */
export function playedEuropeanCompetitions(world: CareerWorld) {
  return (world.europeanCompetitions ?? []).filter(competition => competition.format !== undefined);
}

/** The last week with a European game in this world (0 when none is played). */
export function europeanWeeks(world: CareerWorld): number {
  return Math.max(0, ...playedEuropeanCompetitions(world).map(competition => {
    const format = EUROPEAN_FORMATS[competition.format!];
    return Math.max(format.regular.lastWeek, ...format.slots.map(slot => slot.week));
  }));
}

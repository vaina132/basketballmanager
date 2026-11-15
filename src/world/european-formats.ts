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
  regular: { firstWeek: number; lastWeek: number; day: number; doubleDays?: readonly [number, number]; groups?: readonly { id: string; day: number }[]; weeks?: readonly number[] };
  /** Field sizes the format can play when they are not simply equal groups (the BCL: 32 direct places or 30 plus two qualification tournaments). */
  fields?: readonly number[];
  /**
   * The BCL's stages before and after the regular season (step 3.5e): every game is derived from results (the regular
   * season waits for the qualification winners), clubs from one country never share a regular-season group, and the
   * group order leads through play-ins and a second group round to the knockout stage.
   */
  staged?: {
    qualificationDays: readonly { week: number; day: number }[];
    playInSlots: readonly { week: number; day: number }[];
    roundOf16: { weeks: readonly number[]; groups: readonly { id: string; day: number; members: readonly PostseasonRef[] }[] };
  };
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

const BCL_SOURCES = 'Basketball Champions League 2026-27 (Season 11): competition regulations (https://assets.fiba.basketball/image/upload/basketball-champions-league-209123-competition-regulations.pdf): two single-game qualification tournaments 14-20 September 2026 (QRT1 of eight from the quarter-finals, QRT2 of sixteen from the round of 16) whose winners join 30 direct entrants; eight groups of four, home and away, from four pots, clubs of one country never in one group; group winners to the Round of 16, second and third to best-of-three Play-Ins (A2-B3, B2-A3 and so on, the second-placed club at home in games 1 and 3) in January; the Round of 16 in four groups of four by the draw pattern (I: A1, E1, C2/D3, G2/H3; J: B1, F1, D2/C3, H2/G3; K: C1, G1, B2/A3, E2/F3; L: D1, H1, A2/B3, F2/E3), top two to best-of-three quarter-finals (group winner at home in games 1 and 3); Final Four with a third-place game (article 19.3). Draw: https://www.championsleague.basketball/en/news/basketball-champions-league-season-11-draw-completed; regular season from Tuesday 6 October 2026, Tuesdays and Wednesdays, Final Four by 16 May 2027 (https://www.championsleague.basketball/en/games). Assumed (dates and details not published): qualification on 8, 10, 15 and 17 September at one venue, seeded by squad strength; direct places, qualification places and pots by squad strength; regular rounds 6 and 20 October, 3 and 17 November, 8 and 22 December (groups A-D Tuesdays, E-H Wednesdays); Play-Ins 6, 13 and 20 January; Round of 16 on 26 January, 2, 9 and 16 February and 9 and 16 March (I-J Tuesdays, K-L Wednesdays); quarter-finals I1-J2, J1-I2, K1-L2, L1-K2 on 24 and 31 March and 7 April; Final Four semi-finals (I/J winners against K/L winners) on Tuesday 11 May, third place and final on Thursday 13 May; the qualification winners are drawn into the last pot without country protection; the FIBA Appendix D default ranks every group.';

/** The BCL's direct places when two qualification tournaments run (30 + two winners = 32 in groups). */
export const BCL_DIRECT_PLACES = 30;
/** The two qualification tournaments' sizes for a field: none for 32; otherwise powers of two, the second at least as large (the real 8 and 16). */
export function qualificationSplit(clubs: number): readonly [number, number] {
  if (clubs === 32) return [0, 0];
  const total = clubs - BCL_DIRECT_PLACES;
  for (const first of [8, 4, 2]) { const second = total - first; if ([2, 4, 8, 16].includes(second) && second >= first) return [first, second]; }
  throw new Error('This field cannot be split into two qualification tournaments.');
}
const BCL_FIELDS = [32, ...[4, 6, 8, 10, 12, 16, 18, 20, 24].map(total => BCL_DIRECT_PLACES + total)];

/** Quarter-finals between the Round of 16 groups (winner at home in games 1 and 3), then a Final Four at one venue with a third-place game. */
function bclKnockout(): PostseasonFormat {
  // Places count down the Round of 16 order: I 1-4, J 5-8, K 9-12, L 13-16.
  const at = (group: number, place: number): PostseasonRef => ({ place: group * 4 + place, rank: place });
  const qf = (id: string, a: PostseasonRef, b: PostseasonRef): PostseasonSeriesSpec => ({ id, stage: 'quarter-final', step: 'quarter', bestOf: 3, a, b });
  return {
    id: 'bcl-2026-1', label: 'Basketball Champions League quarter-finals and Final Four', verified: true, source: BCL_SOURCES,
    series: [
      qf('qf-a', at(0, 1), at(1, 2)), qf('qf-b', at(1, 1), at(0, 2)), qf('qf-c', at(2, 1), at(3, 2)), qf('qf-d', at(3, 1), at(2, 2)),
      { id: 'sf-a', stage: 'semi-final', step: 'semi', bestOf: 1, a: { winner: 'qf-a' }, b: { winner: 'qf-c' }, neutral: true },
      { id: 'sf-b', stage: 'semi-final', step: 'semi', bestOf: 1, a: { winner: 'qf-b' }, b: { winner: 'qf-d' }, neutral: true },
      { id: 'third', stage: 'third-place', step: 'final', bestOf: 1, a: { loser: 'sf-a' }, b: { loser: 'sf-b' }, neutral: true },
      { id: 'final', stage: 'final', step: 'final', bestOf: 1, a: { winner: 'sf-a' }, b: { winner: 'sf-b' }, neutral: true },
    ],
    champion: { series: 'final' }, promoted: [], relegated: [],
  };
}
/** Round of 16 groups: places count down the regular-season order, four a group (A 1-4 ... H 29-32); play-in winners by series. */
const r16 = (group: string, day: number, first: number, second: number, playIns: [string, string]) => ({ id: group, day, members: [{ place: first * 4 + 1 }, { place: second * 4 + 1 }, { winner: playIns[0] }, { winner: playIns[1] }] as PostseasonRef[] });

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
  'bcl-2026-1': {
    id: 'bcl-2026-1', kind: 'bcl', label: 'Basketball Champions League', source: BCL_SOURCES,
    clubs: { min: 32, max: 54 }, fields: BCL_FIELDS,
    regular: { firstWeek: 5, lastWeek: 16, day: 3, weeks: [5, 7, 9, 11, 14, 16], groups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id, index) => ({ id, day: index < 4 ? 3 : 4 })) },
    standingsRule: 'fiba-2026-d',
    knockout: bclKnockout(),
    slots: [{ week: 29, day: 4 }, { week: 30, day: 4 }, { week: 31, day: 4 }, { week: 36, day: 3 }, { week: 36, day: 5 }],
    staged: {
      qualificationDays: [{ week: 1, day: 3 }, { week: 1, day: 5 }, { week: 2, day: 3 }, { week: 2, day: 5 }],
      playInSlots: [{ week: 18, day: 4 }, { week: 19, day: 4 }, { week: 20, day: 4 }],
      // Play-ins pi-a A2-B3, pi-b B2-A3, pi-c C2-D3, pi-d D2-C3, pi-e E2-F3, pi-f F2-E3, pi-g G2-H3, pi-h H2-G3.
      roundOf16: { weeks: [21, 22, 23, 24, 27, 28], groups: [r16('I', 3, 0, 4, ['pi-c', 'pi-g']), r16('J', 3, 1, 5, ['pi-d', 'pi-h']), r16('K', 4, 2, 6, ['pi-b', 'pi-e']), r16('L', 4, 3, 7, ['pi-a', 'pi-f'])] },
    },
  },
} satisfies Record<EuropeanFormatId, EuropeanFormat>);

/** The save format that introduced each European format (format 57: the EuroLeague; 58: the EuroCup; 59: the BCL). */
export const EUROPEAN_FORMAT_VERSION: Readonly<Record<EuropeanFormatId, number>> = Object.freeze({ 'euroleague-2026-1': 57, 'eurocup-2026-1': 58, 'bcl-2026-1': 59 });

/** A format's knockout stage for a field (group formats build it for their group size). */
export function knockoutOf(format: EuropeanFormat, clubs: number): PostseasonFormat {
  return typeof format.knockout === 'function' ? format.knockout(clubs / (format.regular.groups?.length ?? 1)) : format.knockout;
}

/** A field the format can play: within its limits and, with groups, equal groups of at least four. */
export function fieldFits(format: EuropeanFormat, clubs: number): boolean {
  if (format.fields) return format.fields.includes(clubs);
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

import type { CareerWorld, EuropeanCompetitionKind, EuropeanFormatId } from '../domain/world';
import { bracket, places, playIn, postseasonSlots, type PostseasonFormat } from './postseason';

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
  /** Entrants allowed (the real competition has the maximum; smaller fields keep the same stages for test worlds). */
  clubs: { min: number; max: number };
  /** A double round robin from `firstWeek` to `lastWeek` on `day`; when there are more rounds than weeks, evenly spread weeks have two rounds, on `doubleDays`. */
  regular: { firstWeek: number; lastWeek: number; day: number; doubleDays: readonly [number, number] };
  /** The regular-season ranking (the FIBA Appendix D default where the competition's own text was not checked). */
  standingsRule: 'fiba-2026-d';
  /** The knockout stage, with the domestic postseason machinery: each series reserves a slot for every possible game. */
  knockout: PostseasonFormat;
  /** Each knockout slot's week and day, in slot order. */
  slots: readonly { week: number; day: number }[];
}

const EUROLEAGUE_SOURCES = 'EuroLeague format (20 clubs, 38 rounds, play-in 7-10, best-of-five playoffs 2-2-1, Final Four): https://www.euroleaguebasketball.net/euroleague/news/format-el; 2026-27 schedule (24 September 2026 to 16 April 2027): https://eurohoops.net/en/euroleague/1994855/euroleague-releases-full-schedule-for-the-2026-27-season; no third-place game since 2025-26: https://www.eurohoops.net/en/euroleague/1839488/euroleague-to-introduce-new-penalties-including-win-deduction-for-actions-of-team-officials. Assumed: the EuroLeague\'s own tie-break text was not checked, so the FIBA Appendix D default ranks the regular season; double-round weeks are spread evenly.';

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
} satisfies Record<EuropeanFormatId, EuropeanFormat>);

/** Every format reserves exactly one slot per knockout game slot (checked once at load). */
for (const format of Object.values(EUROPEAN_FORMATS)) {
  const starts = postseasonSlots(format.knockout), last = Math.max(...format.knockout.series.map(spec => starts.get(spec.id)! + spec.bestOf - 1));
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

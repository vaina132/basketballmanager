import type { CompetitionStage } from '../domain/competition';
import type { EuropeanFormatId } from '../domain/world';

/**
 * Domestic postseasons (step 3.4b): each league's 2026-27 format as data, its reserved calendar slots, and the games
 * that exist so far, derived deterministically from the final regular-season order and the results already played.
 * Nothing is stored except the games themselves, so a save check can derive the same games again.
 *
 * Calendar: postseason weeks follow the league calendar's last regular-season week. Each week has three game slots,
 * Saturday (the week's own date), Tuesday and Thursday, so every club has at least one full day of rest between games.
 * Every possible game of a series has a reserved slot; a game is created only once the games before it are played and
 * the series is still undecided, so games that are not needed never exist.
 *
 * Home advantage goes to the better seed of the bracket (the regular-season place unless the format seeds otherwise).
 * Sources and the assumptions taken where a rule is not published are listed per format and in
 * docs/competition-rules-2026.md.
 */
export type PostseasonFormatId = 'nba-2026-1' | 'bbl-2026-1' | 'bsl-2026-1' | 'tbl-2026-1' | 'acb-2026-1' | 'primera-feb-2026-1' | 'lba-2026-1' | 'serie-a2-2026-1' | 'lnb-elite-2026-1' | 'lnb-elite2-2026-1' | 'gbl-2026-1' | 'top4-1' | 'test-tier1-1' | 'test-tier2-1' | 'test-tier2-2';

/** A series participant: a regular-season place (of this league, or of the other division of the country; negative places count from the bottom, -1 being last), or the winner or loser of an earlier series. `rank` is the bracket seed used for home advantage; by default the place, or the earlier series' seed. */
/**
 * NBA step 5: `group` takes the place within a group's table (a conference; `PostseasonInput.groupOrders`), and
 * `byLeague` seeds a series winner by its place in the whole league (the NBA Finals' home court).
 */
export type PostseasonRef = { place: number; rank?: number; otherTier?: true; group?: string } | { winner: string; rank?: number; byLeague?: true } | { loser: string; rank?: number };
export interface PostseasonSeriesSpec {
  id: string;
  stage: Exclude<CompetitionStage, 'regular'>;
  /** Series sharing a step start together, after every series they depend on has used its last reserved slot. */
  step: string;
  bestOf: 1 | 3 | 5 | 7;
  a: PostseasonRef;
  b: PostseasonRef;
  /** A single venue (Primera FEB's final stage): the better seed is listed at home only nominally. */
  neutral?: true;
}
export interface PostseasonFormat {
  /** A domestic format's id, or a European competition format's id for its knockout stage (step 3.5b). */
  id: PostseasonFormatId | EuropeanFormatId;
  label: string;
  /** False when the league's own rules were not found and a labelled default is used. */
  verified: boolean;
  source: string;
  series: readonly PostseasonSeriesSpec[];
  /** The champion: the winner of a series, or the regular season's first place. */
  champion: { series: string } | { place: 1 };
  /** Into the division above (second divisions). */
  promoted: readonly ({ place: number } | { winner: string })[];
  /** Out of the division. A place `unlessWinsLowerFinal` stays up if it wins the lower division's promotion final. */
  relegated: readonly ({ place: number; unlessWinsLowerFinal?: true } | { loser: string })[];
}

export const playIn = (a: number, b: number, c: number, d: number): PostseasonSeriesSpec[] => [
  { id: 'pi-a', stage: 'play-in', step: 'play-in-1', bestOf: 1, a: { place: a }, b: { place: b } },
  { id: 'pi-b', stage: 'play-in', step: 'play-in-1', bestOf: 1, a: { place: c }, b: { place: d } },
  { id: 'pi-c', stage: 'play-in', step: 'play-in-2', bestOf: 1, a: { loser: 'pi-a' }, b: { winner: 'pi-b' } },
];
/** Quarter-finals 1-8, 2-7, 3-6, 4-5; semi-finals A-D and B-C; final. */
export const bracket = (seeds: readonly PostseasonRef[], [qf, sf, final]: readonly [1 | 3 | 5 | 7, 1 | 3 | 5 | 7, 1 | 3 | 5 | 7], options: { semis?: readonly [string, string][]; neutralFrom?: 'semi-final' } = {}): PostseasonSeriesSpec[] => {
  const ids = ['qf-a', 'qf-b', 'qf-c', 'qf-d'];
  const quarters: PostseasonSeriesSpec[] = [[0, 7], [1, 6], [2, 5], [3, 4]].map(([x, y], index) => ({ id: ids[index]!, stage: 'quarter-final', step: 'quarter', bestOf: qf, a: seeds[x!]!, b: seeds[y!]! }));
  const semis = options.semis ?? [['qf-a', 'qf-d'], ['qf-b', 'qf-c']];
  const neutral = options.neutralFrom === 'semi-final' ? { neutral: true as const } : {};
  return [
    ...quarters,
    ...semis.map(([x, y], index) => ({ id: index ? 'sf-b' : 'sf-a', stage: 'semi-final' as const, step: 'semi', bestOf: sf, a: { winner: x }, b: { winner: y }, ...neutral })),
    { id: 'final', stage: 'final', step: 'final', bestOf: final, a: { winner: 'sf-a' }, b: { winner: 'sf-b' }, ...neutral },
  ];
};
export const places = (...values: number[]): PostseasonRef[] => values.map(place => ({ place }));
/** NBA step 5: one conference's play-in (7-8, 9-10, then the loser of the first against the winner of the second) and its bracket. */
const nbaConference = (group: 'east' | 'west'): PostseasonSeriesSpec[] => {
  const id = (name: string) => `${group}-${name}`, place = (n: number) => ({ place: n, group });
  return [
    { id: id('pi-a'), stage: 'play-in', step: 'play-in-1', bestOf: 1, a: place(7), b: place(8) },
    { id: id('pi-b'), stage: 'play-in', step: 'play-in-1', bestOf: 1, a: place(9), b: place(10) },
    { id: id('pi-c'), stage: 'play-in', step: 'play-in-2', bestOf: 1, a: { loser: id('pi-a') }, b: { winner: id('pi-b') } },
    { id: id('r1-a'), stage: 'round-of-16', step: 'first-round', bestOf: 7, a: place(1), b: { winner: id('pi-c'), rank: 8 } },
    { id: id('r1-b'), stage: 'round-of-16', step: 'first-round', bestOf: 7, a: place(4), b: place(5) },
    { id: id('r1-c'), stage: 'round-of-16', step: 'first-round', bestOf: 7, a: place(2), b: { winner: id('pi-a'), rank: 7 } },
    { id: id('r1-d'), stage: 'round-of-16', step: 'first-round', bestOf: 7, a: place(3), b: place(6) },
    { id: id('sf-a'), stage: 'quarter-final', step: 'conference-semi', bestOf: 7, a: { winner: id('r1-a') }, b: { winner: id('r1-b') } },
    { id: id('sf-b'), stage: 'quarter-final', step: 'conference-semi', bestOf: 7, a: { winner: id('r1-c') }, b: { winner: id('r1-d') } },
    { id: id('cf'), stage: 'semi-final', step: 'conference-final', bestOf: 7, a: { winner: id('sf-a') }, b: { winner: id('sf-b') } },
  ];
};

const LNB = 'LNB 2026/27 competition regulations, articles 151-161: https://cdn.lnb.fr/uploads/content-library/39111ddae9f1edf9b1c739b6c69d3203ba0936c6d444634fa341d83db9fcc283.pdf';

export const POSTSEASON_FORMATS: Readonly<Record<PostseasonFormatId, PostseasonFormat>> = Object.freeze({
  'nba-2026-1': {
    id: 'nba-2026-1', label: 'NBA play-in and playoffs', verified: true,
    source: 'NBA play-in tournament and playoff format (NBA.com, 2025-26, unchanged for 2026-27): in each conference 7 v 8 and 9 v 10, then the loser of 7 v 8 against the winner of 9 v 10 for the eighth seed; first round 1-8, 4-5, 2-7, 3-6, conference semi-finals, conference finals and the NBA Finals, every series best of seven (2-2-1-1-1), home court to the better seed (in the Finals the better regular-season record). No promotion or relegation. Games every second day from the play-in (simplified calendar).',
    series: [...nbaConference('east'), ...nbaConference('west'),
      { id: 'final', stage: 'final', step: 'finals', bestOf: 7, a: { winner: 'east-cf', byLeague: true }, b: { winner: 'west-cf', byLeague: true } }],
    champion: { series: 'final' }, promoted: [], relegated: [],
  },
  'bbl-2026-1': {
    id: 'bbl-2026-1', label: 'Basketball Bundesliga playoffs', verified: true,
    source: 'easyCredit BBL Ausschreibung 2026/2027, sections 4.3-4.7: https://cms.easycredit-bbl.de/wp-content/uploads/2026/07/easyCredit-BBL-Ausschreibung-DM-2026_2027.pdf',
    series: [...playIn(7, 8, 9, 10), ...bracket([...places(1, 2, 3, 4, 5, 6), { winner: 'pi-a', rank: 7 }, { winner: 'pi-c', rank: 8 }], [5, 5, 5])],
    champion: { series: 'final' }, promoted: [], relegated: [{ place: 17 }, { place: 18 }],
  },
  'lnb-elite-2026-1': {
    id: 'lnb-elite-2026-1', label: 'LNB Élite playoffs', verified: true, source: `${LNB} (articles 151-154)`,
    series: [...playIn(7, 8, 9, 10), ...bracket([...places(1, 2, 3, 4, 5, 6), { winner: 'pi-a', rank: 7 }, { winner: 'pi-c', rank: 8 }], [3, 5, 5])],
    champion: { series: 'final' }, promoted: [], relegated: [{ place: 16 }, { place: 15, unlessWinsLowerFinal: true }],
  },
  'lnb-elite2-2026-1': {
    id: 'lnb-elite2-2026-1', label: 'Élite 2 promotion playoffs', verified: true, source: `${LNB} (articles 158-161)`,
    // Bracket seeds 1-8: places 2-5, the top division's 15th as seed 5, place 6, then the play-in winners; QF A 1-8, B 3-6, C 2-7, D 4-5; SF A-B and C-D.
    series: [...playIn(7, 8, 9, 10), ...((): PostseasonSeriesSpec[] => {
      const seed = [{ place: 2, rank: 1 }, { place: 3, rank: 2 }, { place: 4, rank: 3 }, { place: 5, rank: 4 }, { place: 15, rank: 5, otherTier: true as const }, { place: 6, rank: 6 }, { winner: 'pi-a', rank: 7 }, { winner: 'pi-c', rank: 8 }] satisfies PostseasonRef[];
      const qf = (id: string, x: number, y: number): PostseasonSeriesSpec => ({ id, stage: 'quarter-final', step: 'quarter', bestOf: 3, a: seed[x - 1]!, b: seed[y - 1]! });
      return [qf('qf-a', 1, 8), qf('qf-b', 3, 6), qf('qf-c', 2, 7), qf('qf-d', 4, 5),
        { id: 'sf-a', stage: 'semi-final', step: 'semi', bestOf: 3, a: { winner: 'qf-a' }, b: { winner: 'qf-b' } },
        { id: 'sf-b', stage: 'semi-final', step: 'semi', bestOf: 3, a: { winner: 'qf-c' }, b: { winner: 'qf-d' } },
        { id: 'final', stage: 'final', step: 'final', bestOf: 3, a: { winner: 'sf-a' }, b: { winner: 'sf-b' } }];
    })()],
    champion: { place: 1 }, promoted: [{ place: 1 }, { winner: 'final' }], relegated: [{ place: 19 }, { place: 20 }],
  },
  'bsl-2026-1': {
    id: 'bsl-2026-1', label: 'Basketbol Süper Ligi playoffs', verified: true,
    source: 'TBF BSL 2026-2027 statute, sections 1-2: https://www.tbf.org.tr/sitefiny-tbf-media/dokuman/C501A8C88D554440871463FE238691A3_basketbol-super-ligi-bsl-2026-2027-sezonu-statusu-ve-lig-siralamasi.pdf',
    series: bracket(places(1, 2, 3, 4, 5, 6, 7, 8), [3, 5, 5]),
    champion: { series: 'final' }, promoted: [], relegated: [{ place: 15 }, { place: 16 }],
  },
  'tbl-2026-1': {
    id: 'tbl-2026-1', label: 'Türkiye Basketbol Ligi promotion playoffs', verified: false,
    source: 'Default: no 2026-27 TBL statute was found. First place and the winner of a places 2-9 playoff (best of three, then best of five) are promoted, matching the BSL\'s two relegation places; the bottom two are relegated.',
    series: bracket(places(2, 3, 4, 5, 6, 7, 8, 9), [3, 5, 5]),
    champion: { place: 1 }, promoted: [{ place: 1 }, { winner: 'final' }], relegated: [{ place: 16 }, { place: 17 }],
  },
  'acb-2026-1': {
    id: 'acb-2026-1', label: 'Liga Endesa playoffs', verified: true,
    source: 'Liga Endesa playoff format (quarter-finals best of three 1-1-1, semi-finals and final best of five), unchanged for 2026-27 (playoffs 25 May-29 June 2027): https://www.flashscore.com.mx/noticias/baloncesto-acb-todo-lo-que-necesitas-saber-de-la-temporada-26-27-fechas-calendario-liga-copa-supercopa/p2LfB19t/. Relegation of the bottom two matches Primera FEB\'s two promotion places.',
    series: bracket(places(1, 2, 3, 4, 5, 6, 7, 8), [3, 5, 5]),
    champion: { series: 'final' }, promoted: [], relegated: [{ place: 17 }, { place: 18 }],
  },
  'primera-feb-2026-1': {
    id: 'primera-feb-2026-1', label: 'Primera FEB promotion playoffs', verified: true,
    source: 'FEB Primera FEB 2026-27 regulations, sections 3.2-3.3: https://www.feb.es/Documentos/Enlaces/[6537]BBCC%20Primera%20FEB%2026-27%20-%20Versi%C3%B3n%20Web.pdf. The final stage\'s semi-final pairing (1-8/4-5 and 2-7/3-6) is assumed.',
    series: bracket(places(2, 3, 4, 5, 6, 7, 8, 9), [5, 1, 1], { neutralFrom: 'semi-final' }),
    champion: { place: 1 }, promoted: [{ place: 1 }, { winner: 'final' }], relegated: [{ place: 16 }, { place: 17 }, { place: 18 }],
  },
  'lba-2026-1': {
    id: 'lba-2026-1', label: 'Lega Basket Serie A playoffs', verified: true,
    source: 'LBA playoffs: top eight, quarter-finals and semi-finals best of five, final best of seven (2025-26 format; no 2026-27 change announced): https://en.wikipedia.org/wiki/2025%E2%80%9326_LBA_season. Relegation of the bottom two matches Serie A2\'s two promotion places.',
    series: bracket(places(1, 2, 3, 4, 5, 6, 7, 8), [5, 5, 7]),
    champion: { series: 'final' }, promoted: [], relegated: [{ place: 15 }, { place: 16 }],
  },
  'serie-a2-2026-1': {
    id: 'serie-a2-2026-1', label: 'Serie A2 promotion playoffs and play-outs', verified: true,
    source: 'LNP Serie A2 2026-27 formula: https://www.legapallacanestro.com/formula-serie-a2-202627. The quarter-final pairing of places 2-7 and the two play-in winners (seeded 8 and 9 by the play-in game they won) is assumed.',
    series: [
      { id: 'pi-a', stage: 'play-in', step: 'play-in-1', bestOf: 1, a: { place: 10 }, b: { place: 13 } },
      { id: 'pi-b', stage: 'play-in', step: 'play-in-1', bestOf: 1, a: { place: 11 }, b: { place: 12 } },
      { id: 'pi-c', stage: 'play-in', step: 'play-in-2', bestOf: 1, a: { place: 9 }, b: { winner: 'pi-a' } },
      { id: 'pi-d', stage: 'play-in', step: 'play-in-2', bestOf: 1, a: { place: 8 }, b: { winner: 'pi-b' } },
      ...bracket([...places(2, 3, 4, 5, 6, 7), { winner: 'pi-d', rank: 8 }, { winner: 'pi-c', rank: 9 }], [5, 5, 5]),
      { id: 'po-a', stage: 'play-out', step: 'play-out-1', bestOf: 5, a: { place: 16 }, b: { place: 19 } },
      { id: 'po-b', stage: 'play-out', step: 'play-out-1', bestOf: 5, a: { place: 17 }, b: { place: 18 } },
      { id: 'po-c', stage: 'play-out', step: 'play-out-2', bestOf: 5, a: { loser: 'po-a' }, b: { loser: 'po-b' } },
    ],
    champion: { place: 1 }, promoted: [{ place: 1 }, { winner: 'final' }], relegated: [{ place: 20 }, { loser: 'po-c' }],
  },
  'gbl-2026-1': {
    id: 'gbl-2026-1', label: 'Greek Basket League playoffs', verified: true,
    source: 'Greek Basket League playoffs: top eight, quarter-finals and semi-finals best of three, final best of five, no play-in or play-out; last place relegated (2025-26 format and assembly decision; no 2026-27 change found): https://en.wikipedia.org/wiki/2025%E2%80%9326_Greek_Basket_League, https://www.parapolitika.gr/sports/article/1590544/basket-league-psifistikan-oi-62-xenoi-upovivazetai-mia-omada-stin-elite-league/',
    series: bracket(places(1, 2, 3, 4, 5, 6, 7, 8), [3, 3, 5]),
    champion: { series: 'final' }, promoted: [], relegated: [{ place: 14 }],
  },
  'top4-1': {
    id: 'top4-1', label: 'Top-four playoffs', verified: true,
    source: 'Generic format for fictional leagues outside the real-data countries (the automated tests\' small leagues): semi-finals 1-4 and 2-3 and a final, best of three; last place relegated. Never used for a real league.',
    series: [
      { id: 'sf-a', stage: 'semi-final', step: 'semi', bestOf: 3, a: { place: 1 }, b: { place: 4 } },
      { id: 'sf-b', stage: 'semi-final', step: 'semi', bestOf: 3, a: { place: 2 }, b: { place: 3 } },
      { id: 'final', stage: 'final', step: 'final', bestOf: 3, a: { winner: 'sf-a' }, b: { winner: 'sf-b' } },
    ],
    champion: { series: 'final' }, promoted: [], relegated: [],
  },
  // Generic two-division formats for the automated tests' small leagues (step 3.4c); never used for a real league.
  'test-tier1-1': {
    id: 'test-tier1-1', label: 'Top-four playoffs', verified: true,
    source: 'Generic first-division format for fictional test leagues: semi-finals 1-4 and 2-3 and a final, best of three; the last two relegated.',
    series: [
      { id: 'sf-a', stage: 'semi-final', step: 'semi', bestOf: 3, a: { place: 1 }, b: { place: 4 } },
      { id: 'sf-b', stage: 'semi-final', step: 'semi', bestOf: 3, a: { place: 2 }, b: { place: 3 } },
      { id: 'final', stage: 'final', step: 'final', bestOf: 3, a: { winner: 'sf-a' }, b: { winner: 'sf-b' } },
    ],
    champion: { series: 'final' }, promoted: [], relegated: [{ place: -2 }, { place: -1 }],
  },
  'test-tier2-1': {
    id: 'test-tier2-1', label: 'Promotion playoffs', verified: true,
    source: 'Generic second-division format for fictional test leagues: first place promoted; places 2-5 play semi-finals and a final, best of three, for the second promotion place.',
    series: [
      { id: 'sf-a', stage: 'semi-final', step: 'semi', bestOf: 3, a: { place: 2 }, b: { place: 5 } },
      { id: 'sf-b', stage: 'semi-final', step: 'semi', bestOf: 3, a: { place: 3 }, b: { place: 4 } },
      { id: 'final', stage: 'final', step: 'final', bestOf: 3, a: { winner: 'sf-a' }, b: { winner: 'sf-b' } },
    ],
    champion: { place: 1 }, promoted: [{ place: 1 }, { winner: 'final' }], relegated: [],
  },
  'test-tier2-2': {
    id: 'test-tier2-2', label: 'Promotion playoffs', verified: true,
    source: 'Generic second-division format for fictional test leagues with a division below (step 3.4d-2): as test-tier2-1, and the last place relegated.',
    series: [
      { id: 'sf-a', stage: 'semi-final', step: 'semi', bestOf: 3, a: { place: 2 }, b: { place: 5 } },
      { id: 'sf-b', stage: 'semi-final', step: 'semi', bestOf: 3, a: { place: 3 }, b: { place: 4 } },
      { id: 'final', stage: 'final', step: 'final', bestOf: 3, a: { winner: 'sf-a' }, b: { winner: 'sf-b' } },
    ],
    champion: { place: 1 }, promoted: [{ place: 1 }, { winner: 'final' }], relegated: [{ place: -1 }],
  },
} satisfies Record<PostseasonFormatId, PostseasonFormat>);

/** The highest regular-season place a format refers to in its own league (the league needs at least that many clubs). */
export function postseasonPlacesNeeded(format: PostseasonFormat): number {
  const refs = [...format.series.flatMap(spec => [spec.a, spec.b]), ...format.promoted, ...format.relegated];
  const own = refs.flatMap(ref => 'place' in ref && !('otherTier' in ref && ref.otherTier) && !('group' in ref && ref.group) ? [ref.place] : []);
  // NBA step 5: places within a group (a conference of half the league) need twice as many clubs.
  const grouped = refs.flatMap(ref => 'place' in ref && 'group' in ref && ref.group ? [2 * ref.place] : []);
  // Places counted from the bottom must not reach the places counted from the top.
  return Math.max(0, ...grouped, ...own.filter(place => place > 0)) + own.filter(place => place < 0).length;
}

/** Whether a league may use this format: its own country's format, or the generic one outside the real-data countries. */
export function postseasonFormatAllowed(id: string, country: string, tier: number, clubs: number): id is PostseasonFormatId {
  if (!Object.hasOwn(POSTSEASON_FORMATS, id)) return false;
  const expected = postseasonFormatFor(country, tier);
  return (expected ? id === expected : id === 'top4-1' || id === `test-tier${tier}-1` || tier === 2 && id === 'test-tier2-2') && clubs >= postseasonPlacesNeeded(POSTSEASON_FORMATS[id as PostseasonFormatId]);
}

/** The format each league uses by country and tier (sprint 3 scope). */
export function postseasonFormatFor(country: string, tier: number): PostseasonFormatId | null {
  const key = `${country}/${tier}`;
  return ({ 'Germany/1': 'bbl-2026-1', 'France/1': 'lnb-elite-2026-1', 'France/2': 'lnb-elite2-2026-1', 'Turkey/1': 'bsl-2026-1', 'Turkey/2': 'tbl-2026-1', 'Spain/1': 'acb-2026-1', 'Spain/2': 'primera-feb-2026-1', 'Italy/1': 'lba-2026-1', 'Italy/2': 'serie-a2-2026-1', 'Greece/1': 'gbl-2026-1', 'USA/1': 'nba-2026-1' } as Record<string, PostseasonFormatId>)[key] ?? null;
}

const HOSTS: Readonly<Record<1 | 3 | 5 | 7, readonly ('higher' | 'lower')[]>> = { 1: ['higher'], 3: ['higher', 'lower', 'higher'], 5: ['higher', 'higher', 'lower', 'lower', 'higher'], 7: ['higher', 'higher', 'lower', 'lower', 'higher', 'lower', 'higher'] };
/** Game slots per postseason week: Saturday, Tuesday, Thursday (days after the week's Saturday). */
export const POSTSEASON_SLOT_OFFSETS = Object.freeze([0, 3, 5]);

const dependencies = (spec: PostseasonSeriesSpec) => [spec.a, spec.b].flatMap(ref => 'winner' in ref ? [ref.winner] : 'loser' in ref ? [ref.loser] : []);

/** Each series' first reserved slot (1-based), independent of results. */
export function postseasonSlots(format: PostseasonFormat): Map<string, number> {
  const starts = new Map<string, number>(), ends = new Map<string, number>(), steps = [...new Set(format.series.map(spec => spec.step))];
  for (const step of steps) {
    const members = format.series.filter(spec => spec.step === step);
    const start = Math.max(1, ...members.flatMap(spec => dependencies(spec).map(id => { const end = ends.get(id); if (end === undefined) throw new Error(`Postseason format ${format.id} lists ${spec.id} before a series it depends on.`); return end + 1; })));
    for (const spec of members) { starts.set(spec.id, start); ends.set(spec.id, start + spec.bestOf - 1); }
  }
  return starts;
}

/** Reserved postseason weeks of a format (three slots a week); formats are constants, so each is worked out once. */
const postseasonWeeksCache = new WeakMap<PostseasonFormat, number>();
export function postseasonWeeks(format: PostseasonFormat): number {
  const known = postseasonWeeksCache.get(format);
  if (known !== undefined) return known;
  const starts = postseasonSlots(format);
  const weeks = Math.ceil(Math.max(...format.series.map(spec => starts.get(spec.id)! + spec.bestOf - 1)) / POSTSEASON_SLOT_OFFSETS.length);
  postseasonWeeksCache.set(format, weeks);
  return weeks;
}

/** A postseason game: an ordinary season fixture with its stage, series and game number. */
export interface PostseasonFixtureFields { stage: Exclude<CompetitionStage, 'regular'>; seriesId: string; game: number; neutral?: true }
export interface PostseasonSeriesState {
  id: string;
  stage: PostseasonSeriesSpec['stage'];
  bestOf: PostseasonSeriesSpec['bestOf'];
  startSlot: number;
  neutral: boolean;
  /** The better seed first; null until both participants are known. */
  higher: { clubId: string; rank: number } | null;
  lower: { clubId: string; rank: number } | null;
  wins: Record<string, number>;
  fixtureIds: string[];
  winner: string | null;
  loser: string | null;
}
type GameRecord = { id: string; homeClubId: string; awayClubId: string; result: { winnerClubId: string } | null };

export interface PostseasonInput {
  leagueId: string;
  format: PostseasonFormat;
  seasonNumber: number;
  /** Final regular-season order (club ids, first to last), or null while the regular season is still being played. */
  order: readonly string[] | null;
  /** The other division of the same country, when a format seeds from it (France). */
  otherOrder?: readonly string[] | null;
  /** The league calendar's week and date of a 1-based postseason slot. */
  slotDay: (slot: number) => { round: number; date: string };
  /** Every fixture of the season so far (results decide which games exist). */
  fixtures: readonly GameRecord[];
  /** A seed for each place's club, for formats seeded across groups (European competitions); the place itself otherwise. */
  rankOf?: (clubId: string) => number;
  /** NBA step 5: each group's final table (club ids, first to last) for places within a group; null while unfinished. */
  groupOrders?: Readonly<Record<string, readonly string[] | null>>;
}

export const postseasonFixtureId = (leagueId: string, seasonNumber: number, seriesId: string, game: number) => `${leagueId}-s${seasonNumber}-${seriesId}-g${game}`;

/** The series as far as results decide them, and the postseason games that should exist now. */
export function derivePostseason(input: PostseasonInput): { series: PostseasonSeriesState[]; fixtures: ({ id: string; round: number; date: string; homeClubId: string; awayClubId: string } & PostseasonFixtureFields)[] } {
  const { format, order, seasonNumber, leagueId } = input;
  const starts = postseasonSlots(format), byId = new Map(input.fixtures.map(fixture => [fixture.id, fixture]));
  const states = new Map<string, PostseasonSeriesState>();
  const fixtures: ReturnType<typeof derivePostseason>['fixtures'] = [];
  const resolve = (ref: PostseasonRef): { clubId: string; rank: number } | null => {
    if ('place' in ref) {
      const table = ref.group ? input.groupOrders?.[ref.group] ?? null : ref.otherTier ? input.otherOrder ?? null : order;
      const clubId = table?.[ref.place < 0 ? table.length + ref.place : ref.place - 1];
      return clubId ? { clubId, rank: ref.rank ?? input.rankOf?.(clubId) ?? ref.place } : null;
    }
    const source = states.get('winner' in ref ? ref.winner : ref.loser);
    const clubId = source ? ('winner' in ref ? source.winner : source.loser) : null;
    if (!source || !clubId) return null;
    const inherited = source.higher!.clubId === clubId ? source.higher!.rank : source.lower!.rank;
    // NBA step 5: the Finals' home court goes by the whole league's table.
    if ('byLeague' in ref && ref.byLeague) { const place = order?.indexOf(clubId) ?? -1; return { clubId, rank: place >= 0 ? place + 1 : inherited }; }
    return { clubId, rank: ref.rank ?? inherited };
  };
  for (const spec of format.series) {
    const a = resolve(spec.a), b = resolve(spec.b);
    const [higher, lower] = a && b ? (a.rank <= b.rank ? [a, b] : [b, a]) : [null, null];
    const state: PostseasonSeriesState = { id: spec.id, stage: spec.stage, bestOf: spec.bestOf, startSlot: starts.get(spec.id)!, neutral: !!spec.neutral, higher, lower, wins: {}, fixtureIds: [], winner: null, loser: null };
    if (higher && lower) {
      if (higher.clubId === lower.clubId) throw new Error(`Postseason series ${spec.id} would pair a club with itself.`);
      state.wins = { [higher.clubId]: 0, [lower.clubId]: 0 };
      const needed = Math.ceil(spec.bestOf / 2), hosts = HOSTS[spec.bestOf];
      for (let game = 1; game <= spec.bestOf && !state.winner; game += 1) {
        const id = postseasonFixtureId(leagueId, seasonNumber, spec.id, game), { round, date } = input.slotDay(state.startSlot + game - 1);
        const host = hosts[game - 1] === 'higher' ? higher : lower, guest = host === higher ? lower : higher;
        fixtures.push({ id, round, date, homeClubId: host.clubId, awayClubId: guest.clubId, stage: spec.stage, seriesId: spec.id, game, ...(spec.neutral ? { neutral: true as const } : {}) });
        state.fixtureIds.push(id);
        const played = byId.get(id);
        if (!played?.result) break;
        if (played.homeClubId !== host.clubId || played.awayClubId !== guest.clubId) throw new Error(`Postseason game ${id} does not match its series.`);
        state.wins[played.result.winnerClubId] = (state.wins[played.result.winnerClubId] ?? 0) + 1;
        if (state.wins[played.result.winnerClubId]! >= needed) { state.winner = played.result.winnerClubId; state.loser = played.result.winnerClubId === higher.clubId ? lower.clubId : higher.clubId; }
      }
    }
    states.set(spec.id, state);
  }
  return { series: [...states.values()], fixtures };
}

/** Champion, promotions and relegations as far as they are decided (null entries are still open). */
export function postseasonOutcome(format: PostseasonFormat, order: readonly string[] | null, series: readonly PostseasonSeriesState[]): { champion: string | null; promoted: (string | null)[]; relegated: { clubId: string | null; unlessWinsLowerFinal: boolean }[] } {
  const byId = new Map(series.map(entry => [entry.id, entry]));
  const place = (n: number) => order?.[n < 0 ? order.length + n : n - 1] ?? null;
  return {
    champion: 'series' in format.champion ? byId.get(format.champion.series)?.winner ?? null : place(1),
    promoted: format.promoted.map(ref => 'place' in ref ? place(ref.place) : byId.get(ref.winner)?.winner ?? null),
    relegated: format.relegated.map(ref => ({ clubId: 'place' in ref ? place(ref.place) : byId.get(ref.loser)?.loser ?? null, unlessWinsLowerFinal: 'place' in ref && !!ref.unlessWinsLowerFinal })),
  };
}

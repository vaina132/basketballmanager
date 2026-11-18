import type { Coach } from '../domain/coaching';

const attributes = ['twoPoint', 'threePoint', 'freeThrow', 'passing', 'defense', 'rebounding', 'stamina'] as const;
function coach(id: number, name: string, fee: number, values: readonly number[]): Coach {
  return Object.freeze({ id: `coach-${String(id).padStart(2, '0')}`, name, fee,
    skills: Object.freeze(Object.fromEntries(attributes.map((key, index) => [key, values[index]!])) as Coach['skills']),
  });
}

/** Authored fictional coaches and development-budget estimates; not real-world staff data. */
export const DEVELOPMENT_COACHES: readonly Coach[] = Object.freeze([
  coach(1, 'Adrian Vale', 4_000_000, [5, 4, 6, 5, 4, 5, 6]),
  coach(2, 'Bruno Sorel', 4_000_000, [4, 6, 5, 4, 6, 5, 5]),
  coach(3, 'Felix Arden', 4_000_000, [6, 4, 5, 5, 5, 6, 4]),
  coach(4, 'Luka Vellis', 4_000_000, [5, 6, 4, 6, 5, 4, 5]),
  coach(5, 'Milan Torek', 4_000_000, [4, 5, 5, 6, 6, 4, 5]),
  coach(6, 'Remi Laurent', 4_000_000, [6, 5, 6, 4, 4, 5, 5]),
  coach(7, 'Nico Bellan', 7_000_000, [10, 8, 7, 5, 4, 5, 4]),
  coach(8, 'Oscar Varen', 7_000_000, [7, 10, 8, 5, 4, 4, 5]),
  coach(9, 'Theo Marcel', 6_500_000, [6, 8, 10, 5, 4, 4, 5]),
  coach(10, 'Emil Renard', 7_500_000, [5, 6, 6, 10, 7, 4, 5]),
  coach(11, 'Dario Solen', 7_500_000, [4, 4, 5, 7, 10, 8, 6]),
  coach(12, 'Anton Breuer', 6_500_000, [5, 4, 4, 4, 8, 10, 7]),
  coach(13, 'Louis Darven', 6_500_000, [4, 4, 4, 5, 6, 7, 10]),
  coach(14, 'Petar Mirov', 8_000_000, [8, 8, 8, 8, 8, 8, 8]),
  coach(15, 'Ivo Maren', 5_000_000, [7, 6, 5, 6, 5, 4, 5]),
  coach(16, 'Adam Selan', 5_000_000, [5, 7, 7, 5, 4, 5, 5]),
  coach(17, 'Jules Noren', 5_000_000, [5, 5, 5, 8, 6, 4, 4]),
  coach(18, 'Tomas Velde', 5_000_000, [4, 4, 5, 6, 8, 6, 5]),
  coach(19, 'Noel Frane', 5_000_000, [4, 5, 4, 5, 6, 8, 6]),
  coach(20, 'Marko Leris', 5_000_000, [5, 4, 5, 4, 5, 6, 8]),
  coach(21, 'Enzo Talin', 4_500_000, [6, 6, 7, 4, 4, 4, 5]),
  coach(22, 'Lars Fenner', 4_500_000, [4, 4, 5, 6, 7, 5, 4]),
  coach(23, 'Oskar Meier', 4_000_000, [5, 4, 4, 5, 5, 7, 5]),
  coach(24, 'Hugo Taren', 4_000_000, [4, 4, 5, 5, 4, 5, 7]),
  coach(25, 'Marek Sava', 3_500_000, [5, 5, 4, 4, 4, 4, 4]),
  coach(26, 'Alex Doran', 3_500_000, [4, 5, 5, 4, 4, 4, 4]),
  coach(27, 'Niko Feran', 3_500_000, [4, 4, 4, 5, 5, 4, 4]),
  coach(28, 'Leo Varden', 3_500_000, [4, 4, 4, 4, 5, 5, 4]),
  coach(29, 'Filip Ravel', 3_500_000, [4, 4, 4, 4, 4, 5, 5]),
  coach(30, 'Sami Loran', 3_500_000, [5, 4, 5, 4, 4, 4, 4]),
]);

export const COACHES = DEVELOPMENT_COACHES;

/**
 * Top coaches for club-level careers (owner play-test feedback, 18 November 2026: "There are no 5-star coaches").
 * A coach's overall is the average of his seven skills, and the authored coaches above top out at 8 (4 stars), so no
 * coach could ever show more than 4 stars. These terms add two 5-star, two 4.5-star and two 4-star coaches at high
 * fees; each market repeats them by its size (`src/data/staff-directory.ts`). Names are generated; ids are
 * `coach-elite-NN`, so the authored coaches and every saved appointment keep their identity and terms.
 */
export const ELITE_COACH_TERMS: readonly Omit<Coach, 'id' | 'name'>[] = Object.freeze([
  [15_000_000, [10, 9, 10, 10, 9, 10, 10]],
  [15_000_000, [9, 10, 9, 10, 10, 10, 9]],
  [12_000_000, [9, 9, 9, 10, 9, 9, 8]],
  [12_000_000, [10, 9, 8, 9, 9, 10, 8]],
  [9_500_000, [8, 9, 8, 8, 9, 8, 8]],
  [9_500_000, [9, 8, 8, 9, 8, 8, 8]],
].map(([fee, values]) => Object.freeze({ fee: fee as number, skills: Object.freeze(Object.fromEntries(attributes.map((key, index) => [key, (values as number[])[index]!])) as Coach['skills']) })));

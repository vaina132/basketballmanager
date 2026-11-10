import type { Scout } from '../domain/scouts';

function scout(id: number, name: string, fee: number, evaluation: number, reporting: number): Scout {
  return Object.freeze({ id: `scout-${String(id).padStart(2, '0')}`, name, fee, skills: Object.freeze({ evaluation, reporting }) });
}

/** Fictional identities and authored fee estimates, not real-world scouting staff. */
export const DEVELOPMENT_SCOUTS: readonly Scout[] = Object.freeze([
  scout(1, 'Elias Coren', 2_000_000, 4, 4),
  scout(2, 'Marco Selvi', 2_000_000, 5, 3),
  scout(3, 'Adrien Solan', 2_000_000, 3, 5),
  scout(4, 'Nils Verden', 2_000_000, 4, 4),
  scout(5, 'Petar Kalen', 2_000_000, 5, 3),
  scout(6, 'Dario Elven', 2_000_000, 3, 5),
  scout(7, 'Leon Marvic', 3_000_000, 7, 5),
  scout(8, 'Alexis Varen', 3_000_000, 5, 7),
  scout(9, 'Emre Sayan', 3_000_000, 6, 6),
  scout(10, 'Luca Ferrel', 3_000_000, 7, 5),
  scout(11, 'Milan Revik', 3_000_000, 5, 7),
  scout(12, 'Felix Doren', 3_000_000, 6, 6),
  scout(13, 'Jules Vellin', 4_000_000, 8, 8),
  scout(14, 'Aron Martel', 4_000_000, 9, 7),
  scout(15, 'Niko Sorev', 4_000_000, 7, 9),
  scout(16, 'Tomas Ravel', 4_000_000, 8, 8),
  scout(17, 'Enzo Darven', 4_000_000, 9, 7),
  scout(18, 'Oskar Loran', 4_000_000, 7, 9),
  scout(19, 'Filip Senar', 5_000_000, 10, 10),
  scout(20, 'Remi Arven', 5_000_000, 10, 10),
  scout(21, 'Bora Velen', 5_000_000, 10, 10),
  scout(22, 'Ivo Delmar', 2_500_000, 6, 4),
  scout(23, 'Sami Loren', 2_500_000, 4, 6),
  scout(24, 'Noel Taren', 2_500_000, 5, 5),
]);

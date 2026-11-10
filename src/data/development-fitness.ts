import type { FitnessCoach } from '../domain/fitness';

function coach(id: number, name: string, fee: number, recovery: number, workload: number): FitnessCoach {
  return Object.freeze({ id: `fitness-${String(id).padStart(2, '0')}`, name, fee, skills: Object.freeze({ recovery, workload }) });
}

/** Fictional staff and authored fees for the development economy. */
export const DEVELOPMENT_FITNESS_COACHES: readonly FitnessCoach[] = Object.freeze([
  coach(1, 'Adrian Voss', 2_000_000, 4, 4),
  coach(2, 'Matteo Arden', 2_000_000, 5, 3),
  coach(3, 'Luka Seran', 2_000_000, 3, 5),
  coach(4, 'Emil Taren', 2_000_000, 4, 4),
  coach(5, 'Jonas Velden', 2_000_000, 5, 3),
  coach(6, 'Deniz Moren', 2_000_000, 3, 5),
  coach(7, 'Bastien Arvel', 3_000_000, 8, 4),
  coach(8, 'Niko Ferrel', 3_000_000, 4, 8),
  coach(9, 'Tomas Belin', 3_000_000, 6, 6),
  coach(10, 'Ivo Laren', 4_000_000, 9, 7),
  coach(11, 'Oskar Toren', 4_000_000, 7, 9),
  coach(12, 'Remi Valen', 5_000_000, 10, 10),
]);

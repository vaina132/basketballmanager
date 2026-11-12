import type { YouthCoach } from '../domain/youth';
const coach = (id: number, name: string, development: number, fee: number): YouthCoach => Object.freeze({ id: `youth-${String(id).padStart(2, '0')}`, name, development, fee });
/** Fictional youth-development staff and provisional fees. */
export const DEVELOPMENT_YOUTH_COACHES: readonly YouthCoach[] = Object.freeze([
  coach(1, 'Lars Meren', 4, 1_000_000), coach(2, 'Deniz Arven', 4, 1_000_000), coach(3, 'Milan Beric', 4, 1_000_000),
  coach(4, 'Ruben Vellis', 4, 1_000_000), coach(5, 'Nico Solan', 4, 1_000_000), coach(6, 'Alex Neran', 4, 1_000_000),
  coach(7, 'Theo Darin', 6, 1_500_000), coach(8, 'Emil Varen', 6, 1_500_000), coach(9, 'Miro Belin', 7, 2_000_000),
  coach(10, 'Aron Selis', 8, 2_000_000), coach(11, 'Jules Verin', 9, 2_500_000), coach(12, 'Leon Taren', 10, 3_000_000),
]);

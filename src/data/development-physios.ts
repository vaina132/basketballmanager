import type { Physio } from '../domain/physio';

function physio(id: number, name: string, rehabilitation: number, fee: number): Physio {
  return Object.freeze({ id: `physio-${String(id).padStart(2, '0')}`, name, rehabilitation, fee });
}

/** Fictional staff and balancing estimates, not real medical personnel or medical claims. */
export const DEVELOPMENT_PHYSIOS: readonly Physio[] = Object.freeze([
  physio(1, 'Alex Marin', 4, 2_000_000),
  physio(2, 'Luca Brenner', 4, 2_000_000),
  physio(3, 'Emil Sorel', 4, 2_000_000),
  physio(4, 'Tomas Vern', 4, 2_000_000),
  physio(5, 'Milan Arven', 4, 2_000_000),
  physio(6, 'Deniz Varan', 4, 2_000_000),
  physio(7, 'Nico Ferlan', 6, 3_000_000),
  physio(8, 'Remi Solen', 6, 3_000_000),
  physio(9, 'Aron Vellis', 7, 3_500_000),
  physio(10, 'Jules Darven', 8, 4_000_000),
  physio(11, 'Filip Noren', 9, 4_500_000),
  physio(12, 'Oskar Selan', 10, 5_000_000),
]);

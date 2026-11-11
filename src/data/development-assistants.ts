import type { AssistantCoach } from '../domain/assistant';

function assistant(id: number, name: string, assessment: number, fee: number): AssistantCoach {
  return Object.freeze({ id: `assistant-${String(id).padStart(2, '0')}`, name, assessment, fee });
}

/** Fictional staff; fees are development estimates, equal within each advice-resolution band. */
export const DEVELOPMENT_ASSISTANTS: readonly AssistantCoach[] = Object.freeze([
  assistant(1, 'Marco Belin', 4, 2_000_000),
  assistant(2, 'Adam Veric', 4, 2_000_000),
  assistant(3, 'Leon Sarin', 4, 2_000_000),
  assistant(4, 'Nils Ardin', 4, 2_000_000),
  assistant(5, 'Cem Toran', 4, 2_000_000),
  assistant(6, 'Ruben Celis', 4, 2_000_000),
  assistant(7, 'Ilan Mercier', 6, 3_000_000),
  assistant(8, 'Dario Neris', 6, 3_000_000),
  assistant(9, 'Miro Varlan', 7, 3_000_000),
  assistant(10, 'Elian Moren', 8, 4_000_000),
  assistant(11, 'Jonas Berin', 9, 4_000_000),
  assistant(12, 'Theo Laren', 10, 4_000_000),
]);

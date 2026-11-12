import type { Rivalry } from '../domain/rivalries';

const rivalries: Rivalry[] = [
  { id: 'river-derby', clubIds: ['rhine-falcons', 'danube-lynx'], name: 'River derby', intensity: 3, origin: 'fictional-development-league' },
  { id: 'sea-derby', clubIds: ['aegean-waves', 'adriatic-comets'], name: 'Sea derby', intensity: 2, origin: 'fictional-development-league' },
  { id: 'summit-rivalry', clubIds: ['alpine-stags', 'atlantic-pilots'], name: 'Summit rivalry', intensity: 1, origin: 'fictional-development-league' },
];

/** Fictional rivalries for the development league; every club has exactly one rival. */
export const DEVELOPMENT_RIVALRIES: readonly Rivalry[] = Object.freeze(rivalries.map(rivalry => Object.freeze(rivalry)));

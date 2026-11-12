export interface DevelopmentPresident {
  clubId: string;
  name: string;
  /** Willingness to invest, 1 (reluctant) to 5 (generous): lowers the confidence the board requires for capital. */
  generosity: 1 | 2 | 3 | 4 | 5;
  /** Owner capital available for facility projects each season, in euro cents. */
  seasonCapital: number;
}

/** Fictional club presidents for the development league; their traits are game rules, not claims about real people. */
export const DEVELOPMENT_PRESIDENTS: readonly DevelopmentPresident[] = Object.freeze([
  { clubId: 'rhine-falcons', name: 'Helena Varga', generosity: 3, seasonCapital: 20_000_000 },
  { clubId: 'aegean-waves', name: 'Nikos Thalassinos', generosity: 4, seasonCapital: 15_000_000 },
  { clubId: 'alpine-stags', name: 'Matthias Kernegger', generosity: 2, seasonCapital: 12_000_000 },
  { clubId: 'adriatic-comets', name: 'Lucia Benedetti', generosity: 5, seasonCapital: 25_000_000 },
  { clubId: 'danube-lynx', name: 'Andrei Popescu', generosity: 3, seasonCapital: 15_000_000 },
  { clubId: 'atlantic-pilots', name: 'Fiona Calloway', generosity: 4, seasonCapital: 18_000_000 },
].map(president => Object.freeze(president as DevelopmentPresident)));

export function getDevelopmentPresident(clubId: string): DevelopmentPresident {
  const president = DEVELOPMENT_PRESIDENTS.find(item => item.clubId === clubId);
  if (!president) throw new Error('This club has no development president.');
  return president;
}

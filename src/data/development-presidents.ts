export type PresidentTraitLevel = 1 | 2 | 3 | 4 | 5;
/** How the president answers requests for capital: `flexible` gives more, `hard` asks more (`PRESIDENT_RULES.negotiation`). */
export type PresidentNegotiationStyle = 'flexible' | 'fair' | 'hard';

/**
 * Format 70: the president's personality, fictional game traits that only careers with the board-2 model use
 * (`src/world/presidents.ts`). Patience: how fast confidence moves and where dismissal starts. Ambition: how hard the
 * objectives are. Negotiation: capital requests. Interference: how often the president asks the manager for something.
 */
export interface PresidentTraits {
  patience: PresidentTraitLevel;
  ambition: PresidentTraitLevel;
  negotiation: PresidentNegotiationStyle;
  interference: PresidentTraitLevel;
}

export const NEGOTIATION_STYLES: readonly PresidentNegotiationStyle[] = ['flexible', 'fair', 'hard'];
/** A complete, valid set of traits (the world check for format-70 presidents). */
export function isPresidentTraits(value: unknown): value is PresidentTraits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const traits = value as Record<string, unknown>, keys = Object.keys(traits).sort();
  const levelOk = (item: unknown) => typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= 5;
  return keys.join() === 'ambition,interference,negotiation,patience' && levelOk(traits.patience) && levelOk(traits.ambition) && levelOk(traits.interference) && NEGOTIATION_STYLES.includes(traits.negotiation as PresidentNegotiationStyle);
}

export interface DevelopmentPresident {
  clubId: string;
  name: string;
  /** Willingness to invest, 1 (reluctant) to 5 (generous): lowers the confidence the board requires for capital. */
  generosity: PresidentTraitLevel;
  /** Owner capital available for facility projects each season, in euro cents. */
  seasonCapital: number;
  /** Format 70: personality traits; worlds built before them derive the same traits from the club (`presidentTraits`). */
  traits?: PresidentTraits;
}

/** Fictional club presidents for the development league; their traits are game rules, not claims about real people. */
export const DEVELOPMENT_PRESIDENTS: readonly DevelopmentPresident[] = Object.freeze([
  { clubId: 'rhine-falcons', name: 'Helena Varga', generosity: 3, seasonCapital: 20_000_000, traits: { patience: 3, ambition: 4, negotiation: 'fair', interference: 3 } },
  { clubId: 'aegean-waves', name: 'Nikos Thalassinos', generosity: 4, seasonCapital: 15_000_000, traits: { patience: 2, ambition: 5, negotiation: 'flexible', interference: 4 } },
  { clubId: 'alpine-stags', name: 'Matthias Kernegger', generosity: 2, seasonCapital: 12_000_000, traits: { patience: 4, ambition: 2, negotiation: 'hard', interference: 2 } },
  { clubId: 'adriatic-comets', name: 'Lucia Benedetti', generosity: 5, seasonCapital: 25_000_000, traits: { patience: 3, ambition: 3, negotiation: 'flexible', interference: 5 } },
  { clubId: 'danube-lynx', name: 'Andrei Popescu', generosity: 3, seasonCapital: 15_000_000, traits: { patience: 5, ambition: 3, negotiation: 'fair', interference: 1 } },
  { clubId: 'atlantic-pilots', name: 'Fiona Calloway', generosity: 4, seasonCapital: 18_000_000, traits: { patience: 2, ambition: 4, negotiation: 'hard', interference: 3 } },
].map(president => Object.freeze({ ...president, traits: Object.freeze(president.traits) } as DevelopmentPresident)));

export function getDevelopmentPresident(clubId: string): DevelopmentPresident {
  const president = DEVELOPMENT_PRESIDENTS.find(item => item.clubId === clubId);
  if (!president) throw new Error('This club has no development president.');
  return president;
}

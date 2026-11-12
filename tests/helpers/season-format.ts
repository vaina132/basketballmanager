import type { SeasonState } from '../../src/domain/season';
import type { Team } from '../../src/domain/types';
import { SEASON_SCHEMA_VERSION } from '../../src/domain/season';
import { createScouts } from '../../src/world/scouts';
import { createFitness } from '../../src/world/fitness';
import { createPhysio } from '../../src/world/physio';
import { createAssistant } from '../../src/world/assistant';
import { createAcademy } from '../../src/world/academy';
import { createYouth } from '../../src/world/youth';
import { createLifecycle } from '../../src/world/lifecycle';
import { createYouthCompetition } from '../../src/world/youth-competition';
import { createFacilities } from '../../src/world/facilities';
import { createRelationships } from '../../src/world/relationships';
import { createBoard } from '../../src/world/board';
import { createCommercial } from '../../src/world/commercial-policy';
import { createRivalries } from '../../src/world/rivalries';
import { createCareer } from '../../src/world/career';

export { SEASON_SCHEMA_VERSION };

interface LegacyIdentity { clubs: readonly Team[]; managedClubId: string }

/**
 * Top-level systems introduced by each season format, with the disabled defaults that parseSeason installs
 * for older saves. When a new format adds a system, add one row here instead of editing every storage test.
 */
const ADDED_BY_FORMAT: readonly (readonly [format: number, defaults: (state: LegacyIdentity & Partial<SeasonState>) => Partial<SeasonState>])[] = [
  [21, () => ({ scouts: createScouts() })],
  [22, () => ({ fitness: createFitness() })],
  [23, () => ({ physio: createPhysio() })],
  [24, () => ({ assistant: createAssistant() })],
  [25, () => ({ academy: createAcademy(), youth: createYouth() })],
  [26, () => ({ lifecycle: createLifecycle() })],
  [27, () => ({ youthCompetition: createYouthCompetition() })],
  [28, state => ({ facilities: createFacilities(state.clubs, state.managedClubId) })],
  [29, () => ({ relationships: createRelationships() })],
  [30, () => ({ board: createBoard() })],
  [31, state => ({ commercial: createCommercial(state.clubs, state.managedClubId) })],
  [32, state => ({ facilities: { ...state.facilities!, fundingSince: null } })],
  [33, state => ({ board: { ...state.board!, consequencesSince: null } })],
  [35, () => ({ rivalries: createRivalries() })],
  [36, state => ({ facilities: { ...state.facilities!, maintenanceSince: null } })],
  [37, () => ({ career: createCareer() })],
];

/**
 * The state parseSeason should return for the raw state of a genuine save written in `fromFormat`.
 * Formats 19 and later changed only top-level systems; earlier formats also rewrite nested records.
 */
export function expectedMigration<T extends LegacyIdentity>(raw: T, fromFormat: number) {
  if (!Number.isInteger(fromFormat) || fromFormat < 19 || fromFormat > SEASON_SCHEMA_VERSION) throw new Error('expectedMigration supports raw states from format 19 to the current format.');
  // Each row sees the systems added before it, so later formats can extend an earlier system's defaults.
  const added = ADDED_BY_FORMAT.filter(([format]) => format > fromFormat).reduce<Partial<SeasonState>>((systems, [, defaults]) => ({ ...systems, ...defaults({ ...raw, ...systems }) }), {});
  return { ...raw, ...added, schemaVersion: SEASON_SCHEMA_VERSION };
}

/** A current-format season file around any state, typically a deliberately damaged copy for rejection tests. */
export function currentSeasonFile(state: unknown): string {
  return JSON.stringify({ format: 'basketball-manager-season', formatVersion: SEASON_SCHEMA_VERSION, engineVersion: 'possession-3', state });
}

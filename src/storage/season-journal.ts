export const MAX_SEASON_CHECKPOINTS = 5;
export const MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024;
export const MAX_SEASON_REVISION = Number.MAX_SAFE_INTEGER;

export type CheckpointReason = 'manual' | 'new-game' | 'matchday' | 'rollover' | 'recovery' | 'legacy';

export interface SeasonCheckpoint {
  revision: number;
  savedAt: string | null;
  reason: CheckpointReason;
  /** Stored payloads stay raw so one damaged snapshot cannot hide healthy history. */
  serialized: unknown;
}

export interface SeasonJournal {
  revision: number;
  /** Kept raw so a damaged current slot cannot hide usable checkpoints. */
  current: unknown;
  checkpoints: SeasonCheckpoint[];
}

export class SeasonSaveConflictError extends Error {
  constructor() {
    super('The local career changed in another tab or window. Load the latest local career or export your current game before saving again.');
    this.name = 'SeasonSaveConflictError';
  }
}

const REASONS: readonly CheckpointReason[] = ['manual', 'new-game', 'matchday', 'rollover', 'recovery', 'legacy'];
const CHECKPOINT_FIELDS = ['revision', 'savedAt', 'reason', 'serialized'];

function metadataError(detail: string): never { throw new Error(`The local career checkpoint metadata is damaged: ${detail}.`); }

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SEASON_REVISION;
}

function validSavedAt(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function validateSerialized(value: unknown): asserts value is string {
  if (typeof value !== 'string') metadataError('a checkpoint must contain serialized text');
  if (value.length > MAX_CHECKPOINT_BYTES || new TextEncoder().encode(value).byteLength > MAX_CHECKPOINT_BYTES) metadataError('a checkpoint exceeds the 8 MB save limit');
}

function decodeCheckpoint(value: unknown): SeasonCheckpoint {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) metadataError('a checkpoint is not an object');
  const fields = value as Record<string, unknown>;
  if (CHECKPOINT_FIELDS.some(key => !Object.hasOwn(fields, key)) || Object.keys(fields).some(key => !CHECKPOINT_FIELDS.includes(key))) metadataError('a checkpoint has missing or unsupported fields');
  if (!validRevision(fields.revision)) metadataError('a checkpoint revision is invalid');
  if (!REASONS.includes(fields.reason as CheckpointReason)) metadataError('a checkpoint reason is invalid');
  if (fields.reason === 'legacy') {
    if (fields.revision !== 0 || fields.savedAt !== null) metadataError('a legacy checkpoint must use revision zero and an unknown save time');
  } else if (fields.revision === 0 || !validSavedAt(fields.savedAt)) metadataError('a checkpoint save time or revision is invalid');
  return { revision: fields.revision, savedAt: fields.savedAt as string | null, reason: fields.reason as CheckpointReason, serialized: fields.serialized };
}

/** Validate bookkeeping only; game payloads are independently validated by the save service. */
export function decodeSeasonJournal(current: unknown, storedRevision: unknown, rows: readonly unknown[]): SeasonJournal {
  if (rows.length > MAX_SEASON_CHECKPOINTS) metadataError('too many checkpoints are stored');
  const revision = storedRevision === undefined && rows.length === 0 ? 0 : storedRevision;
  if (!validRevision(revision)) metadataError('the current revision is invalid');
  const checkpoints = rows.map(decodeCheckpoint).sort((left, right) => right.revision - left.revision);
  if (new Set(checkpoints.map(checkpoint => checkpoint.revision)).size !== checkpoints.length) metadataError('checkpoint revisions are duplicated');
  if (checkpoints.length) {
    if (checkpoints[0]!.revision !== revision) metadataError('the latest checkpoint does not match the current revision');
    for (let index = 1; index < checkpoints.length; index += 1) {
      if (checkpoints[index]!.revision !== checkpoints[index - 1]!.revision - 1) metadataError('checkpoint history has a missing revision');
    }
    if (checkpoints.at(-1)!.revision > Math.max(1, revision - MAX_SEASON_CHECKPOINTS + 1)) metadataError('checkpoint history is incomplete');
  } else if (revision !== 0) metadataError('the current revision has no checkpoints');
  // Upgrading a v1 database does not rewrite its current season. Preserve it in
  // the first successful write; expose it read-only before that write as well.
  if (revision === 0 && checkpoints.length === 0 && typeof current === 'string') {
    checkpoints.push({ revision: 0, savedAt: null, reason: 'legacy', serialized: current });
  }
  return { revision, current: current === undefined ? null : current, checkpoints };
}

/** Plan a compare-and-swap without mutating the snapshot or dropping it on failure. */
export function prepareSeasonCheckpoint(journal: SeasonJournal, serialized: string, expectedRevision: number, reason: CheckpointReason, savedAt: string): { checkpoint: SeasonCheckpoint; checkpoints: SeasonCheckpoint[] } {
  if (!validRevision(expectedRevision)) throw new Error('Choose a valid expected local career revision.');
  if (journal.revision !== expectedRevision) throw new SeasonSaveConflictError();
  if (reason === 'legacy' || !REASONS.includes(reason)) throw new Error('Legacy checkpoints are read-only. Choose a supported save reason.');
  if (journal.revision >= MAX_SEASON_REVISION) throw new Error('The local career revision limit has been reached. Export your game before creating a new local save.');
  validateSerialized(serialized);
  const checkpoint = decodeCheckpoint({ revision: journal.revision + 1, savedAt, reason, serialized });
  return { checkpoint, checkpoints: [checkpoint, ...journal.checkpoints].slice(0, MAX_SEASON_CHECKPOINTS) };
}

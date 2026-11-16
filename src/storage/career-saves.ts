import type { SeasonState } from '../domain/season';
import type { MatchState } from '../domain/types';
import { sealMatches, saveSeal } from './save-seal';
import { directSeasonCodec, type SeasonCodec } from './season-codec';
import { readSeasonJournal, writeSeasonCheckpoint } from './season-indexed-db';
import type { CheckpointReason, SeasonCheckpoint, SeasonJournal } from './season-indexed-db';
import { managedClubLabel } from '../world/career';

export type { CheckpointReason, SeasonCheckpoint } from './season-indexed-db';

interface CheckpointMetadata {
  revision: number;
  savedAt: string | null;
  reason: CheckpointReason;
}

export type CareerSaveEntry = CheckpointMetadata & ({
  valid: true;
  clubName: string;
  managerName: string | null;
  seasonNumber: number;
  date: string;
  round: number;
  status: SeasonState['status'];
  matchStatus: MatchState['status'] | 'rest';
  error?: never;
} | {
  valid: false;
  clubName: 'Unknown club';
  managerName: null;
  seasonNumber: null;
  date: null;
  round: null;
  status: null;
  matchStatus: null;
  error: string;
});

export interface CareerSaveList {
  /** Latest stored revision, including when an older checkpoint is selected. */
  revision: number;
  current: SeasonState | null;
  currentError: string | null;
  entries: CareerSaveEntry[];
}

export type CurrentCareerSave = Omit<CareerSaveList, 'entries'>;

type StoredParser = (value: unknown, seal?: string) => Promise<SeasonState>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The stored season data is invalid.';
}

/**
 * Identical stored text (usually the current save and its newest checkpoint) is validated only once. A matching
 * fingerprint identifies unchanged text fully checked before its local write; other text takes the strict path.
 */
function storedParser(codec: SeasonCodec, seals: ReadonlyMap<unknown, string> = new Map()): StoredParser {
  const parsed = new Map<string, Promise<SeasonState>>();
  return (value, seal = seals.get(value)) => {
    if (typeof value !== 'string') return Promise.reject(new Error('The stored season must be a save-file string.'));
    let result = parsed.get(value);
    if (!result) {
      result = (async () => codec.parseSealed && await sealMatches(value, seal) ? codec.parseSealed(value) : codec.parse(value))();
      parsed.set(value, result);
    }
    return result;
  };
}

/** Each stored text's seal, from the checkpoints that hold it; the current slot shares its newest checkpoint's text. */
function sealsOf(journal: SeasonJournal): Map<unknown, string> {
  return new Map(journal.checkpoints.filter(checkpoint => checkpoint.seal).map(checkpoint => [checkpoint.serialized, checkpoint.seal!]));
}

/** A legacy current slot remains visible until the first journal write preserves it. */
function checkpointsFor(journal: SeasonJournal): SeasonCheckpoint[] {
  if (journal.revision === 0 && journal.checkpoints.length === 0 && typeof journal.current === 'string') {
    return [{ revision: 0, savedAt: null, reason: 'legacy', serialized: journal.current }];
  }
  return journal.checkpoints;
}

async function describeCheckpoint(checkpoint: SeasonCheckpoint, parse: StoredParser): Promise<CareerSaveEntry> {
  const metadata = { revision: checkpoint.revision, savedAt: checkpoint.savedAt, reason: checkpoint.reason };
  try {
    const state = await parse(checkpoint.serialized);
    return {
      ...metadata, valid: true,
      clubName: managedClubLabel(state),
      managerName: state.manager?.name ?? null,
      seasonNumber: state.seasonNumber, date: state.date, round: state.round,
      status: state.status, matchStatus: state.activeMatch?.status ?? 'rest',
    };
  } catch (error) {
    return {
      ...metadata, valid: false, clubName: 'Unknown club', managerName: null, seasonNumber: null,
      date: null, round: null, status: null, matchStatus: null,
      error: `This checkpoint cannot be loaded. ${errorMessage(error)}`,
    };
  }
}

async function readCurrent(journal: SeasonJournal, parse: StoredParser): Promise<CurrentCareerSave> {
  let current: SeasonState | null = null, currentError: string | null = null;
  if (journal.current !== null && journal.current !== undefined || journal.revision > 0 || checkpointsFor(journal).length > 0) {
    try { current = await parse(journal.current); }
    catch (error) { currentError = `The current save cannot be loaded. Choose a valid checkpoint from save history or import a valid save file. ${errorMessage(error)}`; }
  }
  return { revision: journal.revision, current, currentError };
}

/**
 * The main menu needs only the current career, not every checkpoint in save history. Every checkpoint write
 * advances the revision, so a career already validated at the same nonzero revision is reused, not re-checked.
 */
export async function readCurrentCareer(codec: SeasonCodec = directSeasonCodec, known?: { revision: number; state: SeasonState }): Promise<CurrentCareerSave> {
  const journal = await readSeasonJournal();
  if (known && journal.revision > 0 && journal.revision === known.revision && typeof journal.current === 'string') return { revision: journal.revision, current: known.state, currentError: null };
  return readCurrent(journal, storedParser(codec, sealsOf(journal)));
}

/** Inspect every saved snapshot without silently replacing a damaged current save. */
export async function readCareerSaves(codec: SeasonCodec = directSeasonCodec): Promise<CareerSaveList> {
  const journal = await readSeasonJournal();
  const parse = storedParser(codec, sealsOf(journal));
  const current = await readCurrent(journal, parse);
  const entries: CareerSaveEntry[] = [];
  for (const checkpoint of checkpointsFor(journal)) entries.push(await describeCheckpoint(checkpoint, parse));
  return { ...current, entries };
}

/** Restoring is read-only. A later save appends a new revision instead of rewinding history. */
export async function loadCareerCheckpoint(revision: number, codec: SeasonCodec = directSeasonCodec): Promise<{ state: SeasonState; revision: number }> {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Choose a valid checkpoint revision.');
  const journal = await readSeasonJournal();
  const checkpoint = checkpointsFor(journal).find(entry => entry.revision === revision);
  if (!checkpoint) throw new Error('That checkpoint is no longer available. Refresh save history and choose another checkpoint.');
  try { return { state: await storedParser(codec, sealsOf(journal))(checkpoint.serialized), revision: journal.revision }; }
  catch (error) { throw new Error(`This checkpoint cannot be loaded. ${errorMessage(error)}`); }
}

/**
 * Write a checkpoint of the game's own state, then optionally fingerprint that exact serialized text. Development mode
 * (owner, 15 November 2026): checkpoints skip the full career check, which took 17 seconds a matchday in large
 * worlds; exports and imports keep it. An unavailable fingerprint only costs a full check on the next load.
 */
export async function saveCareerCheckpoint(state: SeasonState, expectedRevision: number, reason: CheckpointReason, codec: SeasonCodec = directSeasonCodec): Promise<SeasonCheckpoint> {
  const serialized = await codec.serialize(state, { check: false });
  return writeSeasonCheckpoint(serialized, expectedRevision, reason, await saveSeal(serialized));
}

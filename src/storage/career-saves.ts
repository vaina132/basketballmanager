import type { SeasonState } from '../domain/season';
import type { MatchState } from '../domain/types';
import { directSeasonCodec, type SeasonCodec } from './season-codec';
import { readSeasonJournal, writeSeasonCheckpoint } from './season-indexed-db';
import type { CheckpointReason, SeasonCheckpoint, SeasonJournal } from './season-indexed-db';

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
  matchStatus: MatchState['status'];
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

type StoredParser = (value: unknown) => Promise<SeasonState>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The stored season data is invalid.';
}

/** Identical stored text (usually the current save and its newest checkpoint) is validated only once. */
function storedParser(codec: SeasonCodec): StoredParser {
  const parsed = new Map<string, Promise<SeasonState>>();
  return value => {
    if (typeof value !== 'string') return Promise.reject(new Error('The stored season must be a save-file string.'));
    let result = parsed.get(value);
    if (!result) { result = codec.parse(value); parsed.set(value, result); }
    return result;
  };
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
      clubName: state.clubs.find(club => club.id === state.managedClubId)!.name,
      managerName: state.manager?.name ?? null,
      seasonNumber: state.seasonNumber, date: state.date, round: state.round,
      status: state.status, matchStatus: state.activeMatch.status,
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
  return readCurrent(journal, storedParser(codec));
}

/** Inspect every saved snapshot without silently replacing a damaged current save. */
export async function readCareerSaves(codec: SeasonCodec = directSeasonCodec): Promise<CareerSaveList> {
  const journal = await readSeasonJournal();
  const parse = storedParser(codec);
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
  try { return { state: await storedParser(codec)(checkpoint.serialized), revision: journal.revision }; }
  catch (error) { throw new Error(`This checkpoint cannot be loaded. ${errorMessage(error)}`); }
}

/** Serialization validates the unchanged season format before any local write begins. */
export async function saveCareerCheckpoint(state: SeasonState, expectedRevision: number, reason: CheckpointReason, codec: SeasonCodec = directSeasonCodec): Promise<SeasonCheckpoint> {
  return writeSeasonCheckpoint(await codec.serialize(state), expectedRevision, reason);
}

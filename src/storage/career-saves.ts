import type { SeasonState } from '../domain/season';
import type { MatchState } from '../domain/types';
import { parseSeason, serializeSeason } from './season-storage';
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
  seasonNumber: number;
  date: string;
  round: number;
  status: SeasonState['status'];
  matchStatus: MatchState['status'];
  error?: never;
} | {
  valid: false;
  clubName: 'Unknown club';
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The stored season data is invalid.';
}

function parseStoredSeason(value: unknown): SeasonState {
  if (typeof value !== 'string') throw new Error('The stored season must be a save-file string.');
  return parseSeason(value);
}

/** A legacy current slot remains visible until the first journal write preserves it. */
function checkpointsFor(journal: SeasonJournal): SeasonCheckpoint[] {
  if (journal.revision === 0 && journal.checkpoints.length === 0 && typeof journal.current === 'string') {
    return [{ revision: 0, savedAt: null, reason: 'legacy', serialized: journal.current }];
  }
  return journal.checkpoints;
}

function describeCheckpoint(checkpoint: SeasonCheckpoint): CareerSaveEntry {
  const metadata = { revision: checkpoint.revision, savedAt: checkpoint.savedAt, reason: checkpoint.reason };
  try {
    const state = parseStoredSeason(checkpoint.serialized);
    return {
      ...metadata, valid: true,
      clubName: state.clubs.find(club => club.id === state.managedClubId)!.name,
      seasonNumber: state.seasonNumber, date: state.date, round: state.round,
      status: state.status, matchStatus: state.activeMatch.status,
    };
  } catch (error) {
    return {
      ...metadata, valid: false, clubName: 'Unknown club', seasonNumber: null,
      date: null, round: null, status: null, matchStatus: null,
      error: `This checkpoint cannot be loaded. ${errorMessage(error)}`,
    };
  }
}

/** Inspect every saved snapshot without silently replacing a damaged current save. */
export async function readCareerSaves(): Promise<CareerSaveList> {
  const journal = await readSeasonJournal();
  const checkpoints = checkpointsFor(journal);
  let current: SeasonState | null = null, currentError: string | null = null;
  if (journal.current !== null && journal.current !== undefined || journal.revision > 0 || checkpoints.length > 0) {
    try { current = parseStoredSeason(journal.current); }
    catch (error) { currentError = `The current save cannot be loaded. Choose a valid checkpoint from save history or import a valid save file. ${errorMessage(error)}`; }
  }
  return { revision: journal.revision, current, currentError, entries: checkpoints.map(describeCheckpoint) };
}

/** Restoring is read-only. A later save appends a new revision instead of rewinding history. */
export async function loadCareerCheckpoint(revision: number): Promise<{ state: SeasonState; revision: number }> {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Choose a valid checkpoint revision.');
  const journal = await readSeasonJournal();
  const checkpoint = checkpointsFor(journal).find(entry => entry.revision === revision);
  if (!checkpoint) throw new Error('That checkpoint is no longer available. Refresh save history and choose another checkpoint.');
  try { return { state: parseStoredSeason(checkpoint.serialized), revision: journal.revision }; }
  catch (error) { throw new Error(`This checkpoint cannot be loaded. ${errorMessage(error)}`); }
}

/** Serialization validates the unchanged season format before any local write begins. */
export async function saveCareerCheckpoint(state: SeasonState, expectedRevision: number, reason: CheckpointReason): Promise<SeasonCheckpoint> {
  return writeSeasonCheckpoint(serializeSeason(state), expectedRevision, reason);
}

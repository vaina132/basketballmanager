import { decodeSeasonJournal, MAX_SEASON_CHECKPOINTS, prepareSeasonCheckpoint } from './season-journal';
import type { CheckpointReason, SeasonCheckpoint, SeasonJournal } from './season-journal';

export { MAX_SEASON_CHECKPOINTS, SeasonSaveConflictError } from './season-journal';
export type { CheckpointReason, SeasonCheckpoint, SeasonJournal } from './season-journal';

const DATABASE_NAME = 'basketball-manager-seasons';
const STORE_NAME = 'seasons';
const CHECKPOINT_STORE_NAME = 'checkpoints';
const SAVE_KEY = 'current';
const REVISION_KEY = 'revision';

function storageError(action: string, error?: DOMException | null): Error {
  const detail = error?.name === 'QuotaExceededError'
    ? ' Browser storage is full. Export your season to keep a backup.'
    : error?.message ? ` ${error.message}` : '';
  return new Error(`Could not ${action} the local season.${detail}`);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Local saves are unavailable in this browser. Use file export instead.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    let rejected = false;
    request.onupgradeneeded = event => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      if (!database.objectStoreNames.contains(CHECKPOINT_STORE_NAME)) database.createObjectStore(CHECKPOINT_STORE_NAME, { keyPath: 'revision' });
      if (event.oldVersion < 2) request.transaction!.objectStore(STORE_NAME).put(0, REVISION_KEY);
    };
    request.onblocked = () => {
      rejected = true;
      reject(new Error('Local season storage is blocked by another tab. Close that tab and try again.'));
    };
    request.onerror = () => { rejected = true; reject(storageError('open', request.error)); };
    request.onsuccess = () => {
      const database = request.result;
      if (rejected) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

/** Queue reads inside the transaction without an asynchronous gap that could release its lock. */
function readJournalSnapshot(transaction: IDBTransaction, accept: (journal: SeasonJournal) => void, fail: (error: Error) => void): void {
  const seasons = transaction.objectStore(STORE_NAME), checkpoints = transaction.objectStore(CHECKPOINT_STORE_NAME);
  const currentRequest = seasons.get(SAVE_KEY), revisionRequest = seasons.get(REVISION_KEY);
  // One extra row detects corruption without materializing an unbounded store.
  const rowsRequest = checkpoints.getAll(undefined, MAX_SEASON_CHECKPOINTS + 1);
  const keysRequest = checkpoints.getAllKeys(undefined, MAX_SEASON_CHECKPOINTS + 1);
  let pending = 4;
  const ready = () => {
    if (--pending !== 0) return;
    try {
      const rows = rowsRequest.result as unknown[], keys = keysRequest.result;
      if (keys.length !== rows.length || rows.some((row, index) => row === null || typeof row !== 'object' || (row as { revision?: unknown }).revision !== keys[index])) throw new Error('The local career checkpoint metadata is damaged: checkpoint keys do not match their revisions.');
      accept(decodeSeasonJournal(currentRequest.result, revisionRequest.result, rows));
    } catch (error) { fail(error instanceof Error ? error : new Error('Could not read local career checkpoints.')); }
  };
  for (const request of [currentRequest, revisionRequest, rowsRequest, keysRequest]) request.onsuccess = ready;
}

/** One readonly transaction returns current and history from the same committed revision. */
export async function readSeasonJournal(): Promise<SeasonJournal> {
  const database = await openDatabase();
  try {
    return await new Promise<SeasonJournal>((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME, CHECKPOINT_STORE_NAME], 'readonly');
      let journal: SeasonJournal | undefined, failure: Error | undefined;
      transaction.oncomplete = () => journal ? resolve(journal) : reject(new Error('Could not read the local career journal.'));
      transaction.onabort = () => reject(failure ?? storageError('load', transaction.error));
      readJournalSnapshot(transaction, snapshot => { journal = snapshot; }, error => { failure = error; transaction.abort(); });
    });
  } finally { database.close(); }
}

/** Current, revision, retained legacy snapshot and pruning commit or abort together. */
export async function writeSeasonCheckpoint(serialized: string, expectedRevision: number, reason: CheckpointReason): Promise<SeasonCheckpoint> {
  const database = await openDatabase();
  try {
    return await new Promise<SeasonCheckpoint>((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME, CHECKPOINT_STORE_NAME], 'readwrite', { durability: 'strict' });
      let checkpoint: SeasonCheckpoint | undefined, failure: Error | undefined;
      transaction.oncomplete = () => checkpoint ? resolve(checkpoint) : reject(new Error('Could not save the local career checkpoint.'));
      transaction.onabort = () => reject(failure ?? storageError('save', transaction.error));
      const abort = (error: Error) => {
        failure = error.name === 'QuotaExceededError' ? storageError('save', error as DOMException) : error;
        transaction.abort();
      };
      readJournalSnapshot(transaction, journal => {
        const planned = prepareSeasonCheckpoint(journal, serialized, expectedRevision, reason, new Date().toISOString());
        const seasons = transaction.objectStore(STORE_NAME), checkpoints = transaction.objectStore(CHECKPOINT_STORE_NAME);
        checkpoint = planned.checkpoint;
        if (journal.revision === 0 && journal.checkpoints[0]?.reason === 'legacy') checkpoints.put(journal.checkpoints[0]);
        checkpoints.put(checkpoint);
        const retained = new Set(planned.checkpoints.map(entry => entry.revision));
        for (const previous of journal.checkpoints) if (!retained.has(previous.revision)) checkpoints.delete(previous.revision);
        seasons.put(serialized, SAVE_KEY);
        seasons.put(checkpoint.revision, REVISION_KEY);
      }, abort);
    });
  } finally { database.close(); }
}

/** Compatibility entry point; every write still requires an explicit expected revision. */
export async function writeLocalSeason(serialized: string, expectedRevision: number): Promise<void> {
  await writeSeasonCheckpoint(serialized, expectedRevision, 'manual');
}

export async function readLocalSeason(): Promise<string | null> {
  const { current } = await readSeasonJournal();
  if (current === null) return null;
  if (typeof current === 'string') return current;
  throw new Error('The local season is damaged. Load an earlier checkpoint or import a valid exported season instead.');
}

const DATABASE_NAME = 'basketball-manager-seasons';
const STORE_NAME = 'seasons';
const SAVE_KEY = 'current';

function storageError(action: string, error?: DOMException | null): Error {
  const detail = error?.name === 'QuotaExceededError'
    ? ' Browser storage is full. Export your season to keep a backup.'
    : error?.message ? ` ${error.message}` : '';
  return new Error(`Could not ${action} the local season.${detail}`);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Local saves are unavailable in this browser. Use file export instead.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let rejected = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
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

/** A distinct database and transaction leave the exhibition slot untouched. */
export async function writeLocalSeason(serialized: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(storageError('save', transaction.error));
      transaction.objectStore(STORE_NAME).put(serialized, SAVE_KEY);
    });
  } finally { database.close(); }
}

export async function readLocalSeason(): Promise<string | null> {
  const database = await openDatabase();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(SAVE_KEY);
      let stored: unknown;
      request.onsuccess = () => { stored = request.result; };
      transaction.onabort = () => reject(storageError('load', transaction.error));
      transaction.oncomplete = () => {
        if (stored === undefined) resolve(null);
        else if (typeof stored === 'string') resolve(stored);
        else reject(new Error('The local season is damaged. Import a valid exported season instead.'));
      };
    });
  } finally { database.close(); }
}

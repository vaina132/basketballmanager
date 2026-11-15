import { MAX_DATA_PACK_BYTES, parseDataPack, type DataPack } from './data-pack';

/**
 * The real club data shipped with the game (owner decision, 15 November 2026: real clubs are the default way to play
 * and the data rights are granted). The deployed site serves the same checksummed pack file the owner loads locally;
 * the game reads it when a career or friendly starts, so no file has to be chosen on any device. Without the file the
 * game falls back to choosing a pack file.
 */
export const BUILT_IN_PACK_URL = '/data/real-pack.json';

export type BuiltInPackResult = { status: 'loaded'; pack: DataPack } | { status: 'missing' } | { status: 'failed'; message: string };

/** Fetches and fully checks the shipped pack; a missing file is not an error. */
export async function fetchBuiltInPack(fetcher: (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'headers'>> = url => fetch(url, { cache: 'no-cache' })): Promise<BuiltInPackResult> {
  let response: Pick<Response, 'ok' | 'status' | 'text' | 'headers'>;
  try { response = await fetcher(BUILT_IN_PACK_URL); } catch { return { status: 'failed', message: 'The real club data could not be downloaded. Check the connection and try again.' }; }
  // A single-page host may answer a missing file with the game's own page.
  if (response.status === 404 || !response.ok && response.status >= 400 && response.status < 500 || (response.headers.get('content-type') ?? '').includes('text/html')) return { status: 'missing' };
  if (!response.ok) return { status: 'failed', message: 'The real club data could not be downloaded. Try again later.' };
  const text = await response.text();
  if (text.length > MAX_DATA_PACK_BYTES) return { status: 'failed', message: 'The real club data file is too large.' };
  try { return { status: 'loaded', pack: await parseDataPack(text) }; }
  catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : 'The real club data could not be read.' }; }
}

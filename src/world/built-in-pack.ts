import { MAX_DATA_PACK_BYTES, parseDataPack, type DataPack } from './data-pack';

/**
 * The real club data published with the game (owner decision, 15 November 2026: real clubs are the default way to play
 * and the data rights are granted). The owner's Supabase project serves the checksummed pack publicly; a copy may also
 * ship with the site. The game reads it when a career or friendly starts, so no file has to be chosen on any device.
 * Without either, the game falls back to choosing a pack file.
 */
export const BUILT_IN_PACK_URL = '/data/real-pack.json';
/** The owner's Supabase project serves the published pack from its public `game-data` bucket (owner request, 15 November 2026). */
export const ONLINE_PACK_URL = 'https://kesxznybhotzduvcwiwm.supabase.co/storage/v1/object/public/game-data/real-pack.json';
/** Where the game looks for real club data, in order: Supabase, then a copy shipped with the site. */
export const PACK_SOURCES: readonly string[] = [ONLINE_PACK_URL, BUILT_IN_PACK_URL];

export type BuiltInPackResult = { status: 'loaded'; pack: DataPack } | { status: 'missing' } | { status: 'failed'; message: string };

type Fetcher = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'text' | 'headers'>>;
const defaultFetcher: Fetcher = url => fetch(url, { cache: 'no-cache' });

/** The first real club data found among `sources`, fully checked; a source without a file is skipped, and a failure is reported only when no source has the data. */
export async function fetchBuiltInPack(fetcher: Fetcher = defaultFetcher, sources: readonly string[] = PACK_SOURCES): Promise<BuiltInPackResult> {
  let failure: BuiltInPackResult | null = null;
  for (const url of sources) {
    const result = await fetchPackFrom(url, fetcher);
    if (result.status === 'loaded') return result;
    if (result.status === 'failed') failure ??= result;
  }
  return failure ?? { status: 'missing' };
}

/** Fetches and fully checks one source; a missing file is not an error. */
async function fetchPackFrom(url: string, fetcher: Fetcher): Promise<BuiltInPackResult> {
  let response: Pick<Response, 'ok' | 'status' | 'text' | 'headers'>;
  try { response = await fetcher(url); } catch { return { status: 'failed', message: 'The real club data could not be downloaded. Check the connection and try again.' }; }
  // A single-page host may answer a missing file with the game's own page.
  if (response.status === 404 || !response.ok && response.status >= 400 && response.status < 500 || (response.headers.get('content-type') ?? '').includes('text/html')) return { status: 'missing' };
  if (!response.ok) return { status: 'failed', message: 'The real club data could not be downloaded. Try again later.' };
  const text = await response.text();
  if (text.length > MAX_DATA_PACK_BYTES) return { status: 'failed', message: 'The real club data file is too large.' };
  try { return { status: 'loaded', pack: await parseDataPack(text) }; }
  catch (error) { return { status: 'failed', message: error instanceof Error ? error.message : 'The real club data could not be read.' }; }
}

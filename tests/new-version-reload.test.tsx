import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GUARD_MS, listenForMissingPageFiles, RELOAD_GUARD_KEY, reloadForNewVersion, resetNewVersionReload } from '../src/ui/newVersionReload';
import { PageError, PageErrorBoundary } from '../src/ui/PageErrorBoundary';

// Owner (23 November 2026): no paid skew protection. When a page file is missing after a new version went live, the
// career is saved and the game reloads by itself, once; a repeat failure shows the Save and reload message instead.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

function setup(start = 1_000_000) {
  const storage = memoryStorage();
  let time = start;
  const reload = vi.fn();
  const save = vi.fn(async () => true);
  const deps = { storage: () => storage, reload, now: () => time };
  return { storage, reload, save, deps, advance: (ms: number) => { time += ms; } };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => resetNewVersionReload());

describe('automatic reload when a page file is missing after a new version', () => {
  it('saves once and reloads once when Vite reports a page file that could not be loaded', async () => {
    const { reload, save, deps } = setup();
    const target = new EventTarget();
    const stop = listenForMissingPageFiles(target, save, deps);
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    // The failed import also reaches the page's error boundary: the same reload is shared, nothing is saved twice.
    target.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not reload in a loop: a second failure soon after the reload shows the message instead', async () => {
    const { reload, save, deps, advance } = setup();
    expect(await reloadForNewVersion(save, deps)).toBe(true);
    resetNewVersionReload(); // the page has reloaded; the guard time in sessionStorage survives
    advance(10_000);
    expect(await reloadForNewVersion(save, deps)).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    // A later deploy, long after, may reload by itself again.
    resetNewVersionReload();
    advance(GUARD_MS);
    expect(await reloadForNewVersion(save, deps)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads when the career could not be saved', async () => {
    const { reload, storage, deps } = setup();
    const failed = vi.fn(async () => false);
    expect(await reloadForNewVersion(failed, deps)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem(RELOAD_GUARD_KEY)).toBeNull();
    const throws = vi.fn(async () => { throw new Error('disk full'); });
    expect(await reloadForNewVersion(throws, deps)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload by itself when the loop guard cannot be stored', async () => {
    const { reload, save } = setup();
    const blocked = { storage: () => { throw new Error('blocked'); }, reload, now: () => 1 };
    expect(await reloadForNewVersion(save, blocked)).toBe(false);
    const missing = { storage: () => null, reload, now: () => 1 };
    expect(await reloadForNewVersion(save, missing)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('the page boundary starts the automatic reload for a download failure only, and keeps the button', async () => {
    const autoReload = vi.fn(async () => false);
    const boundary = new PageErrorBoundary({ title: 'Inbox', savesFirst: true, onReload: () => {}, autoReload, children: null });
    const states: unknown[] = [];
    boundary.setState = (state => { states.push(state); }) as typeof boundary.setState;
    boundary.componentDidCatch(new TypeError("Cannot read properties of undefined (reading 'name')"));
    expect(autoReload).not.toHaveBeenCalled();
    boundary.componentDidCatch(new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/Inbox-a1.js'));
    expect(autoReload).toHaveBeenCalledTimes(1);
    await flush();
    // No reload started (the loop guard): the usual message comes back.
    expect(states).toEqual([{ reloading: true }, { reloading: false }]);
    const html = renderToStaticMarkup(<PageError title="Inbox" error={new TypeError('Failed to fetch dynamically imported module')} savesFirst onReload={() => {}} reloading />);
    expect(html).toContain('Saving your career and loading the new version');
    expect(html).toContain('Save and reload');
  });
});

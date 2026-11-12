/**
 * Remembers results of a pure calculation. Only successful results are stored, so invalid input still throws
 * exactly as before. The cache is bounded; clearing it never changes results.
 */
export function memoizePure<K extends string | number, T>(compute: (key: K) => T, limit = 50_000): (key: K) => T {
  const cache = new Map<K, T>();
  return key => {
    if (cache.has(key)) return cache.get(key) as T;
    const value = compute(key);
    if (cache.size >= limit) cache.clear();
    cache.set(key, value);
    return value;
  };
}

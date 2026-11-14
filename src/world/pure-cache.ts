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

/**
 * Derived indexes used only during one synchronous calculation batch (validation or quotes on unchanged state).
 * Inputs may be mutated between calls, so identity alone must never carry derived data into the next batch.
 * End a quote batch before applying a command. Nested calls get their own scope and restore the outer one;
 * exceptions release the scope too. No validation verdicts are cached here.
 */
type CalculationScope = WeakMap<object, Map<symbol, Map<string, unknown>>>;
let calculationScope: CalculationScope | undefined;
const MAX_SCOPED_CALCULATIONS = 128;

export function withCalculationCache<T>(run: () => T): T {
  const previous = calculationScope;
  calculationScope = new WeakMap();
  try { return run(); }
  finally { calculationScope = previous; }
}

/** The owner and key must identify every input to a pure calculation. Callers treat its result as immutable. */
export function cachedCalculation<T>(owner: object, namespace: symbol, key: string, compute: () => T): T {
  if (!calculationScope) return compute();
  let namespaces = calculationScope.get(owner);
  if (!namespaces) { namespaces = new Map(); calculationScope.set(owner, namespaces); }
  let values = namespaces.get(namespace);
  if (!values) { values = new Map(); namespaces.set(namespace, values); }
  if (values.has(key)) return values.get(key) as T;
  const value = compute();
  if (values.size >= MAX_SCOPED_CALCULATIONS) values.delete(values.keys().next().value!);
  values.set(key, value);
  return value;
}

/** Optional indexes can keep their cheap scanning path when no synchronous calculation scope is active. */
export function scopedCalculation<T>(owner: object, namespace: symbol, key: string, compute: () => T): T | undefined {
  return calculationScope ? cachedCalculation(owner, namespace, key, compute) : undefined;
}

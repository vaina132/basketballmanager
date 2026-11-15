import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import base from './vite.config';

/**
 * Quick checks while working (owner request, 15 November 2026: faster development). Skips the long multi-season
 * simulations and the old-save continuation tests, which run in the full suite before every push.
 */
export const SLOW_TESTS = [
  'tests/lower-division-world.test.js', 'tests/europe-*.test.js', 'tests/storage.test.ts', 'tests/domestic-postseason-career.test.js',
  'tests/domestic-calendar-career.test.js', 'tests/division-changes.test.js', 'tests/domestic-standings.test.js', 'tests/career-moves.test.ts',
  'tests/transfers-storage.test.ts', 'tests/season*-continuation.test.js', 'tests/league-size.test.ts',
];

export default mergeConfig(base, defineConfig({ test: { exclude: [...configDefaults.exclude, '**/.claude/**', ...SLOW_TESTS] } }));

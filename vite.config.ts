/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: { ignored: ['**/.artifacts/**', '**/.local-data/**'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.artifacts/**', '**/.local-data/**'] },
  },
  build: { target: 'es2022' },
  // Helper agents' temporary worktrees hold copies of the tests; never run them from the main checkout.
  test: { exclude: [...configDefaults.exclude, '**/.claude/**'] },
});

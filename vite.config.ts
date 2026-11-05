import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    watch: { ignored: ['**/.artifacts/**', '**/.local-data/**'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.artifacts/**', '**/.local-data/**'] },
  },
  build: { target: 'es2022' },
});

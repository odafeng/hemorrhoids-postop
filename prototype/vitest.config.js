import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    css: true,
    // supabase/** holds Deno Edge Function code + its Deno tests (run via `deno test`).
    // Keep them out of vitest, which runs in Node and has no `Deno` global.
    exclude: ['e2e/**', 'node_modules/**', 'supabase/**'],
  },
});

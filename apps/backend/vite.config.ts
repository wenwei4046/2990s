/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { assertViteApiUrl } from '../../scripts/check-vite-api-url.mjs';

// Backend = desktop-first per PORT_DESIGN.md §2.4. No PWA, no orientation lock.
// Tablet ad-hoc only (sidebar already collapses at <1100 in prototype).
export default defineConfig(({ command, mode }) => {
  // Build-time safety net (incident 2026-06-13): never bake a localhost API URL
  // into a deployed bundle. Reads the SAME value Vite will inline (process.env
  // wins over the root .env). No-op for `vite dev` (command === 'serve').
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)));
  assertViteApiUrl({ value: env.VITE_API_URL, command, app: 'backend' });

  return {
    plugins: [react()],
    // Read .env from monorepo root so all apps share one source of truth.
    envDir: '../../',
    server: { port: 6274, host: true, strictPort: false },
    preview: { port: 4274 },
    // Component tests run under jsdom with Testing Library matchers. Pure-logic
    // .test.ts files run fine here too (jsdom is a superset of the node globals).
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
    },
    build: {
      rollupOptions: {
        output: {
          // Split the shared vendor graph out of the single ~646 kB entry chunk
          // into stable, separately-cacheable pieces. React core, Supabase (only
          // needed post-login), the query layer, and form/validation each bust
          // independently on upgrade instead of invalidating one giant bundle.
          // The heavy print/export libs (jspdf, xlsx, html2canvas) are already
          // dynamic-imported, so they stay off the critical path on their own.
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router'],
            'supabase': ['@supabase/supabase-js'],
            'query': ['@tanstack/react-query'],
            'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          },
        },
      },
    },
  };
});

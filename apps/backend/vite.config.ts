import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend = desktop-first per PORT_DESIGN.md §2.4. No PWA, no orientation lock.
// Tablet ad-hoc only (sidebar already collapses at <1100 in prototype).
export default defineConfig({
  plugins: [react()],
  // Read .env from monorepo root so all apps share one source of truth.
  envDir: '../../',
  server: { port: 6274, host: true, strictPort: false },
  preview: { port: 4274 },
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
});

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
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend = desktop-first per PORT_DESIGN.md §2.4. No PWA, no orientation lock.
// Tablet ad-hoc only (sidebar already collapses at <1100 in prototype).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, host: true },
  preview: { port: 4174 },
});

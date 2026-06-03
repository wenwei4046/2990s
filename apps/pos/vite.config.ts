import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// POS = tablet-first PWA per PORT_DESIGN.md §2.4. Manifest locks orientation
// to landscape (best-effort on iOS Safari — needs CSS fallback per Codex P2.8,
// deferred). 22 sofa-module PNGs pre-cached on install per §11.4 Issue 10.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' (not 'autoUpdate'): a new deploy waits behind a "A new version
      // is ready · Refresh" toast (src/components/UpdatePrompt.tsx) instead of
      // silently reloading. Sales staff stay in control mid-order, and they no
      // longer have to swipe-kill + relaunch the iPad PWA to pick up a fix.
      registerType: 'prompt',
      manifest: {
        name: "2990's POS",
        short_name: '2990 POS',
        description: "Sales tablet for 2990's Home — POS portal",
        theme_color: '#221F20',
        background_color: '#FFF9EB',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // clientsClaim so the NEW worker takes control of the already-open page
        // the instant it skip-waits (when the user taps "Refresh"). Without it
        // the generated SW never calls clients.claim(), so after SKIP_WAITING the
        // `controlling`/controllerchange event never fires and vite-plugin-pwa's
        // prompt-mode auto-reload (UpdatePrompt.tsx) silently does nothing — the
        // Refresh button looks dead. skipWaiting stays false: we skip on demand
        // via the message the toast sends, not automatically.
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // PR #131 fix — raise precache size limit. PR #118 added 2.11 MB
        // bedframe hero photos which blew past the workbox default of 2 MB
        // and broke EVERY GH Actions deploy since 2026-05-26 10:39 UTC.
        // 5 MB gives headroom for future model photos without dropping any
        // into runtime-only caching.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/api\/products.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api-products' },
          },
        ],
      },
    }),
  ],
  envDir: '../../',
  server: { port: 6273, host: true, strictPort: false },
  preview: { port: 4273 },
});

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
      registerType: 'autoUpdate',
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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
  server: { port: 5173, host: true },
  preview: { port: 4173 },
});

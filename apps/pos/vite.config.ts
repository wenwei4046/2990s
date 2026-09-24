import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { assertViteApiUrl } from '../../scripts/check-vite-api-url.mjs';

// Phone portrait + tablet/desktop POS. Existing sofa art remains precached.
export default defineConfig(({ command, mode }) => {
  // Build-time safety net (incident 2026-06-13): never bake a localhost API URL
  // into a deployed bundle. Reads the SAME value Vite will inline (process.env
  // wins over the root .env). No-op for `vite dev` (command === 'serve').
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)));
  const simulation = mode === 'simulation';
  if (!simulation) assertViteApiUrl({ value: env.VITE_API_URL, command, app: 'pos' });

  return {
    // Never inherit a real URL or key from root .env in the simulation build.
    define: simulation ? Object.fromEntries(Object.entries({
      VITE_BACKEND_TARGET: 'houzs',
      VITE_API_URL: '/api',
      VITE_HOUZS_API_URL: '/api/scm',
      VITE_HOUZS_POS_URL: '/api',
      VITE_HOUZS_COMPANY_ID: '2',
      VITE_BACKEND_PORTAL_URL: '/catalog',
      VITE_SUPABASE_URL: 'http://127.0.0.1:6288',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'simulation-placeholder-not-a-key',
    }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])) : undefined,
    plugins: [
      react(),
      ...(simulation ? [{
        name: 'simulation-network-isolation',
        enforce: 'pre' as const,
        transform(code: string, id: string) {
          if (!/\.css(?:\?|$)/i.test(id)) return null;
          // Remote font @imports fail under this demo's self-only CSP. A
          // compiled, lazy-loaded stylesheet then emits an error and Vite's
          // CSS preloader refuses to mount the app. Keep simulation entirely
          // local, using the design tokens' existing system-font fallbacks.
          // Production does not register this plugin and retains its fonts.
          const localOnly = code.replace(
            /@import\s+(?:url\(\s*(['"]?)(?:https?:)?\/\/[\s\S]*?\1\s*\)|(['"])(?:https?:)?\/\/[\s\S]*?\2)[^;]*;/gi,
            '',
          );
          return localOnly === code ? null : { code: localOnly, map: null };
        },
        transformIndexHtml: () => [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; object-src 'none'; form-action 'none'; base-uri 'self'",
          },
          injectTo: 'head-prepend' as const,
        }],
      }] : []),
      VitePWA({
        disable: simulation,
        // 'prompt' (not 'autoUpdate'): a new deploy waits behind a "A new version
        // is ready · Refresh" toast (src/components/UpdatePrompt.tsx) instead of
        // silently reloading. Sales staff stay in control mid-order, and they no
        // longer have to swipe-kill + relaunch the iPad PWA to pick up a fix.
        registerType: 'prompt',
        manifest: {
          name: "2990's POS",
          short_name: '2990 POS',
          description: "Sales POS for 2990's Home — phone, tablet and desktop",
          theme_color: '#221F20',
          background_color: '#FFF9EB',
          display: 'standalone',
          orientation: 'any',
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
    build: {
      // Demo output must never replace the directory used by production deploys.
      outDir: simulation ? 'dist-simulation' : 'dist',
      // Code-splitting (perf, 2026-06-13): without this the POS bundled into a
      // single ~1.2 MB chunk. Route components are lazy() in router.tsx; this
      // additionally carves the big node_modules vendors into their own chunks
      // so they cache across deploys (app code churns far more often than React /
      // Supabase / TanStack do) and download in parallel.
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (
              id.includes('/react-dom/') || id.includes('/react/') ||
              id.includes('/scheduler/') || id.includes('/react-router/')
            ) return 'react-vendor';
            if (id.includes('/@supabase/')) return 'supabase';
            if (id.includes('/@tanstack/')) return 'query';
            if (id.includes('/lucide-react/')) return 'icons';
            if (id.includes('/react-hook-form/')) return 'forms';
            if (id.includes('/zod/')) return 'zod';
            return 'vendor';
          },
        },
      },
    },
    server: simulation
      ? { port: 6288, host: '127.0.0.1', strictPort: true, hmr: false }
      : { port: 6273, host: true, strictPort: false },
    preview: { port: 4273 },
  };
});

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryCache, MutationCache, QueryClientProvider } from '@tanstack/react-query';
import '@2990s/design-system/tokens.css';
import './main.css';
import { AuthProvider } from './lib/auth';
import { CartSync } from './lib/cart-sync';
import { PwpCodeSync } from './lib/pwp-code-sync';
import { FreeGiftSync } from './lib/free-gift-sync';
import { UpdatePrompt } from './components/UpdatePrompt';
import { isSessionExpiredError, handleSessionExpired } from './lib/session-recovery';
import { router } from './router';

// Global session-expiry recovery: a 401 from any POS query/mutation means our
// Supabase session is dead server-side → sign out + redirect to /login, instead
// of leaving the user stranded on error banners. Centralised here (one place)
// because the POS data layer has authedFetch copy-pasted across ~12 modules.
// See lib/session-recovery.ts.
const onApiError = (error: unknown) => {
  if (isSessionExpiredError(error)) void handleSessionExpired();
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Don't burn retries on a dead session — fail fast so the redirect is
      // immediate. Other errors keep the default 3-attempt behaviour.
      retry: (failureCount, error) => !isSessionExpiredError(error) && failureCount < 3,
    },
  },
});

/* Deploy-window self-heal (Owner 2026-07-16) — mirrors the Backend: right
   after a deploy, a stale tab navigating to a lazy route can hit a hashed
   chunk that no longer exists (CF Pages answers HTML 200, not 404) and the
   tab wedges blank with no console error. 'vite:preloadError' is Vite's
   signal for that — reload once (per-minute guard) to pick up the new build.
   Complements UpdatePrompt (proactive PWA refresh toast); this is the
   reactive rescue once a stale tab has already tripped. */
window.addEventListener('vite:preloadError', (event) => {
  const KEY = '__chunkRetryAt';
  const last = Number(sessionStorage.getItem(KEY) ?? 0);
  if (Date.now() - last > 60_000) {
    event.preventDefault(); // handled — don't rethrow into the app
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  }
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* DB-backed cart sync (WS1): hydrate on login + write-through on change.
            Mounted here so it survives navigation (no per-route remount). */}
        <CartSync />
        {/* PWP voucher reconciler: reserve codes for trigger lines, free on
            trigger-remove. Beside CartSync so it survives navigation. */}
        <PwpCodeSync />
        {/* Default Free Gift reconciler (0170): auto-add RM 0 accessory gifts
            for trigger lines. Local only — no server codes. */}
        <FreeGiftSync />
        {/* "A new version is ready · Refresh" toast on deploy (PWA prompt
            mode). Beside the syncs so it survives navigation. */}
        <UpdatePrompt />
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

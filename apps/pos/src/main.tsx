import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryCache, MutationCache, QueryClientProvider } from '@tanstack/react-query';
import '@2990s/design-system/tokens.css';
import './main.css';
import { AuthProvider } from './lib/auth';
import { CartSync } from './lib/cart-sync';
import { PwpCodeSync } from './lib/pwp-code-sync';
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
        {/* "A new version is ready · Refresh" toast on deploy (PWA prompt
            mode). Beside the syncs so it survives navigation. */}
        <UpdatePrompt />
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

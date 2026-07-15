import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import '@2990s/design-system/tokens.css';
import './main.css';
import { AuthProvider } from './lib/auth';
import { ConfirmProvider, useConfirm } from './components/ConfirmDialog';
import { NotifyProvider, useNotify } from './components/NotifyDialog';
import { PromptProvider } from './components/PromptDialog';
import { ChoiceProvider } from './components/ChoiceDialog';
import { registerDialogService, serviceNotify } from './lib/dialog-service';
import { installCrossTabSync, broadcastDataChanged } from './lib/cross-tab-sync';
import { NewVersionBanner } from './components/NewVersionBanner';
import { router } from './router';

// Registers the live in-app confirm/notify dialogs into the module-level
// dialog-service so non-React data-layer code (authedFetch, query onError) can
// raise them instead of naked window.confirm/alert. Renders nothing.
function DialogServiceBridge() {
  const confirm = useConfirm();
  const notify = useNotify();
  useEffect(() => { registerDialogService({ confirm, notify }); }, [confirm, notify]);
  return null;
}

// Library tables (categories, series, compartment_library, bundle_library,
// size_library) are seeded once and rarely change — cache forever in-memory.
// Products + addons override staleTime per-query in lib/queries.ts.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
  // Safety net (Commander 2026-06-19 audit): many mutations had onSuccess but no
  // onError, so a failed WRITE — rack stock-in/out, a payment record, a delete, a
  // status / reopen change — was SILENT and the operator believed it succeeded.
  // This default surfaces the (already human-readable, humanised by authedFetch)
  // error for any mutation whose hook OR call site didn't supply its own onError;
  // mutations that DO handle their error opt out automatically.
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.options.onError) return; // already shown by the hook / call site
      void serviceNotify({
        title: 'Action failed',
        body: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    },
    // A3 — every successful write tells other open tabs to refetch (cross-tab
    // sync). One central hook, so no per-mutation wiring is needed.
    onSuccess: () => { broadcastDataChanged(); },
  }),
});

// A3 — listen for other tabs' writes and invalidate our active queries.
installCrossTabSync(queryClient);

/* Deploy-window self-heal (Owner 2026-07-16) — right after a Pages deploy, a
   stale tab navigating to a lazy route can hit a hashed chunk that no longer
   exists; CF Pages answers with the SPA HTML (HTTP 200, not 404), the import
   fails, and the tab wedges blank with no console error. Vite surfaces that
   failure as 'vite:preloadError' — reload once to pick up the new index.html
   + chunk graph. Guarded to once per minute per tab so a genuinely broken
   build can't reload-loop. Complements NewVersionBanner (the proactive
   "reload when ready" nudge); this is the reactive rescue once a stale tab
   has already tripped. */
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
        <ConfirmProvider>
          <NotifyProvider>
            <PromptProvider>
              <ChoiceProvider>
                <DialogServiceBridge />
                <NewVersionBanner />
                <RouterProvider router={router} />
              </ChoiceProvider>
            </PromptProvider>
          </NotifyProvider>
        </ConfirmProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

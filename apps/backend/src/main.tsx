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
  }),
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

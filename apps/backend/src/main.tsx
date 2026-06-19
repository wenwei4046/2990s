import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@2990s/design-system/tokens.css';
import './main.css';
import { AuthProvider } from './lib/auth';
import { ConfirmProvider, useConfirm } from './components/ConfirmDialog';
import { NotifyProvider, useNotify } from './components/NotifyDialog';
import { PromptProvider } from './components/PromptDialog';
import { registerDialogService } from './lib/dialog-service';
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
              <DialogServiceBridge />
              <RouterProvider router={router} />
            </PromptProvider>
          </NotifyProvider>
        </ConfirmProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

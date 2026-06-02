import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@2990s/design-system/tokens.css';
import './main.css';
import { AuthProvider } from './lib/auth';
import { CartSync } from './lib/cart-sync';
import { PwpCodeSync } from './lib/pwp-code-sync';
import { UpdatePrompt } from './components/UpdatePrompt';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
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

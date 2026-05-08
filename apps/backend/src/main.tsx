import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import '@2990s/design-system/tokens.css';
import './main.css';
import { AuthProvider } from './lib/auth';
import { router } from './router';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);

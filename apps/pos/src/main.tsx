import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import '@2990s/design-system/tokens.css';
import './main.css';
import { router } from './router';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

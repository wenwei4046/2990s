import { createBrowserRouter, Navigate } from 'react-router';
import { App } from './App';

export const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/dashboard', element: <App /> },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);

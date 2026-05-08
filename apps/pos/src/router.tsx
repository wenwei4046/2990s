import { createBrowserRouter, Navigate } from 'react-router';
import { Login } from './pages/Login';
import { Catalog } from './pages/Catalog';
import { AuthGate } from './components/AuthGate';

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/catalog', element: <AuthGate><Catalog /></AuthGate> },
  { path: '/', element: <Navigate to="/catalog" replace /> },
  { path: '*', element: <Navigate to="/catalog" replace /> },
]);

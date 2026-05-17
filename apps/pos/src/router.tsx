import { createBrowserRouter, Navigate } from 'react-router';
import { Login } from './pages/Login';
import { Catalog } from './pages/Catalog';
import { Configurator } from './pages/Configurator';
import { Cart } from './pages/Cart';
import { Handover } from './pages/Handover';
import { Confirmed } from './pages/Confirmed';
import { OrderStatus } from './pages/OrderStatus';
import { Quotes } from './pages/Quotes';
import { AuthGate } from './components/AuthGate';

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/catalog', element: <AuthGate><Catalog /></AuthGate> },
  { path: '/configure/:productId', element: <AuthGate><Configurator /></AuthGate> },
  { path: '/cart', element: <AuthGate><Cart /></AuthGate> },
  { path: '/handover', element: <AuthGate><Handover /></AuthGate> },
  { path: '/confirmed/:orderId', element: <AuthGate><Confirmed /></AuthGate> },
  { path: '/my-orders', element: <AuthGate><OrderStatus /></AuthGate> },
  { path: '/quotes', element: <AuthGate><Quotes /></AuthGate> },
  { path: '/', element: <Navigate to="/catalog" replace /> },
  { path: '*', element: <Navigate to="/catalog" replace /> },
]);

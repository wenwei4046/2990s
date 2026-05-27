import { createBrowserRouter, Navigate } from 'react-router';
import { Login } from './pages/Login';
import { Catalog } from './pages/Catalog';
import { Configurator } from './pages/Configurator';
import { Cart } from './pages/Cart';
import { Handover } from './pages/Handover';
import { Confirmed } from './pages/Confirmed';
import { HandoverConfirmed } from './pages/HandoverConfirmed';
import { OrderStatus } from './pages/OrderStatus';
import { Quotes } from './pages/Quotes';
import { SalesOrderPrint } from './pages/SalesOrderPrint';
import { AuthGate } from './components/AuthGate';

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/catalog', element: <AuthGate><Catalog /></AuthGate> },
  { path: '/configure/:productId', element: <AuthGate><Configurator /></AuthGate> },
  { path: '/cart', element: <AuthGate><Cart /></AuthGate> },
  { path: '/handover', element: <AuthGate><Handover /></AuthGate> },
  { path: '/confirmed/:orderId', element: <AuthGate><Confirmed /></AuthGate> },
  /* Task #70 — Manufacturing SO handover thank-you. Distinct from /confirmed
     (which reads from the legacy retail `orders` table) — this route shows
     the docNo straight after POST /mfg-sales-orders without a DB round trip. */
  { path: '/handover-confirmed/:docNo', element: <AuthGate><HandoverConfirmed /></AuthGate> },
  { path: '/my-orders', element: <AuthGate><OrderStatus /></AuthGate> },
  { path: '/quotes', element: <AuthGate><Quotes /></AuthGate> },
  { path: '/print/sales-order/:orderId', element: <AuthGate><SalesOrderPrint /></AuthGate> },
  { path: '/', element: <Navigate to="/catalog" replace /> },
  { path: '*', element: <Navigate to="/catalog" replace /> },
]);

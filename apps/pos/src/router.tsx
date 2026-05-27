import { createBrowserRouter, Navigate } from 'react-router';
import { Login } from './pages/Login';
import { SetPassword } from './pages/SetPassword';
import { Catalog } from './pages/Catalog';
import { Configurator } from './pages/Configurator';
import { Cart } from './pages/Cart';
import { Handover } from './pages/Handover';
import { Confirmed } from './pages/Confirmed';
import { HandoverConfirmed } from './pages/HandoverConfirmed';
import { OrderStatus } from './pages/OrderStatus';
import { Quotes } from './pages/Quotes';
import { SalesOrderPrint } from './pages/SalesOrderPrint';
import { Products } from './pages/Products';
import { AuthGate } from './components/AuthGate';

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  /* Invited POS-side staff land here from the magic-link email. Must stay
     OUTSIDE the AuthGate wrapper — the user is authed via Supabase session
     from the magic link, not via PIN, so the LockScreen fallback would
     otherwise block them. After they submit, AuthGate's password_set check
     will see the flipped flag and let them through to LockScreen / app. */
  { path: '/set-password', element: <SetPassword /> },
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
  /* PR — Commander 2026-05-28 ("把 Backend 的 Products 整个模块 port 到 POS").
     Sales-side roles see this readonly; sales_director / admin can edit.
     Page-level component reads useStaff() to derive readonly — no route
     gate needed, every authed POS user lands here and the inner page
     decides edit vs view. */
  { path: '/products', element: <AuthGate><Products /></AuthGate> },
  { path: '/', element: <Navigate to="/catalog" replace /> },
  { path: '*', element: <Navigate to="/catalog" replace /> },
]);

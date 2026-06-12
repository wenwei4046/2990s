import { createBrowserRouter, Navigate, Outlet, ScrollRestoration } from 'react-router';
import { Login } from './pages/Login';
import { SetPassword } from './pages/SetPassword';
import { ChangePin } from './pages/ChangePin';
import { Catalog } from './pages/Catalog';
import { Configurator } from './pages/Configurator';
import { Cart } from './pages/Cart';
import { Handover } from './pages/Handover';
import { HandoverConfirmed } from './pages/HandoverConfirmed';
import { OrderStatus } from './pages/OrderStatus';
import { Quotes } from './pages/Quotes';
import { SalesOrderPrint } from './pages/SalesOrderPrint';
import { Products } from './pages/Products';
import { SalesOrderMaintenance } from './pages/SalesOrderMaintenance';
import { NewOrder } from './pages/NewOrder';
import { AuthGate } from './components/AuthGate';
import { MaintainGate } from './components/MaintainGate';

/* Root layout — hosts <ScrollRestoration> for the whole app. It restores window
   scroll on history POP (the browser/swipe Back AND the configurator's in-app
   navigate(-1)), so returning to a scrolled catalogue lands on the same frame;
   PUSH navigations (drilling into a product) start at the top as usual. Scroll
   is keyed per history entry (default getKey = location.key). */
function RootLayout() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
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
  /* Task #70 — Manufacturing SO handover thank-you. Shows the docNo straight
     after POST /mfg-sales-orders without a DB round trip. (The legacy retail
     /confirmed/:orderId page was removed with the /orders cleanup 2026-06-12.) */
  { path: '/handover-confirmed/:docNo', element: <AuthGate><HandoverConfirmed /></AuthGate> },
  { path: '/my-orders', element: <AuthGate><OrderStatus /></AuthGate> },
  { path: '/quotes', element: <AuthGate><Quotes /></AuthGate> },
  /* WS2 (2026-05-31) — sales self-service PIN change. Inside AuthGate; the page
     itself bounces non-sales to /catalog (they have no PIN). */
  { path: '/change-pin', element: <AuthGate><ChangePin /></AuthGate> },
  { path: '/print/sales-order/:orderId', element: <AuthGate><SalesOrderPrint /></AuthGate> },
  /* PR — Commander 2026-05-28 ("把 Backend 的 Products 整个模块 port 到 POS").
     2026-06-01 — now wrapped in <MaintainGate>: only master-admin roles
     (admin / super_admin / master_account) may open it; everyone else is
     bounced to /catalog. The page still derives view/add/full from useStaff()
     for the admins who get in. */
  { path: '/products', element: <AuthGate><MaintainGate><Products /></MaintainGate></AuthGate> },
  /* PR — Commander 2026-05-28 ("Sales Order Maintenance 这个 module 也要 port
     到 POS"). Mode-based role gate inside the page:
       - admin                              → full
       - outlet_manager / sales_director    → add-only (no edit, no delete)
       - sales_executive / sales / default  → view
     Hits the SAME /venues, /localities, /state-warehouse-mappings,
     /so-dropdown-options API endpoints as Backend — bidirectional sync. */
  { path: '/sales-order-maintenance', element: <AuthGate><MaintainGate><SalesOrderMaintenance /></MaintainGate></AuthGate> },
  /* PR — Commander 2026-05-28 ("就直接添加一个 New Order 的 button, 点了
     之后就可以开了。不要跳 Backend，永远在 POS 系统里"). Topic 4 path 2:
     customer-first SO creation. Captures customer details, POSTs an empty
     SO header to /mfg-sales-orders, lands on the existing POS-native
     /handover-confirmed thank-you screen. */
  { path: '/new-order', element: <AuthGate><MaintainGate><NewOrder /></MaintainGate></AuthGate> },
  { path: '/', element: <Navigate to="/catalog" replace /> },
  { path: '*', element: <Navigate to="/catalog" replace /> },
    ],
  },
]);

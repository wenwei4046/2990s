import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, ScrollRestoration } from 'react-router';
import { Login } from './pages/Login';
import { SetPassword } from './pages/SetPassword';
import { Catalog } from './pages/Catalog';
import { AuthGate } from './components/AuthGate';
import { MaintainGate } from './components/MaintainGate';
import { HeadrestHarness } from './pages/dev/HeadrestHarness';

/* Code-splitting (perf, 2026-06-13) — the POS shipped as ONE ~1.2 MB JS chunk
   because every page was imported eagerly here, so the Configurator (sofa snap
   math), the ~2.8k-LOC Products editor, SO Maintenance, etc. all had to
   download + parse before the catalogue (the landing route) could paint. Only
   the auth entry (Login / SetPassword) and the catalogue stay eager; every
   other route is lazy() and loads on demand behind the <Suspense> in
   RootLayout. The PWA still precaches the split chunks in the background after
   first paint, so navigation stays instant once installed. */
const ChangePin = lazy(() => import('./pages/ChangePin').then((m) => ({ default: m.ChangePin })));
const Configurator = lazy(() => import('./pages/Configurator').then((m) => ({ default: m.Configurator })));
const Cart = lazy(() => import('./pages/Cart').then((m) => ({ default: m.Cart })));
const Handover = lazy(() => import('./pages/Handover').then((m) => ({ default: m.Handover })));
const HandoverConfirmed = lazy(() => import('./pages/HandoverConfirmed').then((m) => ({ default: m.HandoverConfirmed })));
const OrderStatus = lazy(() => import('./pages/OrderStatus').then((m) => ({ default: m.OrderStatus })));
const Quotes = lazy(() => import('./pages/Quotes').then((m) => ({ default: m.Quotes })));
const SalesOrderPrint = lazy(() => import('./pages/SalesOrderPrint').then((m) => ({ default: m.SalesOrderPrint })));
const Products = lazy(() => import('./pages/Products').then((m) => ({ default: m.Products })));
const SalesOrderMaintenance = lazy(() => import('./pages/SalesOrderMaintenance').then((m) => ({ default: m.SalesOrderMaintenance })));
const NewOrder = lazy(() => import('./pages/NewOrder').then((m) => ({ default: m.NewOrder })));
const SalesAnalysis = lazy(() => import('./pages/SalesAnalysis').then((m) => ({ default: m.SalesAnalysis })));

/* Root layout — hosts <ScrollRestoration> for the whole app. It restores window
   scroll on history POP (the browser/swipe Back AND the configurator's in-app
   navigate(-1)), so returning to a scrolled catalogue lands on the same frame;
   PUSH navigations (drilling into a product) start at the top as usual. Scroll
   is keyed per history entry (default getKey = location.key). */
/* Shown while a lazy() route chunk downloads. Deliberately minimal — chunks are
   small + edge-cached (and SW-precached once installed), so this rarely shows
   for more than a frame. */
function RouteFallback() {
  return (
    <div style={{
      minHeight: '60vh', display: 'grid', placeItems: 'center',
      fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13, 0.8125rem)', color: 'var(--fg-muted)',
    }}>
      Loading…
    </div>
  );
}

function RootLayout() {
  return (
    <>
      <ScrollRestoration />
      {/* One Suspense boundary covers every lazy() route element below. */}
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
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
  /* TEMP dev-only harness (2026-06-29) — remove before merge. */
  { path: '/dev/headrest', element: <HeadrestHarness /> },
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
  { path: '/sales-analysis', element: <AuthGate><MaintainGate><SalesAnalysis /></MaintainGate></AuthGate> },
  { path: '/', element: <Navigate to="/catalog" replace /> },
  { path: '*', element: <Navigate to="/catalog" replace /> },
    ],
  },
]);

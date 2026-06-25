import { lazy, type ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { Layout, NoAccess } from './components/Layout';
import { ErrorBoundaryRoot } from './components/ErrorBoundary';
import { Login } from './pages/Login';
import { Sso } from './pages/Sso';
import { SetPassword } from './pages/SetPassword';
import { ChangePassword } from './pages/ChangePassword';
import { Dashboard } from './pages/Dashboard';

// Commander 2026-05-29 — "Failed to fetch dynamically imported module": after
// a deploy the chunk hashes change, so an old tab's lazy import 404s and shows
// the error boundary. lazyRetry reloads the page ONCE (guarded by sessionStorage
// so we never loop) to pull the fresh index; the flag clears on the next
// successful chunk load so a later deploy can self-heal again.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    const KEY = 'chunk-reload-once';
    try {
      const mod = await factory();
      sessionStorage.removeItem(KEY);
      return mod;
    } catch (err) {
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1');
        window.location.reload();
        return await new Promise<{ default: T }>(() => { /* reload takes over */ });
      }
      throw err;
    }
  });
}

// Per-route code splitting. Above-the-fold pages (Login, SetPassword, Layout
// shell, Dashboard) stay eager — everything else is lazy-loaded so the initial
// bundle drops from ~1.5 MB to just the landing page. A single <Suspense>
// boundary in Layout.tsx wraps <Outlet /> so each lazy page reuses the same
// fallback while it loads.
//
// Every page module exports NAMED components, so each lazy() call uses the
// .then(m => ({ default: m.X })) adapter to satisfy React.lazy's "default
// export" contract.

const AuditLog = lazyRetry(() => import('./pages/AuditLog').then(m => ({ default: m.AuditLog })));
// Add-ons (Dispose/Lift) editor moved to the POS "Special Add-ons" tab → Order
// Add-ons (Chairman 2026-06-02, decision B). Backend route retired; the
// Addons.tsx / NewAddonModal.tsx files are left in place as dead code.
const Settings = lazyRetry(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Customers = lazyRetry(() => import('./pages/Customers').then(m => ({ default: m.Customers })));
const Products = lazyRetry(() => import('./pages/Products').then(m => ({ default: m.Products })));
const ProductModels = lazyRetry(() => import('./pages/ProductModels').then(m => ({ default: m.ProductModels })));
const ProductModelDetail = lazyRetry(() => import('./pages/ProductModelDetail').then(m => ({ default: m.ProductModelDetail })));
const FabricTracking = lazyRetry(() => import('./pages/FabricTracking').then(m => ({ default: m.FabricTracking })));
const Currencies = lazyRetry(() => import('./pages/Currencies').then(m => ({ default: m.Currencies })));
const Suppliers = lazyRetry(() => import('./pages/Suppliers').then(m => ({ default: m.Suppliers })));
const SupplierDetail = lazyRetry(() => import('./pages/SupplierDetail').then(m => ({ default: m.SupplierDetail })));
const PurchaseOrders = lazyRetry(() => import('./pages/PurchaseOrders').then(m => ({ default: m.PurchaseOrders })));
// GRN module rebuilt as a PO-clone (PO-parity): standalone list + draft-mode
// detail pages. Replaces the old FlowPages.Grns + DocDetailPages.GrnDetail.
const GoodsReceived = lazyRetry(() => import('./pages/GoodsReceivedList').then(m => ({ default: m.GoodsReceived })));
const GoodsReceivedDetail = lazyRetry(() => import('./pages/GoodsReceivedDetail').then(m => ({ default: m.GoodsReceivedDetail })));
// PI module rebuilt as a GRN-clone (PO-parity): standalone list + confirmed,
// immediate-save detail page. Replaces the old FlowPages.PurchaseInvoicesPage +
// DocDetailPages.PurchaseInvoiceDetail (both definitions stay in place).
const PurchaseInvoices = lazyRetry(() => import('./pages/PurchaseInvoicesList').then(m => ({ default: m.PurchaseInvoices })));
const PurchaseInvoiceDetail = lazyRetry(() => import('./pages/PurchaseInvoiceDetail').then(m => ({ default: m.PurchaseInvoiceDetail })));
const MfgSalesOrdersPage = lazyRetry(() => import('./pages/FlowPages').then(m => ({ default: m.MfgSalesOrdersPage })));
const MfgDeliveryOrdersList = lazyRetry(() => import('./pages/MfgDeliveryOrdersList').then(m => ({ default: m.MfgDeliveryOrdersList })));
const DeliveryOrderNew = lazyRetry(() => import('./pages/DeliveryOrderNew').then(m => ({ default: m.DeliveryOrderNew })));
const DeliveryOrderFromSo = lazyRetry(() => import('./pages/DeliveryOrderFromSo').then(m => ({ default: m.DeliveryOrderFromSo })));
// SI module rebuilt as a DO-clone (SO-parity): standalone DataGrid list +
// editable detail + multi-select Convert-From-DO picker + Create form.
// Replaces the old FlowPages.SalesInvoicesPage + DocDetailPages.SalesInvoiceDetail
// (both definitions stay in place).
const SalesInvoicesList = lazyRetry(() => import('./pages/SalesInvoicesList').then(m => ({ default: m.SalesInvoicesList })));
const SalesInvoiceNew = lazyRetry(() => import('./pages/SalesInvoiceNew').then(m => ({ default: m.SalesInvoiceNew })));
const SalesInvoiceFromDo = lazyRetry(() => import('./pages/SalesInvoiceFromDo').then(m => ({ default: m.SalesInvoiceFromDo })));
const DeliveryReturnsList = lazyRetry(() => import('./pages/DeliveryReturnsList').then(m => ({ default: m.DeliveryReturnsList })));
const DeliveryReturnDetail = lazyRetry(() => import('./pages/DeliveryReturnDetail').then(m => ({ default: m.DeliveryReturnDetail })));
const DeliveryReturnNew = lazyRetry(() => import('./pages/DeliveryReturnNew').then(m => ({ default: m.DeliveryReturnNew })));
const DeliveryReturnFromDo = lazyRetry(() => import('./pages/DeliveryReturnFromDo').then(m => ({ default: m.DeliveryReturnFromDo })));
// (Old FlowPages.PurchaseReturnsPage import removed — repointed to the new
// PurchaseReturnsList below. The FlowPages definition stays in place.)
// PR module rebuilt as a GRN-clone (PO-parity): standalone list + confirmed,
// immediate-save detail page. Replaces the old FlowPages.PurchaseReturnsPage +
// DocDetailPages.PurchaseReturnDetail.
const PurchaseReturns = lazyRetry(() => import('./pages/PurchaseReturnsList').then(m => ({ default: m.PurchaseReturns })));
const PurchaseReturnDetail = lazyRetry(() => import('./pages/PurchaseReturnDetail').then(m => ({ default: m.PurchaseReturnDetail })));
const SalesOrderDetail = lazyRetry(() => import('./pages/SalesOrderDetail').then(m => ({ default: m.SalesOrderDetail })));
const SalesOrderNew = lazyRetry(() => import('./pages/SalesOrderNew').then(m => ({ default: m.SalesOrderNew })));
const SoFromProducts = lazyRetry(() => import('./pages/SoFromProducts').then(m => ({ default: m.SoFromProducts })));
const SalesOrderMaintenance = lazyRetry(() => import('./pages/SalesOrderMaintenance').then(m => ({ default: m.SalesOrderMaintenance })));
const Inventory = lazyRetry(() => import('./pages/Inventory').then(m => ({ default: m.Inventory })));
const StockCard = lazyRetry(() => import('./pages/StockCard').then(m => ({ default: m.StockCard })));
const StockAdjustments = lazyRetry(() => import('./pages/StockAdjustments').then(m => ({ default: m.StockAdjustments })));
const StockAdjustmentNew = lazyRetry(() => import('./pages/StockAdjustmentNew').then(m => ({ default: m.StockAdjustmentNew })));
const StockTransfers = lazyRetry(() => import('./pages/StockTransfers').then(m => ({ default: m.StockTransfers })));
const StockTransferNew = lazyRetry(() => import('./pages/StockTransferNew').then(m => ({ default: m.StockTransferNew })));
const StockTransferDetail = lazyRetry(() => import('./pages/StockTransferDetail').then(m => ({ default: m.StockTransferDetail })));
const StockTakes = lazyRetry(() => import('./pages/StockTakes').then(m => ({ default: m.StockTakes })));
const StockTakeNew = lazyRetry(() => import('./pages/StockTakeNew').then(m => ({ default: m.StockTakeNew })));
const StockTakeDetail = lazyRetry(() => import('./pages/StockTakeDetail').then(m => ({ default: m.StockTakeDetail })));
// Fleet — consolidated "Driver & Helper" portal (Drivers · Helpers · Lorries on
// ONE page). Replaces the three former standalone sidebar pages; the old
// /drivers /helpers /lorries routes now redirect here (see below). The
// standalone Drivers/Helpers/Lorries page modules are left in place as dead
// code (no longer routed).
const Fleet = lazyRetry(() => import('./pages/Fleet').then(m => ({ default: m.Fleet })));
// Delivery Planning board (Stage 4) — the 4-state × region planning view.
const DeliveryPlanning = lazyRetry(() => import('./pages/DeliveryPlanning').then(m => ({ default: m.DeliveryPlanning })));
// Delivery Regions — the owner-maintained region-bucket master that drives the
// board's tabs (migration 0198).
const DeliveryPlanningRegions = lazyRetry(() => import('./pages/DeliveryPlanningRegions').then(m => ({ default: m.DeliveryPlanningRegions })));
// Lorry Capacity dashboard (Stage 5B, final) — fleet performance metrics.
const LorryCapacity = lazyRetry(() => import('./pages/LorryCapacity').then(m => ({ default: m.LorryCapacity })));
const Accounting = lazyRetry(() => import('./pages/Accounting').then(m => ({ default: m.Accounting })));
const Warehouses = lazyRetry(() => import('./pages/Warehouses').then(m => ({ default: m.Warehouses })));
// Migration 0094 — Warehouse rack/bin management (ported from Hookka ERP).
const Warehouse = lazyRetry(() => import('./pages/Warehouse').then(m => ({ default: m.Warehouse })));
// Migration 0086 — Users management page (admin / sales_director / coordinator).
const Users = lazyRetry(() => import('./pages/Users').then(m => ({ default: m.Users })));
const HrCommission = lazyRetry(() => import('./pages/HrCommission').then(m => ({ default: m.HrCommission })));
const HrSettings = lazyRetry(() => import('./pages/HrSettings').then(m => ({ default: m.HrSettings })));
const PurchaseOrderDetail = lazyRetry(() => import('./pages/PurchaseOrderDetail').then(m => ({ default: m.PurchaseOrderDetail })));
const PurchaseOrderNew = lazyRetry(() => import('./pages/PurchaseOrderNew').then(m => ({ default: m.PurchaseOrderNew })));
const PurchaseOrderFromSo = lazyRetry(() => import('./pages/PurchaseOrderFromSo').then(m => ({ default: m.PurchaseOrderFromSo })));
const GrnNew = lazyRetry(() => import('./pages/GrnNew').then(m => ({ default: m.GrnNew })));
const GrnFromPo = lazyRetry(() => import('./pages/GrnFromPo').then(m => ({ default: m.GrnFromPo })));
const PurchaseInvoiceNew = lazyRetry(() => import('./pages/PurchaseInvoiceNew').then(m => ({ default: m.PurchaseInvoiceNew })));
const PurchaseInvoiceFromGrn = lazyRetry(() => import('./pages/PurchaseInvoiceFromGrn').then(m => ({ default: m.PurchaseInvoiceFromGrn })));
// Payment Vouchers (standalone cash-out voucher — migration 0189).
const PaymentVouchers = lazyRetry(() => import('./pages/PaymentVouchers').then(m => ({ default: m.PaymentVouchers })));
const PaymentVoucherNew = lazyRetry(() => import('./pages/PaymentVoucherNew').then(m => ({ default: m.PaymentVoucherNew })));
const PaymentVoucherDetail = lazyRetry(() => import('./pages/PaymentVoucherDetail').then(m => ({ default: m.PaymentVoucherDetail })));
const PurchaseReturnNew = lazyRetry(() => import('./pages/PurchaseReturnNew').then(m => ({ default: m.PurchaseReturnNew })));
const Outstanding = lazyRetry(() => import('./pages/Outstanding').then(m => ({ default: m.Outstanding })));
const Mrp = lazyRetry(() => import('./pages/Mrp').then(m => ({ default: m.Mrp })));
const SystemHealth = lazyRetry(() => import('./pages/SystemHealth').then(m => ({ default: m.SystemHealth })));
const Placeholder = lazyRetry(() => import('./pages/Placeholder').then(m => ({ default: m.Placeholder })));
const DeliveryOrderDetailListing = lazyRetry(() => import('./pages/DeliveryOrderDetailListing').then(m => ({ default: m.DeliveryOrderDetailListing })));
const SalesInvoiceDetailListing = lazyRetry(() => import('./pages/SalesInvoiceDetailListing').then(m => ({ default: m.SalesInvoiceDetailListing })));
const DeliveryReturnDetailListing = lazyRetry(() => import('./pages/DeliveryReturnDetailListing').then(m => ({ default: m.DeliveryReturnDetailListing })));
const DeliveryOrderDetail = lazyRetry(() => import('./pages/DeliveryOrderDetail').then(m => ({ default: m.DeliveryOrderDetail })));
// Consignment Order (faithful SO-clone module). Supersedes the older simple
// Consignment* pages — the /consignment routes below point at these new pages.
// The old ConsignmentList/New/Detail files are left in place (to be removed
// separately) but are no longer routed.
const ConsignmentOrders = lazyRetry(() => import('./pages/ConsignmentOrders').then(m => ({ default: m.ConsignmentOrders })));
const ConsignmentOrderNew = lazyRetry(() => import('./pages/ConsignmentOrderNew').then(m => ({ default: m.ConsignmentOrderNew })));
const ConsignmentOrderDetail = lazyRetry(() => import('./pages/ConsignmentOrderDetail').then(m => ({ default: m.ConsignmentOrderDetail })));
// Consignment Note (faithful DO-clone module, /consignment-notes API).
const ConsignmentNotes = lazyRetry(() => import('./pages/ConsignmentNotes').then(m => ({ default: m.ConsignmentNotes })));
const ConsignmentNoteNew = lazyRetry(() => import('./pages/ConsignmentNoteNew').then(m => ({ default: m.ConsignmentNoteNew })));
const ConsignmentNoteFromOrder = lazyRetry(() => import('./pages/ConsignmentNoteFromOrder').then(m => ({ default: m.ConsignmentNoteFromOrder })));
const ConsignmentNoteDetail = lazyRetry(() => import('./pages/ConsignmentNoteDetail').then(m => ({ default: m.ConsignmentNoteDetail })));
// Consignment Return (faithful DR-clone module, /consignment-returns API).
const ConsignmentReturns = lazyRetry(() => import('./pages/ConsignmentReturns').then(m => ({ default: m.ConsignmentReturns })));
const ConsignmentReturnNew = lazyRetry(() => import('./pages/ConsignmentReturnNew').then(m => ({ default: m.ConsignmentReturnNew })));
const ConsignmentReturnDetail = lazyRetry(() => import('./pages/ConsignmentReturnDetail').then(m => ({ default: m.ConsignmentReturnDetail })));
const ConsignmentReturnFromNote = lazyRetry(() => import('./pages/ConsignmentReturnFromNote').then(m => ({ default: m.ConsignmentReturnFromNote })));
// Purchase Consignment Order (faithful PO-clone module, /purchase-consignment-orders API).
const PurchaseConsignmentOrders = lazyRetry(() => import('./pages/PurchaseConsignmentOrders').then(m => ({ default: m.PurchaseConsignmentOrders })));
const PurchaseConsignmentOrderNew = lazyRetry(() => import('./pages/PurchaseConsignmentOrderNew').then(m => ({ default: m.PurchaseConsignmentOrderNew })));
const PurchaseConsignmentOrderDetail = lazyRetry(() => import('./pages/PurchaseConsignmentOrderDetail').then(m => ({ default: m.PurchaseConsignmentOrderDetail })));
// Purchase Consignment Receive (faithful GRN-clone module, /purchase-consignment-receives API).
const PurchaseConsignmentReceives = lazyRetry(() => import('./pages/PurchaseConsignmentReceives').then(m => ({ default: m.PurchaseConsignmentReceives })));
const PurchaseConsignmentReceiveNew = lazyRetry(() => import('./pages/PurchaseConsignmentReceiveNew').then(m => ({ default: m.PurchaseConsignmentReceiveNew })));
const PurchaseConsignmentReceiveDetail = lazyRetry(() => import('./pages/PurchaseConsignmentReceiveDetail').then(m => ({ default: m.PurchaseConsignmentReceiveDetail })));
const PurchaseConsignmentReceiveFromOrder = lazyRetry(() => import('./pages/PurchaseConsignmentReceiveFromOrder').then(m => ({ default: m.PurchaseConsignmentReceiveFromOrder })));
// Purchase Consignment Return (faithful PR-clone module, /purchase-consignment-returns API).
const PurchaseConsignmentReturns = lazyRetry(() => import('./pages/PurchaseConsignmentReturns').then(m => ({ default: m.PurchaseConsignmentReturns })));
const PurchaseConsignmentReturnNew = lazyRetry(() => import('./pages/PurchaseConsignmentReturnNew').then(m => ({ default: m.PurchaseConsignmentReturnNew })));
const PurchaseConsignmentReturnDetail = lazyRetry(() => import('./pages/PurchaseConsignmentReturnDetail').then(m => ({ default: m.PurchaseConsignmentReturnDetail })));
const PurchaseConsignmentReturnFromReceive = lazyRetry(() => import('./pages/PurchaseConsignmentReturnFromReceive').then(m => ({ default: m.PurchaseConsignmentReturnFromReceive })));
const SalesInvoiceDetail = lazyRetry(() => import('./pages/SalesInvoiceDetail').then(m => ({ default: m.SalesInvoiceDetail })));

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/set-password', element: <SetPassword /> },
  { path: '/change-password', element: <ChangePassword /> },
  { path: '/no-access', element: <NoAccess /> },
  /* TEMPORARY (Loo 2026-06-10) — POS → Backend session handoff landing for
     the SO emergency hatch. Outside <Layout/> so the auth guard doesn't
     bounce the not-yet-signed-in visitor before verifyOtp runs. */
  { path: '/sso', element: <Sso /> },
  {
    path: '/',
    element: <Layout />,
    errorElement: <ErrorBoundaryRoot />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'products', element: <Products /> },
      { path: 'product-models', element: <ProductModels /> },
      { path: 'product-models/:id', element: <ProductModelDetail /> },
      { path: 'fabric-tracking', element: <FabricTracking /> },
      { path: 'inventory', element: <Inventory /> },
      { path: 'inventory/stock-card/:productCode', element: <StockCard /> },
      // /new must come before any potential :id segment under /adjustments.
      { path: 'inventory/adjustments', element: <StockAdjustments /> },
      { path: 'inventory/adjustments/new', element: <StockAdjustmentNew /> },
      // Stock Transfers — /new must precede :id.
      { path: 'inventory/transfers', element: <StockTransfers /> },
      { path: 'inventory/transfers/new', element: <StockTransferNew /> },
      { path: 'inventory/transfers/:id', element: <StockTransferDetail /> },
      // Stock Takes (Inv PR5) — /new must precede :id.
      { path: 'inventory/stock-takes', element: <StockTakes /> },
      { path: 'inventory/stock-takes/new', element: <StockTakeNew /> },
      { path: 'inventory/stock-takes/:id', element: <StockTakeDetail /> },
      { path: 'warehouses', element: <Warehouses /> },
      // Rack/bin management — distinct from /warehouses (which is the
      // warehouse master). Sidebar entry added by the parent session.
      { path: 'warehouse', element: <Warehouse /> },
      // Consolidated "Driver & Helper" / Fleet portal — Drivers · Helpers ·
      // Lorries on ONE page (migration 0195 masters). The three former routes
      // redirect here so old deep links + bookmarks keep working.
      { path: 'fleet', element: <Fleet /> },
      { path: 'drivers', element: <Navigate to="/fleet" replace /> },
      { path: 'helpers', element: <Navigate to="/fleet" replace /> },
      { path: 'lorries', element: <Navigate to="/fleet" replace /> },
      // Delivery Planning board (Stage 4).
      { path: 'delivery-planning', element: <DeliveryPlanning /> },
      // Delivery Regions — region-bucket master (drives the board's tabs).
      { path: 'delivery-planning-regions', element: <DeliveryPlanningRegions /> },
      // Lorry Capacity dashboard (Stage 5B, final).
      { path: 'lorry-capacity', element: <LorryCapacity /> },
      { path: 'suppliers', element: <Suppliers /> },
      { path: 'suppliers/:id', element: <SupplierDetail /> },
      // Currencies MASTER (migration 0193) — owner-maintained currency list +
      // rates. Lives in the Procurement group next to Suppliers.
      { path: 'currencies', element: <Currencies /> },
      { path: 'mrp', element: <Mrp /> },
      { path: 'purchase-orders',      element: <PurchaseOrders /> },
      { path: 'purchase-orders/new',     element: <PurchaseOrderNew /> },
      { path: 'purchase-orders/from-so', element: <PurchaseOrderFromSo /> },
      { path: 'purchase-orders/:id',  element: <PurchaseOrderDetail /> },
      { path: 'grns', element: <GoodsReceived /> },
      // /new + /from-po are STATIC paths — must precede the :id param route.
      { path: 'grns/new', element: <GrnNew /> },
      { path: 'grns/from-po', element: <GrnFromPo /> },
      { path: 'grns/:id', element: <GoodsReceivedDetail /> },
      { path: 'purchase-invoices', element: <PurchaseInvoices /> },
      // /new + /from-grn are STATIC paths — must precede the :id param route.
      { path: 'purchase-invoices/new', element: <PurchaseInvoiceNew /> },
      { path: 'purchase-invoices/from-grn', element: <PurchaseInvoiceFromGrn /> },
      { path: 'purchase-invoices/:id', element: <PurchaseInvoiceDetail /> },
      { path: 'payment-vouchers', element: <PaymentVouchers /> },
      // /new is a STATIC path — must precede the :id param route.
      { path: 'payment-vouchers/new', element: <PaymentVoucherNew /> },
      { path: 'payment-vouchers/:id', element: <PaymentVoucherDetail /> },
      { path: 'mfg-sales-orders', element: <MfgSalesOrdersPage /> },
      // PR #106 — must come BEFORE :docNo so /new isn't caught as a doc number.
      { path: 'mfg-sales-orders/new', element: <SalesOrderNew /> },
      { path: 'mfg-sales-orders/generate', element: <SoFromProducts /> },
      // Task #110 — Localities moved out of Settings → dedicated SO Maintenance
      // page. Must precede :docNo so 'maintenance' isn't read as a doc number.
      { path: 'mfg-sales-orders/maintenance', element: <SalesOrderMaintenance /> },
      { path: 'mfg-sales-orders/:docNo', element: <SalesOrderDetail /> },
      { path: 'mfg-delivery-orders', element: <MfgDeliveryOrdersList /> },
      // /new + /from-so must come BEFORE :id so they aren't caught as a DO id.
      { path: 'mfg-delivery-orders/new', element: <DeliveryOrderNew /> },
      { path: 'mfg-delivery-orders/from-so', element: <DeliveryOrderFromSo /> },
      { path: 'mfg-delivery-orders/:id', element: <DeliveryOrderDetail /> },
      { path: 'sales-invoices', element: <SalesInvoicesList /> },
      // /new + /from-do must come BEFORE :id so they aren't caught as an SI id.
      { path: 'sales-invoices/new', element: <SalesInvoiceNew /> },
      { path: 'sales-invoices/from-do', element: <SalesInvoiceFromDo /> },
      { path: 'sales-invoices/:id', element: <SalesInvoiceDetail /> },
      // Consignment Order — new faithful SO-clone module supersedes the older
      // simple Consignment pages. /new is STATIC, must precede the :docNo route.
      { path: 'consignment', element: <ConsignmentOrders /> },
      { path: 'consignment/new', element: <ConsignmentOrderNew /> },
      { path: 'consignment/:docNo', element: <ConsignmentOrderDetail /> },
      // Consignment Note — DO-clone module (/consignment-notes API). /new is
      // STATIC, must precede the :id route.
      { path: 'consignment-note', element: <ConsignmentNotes /> },
      { path: 'consignment-note/new', element: <ConsignmentNoteNew /> },
      { path: 'consignment-note/from-order', element: <ConsignmentNoteFromOrder /> },
      { path: 'consignment-note/:id', element: <ConsignmentNoteDetail /> },
      // Consignment Return — DR-clone module (/consignment-returns API). /new is
      // STATIC, must precede the :id route.
      { path: 'consignment-return', element: <ConsignmentReturns /> },
      { path: 'consignment-return/new', element: <ConsignmentReturnNew /> },
      { path: 'consignment-return/from-note', element: <ConsignmentReturnFromNote /> },
      { path: 'consignment-return/:id', element: <ConsignmentReturnDetail /> },
      // Purchase Consignment Order — PO-clone module (/purchase-consignment-orders
      // API). /new is STATIC, must precede the :id route.
      { path: 'purchase-consignment', element: <PurchaseConsignmentOrders /> },
      { path: 'purchase-consignment/new', element: <PurchaseConsignmentOrderNew /> },
      { path: 'purchase-consignment/:id', element: <PurchaseConsignmentOrderDetail /> },
      // Purchase Consignment Receive — GRN-clone module (/purchase-consignment-receives
      // API). /new is STATIC, must precede the :id route.
      { path: 'purchase-consignment-receive', element: <PurchaseConsignmentReceives /> },
      { path: 'purchase-consignment-receive/new', element: <PurchaseConsignmentReceiveNew /> },
      { path: 'purchase-consignment-receive/from-pc-order', element: <PurchaseConsignmentReceiveFromOrder /> },
      { path: 'purchase-consignment-receive/:id', element: <PurchaseConsignmentReceiveDetail /> },
      // Purchase Consignment Return — PR-clone module (/purchase-consignment-returns
      // API). /new is STATIC, must precede the :id route.
      { path: 'purchase-consignment-return', element: <PurchaseConsignmentReturns /> },
      { path: 'purchase-consignment-return/new', element: <PurchaseConsignmentReturnNew /> },
      { path: 'purchase-consignment-return/from-receive', element: <PurchaseConsignmentReturnFromReceive /> },
      { path: 'purchase-consignment-return/:id', element: <PurchaseConsignmentReturnDetail /> },
      { path: 'delivery-returns', element: <DeliveryReturnsList /> },
      // /new + /from-do must come BEFORE :id so they aren't caught as a DR id.
      { path: 'delivery-returns/new', element: <DeliveryReturnNew /> },
      { path: 'delivery-returns/from-do', element: <DeliveryReturnFromDo /> },
      { path: 'delivery-returns/:id', element: <DeliveryReturnDetail /> },
      { path: 'purchase-returns', element: <PurchaseReturns /> },
      // /new is a STATIC path — must precede the :id param route.
      { path: 'purchase-returns/new', element: <PurchaseReturnNew /> },
      { path: 'purchase-returns/:id', element: <PurchaseReturnDetail /> },
      { path: 'accounting', element: <Accounting /> },
      { path: 'outstanding', element: <Outstanding /> },
      { path: 'reports/sales-order-listing', element: <Placeholder title="Sales Order Listing" phase="a follow-up PR" hint="One row per SO header. Use Sales Order Detail Listing for line-item view." /> },
      /* Task #120 — L2 Detail Listing routes for the other SO-family modules.
         Reached from the L1 toolbar's "Listing" picker; no sidebar entry. */
      { path: 'reports/delivery-order-detail-listing', element: <DeliveryOrderDetailListing /> },
      { path: 'reports/sales-invoice-detail-listing', element: <SalesInvoiceDetailListing /> },
      { path: 'reports/delivery-return-detail-listing', element: <DeliveryReturnDetailListing /> },
      { path: 'audit-log', element: <AuditLog /> },
      { path: 'customers', element: <Customers /> },
      { path: 'settings', element: <Settings /> },
      // HR — commission calculator + settings (admin + super_admin only).
      { path: 'hr/commission', element: <HrCommission /> },
      { path: 'hr/settings', element: <HrSettings /> },
      // Migration 0086 — Users management (invite + edit + deactivate).
      { path: 'users', element: <Users /> },
      // Admin observability dashboard (ported from HOOKKA, 2026-05-29).
      { path: 'system-health', element: <SystemHealth /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);

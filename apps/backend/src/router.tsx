import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { Layout, NoAccess } from './components/Layout';
import { ErrorBoundaryRoot } from './components/ErrorBoundary';
import { Login } from './pages/Login';
import { SetPassword } from './pages/SetPassword';
import { Dashboard } from './pages/Dashboard';

// Per-route code splitting. Above-the-fold pages (Login, SetPassword, Layout
// shell, Dashboard) stay eager — everything else is lazy-loaded so the initial
// bundle drops from ~1.5 MB to just the landing page. A single <Suspense>
// boundary in Layout.tsx wraps <Outlet /> so each lazy page reuses the same
// fallback while it loads.
//
// Every page module exports NAMED components, so each lazy() call uses the
// .then(m => ({ default: m.X })) adapter to satisfy React.lazy's "default
// export" contract.

const SkuMaster = lazy(() => import('./pages/SkuMaster').then(m => ({ default: m.SkuMaster })));
const Orders = lazy(() => import('./pages/Orders').then(m => ({ default: m.Orders })));
const AuditLog = lazy(() => import('./pages/AuditLog').then(m => ({ default: m.AuditLog })));
const Addons = lazy(() => import('./pages/Addons').then(m => ({ default: m.Addons })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Customers = lazy(() => import('./pages/Customers').then(m => ({ default: m.Customers })));
const Products = lazy(() => import('./pages/Products').then(m => ({ default: m.Products })));
const ProductModels = lazy(() => import('./pages/ProductModels').then(m => ({ default: m.ProductModels })));
const ProductModelDetail = lazy(() => import('./pages/ProductModelDetail').then(m => ({ default: m.ProductModelDetail })));
const FabricTracking = lazy(() => import('./pages/FabricTracking').then(m => ({ default: m.FabricTracking })));
const Suppliers = lazy(() => import('./pages/Suppliers').then(m => ({ default: m.Suppliers })));
const SupplierDetail = lazy(() => import('./pages/SupplierDetail').then(m => ({ default: m.SupplierDetail })));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders').then(m => ({ default: m.PurchaseOrders })));
const Grns = lazy(() => import('./pages/FlowPages').then(m => ({ default: m.Grns })));
const PurchaseInvoicesPage = lazy(() => import('./pages/FlowPages').then(m => ({ default: m.PurchaseInvoicesPage })));
const MfgSalesOrdersPage = lazy(() => import('./pages/FlowPages').then(m => ({ default: m.MfgSalesOrdersPage })));
const MfgDeliveryOrdersPage = lazy(() => import('./pages/FlowPages').then(m => ({ default: m.MfgDeliveryOrdersPage })));
const SalesInvoicesPage = lazy(() => import('./pages/FlowPages').then(m => ({ default: m.SalesInvoicesPage })));
const ConsignmentPage = lazy(() => import('./pages/FlowPages').then(m => ({ default: m.ConsignmentPage })));
const DeliveryReturnsPage = lazy(() => import('./pages/FlowPages').then(m => ({ default: m.DeliveryReturnsPage })));
const PurchaseReturnsPage = lazy(() => import('./pages/FlowPages').then(m => ({ default: m.PurchaseReturnsPage })));
const SalesOrderDetail = lazy(() => import('./pages/SalesOrderDetail').then(m => ({ default: m.SalesOrderDetail })));
const SalesOrderNew = lazy(() => import('./pages/SalesOrderNew').then(m => ({ default: m.SalesOrderNew })));
const SalesOrderMaintenance = lazy(() => import('./pages/SalesOrderMaintenance').then(m => ({ default: m.SalesOrderMaintenance })));
const Inventory = lazy(() => import('./pages/Inventory').then(m => ({ default: m.Inventory })));
const StockCard = lazy(() => import('./pages/StockCard').then(m => ({ default: m.StockCard })));
const StockAdjustments = lazy(() => import('./pages/StockAdjustments').then(m => ({ default: m.StockAdjustments })));
const StockAdjustmentNew = lazy(() => import('./pages/StockAdjustmentNew').then(m => ({ default: m.StockAdjustmentNew })));
const StockTransfers = lazy(() => import('./pages/StockTransfers').then(m => ({ default: m.StockTransfers })));
const StockTransferNew = lazy(() => import('./pages/StockTransferNew').then(m => ({ default: m.StockTransferNew })));
const StockTransferDetail = lazy(() => import('./pages/StockTransferDetail').then(m => ({ default: m.StockTransferDetail })));
const StockTakes = lazy(() => import('./pages/StockTakes').then(m => ({ default: m.StockTakes })));
const StockTakeNew = lazy(() => import('./pages/StockTakeNew').then(m => ({ default: m.StockTakeNew })));
const StockTakeDetail = lazy(() => import('./pages/StockTakeDetail').then(m => ({ default: m.StockTakeDetail })));
const Drivers = lazy(() => import('./pages/Drivers').then(m => ({ default: m.Drivers })));
const Accounting = lazy(() => import('./pages/Accounting').then(m => ({ default: m.Accounting })));
const Warehouses = lazy(() => import('./pages/Warehouses').then(m => ({ default: m.Warehouses })));
// Migration 0094 — Warehouse rack/bin management (ported from Hookka ERP).
const Warehouse = lazy(() => import('./pages/Warehouse').then(m => ({ default: m.Warehouse })));
// Migration 0086 — Users management page (admin / sales_director / coordinator).
const Users = lazy(() => import('./pages/Users').then(m => ({ default: m.Users })));
const PurchaseOrderDetail = lazy(() => import('./pages/PurchaseOrderDetail').then(m => ({ default: m.PurchaseOrderDetail })));
const PurchaseOrderNew = lazy(() => import('./pages/PurchaseOrderNew').then(m => ({ default: m.PurchaseOrderNew })));
const PurchaseOrderFromSo = lazy(() => import('./pages/PurchaseOrderFromSo').then(m => ({ default: m.PurchaseOrderFromSo })));
const GrnNew = lazy(() => import('./pages/GrnNew').then(m => ({ default: m.GrnNew })));
const GrnFromPo = lazy(() => import('./pages/GrnFromPo').then(m => ({ default: m.GrnFromPo })));
const PurchaseInvoiceNew = lazy(() => import('./pages/PurchaseInvoiceNew').then(m => ({ default: m.PurchaseInvoiceNew })));
const PurchaseInvoiceFromGrn = lazy(() => import('./pages/PurchaseInvoiceFromGrn').then(m => ({ default: m.PurchaseInvoiceFromGrn })));
const PurchaseReturnNew = lazy(() => import('./pages/PurchaseReturnNew').then(m => ({ default: m.PurchaseReturnNew })));
const Outstanding = lazy(() => import('./pages/Outstanding').then(m => ({ default: m.Outstanding })));
const Placeholder = lazy(() => import('./pages/Placeholder').then(m => ({ default: m.Placeholder })));
const SalesOrderDetailListing = lazy(() => import('./pages/SalesOrderDetailListing').then(m => ({ default: m.SalesOrderDetailListing })));
const DeliveryOrderDetailListing = lazy(() => import('./pages/DeliveryOrderDetailListing').then(m => ({ default: m.DeliveryOrderDetailListing })));
const SalesInvoiceDetailListing = lazy(() => import('./pages/SalesInvoiceDetailListing').then(m => ({ default: m.SalesInvoiceDetailListing })));
const ConsignmentDetailListing = lazy(() => import('./pages/ConsignmentDetailListing').then(m => ({ default: m.ConsignmentDetailListing })));
const DeliveryReturnDetailListing = lazy(() => import('./pages/DeliveryReturnDetailListing').then(m => ({ default: m.DeliveryReturnDetailListing })));
const GrnDetail = lazy(() => import('./pages/DocDetailPages').then(m => ({ default: m.GrnDetail })));
const PurchaseInvoiceDetail = lazy(() => import('./pages/DocDetailPages').then(m => ({ default: m.PurchaseInvoiceDetail })));
const DeliveryOrderDetail = lazy(() => import('./pages/DocDetailPages').then(m => ({ default: m.DeliveryOrderDetail })));
const SalesInvoiceDetail = lazy(() => import('./pages/DocDetailPages').then(m => ({ default: m.SalesInvoiceDetail })));
const ConsignmentDetail = lazy(() => import('./pages/DocDetailPages').then(m => ({ default: m.ConsignmentDetail })));
const PurchaseReturnDetail = lazy(() => import('./pages/DocDetailPages').then(m => ({ default: m.PurchaseReturnDetail })));

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/set-password', element: <SetPassword /> },
  { path: '/no-access', element: <NoAccess /> },
  {
    path: '/',
    element: <Layout />,
    errorElement: <ErrorBoundaryRoot />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'orders', element: <Orders /> },
      { path: 'sku-master', element: <SkuMaster /> },
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
      { path: 'drivers', element: <Drivers /> },
      { path: 'suppliers', element: <Suppliers /> },
      { path: 'suppliers/:id', element: <SupplierDetail /> },
      { path: 'purchase-orders',      element: <PurchaseOrders /> },
      { path: 'purchase-orders/new',     element: <PurchaseOrderNew /> },
      { path: 'purchase-orders/from-so', element: <PurchaseOrderFromSo /> },
      { path: 'purchase-orders/:id',  element: <PurchaseOrderDetail /> },
      { path: 'grns', element: <Grns /> },
      { path: 'grns/new', element: <GrnNew /> },
      { path: 'grns/from-po', element: <GrnFromPo /> },
      { path: 'grns/:id', element: <GrnDetail /> },
      { path: 'purchase-invoices', element: <PurchaseInvoicesPage /> },
      { path: 'purchase-invoices/new', element: <PurchaseInvoiceNew /> },
      { path: 'purchase-invoices/from-grn', element: <PurchaseInvoiceFromGrn /> },
      { path: 'purchase-invoices/:id', element: <PurchaseInvoiceDetail /> },
      { path: 'mfg-sales-orders', element: <MfgSalesOrdersPage /> },
      // PR #106 — must come BEFORE :docNo so /new isn't caught as a doc number.
      { path: 'mfg-sales-orders/new', element: <SalesOrderNew /> },
      // Task #110 — Localities moved out of Settings → dedicated SO Maintenance
      // page. Must precede :docNo so 'maintenance' isn't read as a doc number.
      { path: 'mfg-sales-orders/maintenance', element: <SalesOrderMaintenance /> },
      { path: 'mfg-sales-orders/:docNo', element: <SalesOrderDetail /> },
      { path: 'mfg-delivery-orders', element: <MfgDeliveryOrdersPage /> },
      { path: 'mfg-delivery-orders/:id', element: <DeliveryOrderDetail /> },
      { path: 'sales-invoices', element: <SalesInvoicesPage /> },
      { path: 'sales-invoices/:id', element: <SalesInvoiceDetail /> },
      { path: 'consignment', element: <ConsignmentPage /> },
      { path: 'consignment/:id', element: <ConsignmentDetail /> },
      { path: 'delivery-returns', element: <DeliveryReturnsPage /> },
      { path: 'purchase-returns', element: <PurchaseReturnsPage /> },
      { path: 'purchase-returns/new', element: <PurchaseReturnNew /> },
      { path: 'purchase-returns/:id', element: <PurchaseReturnDetail /> },
      { path: 'accounting', element: <Accounting /> },
      { path: 'outstanding', element: <Outstanding /> },
      { path: 'reports/sales-order-listing', element: <Placeholder title="Sales Order Listing" phase="a follow-up PR" hint="One row per SO header. Use Sales Order Detail Listing for line-item view." /> },
      { path: 'reports/sales-order-detail-listing', element: <SalesOrderDetailListing /> },
      /* Task #120 — L2 Detail Listing routes for the 4 other SO-family modules.
         Reached from the L1 toolbar's "Listing" picker; no sidebar entry. */
      { path: 'reports/delivery-order-detail-listing', element: <DeliveryOrderDetailListing /> },
      { path: 'reports/sales-invoice-detail-listing', element: <SalesInvoiceDetailListing /> },
      { path: 'reports/consignment-detail-listing', element: <ConsignmentDetailListing /> },
      { path: 'reports/delivery-return-detail-listing', element: <DeliveryReturnDetailListing /> },
      { path: 'audit-log', element: <AuditLog /> },
      { path: 'addons', element: <Addons /> },
      { path: 'customers', element: <Customers /> },
      { path: 'settings', element: <Settings /> },
      // Migration 0086 — Users management (invite + edit + deactivate).
      { path: 'users', element: <Users /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);

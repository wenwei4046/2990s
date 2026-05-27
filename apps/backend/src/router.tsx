import { createBrowserRouter, Navigate } from 'react-router';
import { Layout, NoAccess } from './components/Layout';
import { Login } from './pages/Login';
import { SetPassword } from './pages/SetPassword';
import { Dashboard } from './pages/Dashboard';
import { SkuMaster } from './pages/SkuMaster';
import { Orders } from './pages/Orders';
import { AuditLog } from './pages/AuditLog';
import { Addons } from './pages/Addons';
import { Settings } from './pages/Settings';
import { Customers } from './pages/Customers';
import { Products } from './pages/Products';
import { ProductModels } from './pages/ProductModels';
import { ProductModelDetail } from './pages/ProductModelDetail';
import { FabricTracking } from './pages/FabricTracking';
import { Suppliers } from './pages/Suppliers';
import { SupplierDetail } from './pages/SupplierDetail';
import { PurchaseOrders } from './pages/PurchaseOrders';
import {
  Grns, PurchaseInvoicesPage, MfgSalesOrdersPage, MfgDeliveryOrdersPage,
  SalesInvoicesPage, ConsignmentPage, DeliveryReturnsPage, PurchaseReturnsPage,
} from './pages/FlowPages';
import { SalesOrderDetail } from './pages/SalesOrderDetail';
import { SalesOrderNew } from './pages/SalesOrderNew';
import { Inventory } from './pages/Inventory';
import { Drivers } from './pages/Drivers';
import { Accounting } from './pages/Accounting';
import { Warehouses } from './pages/Warehouses';
import { PurchaseOrderDetail } from './pages/PurchaseOrderDetail';
import { PurchaseOrderNew } from './pages/PurchaseOrderNew';
import { PurchaseOrderFromSo } from './pages/PurchaseOrderFromSo';
import { GrnNew } from './pages/GrnNew';
import { PurchaseInvoiceNew } from './pages/PurchaseInvoiceNew';
import { PurchaseReturnNew } from './pages/PurchaseReturnNew';
import { Outstanding } from './pages/Outstanding';
import { Placeholder } from './pages/Placeholder';
import { SalesOrderDetailListing } from './pages/SalesOrderDetailListing';
import {
  GrnDetail, PurchaseInvoiceDetail, DeliveryOrderDetail, SalesInvoiceDetail,
  ConsignmentDetail, PurchaseReturnDetail,
} from './pages/DocDetailPages';

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/set-password', element: <SetPassword /> },
  { path: '/no-access', element: <NoAccess /> },
  {
    path: '/',
    element: <Layout />,
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
      { path: 'warehouses', element: <Warehouses /> },
      { path: 'drivers', element: <Drivers /> },
      { path: 'suppliers', element: <Suppliers /> },
      { path: 'suppliers/:id', element: <SupplierDetail /> },
      { path: 'purchase-orders',      element: <PurchaseOrders /> },
      { path: 'purchase-orders/new',     element: <PurchaseOrderNew /> },
      { path: 'purchase-orders/from-so', element: <PurchaseOrderFromSo /> },
      { path: 'purchase-orders/:id',  element: <PurchaseOrderDetail /> },
      { path: 'grns', element: <Grns /> },
      { path: 'grns/new', element: <GrnNew /> },
      { path: 'grns/:id', element: <GrnDetail /> },
      { path: 'purchase-invoices', element: <PurchaseInvoicesPage /> },
      { path: 'purchase-invoices/new', element: <PurchaseInvoiceNew /> },
      { path: 'purchase-invoices/:id', element: <PurchaseInvoiceDetail /> },
      { path: 'mfg-sales-orders', element: <MfgSalesOrdersPage /> },
      // PR #106 — must come BEFORE :docNo so /new isn't caught as a doc number.
      { path: 'mfg-sales-orders/new', element: <SalesOrderNew /> },
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
      { path: 'audit-log', element: <AuditLog /> },
      { path: 'addons', element: <Addons /> },
      { path: 'customers', element: <Customers /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);

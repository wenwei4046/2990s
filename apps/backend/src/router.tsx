import { createBrowserRouter, Navigate } from 'react-router';
import { Layout, NoAccess } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { SkuMaster } from './pages/SkuMaster';
import { Orders } from './pages/Orders';
import { AuditLog } from './pages/AuditLog';
import { Addons } from './pages/Addons';
import { Settings } from './pages/Settings';
import { Customers } from './pages/Customers';
import { Products } from './pages/Products';
import { FabricTracking } from './pages/FabricTracking';
import { Suppliers } from './pages/Suppliers';
import { SupplierDetail } from './pages/SupplierDetail';
import { PurchaseOrders } from './pages/PurchaseOrders';
import {
  Grns, PurchaseInvoicesPage, MfgSalesOrdersPage, MfgDeliveryOrdersPage,
  SalesInvoicesPage, ConsignmentPage, DeliveryReturnsPage, PurchaseReturnsPage,
} from './pages/FlowPages';
import { SalesOrderDetail } from './pages/SalesOrderDetail';
import { Inventory } from './pages/Inventory';
import {
  GrnDetail, PurchaseInvoiceDetail, DeliveryOrderDetail, SalesInvoiceDetail,
  ConsignmentDetail, PurchaseReturnDetail,
} from './pages/DocDetailPages';

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
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
      { path: 'fabric-tracking', element: <FabricTracking /> },
      { path: 'inventory', element: <Inventory /> },
      { path: 'suppliers', element: <Suppliers /> },
      { path: 'suppliers/:id', element: <SupplierDetail /> },
      { path: 'purchase-orders', element: <PurchaseOrders /> },
      { path: 'grns', element: <Grns /> },
      { path: 'grns/:id', element: <GrnDetail /> },
      { path: 'purchase-invoices', element: <PurchaseInvoicesPage /> },
      { path: 'purchase-invoices/:id', element: <PurchaseInvoiceDetail /> },
      { path: 'mfg-sales-orders', element: <MfgSalesOrdersPage /> },
      { path: 'mfg-sales-orders/:docNo', element: <SalesOrderDetail /> },
      { path: 'mfg-delivery-orders', element: <MfgDeliveryOrdersPage /> },
      { path: 'mfg-delivery-orders/:id', element: <DeliveryOrderDetail /> },
      { path: 'sales-invoices', element: <SalesInvoicesPage /> },
      { path: 'sales-invoices/:id', element: <SalesInvoiceDetail /> },
      { path: 'consignment', element: <ConsignmentPage /> },
      { path: 'consignment/:id', element: <ConsignmentDetail /> },
      { path: 'delivery-returns', element: <DeliveryReturnsPage /> },
      { path: 'purchase-returns', element: <PurchaseReturnsPage /> },
      { path: 'purchase-returns/:id', element: <PurchaseReturnDetail /> },
      { path: 'audit-log', element: <AuditLog /> },
      { path: 'addons', element: <Addons /> },
      { path: 'customers', element: <Customers /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);

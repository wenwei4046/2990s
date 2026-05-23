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
      { path: 'audit-log', element: <AuditLog /> },
      { path: 'addons', element: <Addons /> },
      { path: 'customers', element: <Customers /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
]);

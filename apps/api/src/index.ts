import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createClient } from '@supabase/supabase-js';
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import type { Env, Variables } from './env';
import { health } from './routes/health';
import { products } from './routes/products';
import { orders } from './routes/orders';
import { slipRoutes } from './routes/slips';
import { purchaseOrders } from './routes/purchase-orders';
import { quotes } from './routes/quotes';
import { admin } from './routes/admin';
import { auditLog } from './routes/audit-log';
import { categoriesApi } from './routes/categories';
import { deliveryFees } from './routes/delivery-fees';
import { pos } from './routes/pos';
import { mfgProducts } from './routes/mfg-products';
import { productModels } from './routes/product-models';
import { maintenanceConfig } from './routes/maintenance-config';
import { sofaCompartmentPhotos } from './routes/sofa-compartment-photos';
import { sofaCombos } from './routes/sofa-combos';
import { fabricTracking } from './routes/fabric-tracking';
import { suppliers } from './routes/suppliers';
import { mfgPurchaseOrders } from './routes/mfg-purchase-orders';
import { grns } from './routes/grns';
import { purchaseInvoices } from './routes/purchase-invoices';
import { mfgSalesOrders } from './routes/mfg-sales-orders';
import { stateWarehouseMappings } from './routes/state-warehouse-mappings';
import { localities } from './routes/localities';
import { soDropdownOptions } from './routes/so-dropdown-options';
import { deliveryOrdersMfg } from './routes/delivery-orders-mfg';
import { salesInvoices } from './routes/sales-invoices';
import { consignments } from './routes/consignments';
import { consignmentReturns } from './routes/consignment-returns';
import { purchaseConsignments } from './routes/purchase-consignments';
import { purchaseConsignmentReturns } from './routes/purchase-consignment-returns';
import { deliveryReturns } from './routes/delivery-returns';
import { purchaseReturns } from './routes/purchase-returns';
import { inventory } from './routes/inventory';
import { warehouse } from './routes/warehouse';
import { stockTransfers } from './routes/stock-transfers';
import { stockTakes } from './routes/stock-takes';
import { drivers } from './routes/drivers';
import { venues } from './routes/venues';
import { accounting } from './routes/accounting';
import { outstanding } from './routes/outstanding';
import { reports } from './routes/reports';
import { mrp } from './routes/mrp';
import { mrpLeadTimes } from './routes/mrp-lead-times';
import { supabaseAuth } from './middleware/auth';
import { reapOnce } from './lib/reaper';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', logger());

app.use('*', async (c, next) => {
  const origins = c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const handler = cors({
    origin: (origin) => (origins.includes(origin) ? origin : null),
    credentials: true,
    /* PUT added 2026-05-27 — state_warehouse_mappings upsert uses PUT,
       and PUT missing from the allowMethods list caused the CORS preflight
       to reject the call ("Save failed: Failed to fetch" toast). */
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['authorization', 'content-type', 'x-client-info'],
    maxAge: 600,
  });
  return handler(c, next);
});

app.route('/health', health);
app.route('/products', products);
app.route('/orders', orders);
app.route('/purchase-orders', purchaseOrders);
app.route('/quotes', quotes);
app.route('/admin', admin);
app.route('/admin/audit-log', auditLog);
app.route('/admin/categories', categoriesApi);
app.route('/delivery-fees', deliveryFees);
app.route('/pos', pos);
app.route('/mfg-products', mfgProducts);
app.route('/product-models', productModels);
// PR — Commander 2026-05-28: Sofa Compartment photos. Mount BEFORE
// /maintenance-config so the public GET .../photo/:key proxy doesn't get
// caught by maintenance-config's app-wide supabaseAuth middleware. The
// authed POST/DELETE routes inside this sub-app re-apply supabaseAuth.
app.route('/maintenance-config/sofa-compartments', sofaCompartmentPhotos);
app.route('/maintenance-config', maintenanceConfig);
app.route('/sofa-combos', sofaCombos);
app.route('/fabric-tracking', fabricTracking);
app.route('/suppliers', suppliers);
app.route('/mfg-purchase-orders', mfgPurchaseOrders);
app.route('/grns', grns);
app.route('/purchase-invoices', purchaseInvoices);
app.route('/mfg-sales-orders', mfgSalesOrders);
app.route('/state-warehouse-mappings', stateWarehouseMappings);
app.route('/localities', localities);
app.route('/so-dropdown-options', soDropdownOptions);
app.route('/delivery-orders-mfg', deliveryOrdersMfg);
app.route('/sales-invoices', salesInvoices);
app.route('/consignments', consignments);
app.route('/consignment-returns', consignmentReturns);
app.route('/purchase-consignments', purchaseConsignments);
app.route('/purchase-consignment-returns', purchaseConsignmentReturns);
app.route('/delivery-returns', deliveryReturns);
app.route('/purchase-returns', purchaseReturns);
app.route('/inventory', inventory);
app.route('/warehouse', warehouse);
app.route('/stock-transfers', stockTransfers);
app.route('/stock-takes', stockTakes);
app.route('/drivers', drivers);
app.route('/venues', venues);
app.route('/accounting', accounting);
app.route('/outstanding', outstanding);
app.route('/reports', reports);
app.route('/mrp', mrp);
app.route('/mrp-lead-times', mrpLeadTimes);

// Slip routes need auth; applied at mount because slipRoutes itself has no
// middleware (so it stays unit-testable with mocked context).
app.use('/slips/*', supabaseAuth);
app.route('/slips', slipRoutes);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('[api error]', err);
  return c.json({ error: 'internal_error', message: err.message }, 500);
});

// CF Workers entrypoint with both fetch + scheduled handlers.
// scheduled() runs on the cron triggers in wrangler.toml ("*/10 * * * *").
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const workerId = `cron-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    ctx.waitUntil((async () => {
      try {
        const result = await reapOnce(supabase, env, workerId);
        console.log(JSON.stringify({
          ts: new Date().toISOString(),
          event: 'reaper_run',
          workerId,
          ...result,
        }));
      } catch (err) {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          event: 'reaper_error',
          workerId,
          message: err instanceof Error ? err.message : String(err),
        }));
      }
    })());
  },
};

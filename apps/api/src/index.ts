import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createClient } from '@supabase/supabase-js';
import type { ScheduledEvent, ExecutionContext } from '@cloudflare/workers-types';
import type { Env, Variables } from './env';
import { health } from './routes/health';
import { products } from './routes/products';
import { slipRoutes } from './routes/slips';
import { quotes } from './routes/quotes';
import { admin } from './routes/admin';
import { auditLog } from './routes/audit-log';
import { categoriesApi } from './routes/categories';
import { deliveryFees } from './routes/delivery-fees';
import { fabricTierAddonConfig } from './routes/fabric-tier-addon';
import { modelFreeGifts } from './routes/model-free-gifts';
import { freeItemCampaigns } from './routes/free-item-campaigns';
import { pwpRules } from './routes/pwp-rules';
import { pwpCodes } from './routes/pwp-codes';
import { specialAddons } from './routes/special-addons';
import { fabricLibrary } from './routes/fabric-library';
import { pos } from './routes/pos';
import { mfgProducts } from './routes/mfg-products';
import { productModels } from './routes/product-models';
import { maintenanceConfig } from './routes/maintenance-config';
import { sofaCompartmentPhotos } from './routes/sofa-compartment-photos';
import { sofaCombos } from './routes/sofa-combos';
import { sofaQuickPicks } from './routes/sofa-quick-picks';
import { personalQuickPicks } from './routes/personal-quick-picks';
import { posCart } from './routes/pos-cart';
import { fabricTracking } from './routes/fabric-tracking';
import { currencies } from './routes/currencies';
import { suppliers } from './routes/suppliers';
import { mfgPurchaseOrders } from './routes/mfg-purchase-orders';
import { grns } from './routes/grns';
import { purchaseInvoices } from './routes/purchase-invoices';
import { paymentVouchers } from './routes/payment-vouchers';
import { mfgSalesOrders } from './routes/mfg-sales-orders';
import { soAmendments } from './routes/so-amendments';
import { scanSo, distillAllSalespersonRules } from './routes/scan-so';
import { stateWarehouseMappings } from './routes/state-warehouse-mappings';
import { localities } from './routes/localities';
import { soDropdownOptions } from './routes/so-dropdown-options';
import { soSettings } from './routes/so-settings';
import { deliveryOrdersMfg } from './routes/delivery-orders-mfg';
import { salesInvoices } from './routes/sales-invoices';
import { documentFlow } from './routes/document-flow';
import { deliveryReturns } from './routes/delivery-returns';
import { purchaseReturns } from './routes/purchase-returns';
import { consignmentOrders } from './routes/consignment-orders';
import { consignmentNotes } from './routes/consignment-notes';
import { consignmentReturns } from './routes/consignment-returns';
import { purchaseConsignmentOrders } from './routes/purchase-consignment-orders';
import { purchaseConsignmentReceives } from './routes/purchase-consignment-receives';
import { purchaseConsignmentReturns } from './routes/purchase-consignment-returns';
import { inventory } from './routes/inventory';
import { warehouse } from './routes/warehouse';
import { stockTransfers } from './routes/stock-transfers';
import { stockTakes } from './routes/stock-takes';
import { drivers } from './routes/drivers';
import { helpers } from './routes/helpers';
import { lorries } from './routes/lorries';
import { deliveryPlanning } from './routes/delivery-planning';
import { deliveryPlanningRegions } from './routes/delivery-planning-regions';
import { trips } from './routes/trips';
import { lorryCapacity } from './routes/lorry-capacity';
import { venues } from './routes/venues';
import { accounting } from './routes/accounting';
import { outstanding } from './routes/outstanding';
import { reports } from './routes/reports';
import { mrp } from './routes/mrp';
import { mrpLeadTimes } from './routes/mrp-lead-times';
import { hr } from './routes/hr';
import { salesAnalysis } from './routes/sales-analysis';
import { supabaseAuth } from './middleware/auth';
import { readOnlyGuard } from './middleware/read-only';
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

// Reversible read-only freeze (env-gated). When READ_ONLY_MODE === 'true' every
// mutating request is rejected 403 read_only, except the login/session
// endpoints — so staff can still sign in + view, but all writes are redirected
// to HouzsERP. Mounted AFTER cors (preflight still answers) and BEFORE the
// routes (so it covers every one). Inert unless the flag is flipped in
// wrangler.toml [vars] (committed default "false").
app.use('*', readOnlyGuard);

app.route('/health', health);
app.route('/products', products);
app.route('/quotes', quotes);
app.route('/admin', admin);
app.route('/admin/audit-log', auditLog);
app.route('/admin/categories', categoriesApi);
app.route('/delivery-fees', deliveryFees);
app.route('/fabric-tier-addon', fabricTierAddonConfig);
app.route('/model-free-gifts', modelFreeGifts);
app.route('/free-item-campaigns', freeItemCampaigns);
app.route('/pwp-rules', pwpRules);
app.route('/pwp-codes', pwpCodes);
app.route('/special-addons', specialAddons);
app.route('/fabric-library', fabricLibrary);
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
app.route('/sofa-quick-picks', sofaQuickPicks);
app.route('/personal-quick-picks', personalQuickPicks);
app.route('/pos-cart', posCart);
app.route('/fabric-tracking', fabricTracking);
app.route('/currencies', currencies);
app.route('/suppliers', suppliers);
app.route('/mfg-purchase-orders', mfgPurchaseOrders);
app.route('/grns', grns);
app.route('/purchase-invoices', purchaseInvoices);
app.route('/payment-vouchers', paymentVouchers);
app.route('/mfg-sales-orders', mfgSalesOrders);
app.route('/so-amendments', soAmendments);
// Scan Order — handwritten showroom slip OCR → New SO prefill.
app.route('/scan-so', scanSo);
app.route('/state-warehouse-mappings', stateWarehouseMappings);
app.route('/localities', localities);
app.route('/so-dropdown-options', soDropdownOptions);
app.route('/so-settings', soSettings);
app.route('/delivery-orders-mfg', deliveryOrdersMfg);
app.route('/sales-invoices', salesInvoices);
app.route('/document-flow', documentFlow);
app.route('/delivery-returns', deliveryReturns);
app.route('/purchase-returns', purchaseReturns);
app.route('/consignment-orders', consignmentOrders);
app.route('/consignment-notes', consignmentNotes);
app.route('/consignment-returns', consignmentReturns);
app.route('/purchase-consignment-orders', purchaseConsignmentOrders);
app.route('/purchase-consignment-receives', purchaseConsignmentReceives);
app.route('/purchase-consignment-returns', purchaseConsignmentReturns);
app.route('/inventory', inventory);
app.route('/warehouse', warehouse);
app.route('/stock-transfers', stockTransfers);
app.route('/stock-takes', stockTakes);
app.route('/drivers', drivers);
app.route('/helpers', helpers);
app.route('/lorries', lorries);
app.route('/delivery-planning', deliveryPlanning);
app.route('/delivery-planning-regions', deliveryPlanningRegions);
app.route('/trips', trips);
app.route('/lorry-capacity', lorryCapacity);
app.route('/venues', venues);
app.route('/accounting', accounting);
app.route('/outstanding', outstanding);
app.route('/reports', reports);
app.route('/mrp', mrp);
app.route('/mrp-lead-times', mrpLeadTimes);
app.route('/hr', hr);
app.route('/sales-analysis', salesAnalysis);

// Slip routes need auth; applied at mount because slipRoutes itself has no
// middleware (so it stays unit-testable with mocked context).
app.use('/slips/*', supabaseAuth);
app.route('/slips', slipRoutes);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('[api error]', err);
  return c.json({ error: 'internal_error', message: err.message }, 500);
});

// Weekly scan-SO rule distillation: Sunday 20:00 UTC = Monday 04:00 MYT.
// Must match the second entry in wrangler.toml [triggers] crons exactly —
// event.cron is the literal trigger string. Day-of-week must be a NAME (or
// 1-7): Cloudflare rejects "* * 0" as an invalid cron and the whole
// `wrangler deploy` fails (hit 2026-06-12).
const WEEKLY_DISTILL_CRON = '0 20 * * SUN';

// CF Workers entrypoint with both fetch + scheduled handlers.
// scheduled() runs on the cron triggers in wrangler.toml:
//   "*/10 * * * *"  → slip-orphan reaper (every 10 min)
//   "0 20 * * SUN"  → weekly per-salesperson scan-SO rule distill
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    if (event.cron === WEEKLY_DISTILL_CRON) {
      ctx.waitUntil((async () => {
        try {
          const summary = await distillAllSalespersonRules(supabase, env.ANTHROPIC_API_KEY);
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            event: 'scan_so_weekly_distill',
            ...summary,
          }));
        } catch (err) {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            event: 'scan_so_weekly_distill_error',
            message: err instanceof Error ? err.message : String(err),
          }));
        }
      })());
      return;
    }

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

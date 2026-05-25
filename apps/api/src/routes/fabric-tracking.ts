// ----------------------------------------------------------------------------
// /fabric-tracking — fabric inventory + per-context price tiers.
//
// Ported (simplified) from HOOKKA src/api/routes/fabric-tracking.ts. The
// HOOKKA version live-aggregates SOH/PO/usage from raw_materials, cost_ledger
// and active FAB_CUT job_cards — none of which exist in 2990s yet. So this
// version reads the static fabric_trackings table directly. Metric columns
// (SOH, po_outstanding, usage windows, shortage) are whatever was snapshotted
// at seed time. Forward port: re-compute live when raw_materials lands.
//
// Endpoints:
//   GET   /fabric-tracking?category=B.M-FABR&search=avani
//   PATCH /fabric-tracking/:id/tier
//         body: { field: 'sofaPriceTier' | 'bedframePriceTier', tier: 'PRICE_1'|'PRICE_2'|'PRICE_3' }
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const fabricTracking = new Hono<{ Bindings: Env; Variables: Variables }>();

fabricTracking.use('*', supabaseAuth);

const VALID_CATEGORIES = new Set(['B.M-FABR', 'S-FABR', 'S.M-FABR', 'LINING', 'WEBBING']);
const VALID_TIER_FIELDS = new Set(['sofaPriceTier', 'bedframePriceTier']);
const VALID_TIERS = new Set(['PRICE_1', 'PRICE_2', 'PRICE_3']);

// Map JS camelCase tier field → Postgres snake_case column.
const TIER_FIELD_TO_COL: Record<string, string> = {
  sofaPriceTier: 'sofa_price_tier',
  bedframePriceTier: 'bedframe_price_tier',
};

fabricTracking.get('/', async (c) => {
  const category = c.req.query('category');
  const search = c.req.query('search');
  const supabase = c.get('supabase');

  let q = supabase
    .from('fabric_trackings')
    .select(
      'id, fabric_code, fabric_description, fabric_category, price_tier, ' +
        'sofa_price_tier, bedframe_price_tier, price_centi, soh_centi, ' +
        'po_outstanding_centi, last_month_usage_centi, one_week_usage_centi, ' +
        'two_weeks_usage_centi, one_month_usage_centi, shortage_centi, ' +
        'reorder_point_centi, supplier, supplier_code, lead_time_days',
    )
    .order('fabric_code', { ascending: true });

  if (category && VALID_CATEGORIES.has(category)) {
    q = q.eq('fabric_category', category);
  }
  if (search) {
    q = q.or(`fabric_code.ilike.%${search}%,fabric_description.ilike.%${search}%`);
  }

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ fabrics: data ?? [] });
});

// Set the supplier's own code for this fabric (what we print on POs sent to
// the supplier). Single supplier per fabric — multi-supplier still goes
// through supplier_material_bindings.
fabricTracking.patch('/:id/supplier-code', async (c) => {
  const id = c.req.param('id');
  let body: { supplierCode?: string | null };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const supabase = c.get('supabase');
  const trimmed = typeof body.supplierCode === 'string' ? body.supplierCode.trim() : null;
  const next = trimmed === '' ? null : trimmed;

  const { error } = await supabase
    .from('fabric_trackings')
    .update({ supplier_code: next })
    .eq('id', id);

  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    if (/column .* does not exist/i.test(error.message)) {
      return c.json({ error: 'migration_pending', reason: 'Run migration 0046 against Supabase.' }, 500);
    }
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  return c.json({ ok: true, supplierCode: next });
});

fabricTracking.patch('/:id/tier', async (c) => {
  const id = c.req.param('id');
  let body: { field?: string; tier?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  if (!body.field || !VALID_TIER_FIELDS.has(body.field)) {
    return c.json({ error: 'invalid_field', allowed: [...VALID_TIER_FIELDS] }, 400);
  }
  if (!body.tier || !VALID_TIERS.has(body.tier)) {
    return c.json({ error: 'invalid_tier', allowed: [...VALID_TIERS] }, 400);
  }

  const col = TIER_FIELD_TO_COL[body.field]!;
  const supabase = c.get('supabase');
  const updates: Record<string, string> = { [col]: body.tier };
  const { error } = await supabase.from('fabric_trackings').update(updates).eq('id', id);

  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  return c.json({ ok: true });
});

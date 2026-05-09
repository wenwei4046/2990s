import { Hono } from 'hono';
import { orderV1PostSchema, SlipVerifyRequestSchema } from '@2990s/shared/schemas';
import {
  computeOrderTotal,
  pricingDriftExceeds,
  OrderPricingError,
  type ServerProductInfo,
  type OrderLineInput,
} from '@2990s/shared/pricing';
import { supabaseAuth } from '../middleware/auth';
import { presign, type SlipMime } from '../lib/r2';
import { slipBindings } from '../lib/slip';
import type { Env, Variables } from '../env';

export const orders = new Hono<{ Bindings: Env; Variables: Variables }>();

orders.use('*', supabaseAuth);

// Roles allowed to place an order from the POS. Coordinator/finance use the
// Backend portal — their `staff.showroom_id` is NULL so a POS submission would
// silently fall back to the alphabetically-first showroom (migration 0006
// failsafe). Reject early so the bug doesn't compound when a 2nd showroom
// opens. CLAUDE.md "POS is sales-only" formalised at the auth boundary.
const POS_ORDER_ROLES = new Set(['sales', 'showroom_lead', 'admin']);
const COORDINATOR_ROLES = new Set(['coordinator', 'finance', 'admin']);

function mimeFromKey(key: string): SlipMime {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'pdf': return 'application/pdf';
    default: throw new Error(`unknown slip extension: ${key}`);
  }
}

orders.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const supabaseForRole = c.get('supabase');
  const userId = c.get('user').id;
  const staffRes = await supabaseForRole
    .from('staff')
    .select('role, active')
    .eq('id', userId)
    .maybeSingle();
  if (staffRes.error) {
    return c.json({ error: 'role_lookup_failed', reason: staffRes.error.message }, 500);
  }
  if (!staffRes.data || !staffRes.data.active) {
    return c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403);
  }
  if (!POS_ORDER_ROLES.has(staffRes.data.role)) {
    return c.json({
      error: 'wrong_portal',
      reason: 'POS order placement is sales-only. Coordinator/finance: use the Backend portal.',
      role: staffRes.data.role,
    }, 403);
  }

  const parsed = orderV1PostSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'validation_failed',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      400,
    );
  }
  const dto = parsed.data;
  const supabase = supabaseForRole;

  // Gather every distinct productId in the cart, fetch product + per-product
  // pricing rows in parallel. RLS scopes everything to authenticated staff.
  const productIds = Array.from(new Set(dto.lines.map((l) => l.config.productId)));

  const [productsRes, compartmentsRes, bundlesRes, sizesRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, pricing_kind, flat_price, recliner_upgrade_price')
      .in('id', productIds),
    supabase
      .from('product_compartments')
      .select('product_id, compartment_id, active, price')
      .in('product_id', productIds),
    supabase
      .from('product_bundles')
      .select('product_id, bundle_id, active, price')
      .in('product_id', productIds),
    supabase
      .from('product_size_variants')
      .select('product_id, size_id, active, price')
      .in('product_id', productIds),
  ]);

  for (const r of [productsRes, compartmentsRes, bundlesRes, sizesRes]) {
    if (r.error) return c.json({ error: 'pricing_fetch_failed', reason: r.error.message }, 500);
  }

  const products = productsRes.data ?? [];
  const compartments = compartmentsRes.data ?? [];
  const bundles = bundlesRes.data ?? [];
  const sizes = sizesRes.data ?? [];

  // Build per-product ServerProductInfo for the shared recompute.
  const infoById = new Map<string, ServerProductInfo>();
  for (const p of products) {
    infoById.set(p.id, {
      productId: p.id,
      pricingKind: p.pricing_kind,
      flatPrice: p.flat_price,
      sofa: p.pricing_kind === 'sofa_build' ? {
        reclinerUpgradePrice: p.recliner_upgrade_price ?? 0,
        compartments: compartments
          .filter((r) => r.product_id === p.id)
          .map((r) => ({ compartmentId: r.compartment_id, active: r.active, price: r.price })),
        bundles: bundles
          .filter((r) => r.product_id === p.id)
          .map((r) => ({ bundleId: r.bundle_id, active: r.active, price: r.price })),
      } : undefined,
      sizes: p.pricing_kind === 'size_variants'
        ? sizes
            .filter((r) => r.product_id === p.id)
            .map((r) => ({ sizeId: r.size_id, active: r.active, price: r.price }))
        : undefined,
    });
  }

  // Run the shared recompute. Any catalog mismatch throws OrderPricingError → 422.
  const lineInputs: OrderLineInput[] = dto.lines.map((l) => ({ qty: l.qty, config: l.config }));
  let totals;
  try {
    totals = computeOrderTotal(lineInputs, infoById);
  } catch (err) {
    if (err instanceof OrderPricingError) {
      return c.json({ error: 'pricing_invalid', detail: err.detail }, 422);
    }
    throw err;
  }

  // Drift check (>0.5%) — the contract that protects "honest pricing".
  if (pricingDriftExceeds(dto.clientTotal, totals.total)) {
    return c.json({
      error: 'pricing_drift',
      clientTotal: dto.clientTotal,
      serverTotal: totals.total,
      lines: totals.lines.map((l, i) => ({
        qty: l.qty,
        productId: l.productId,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        breakdown: l.breakdown,
        // Mirror the client's submitted line config so the modal can show
        // exactly which line moved.
        clientConfig: dto.lines[i]?.config,
      })),
    }, 409);
  }

  // Hand the authoritative numbers to the RPC for atomic insert.
  const rpcPayload = {
    customerName: dto.customer.name,
    customerPhone: dto.customer.phone ?? '',
    customerEmail: dto.customer.email ?? '',
    customerAddress: dto.customer.address ?? '',
    customerPostcode: dto.customer.postcode ?? '',
    customerCity: dto.customer.city ?? '',
    customerState: dto.customer.state ?? '',
    paymentMethod: dto.paymentMethod,
    approvalCode: dto.approvalCode ?? '',
    notes: dto.notes ?? '',
    subtotal: totals.subtotal,
    addonTotal: totals.addonTotal,
    total: totals.total,
    paid: 0,
    lines: totals.lines.map((l) => ({
      productId: l.productId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      config: l.configJson,
    })),
    // Slip MVP — null when not transfer or no session
    uploadSessionId: dto.uploadSessionId ?? null,
  };

  const { data, error } = await supabase.rpc('create_order_with_items', { p: rpcPayload });
  if (error) {
    const msg = error.message ?? '';
    // Slip-specific RAISE EXCEPTION codes from migration 0010
    if (msg.includes('slip_required_for_transfer'))    return c.json({ error: 'slip_required_for_transfer' }, 400);
    if (msg.includes('slip_not_ready'))                return c.json({ error: 'slip_not_ready' }, 409);
    if (msg.includes('slip_session_not_found'))        return c.json({ error: 'slip_session_not_found' }, 404);
    if (msg.includes('not_session_owner'))             return c.json({ error: 'not_session_owner' }, 403);
    if (error.code === '42501' || /permission denied/i.test(msg)) {
      return c.json({ error: 'forbidden', reason: msg }, 403);
    }
    if (/unauthenticated/i.test(msg)) {
      return c.json({ error: 'unauthorized', reason: msg }, 401);
    }
    return c.json({ error: 'create_failed', reason: msg }, 500);
  }

  // computeOrderTotal preserves input order, so totals.lines[i] aligns with
  // dto.lines[i]. The kind is read from dto.lines so the response shape stays
  // stable even if pricing.ts internals evolve (cells vs bundleId branches).
  return c.json({
    id: data as string,
    subtotal: totals.subtotal,
    total: totals.total,
    lines: totals.lines.map((l, i) => ({
      productId: l.productId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      kind: dto.lines[i]?.config.kind ?? 'unknown',
    })),
  }, 201);
});

// ─── Coordinator slip endpoints ────────────────────────────────────────────
// Authorization is enforced inline by checking staff.role; only coordinator+
// roles can read slip URLs or verify/flag.

async function loadStaffRole(c: any): Promise<string | null> {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const { data, error } = await supabase
    .from('staff')
    .select('role, active')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data || !data.active) return null;
  return data.role;
}

orders.get('/:id/slip-url', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const supabase = c.get('supabase');
  const bindings = slipBindings(c.env);

  const { data: row, error } = await supabase
    .from('orders')
    .select('slip_key')
    .eq('id', orderId)
    .maybeSingle();

  if (error) return c.json({ error: 'db_fetch_failed', detail: error.message }, 500);
  if (!row) return c.json({ error: 'order_not_found' }, 404);
  if (!row.slip_key) return c.json({ error: 'no_slip_attached' }, 400);

  const contentType = mimeFromKey(row.slip_key);
  const url = await presign({
    bucket: bindings.bucketName,
    region: 'auto',
    accessKeyId: bindings.accessKeyId,
    secretAccessKey: bindings.secretAccessKey,
    endpoint: bindings.endpoint,
    key: row.slip_key,
    method: 'GET',
    expiresInSeconds: 5 * 60,
  });

  return c.json({
    url,
    contentType,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
});

const VALID_LANES = new Set(['received', 'proceed', 'logistics', 'ready', 'dispatched', 'delivered', 'cancelled']);

orders.patch('/:id/lane', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const staffId = c.get('user').id;
  const supabase = c.get('supabase');

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const lane = body?.lane;
  if (typeof lane !== 'string' || !VALID_LANES.has(lane)) {
    return c.json({ error: 'invalid_lane' }, 400);
  }

  // Block 'dispatched' / 'delivered' until driver feature ships.
  if (lane === 'dispatched' || lane === 'delivered') {
    return c.json({ error: 'lane_not_yet_supported', detail: 'driver assignment not yet built' }, 400);
  }

  const { data: row, error: fetchErr } = await supabase
    .from('orders')
    .select('lane')
    .eq('id', orderId)
    .maybeSingle();
  if (fetchErr) return c.json({ error: 'db_fetch_failed', detail: fetchErr.message }, 500);
  if (!row) return c.json({ error: 'order_not_found' }, 404);

  const fromLane = row.lane;
  const { error: updateErr } = await supabase
    .from('orders')
    .update({ lane })
    .eq('id', orderId);
  if (updateErr) return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);

  await supabase.from('order_lane_history').insert({
    order_id: orderId,
    from_lane: fromLane,
    to_lane: lane,
    changed_by: staffId,
  });

  return c.json({ orderId, lane, fromLane });
});

orders.patch('/:id/slip', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !COORDINATOR_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const orderId = c.req.param('id');
  const staffId = c.get('user').id;
  const supabase = c.get('supabase');

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const parsed = SlipVerifyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'reason_required', issues: parsed.error.issues }, 400);
  }

  const { data: row, error: fetchErr } = await supabase
    .from('orders')
    .select('id, slip_state')
    .eq('id', orderId)
    .maybeSingle();

  if (fetchErr) return c.json({ error: 'db_fetch_failed', detail: fetchErr.message }, 500);
  if (!row) return c.json({ error: 'order_not_found' }, 404);
  if (row.slip_state !== 'pending') {
    return c.json({ error: 'invalid_state', currentSlipState: row.slip_state }, 400);
  }

  const now = new Date().toISOString();
  const updateFields = parsed.data.state === 'verified'
    ? { slip_state: 'verified', slip_verified_by: staffId, slip_verified_at: now, slip_flag_reason: null }
    : { slip_state: 'flagged',  slip_verified_by: staffId, slip_verified_at: now, slip_flag_reason: parsed.data.reason };

  const { error: updateErr } = await supabase
    .from('orders')
    .update(updateFields)
    .eq('id', orderId);
  if (updateErr) return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);

  await supabase.from('order_slip_events').insert({
    order_id: orderId,
    event: parsed.data.state,
    actor_id: staffId,
    meta: parsed.data.state === 'flagged' ? { reason: parsed.data.reason } : {},
  });

  return c.json({
    orderId,
    slipState: parsed.data.state,
    slipVerifiedBy: staffId,
    slipVerifiedAt: now,
  });
});

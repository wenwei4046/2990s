import { Hono } from 'hono';
import { orderV1PostSchema } from '@2990s/shared/schemas';
import {
  computeOrderTotal,
  pricingDriftExceeds,
  OrderPricingError,
  type ServerProductInfo,
  type OrderLineInput,
} from '@2990s/shared/pricing';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const orders = new Hono<{ Bindings: Env; Variables: Variables }>();

orders.use('*', supabaseAuth);

// Roles allowed to place an order from the POS. Coordinator/finance use the
// Backend portal — their `staff.showroom_id` is NULL so a POS submission would
// silently fall back to the alphabetically-first showroom (migration 0006
// failsafe). Reject early so the bug doesn't compound when a 2nd showroom
// opens. CLAUDE.md "POS is sales-only" formalised at the auth boundary.
const POS_ORDER_ROLES = new Set(['sales', 'showroom_lead', 'admin']);

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
  };

  const { data, error } = await supabase.rpc('create_order_with_items', { p: rpcPayload });
  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    if (/unauthenticated/i.test(error.message)) {
      return c.json({ error: 'unauthorized', reason: error.message }, 401);
    }
    return c.json({ error: 'create_failed', reason: error.message }, 500);
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

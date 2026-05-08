import { Hono } from 'hono';
import { orderV1PostSchema, type OrderLineDto } from '@2990s/shared/schemas';
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

orders.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
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

  const supabase = c.get('supabase');

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

  return c.json({
    id: data as string,
    subtotal: totals.subtotal,
    total: totals.total,
    lines: totals.lines.map((l, i) => ({
      productId: l.productId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      kind: lineKind(dto.lines[i]),
    })),
  }, 201);
});

const lineKind = (l: OrderLineDto | undefined): string => l?.config.kind ?? 'unknown';

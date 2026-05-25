import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';

export const quotes = new Hono<{ Bindings: Env; Variables: Variables }>();

quotes.use('*', supabaseAuth);

const QUOTE_PRICING_VERSION = 'v1';

// GET /quotes — list open quotes (RLS scopes: sales own, coordinator+/showroom_lead all relevant).
// "Open" = not yet promoted to an order.
quotes.get('/', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('quotes')
    .select(
      'id, created_by, showroom_id, customer_name, customer_phone, customer_email, cart, addons, subtotal, addon_total, total, pricing_version, expires_at, promoted_to_order_id, created_at, updated_at',
    )
    .is('promoted_to_order_id', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    return c.json({ error: 'db_fetch_failed', detail: error.message }, 500);
  }
  return c.json({ quotes: data ?? [] });
});

// POST /quotes — save current cart as a quote.
// id is generated server-side (TEXT column with no default in the existing schema).
quotes.post('/', async (c) => {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const customerName = String(body?.customerName ?? '').trim();
  const customerPhone = body?.customerPhone ? String(body.customerPhone).trim() : null;
  const customerEmail = body?.customerEmail ? String(body.customerEmail).trim() : null;
  const cart = body?.cart ?? body?.lines;
  const subtotal = Number(body?.subtotal);
  const total = Number(body?.total);

  if (!customerName) return c.json({ error: 'missing_customer_name' }, 400);
  if (!Array.isArray(cart) || cart.length === 0) {
    return c.json({ error: 'missing_cart' }, 400);
  }
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return c.json({ error: 'invalid_subtotal' }, 400);
  }
  if (!Number.isFinite(total) || total < 0) {
    return c.json({ error: 'invalid_total' }, 400);
  }

  // Resolve the showroom this quote belongs to.
  //
  // Sales / showroom_lead: their own staff.showroom_id (RLS enforces match).
  // Admin / coordinator / finance: staff.showroom_id is NULL by design (per
  // CLAUDE.md "coordinators with NULL oversee all showrooms"), but
  // quotes.showroom_id is NOT NULL. Fall back to the first active showroom by
  // sort_order so elevated roles can still save quotes when dogfooding the POS.
  // The RLS policy already allows is_coordinator_or_above() to insert with any
  // showroom_id, so this fallback isn't a privilege escalation.
  const { data: staffRow, error: staffErr } = await supabase
    .from('staff')
    .select('showroom_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (staffErr) {
    return c.json({ error: 'db_fetch_failed', detail: staffErr.message }, 500);
  }
  let showroomId: string | null = staffRow?.showroom_id ?? null;
  const elevatedRoles = new Set(['admin', 'coordinator', 'finance']);
  if (!showroomId && staffRow?.role && elevatedRoles.has(staffRow.role)) {
    const { data: defaultRoom } = await supabase
      .from('showrooms')
      .select('id')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    showroomId = defaultRoom?.id ?? null;
  }
  if (!showroomId) {
    return c.json({ error: 'staff_showroom_missing' }, 400);
  }

  const id = `QU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      id,
      created_by: userId,
      showroom_id: showroomId,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: customerEmail,
      cart,
      addons: [],
      subtotal: Math.round(subtotal),
      addon_total: 0,
      total: Math.round(total),
      pricing_version: QUOTE_PRICING_VERSION,
    })
    .select('id, customer_name, total, created_at')
    .maybeSingle();

  if (error) {
    return c.json({ error: 'db_insert_failed', detail: error.message }, 500);
  }
  return c.json({ quote: data }, 201);
});

// PATCH /quotes/:id — update an OPEN quote's cart in place (sales own; RLS-scoped
// by quotes_update). Used when a loaded quote is edited and re-saved, so the
// salesperson doesn't re-enter the customer name and spawn a duplicate quote.
// Customer name/phone are intentionally left untouched (the cart is what changes).
// PATCH (not PUT) because the CORS allowlist already permits it and it's a
// partial update.
quotes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const cart = body?.cart ?? body?.lines;
  const subtotal = Number(body?.subtotal);
  const total = Number(body?.total);
  if (!Array.isArray(cart) || cart.length === 0) {
    return c.json({ error: 'missing_cart' }, 400);
  }
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return c.json({ error: 'invalid_subtotal' }, 400);
  }
  if (!Number.isFinite(total) || total < 0) {
    return c.json({ error: 'invalid_total' }, 400);
  }

  const { data, error } = await supabase
    .from('quotes')
    .update({
      cart,
      subtotal: Math.round(subtotal),
      total: Math.round(total),
    })
    .eq('id', id)
    .is('promoted_to_order_id', null) // never edit an already-converted quote
    .select('id, customer_name, total, updated_at')
    .maybeSingle();

  if (error) {
    return c.json({ error: 'db_update_failed', detail: error.message }, 500);
  }
  if (!data) {
    // RLS-denied, missing, or already promoted to an order.
    return c.json({ error: 'not_found_or_converted' }, 404);
  }
  return c.json({ quote: data });
});

// DELETE /quotes/:id — sales delete own (RLS-scoped).
quotes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { error } = await supabase.from('quotes').delete().eq('id', id);
  if (error) {
    return c.json({ error: 'db_delete_failed', detail: error.message }, 500);
  }
  return c.json({ ok: true });
});

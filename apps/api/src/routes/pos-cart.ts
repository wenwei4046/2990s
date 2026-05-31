// ----------------------------------------------------------------------------
// /pos-cart — the salesperson's live in-progress cart (WS1).
//
// Chairman 2026-05-31: the in-progress cart moves from POS localStorage to the
// DB (pos_carts) so it (a) follows the salesperson across devices and (b) does
// NOT bleed to the next person on a shared tablet — it is loaded by the
// logged-in staff_id, not by device storage. One open cart per staff.
//
//   GET /pos-cart   — the caller's cart ({ lines, sourceQuoteId } or empty)
//   PUT /pos-cart   — upsert the caller's cart (debounced write-through)
//
// Row ownership enforced by RLS (staff_id = auth.uid(), migration 0118).
// A saved/finalized cart already persists as a quote or order; this is only the
// live working cart.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const posCart = new Hono<{ Bindings: Env; Variables: Variables }>();

posCart.use('*', supabaseAuth);

type Row = {
  staff_id: string;
  lines: unknown[];
  source_quote_id: string | null;
  updated_at: string;
};

// ── GET / ──────────────────────────────────────────────────────────────
// The caller's single cart row (empty cart if none yet).
posCart.get('/', async (c) => {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const { data, error } = await supabase
    .from('pos_carts')
    .select('staff_id, lines, source_quote_id, updated_at')
    .eq('staff_id', userId)
    .maybeSingle();

  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  if (!data) return c.json({ lines: [], sourceQuoteId: null });
  const r = data as unknown as Row;
  return c.json({ lines: r.lines ?? [], sourceQuoteId: r.source_quote_id, updatedAt: r.updated_at });
});

// ── PUT / ──────────────────────────────────────────────────────────────
// Upsert the caller's single cart row. body: { lines: CartLine[], sourceQuoteId?: string|null }.
posCart.put('/', async (c) => {
  let body: { lines?: unknown; sourceQuoteId?: string | null };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!Array.isArray(body.lines)) return c.json({ error: 'lines_required' }, 400);

  const supabase = c.get('supabase');
  const userId = c.get('user').id;

  const { error } = await supabase
    .from('pos_carts')
    .upsert(
      {
        staff_id: userId,
        lines: body.lines,
        source_quote_id: body.sourceQuoteId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'staff_id' },
    );

  if (error) {
    if (error.code === '42501' || /permission denied/i.test(error.message)) {
      return c.json({ error: 'forbidden', reason: error.message }, 403);
    }
    return c.json({ error: 'save_failed', reason: error.message }, 500);
  }
  return c.body(null, 204);
});

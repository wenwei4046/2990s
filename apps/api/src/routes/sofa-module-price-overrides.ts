// ----------------------------------------------------------------------------
// /sofa-module-price-overrides — stop-gap selling prices for sofa module SKUs
// the Houzs catalogue serves as null (migration 0213).
//
// ⚠️ THIS ROUTE IS ORIGIN-GATED, NOT AUTHENTICATED — same posture, same
// reasoning, and the same limits as /campaign-promos. Read that file's header
// before extending either. In short: since the 2026-07-21 cutover the POS holds
// only a Houzs-minted token, 2990's supabaseAuth validates against 2990's own
// GoTrue, and there is no token exchange — so a Houzs bearer sent here gets a
// flat 401. The gate is an allow-listed `Origin` plus the service-role client,
// which blocks internet-wide scanning but NOT anyone with curl.
//
// WHAT THAT COSTS HERE, stated plainly: someone who can forge a header can set
// a sofa module's price. That is a smaller surface than it sounds, because an
// override CANNOT lower what a customer is charged:
//   · it only fills a null catalogue price — a real one always wins;
//   · the money is still recomputed server-side by Houzs, and the drift gate
//     rejects any order whose tablet total disagrees with it. A bogus override
//     makes orders FAIL, it does not make them cheap.
// Worst case is therefore nuisance: sofas that will not sell until the row is
// corrected or deleted. Both are visible and reversible from the admin tab.
//
// If a real auth path ever exists (a Houzs token-verify endpoint, or the POS
// re-pointed at 2990), swap the gate for `supabaseAuth` + a role check and
// delete this comment.
//
// WHERE THE NUMBERS COME FROM: a pricing_drift 400 names the SKU, the tablet's
// total and the server's. The gap is the missing module's price. See 0213's
// header for the worked Uborr example. Nobody should be inventing figures here.
// ----------------------------------------------------------------------------
import { Hono } from 'hono';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Env, Variables } from '../env';

export const sofaModulePriceOverrides = new Hono<{ Bindings: Env; Variables: Variables }>();

const originAllowed = (c: {
  req: { header: (k: string) => string | undefined };
  env: { ALLOWED_ORIGINS: string };
}): boolean => {
  const origin = c.req.header('origin');
  if (!origin) return false;
  return c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin);
};

sofaModulePriceOverrides.use('*', async (c, next) => {
  if (!originAllowed(c)) {
    return c.json({ error: 'forbidden', reason: 'origin_not_allowed' }, 403);
  }
  await next();
});

const admin = (c: { env: Env }): SupabaseClient =>
  createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/* Column whitelist, not a spread — the service-role client bypasses RLS, so
   this function is the only thing between the table and the internet. */
const toWire = (r: Record<string, unknown>) => ({
  itemCode:       String(r.item_code ?? ''),
  sellPriceCenti: Number(r.sell_price_centi ?? 0),
  note:           String(r.note ?? ''),
  createdAt:      String(r.created_at ?? ''),
  updatedAt:      String(r.updated_at ?? ''),
});

const upsertSchema = z.object({
  /* Module SKU codes carry parens — 'UBORR-L(RHF)'. Bounded and trimmed, but
     deliberately not pattern-matched: the code space is Houzs's, and rejecting
     a shape we merely haven't seen would be a worse failure than storing a row
     that matches nothing (which is inert — the merge is a lookup by key). */
  sellPriceCenti: z.number().int().positive(),
  note:           z.string().max(500).default(''),
});

// ── GET / — every override. Small table; the POS caches it alongside the catalogue. ──
sofaModulePriceOverrides.get('/', async (c) => {
  const { data, error } = await admin(c)
    .from('sofa_module_price_overrides')
    .select('*')
    .order('item_code', { ascending: true });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ overrides: (data ?? []).map(toWire) });
});

/* PUT /:itemCode — upsert. Idempotent by primary key so re-entering a figure
   after a second drift rejection just corrects the row, which is exactly the
   workflow: reject → read the server's number → save → retry. */
sofaModulePriceOverrides.put('/:itemCode', async (c) => {
  const itemCode = c.req.param('itemCode').trim();
  if (!itemCode) return c.json({ error: 'item_code_required' }, 400);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 422);
  }

  const { data, error } = await admin(c)
    .from('sofa_module_price_overrides')
    .upsert({
      item_code:        itemCode,
      sell_price_centi: parsed.data.sellPriceCenti,
      note:             parsed.data.note,
      updated_at:       new Date().toISOString(),
    }, { onConflict: 'item_code' })
    .select('*')
    .maybeSingle();
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ override: toWire((data ?? {}) as Record<string, unknown>) });
});

/* DELETE /:itemCode — revert this SKU to catalogue-only pricing. The escape
   hatch when an override turns out to be wrong: delete, and the Model behaves
   exactly as it did before anyone touched it. */
sofaModulePriceOverrides.delete('/:itemCode', async (c) => {
  const itemCode = c.req.param('itemCode').trim();
  if (!itemCode) return c.json({ error: 'item_code_required' }, 400);
  const { error } = await admin(c)
    .from('sofa_module_price_overrides')
    .delete()
    .eq('item_code', itemCode);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

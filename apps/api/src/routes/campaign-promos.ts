// ----------------------------------------------------------------------------
// /campaign-promos — fixed-value marketing vouchers (migration 0212).
//
// ⚠️ THIS ROUTE IS ORIGIN-GATED, NOT AUTHENTICATED. Read this before extending it.
//
// Every other route in this API runs `supabaseAuth`, which validates the bearer
// against 2990's own Supabase GoTrue. This one cannot. Since the 2026-07-21
// cutover the POS builds against HouzsERP and holds ONLY a Houzs-minted token
// (apps/pos/src/lib/auth.tsx) — 2990 and Houzs do not share an identity space
// (2990 keys on auth.users.id, Houzs on scm.staff.id), so a Houzs bearer sent
// here gets a flat 401. There is no token exchange and no shared secret.
//
// So the gate is the same one on GET /pos/sales-staff: require an allow-listed
// `Origin`, and run everything on the service-role client.
//
// BE HONEST ABOUT WHAT THAT BUYS. `Origin` is browser-set and unforgeable by
// page JavaScript, so this blocks internet-wide scanning and casual scripted
// access. It does NOT stop anyone with curl. Which means: **anyone who can
// forge a header can create campaigns and drain voucher stock.**
//
// Judged proportionate because no money moves through here. The actual
// discount is applied as mfg_sales_order_items.discount_centi on the HOUZS
// order, which any POS-tablet user can already author within
// `0 <= discount <= qty * unit` — this table is the definition and the ledger,
// not the till. Worst case is nuisance: fake campaigns, or stock burned to
// zero. Both are visible in campaign_promo_redemptions and reversible.
//
// If a real auth path ever exists (a Houzs token-verify endpoint, or the POS
// re-pointed at 2990), swap the gate for `supabaseAuth` + a role check and
// delete this comment. Do not build anything financially load-bearing on top
// of it in the meantime.
// ----------------------------------------------------------------------------
import { Hono } from 'hono';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Env, Variables } from '../env';

export const campaignPromos = new Hono<{ Bindings: Env; Variables: Variables }>();

const originAllowed = (c: {
  req: { header: (k: string) => string | undefined };
  env: { ALLOWED_ORIGINS: string };
}): boolean => {
  const origin = c.req.header('origin');
  if (!origin) return false;
  return c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin);
};

campaignPromos.use('*', async (c, next) => {
  if (!originAllowed(c)) {
    return c.json({ error: 'forbidden', reason: 'origin_not_allowed' }, 403);
  }
  await next();
});

const admin = (c: { env: Env }): SupabaseClient =>
  createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/* Wire shape. Columns are whitelisted rather than spread — the service-role
   client bypasses RLS, so this function is the only thing standing between the
   table and the internet. `remaining` is derived so callers never have to do
   the subtraction (and can't get it wrong). */
const toWire = (r: Record<string, unknown>) => ({
  id:              String(r.id),
  name:            String(r.name ?? ''),
  valueCenti:      Number(r.value_centi ?? 0),
  stockTotal:      Number(r.stock_total ?? 0),
  stockUsed:       Number(r.stock_used ?? 0),
  remaining:       Math.max(0, Number(r.stock_total ?? 0) - Number(r.stock_used ?? 0)),
  minPurchaseQty:  Number(r.min_purchase_qty ?? 0),
  maxPerOrder:     Number(r.max_per_order ?? 1),
  terms:           String(r.terms ?? ''),
  active:          Boolean(r.active),
  createdAt:       String(r.created_at ?? ''),
  updatedAt:       String(r.updated_at ?? ''),
});

const upsertSchema = z.object({
  name:           z.string().min(1).max(120),
  valueCenti:     z.number().int().positive(),
  stockTotal:     z.number().int().min(0),
  minPurchaseQty: z.number().int().min(0).default(0),
  maxPerOrder:    z.number().int().min(1).default(1),
  terms:          z.string().max(8000).default(''),
  active:         z.boolean().default(false),
});

// ── GET / — list campaigns. ?activeOnly=1 for the cart; admin tab omits it. ──
campaignPromos.get('/', async (c) => {
  const sb = admin(c);
  let q = sb.from('campaign_promos').select('*').order('created_at', { ascending: false });
  if (c.req.query('activeOnly') === '1') q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ campaigns: (data ?? []).map(toWire) });
});

campaignPromos.post('/', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 422);
  }
  const v = parsed.data;
  const { data, error } = await admin(c)
    .from('campaign_promos')
    .insert({
      name: v.name, value_centi: v.valueCenti, stock_total: v.stockTotal,
      min_purchase_qty: v.minPurchaseQty, max_per_order: v.maxPerOrder,
      terms: v.terms, active: v.active,
    })
    .select('*')
    .maybeSingle();
  if (error) return c.json({ error: 'create_failed', reason: error.message }, 500);
  return c.json({ campaign: toWire((data ?? {}) as Record<string, unknown>) }, 201);
});

/* PATCH — partial. stock_used is deliberately NOT patchable: the ledger is the
   only thing allowed to move it, so a stray edit can't silently un-spend
   vouchers that were really issued. Replenish by RAISING stockTotal. */
campaignPromos.patch('/:id', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = upsertSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 422);
  }
  const v = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.name           !== undefined) patch.name             = v.name;
  if (v.valueCenti     !== undefined) patch.value_centi      = v.valueCenti;
  if (v.stockTotal     !== undefined) patch.stock_total      = v.stockTotal;
  if (v.minPurchaseQty !== undefined) patch.min_purchase_qty = v.minPurchaseQty;
  if (v.maxPerOrder    !== undefined) patch.max_per_order    = v.maxPerOrder;
  if (v.terms          !== undefined) patch.terms            = v.terms;
  if (v.active         !== undefined) patch.active           = v.active;

  const { data, error } = await admin(c)
    .from('campaign_promos').update(patch).eq('id', c.req.param('id')).select('*').maybeSingle();
  if (error) {
    // 0212's CHECK (stock_used <= stock_total) fires when someone tries to cut
    // stock below what has already gone out. That's a refusal, not a bug.
    const conflict = /campaign_promos_stock_sane/.test(error.message);
    return c.json(
      { error: conflict ? 'stock_below_used' : 'update_failed', reason: error.message },
      conflict ? 409 : 500,
    );
  }
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ campaign: toWire(data as Record<string, unknown>) });
});

/* POST /:id/claim — reserve one voucher. Delegates to claim_campaign_promo(),
   where the stock re-check and the increment are ONE statement, so two
   salespeople cannot both take the last one. Returns 409 when sold out or
   inactive — callers MUST treat that as a refusal and not apply the discount.

   This is phase 1 of two. The order goes to Houzs next; call /confirm on
   success or /release on failure. A row left RESERVED is a claim whose order
   never landed — sweep those, don't assume they were spent. */
campaignPromos.post('/:id/claim', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { /* body optional */ }

  const { data, error } = await admin(c).rpc('claim_campaign_promo', {
    p_campaign_id:      c.req.param('id'),
    p_applied_centi:    Math.max(0, Math.trunc(Number(body.appliedCenti ?? 0))),
    p_redeemed_by:      body.redeemedBy ? String(body.redeemedBy) : null,
    p_redeemed_by_name: body.redeemedByName ? String(body.redeemedByName) : null,
  });
  if (error) {
    if (/campaign_unavailable/.test(error.message)) {
      return c.json({ error: 'campaign_unavailable', reason: 'sold out or inactive' }, 409);
    }
    return c.json({ error: 'claim_failed', reason: error.message }, 500);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return c.json({ error: 'claim_failed', reason: 'no row returned' }, 500);
  return c.json({
    redemptionId:  String(row.id),
    appliedCenti:  Number(row.applied_centi ?? 0),
    termsSnapshot: String(row.terms_snapshot ?? ''),
  }, 201);
});

/* POST /redemptions/:id/confirm — phase 2. Stamp the Houzs doc no + customer
   snapshot once the order actually landed. Customer details are copied rather
   than referenced because that record lives in Houzs; there is nothing here to
   join to, and copying is what removes the sales team's manual matching. */
campaignPromos.post('/redemptions/:id/confirm', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { /* optional */ }
  const soDocNo = String(body.soDocNo ?? '').trim();
  if (!soDocNo) return c.json({ error: 'so_doc_no_required' }, 400);

  const { data, error } = await admin(c)
    .from('campaign_promo_redemptions')
    .update({
      status: 'APPLIED',
      so_doc_no: soDocNo,
      customer_name:  body.customerName  ? String(body.customerName)  : null,
      customer_phone: body.customerPhone ? String(body.customerPhone) : null,
      /* applied_centi is deliberately NOT settable here. It is fixed at claim
         time, where claim_campaign_promo() clamps it to the campaign's own
         value_centi — one enforcement point instead of two. The POS already
         knows the final figure before it claims (it runs the split first, then
         claims, then submits), and Houzs's drift gate stops the order total
         from silently differing. Accepting it again here would reopen the cap with
         no campaign row in hand to check against. */
      updated_at: new Date().toISOString(),
    })
    .eq('id', c.req.param('id'))
    .eq('status', 'RESERVED')   // never resurrect a RELEASED claim
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: 'confirm_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_reserved', reason: 'already confirmed, released, or unknown' }, 409);
  return c.json({ ok: true });
});

/* POST /redemptions/:id/release — put the voucher back. Idempotent: a row
   already RELEASED returns ok:false rather than refunding stock twice.

   TWO CALLERS, BOTH DELIBERATE:
     · voucher-submit.ts, when the Houzs order fails after the claim.
     · the admin ledger's Release button, by hand.

   ⚠️ There is NO release-on-cancel, and there cannot be one on this side. An
   earlier version of this comment said the flow mirrored `pwpVoucherReleased`;
   it does not. That one lives INSIDE the SO cancel handler
   (mfg-sales-orders.ts:7001), which for POS orders runs in Houzs — and Houzs
   has never heard of campaign_promo_redemptions and has no route back here (no
   sync in either direction since the 2026-07-21 cutover). So a cancelled order
   leaves its row APPLIED and its stock spent until a human releases it. The
   admin ledger says so on screen; don't "fix" it with a client-side hook that
   only fires when the POS happens to be the thing doing the cancelling. */
campaignPromos.post('/redemptions/:id/release', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { /* optional */ }
  const { data, error } = await admin(c).rpc('release_campaign_promo', {
    p_redemption_id: c.req.param('id'),
    p_reason: body.reason ? String(body.reason) : null,
  });
  if (error) return c.json({ error: 'release_failed', reason: error.message }, 500);
  return c.json({ ok: Boolean(data) });
});

// ── GET /redemptions — the ledger. ?campaignId= to scope, ?docNo= to look up. ──
campaignPromos.get('/redemptions', async (c) => {
  const sb = admin(c);
  let q = sb
    .from('campaign_promo_redemptions')
    .select('id, campaign_id, status, applied_centi, so_doc_no, customer_name, customer_phone, redeemed_by_name, terms_snapshot, released_at, release_reason, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  const campaignId = c.req.query('campaignId');
  const docNo = c.req.query('docNo');
  if (campaignId) q = q.eq('campaign_id', campaignId);
  if (docNo) q = q.eq('so_doc_no', docNo);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ redemptions: data ?? [] });
});

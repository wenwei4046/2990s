// ----------------------------------------------------------------------------
// /marketing — storage behind the POS Marketing section: the showroom list,
// what is on display in each showroom, each showroom's floor plan, and the
// new-product launch board.
//
// Owner 2026-10-08 ("Marketing 展厅陈列系统"). The POS screens are
// apps/pos/src/pages/Marketing.tsx; the tables are migrations 0217 + 0218.
// The showroom list is the POS's own since 0218 (owner 2026-10-09: a record,
// not Houzs's venue master), so every write that files something under a
// showroom first checks that showroom is still listed.
//
// ── AUTHORIZATION ───────────────────────────────────────────────────────────
// The caller is a POS tablet holding a HOUZS session, so — exactly like
// /commission — the bearer is replayed to Houzs /auth/me and Houzs's own answer
// decides (lib/houzs-identity.ts). NOT the Origin gate campaign-promos uses: a
// forged Origin header must not be able to empty a showroom's display list.
//
// Who may use it is the SAME rule the POS uses to show the section:
//   · the marketing account (`isMarketingMember`, @2990s/shared/marketing-access), OR
//   · the Maintain tier. The POS asks that of the member's derived role
//     (sales_director / super_admin) or Houzs's `scm_config_writer`; this side
//     cannot see the role, so it asks the facts Houzs DOES put on /auth/me for
//     the same people — the `*` wildcard, `scm_config_writer`, or the director
//     capability `scm.sales.viewAll`. Slightly wider (a Finance Manager is a
//     Houzs director), never narrower, so nobody who sees the page is refused.
//
// Everything runs on the SERVICE-ROLE client — no RLS policy can see a Houzs
// identity — so the zod schemas and the `*ToWire` mappers are the only things
// between these tables and the internet. Whitelist columns; never spread a row.
// ----------------------------------------------------------------------------

import { Hono, type Context } from 'hono';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isMarketingMember, SALES_VIEW_ALL_CAP } from '@2990s/shared/marketing-access';
import { bearerOf, resolveHouzsCaller, type HouzsCaller } from '../lib/houzs-identity';
import type { Env, Variables } from '../env';

export const marketing = new Hono<{ Bindings: Env; Variables: Variables }>();

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const admin = (c: Ctx): SupabaseClient =>
  createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const issues = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path, message: i.message }));

/** May this Houzs caller use the Marketing section? See the header. */
export const canUseMarketing = (caller: HouzsCaller): boolean =>
  isMarketingMember(caller)
  || caller.permissions.includes('*')
  || caller.scmConfigWriter
  || caller.capabilities[SALES_VIEW_ALL_CAP] === true;

/** The label a person is snapshotted under on a launch request. */
const roleLabel = (caller: HouzsCaller): string =>
  isMarketingMember(caller) ? 'Marketing' : (caller.positionName?.trim() || 'Staff');

async function gate(c: Ctx): Promise<{ ok: true; caller: HouzsCaller } | { ok: false; res: Response }> {
  const r = await resolveHouzsCaller(bearerOf(c.req), c.env.HOUZS_API_ROOT, c.env.HOUZS_COMPANY_ID);
  if (!r.ok) return { ok: false, res: c.json({ error: 'unauthenticated', reason: r.reason }, r.status) };
  if (!canUseMarketing(r.caller)) {
    return { ok: false, res: c.json({ error: 'forbidden', reason: 'not_marketing' }, 403) };
  }
  return { ok: true, caller: r.caller };
}

const readBody = async (c: Ctx): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> => {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false, res: c.json({ error: 'invalid_json' }, 400) };
  }
};

/* ── shared field rules ───────────────────────────────────────────────────── */

const short = z.string().trim().max(120);
const moduleCode = z.string().trim().min(1).max(40);
const modules = z.array(moduleCode).max(30);
const venueId = z.string().trim().min(1).max(64);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres unique_violation. */
const isDuplicate = (e: { code?: string } | null): boolean => e?.code === '23505';

/* ── showrooms (0218) ─────────────────────────────────────────────────────── */

const SHOWROOM_SELECT = 'id, name, area';

const showroomToWire = (r: Record<string, unknown>) => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  area: String(r.area ?? ''),
});

const showroomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  // Where it is, as the rail prints it under the name ('Petaling Jaya, Selangor').
  area: z.string().trim().max(120).optional().default(''),
});

/** A display, floor plan or request may only be filed under a showroom that
 *  is still listed. The foreign keys stop an id that never existed; this stops
 *  one that was removed, and says so plainly instead of failing an insert. */
async function listedShowroom(c: Ctx, sb: SupabaseClient, id: string): Promise<Response | null> {
  const { data, error } = await sb
    .from('marketing_showrooms')
    .select('id')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'unknown_showroom', reason: 'This showroom is no longer on the list.' }, 409);
  return null;
}

/* ── displays ─────────────────────────────────────────────────────────────── */

const DISPLAY_SELECT =
  'id, venue_id, type, model_id, name, code, photo_url, is_new, fabric, colour, leg, seat, ' +
  'modules, size, height, divan, gap, qty, created_at, created_by_name';

const displayToWire = (r: Record<string, unknown>) => ({
  id: String(r.id),
  venueId: String(r.venue_id),
  type: String(r.type),
  modelId: r.model_id == null ? null : String(r.model_id),
  name: String(r.name ?? ''),
  code: String(r.code ?? ''),
  photoUrl: r.photo_url == null ? null : String(r.photo_url),
  isNew: r.is_new === true,
  fabric: String(r.fabric ?? ''),
  colour: String(r.colour ?? ''),
  leg: String(r.leg ?? ''),
  seat: String(r.seat ?? ''),
  modules: Array.isArray(r.modules) ? (r.modules as unknown[]).map(String) : [],
  size: String(r.size ?? ''),
  height: String(r.height ?? ''),
  divan: String(r.divan ?? ''),
  gap: String(r.gap ?? ''),
  qty: Number(r.qty ?? 1),
  createdAt: String(r.created_at ?? ''),
  createdByName: r.created_by_name == null ? null : String(r.created_by_name),
});

const displayCreateSchema = z.object({
  venueId,
  type: z.enum(['sofa', 'mattress', 'bedframe', 'accessory']),
  modelId: z.string().trim().max(64).nullable().optional(),
  name: short.min(1),
  code: short.optional().default(''),
  photoUrl: z.string().trim().max(2000).nullable().optional(),
  fabric: short.optional().default(''),
  colour: short.optional().default(''),
  leg: short.optional().default(''),
  seat: short.optional().default(''),
  modules: modules.optional().default([]),
  size: short.optional().default(''),
  height: short.optional().default(''),
  divan: short.optional().default(''),
  gap: short.optional().default(''),
  qty: z.number().int().min(1).max(999).optional().default(1),
}).superRefine((v, ctx) => {
  // A sofa on the floor is its compartments; one with none is not a display.
  if (v.type === 'sofa' && v.modules.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modules'], message: 'A sofa needs its components.' });
  }
});

/* ── launch requests ──────────────────────────────────────────────────────── */

const REQUEST_SELECT =
  'id, type, status, supplier_code, model, fabric, colour, leg, seat, size, height, divan, gap, ' +
  'modules, combo_rows, venue_id, action, replace_display_id, requested_by_name, requested_by_role, created_at, updated_at';

type ComboRow = { modules: string[]; price: number | null };

const rowsToWire = (raw: unknown): ComboRow[] =>
  Array.isArray(raw)
    ? raw.map((x) => {
        const o = (x ?? {}) as { modules?: unknown; price?: unknown };
        const price = typeof o.price === 'number' && Number.isFinite(o.price) ? o.price : null;
        return { modules: Array.isArray(o.modules) ? o.modules.map(String) : [], price };
      })
    : [];

const requestToWire = (r: Record<string, unknown>) => ({
  id: String(r.id),
  type: String(r.type),
  status: String(r.status),
  supplierCode: String(r.supplier_code ?? ''),
  model: String(r.model ?? ''),
  fabric: String(r.fabric ?? ''),
  colour: String(r.colour ?? ''),
  leg: String(r.leg ?? ''),
  seat: String(r.seat ?? ''),
  size: String(r.size ?? ''),
  height: String(r.height ?? ''),
  divan: String(r.divan ?? ''),
  gap: String(r.gap ?? ''),
  modules: Array.isArray(r.modules) ? (r.modules as unknown[]).map(String) : [],
  rows: rowsToWire(r.combo_rows),
  venueId: String(r.venue_id),
  action: String(r.action),
  replaceId: r.replace_display_id == null ? null : String(r.replace_display_id),
  by: r.requested_by_name == null ? '' : String(r.requested_by_name),
  byRole: r.requested_by_role == null ? '' : String(r.requested_by_role),
  createdAt: String(r.created_at ?? ''),
  updatedAt: String(r.updated_at ?? ''),
});

const comboRow = z.object({
  modules: modules,
  // Whole RM, reference only. null = not typed yet (a pending request may
  // carry a combo without its price).
  price: z.number().min(0).max(10_000_000).nullable(),
});

const requestBodySchema = z.object({
  type: z.enum(['sofa', 'mattress', 'bedframe']),
  status: z.enum(['pending', 'completed']),
  supplierCode: short.optional().default(''),
  model: short.optional().default(''),
  fabric: short.optional().default(''),
  colour: short.optional().default(''),
  leg: short.optional().default(''),
  seat: short.optional().default(''),
  size: short.optional().default(''),
  height: short.optional().default(''),
  divan: short.optional().default(''),
  gap: short.optional().default(''),
  modules: modules.optional().default([]),
  rows: z.array(comboRow).max(30).optional().default([]),
  // Required to SAVE at all (design: "Only the showroom and Add / Replace are
  // required to save — the rest can be completed later").
  venueId,
  action: z.enum(['add', 'replace']),
  replaceId: z.string().regex(UUID_RE).nullable().optional(),
});
type RequestBody = z.infer<typeof requestBodySchema>;

/** The display a Replace points at must be live, at the same showroom, and of
 *  the same category — the form only offers those, so anything else is a
 *  hand-rolled request. Completing a Replace needs one; a pending Replace may
 *  still be waiting for its showroom to have a candidate. */
async function checkReplaceTarget(
  sb: SupabaseClient,
  b: RequestBody,
): Promise<string | null> {
  if (b.action !== 'replace') return null;
  if (!b.replaceId) return b.status === 'completed' ? 'Choose the piece this replaces.' : null;
  const { data, error } = await sb
    .from('marketing_displays')
    .select('id, venue_id, type, removed_at')
    .eq('id', b.replaceId)
    .maybeSingle();
  if (error) return `Could not check the piece to replace: ${error.message}`;
  const d = data as { venue_id?: string; type?: string; removed_at?: string | null } | null;
  if (!d || d.removed_at) return 'The piece to replace is no longer on display.';
  if (d.venue_id !== b.venueId || d.type !== b.type) return 'The piece to replace must be a same-category piece at that showroom.';
  return null;
}

const requestColumns = (b: RequestBody) => ({
  type: b.type,
  status: b.status,
  supplier_code: b.supplierCode,
  model: b.model,
  fabric: b.fabric,
  colour: b.colour,
  leg: b.leg,
  seat: b.seat,
  size: b.size,
  height: b.height,
  divan: b.divan,
  gap: b.gap,
  modules: b.modules,
  combo_rows: b.rows,
  venue_id: b.venueId,
  action: b.action,
  replace_display_id: b.action === 'replace' ? (b.replaceId ?? null) : null,
});

/* ── floor plans ──────────────────────────────────────────────────────────── */

const FLOORPLAN_MAX_BYTES = 3 * 1024 * 1024;
const floorplanSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  dataB64: z.string().min(16).max(Math.ceil((FLOORPLAN_MAX_BYTES * 4) / 3) + 8).regex(/^[A-Za-z0-9+/]+=*$/),
  fileName: z.string().trim().max(200).optional().default(''),
});

/** Decoded size of a base64 payload, without decoding it. */
const b64Bytes = (b64: string): number => {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
};

/* ════════════════════════════════════════════════════════════════════════════
   Routes
   ════════════════════════════════════════════════════════════════════════════ */

/** Everything the Marketing page draws, in one read: the showroom list, the
 *  live displays of every showroom, the open launch requests, and which
 *  showrooms have a floor plan (the image itself is fetched per showroom). */
marketing.get('/state', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const sb = admin(c);
  const [showrooms, displays, requests, plans] = await Promise.all([
    sb.from('marketing_showrooms').select(SHOWROOM_SELECT).is('archived_at', null).order('name', { ascending: true }),
    sb.from('marketing_displays').select(DISPLAY_SELECT).is('removed_at', null).order('created_at', { ascending: true }),
    sb.from('marketing_launch_requests').select(REQUEST_SELECT).in('status', ['pending', 'completed']).order('created_at', { ascending: false }),
    sb.from('marketing_floorplans').select('venue_id, updated_at, file_name'),
  ]);
  const failed = showrooms.error ?? displays.error ?? requests.error ?? plans.error;
  if (failed) return c.json({ error: 'fetch_failed', reason: failed.message }, 500);
  return c.json({
    showrooms: ((showrooms.data ?? []) as unknown as Record<string, unknown>[]).map(showroomToWire),
    displays: ((displays.data ?? []) as unknown as Record<string, unknown>[]).map(displayToWire),
    requests: ((requests.data ?? []) as unknown as Record<string, unknown>[]).map(requestToWire),
    floorplans: ((plans.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      venueId: String(r.venue_id),
      updatedAt: String(r.updated_at ?? ''),
      fileName: String(r.file_name ?? ''),
    })),
  });
});

/** Add a showroom to the list. */
marketing.post('/showrooms', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = showroomSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const { data, error } = await admin(c)
    .from('marketing_showrooms')
    .insert({
      name: parsed.data.name,
      area: parsed.data.area,
      created_by: String(g.caller.userId),
      created_by_name: g.caller.name,
      updated_by: String(g.caller.userId),
      updated_by_name: g.caller.name,
    })
    .select(SHOWROOM_SELECT)
    .single();
  if (isDuplicate(error)) {
    return c.json({ error: 'duplicate_name', reason: `There is already a showroom called ${parsed.data.name}.` }, 409);
  }
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ showroom: showroomToWire(data as unknown as Record<string, unknown>) }, 201);
});

/** Rename a showroom, or change where it says it is. */
marketing.patch('/showrooms/:id', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const id = venueId.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = showroomSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const { data, error } = await admin(c)
    .from('marketing_showrooms')
    .update({
      name: parsed.data.name,
      area: parsed.data.area,
      updated_at: new Date().toISOString(),
      updated_by: String(g.caller.userId),
      updated_by_name: g.caller.name,
    })
    .eq('id', id.data)
    .is('archived_at', null)
    .select(SHOWROOM_SELECT)
    .maybeSingle();
  if (isDuplicate(error)) {
    return c.json({ error: 'duplicate_name', reason: `There is already a showroom called ${parsed.data.name}.` }, 409);
  }
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found', reason: 'This showroom is no longer on the list.' }, 404);
  return c.json({ showroom: showroomToWire(data as unknown as Record<string, unknown>) });
});

/** Remove a showroom from the list: stamps archived_at, the row stays. Refused
 *  while it still has a piece on display or an open launch request, so nothing
 *  live is left under a showroom the screen no longer shows. */
marketing.delete('/showrooms/:id', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const id = venueId.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const sb = admin(c);
  const [displays, requests] = await Promise.all([
    sb.from('marketing_displays').select('id', { count: 'exact', head: true }).eq('venue_id', id.data).is('removed_at', null),
    sb.from('marketing_launch_requests').select('id', { count: 'exact', head: true }).eq('venue_id', id.data).in('status', ['pending', 'completed']),
  ]);
  const failed = displays.error ?? requests.error;
  if (failed) return c.json({ error: 'fetch_failed', reason: failed.message }, 500);
  const pieces = displays.count ?? 0;
  const open = requests.count ?? 0;
  if (pieces || open) {
    const what = [
      pieces ? `${pieces} piece${pieces === 1 ? '' : 's'} on display` : '',
      open ? `${open} open launch request${open === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');
    return c.json({
      error: 'showroom_in_use',
      reason: `This showroom still has ${what}. Clear ${pieces + open === 1 ? 'it' : 'them'} first.`,
    }, 409);
  }
  const { data, error } = await sb
    .from('marketing_showrooms')
    .update({ archived_at: new Date().toISOString(), archived_by: String(g.caller.userId), archived_by_name: g.caller.name })
    .eq('id', id.data)
    .is('archived_at', null)
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found', reason: 'This showroom is no longer on the list.' }, 404);
  return c.json({ ok: true });
});

marketing.post('/displays', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = displayCreateSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const v = parsed.data;
  const sb = admin(c);
  const unlisted = await listedShowroom(c, sb, v.venueId);
  if (unlisted) return unlisted;
  const { data, error } = await sb
    .from('marketing_displays')
    .insert({
      venue_id: v.venueId,
      type: v.type,
      model_id: v.modelId ?? null,
      name: v.name,
      code: v.code,
      photo_url: v.photoUrl ?? null,
      is_new: false,
      fabric: v.fabric,
      colour: v.colour,
      leg: v.leg,
      seat: v.seat,
      modules: v.modules,
      size: v.size,
      height: v.height,
      divan: v.divan,
      gap: v.gap,
      qty: v.qty,
      created_by: String(g.caller.userId),
      created_by_name: g.caller.name,
    })
    .select(DISPLAY_SELECT)
    .single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ display: displayToWire(data as unknown as Record<string, unknown>) }, 201);
});

/** "Remove from display" — stamps removed_at; the row stays as history. */
marketing.delete('/displays/:id', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404);
  const { data, error } = await admin(c)
    .from('marketing_displays')
    .update({ removed_at: new Date().toISOString(), removed_by: String(g.caller.userId), removed_by_name: g.caller.name })
    .eq('id', id)
    .is('removed_at', null)
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found', reason: 'This piece is no longer on display.' }, 404);
  return c.json({ ok: true });
});

marketing.get('/floorplans/:venueId', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const { data, error } = await admin(c)
    .from('marketing_floorplans')
    .select('venue_id, content_type, image_b64, file_name, updated_at')
    .eq('venue_id', c.req.param('venueId'))
    .maybeSingle();
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  const r = data as unknown as Record<string, unknown>;
  return c.json({
    floorplan: {
      venueId: String(r.venue_id),
      dataUrl: `data:${String(r.content_type)};base64,${String(r.image_b64)}`,
      fileName: String(r.file_name ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    },
  });
});

/** Upload or Replace a showroom's floor plan. */
marketing.put('/floorplans/:venueId', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const vid = venueId.safeParse(c.req.param('venueId'));
  if (!vid.success) return c.json({ error: 'validation_failed', issues: issues(vid.error) }, 400);
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = floorplanSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const bytes = b64Bytes(parsed.data.dataB64);
  if (bytes <= 0 || bytes > FLOORPLAN_MAX_BYTES) {
    return c.json({ error: 'too_large', reason: 'The floor plan image is larger than 3 MB.' }, 413);
  }
  const sb = admin(c);
  const unlisted = await listedShowroom(c, sb, vid.data);
  if (unlisted) return unlisted;
  const { data, error } = await sb
    .from('marketing_floorplans')
    .upsert({
      venue_id: vid.data,
      content_type: parsed.data.contentType,
      image_b64: parsed.data.dataB64,
      byte_size: bytes,
      file_name: parsed.data.fileName,
      uploaded_by: String(g.caller.userId),
      uploaded_by_name: g.caller.name,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'venue_id' })
    .select('venue_id, updated_at, file_name')
    .single();
  if (error) return c.json({ error: 'upsert_failed', reason: error.message }, 500);
  const r = data as unknown as Record<string, unknown>;
  return c.json({ floorplan: { venueId: String(r.venue_id), updatedAt: String(r.updated_at ?? ''), fileName: String(r.file_name ?? '') } });
});

marketing.delete('/floorplans/:venueId', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const { error } = await admin(c).from('marketing_floorplans').delete().eq('venue_id', c.req.param('venueId'));
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

marketing.post('/requests', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = requestBodySchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const sb = admin(c);
  const unlisted = await listedShowroom(c, sb, parsed.data.venueId);
  if (unlisted) return unlisted;
  const bad = await checkReplaceTarget(sb, parsed.data);
  if (bad) return c.json({ error: 'invalid_replace', reason: bad }, 409);
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('marketing_launch_requests')
    .insert({
      ...requestColumns(parsed.data),
      requested_by: String(g.caller.userId),
      requested_by_name: g.caller.name,
      requested_by_role: roleLabel(g.caller),
      updated_by: String(g.caller.userId),
      updated_by_name: g.caller.name,
      completed_at: parsed.data.status === 'completed' ? nowIso : null,
    })
    .select(REQUEST_SELECT)
    .single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ request: requestToWire(data as unknown as Record<string, unknown>) }, 201);
});

/** Fill in / Edit. Only an open request (pending or completed) can change. */
marketing.put('/requests/:id', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404);
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = requestBodySchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const sb = admin(c);
  const unlisted = await listedShowroom(c, sb, parsed.data.venueId);
  if (unlisted) return unlisted;
  const bad = await checkReplaceTarget(sb, parsed.data);
  if (bad) return c.json({ error: 'invalid_replace', reason: bad }, 409);
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('marketing_launch_requests')
    .update({
      ...requestColumns(parsed.data),
      updated_at: nowIso,
      updated_by: String(g.caller.userId),
      updated_by_name: g.caller.name,
      completed_at: parsed.data.status === 'completed' ? nowIso : null,
    })
    .eq('id', id)
    .in('status', ['pending', 'completed'])
    .select(REQUEST_SELECT)
    .maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found', reason: 'This request has already arrived or been deleted.' }, 404);
  return c.json({ request: requestToWire(data as unknown as Record<string, unknown>) });
});

/** "Delete request" — leaves the board; nothing changes on the display. */
marketing.delete('/requests/:id', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404);
  const nowIso = new Date().toISOString();
  const { data, error } = await admin(c)
    .from('marketing_launch_requests')
    .update({ status: 'deleted', deleted_at: nowIso, deleted_by: String(g.caller.userId), deleted_by_name: g.caller.name, updated_at: nowIso })
    .eq('id', id)
    .in('status', ['pending', 'completed'])
    .select('id')
    .maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found', reason: 'This request has already arrived or been deleted.' }, 404);
  return c.json({ ok: true });
});

/** "Arrive" — the piece reaches the showroom: it goes on the floor, the piece
 *  it replaces comes off, and the request leaves the board. One transaction
 *  (marketing_arrive_launch_request, migration 0217). */
marketing.post('/requests/:id/arrive', async (c) => {
  const g = await gate(c);
  if (!g.ok) return g.res;
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) return c.json({ error: 'not_found' }, 404);
  const { data, error } = await admin(c).rpc('marketing_arrive_launch_request', {
    p_request_id: id,
    p_by: String(g.caller.userId),
    p_by_name: g.caller.name,
  });
  if (error) {
    if (/request_not_found/.test(error.message)) return c.json({ error: 'not_found' }, 404);
    if (/request_not_completed/.test(error.message)) {
      return c.json({ error: 'not_completed', reason: 'Only a request in Completed Info can arrive.' }, 409);
    }
    return c.json({ error: 'arrive_failed', reason: error.message }, 500);
  }
  const r = (data ?? {}) as { displayId?: unknown; removedName?: unknown };
  return c.json({
    displayId: r.displayId == null ? null : String(r.displayId),
    removedName: r.removedName == null ? null : String(r.removedName),
  });
});

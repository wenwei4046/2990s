// ----------------------------------------------------------------------------
// /commission — the commission SCHEME: rates, salespeople, KPI rules, override
// ladder, and the frozen record of a closed payout period.
//
// Loo 2026-08-31: "我要直接废除掉 Houzs 那边的 commission 机制，所有的
// commission 机制只会在 POS 这边去算". This is the storage half of that. The
// ARITHMETIC is `@2990s/shared/hr-commission`; the CALCULATION runs in the POS,
// which is the only place that can read both this config and the Houzs orders.
//
// ── WHY IT IS NOT THE EXISTING /hr ROUTE ────────────────────────────────────
// That one is bound to `supabaseAuth` end to end: it reads `c.get('user').id`
// and runs on the RLS-scoped client. Its caller is the Backend portal, which
// still works and which nobody has asked to change. Retrofitting a second
// identity into it would put the live payroll page one mistake away from a
// regression, for no benefit. This route is the module that survives; /hr is
// legacy and can be retired with the Backend.
//
// ── AUTHORIZATION ───────────────────────────────────────────────────────────
// The caller is a POS tablet holding a HOUZS session, so the gate is Houzs's own
// answer: the bearer is replayed to Houzs `/auth/me` and checked for
// `scm.hr.read` (any GET) or `scm.hr.manage` (every write) — the keys Loo chose,
// enforced by the system that issues them. See lib/houzs-identity.ts for why
// this is NOT the Origin gate campaign-promos uses: that one's own header says
// "do not build anything financially load-bearing on top of it", and a
// commission rate is exactly that.
//
// Everything runs on the SERVICE-ROLE client, because no RLS policy can see a
// Houzs identity. So `toWire` and the zod schemas are the only things between
// these tables and the internet — whitelist columns, never spread a row.
//
// ── STORED IN CENTI, RATES IN BPS ───────────────────────────────────────────
// Integers, both. This file does no arithmetic on either; it stores and returns.
// ----------------------------------------------------------------------------

import { Hono, type Context } from 'hono';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { COMMISSION_ENGINE_VERSION } from '@2990s/shared/hr-commission';
import {
  HR_MANAGE, HR_READ, bearerOf, callerHas, resolveHouzsCaller, type HouzsCaller,
} from '../lib/houzs-identity';
import type { Env, Variables } from '../env';

export const commission = new Hono<{ Bindings: Env; Variables: Variables }>();

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

const admin = (c: Ctx): SupabaseClient =>
  createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const issues = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path, message: i.message }));

/** Resolve + authorise in one step. Every handler starts with this. */
async function gate(
  c: Ctx,
  perm: string,
): Promise<{ ok: true; caller: HouzsCaller } | { ok: false; res: Response }> {
  const r = await resolveHouzsCaller(
    bearerOf(c.req),
    c.env.HOUZS_API_ROOT,
    c.env.HOUZS_COMPANY_ID,
  );
  if (!r.ok) {
    return { ok: false, res: c.json({ error: 'unauthenticated', reason: r.reason }, r.status) };
  }
  if (!callerHas(r.caller, perm)) {
    return {
      ok: false,
      res: c.json({ error: 'forbidden', reason: `missing ${perm}` }, 403),
    };
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

/* ── config ───────────────────────────────────────────────────────────────── */

const CONFIG_SELECT =
  'base_bps, personal_kpi_threshold_centi, personal_kpi_bonus_bps, ' +
  'showroom_kpi_threshold_centi, showroom_kpi_bonus_bps, ' +
  'override_base_bps, override_kpi_bonus_bps, override_mode, updated_at';

const configToWire = (r: Record<string, unknown>) => ({
  baseBps: Number(r.base_bps),
  personalKpiThresholdCenti: Number(r.personal_kpi_threshold_centi),
  personalKpiBonusBps: Number(r.personal_kpi_bonus_bps),
  showroomKpiThresholdCenti: Number(r.showroom_kpi_threshold_centi),
  showroomKpiBonusBps: Number(r.showroom_kpi_bonus_bps),
  overrideBaseBps: Number(r.override_base_bps),
  overrideKpiBonusBps: Number(r.override_kpi_bonus_bps),
  overrideMode: String(r.override_mode ?? 'showroom'),
  updatedAt: r.updated_at ? String(r.updated_at) : undefined,
});

commission.get('/config', async (c) => {
  const g = await gate(c, HR_READ);
  if (!g.ok) return g.res;
  const { data, error } = await admin(c)
    .from('hr_commission_config').select(CONFIG_SELECT).eq('id', 1).maybeSingle();
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  /* A missing config row is an ERROR, never a zeroed default. RM 0 is a
     legitimate commission (sold nothing); it must not also be how this module
     says "I do not know what the rates are". */
  if (!data) {
    return c.json(
      { error: 'config_missing', reason: 'No commission rate settings exist yet.' },
      409,
    );
  }
  return c.json({ config: configToWire(data as unknown as Record<string, unknown>) });
});

const configPatchSchema = z.object({
  baseBps: z.number().int().nonnegative().optional(),
  personalKpiThresholdCenti: z.number().int().nonnegative().optional(),
  personalKpiBonusBps: z.number().int().nonnegative().optional(),
  showroomKpiThresholdCenti: z.number().int().nonnegative().optional(),
  showroomKpiBonusBps: z.number().int().nonnegative().optional(),
  overrideBaseBps: z.number().int().nonnegative().optional(),
  overrideKpiBonusBps: z.number().int().nonnegative().optional(),
  overrideMode: z.enum(['showroom', 'chain']).optional(),
});

commission.patch('/config', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = configPatchSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const sb = admin(c);

  /* Switching TO chain mode with no ladder configured would hand every manager
     a RM 0 override and look exactly like a correct answer. Refuse at the door,
     so the config can never be left in a state the report cannot honour. */
  if (parsed.data.overrideMode === 'chain') {
    const { data, error } = await sb
      .from('hr_override_levels').select('id').eq('active', true).limit(1);
    if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
    if (!data || data.length === 0) {
      return c.json({
        error: 'no_override_levels',
        reason: 'Reporting-chain mode needs at least one override level configured, otherwise every manager would earn RM 0 override. Add the levels first, then switch the mode.',
      }, 409);
    }
  }

  const d = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.baseBps !== undefined) patch.base_bps = d.baseBps;
  if (d.personalKpiThresholdCenti !== undefined) patch.personal_kpi_threshold_centi = d.personalKpiThresholdCenti;
  if (d.personalKpiBonusBps !== undefined) patch.personal_kpi_bonus_bps = d.personalKpiBonusBps;
  if (d.showroomKpiThresholdCenti !== undefined) patch.showroom_kpi_threshold_centi = d.showroomKpiThresholdCenti;
  if (d.showroomKpiBonusBps !== undefined) patch.showroom_kpi_bonus_bps = d.showroomKpiBonusBps;
  if (d.overrideBaseBps !== undefined) patch.override_base_bps = d.overrideBaseBps;
  if (d.overrideKpiBonusBps !== undefined) patch.override_kpi_bonus_bps = d.overrideKpiBonusBps;
  if (d.overrideMode !== undefined) patch.override_mode = d.overrideMode;

  const { data, error } = await sb
    .from('hr_commission_config').update(patch).eq('id', 1).select(CONFIG_SELECT).maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'config_missing' }, 409);
  return c.json({ config: configToWire(data as unknown as Record<string, unknown>) });
});

/* ── pickers ──────────────────────────────────────────────────────────────── */
/* Showrooms only, and from 2990's OWN table.
   Houzs's `scm.showrooms` is the vendored 2990 table and is EMPTY over there —
   their own staff route says so ("the legacy showroomId, which points at the
   vendored 2990 scm.showrooms table (empty in Houzs)"). So a showroom picker fed
   from Houzs would offer nothing, which is why the HR module there was never
   usable. The commission scheme lives here now, and so does its showroom list.
   Every OTHER picker the Setup screen needs — staff, products, fabrics, special
   add-ons — is live catalogue data the POS already loads from Houzs, so it is
   read there rather than duplicated into this response. */
commission.get('/pickers', async (c) => {
  const g = await gate(c, HR_READ);
  if (!g.ok) return g.res;
  const { data, error } = await admin(c)
    .from('showrooms').select('id, name').eq('active', true).order('name');
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({
    showrooms: ((data ?? []) as unknown as Record<string, unknown>[])
      .map((r) => ({ id: String(r.id), name: String(r.name ?? '') })),
  });
});

/* ── salespeople on the scheme ────────────────────────────────────────────── */
/* staff_id and showroom_id hold HOUZS ids and carry NO foreign key — those rows
   live in another database (migration 0215). The names are snapshotted on write
   because there is nothing to join to, and because a payslip should keep saying
   what it said when it was approved. */

const PROFILE_SELECT =
  'id, staff_id, staff_name, staff_code, tier, showroom_id, showroom_name, active';

const profileToWire = (r: Record<string, unknown>) => ({
  id: String(r.id),
  staffId: String(r.staff_id),
  staffName: String(r.staff_name ?? ''),
  staffCode: String(r.staff_code ?? ''),
  tier: String(r.tier),
  showroomId: String(r.showroom_id),
  showroomName: String(r.showroom_name ?? ''),
  active: Boolean(r.active),
});

commission.get('/profiles', async (c) => {
  const g = await gate(c, HR_READ);
  if (!g.ok) return g.res;
  const { data, error } = await admin(c)
    .from('hr_salesperson_profiles').select(PROFILE_SELECT).order('staff_name');
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({ profiles: ((data ?? []) as unknown as Record<string, unknown>[]).map(profileToWire) });
});

const profileCreateSchema = z.object({
  staffId: z.string().min(1),
  staffName: z.string().default(''),
  staffCode: z.string().default(''),
  tier: z.enum(['sales', 'manager']).default('sales'),
  showroomId: z.string().min(1),
  showroomName: z.string().default(''),
  active: z.boolean().default(true),
});

commission.post('/profiles', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = profileCreateSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const d = parsed.data;
  const { data, error } = await admin(c)
    .from('hr_salesperson_profiles')
    .insert({
      staff_id: d.staffId, staff_name: d.staffName, staff_code: d.staffCode,
      tier: d.tier, showroom_id: d.showroomId, showroom_name: d.showroomName,
      active: d.active,
    })
    .select(PROFILE_SELECT).single();
  if (error) {
    if (error.code === '23505') {
      return c.json({ error: 'duplicate_staff', reason: 'this salesperson is already on the scheme — edit their row instead' }, 409);
    }
    return c.json({ error: 'create_failed', reason: error.message }, 500);
  }
  return c.json({ profile: profileToWire(data as unknown as Record<string, unknown>) }, 201);
});

const profilePatchSchema = z.object({
  tier: z.enum(['sales', 'manager']).optional(),
  showroomId: z.string().min(1).optional(),
  showroomName: z.string().optional(),
  active: z.boolean().optional(),
});

commission.patch('/profiles/:id', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = profilePatchSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const d = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.tier !== undefined) patch.tier = d.tier;
  if (d.showroomId !== undefined) patch.showroom_id = d.showroomId;
  if (d.showroomName !== undefined) patch.showroom_name = d.showroomName;
  if (d.active !== undefined) patch.active = d.active;
  const { data, error } = await admin(c)
    .from('hr_salesperson_profiles').update(patch).eq('id', c.req.param('id'))
    .select(PROFILE_SELECT).maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ profile: profileToWire(data as unknown as Record<string, unknown>) });
});

commission.delete('/profiles/:id', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const { error } = await admin(c)
    .from('hr_salesperson_profiles').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

/* ── item KPI rules ───────────────────────────────────────────────────────── */

const ITEM_KPI_SELECT = 'id, flag_type, ref, label, bonus_centi, counts_as_revenue, active';

const itemKpiToWire = (r: Record<string, unknown>) => ({
  id: String(r.id),
  flagType: String(r.flag_type),
  ref: String(r.ref),
  label: String(r.label ?? ''),
  bonusCenti: Number(r.bonus_centi ?? 0),
  /* THE 2026-08-31 OPTION. False = the original rule (earn the fixed amount
     INSTEAD of the percentage on the flagged portion). True = earn both. */
  countsAsRevenue: Boolean(r.counts_as_revenue),
  active: Boolean(r.active),
});

commission.get('/item-kpi', async (c) => {
  const g = await gate(c, HR_READ);
  if (!g.ok) return g.res;
  const { data, error } = await admin(c)
    .from('hr_item_kpi').select(ITEM_KPI_SELECT).order('created_at');
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({ items: ((data ?? []) as unknown as Record<string, unknown>[]).map(itemKpiToWire) });
});

const FLAG_TYPES = ['product', 'category', 'fabric', 'special'] as const;

const itemKpiCreateSchema = z.object({
  flagType: z.enum(FLAG_TYPES),
  ref: z.string().min(1),
  label: z.string().default(''),
  bonusCenti: z.number().int().nonnegative(),
  countsAsRevenue: z.boolean().default(false),
  active: z.boolean().default(true),
});

commission.post('/item-kpi', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = itemKpiCreateSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const d = parsed.data;
  const { data, error } = await admin(c)
    .from('hr_item_kpi')
    .insert({
      flag_type: d.flagType, ref: d.ref, label: d.label,
      bonus_centi: d.bonusCenti, counts_as_revenue: d.countsAsRevenue, active: d.active,
    })
    .select(ITEM_KPI_SELECT).single();
  if (error) return c.json({ error: 'create_failed', reason: error.message }, 500);
  return c.json({ item: itemKpiToWire(data as unknown as Record<string, unknown>) }, 201);
});

const itemKpiPatchSchema = z.object({
  label: z.string().optional(),
  bonusCenti: z.number().int().nonnegative().optional(),
  countsAsRevenue: z.boolean().optional(),
  active: z.boolean().optional(),
});

/* `flagType` and `ref` are deliberately not patchable: repointing a rule in
   place silently re-aims an existing bonus at a different product. Delete and
   re-add, so the change is visible as one. */
commission.patch('/item-kpi/:id', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = itemKpiPatchSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const d = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.label !== undefined) patch.label = d.label;
  if (d.bonusCenti !== undefined) patch.bonus_centi = d.bonusCenti;
  if (d.countsAsRevenue !== undefined) patch.counts_as_revenue = d.countsAsRevenue;
  if (d.active !== undefined) patch.active = d.active;
  const { data, error } = await admin(c)
    .from('hr_item_kpi').update(patch).eq('id', c.req.param('id'))
    .select(ITEM_KPI_SELECT).maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ item: itemKpiToWire(data as unknown as Record<string, unknown>) });
});

commission.delete('/item-kpi/:id', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const { error } = await admin(c).from('hr_item_kpi').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

/* ── chain-mode override ladder ───────────────────────────────────────────── */

const LEVEL_SELECT = 'id, level, rate_bps, label, active';

const levelToWire = (r: Record<string, unknown>) => ({
  id: String(r.id),
  level: Number(r.level),
  rateBps: Number(r.rate_bps ?? 0),
  label: String(r.label ?? ''),
  active: Boolean(r.active),
});

commission.get('/override-levels', async (c) => {
  const g = await gate(c, HR_READ);
  if (!g.ok) return g.res;
  const { data, error } = await admin(c)
    .from('hr_override_levels').select(LEVEL_SELECT).order('level');
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({ levels: ((data ?? []) as unknown as Record<string, unknown>[]).map(levelToWire) });
});

const levelCreateSchema = z.object({
  level: z.number().int().min(1),
  rateBps: z.number().int().nonnegative(),
  label: z.string().default(''),
  active: z.boolean().default(true),
});

commission.post('/override-levels', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = levelCreateSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const d = parsed.data;
  const { data, error } = await admin(c)
    .from('hr_override_levels')
    .insert({ level: d.level, rate_bps: d.rateBps, label: d.label, active: d.active })
    .select(LEVEL_SELECT).single();
  if (error) {
    // UNIQUE (level): two rows for level 2 would make "the level 2 rate"
    // ambiguous, i.e. a payout nobody can predict.
    if (error.code === '23505') {
      return c.json({ error: 'duplicate_level', reason: 'this level already has a rate — edit it instead' }, 409);
    }
    return c.json({ error: 'create_failed', reason: error.message }, 500);
  }
  return c.json({ level: levelToWire(data as unknown as Record<string, unknown>) }, 201);
});

/* `level` itself is NOT patchable — renumbering a rung in place silently
   repoints an existing rate at a different set of people. */
const levelPatchSchema = z.object({
  rateBps: z.number().int().nonnegative().optional(),
  label: z.string().optional(),
  active: z.boolean().optional(),
});

commission.patch('/override-levels/:id', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = levelPatchSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const d = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.rateBps !== undefined) patch.rate_bps = d.rateBps;
  if (d.label !== undefined) patch.label = d.label;
  if (d.active !== undefined) patch.active = d.active;
  const { data, error } = await admin(c)
    .from('hr_override_levels').update(patch).eq('id', c.req.param('id'))
    .select(LEVEL_SELECT).maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ level: levelToWire(data as unknown as Record<string, unknown>) });
});

commission.delete('/override-levels/:id', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const { error } = await admin(c).from('hr_override_levels').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

/* ── payout periods ───────────────────────────────────────────────────────── */
/* A period recomputes from CURRENT rates every time it is opened, so editing one
   rate silently rewrites every past payout. Closing a period stores the rows as
   they stood; the report then SERVES them instead of recomputing.
   ⚠️ rows_json is CLIENT-AUTHORED — the calculation runs in the POS, because
   that is the only place the Houzs orders can be read. What is frozen here is
   therefore a record of WHAT THE APPROVER WAS LOOKING AT, which is what a
   payout approval is. It is evidence, not an independent derivation. */

const PERIOD_SELECT =
  'id, period_from, period_to, revision, status, engine_version, total_centi, row_count, ' +
  'rows_json, closed_by_name, closed_at, reopened_by_name, reopened_at, reopen_reason';

const periodToWire = (r: Record<string, unknown>) => ({
  id: String(r.id),
  from: String(r.period_from),
  to: String(r.period_to),
  revision: Number(r.revision ?? 1),
  status: String(r.status),
  engineVersion: String(r.engine_version ?? ''),
  totalCenti: Number(r.total_centi ?? 0),
  rowCount: Number(r.row_count ?? 0),
  rows: Array.isArray(r.rows_json) ? r.rows_json : [],
  closedByName: r.closed_by_name ? String(r.closed_by_name) : null,
  closedAt: r.closed_at ? String(r.closed_at) : null,
  reopenedByName: r.reopened_by_name ? String(r.reopened_by_name) : null,
  reopenedAt: r.reopened_at ? String(r.reopened_at) : null,
  reopenReason: r.reopen_reason ? String(r.reopen_reason) : null,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

commission.get('/payout/periods', async (c) => {
  const g = await gate(c, HR_READ);
  if (!g.ok) return g.res;
  const from = c.req.query('from');
  const to = c.req.query('to');
  let q = admin(c).from('hr_payout_periods').select(PERIOD_SELECT)
    .order('period_from', { ascending: false }).limit(60);
  // Both bounds or neither — a half-specified range would silently widen.
  if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to)) {
    q = q.eq('period_from', from).eq('period_to', to);
  }
  const { data, error } = await q;
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({ periods: ((data ?? []) as unknown as Record<string, unknown>[]).map(periodToWire) });
});

const closeSchema = z.object({
  from: z.string().regex(ISO_DATE),
  to: z.string().regex(ISO_DATE),
  totalCenti: z.number().int(),
  rows: z.array(z.unknown()),
});

commission.post('/payout/close', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = closeSchema.safeParse(b.body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const d = parsed.data;
  if (d.to < d.from) return c.json({ error: 'invalid_range', reason: 'the To date is before the From date' }, 400);

  const sb = admin(c);
  /* Revision counts every closure this range has ever had, INCLUDING reopened
     ones, so a re-close after a reopen is visibly the second version rather
     than looking like the first. */
  const prior = await sb.from('hr_payout_periods').select('revision')
    .eq('period_from', d.from).eq('period_to', d.to)
    .order('revision', { ascending: false }).limit(1);
  if (prior.error) return c.json({ error: 'fetch_failed', reason: prior.error.message }, 500);
  const revision = Number((prior.data?.[0] as { revision?: number } | undefined)?.revision ?? 0) + 1;

  const { data, error } = await sb
    .from('hr_payout_periods')
    .insert({
      period_from: d.from, period_to: d.to, revision, status: 'CLOSED',
      engine_version: COMMISSION_ENGINE_VERSION,
      total_centi: d.totalCenti, row_count: d.rows.length, rows_json: d.rows,
      closed_by_name: g.caller.name || g.caller.email,
      closed_at: new Date().toISOString(),
    })
    .select(PERIOD_SELECT).single();
  if (error) {
    // The partial unique index: at most one CLOSED period per range.
    if (error.code === '23505') {
      return c.json({ error: 'already_closed', reason: 'this period is already closed — reopen it first' }, 409);
    }
    return c.json({ error: 'close_failed', reason: error.message }, 500);
  }
  return c.json({ closed: periodToWire(data as unknown as Record<string, unknown>) }, 201);
});

const reopenSchema = z.object({
  from: z.string().regex(ISO_DATE),
  to: z.string().regex(ISO_DATE),
  reason: z.string().min(1),
});

commission.post('/payout/reopen', async (c) => {
  const g = await gate(c, HR_MANAGE);
  if (!g.ok) return g.res;
  const b = await readBody(c);
  if (!b.ok) return b.res;
  const parsed = reopenSchema.safeParse(b.body);
  if (!parsed.success) {
    return c.json({
      error: 'validation_failed',
      reason: 'Reopening a closed period needs a stated reason — it is what later explains why an approved figure was allowed to move.',
      issues: issues(parsed.error),
    }, 400);
  }
  const d = parsed.data;
  /* The row is KEPT, flipped to REOPENED rather than deleted: it is the record
     that this range was once approved at these figures, and deleting it would
     erase the only evidence of the approval being undone. */
  const { data, error } = await admin(c)
    .from('hr_payout_periods')
    .update({
      status: 'REOPENED',
      reopened_by_name: g.caller.name || g.caller.email,
      reopened_at: new Date().toISOString(),
      reopen_reason: d.reason,
    })
    .eq('period_from', d.from).eq('period_to', d.to).eq('status', 'CLOSED')
    .select(PERIOD_SELECT).maybeSingle();
  if (error) return c.json({ error: 'reopen_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_closed', reason: 'this period is not closed' }, 409);
  return c.json({ reopened: periodToWire(data as unknown as Record<string, unknown>) });
});

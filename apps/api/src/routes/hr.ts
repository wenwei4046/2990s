import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  computeShowroomCommission,
  kpiFlagFiresOnUnit,
  unitKpiCenti,
  unitKpiExcludedCenti,
  type CommissionConfig,
  type SalespersonInput,
} from '@2990s/shared/hr-commission';
import { loadKpiUnitsByDoc } from '../lib/kpi-units';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const hr = new Hono<{ Bindings: Env; Variables: Variables }>();

hr.use('*', supabaseAuth);

type HrContext = Context<{ Bindings: Env; Variables: Variables }>;

// Editing salary config / profiles / item-KPI stays admin-only.
const ADMIN_ROLES = new Set(['admin', 'super_admin']);
// Viewing HR (commission, KPI, profiles) is allowed for sales_director too —
// it sees every salesperson's KPI + commission but cannot change the rates
// (2026-06-15). Mutations remain ADMIN_ROLES.
const HR_VIEW_ROLES = new Set(['admin', 'super_admin', 'sales_director']);

async function requireHrRole(
  c: HrContext,
  allowed: Set<string>,
): Promise<{ ok: true; userId: string } | { ok: false; res: Response }> {
  const userId = c.get('user').id;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (error) return { ok: false, res: c.json({ error: 'role_lookup_failed', reason: error.message }, 500) };
  if (!data || !data.active) return { ok: false, res: c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403) };
  if (!allowed.has(data.role)) return { ok: false, res: c.json({ error: 'forbidden', reason: 'hr_admin_only' }, 403) };
  return { ok: true, userId };
}

// Mutating HR data (config/profiles/item-KPI write) — admin + super_admin only.
const requireAdmin = (c: HrContext) => requireHrRole(c, ADMIN_ROLES);
// Reading HR data (GET) — admin + super_admin + sales_director (view-only).
const requireHrView = (c: HrContext) => requireHrRole(c, HR_VIEW_ROLES);

const issues = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path, message: i.message }));

// ── config ───────────────────────────────────────────────────────────────
const CONFIG_SELECT =
  'base_bps, personal_kpi_threshold_centi, personal_kpi_bonus_bps, showroom_kpi_threshold_centi, showroom_kpi_bonus_bps, override_base_bps, override_kpi_bonus_bps, updated_at';

type ConfigRow = {
  base_bps: number;
  personal_kpi_threshold_centi: number;
  personal_kpi_bonus_bps: number;
  showroom_kpi_threshold_centi: number;
  showroom_kpi_bonus_bps: number;
  override_base_bps: number;
  override_kpi_bonus_bps: number;
  updated_at?: string;
};

const toConfigApi = (r: ConfigRow) => ({
  baseBps: r.base_bps,
  personalKpiThresholdCenti: r.personal_kpi_threshold_centi,
  personalKpiBonusBps: r.personal_kpi_bonus_bps,
  showroomKpiThresholdCenti: r.showroom_kpi_threshold_centi,
  showroomKpiBonusBps: r.showroom_kpi_bonus_bps,
  overrideBaseBps: r.override_base_bps,
  overrideKpiBonusBps: r.override_kpi_bonus_bps,
  updatedAt: r.updated_at,
});

const toConfig = (r: ConfigRow): CommissionConfig => ({
  baseBps: r.base_bps,
  personalKpiThresholdCenti: r.personal_kpi_threshold_centi,
  personalKpiBonusBps: r.personal_kpi_bonus_bps,
  showroomKpiThresholdCenti: r.showroom_kpi_threshold_centi,
  showroomKpiBonusBps: r.showroom_kpi_bonus_bps,
  overrideBaseBps: r.override_base_bps,
  overrideKpiBonusBps: r.override_kpi_bonus_bps,
});

hr.get('/config', async (c) => {
  const gate = await requireHrView(c);
  if (!gate.ok) return gate.res;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_commission_config').select(CONFIG_SELECT).eq('id', 1).single();
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({ config: toConfigApi(data as ConfigRow) });
});

const configPatchSchema = z.object({
  baseBps: z.number().int().nonnegative().optional(),
  personalKpiThresholdCenti: z.number().int().nonnegative().optional(),
  personalKpiBonusBps: z.number().int().nonnegative().optional(),
  showroomKpiThresholdCenti: z.number().int().nonnegative().optional(),
  showroomKpiBonusBps: z.number().int().nonnegative().optional(),
  overrideBaseBps: z.number().int().nonnegative().optional(),
  overrideKpiBonusBps: z.number().int().nonnegative().optional(),
});

hr.patch('/config', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = configPatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: gate.userId };
  const d = parsed.data;
  if (d.baseBps !== undefined) patch.base_bps = d.baseBps;
  if (d.personalKpiThresholdCenti !== undefined) patch.personal_kpi_threshold_centi = d.personalKpiThresholdCenti;
  if (d.personalKpiBonusBps !== undefined) patch.personal_kpi_bonus_bps = d.personalKpiBonusBps;
  if (d.showroomKpiThresholdCenti !== undefined) patch.showroom_kpi_threshold_centi = d.showroomKpiThresholdCenti;
  if (d.showroomKpiBonusBps !== undefined) patch.showroom_kpi_bonus_bps = d.showroomKpiBonusBps;
  if (d.overrideBaseBps !== undefined) patch.override_base_bps = d.overrideBaseBps;
  if (d.overrideKpiBonusBps !== undefined) patch.override_kpi_bonus_bps = d.overrideKpiBonusBps;

  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_commission_config').update(patch).eq('id', 1).select(CONFIG_SELECT).single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ config: toConfigApi(data as ConfigRow) });
});

// ── salesperson profiles ───────────────────────────────────────────────────
const PROFILE_SELECT = 'id, staff_id, tier, showroom_id, active, created_at, updated_at';

type ProfileRow = {
  id: string; staff_id: string; tier: string; showroom_id: string; active: boolean;
  created_at: string; updated_at: string;
  staff?: { name?: string; staff_code?: string } | null;
};

const toProfileApi = (r: ProfileRow) => ({
  id: r.id,
  staffId: r.staff_id,
  staffName: r.staff?.name ?? '',
  staffCode: r.staff?.staff_code ?? '',
  tier: r.tier,
  showroomId: r.showroom_id,
  active: r.active,
});

hr.get('/profiles', async (c) => {
  const gate = await requireHrView(c);
  if (!gate.ok) return gate.res;
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('hr_salesperson_profiles')
    .select(`${PROFILE_SELECT}, staff:staff(name, staff_code)`)
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({ profiles: (data as ProfileRow[] ?? []).map(toProfileApi) });
});

const profileCreateSchema = z.object({
  staffId: z.string().uuid(),
  tier: z.enum(['sales', 'manager']),
  showroomId: z.string().uuid(),
  active: z.boolean().default(true),
});

hr.post('/profiles', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = profileCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('hr_salesperson_profiles')
    .insert({ staff_id: parsed.data.staffId, tier: parsed.data.tier, showroom_id: parsed.data.showroomId, active: parsed.data.active })
    .select(PROFILE_SELECT)
    .single();
  if (error) {
    if (error.code === '23505') return c.json({ error: 'duplicate_staff', reason: 'this staff already has an HR profile' }, 409);
    return c.json({ error: 'create_failed', reason: error.message }, 500);
  }
  return c.json({ profile: toProfileApi(data as ProfileRow) }, 201);
});

const profilePatchSchema = z.object({
  tier: z.enum(['sales', 'manager']).optional(),
  showroomId: z.string().uuid().optional(),
  active: z.boolean().optional(),
});

hr.patch('/profiles/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.tier !== undefined) patch.tier = parsed.data.tier;
  if (parsed.data.showroomId !== undefined) patch.showroom_id = parsed.data.showroomId;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_salesperson_profiles').update(patch).eq('id', id).select(PROFILE_SELECT).maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ profile: toProfileApi(data as ProfileRow) });
});

hr.delete('/profiles/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { error } = await supabase.from('hr_salesperson_profiles').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

// ── item KPIs ───────────────────────────────────────────────────────────────
const ITEM_KPI_SELECT = 'id, flag_type, ref, label, bonus_centi, active, created_at, updated_at';

type ItemKpiRow = {
  id: string; flag_type: 'product' | 'fabric' | 'special'; ref: string;
  label: string; bonus_centi: number; active: boolean;
};

const toItemKpiApi = (r: ItemKpiRow) => ({
  id: r.id,
  flagType: r.flag_type,
  ref: r.ref,
  label: r.label,
  bonusCenti: r.bonus_centi,
  active: r.active,
});

hr.get('/item-kpi', async (c) => {
  const gate = await requireHrView(c);
  if (!gate.ok) return gate.res;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_item_kpi').select(ITEM_KPI_SELECT).order('created_at', { ascending: true });
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
  return c.json({ items: (data as ItemKpiRow[] ?? []).map(toItemKpiApi) });
});

const itemKpiCreateSchema = z.object({
  flagType: z.enum(['product', 'fabric', 'special']),
  ref: z.string().min(1),
  label: z.string().default(''),
  bonusCenti: z.number().int().nonnegative(),
  active: z.boolean().default(true),
});

hr.post('/item-kpi', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = itemKpiCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('hr_item_kpi')
    .insert({ flag_type: parsed.data.flagType, ref: parsed.data.ref, label: parsed.data.label, bonus_centi: parsed.data.bonusCenti, active: parsed.data.active })
    .select(ITEM_KPI_SELECT)
    .single();
  if (error) return c.json({ error: 'create_failed', reason: error.message }, 500);
  return c.json({ item: toItemKpiApi(data as ItemKpiRow) }, 201);
});

const itemKpiPatchSchema = z.object({
  label: z.string().optional(),
  bonusCenti: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});

hr.patch('/item-kpi/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = itemKpiPatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'validation_failed', issues: issues(parsed.error) }, 400);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.bonusCenti !== undefined) patch.bonus_centi = parsed.data.bonusCenti;
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('hr_item_kpi').update(patch).eq('id', id).select(ITEM_KPI_SELECT).maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ item: toItemKpiApi(data as ItemKpiRow) });
});

hr.delete('/item-kpi/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok) return gate.res;
  const id = c.req.param('id');
  const supabase = c.get('supabase');
  const { error } = await supabase.from('hr_item_kpi').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

// ── pickers: assignable staff + showrooms + products/fabrics/specials to flag ──
hr.get('/pickers', async (c) => {
  const gate = await requireHrView(c);
  if (!gate.ok) return gate.res;
  const supabase = c.get('supabase');

  const [staffRes, showroomRes, productRes, fabricRes, specialRes] = await Promise.all([
    supabase.from('staff').select('id, name, staff_code, role, active').eq('active', true).order('name'),
    supabase.from('showrooms').select('id, name').eq('active', true).order('sort_order'),
    supabase.from('mfg_products').select('code, name').eq('pos_active', true).order('code'),
    supabase.from('fabric_library').select('id, label').order('label'),
    supabase.from('special_addons').select('code, label').order('label'),
  ]);
  const firstErr = staffRes.error || showroomRes.error || productRes.error || fabricRes.error || specialRes.error;
  if (firstErr) return c.json({ error: 'fetch_failed', reason: firstErr.message }, 500);

  return c.json({
    staff: (staffRes.data ?? []).map((s) => ({ id: s.id, name: s.name, staffCode: s.staff_code, role: s.role })),
    showrooms: (showroomRes.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    products: (productRes.data ?? []).map((p) => ({ ref: p.code as string, label: `${p.code} — ${p.name}` })),
    fabrics: (fabricRes.data ?? []).map((f) => ({ ref: f.id as string, label: f.label as string })),
    specials: (specialRes.data ?? []).map((s) => ({ ref: s.code as string, label: s.label as string })),
  });
});

// ── commission computation ──────────────────────────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type OrderRow = {
  doc_no: string;
  salesperson_id: string | null;
  mattress_sofa_centi: number | null;
  bedframe_centi: number | null;
  accessories_centi: number | null;
  others_centi: number | null;
};

/* Goods that drive commission = the four GOODS category buckets only. Delivery
 * fee + SERVICE-category lines (SVC-DELIVERY* / dispose / lift) live in their own
 * `service_centi` bucket (recomputeTotals routes them there FIRST so they can
 * never leak into goods) and `delivery_fee_centi` is a separate header column —
 * neither is summed here. So delivery + service are ALREADY excluded from both
 * the % commission and the 100k/400k thresholds (Loo 2026-06-20). The item-KPI
 * add-on exclusion below removes the remaining flagged-add-on amounts. */
const goodsOf = (o: OrderRow): number =>
  (o.mattress_sofa_centi ?? 0) + (o.bedframe_centi ?? 0) + (o.accessories_centi ?? 0) + (o.others_centi ?? 0);

// display order within a showroom: managers (tier 2) first, then sales (tier 1).
const TIER_RANK: Record<string, number> = { manager: 0, sales: 1 };

hr.get('/commission', async (c) => {
  const gate = await requireHrView(c);
  if (!gate.ok) return gate.res;
  const from = (c.req.query('from') ?? '').trim();
  const to = (c.req.query('to') ?? '').trim();
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return c.json({ error: 'invalid_range', reason: 'from and to must be YYYY-MM-DD' }, 400);
  if (from > to) return c.json({ error: 'invalid_range', reason: 'from must be <= to' }, 400);

  const supabase = c.get('supabase');

  // config
  const cfgRes = await supabase.from('hr_commission_config').select(CONFIG_SELECT).eq('id', 1).single();
  if (cfgRes.error) return c.json({ error: 'config_failed', reason: cfgRes.error.message }, 500);
  const config = toConfig(cfgRes.data as ConfigRow);

  // active profiles (tier + HR-assigned showroom + staff name for labels).
  // The HR-assigned showroom is the SINGLE source of truth for the showroom
  // dimension: a salesperson's goods, their grouping, and the whole-showroom
  // total all key off the profile, so they can never diverge.
  const profRes = await supabase
    .from('hr_salesperson_profiles')
    .select('staff_id, tier, showroom_id, staff:staff(name)')
    .eq('active', true);
  if (profRes.error) return c.json({ error: 'profiles_failed', reason: profRes.error.message }, 500);
  type ProfRow = { staff_id: string; tier: string; showroom_id: string; staff?: { name?: string } | null };
  const profiles = (profRes.data as ProfRow[]) ?? [];
  const staffName = new Map<string, string>(profiles.map((p) => [p.staff_id, p.staff?.name ?? '']));

  const showroomRes = await supabase.from('showrooms').select('id, name');
  if (showroomRes.error) return c.json({ error: 'showrooms_failed', reason: showroomRes.error.message }, 500);
  const showroomName = new Map<string, string>((showroomRes.data ?? []).map((s) => [s.id as string, s.name as string]));

  // orders in range, excluding cancelled/on-hold. Header category columns only.
  const ordRes = await supabase
    .from('mfg_sales_orders')
    .select('doc_no, salesperson_id, mattress_sofa_centi, bedframe_centi, accessories_centi, others_centi')
    .gte('so_date', from)
    .lte('so_date', to)
    .not('status', 'in', '(CANCELLED,ON_HOLD)');
  if (ordRes.error) return c.json({ error: 'orders_failed', reason: ordRes.error.message }, 500);
  const orders = (ordRes.data as OrderRow[]) ?? [];

  const personalGoods = new Map<string, number>(); // salesperson_id → goods centi
  const docToSalesperson = new Map<string, string>();
  for (const o of orders) {
    if (!o.salesperson_id) continue;
    personalGoods.set(o.salesperson_id, (personalGoods.get(o.salesperson_id) ?? 0) + goodsOf(o));
    docToSalesperson.set(o.doc_no, o.salesperson_id);
  }

  // item-KPI — a flagged purchase earns the FIXED bonus INSTEAD of % commission
  // on the flagged add-on, so that amount leaves goods (kpi-units.ts is the
  // single source; /pos/sales-stats reads the same units for its breakdown).
  const itemKpiCenti = new Map<string, number>();       // salesperson_id → fixed bonus centi
  const kpiExcludedGoods = new Map<string, number>();   // salesperson_id → goods to remove
  const kpiDetail = new Map<string, Map<string, { label: string; qty: number; bonusCenti: number; lineCenti: number }>>();
  if (docToSalesperson.size > 0) {
    let kpi;
    try {
      kpi = await loadKpiUnitsByDoc(supabase, [...docToSalesperson.keys()]);
    } catch (e) {
      return c.json({ error: 'kpi_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
    }
    const { flags, flagLabel, unitsByDoc } = kpi;
    for (const [docNo, units] of unitsByDoc) {
      const sp = docToSalesperson.get(docNo);
      if (!sp) continue;
      for (const u of units) {
        const bonus = unitKpiCenti(u, flags);
        const excluded = unitKpiExcludedCenti(u, flags);
        if (bonus > 0) itemKpiCenti.set(sp, (itemKpiCenti.get(sp) ?? 0) + bonus);
        if (excluded > 0) kpiExcludedGoods.set(sp, (kpiExcludedGoods.get(sp) ?? 0) + excluded);
        if (bonus <= 0) continue;
        for (const f of flags) {
          if (!kpiFlagFiresOnUnit(f, u)) continue;
          const key = `${f.flagType}:${f.ref}`;
          if (!kpiDetail.has(sp)) kpiDetail.set(sp, new Map());
          const m = kpiDetail.get(sp)!;
          const prev = m.get(key) ?? { label: flagLabel.get(key) ?? f.ref, qty: 0, bonusCenti: f.bonusCenti, lineCenti: 0 };
          prev.qty += u.qty;
          prev.lineCenti += u.qty * f.bonusCenti;
          m.set(key, prev);
        }
      }
    }
  }

  // group profiles by their HR-assigned showroom, then compute. The KPI add-on
  // exclusion is subtracted from each salesperson's goods (clamped ≥ 0): a
  // flagged add-on earns the fixed bonus above instead of % commission, and is
  // dropped from the goods the % rate + the 100k/400k thresholds run on.
  const byShowroom = new Map<string, SalespersonInput[]>();
  for (const p of profiles) {
    const sid = p.showroom_id;
    if (!byShowroom.has(sid)) byShowroom.set(sid, []);
    byShowroom.get(sid)!.push({
      staffId: p.staff_id,
      tier: p.tier as 'sales' | 'manager',
      personalGoodsCenti: Math.max(0, (personalGoods.get(p.staff_id) ?? 0) - (kpiExcludedGoods.get(p.staff_id) ?? 0)),
      itemKpiCenti: itemKpiCenti.get(p.staff_id) ?? 0,
    });
  }

  const showrooms = [...byShowroom.entries()].map(([sid, people]) => {
    // whole-showroom total = sum of this showroom's profiled members' personal
    // goods. Single source of truth: the displayed rows always add up to this
    // figure, and both the 400k gate and the manager override base use it.
    const sg = people.reduce((acc, m) => acc + m.personalGoodsCenti, 0);
    const rows = computeShowroomCommission(config, sg, people).map((r) => ({
      ...r,
      staffName: staffName.get(r.staffId) ?? '',
      kpiDetail: [...(kpiDetail.get(r.staffId)?.values() ?? [])],
    }));
    // managers first, then sales; stable within tier (preserves existing order).
    rows.sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9));
    return {
      showroomId: sid,
      showroomName: showroomName.get(sid) ?? sid,
      showroomGoodsCenti: sg,
      showroomKpiHit: sg >= config.showroomKpiThresholdCenti,
      rows,
    };
  });

  return c.json({ from, to, config: toConfigApi(cfgRes.data as ConfigRow), showrooms });
});

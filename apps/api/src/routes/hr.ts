import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  computeShowroomCommission,
  lineKpiCenti,
  type CommissionConfig,
  type ItemKpiFlag,
  type SalespersonInput,
} from '@2990s/shared/hr-commission';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const hr = new Hono<{ Bindings: Env; Variables: Variables }>();

hr.use('*', supabaseAuth);

type HrContext = Context<{ Bindings: Env; Variables: Variables }>;

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

// Salary data is admin-only. Returns the userId on success, or a 403/500 response.
async function requireAdmin(
  c: HrContext,
): Promise<{ ok: true; userId: string } | { ok: false; res: Response }> {
  const userId = c.get('user').id;
  const supabase = c.get('supabase');
  const { data, error } = await supabase.from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (error) return { ok: false, res: c.json({ error: 'role_lookup_failed', reason: error.message }, 500) };
  if (!data || !data.active) return { ok: false, res: c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403) };
  if (!ADMIN_ROLES.has(data.role)) return { ok: false, res: c.json({ error: 'forbidden', reason: 'hr_admin_only' }, 403) };
  return { ok: true, userId };
}

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
  const gate = await requireAdmin(c);
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
  const gate = await requireAdmin(c);
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
  const gate = await requireAdmin(c);
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
  const gate = await requireAdmin(c);
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

const goodsOf = (o: OrderRow): number =>
  (o.mattress_sofa_centi ?? 0) + (o.bedframe_centi ?? 0) + (o.accessories_centi ?? 0) + (o.others_centi ?? 0);

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

hr.get('/commission', async (c) => {
  const gate = await requireAdmin(c);
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

  // item-KPI: only fetch lines if there are active flags.
  const itemKpiCenti = new Map<string, number>(); // salesperson_id → bonus centi
  const kpiDetail = new Map<string, Map<string, { label: string; qty: number; bonusCenti: number; lineCenti: number }>>();
  const flagsRes = await supabase.from('hr_item_kpi').select('flag_type, ref, label, bonus_centi').eq('active', true);
  if (flagsRes.error) return c.json({ error: 'flags_failed', reason: flagsRes.error.message }, 500);
  const flags: ItemKpiFlag[] = (flagsRes.data ?? []).map((f) => ({ flagType: f.flag_type, ref: f.ref, bonusCenti: f.bonus_centi }));
  const flagLabel = new Map<string, string>((flagsRes.data ?? []).map((f) => [`${f.flag_type}:${f.ref}`, (f.label as string) ?? f.ref]));

  if (flags.length > 0 && docToSalesperson.size > 0) {
    const docNos = [...docToSalesperson.keys()];
    for (const batch of chunk(docNos, 200)) {
      const lineRes = await supabase
        .from('mfg_sales_order_items')
        .select('doc_no, item_code, qty, variants')
        .eq('cancelled', false)
        .in('doc_no', batch);
      if (lineRes.error) return c.json({ error: 'lines_failed', reason: lineRes.error.message }, 500);
      for (const ln of lineRes.data ?? []) {
        const sp = docToSalesperson.get(ln.doc_no as string);
        if (!sp) continue;
        const v = (ln.variants ?? {}) as { fabricId?: string | null; specials?: Array<{ code?: string }> };
        const specialCodes = Array.isArray(v.specials)
          ? v.specials.map((s) => s.code).filter((x): x is string => !!x)
          : [];
        const line = { itemCode: (ln.item_code as string) ?? '', qty: (ln.qty as number) ?? 0, fabricId: v.fabricId ?? null, specialCodes };
        const bonus = lineKpiCenti(line, flags);
        if (bonus <= 0) continue;
        itemKpiCenti.set(sp, (itemKpiCenti.get(sp) ?? 0) + bonus);
        for (const f of flags) {
          const matched =
            (f.flagType === 'product' && line.itemCode === f.ref) ||
            (f.flagType === 'fabric' && line.fabricId === f.ref) ||
            (f.flagType === 'special' && line.specialCodes.includes(f.ref));
          if (!matched) continue;
          const key = `${f.flagType}:${f.ref}`;
          if (!kpiDetail.has(sp)) kpiDetail.set(sp, new Map());
          const m = kpiDetail.get(sp)!;
          const prev = m.get(key) ?? { label: flagLabel.get(key) ?? f.ref, qty: 0, bonusCenti: f.bonusCenti, lineCenti: 0 };
          prev.qty += line.qty;
          prev.lineCenti += line.qty * f.bonusCenti;
          m.set(key, prev);
        }
      }
    }
  }

  // group profiles by their HR-assigned showroom, then compute
  const byShowroom = new Map<string, SalespersonInput[]>();
  for (const p of profiles) {
    const sid = p.showroom_id;
    if (!byShowroom.has(sid)) byShowroom.set(sid, []);
    byShowroom.get(sid)!.push({
      staffId: p.staff_id,
      tier: p.tier as 'sales' | 'manager',
      personalGoodsCenti: personalGoods.get(p.staff_id) ?? 0,
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

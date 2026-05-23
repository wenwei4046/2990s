import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';

export const auditLog = new Hono<{ Bindings: Env; Variables: Variables }>();

auditLog.use('*', supabaseAuth);

const ALLOWED_ROLES = new Set(['coordinator', 'finance', 'admin']);
const PAYMENT_METHODS = ['credit', 'debit', 'installment', 'transfer', 'merchant', 'cash'] as const;

const QuerySchema = z.object({
  from:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  salespersonId:  z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  staffId:        z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  paymentMethod:  z.union([z.enum(PAYMENT_METHODS), z.array(z.enum(PAYMENT_METHODS))]).optional(),
  showroomId:     z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  amountMin:      z.coerce.number().int().nonnegative().optional(),
  amountMax:      z.coerce.number().int().nonnegative().optional(),
  slipUploaded:   z.enum(['true', 'false']).optional(),
});

function toArray<T>(v: T | T[] | undefined): T[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadStaffRole(c: any): Promise<string | null> {
  const supabase = c.get('supabase');
  const userId = c.get('user').id;
  const { data, error } = await supabase
    .from('staff').select('role, active').eq('id', userId).maybeSingle();
  if (error || !data || !data.active) return null;
  return data.role;
}

auditLog.get('/', async (c) => {
  const role = await loadStaffRole(c);
  if (!role || !ALLOWED_ROLES.has(role)) {
    return c.json({ error: 'not_authorized_role' }, 403);
  }

  const flat: Record<string, string | string[]> = {};
  for (const key of ['from', 'to', 'amountMin', 'amountMax', 'slipUploaded']) {
    const v = c.req.query(key);
    if (v !== undefined) flat[key] = v;
  }
  for (const key of ['salespersonId', 'staffId', 'paymentMethod', 'showroomId']) {
    const vs = c.req.queries(key);
    if (vs && vs.length > 0) flat[key] = vs.length === 1 ? (vs[0] as string) : vs;
  }

  const parsed = QuerySchema.safeParse(flat);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }
  const q = parsed.data;

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30);
  const fromIso = q.from ? `${q.from}T00:00:00Z` : defaultFrom.toISOString();
  let toIso: string | undefined;
  if (q.to) {
    const toDate = new Date(`${q.to}T00:00:00Z`);
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    toIso = toDate.toISOString();
  }

  const supabase = c.get('supabase');
  let qb = supabase
    .from('orders')
    .select(
      'id, placed_at, customer_name, customer_phone, total, paid, payment_method, installment_months, merchant_provider, approval_code, slip_key, showroom_id, salesperson_id, staff_id',
    )
    .gte('placed_at', fromIso);

  if (toIso) qb = qb.lt('placed_at', toIso);

  const salespersonIds = toArray(q.salespersonId);
  if (salespersonIds) qb = qb.in('salesperson_id', salespersonIds);

  const staffIds = toArray(q.staffId);
  if (staffIds) qb = qb.in('staff_id', staffIds);

  const methods = toArray(q.paymentMethod);
  if (methods) qb = qb.in('payment_method', methods);

  const showroomIds = toArray(q.showroomId);
  if (showroomIds) qb = qb.in('showroom_id', showroomIds);

  if (q.amountMin !== undefined) qb = qb.gte('total', q.amountMin);
  if (q.amountMax !== undefined) qb = qb.lte('total', q.amountMax);

  if (q.slipUploaded === 'true')  qb = qb.not('slip_key', 'is', null);
  if (q.slipUploaded === 'false') qb = qb.is('slip_key', null);

  const { data, error } = await qb.order('placed_at', { ascending: false }).limit(1000);
  if (error) return c.json({ error: 'db_query_failed', detail: error.message }, 500);

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    placedAt: r.placed_at,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    total: r.total,
    paid: r.paid,
    paymentMethod: r.payment_method,
    installmentMonths: r.installment_months,
    merchantProvider: r.merchant_provider,
    approvalCode: r.approval_code,
    slipKey: r.slip_key,
    slipUploaded: r.slip_key !== null,
    showroomId: r.showroom_id,
    salespersonId: r.salesperson_id,
    staffId: r.staff_id,
  }));

  return c.json({ rows, count: rows.length });
});

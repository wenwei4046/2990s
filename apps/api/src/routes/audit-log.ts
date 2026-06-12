// /admin/audit-log — Finance's payment audit trail. Repointed (2026-06-12)
// from the dead legacy `orders` table to the LIVE payments ledger:
// one row per mfg_sales_order_payments entry, joined to its SO header for
// customer / salesperson / venue / order-total context. Money returns as RM
// (centi ÷ 100); slip falls back to the SO-level slip_key for pre-0159 rows.
import { Hono } from 'hono';
import { z } from 'zod';
import { PAYMENT_METHOD_CODES } from '@2990s/shared/payment-methods';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';

export const auditLog = new Hono<{ Bindings: Env; Variables: Variables }>();

auditLog.use('*', supabaseAuth);

// super_admin added with the repoint — the role (mig 0162) postdates this
// route, and the owner was 403'ing on his own audit log.
const ALLOWED_ROLES = new Set(['coordinator', 'finance', 'admin', 'super_admin']);

const QuerySchema = z.object({
  from:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:             z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  salespersonId:  z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  staffId:        z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  paymentMethod:  z.union([z.enum(PAYMENT_METHOD_CODES), z.array(z.enum(PAYMENT_METHOD_CODES))]).optional(),
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
  for (const key of ['salespersonId', 'staffId', 'paymentMethod']) {
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
  // !inner join: every payment row carries its SO header (FK NOT NULL), and
  // it lets the salesperson filter apply on the embedded resource.
  let qb = supabase
    .from('mfg_sales_order_payments')
    .select(
      'id, so_doc_no, paid_at, created_at, method, merchant_provider, installment_months, ' +
      'approval_code, amount_centi, slip_key, is_deposit, created_by, ' +
      'so:mfg_sales_orders!inner(debtor_name, phone, salesperson_id, local_total_centi, slip_key, venue:venues(name))',
    )
    .gte('created_at', fromIso);

  if (toIso) qb = qb.lt('created_at', toIso);

  const salespersonIds = toArray(q.salespersonId);
  if (salespersonIds) qb = qb.in('so.salesperson_id', salespersonIds);

  // "Keyed by" — who recorded the payment row.
  const staffIds = toArray(q.staffId);
  if (staffIds) qb = qb.in('created_by', staffIds);

  const methods = toArray(q.paymentMethod);
  if (methods) qb = qb.in('method', methods);

  // Amount bounds are whole RM on the wire; the ledger stores centi.
  if (q.amountMin !== undefined) qb = qb.gte('amount_centi', q.amountMin * 100);
  if (q.amountMax !== undefined) qb = qb.lte('amount_centi', q.amountMax * 100);

  // Per-payment slip only — the SO-level fallback can't be filtered cheaply.
  if (q.slipUploaded === 'true')  qb = qb.not('slip_key', 'is', null);
  if (q.slipUploaded === 'false') qb = qb.is('slip_key', null);

  const { data, error } = await qb.order('created_at', { ascending: false }).limit(1000);
  if (error) return c.json({ error: 'db_query_failed', detail: error.message }, 500);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []).map((r: any) => {
    const so = r.so ?? {};
    const slipKey = r.slip_key ?? so.slip_key ?? null;
    return {
      id: r.id,                       // payment uuid — unique row key
      docNo: r.so_doc_no,             // SO# shown in the grid
      placedAt: r.created_at,         // when the payment was keyed in
      paidAt: r.paid_at,              // Finance date the money landed
      customerName: so.debtor_name ?? '—',
      customerPhone: so.phone ?? null,
      total: (so.local_total_centi ?? 0) / 100,
      paid: r.amount_centi / 100,
      isDeposit: r.is_deposit === true,
      paymentMethod: r.method,
      installmentMonths: r.installment_months,
      merchantProvider: r.merchant_provider,
      approvalCode: r.approval_code,
      slipKey,
      slipUploaded: slipKey !== null,
      venueName: so.venue?.name ?? null,
      salespersonId: so.salesperson_id ?? null,
      staffId: r.created_by ?? null,
    };
  });

  return c.json({ rows, count: rows.length });
});

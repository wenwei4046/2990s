// ----------------------------------------------------------------------------
// /outstanding — Unified Outstanding filter API across all 8 doc modules.
//
// Commander 2026-05-26: "全部都要能 filter 出来 Outstanding 跟非 Outstanding
// 的部分. by date".
//
// Backed by v_*_outstanding views (migration 0059). Each module has its own
// definition of "outstanding" (see migration header for definitions).
//
// Endpoints:
//   GET /outstanding/po              — POs not fully received
//   GET /outstanding/grn             — GRNs not yet billed
//   GET /outstanding/pi              — PIs not fully paid
//   GET /outstanding/pr              — PRs not yet completed
//   GET /outstanding/so              — SOs not yet delivered/invoiced/closed
//   GET /outstanding/do              — DOs not yet invoiced
//   GET /outstanding/si              — SIs not fully paid
//
// All endpoints accept query params:
//   ?outstanding=true|false   (default: true — only outstanding rows)
//   ?from=YYYY-MM-DD          (filter by doc date >= from)
//   ?to=YYYY-MM-DD            (filter by doc date <= to)
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const outstanding = new Hono<{ Bindings: Env; Variables: Variables }>();
outstanding.use('*', supabaseAuth);

// Map endpoint → (view, date column for from/to filter).
const MODULES: Record<string, { view: string; dateCol: string; orderCol?: string }> = {
  po:           { view: 'v_po_outstanding',           dateCol: 'po_date'        },
  grn:          { view: 'v_grn_outstanding',          dateCol: 'received_at'    },
  pi:           { view: 'v_pi_outstanding',           dateCol: 'invoice_date'   },
  pr:           { view: 'v_pr_outstanding',           dateCol: 'return_date'    },
  so:           { view: 'v_so_outstanding',           dateCol: 'so_date'        },
  do:           { view: 'v_do_outstanding',           dateCol: 'do_date'        },
  si:           { view: 'v_si_outstanding',           dateCol: 'invoice_date'   },
};

for (const [slug, { view, dateCol }] of Object.entries(MODULES)) {
  outstanding.get(`/${slug}`, async (c) => {
    const sb = c.get('supabase');
    const outstandingParam = c.req.query('outstanding');
    const from = c.req.query('from');
    const to = c.req.query('to');

    let q = sb.from(view).select('*').order(dateCol, { ascending: false });

    // outstanding filter: default = true (only outstanding rows)
    if (outstandingParam === 'true' || outstandingParam == null) {
      q = q.eq('is_outstanding', true);
    } else if (outstandingParam === 'false') {
      q = q.eq('is_outstanding', false);
    }
    // else 'all' (or any other value) → no filter, return both

    if (from) q = q.gte(dateCol, from);
    if (to)   q = q.lte(dateCol, to);

    const { data, error } = await q.limit(1000);
    if (error) {
      if (/relation .* does not exist/i.test(error.message)) {
        return c.json({ error: 'migration_pending', reason: 'Run migrations 0057/0058/0059.' }, 500);
      }
      return c.json({ error: 'load_failed', reason: error.message }, 500);
    }
    return c.json({ rows: data ?? [] });
  });
}

/* /outstanding/summary — counts + totals across all 8 modules in one call.
   Used by the cross-module Outstanding Dashboard. */
outstanding.get('/summary', async (c) => {
  const sb = c.get('supabase');
  const from = c.req.query('from');
  const to = c.req.query('to');

  const summary: Record<string, { count: number; total_centi?: number; total_outstanding_centi?: number }> = {};
  for (const [slug, { view, dateCol }] of Object.entries(MODULES)) {
    let q = sb.from(view).select('*').eq('is_outstanding', true);
    if (from) q = q.gte(dateCol, from);
    if (to)   q = q.lte(dateCol, to);
    const { data } = await q;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    summary[slug] = {
      count: rows.length,
      total_centi: rows.reduce((s, r) => s + Number(r.total_centi ?? r.local_total_centi ?? 0), 0),
      total_outstanding_centi: rows.reduce((s, r) => s + Number(r.outstanding_centi ?? 0), 0),
    };
  }
  return c.json({ summary });
});

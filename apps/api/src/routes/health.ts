import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { reconcileLedger } from '../lib/reconcile-ledger';

export const health = new Hono<{ Bindings: Env; Variables: Variables }>();

health.get('/', (c) =>
  c.json({
    status: 'ok',
    service: '2990s-api',
    ts: new Date().toISOString(),
    // Reflects the reversible read-only freeze (middleware/read-only.ts) so the
    // SPAs / monitoring can see the frozen state without attempting a write.
    readOnly: c.env.READ_ONLY_MODE === 'true',
  }),
);

// GET /ledger — "Inventory ledger integrity" health check. Runs the same
// read-only reconcile sweep as GET /inventory/reconcile and reports it as a
// single OK/WARN indicator: status "ok" when 0 silent partial stock-writes are
// found, "warn" with the count + first 50 issues when any document moved stock
// on paper but has zero matching inventory_movements rows.
//
// Stall-safe: the whole sweep is wrapped so a DB stall surfaces as
// status:"unknown" with an error string instead of throwing to the client —
// the health page must stay readable even when the thing it monitors is sick.
// Auth uses 2990's supabaseAuth middleware (sets c.get('supabase')); no
// separate permission gate beyond a valid staff JWT.
health.get('/ledger', supabaseAuth, async (c) => {
  try {
    const sb = c.get('supabase');
    const { asOf, issueCount, issues } = await reconcileLedger(sb);
    return c.json({
      check: 'inventory_ledger_integrity',
      label: 'Inventory ledger integrity',
      ok: issueCount === 0,
      status: issueCount === 0 ? 'ok' : 'warn',
      issueCount,
      // Cap the inline list so an extreme backlog can't bloat the health JSON;
      // the operator drills into GET /inventory/reconcile for the full set.
      issues: issues.slice(0, 50),
      asOf,
    });
  } catch (e) {
    return c.json({
      check: 'inventory_ledger_integrity',
      label: 'Inventory ledger integrity',
      ok: false,
      status: 'unknown',
      issueCount: 0,
      issues: [],
      error: e instanceof Error ? e.message : 'ledger reconcile failed',
    });
  }
});

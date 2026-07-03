// /so-amendments — SO amendment / revision workflow (Phase 2 / Task 2).
//
// An amendment lets a salesperson change a PROCESSING-LOCKED Sales Order through
// a supplier-confirmed, two-gate state machine (REQUESTED → SUPPLIER_PENDING →
// SO_APPROVED → PO_APPROVED → SENT / REJECTED). The pure state machine +
// transition guards live in @2990s/shared (so-amendment.ts, Phase 1) — this
// router imports canTransition / nextStatus, it does NOT redefine them.
//
// The CREATE endpoint (POST /mfg-sales-orders/:docNo/amendments) is NOT here: it
// lives on the mfgSalesOrders router so its URL nests under the SO mount and it
// can reuse that file's private SO guards (soProcessingLocked / soHasDownstream).
// This module carries list + detail + supplier-confirm; approve-so / approve-po /
// send / reject land in later phases.

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import { canTransition, nextStatus, type AmendStatus, type AmendAction } from '@2990s/shared';
import { applySoAmendment } from '../lib/so-revision';

export const soAmendments = new Hono<{ Bindings: Env; Variables: Variables }>();
soAmendments.use('*', supabaseAuth);

/* Supplier-confirm is a coordinator/purchasing+ action — it records the
   supplier's acknowledgement of the requested change. Mirrors admin.ts'
   COORDINATOR_OR_ABOVE_ROLES (there is no distinct `purchasing` role in the
   staffRole enum; purchasing work is done by coordinator-and-above). */
const SUPPLIER_CONFIRM_ROLES = new Set<string>(['coordinator', 'finance', 'admin', 'super_admin']);
async function isSupplierConfirmCaller(sb: any, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data } = await sb.from('staff').select('role').eq('id', userId).maybeSingle();
  return !!data && SUPPLIER_CONFIRM_ROLES.has(String((data as { role?: string }).role));
}

/* Approve-SO is the first hard gate: it re-derives the SO + snapshots the old
   version. Per the plan it is a coordinator / showroom_lead / admin+ action
   (the showroom lead owns the order desk; coordinators run fulfilment). Same
   inline role-set predicate style as isSupplierConfirmCaller above — this repo
   has no requirePermission helper; every route gates on an explicit staffRole
   set. */
const APPROVE_SO_ROLES = new Set<string>(['coordinator', 'showroom_lead', 'admin', 'super_admin']);
async function isApproveSoCaller(sb: any, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data } = await sb.from('staff').select('role').eq('id', userId).maybeSingle();
  return !!data && APPROVE_SO_ROLES.has(String((data as { role?: string }).role));
}

/* ── GET / — amendment list (newest first) ─────────────────────────────────
   Joins the SO doc_no (the amendment IS keyed on so_doc_no) + status +
   requested_by + amendment_no + created_at. .limit(500) bounds the result so
   PostgREST's default 1000-row cap can't silently truncate — matches the
   SO/DO/GRN list convention. */
soAmendments.get('/', async (c) => {
  const sb = c.get('supabase');
  const { data, error } = await sb.from('so_amendments')
    .select('id, so_doc_no, amendment_no, status, reason, requested_by, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ amendments: data ?? [] });
});

/* ── GET /:id — amendment detail ───────────────────────────────────────────
   Returns: the amendment row + its so_amendment_lines + the SO header summary
   (doc_no, status, revision) + a light bound-PO summary (po_number, status).
   The bound PO is resolved via purchase_order_items.so_item_id → the SO's line
   ids → purchase_orders. */
soAmendments.get('/:id', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id');

  const [amdRes, lineRes] = await Promise.all([
    sb.from('so_amendments')
      .select('id, so_doc_no, amendment_no, status, reason, requested_by, ' +
        'supplier_confirmed_by, supplier_confirmation_ref, supplier_confirmation_note, ' +
        'supplier_confirmation_attachment_key, so_approved_by, so_approved_at, ' +
        'po_approved_by, po_approved_at, sent_at, created_at, updated_at')
      .eq('id', id).maybeSingle(),
    sb.from('so_amendment_lines')
      .select('id, amendment_id, sales_order_item_id, change_type, new_item_code, ' +
        'new_variants, new_qty, new_unit_price_sen, old_snapshot')
      .eq('amendment_id', id),
  ]);
  if (amdRes.error) return c.json({ error: 'load_failed', reason: amdRes.error.message }, 500);
  if (!amdRes.data) return c.json({ error: 'not_found' }, 404);
  const amendment = amdRes.data as unknown as { so_doc_no: string } & Record<string, unknown>;
  const lines = (lineRes.data ?? []) as unknown as Array<Record<string, unknown>>;

  // SO header summary — doc_no, status, revision.
  const { data: soRow } = await sb.from('mfg_sales_orders')
    .select('doc_no, status, revision')
    .eq('doc_no', amendment.so_doc_no).maybeSingle();
  const salesOrder = (soRow ?? null) as { doc_no: string; status: string; revision: number } | null;

  /* Light bound-PO summary — the PO(s) whose lines were derived from this SO's
     lines (purchase_order_items.so_item_id → mfg_sales_order_items.id). Resolve
     in two hops: SO line ids → PO items (so_item_id) → distinct PO ids →
     purchase_orders (po_number, status). Empty when the SO has no bound PO. */
  let purchaseOrders: Array<{ id: string; po_number: string; status: string }> = [];
  const { data: soItemRows } = await sb.from('mfg_sales_order_items')
    .select('id').eq('doc_no', amendment.so_doc_no);
  const soItemIds = ((soItemRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (soItemIds.length > 0) {
    const { data: poItemRows } = await sb.from('purchase_order_items')
      .select('purchase_order_id').in('so_item_id', soItemIds);
    const poIds = [...new Set(((poItemRows ?? []) as Array<{ purchase_order_id: string | null }>)
      .map((r) => r.purchase_order_id).filter((x): x is string => Boolean(x)))];
    if (poIds.length > 0) {
      const { data: poRows } = await sb.from('purchase_orders')
        .select('id, po_number, status').in('id', poIds);
      purchaseOrders = (poRows ?? []) as Array<{ id: string; po_number: string; status: string }>;
    }
  }

  return c.json({ amendment, lines, salesOrder, purchaseOrders });
});

/* ── PATCH /:id/supplier-confirm ───────────────────────────────────────────
   Record the supplier's acknowledgement of the requested change. Body:
   { ref, note?, attachmentKey? }. Gated to coordinator/purchasing+.
   Transition REQUESTED → SUPPLIER_PENDING via the shared state machine
   (canTransition / nextStatus) — a wrong-state call 409s bad_transition. */
soAmendments.patch('/:id/supplier-confirm', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');

  // RBAC — supplier-confirm = coordinator/purchasing+.
  if (!(await isSupplierConfirmCaller(sb, user.id))) {
    return c.json({
      error: 'supplier_confirm_forbidden',
      message: 'Only a coordinator or purchasing role can record a supplier confirmation.',
    }, 403);
  }

  let body: { ref?: string; note?: string; attachmentKey?: string };
  try { body = (await c.req.json()) as typeof body; } catch { return c.json({ error: 'invalid_json' }, 400); }
  const ref = typeof body.ref === 'string' ? body.ref.trim() : '';
  if (!ref) return c.json({ error: 'ref_required', reason: 'A supplier confirmation reference is required.' }, 400);

  // Load the amendment; guard the transition against its current status.
  const { data: amdRow } = await sb.from('so_amendments')
    .select('id, so_doc_no, status').eq('id', id).maybeSingle();
  if (!amdRow) return c.json({ error: 'not_found' }, 404);
  const amendment = amdRow as { id: string; so_doc_no: string; status: AmendStatus };

  const action: AmendAction = 'supplier-confirm';
  if (!canTransition(amendment.status, action)) {
    return c.json({
      error: 'bad_transition',
      reason: `Cannot record a supplier confirmation from status ${amendment.status}.`,
    }, 409);
  }
  const to = nextStatus(amendment.status, action);
  if (!to) return c.json({ error: 'bad_transition' }, 409);

  const { data: updated, error: updErr } = await sb.from('so_amendments').update({
    status:                              to,
    supplier_confirmed_by:               user.id,
    supplier_confirmation_ref:           ref,
    supplier_confirmation_note:          body.note ?? null,
    supplier_confirmation_attachment_key: body.attachmentKey ?? null,
    updated_at:                          new Date().toISOString(),
  }).eq('id', id).select('id, so_doc_no, amendment_no, status').single();
  if (updErr) return c.json({ error: 'update_failed', reason: updErr.message }, 500);

  // Audit — best-effort, keyed on the SO doc_no like every other SO mutation.
  try {
    await sb.from('mfg_so_audit_log').insert({
      so_doc_no:           amendment.so_doc_no,
      action:              'AMENDMENT_SUPPLIER_CONFIRMED',
      actor_id:            user.id,
      actor_name_snapshot: (user.user_metadata as { name?: string } | undefined)?.name ?? null,
      field_changes:       [{ field: 'amendment_status', from: amendment.status, to }],
      status_snapshot:     null,
      source:              'web',
      note:                ref,
    });
  } catch (e) { /* eslint-disable-next-line no-console */ console.error('[so-amendment] audit failed (non-fatal):', e); }

  return c.json({ amendment: updated });
});

/* ── PATCH /:id/approve-so ─────────────────────────────────────────────────
   The first hard gate. Guard the transition (SUPPLIER_PENDING / REQUESTED →
   SO_APPROVED via the shared state machine — the light no-supplier path may
   skip supplier-confirm), then RE-DERIVE the SO: snapshot the current version
   to so_revisions, apply the line diffs to mfg_sales_order_items, RE-RUN the
   honest-pricing recompute (applySoAmendment → the SAME shared pricing path as
   POST /mfg-sales-orders), bump mfg_sales_orders.revision, and audit. On
   success the amendment advances to SO_APPROVED and stamps so_approved_by/at.

   If the SO has NO bound PO this is the TERMINAL step (there is no PO to revise
   or send) — the amendment simply rests at SO_APPROVED. Approve-PO / Send only
   apply when a bound PO exists (Phase 4). */
soAmendments.patch('/:id/approve-so', async (c) => {
  const sb = c.get('supabase'); const id = c.req.param('id'); const user = c.get('user');

  // RBAC — approve-SO = coordinator / showroom_lead / admin+.
  if (!(await isApproveSoCaller(sb, user.id))) {
    return c.json({
      error: 'approve_so_forbidden',
      message: 'Only a coordinator, showroom lead, or admin can approve a Sales Order revision.',
    }, 403);
  }

  // Load the amendment; guard the transition against its current status.
  const { data: amdRow } = await sb.from('so_amendments')
    .select('id, so_doc_no, status').eq('id', id).maybeSingle();
  if (!amdRow) return c.json({ error: 'not_found' }, 404);
  const amendment = amdRow as { id: string; so_doc_no: string; status: AmendStatus };

  const action: AmendAction = 'approve-so';
  if (!canTransition(amendment.status, action)) {
    return c.json({
      error: 'bad_transition',
      reason: `Cannot approve the SO revision from status ${amendment.status}.`,
    }, 409);
  }
  const to = nextStatus(amendment.status, action);
  if (!to) return c.json({ error: 'bad_transition' }, 409);

  /* Apply the revision: snapshot → line diffs → honest-pricing recompute →
     revision bump → audit. A hard failure leaves the amendment status
     unchanged (we only advance status AFTER a clean apply) so the operator can
     retry — the snapshot upsert is idempotent on (so_doc_no, revision). */
  let applied: { soDocNo: string; revision: number };
  try {
    applied = await applySoAmendment(sb, id, user.id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[so-amendment] approve-so apply failed:', e);
    return c.json({
      error: 'apply_failed',
      reason: e instanceof Error ? e.message : 'Failed to apply the SO revision.',
    }, 500);
  }

  const { data: updated, error: updErr } = await sb.from('so_amendments').update({
    status:          to,
    so_approved_by:  user.id,
    so_approved_at:  new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  }).eq('id', id).select('id, so_doc_no, amendment_no, status').single();
  if (updErr) return c.json({ error: 'update_failed', reason: updErr.message }, 500);

  return c.json({ amendment: updated, revision: applied.revision });
});

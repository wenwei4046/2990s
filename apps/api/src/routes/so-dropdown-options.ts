// ----------------------------------------------------------------------------
// so-dropdown-options — Task #118.
//
// Commander 2026-05-27: "customer type, building type, relationship 和
// payment dropdown where can do maintenance?". This route backs the SO
// Maintenance page's four mini-tables. One generic table keyed by
// category (customer_type / building_type / relationship / payment_method)
// — see migration 0081.
//
// Endpoints:
//   GET    /                        — list all categories grouped:
//                                       { customer_type: [...], building_type: [...],
//                                         relationship: [...], payment_method: [...] }
//   GET    /?category=customer_type — list active rows for one category,
//                                     ordered by sort_order
//   POST   /                        — create a new option
//   PATCH  /:id                     — update value/label/sort_order/active
//   DELETE /:id                     — hard delete (seed list is short;
//                                     soft-delete via PATCH active=false
//                                     is the alternative the UI can use)
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { z } from 'zod';
import { isCorePaymentMethodRow } from '@2990s/shared/payment-methods';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const soDropdownOptions = new Hono<{ Bindings: Env; Variables: Variables }>();

soDropdownOptions.use('*', supabaseAuth);

/* Loo 2026-06-06 — payment_method is a LOCKED set. The four core rows
   (Merchant / Online / Installment / Cash) drive branch logic end-to-end:
   POS handover cards, the deposit ledger at SO create, the payments route
   enum, and the list-grid summary. Renaming a label or reordering is fine —
   that's the point of the maintenance page — but adding, deleting,
   deactivating, or editing a VALUE (the immutable key the apps map to the
   ledger code) would strand orders behind logic that no longer matches.
   The maintenance UIs mirror this with a lock affordance; this gate is the
   backstop for direct API calls. */
const PAYMENT_METHOD_LOCK_REASON =
  'Payment methods are a fixed set of four — they are wired to order logic ' +
  '(POS handover cards, deposit ledger, payments cascade). Rename or reorder ' +
  'them anytime; they cannot be added to, removed, or turned off.';

const CATEGORIES = [
  'customer_type',
  'building_type',
  'relationship',
  'payment_method',
  // Task #122 (cascade) — Method is a 3-step pick: Method → (Merchant
  // bank + installment plan | Online sub-type | Cash). Each level is
  // editable here.
  'payment_merchant',
  'online_type',
  'installment_plan',
  // Commander 2026-05-27: SO Venue list (Houzs has ~30 venues like
  // 'PENANG WATERFRONT CONVENTION CENTRE', 'PISA SPICE ARENA').
  // Previously free-text on SO; now picklist-driven for consistency.
  'venue',
] as const;
type Category = (typeof CATEGORIES)[number];
const categoryEnum = z.enum(CATEGORIES);

const createSchema = z.object({
  category:  categoryEnum,
  value:     z.string().trim().min(1),
  label:     z.string().trim().min(1),
  sortOrder: z.number().int().optional(),
  active:    z.boolean().optional(),
});

const updateSchema = z.object({
  value:     z.string().trim().min(1).optional(),
  label:     z.string().trim().min(1).optional(),
  sortOrder: z.number().int().optional(),
  active:    z.boolean().optional(),
});

type DbRow = {
  id: string;
  category: string;
  value: string;
  label: string;
  sort_order: number;
  active: boolean;
};

const toApi = (row: DbRow) => ({
  id:        row.id,
  category:  row.category,
  value:     row.value,
  label:     row.label,
  sortOrder: row.sort_order,
  active:    row.active,
});

// GET — either single-category list or all-categories grouped.
soDropdownOptions.get('/', async (c) => {
  const categoryParam = c.req.query('category');
  const includeInactiveParam = c.req.query('includeInactive');
  const includeInactive = includeInactiveParam === '1' || includeInactiveParam === 'true';

  const sb = c.get('supabase');

  if (categoryParam) {
    const parsed = categoryEnum.safeParse(categoryParam);
    if (!parsed.success) return c.json({ error: 'invalid_category' }, 400);
    let q = sb
      .from('so_dropdown_options')
      .select('id, category, value, label, sort_order, active')
      .eq('category', parsed.data)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true });
    if (!includeInactive) q = q.eq('active', true);
    const { data, error } = await q;
    if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);
    return c.json({ options: (data ?? []).map((r) => toApi(r as DbRow)) });
  }

  // All categories grouped — maintenance page consumer wants every row,
  // including inactive ones, so the user can flip `active` back on.
  const { data, error } = await sb
    .from('so_dropdown_options')
    .select('id, category, value, label, sort_order, active')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) return c.json({ error: 'fetch_failed', reason: error.message }, 500);

  const grouped: Record<Category, ReturnType<typeof toApi>[]> = {
    customer_type:    [],
    building_type:    [],
    relationship:     [],
    payment_method:   [],
    payment_merchant: [],
    online_type:      [],
    installment_plan: [],
    venue:            [],
  };
  for (const r of (data ?? []) as DbRow[]) {
    if ((CATEGORIES as readonly string[]).includes(r.category)) {
      grouped[r.category as Category].push(toApi(r));
    }
  }
  return c.json({ options: grouped });
});

// POST / — create a new option.
soDropdownOptions.post('/', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  if (parsed.data.category === 'payment_method') {
    return c.json({ error: 'payment_method_locked', reason: PAYMENT_METHOD_LOCK_REASON }, 409);
  }

  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('so_dropdown_options')
    .insert({
      category:   parsed.data.category,
      value:      parsed.data.value,
      label:      parsed.data.label,
      sort_order: parsed.data.sortOrder ?? 0,
      active:     parsed.data.active ?? true,
    })
    .select('id, category, value, label, sort_order, active')
    .single();
  if (error) {
    // 23505 = unique_violation (category, value)
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      return c.json({ error: 'duplicate_value', reason: 'A row with this (category, value) already exists.' }, 409);
    }
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json({ option: toApi(data as DbRow) });
});

// PATCH /:id — update fields.
soDropdownOptions.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  const patch: Record<string, unknown> = {};
  if (parsed.data.value     !== undefined) patch.value      = parsed.data.value;
  if (parsed.data.label     !== undefined) patch.label      = parsed.data.label;
  if (parsed.data.sortOrder !== undefined) patch.sort_order = parsed.data.sortOrder;
  if (parsed.data.active    !== undefined) patch.active     = parsed.data.active;
  if (Object.keys(patch).length === 0) return c.json({ ok: true, changed: 0 });

  const sb = c.get('supabase');

  /* Locked-set gate — look the row up first so we know its category+value.
     Core payment_method rows accept label / sortOrder / active=true only. */
  const { data: existing } = await sb
    .from('so_dropdown_options')
    .select('category, value')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (isCorePaymentMethodRow(existing.category as string, existing.value as string)) {
    const valueChanged = parsed.data.value !== undefined && parsed.data.value !== existing.value;
    if (valueChanged || parsed.data.active === false) {
      return c.json({ error: 'payment_method_locked', reason: PAYMENT_METHOD_LOCK_REASON }, 409);
    }
  }

  const { data, error } = await sb
    .from('so_dropdown_options')
    .update(patch)
    .eq('id', id)
    .select('id, category, value, label, sort_order, active')
    .maybeSingle();
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      return c.json({ error: 'duplicate_value', reason: 'A row with this (category, value) already exists.' }, 409);
    }
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ option: toApi(data as DbRow) });
});

// DELETE /:id — hard delete (seed list is short; PATCH active=false works
// when commander wants the value preserved for historical SOs).
soDropdownOptions.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const sb = c.get('supabase');

  /* Locked-set gate — core payment_method rows can never be deleted. */
  const { data: existing } = await sb
    .from('so_dropdown_options')
    .select('category, value')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return c.json({ error: 'not_found' }, 404);
  if (isCorePaymentMethodRow(existing.category as string, existing.value as string)) {
    return c.json({ error: 'payment_method_locked', reason: PAYMENT_METHOD_LOCK_REASON }, 409);
  }

  const { error } = await sb.from('so_dropdown_options').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

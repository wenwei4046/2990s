// ----------------------------------------------------------------------------
// /venues — CRUD for the venues master (migration 0085).
//
// Venues are the parallel-to-showrooms concept where the sales force
// (sales / sales_executive / outlet_manager) operates from. Backend's
// SO Maintenance UI manages this list; the Users page picks a venue
// when inviting a venue-scoped role; POS stamps the salesperson's
// venue_id on every SO created via POS.
//
// RLS: authenticated read+write (mirrors /warehouses). Admin/coordinator
// gating done in the UI.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const venues = new Hono<{ Bindings: Env; Variables: Variables }>();
venues.use('*', supabaseAuth);

const COLS = 'id, name, address, active, created_at';

venues.get('/', async (c) => {
  const sb = c.get('supabase');
  // Default to active-only — match the /drivers convention so the venue
  // picker on the Users invite dialog never surfaces retired venues.
  const onlyActive = c.req.query('active') !== 'false';
  let q = sb.from('venues').select(COLS).order('name');
  if (onlyActive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ venues: data ?? [] });
});

venues.post('/', async (c) => {
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'invalid_json' }, 400); }

  const name = String(body.name ?? '').trim();
  if (!name) return c.json({ error: 'name_required' }, 400);

  const sb = c.get('supabase');
  const { data, error } = await sb.from('venues').insert({
    name,
    address: (body.address as string) ?? null,
    active:  body.active === false ? false : true,
  }).select(COLS).single();
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden', reason: error.message }, 403);
    return c.json({ error: 'insert_failed', reason: error.message }, 500);
  }
  return c.json({ venue: data }, 201);
});

venues.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ error: 'invalid_json' }, 400); }

  const updates: Record<string, unknown> = {};
  if (body.name    !== undefined) updates.name    = String(body.name).trim();
  if (body.address !== undefined) updates.address = body.address as string | null;
  if (body.active  !== undefined) updates.active  = Boolean(body.active);

  if (Object.keys(updates).length === 0) return c.json({ error: 'no_changes' }, 400);

  const sb = c.get('supabase');
  const { data, error } = await sb.from('venues').update(updates).eq('id', id).select(COLS).single();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  return c.json({ venue: data });
});

// Soft-delete: flip active=false. Hard-delete would orphan SO/staff FKs
// (we set ON DELETE SET NULL but historical reporting becomes confused).
venues.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const sb = c.get('supabase');
  const { data, error } = await sb.from('venues').update({ active: false }).eq('id', id).select(COLS).single();
  if (error) return c.json({ error: 'deactivate_failed', reason: error.message }, 500);
  return c.json({ venue: data });
});

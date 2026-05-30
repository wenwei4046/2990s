// ----------------------------------------------------------------------------
// localities — CRUD for my_localities (PR #160).
//
// Commander 2026-05-27: "也需要进行维护: State, City, Postcode". This route
// gives the Localities Settings tab the ability to add/edit/delete rows in
// my_localities. Read is still done client-side via direct Supabase select
// (existing localities-queries.ts pattern) — only writes go through here so
// they ride on the API's service role + audit logging.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const localities = new Hono<{ Bindings: Env; Variables: Variables }>();

localities.use('*', supabaseAuth);

const createSchema = z.object({
  state:     z.string().trim().min(1),
  stateCode: z.string().trim().min(1),
  city:      z.string().trim().min(1),
  postcode:  z.string().trim().min(1),
  /* Task #121 — optional, defaults to Malaysia. Future SG / TH states
     declare their own country so the SO snapshot is correct. */
  country:   z.string().trim().min(1).optional(),
});

const updateSchema = z.object({
  state:       z.string().trim().min(1).optional(),
  stateCode:   z.string().trim().min(1).optional(),
  city:        z.string().trim().min(1).optional(),
  postcode:    z.string().trim().min(1).optional(),
  country:     z.string().trim().min(1).optional(),
  /* Commander 2026-05-27 — city-level warehouse override.
     '' or null explicitly clears the override (falls back to state-level). */
  warehouseId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional(),
});

// POST / — create a new row.
localities.post('/', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('my_localities')
    .insert({
      state:      parsed.data.state,
      state_code: parsed.data.stateCode.toUpperCase(),
      city:       parsed.data.city,
      postcode:   parsed.data.postcode,
      /* Task #121 — Malaysia is the implicit default; only override when
         the body carries an explicit country. */
      country:    parsed.data.country ?? 'Malaysia',
    })
    .select('id, state, state_code, city, postcode, country')
    .single();
  if (error) return c.json({ error: 'insert_failed', reason: error.message }, 500);
  return c.json({ locality: data });
});

// PATCH /:id — update a row.
localities.patch('/:id', async (c) => {
  const id = c.req.param('id');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  const patch: Record<string, string | null> = {};
  if (parsed.data.state)     patch.state      = parsed.data.state;
  if (parsed.data.stateCode) patch.state_code = parsed.data.stateCode.toUpperCase();
  if (parsed.data.city)      patch.city       = parsed.data.city;
  if (parsed.data.postcode)  patch.postcode   = parsed.data.postcode;
  if (parsed.data.country)   patch.country    = parsed.data.country;
  /* warehouseId: empty string or null clears the override; uuid sets it. */
  if (parsed.data.warehouseId !== undefined) {
    patch.warehouse_id = parsed.data.warehouseId === '' || parsed.data.warehouseId === null
      ? null
      : parsed.data.warehouseId;
  }
  if (Object.keys(patch).length === 0) return c.json({ ok: true, changed: 0 });

  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('my_localities')
    .update(patch)
    .eq('id', id)
    .select('id, state, state_code, city, postcode, country, warehouse_id')
    .maybeSingle();
  if (error) return c.json({ error: 'update_failed', reason: error.message }, 500);
  if (!data) return c.json({ error: 'not_found' }, 404);
  return c.json({ locality: data });
});

// DELETE /:id — drop a row.
localities.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const sb = c.get('supabase');
  const { error } = await sb.from('my_localities').delete().eq('id', id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

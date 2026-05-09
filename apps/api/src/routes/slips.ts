import { Hono } from 'hono';
import {
  SlipInitRequestSchema,
  type SlipInitResponse,
  type SlipConfirmResponse,
} from '@2990s/shared';
import { buildSlipKey, presign, r2Head } from '../lib/r2';
import { slipBindings, expiresInOneHour } from '../lib/slip';
import type { Env, Variables } from '../env';

// Auth (`supabaseAuth`) is applied at index.ts mount time so this router
// can be unit-tested with a custom context. Mount: app.use('/slips/*', supabaseAuth).
export const slipRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

slipRoutes.post('/init', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const parsed = SlipInitRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
  }

  const staffId = c.get('user').id;
  const supabase = c.get('supabase');
  const bindings = slipBindings(c.env);

  // Look up staff's showroom to stamp the row (RLS scope).
  const { data: staffRow, error: staffErr } = await supabase
    .from('staff')
    .select('showroom_id, active')
    .eq('id', staffId)
    .maybeSingle();
  if (staffErr) return c.json({ error: 'staff_lookup_failed', detail: staffErr.message }, 500);
  if (!staffRow || !staffRow.active) {
    return c.json({ error: 'forbidden', reason: 'no_active_staff' }, 403);
  }

  const sessionId = crypto.randomUUID();
  const r2Key = buildSlipKey(sessionId, parsed.data.contentType);
  const expiresAt = expiresInOneHour();

  const { error: insertErr } = await supabase
    .from('pending_slip_uploads')
    .insert({
      id: sessionId,
      upload_session_id: sessionId,
      staff_id: staffId,
      showroom_id: staffRow.showroom_id,
      r2_key: r2Key,
      content_type: parsed.data.contentType,
      content_hash: parsed.data.contentHash,
      content_size: parsed.data.fileSize,
      status: 'pending',
      order_draft_id: parsed.data.orderDraftId ?? null,
      expires_at: expiresAt,
    });

  if (insertErr) {
    return c.json({ error: 'db_insert_failed', detail: insertErr.message }, 500);
  }

  const putUrl = await presign({
    bucket: bindings.bucketName,
    region: 'auto',
    accessKeyId: bindings.accessKeyId,
    secretAccessKey: bindings.secretAccessKey,
    endpoint: bindings.endpoint,
    key: r2Key,
    method: 'PUT',
    expiresInSeconds: 5 * 60,
    contentType: parsed.data.contentType,
  });

  return c.json<SlipInitResponse>({
    uploadSessionId: sessionId,
    putUrl,
    r2Key,
    expiresAt,
  });
});

slipRoutes.post('/:session/confirm', async (c) => {
  const sessionId = c.req.param('session');
  const staffId = c.get('user').id;
  const supabase = c.get('supabase');
  const bindings = slipBindings(c.env);

  const { data: row, error: fetchErr } = await supabase
    .from('pending_slip_uploads')
    .select('id, staff_id, r2_key, content_hash, content_size, status')
    .eq('id', sessionId)
    .maybeSingle();

  if (fetchErr) return c.json({ error: 'db_fetch_failed', detail: fetchErr.message }, 500);
  if (!row) return c.json({ error: 'session_not_found' }, 404);
  if (row.staff_id !== staffId) return c.json({ error: 'not_session_owner' }, 403);
  if (row.status !== 'pending') {
    return c.json({ error: 'invalid_state', currentStatus: row.status }, 409);
  }

  const head = await r2Head(bindings.bucket, row.r2_key);
  if (!head) {
    return c.json({ error: 'file_not_in_r2' }, 404);
  }

  // Strict size check (R2 etag for unencrypted PUT == md5 hex, NOT sha256;
  // we compare size here. Hash is recorded for audit / future strict check
  // via streamed re-hash — out of scope for v1.)
  if (head.size !== row.content_size) {
    await supabase.from('pending_slip_uploads')
      .update({ status: 'failed', error_msg: 'hash_mismatch (size differ)' })
      .eq('id', sessionId);
    await bindings.bucket.delete(row.r2_key).catch(() => {});
    return c.json({ error: 'hash_mismatch', expected: row.content_size, actual: head.size }, 400);
  }

  const { error: updateErr } = await supabase
    .from('pending_slip_uploads')
    .update({ status: 'uploaded' })
    .eq('id', sessionId);
  if (updateErr) return c.json({ error: 'db_update_failed', detail: updateErr.message }, 500);

  return c.json<SlipConfirmResponse>({ status: 'uploaded', r2Key: row.r2_key });
});

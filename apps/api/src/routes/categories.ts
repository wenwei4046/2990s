import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const categoriesApi = new Hono<{ Bindings: Env; Variables: Variables }>();

categoriesApi.use('*', supabaseAuth);

const ADMIN_ROLES = new Set(['admin', 'coordinator']);

// The 2990s-public bucket is not provisioned, so the PUBLIC_ASSETS binding is
// commented out in wrangler.toml and is `undefined` at runtime. Answer 503
// rather than throwing — CategoryHeroUploader.tsx renders `error` straight
// into its message div, so the admin sees why instead of a blank 500.
// Mirrors the ANTHROPIC_API_KEY guard in routes/scan-so.ts.
const PUBLIC_ASSETS_UNBOUND = {
  error: 'public_assets_unbound',
  reason:
    'Category hero images need the 2990s-public R2 bucket. Create it in the Cloudflare dashboard, then uncomment the PUBLIC_ASSETS [[r2_buckets]] block in apps/api/wrangler.toml.',
} as const;

categoriesApi.post('/:id/hero-image', async (c) => {
  const userId = c.get('user').id;
  const supabase = c.get('supabase');

  const staffRes = await supabase.from('staff').select('role').eq('id', userId).maybeSingle();
  if (!staffRes.data || !ADMIN_ROLES.has(staffRes.data.role)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  // Checked before buffering up to 4MB we cannot store anywhere. Bound to a
  // local so the narrowing survives the awaits below.
  const bucket = c.env.PUBLIC_ASSETS;
  if (!bucket) return c.json(PUBLIC_ASSETS_UNBOUND, 503);

  const id = c.req.param('id');
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.startsWith('image/jpeg') && !contentType.startsWith('image/png')) {
    return c.json({ error: 'unsupported_type', expected: 'image/jpeg or image/png' }, 400);
  }

  const blob = await c.req.arrayBuffer();
  if (blob.byteLength > 4 * 1024 * 1024) {
    return c.json({ error: 'too_large', max: '4MB' }, 413);
  }

  const ext = contentType.endsWith('jpeg') ? 'jpg' : 'png';
  const key = `category-heroes/${id}.${ext}`;

  await bucket.put(key, blob, { httpMetadata: { contentType } });
  await supabase.from('categories').update({ hero_image_key: key }).eq('id', id);

  return c.json({ ok: true, key });
});

categoriesApi.delete('/:id/hero-image', async (c) => {
  const userId = c.get('user').id;
  const supabase = c.get('supabase');

  const staffRes = await supabase.from('staff').select('role').eq('id', userId).maybeSingle();
  if (!staffRes.data || !ADMIN_ROLES.has(staffRes.data.role)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  // Guarded even though the R2 delete is conditional: clearing the column
  // while storage is unreachable would report success having done half the
  // job, and orphan the object if the bucket is later provisioned.
  const bucket = c.env.PUBLIC_ASSETS;
  if (!bucket) return c.json(PUBLIC_ASSETS_UNBOUND, 503);

  const id = c.req.param('id');
  const row = await supabase.from('categories').select('hero_image_key').eq('id', id).maybeSingle();
  if (row.data?.hero_image_key) {
    await bucket.delete(row.data.hero_image_key);
  }
  await supabase.from('categories').update({ hero_image_key: null }).eq('id', id);

  return c.json({ ok: true });
});

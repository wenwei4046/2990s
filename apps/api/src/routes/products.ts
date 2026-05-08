import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const products = new Hono<{ Bindings: Env; Variables: Variables }>();

products.use('*', supabaseAuth);

// GET /products — visible products with category, series, pricing summaries.
// Phase 1 acceptance gate: POS catalog reads from this. RLS ensures only
// authenticated staff see active products.
products.get('/', async (c) => {
  const supabase = c.get('supabase');
  const { data, error } = await supabase
    .from('products')
    .select(
      `
      id, sku, name, detail, size_display, img_key, thumb_key,
      pricing_kind, flat_price, recliner_upgrade_price, stock, low_at, visible,
      category:categories ( id, label, icon, tbc ),
      series:series ( id, label, active )
    `,
    )
    .eq('visible', true)
    .order('updated_at', { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ products: data ?? [] });
});

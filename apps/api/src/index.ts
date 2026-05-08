import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env, Variables } from './env';
import { health } from './routes/health';
import { products } from './routes/products';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', logger());

app.use('*', async (c, next) => {
  const origins = c.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const handler = cors({
    origin: (origin) => (origins.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['authorization', 'content-type', 'x-client-info'],
    maxAge: 600,
  });
  return handler(c, next);
});

app.route('/health', health);
app.route('/products', products);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('[api error]', err);
  return c.json({ error: 'internal_error', message: err.message }, 500);
});

export default app;

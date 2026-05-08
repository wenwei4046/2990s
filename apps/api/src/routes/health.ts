import { Hono } from 'hono';
import type { Env, Variables } from '../env';

export const health = new Hono<{ Bindings: Env; Variables: Variables }>();

health.get('/', (c) =>
  c.json({
    status: 'ok',
    service: '2990s-api',
    ts: new Date().toISOString(),
  }),
);

import { Hono } from 'hono';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    app: c.env.APP_NAME ?? 'Sozan2',
    version: '0.1.0',
    databaseConfigured: Boolean(c.env.DB),
  });
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: 'Unexpected server error' }, 500);
});

export default app;

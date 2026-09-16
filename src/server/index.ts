import { Hono } from 'hono';
import { authRoutes } from './auth/routes';
import type { Env } from './env';
import { plannerRoutes } from './planner/routes';
import { syncRoutes } from './sync/routes';
import { tutoringRoutes } from './tutoring/routes';
import { workspaceRoutes } from './workspaces/routes';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    app: c.env.APP_NAME ?? 'Sozan2',
    version: '0.4.0',
    architecture: 'modular-workspace-local-first',
    localModeAvailable: true,
    cloudDatabaseConfigured: Boolean(c.env.DB),
    cloudAccountsAvailable: Boolean(c.env.DB),
    syncAvailable: Boolean(c.env.DB),
  });
});

app.route('/api/auth', authRoutes);
app.route('/api/workspaces', workspaceRoutes);
app.route('/api/tutoring', tutoringRoutes);
app.route('/api/planner', plannerRoutes);
app.route('/api/sync', syncRoutes);

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

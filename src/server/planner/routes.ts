import { Hono } from 'hono';
import { D1SessionRepository } from '../adapters/d1/tutoring-sessions.repository';
import { accessError, requireWorkspaceAccess } from '../auth/guard';
import type { Env } from '../env';
import { requireDatabase } from '../env';
import { TutoringScheduleProvider } from '../integrations/tutoring-schedule.provider';

export const plannerRoutes = new Hono<{ Bindings: Env }>();

plannerRoutes.get('/:workspaceId/weekly', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId);
    const provider = new TutoringScheduleProvider(
      new D1SessionRepository(requireDatabase(c.env)),
    );
    return c.json({ blocks: await provider.listWeeklyBlocks(workspaceId) });
  } catch (error) {
    const access = accessError(error);
    if (access) return c.json({ error: access.error }, access.status);
    return c.json({ error: error instanceof Error ? error.message : 'PLANNER_FAILED' }, 400);
  }
});

import { Hono } from 'hono';
import { z } from 'zod';
import { accessError, requireWorkspaceAccess } from '../auth/guard';
import type { Env } from '../env';
import { requireDatabase } from '../env';
import { financeSyncHandler } from './finance.sync';
import { getSyncHandler, type SyncMutation } from './contracts';
import { tutoringSyncHandler } from './tutoring.sync';

const handlers = [tutoringSyncHandler, financeSyncHandler] as const;

const mutationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  moduleKey: z.string().min(1).max(80),
  operation: z.string().min(1).max(100),
  entityType: z.string().min(1).max(100),
  entityId: z.string().uuid(),
  payload: z.unknown(),
  createdAt: z.string().min(10).max(40),
});

const pushSchema = z.object({
  mutations: z.array(mutationSchema).max(100),
});

type MutationResult = {
  mutationId: string;
  status: 'applied' | 'duplicate' | 'failed';
  error?: string;
};

async function applyMutation(
  db: D1Database,
  workspaceId: string,
  mutation: SyncMutation,
): Promise<MutationResult> {
  if (mutation.workspaceId !== workspaceId) {
    return { mutationId: mutation.id, status: 'failed', error: 'SYNC_WORKSPACE_MISMATCH' };
  }

  const previous = await db.prepare(
    `SELECT status FROM core_idempotency_keys
     WHERE workspace_id = ?1 AND idempotency_key = ?2`,
  ).bind(workspaceId, mutation.id).first<{ status: 'pending' | 'done' }>();

  if (previous?.status === 'done') {
    return { mutationId: mutation.id, status: 'duplicate' };
  }

  await db.prepare(
    `INSERT OR IGNORE INTO core_idempotency_keys(
       workspace_id, idempotency_key, method, path, status
     ) VALUES (?1, ?2, 'SYNC', ?3, 'pending')`,
  ).bind(workspaceId, mutation.id, `${mutation.moduleKey}:${mutation.operation}`).run();

  try {
    const handler = getSyncHandler(handlers, mutation.moduleKey);
    await handler.apply(db, workspaceId, mutation);
    await db.prepare(
      `UPDATE core_idempotency_keys
       SET status = 'done', response_status = 200, completed_at = CURRENT_TIMESTAMP
       WHERE workspace_id = ?1 AND idempotency_key = ?2`,
    ).bind(workspaceId, mutation.id).run();
    return { mutationId: mutation.id, status: 'applied' };
  } catch (error) {
    return {
      mutationId: mutation.id,
      status: 'failed',
      error: error instanceof Error ? error.message : 'SYNC_MUTATION_FAILED',
    };
  }
}

function routeError(error: unknown): { status: 400 | 401 | 403 | 503; error: string } {
  const access = accessError(error);
  if (access) return access;
  if (error instanceof z.ZodError) return { status: 400, error: 'INVALID_SYNC_PAYLOAD' };
  return { status: 400, error: error instanceof Error ? error.message : 'SYNC_FAILED' };
}

export const syncRoutes = new Hono<{ Bindings: Env }>();

syncRoutes.post('/:workspaceId/push', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId, true);
    const parsed = pushSchema.parse(await c.req.json());
    const db = requireDatabase(c.env);
    const results: MutationResult[] = [];
    for (const mutation of parsed.mutations) {
      results.push(await applyMutation(db, workspaceId, mutation));
    }
    return c.json({ results, serverTime: new Date().toISOString() });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

syncRoutes.get('/:workspaceId/snapshot', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId);
    const db = requireDatabase(c.env);
    const modules = await Promise.all(handlers.map((handler) => handler.snapshot(db, workspaceId)));
    return c.json({
      workspaceId,
      generatedAt: new Date().toISOString(),
      modules,
    });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

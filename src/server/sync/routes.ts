import { Hono } from 'hono';
import { z } from 'zod';
import { accessError, requireWorkspaceAccess } from '../auth/guard';
import type { Env } from '../env';
import { requireDatabase } from '../env';
import { getSyncHandler, type SyncMutation } from './contracts';
import { syncHandlers, syncPostApplyHooks } from './registry';

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
  baseRevision: z.number().int().min(0),
  mutations: z.array(mutationSchema).max(100),
});

type MutationResult =
  | { mutationId: string; status: 'applied' | 'duplicate' }
  | { mutationId: string; status: 'failed'; error: string; retryable: boolean };

const TERMINAL_MUTATION_ERRORS = new Set([
  'SYNC_WORKSPACE_MISMATCH',
  'SYNC_MODULE_UNSUPPORTED',
  'SYNC_OPERATION_UNSUPPORTED',
  'STUDENT_NOT_FOUND',
  'SESSION_NOT_FOUND',
  'SESSION_ARCHIVED',
  'SESSION_FINANCE_LOCKED_BY_HISTORY',
  'SCHEDULE_DAY_REQUIRED',
  'SCHEDULE_TIME_REQUIRED',
  'BILLING_MODE_LOCKED_BY_HISTORY',
  'OPENING_PROGRESS_EXCEEDS_PACKAGE',
  'OPENING_PROGRESS_LOCKED_BY_REAL_LESSONS',
  'OCCURRENCE_NOT_FOUND',
  'OCCURRENCE_STATE_INVALID',
  'COMPLETED_REQUIRES_CORRECTION_FLOW',
  'OCCURRENCE_PARTICIPANT_INVALID',
  'OCCURRENCE_PARTICIPANT_REQUIRED',
  'SCHEDULE_CONFLICT',
  'PACKAGE_CYCLE_ALREADY_COMPLETE',
  'RECEIPT_ID_CONFLICT',
  'RECEIPT_NOT_FOUND',
  'RECEIPT_OVERALLOCATED',
  'RECEIPT_ALLOCATION_EXCEEDS_AMOUNT',
  'ALLOCATION_CONFLICT',
  'ALLOCATION_AMOUNT_INVALID',
  'COMPLETED_APPOINTMENT_REQUIRES_REOPEN',
]);

function classifyMutationError(error: unknown): { error: string; retryable: boolean } {
  if (error instanceof z.ZodError) return { error: 'INVALID_SYNC_PAYLOAD', retryable: false };
  const code = error instanceof Error ? error.message : 'SYNC_MUTATION_FAILED';
  return { error: code, retryable: !TERMINAL_MUTATION_ERRORS.has(code) };
}

async function applyMutation(
  db: D1Database,
  workspaceId: string,
  mutation: SyncMutation,
): Promise<MutationResult> {
  if (mutation.workspaceId !== workspaceId) {
    return { mutationId: mutation.id, status: 'failed', error: 'SYNC_WORKSPACE_MISMATCH', retryable: false };
  }

  const previous = await db.prepare(
    `SELECT status FROM core_idempotency_keys
     WHERE workspace_id=?1 AND idempotency_key=?2`,
  ).bind(workspaceId, mutation.id).first<{ status: 'pending' | 'done' }>();
  if (previous?.status === 'done') return { mutationId: mutation.id, status: 'duplicate' };

  await db.prepare(
    `INSERT OR IGNORE INTO core_idempotency_keys(
       workspace_id,idempotency_key,method,path,status
     ) VALUES(?1,?2,'SYNC',?3,'pending')`,
  ).bind(workspaceId, mutation.id, `${mutation.moduleKey}:${mutation.operation}`).run();

  try {
    await getSyncHandler(syncHandlers, mutation.moduleKey).apply(db, workspaceId, mutation);
    for (const hook of syncPostApplyHooks) {
      if (hook.supports(mutation)) await hook.afterApply(db, workspaceId, mutation);
    }
    await db.prepare(
      `UPDATE core_idempotency_keys
       SET status='done',response_status=200,completed_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?1 AND idempotency_key=?2`,
    ).bind(workspaceId, mutation.id).run();
    return { mutationId: mutation.id, status: 'applied' };
  } catch (error) {
    const classified = classifyMutationError(error);
    return { mutationId: mutation.id, status: 'failed', ...classified };
  }
}

async function currentWorkspaceRevision(db: D1Database, workspaceId: string): Promise<number> {
  await db.prepare(
    `INSERT OR IGNORE INTO core_workspace_sync_revisions(workspace_id, revision)
     VALUES(?1, 0)`,
  ).bind(workspaceId).run();
  const row = await db.prepare(
    `SELECT revision FROM core_workspace_sync_revisions WHERE workspace_id=?1`,
  ).bind(workspaceId).first<{ revision: number }>();
  return Math.max(0, Number(row?.revision ?? 0));
}

async function reserveWorkspaceRevision(
  db: D1Database,
  workspaceId: string,
  expectedRevision: number,
): Promise<{ ok: true; revision: number } | { ok: false; revision: number }> {
  await db.prepare(
    `INSERT OR IGNORE INTO core_workspace_sync_revisions(workspace_id, revision)
     VALUES(?1, 0)`,
  ).bind(workspaceId).run();

  const result = await db.prepare(
    `UPDATE core_workspace_sync_revisions
     SET revision=revision+1, updated_at=CURRENT_TIMESTAMP
     WHERE workspace_id=?1 AND revision=?2`,
  ).bind(workspaceId, expectedRevision).run();

  if ((result.meta?.changes ?? 0) === 0) {
    return { ok: false, revision: await currentWorkspaceRevision(db, workspaceId) };
  }
  return { ok: true, revision: expectedRevision + 1 };
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

    const reserved = await reserveWorkspaceRevision(db, workspaceId, parsed.baseRevision);
    if (!reserved.ok) {
      const results: MutationResult[] = parsed.mutations.map((mutation) => ({
        mutationId: mutation.id,
        status: 'failed',
        error: 'SYNC_REVISION_CONFLICT',
        retryable: false,
      }));
      return c.json({
        results,
        serverTime: new Date().toISOString(),
        revision: reserved.revision,
      });
    }

    const results: MutationResult[] = [];
    for (const mutation of parsed.mutations) {
      results.push(await applyMutation(db, workspaceId, mutation));
    }
    return c.json({
      results,
      serverTime: new Date().toISOString(),
      revision: reserved.revision,
    });
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
    const [modules, revision] = await Promise.all([
      Promise.all(syncHandlers.map((handler) => handler.snapshot(db, workspaceId))),
      currentWorkspaceRevision(db, workspaceId),
    ]);
    return c.json({
      workspaceId,
      generatedAt: new Date().toISOString(),
      revision,
      modules,
    });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

import { Hono } from 'hono';
import { z } from 'zod';
import { accessError, requireWorkspaceAccess } from '../auth/guard';
import type { Env } from '../env';
import { requireDatabase } from '../env';
import { reconcileWorkspaceFinancialState } from '../integrations/financial-reconcile';
import { appointmentsSyncHandler } from './appointments.sync';
import { coreSyncHandler } from './core.sync';
import { financeSyncHandler } from './finance.sync';
import { getSyncHandler, type SyncMutation } from './contracts';
import { tutoringSyncHandler } from './tutoring.sync';

const handlers = [coreSyncHandler, tutoringSyncHandler, appointmentsSyncHandler, financeSyncHandler] as const;

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

const pushSchema = z.object({ mutations: z.array(mutationSchema).max(100) });

const sessionDetailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sessionType: z.enum(['private_student_home', 'private_tutor_home', 'online', 'center_group', 'own_group']),
  scheduleStatus: z.enum(['confirmed', 'pending']),
  weekday: z.number().int().min(0).max(6).nullable(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable(),
  durationMinutes: z.number().int().min(15).max(360),
  travelMinutes: z.number().int().min(0).max(360),
  location: z.string().trim().max(200).nullable(),
  priceBasis: z.enum(['total_session', 'per_student']),
  defaultPricePence: z.number().int().min(0),
  expectedStudentCount: z.number().int().min(1).max(100),
  centerCutBps: z.number().int().min(0).max(10_000),
  studentIds: z.array(z.string().uuid()).max(100),
}).superRefine((value, ctx) => {
  if (value.scheduleStatus === 'confirmed' && value.weekday === null) ctx.addIssue({ code: 'custom', message: 'SCHEDULE_DAY_REQUIRED', path: ['weekday'] });
  if (value.scheduleStatus === 'confirmed' && value.startTime === null) ctx.addIssue({ code: 'custom', message: 'SCHEDULE_TIME_REQUIRED', path: ['startTime'] });
});

type MutationResult = { mutationId: string; status: 'applied' | 'duplicate' | 'failed'; error?: string };

async function currentSessionFinanceShape(db: D1Database, workspaceId: string, sessionId: string) {
  const session = await db.prepare(
    `SELECT price_basis,default_price_pence,expected_student_count,center_cut_bps
     FROM tutoring_recurring_sessions WHERE workspace_id=?1 AND id=?2`,
  ).bind(workspaceId, sessionId).first<{
    price_basis: 'total_session' | 'per_student'; default_price_pence: number; expected_student_count: number; center_cut_bps: number;
  }>();
  if (!session) throw new Error('SESSION_NOT_FOUND');
  const students = await db.prepare(
    `SELECT student_id FROM tutoring_session_students WHERE workspace_id=?1 AND recurring_session_id=?2 ORDER BY student_id`,
  ).bind(workspaceId, sessionId).all<{ student_id: string }>();
  return { session, studentIds: (students.results ?? []).map((row) => row.student_id) };
}

async function applyTutoringHardeningMutation(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<boolean> {
  if (mutation.moduleKey !== 'tutoring') return false;
  if (mutation.operation === 'session.details.update') {
    const parsed = sessionDetailsSchema.parse(mutation.payload);
    const current = await currentSessionFinanceShape(db, workspaceId, mutation.entityId);
    const hasHistory = Boolean(await db.prepare(
      `SELECT 1 AS found FROM tutoring_occurrences WHERE workspace_id=?1 AND recurring_session_id=?2 AND status IN ('completed','cancelled','missed') LIMIT 1`,
    ).bind(workspaceId, mutation.entityId).first<{ found: number }>());
    if (hasHistory) {
      const nextStudents = [...parsed.studentIds].sort();
      const currentStudents = [...current.studentIds].sort();
      const financeChanged = parsed.priceBasis !== current.session.price_basis
        || parsed.defaultPricePence !== current.session.default_price_pence
        || parsed.expectedStudentCount !== current.session.expected_student_count
        || parsed.centerCutBps !== current.session.center_cut_bps
        || JSON.stringify(nextStudents) !== JSON.stringify(currentStudents);
      if (financeChanged) throw new Error('SESSION_FINANCE_LOCKED_BY_HISTORY');
    }
    for (const studentId of parsed.studentIds) {
      const exists = await db.prepare(`SELECT 1 AS found FROM tutoring_students WHERE workspace_id=?1 AND id=?2 AND deleted_at IS NULL`).bind(workspaceId, studentId).first<{ found: number }>();
      if (!exists) throw new Error('STUDENT_NOT_FOUND');
    }
    const result = await db.prepare(
      `UPDATE tutoring_recurring_sessions SET
       title=?1,session_type=?2,schedule_status=?3,weekday=?4,start_time=?5,duration_minutes=?6,travel_minutes=?7,location=?8,
       price_basis=?9,default_price_pence=?10,expected_student_count=?11,center_cut_bps=?12,updated_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?13 AND id=?14 AND active=1 AND deleted_at IS NULL`,
    ).bind(parsed.title, parsed.sessionType, parsed.scheduleStatus, parsed.weekday, parsed.startTime, parsed.durationMinutes, parsed.travelMinutes,
      parsed.location, parsed.priceBasis, parsed.defaultPricePence, parsed.expectedStudentCount, parsed.centerCutBps, workspaceId, mutation.entityId).run();
    if ((result.meta?.changes ?? 0) === 0) throw new Error('SESSION_NOT_FOUND');
    await db.prepare(`DELETE FROM tutoring_session_students WHERE workspace_id=?1 AND recurring_session_id=?2`).bind(workspaceId, mutation.entityId).run();
    for (const studentId of parsed.studentIds) {
      await db.prepare(`INSERT INTO tutoring_session_students(workspace_id,recurring_session_id,student_id) VALUES(?1,?2,?3)`).bind(workspaceId, mutation.entityId, studentId).run();
    }
    return true;
  }
  if (mutation.operation === 'session.archive') {
    const result = await db.prepare(`UPDATE tutoring_recurring_sessions SET active=0,deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?1 AND id=?2`).bind(workspaceId, mutation.entityId).run();
    if ((result.meta?.changes ?? 0) === 0) throw new Error('SESSION_NOT_FOUND');
    return true;
  }
  if (mutation.operation === 'session.restore') {
    const result = await db.prepare(`UPDATE tutoring_recurring_sessions SET active=1,deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?1 AND id=?2`).bind(workspaceId, mutation.entityId).run();
    if ((result.meta?.changes ?? 0) === 0) throw new Error('SESSION_NOT_FOUND');
    return true;
  }
  return false;
}

async function applyMutation(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<MutationResult> {
  if (mutation.workspaceId !== workspaceId) return { mutationId: mutation.id, status: 'failed', error: 'SYNC_WORKSPACE_MISMATCH' };
  const previous = await db.prepare(`SELECT status FROM core_idempotency_keys WHERE workspace_id=?1 AND idempotency_key=?2`).bind(workspaceId, mutation.id).first<{ status: 'pending' | 'done' }>();
  if (previous?.status === 'done') return { mutationId: mutation.id, status: 'duplicate' };
  await db.prepare(`INSERT OR IGNORE INTO core_idempotency_keys(workspace_id,idempotency_key,method,path,status) VALUES(?1,?2,'SYNC',?3,'pending')`).bind(workspaceId, mutation.id, `${mutation.moduleKey}:${mutation.operation}`).run();
  try {
    const handled = await applyTutoringHardeningMutation(db, workspaceId, mutation);
    if (!handled) await getSyncHandler(handlers, mutation.moduleKey).apply(db, workspaceId, mutation);
    if (mutation.moduleKey === 'tutoring') await reconcileWorkspaceFinancialState(db, workspaceId);
    await db.prepare(`UPDATE core_idempotency_keys SET status='done',response_status=200,completed_at=CURRENT_TIMESTAMP WHERE workspace_id=?1 AND idempotency_key=?2`).bind(workspaceId, mutation.id).run();
    return { mutationId: mutation.id, status: 'applied' };
  } catch (error) {
    return { mutationId: mutation.id, status: 'failed', error: error instanceof Error ? error.message : 'SYNC_MUTATION_FAILED' };
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
    for (const mutation of parsed.mutations) results.push(await applyMutation(db, workspaceId, mutation));
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
    return c.json({ workspaceId, generatedAt: new Date().toISOString(), modules });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

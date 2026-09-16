import { createRecurringSessionSchema, updateRecurringScheduleSchema } from '../../modules/tutoring/domain/session';
import { createStudentSchema } from '../../modules/tutoring/domain/student';
import { D1SessionRepository } from '../adapters/d1/tutoring-sessions.repository';
import { D1StudentRepository } from '../adapters/d1/tutoring-students.repository';
import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';

type OccurrenceRow = {
  id: string;
  workspace_id: string;
  recurring_session_id: string;
  session_date: string;
  scheduled_start: string | null;
  rescheduled_to_date: string | null;
  rescheduled_to_start: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'missed';
  gross_pence: number;
  center_cut_pence: number;
  earned_pence: number;
  completed_at: string | null;
  note: string | null;
};

type BillingPlanRow = {
  workspace_id: string;
  student_id: string;
  billing_mode: 'per_session' | 'package';
  package_size: number | null;
  package_price_pence: number | null;
  cycle_anchor_date: string | null;
  effective_from: string;
};

type BillingCycleRow = {
  id: string;
  workspace_id: string;
  student_id: string;
  sequence_no: number;
  session_limit: number;
  price_pence: number;
  opening_completed_count: number;
  status: 'open' | 'due' | 'paid' | 'cancelled';
  started_on: string | null;
  completed_on: string | null;
  paid_on: string | null;
};

async function entityExists(
  db: D1Database,
  table: string,
  workspaceId: string,
  entityId: string,
): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS found FROM ${table} WHERE workspace_id = ?1 AND id = ?2 LIMIT 1`)
    .bind(workspaceId, entityId)
    .first<{ found: number }>();
  return Boolean(row);
}

export const tutoringSyncHandler: ModuleSyncHandler = {
  moduleKey: 'tutoring',

  async apply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void> {
    if (mutation.operation === 'student.create') {
      if (await entityExists(db, 'tutoring_students', workspaceId, mutation.entityId)) return;
      const parsed = createStudentSchema.parse(mutation.payload);
      await new D1StudentRepository(db).create({
        ...parsed,
        id: mutation.entityId,
        workspaceId,
      });
      return;
    }

    if (mutation.operation === 'session.create') {
      if (await entityExists(db, 'tutoring_recurring_sessions', workspaceId, mutation.entityId)) return;
      const parsed = createRecurringSessionSchema.parse(mutation.payload);
      await new D1SessionRepository(db).create({
        ...parsed,
        id: mutation.entityId,
        workspaceId,
      });
      return;
    }

    if (mutation.operation === 'session.schedule.update') {
      const parsed = updateRecurringScheduleSchema.parse(mutation.payload);
      await new D1SessionRepository(db).updateSchedule({
        workspaceId,
        sessionId: mutation.entityId,
        ...parsed,
      });
      return;
    }

    throw new Error('SYNC_OPERATION_UNSUPPORTED');
  },

  async snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot> {
    const [students, sessions, occurrencesResult, plansResult, cyclesResult] = await Promise.all([
      new D1StudentRepository(db).listActive(workspaceId),
      new D1SessionRepository(db).listActive(workspaceId),
      db.prepare(
        `SELECT id, workspace_id, recurring_session_id, session_date, scheduled_start,
                rescheduled_to_date, rescheduled_to_start, status, gross_pence,
                center_cut_pence, earned_pence, completed_at, note
         FROM tutoring_occurrences
         WHERE workspace_id = ?1
         ORDER BY session_date, scheduled_start, id`,
      ).bind(workspaceId).all<OccurrenceRow>(),
      db.prepare(
        `SELECT workspace_id, student_id, billing_mode, package_size, package_price_pence,
                cycle_anchor_date, effective_from
         FROM tutoring_billing_plans
         WHERE workspace_id = ?1
         ORDER BY student_id`,
      ).bind(workspaceId).all<BillingPlanRow>(),
      db.prepare(
        `SELECT id, workspace_id, student_id, sequence_no, session_limit, price_pence,
                opening_completed_count, status, started_on, completed_on, paid_on
         FROM tutoring_billing_cycles
         WHERE workspace_id = ?1
         ORDER BY student_id, sequence_no`,
      ).bind(workspaceId).all<BillingCycleRow>(),
    ]);

    const occurrenceRows = occurrencesResult.results ?? [];
    const studentIdsBySession = new Map<string, string[]>();
    const links = await db.prepare(
      `SELECT recurring_session_id, student_id
       FROM tutoring_session_students
       WHERE workspace_id = ?1
       ORDER BY recurring_session_id, student_id`,
    ).bind(workspaceId).all<{ recurring_session_id: string; student_id: string }>();
    for (const row of links.results ?? []) {
      const current = studentIdsBySession.get(row.recurring_session_id) ?? [];
      current.push(row.student_id);
      studentIdsBySession.set(row.recurring_session_id, current);
    }

    return {
      moduleKey: 'tutoring',
      data: {
        students,
        sessions,
        occurrences: occurrenceRows.map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          recurringSessionId: row.recurring_session_id,
          sessionDate: row.session_date,
          scheduledStart: row.scheduled_start,
          rescheduledToDate: row.rescheduled_to_date,
          rescheduledToStart: row.rescheduled_to_start,
          status: row.status,
          grossPence: row.gross_pence,
          centerCutPence: row.center_cut_pence,
          earnedPence: row.earned_pence,
          completedAt: row.completed_at,
          note: row.note,
          studentIds: studentIdsBySession.get(row.recurring_session_id) ?? [],
        })),
        billingPlans: (plansResult.results ?? []).map((row) => ({
          id: row.student_id,
          workspaceId: row.workspace_id,
          studentId: row.student_id,
          billingMode: row.billing_mode,
          packageSize: row.package_size,
          packagePricePence: row.package_price_pence,
          cycleAnchorDate: row.cycle_anchor_date,
          effectiveFrom: row.effective_from,
        })),
        billingCycles: (cyclesResult.results ?? []).map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          studentId: row.student_id,
          sequenceNo: row.sequence_no,
          sessionLimit: row.session_limit,
          pricePence: row.price_pence,
          openingCompletedCount: row.opening_completed_count,
          status: row.status,
          startedOn: row.started_on,
          completedOn: row.completed_on,
          paidOn: row.paid_on,
        })),
      },
    };
  },
};

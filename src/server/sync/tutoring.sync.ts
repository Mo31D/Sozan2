import { z } from 'zod';
import { createRecurringSessionSchema, updateRecurringScheduleSchema } from '../../modules/tutoring/domain/session';
import { createStudentSchema } from '../../modules/tutoring/domain/student';
import { BillingService } from '../../modules/tutoring/services/billing.service';
import { OccurrencesService } from '../../modules/tutoring/services/occurrences.service';
import { D1BillingRepository } from '../adapters/d1/tutoring-billing.repository';
import { D1OccurrenceRepository } from '../adapters/d1/tutoring-occurrences.repository';
import { D1SessionRepository } from '../adapters/d1/tutoring-sessions.repository';
import { D1StudentRepository } from '../adapters/d1/tutoring-students.repository';
import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';

const completeOccurrenceMutationSchema = z.object({
  recurringSessionId: z.string().uuid(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  scheduledStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable(),
  completedAt: z.string().min(10).max(50),
  note: z.string().trim().max(500).nullable().optional().default(null),
});

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
  real_completed_count: number;
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

    if (mutation.operation === 'billing.configure') {
      const student = await db.prepare(
        `SELECT 1 AS found FROM tutoring_students
         WHERE workspace_id = ?1 AND id = ?2 AND deleted_at IS NULL LIMIT 1`,
      ).bind(workspaceId, mutation.entityId).first<{ found: number }>();
      if (!student) throw new Error('STUDENT_NOT_FOUND');
      const service = new BillingService(new D1BillingRepository(db), crypto.randomUUID);
      await service.configure(workspaceId, mutation.entityId, mutation.payload);
      return;
    }

    if (mutation.operation === 'occurrence.complete') {
      const parsed = completeOccurrenceMutationSchema.parse(mutation.payload);
      const session = await db.prepare(
        `SELECT 1 AS found FROM tutoring_recurring_sessions
         WHERE workspace_id=?1 AND id=?2 AND deleted_at IS NULL LIMIT 1`,
      ).bind(workspaceId, parsed.recurringSessionId).first<{ found: number }>();
      if (!session) throw new Error('SESSION_NOT_FOUND');

      const occurrences = new D1OccurrenceRepository(db);
      const existing = await db.prepare(
        `SELECT id FROM tutoring_occurrences
         WHERE workspace_id=?1 AND recurring_session_id=?2 AND session_date=?3 LIMIT 1`,
      ).bind(workspaceId, parsed.recurringSessionId, parsed.sessionDate).first<{ id: string }>();
      const occurrenceId = existing?.id ?? mutation.entityId;
      if (!existing) {
        await occurrences.insertScheduled([{
          id: occurrenceId,
          workspaceId,
          recurringSessionId: parsed.recurringSessionId,
          sessionDate: parsed.sessionDate,
          scheduledStart: parsed.scheduledStart,
        }]);
      }

      const billing = new BillingService(new D1BillingRepository(db), crypto.randomUUID);
      const service = new OccurrencesService(
        occurrences,
        new D1SessionRepository(db),
        billing,
        crypto.randomUUID,
      );
      await service.complete(workspaceId, occurrenceId, {
        completedAt: parsed.completedAt,
        note: parsed.note,
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
        `SELECT c.id, c.workspace_id, c.student_id, c.sequence_no, c.session_limit, c.price_pence,
                c.opening_completed_count,
                (SELECT COUNT(*) FROM tutoring_billing_cycle_occurrences co
                  WHERE co.workspace_id = c.workspace_id AND co.billing_cycle_id = c.id) AS real_completed_count,
                c.status, c.started_on, c.completed_on, c.paid_on
         FROM tutoring_billing_cycles c
         WHERE c.workspace_id = ?1
         ORDER BY c.student_id, c.sequence_no`,
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
          realCompletedCount: row.real_completed_count,
          status: row.status,
          startedOn: row.started_on,
          completedOn: row.completed_on,
          paidOn: row.paid_on,
        })),
      },
    };
  },
};

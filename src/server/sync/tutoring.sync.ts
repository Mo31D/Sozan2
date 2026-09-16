import { z } from 'zod';
import { FinanceCollectionService } from '../../modules/finance/allocation.service';
import { packageUnitShare } from '../../modules/tutoring/domain/billing';
import { createRecurringSessionSchema, updateRecurringScheduleSchema } from '../../modules/tutoring/domain/session';
import { createStudentSchema, updateStudentSchema } from '../../modules/tutoring/domain/student';
import { BillingService } from '../../modules/tutoring/services/billing.service';
import { OccurrencesService } from '../../modules/tutoring/services/occurrences.service';
import { D1FinanceGateway } from '../adapters/d1/finance.gateway';
import { D1BillingRepository } from '../adapters/d1/tutoring-billing.repository';
import { D1OccurrenceRepository } from '../adapters/d1/tutoring-occurrences.repository';
import { D1SessionRepository } from '../adapters/d1/tutoring-sessions.repository';
import { D1StudentRepository } from '../adapters/d1/tutoring-students.repository';
import { TutoringObligationProvider } from '../integrations/tutoring-obligations.provider';
import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';

const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const completeOccurrenceMutationSchema = z.object({
  recurringSessionId: z.string().uuid(),
  sessionDate: dateSchema,
  scheduledStart: clockSchema.nullable(),
  completedAt: z.string().min(10).max(50),
  note: z.string().trim().max(500).nullable().optional().default(null),
});
const rescheduleMutationSchema = z.object({
  date: dateSchema,
  startTime: clockSchema.nullable(),
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

type CycleOccurrenceRow = {
  billing_cycle_id: string;
  occurrence_id: string;
  position: number;
  earned_pence: number;
};

type ReceiptRow = {
  id: string;
  amount_pence: number;
  received_at: string;
  payment_method: 'cash' | 'bank' | 'wallet' | 'other';
  source_kind: 'manual' | 'quick' | 'migration';
  source_module: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  note: string | null;
  deleted_at: string | null;
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

async function rebuildStudentAllocations(db: D1Database, workspaceId: string, studentId: string): Promise<void> {
  const receipts = await db.prepare(
    `SELECT id, amount_pence, received_at, payment_method, source_kind,
            source_module, source_entity_type, source_entity_id, note, deleted_at
     FROM finance_receipts
     WHERE workspace_id=?1 AND payer_ref_type='tutoring.student' AND payer_ref_id=?2
     ORDER BY received_at, id`,
  ).bind(workspaceId, studentId).all<ReceiptRow>();
  await db.prepare(
    `DELETE FROM finance_receipt_allocations WHERE workspace_id=?1 AND receipt_id IN (
       SELECT id FROM finance_receipts
       WHERE workspace_id=?1 AND payer_ref_type='tutoring.student' AND payer_ref_id=?2
     )`,
  ).bind(workspaceId, studentId).run();
  const service = new FinanceCollectionService(
    new D1FinanceGateway(db),
    [new TutoringObligationProvider(db)],
    () => crypto.randomUUID(),
  );
  for (const receipt of receipts.results ?? []) {
    if (receipt.deleted_at) continue;
    const source = receipt.source_module && receipt.source_entity_type && receipt.source_entity_id
      ? { module: receipt.source_module, type: receipt.source_entity_type, id: receipt.source_entity_id }
      : undefined;
    await service.collect({
      receiptId: receipt.id,
      workspaceId,
      payer: { type: 'tutoring.student', id: studentId },
      amountPence: receipt.amount_pence,
      receivedAt: receipt.received_at,
      paymentMethod: receipt.payment_method,
      sourceKind: receipt.source_kind,
      source,
      note: receipt.note,
    });
  }
}

async function reopenCompletedOccurrence(db: D1Database, workspaceId: string, occurrenceId: string): Promise<void> {
  const occurrence = await db.prepare(
    `SELECT id, status FROM tutoring_occurrences WHERE workspace_id=?1 AND id=?2`,
  ).bind(workspaceId, occurrenceId).first<{ id: string; status: string }>();
  if (!occurrence) throw new Error('OCCURRENCE_NOT_FOUND');
  if (occurrence.status !== 'completed') {
    if (occurrence.status === 'scheduled') return;
    throw new Error('OCCURRENCE_STATE_INVALID');
  }

  const affected = await db.prepare(
    `SELECT co.billing_cycle_id, c.student_id, c.session_limit, c.price_pence,
            c.opening_completed_count
     FROM tutoring_billing_cycle_occurrences co
     JOIN tutoring_billing_cycles c
       ON c.workspace_id=co.workspace_id AND c.id=co.billing_cycle_id
     WHERE co.workspace_id=?1 AND co.occurrence_id=?2`,
  ).bind(workspaceId, occurrenceId).all<{
    billing_cycle_id: string;
    student_id: string;
    session_limit: number;
    price_pence: number;
    opening_completed_count: number;
  }>();

  await db.prepare(
    `DELETE FROM tutoring_billing_cycle_occurrences
     WHERE workspace_id=?1 AND occurrence_id=?2`,
  ).bind(workspaceId, occurrenceId).run();

  const studentIds = new Set<string>();
  for (const cycle of affected.results ?? []) {
    studentIds.add(cycle.student_id);
    await db.prepare(
      `UPDATE tutoring_billing_cycle_occurrences
       SET position=position+10000
       WHERE workspace_id=?1 AND billing_cycle_id=?2`,
    ).bind(workspaceId, cycle.billing_cycle_id).run();
    const remaining = await db.prepare(
      `SELECT occurrence_id, position FROM tutoring_billing_cycle_occurrences
       WHERE workspace_id=?1 AND billing_cycle_id=?2 ORDER BY position`,
    ).bind(workspaceId, cycle.billing_cycle_id).all<{ occurrence_id: string; position: number }>();
    let index = 0;
    for (const row of remaining.results ?? []) {
      index += 1;
      const position = cycle.opening_completed_count + index;
      const earned = packageUnitShare(cycle.price_pence, cycle.session_limit, position);
      await db.prepare(
        `UPDATE tutoring_billing_cycle_occurrences
         SET position=?1, earned_pence=?2
         WHERE workspace_id=?3 AND billing_cycle_id=?4 AND occurrence_id=?5`,
      ).bind(position, earned, workspaceId, cycle.billing_cycle_id, row.occurrence_id).run();
    }
    const completed = cycle.opening_completed_count + index >= cycle.session_limit;
    let completedOn: string | null = null;
    if (completed) {
      const latest = await db.prepare(
        `SELECT MAX(COALESCE(o.rescheduled_to_date,o.session_date)) AS date
         FROM tutoring_billing_cycle_occurrences co
         JOIN tutoring_occurrences o ON o.workspace_id=co.workspace_id AND o.id=co.occurrence_id
         WHERE co.workspace_id=?1 AND co.billing_cycle_id=?2`,
      ).bind(workspaceId, cycle.billing_cycle_id).first<{ date: string | null }>();
      completedOn = latest?.date ?? null;
    }
    await db.prepare(
      `UPDATE tutoring_billing_cycles
       SET status=?1, completed_on=?2, paid_on=NULL, updated_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?3 AND id=?4`,
    ).bind(completed ? 'due' : 'open', completedOn, workspaceId, cycle.billing_cycle_id).run();
  }

  await db.prepare(
    `UPDATE tutoring_occurrences
     SET status='scheduled', gross_pence=0, center_cut_pence=0, earned_pence=0,
         completed_at=NULL, updated_at=CURRENT_TIMESTAMP
     WHERE workspace_id=?1 AND id=?2`,
  ).bind(workspaceId, occurrenceId).run();

  const directStudents = await db.prepare(
    `SELECT ss.student_id FROM tutoring_occurrences o
     JOIN tutoring_session_students ss
       ON ss.workspace_id=o.workspace_id AND ss.recurring_session_id=o.recurring_session_id
     WHERE o.workspace_id=?1 AND o.id=?2`,
  ).bind(workspaceId, occurrenceId).all<{ student_id: string }>();
  for (const row of directStudents.results ?? []) studentIds.add(row.student_id);
  for (const studentId of studentIds) await rebuildStudentAllocations(db, workspaceId, studentId);
}

export const tutoringSyncHandler: ModuleSyncHandler = {
  moduleKey: 'tutoring',

  async apply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void> {
    if (mutation.operation === 'student.create') {
      if (await entityExists(db, 'tutoring_students', workspaceId, mutation.entityId)) return;
      const parsed = createStudentSchema.parse(mutation.payload);
      await new D1StudentRepository(db).create({ ...parsed, id: mutation.entityId, workspaceId });
      return;
    }

    if (mutation.operation === 'student.update') {
      const parsed = updateStudentSchema.parse(mutation.payload);
      const result = await db.prepare(
        `UPDATE tutoring_students
         SET name=?1, age=?2, guardian_name=?3, guardian_phone=?4, level=?5, notes=?6,
             updated_at=CURRENT_TIMESTAMP
         WHERE workspace_id=?7 AND id=?8 AND deleted_at IS NULL`,
      ).bind(
        parsed.name,
        parsed.age,
        parsed.guardianName,
        parsed.guardianPhone,
        parsed.level,
        parsed.notes,
        workspaceId,
        mutation.entityId,
      ).run();
      if ((result.meta?.changes ?? 0) === 0) throw new Error('STUDENT_NOT_FOUND');
      return;
    }

    if (mutation.operation === 'session.create') {
      if (await entityExists(db, 'tutoring_recurring_sessions', workspaceId, mutation.entityId)) return;
      const parsed = createRecurringSessionSchema.parse(mutation.payload);
      await new D1SessionRepository(db).create({ ...parsed, id: mutation.entityId, workspaceId });
      return;
    }

    if (mutation.operation === 'session.schedule.update') {
      const parsed = updateRecurringScheduleSchema.parse(mutation.payload);
      await new D1SessionRepository(db).updateSchedule({ workspaceId, sessionId: mutation.entityId, ...parsed });
      return;
    }

    if (mutation.operation === 'billing.configure') {
      const student = await db.prepare(
        `SELECT 1 AS found FROM tutoring_students
         WHERE workspace_id = ?1 AND id = ?2 AND deleted_at IS NULL LIMIT 1`,
      ).bind(workspaceId, mutation.entityId).first<{ found: number }>();
      if (!student) throw new Error('STUDENT_NOT_FOUND');
      const service = new BillingService(new D1BillingRepository(db), () => crypto.randomUUID());
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
      const service = new OccurrencesService(
        occurrences,
        new D1SessionRepository(db),
        new BillingService(new D1BillingRepository(db), () => crypto.randomUUID()),
        () => crypto.randomUUID(),
      );
      await service.complete(workspaceId, occurrenceId, { completedAt: parsed.completedAt, note: parsed.note });
      return;
    }

    if (mutation.operation === 'occurrence.cancel') {
      await new OccurrencesService(
        new D1OccurrenceRepository(db),
        new D1SessionRepository(db),
        new BillingService(new D1BillingRepository(db), () => crypto.randomUUID()),
        () => crypto.randomUUID(),
      ).cancel(workspaceId, mutation.entityId);
      return;
    }

    if (mutation.operation === 'occurrence.restore') {
      await new OccurrencesService(
        new D1OccurrenceRepository(db),
        new D1SessionRepository(db),
        new BillingService(new D1BillingRepository(db), () => crypto.randomUUID()),
        () => crypto.randomUUID(),
      ).restore(workspaceId, mutation.entityId);
      return;
    }

    if (mutation.operation === 'occurrence.reschedule') {
      const parsed = rescheduleMutationSchema.parse(mutation.payload);
      await new OccurrencesService(
        new D1OccurrenceRepository(db),
        new D1SessionRepository(db),
        new BillingService(new D1BillingRepository(db), () => crypto.randomUUID()),
        () => crypto.randomUUID(),
      ).reschedule(workspaceId, mutation.entityId, parsed);
      return;
    }

    if (mutation.operation === 'occurrence.reopen') {
      await reopenCompletedOccurrence(db, workspaceId, mutation.entityId);
      return;
    }

    throw new Error('SYNC_OPERATION_UNSUPPORTED');
  },

  async snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot> {
    const [students, sessions, occurrencesResult, plansResult, cyclesResult, cycleOccurrencesResult] = await Promise.all([
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
      db.prepare(
        `SELECT billing_cycle_id, occurrence_id, position, earned_pence
         FROM tutoring_billing_cycle_occurrences
         WHERE workspace_id=?1
         ORDER BY billing_cycle_id, position`,
      ).bind(workspaceId).all<CycleOccurrenceRow>(),
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
        billingCycleOccurrences: (cycleOccurrencesResult.results ?? []).map((row) => ({
          id: `${row.billing_cycle_id}:${row.occurrence_id}`,
          workspaceId,
          billingCycleId: row.billing_cycle_id,
          occurrenceId: row.occurrence_id,
          position: row.position,
          earnedPence: row.earned_pence,
        })),
      },
    };
  },
};

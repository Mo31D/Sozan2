import { Hono } from 'hono';
import {
  assertBackupWorkspaceScope,
  FULL_BACKUP_SCHEMA_VERSION,
  workspaceBackupSchema,
  type WorkspaceBackup,
} from '../../modules/backup/workspace-backup';
import { accessError, requireWorkspaceAccess } from '../auth/guard';
import type { Env } from '../env';
import { requireDatabase } from '../env';

type Row = Record<string, any>;

async function all(db: D1Database, sql: string, workspaceId: string): Promise<Row[]> {
  const result = await db.prepare(sql).bind(workspaceId).all<Row>();
  return result.results ?? [];
}

async function currentRevision(db: D1Database, workspaceId: string): Promise<number> {
  await db.prepare(
    `INSERT OR IGNORE INTO core_workspace_sync_revisions(workspace_id,revision) VALUES(?1,0)`,
  ).bind(workspaceId).run();
  const row = await db.prepare(
    `SELECT revision FROM core_workspace_sync_revisions WHERE workspace_id=?1`,
  ).bind(workspaceId).first<{ revision: number }>();
  return Number(row?.revision ?? 0);
}

async function exportBackup(db: D1Database, workspaceId: string): Promise<WorkspaceBackup> {
  const workspace = await db.prepare(
    `SELECT id,name,template_key,locale,timezone,currency_code,currency_label
     FROM core_workspaces WHERE id=?1`,
  ).bind(workspaceId).first<{
    id: string; name: string; template_key: string; locale: string; timezone: string;
    currency_code: string; currency_label: string;
  }>();
  if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

  const [
    coreWorkspaceModules,
    coreWorkspaceLabels,
    coreWorkspaceSettings,
    coreSurfaceLayouts,
    coreActivityEvents,
    tutoringStudents,
    tutoringStudentBaselines,
    sessionRows,
    sessionStudentRows,
    occurrenceRows,
    attendanceRows,
    tutoringBillingPlans,
    tutoringBillingCycles,
    tutoringBillingCycleOccurrences,
    appointmentsClients,
    appointmentsItems,
    financeReceipts,
    financeAllocations,
    financeExpenses,
    financeOtherIncome,
    financeCashChecks,
  ] = await Promise.all([
    all(db, `SELECT workspace_id AS workspaceId,module_key AS moduleKey,enabled,position,
                    config_json AS configJson,updated_at AS updatedAt
             FROM core_workspace_modules WHERE workspace_id=?1 ORDER BY position,module_key`, workspaceId),
    all(db, `SELECT workspace_id AS workspaceId,label_key AS labelKey,value,updated_at AS updatedAt
             FROM core_workspace_labels WHERE workspace_id=?1 ORDER BY label_key`, workspaceId),
    all(db, `SELECT workspace_id AS workspaceId,key,value
             FROM core_workspace_settings WHERE workspace_id=?1 ORDER BY key`, workspaceId),
    all(db, `SELECT workspace_id AS workspaceId,user_id AS userId,surface_key AS surfaceKey,
                    layout_json AS layoutJson,updated_at AS updatedAt
             FROM core_surface_layouts WHERE workspace_id=?1 ORDER BY surface_key,user_id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,module_key AS moduleKey,entity_type AS entityType,
                    entity_id AS entityId,action,title,detail,before_json AS beforeJson,
                    after_json AS afterJson,undoable,undone_at AS undoneAt,created_at AS createdAt
             FROM core_activity_events WHERE workspace_id=?1 ORDER BY created_at,id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,name,age,guardian_name AS guardianName,
                    guardian_phone AS guardianPhone,level,notes,active,deleted_at AS deletedAt,
                    created_at AS createdAt,updated_at AS updatedAt
             FROM tutoring_students WHERE workspace_id=?1 ORDER BY name,id`, workspaceId),
    all(db, `SELECT student_id AS id,workspace_id AS workspaceId,student_id AS studentId,
                    completed_lessons_before_tracking AS completedLessonsBeforeTracking,
                    source_note AS sourceNote,observed_at AS observedAt,
                    created_at AS createdAt,updated_at AS updatedAt
             FROM tutoring_student_baselines WHERE workspace_id=?1 ORDER BY student_id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,title,session_type AS sessionType,
                    schedule_status AS scheduleStatus,weekday,start_time AS startTime,
                    duration_minutes AS durationMinutes,travel_minutes AS travelMinutes,
                    location,price_basis AS priceBasis,default_price_pence AS defaultPricePence,
                    expected_student_count AS expectedStudentCount,center_cut_bps AS centerCutBps,
                    active,payer_student_id AS payerStudentId,deleted_at AS deletedAt,
                    created_at AS createdAt,updated_at AS updatedAt
             FROM tutoring_recurring_sessions WHERE workspace_id=?1 ORDER BY id`, workspaceId),
    all(db, `SELECT recurring_session_id AS sessionId,student_id AS studentId
             FROM tutoring_session_students WHERE workspace_id=?1
             ORDER BY recurring_session_id,student_id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,recurring_session_id AS recurringSessionId,
                    session_date AS sessionDate,scheduled_start AS scheduledStart,
                    rescheduled_to_date AS rescheduledToDate,rescheduled_to_start AS rescheduledToStart,
                    status,gross_pence AS grossPence,center_cut_pence AS centerCutPence,
                    earned_pence AS earnedPence,completed_at AS completedAt,note,
                    duration_minutes_snapshot AS durationMinutesSnapshot,
                    travel_minutes_snapshot AS travelMinutesSnapshot,
                    session_type_snapshot AS sessionTypeSnapshot,location_snapshot AS locationSnapshot,
                    price_basis_snapshot AS priceBasisSnapshot,
                    default_price_pence_snapshot AS defaultPricePenceSnapshot,
                    payer_student_id_snapshot AS payerStudentIdSnapshot,
                    created_at AS createdAt,updated_at AS updatedAt
             FROM tutoring_occurrences WHERE workspace_id=?1 ORDER BY session_date,id`, workspaceId),
    all(db, `SELECT occurrence_id AS occurrenceId,student_id AS studentId,
                    attendance_status AS status
             FROM tutoring_occurrence_students WHERE workspace_id=?1
             ORDER BY occurrence_id,student_id`, workspaceId),
    all(db, `SELECT student_id AS id,workspace_id AS workspaceId,student_id AS studentId,
                    billing_mode AS billingMode,package_size AS packageSize,
                    package_price_pence AS packagePricePence,cycle_anchor_date AS cycleAnchorDate,
                    effective_from AS effectiveFrom,created_at AS createdAt,updated_at AS updatedAt
             FROM tutoring_billing_plans WHERE workspace_id=?1 ORDER BY student_id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,student_id AS studentId,sequence_no AS sequenceNo,
                    session_limit AS sessionLimit,price_pence AS pricePence,
                    opening_completed_count AS openingCompletedCount,
                    opening_progress_locked_at AS openingProgressLockedAt,status,started_on AS startedOn,
                    completed_on AS completedOn,paid_on AS paidOn,created_at AS createdAt,updated_at AS updatedAt
             FROM tutoring_billing_cycles WHERE workspace_id=?1 ORDER BY student_id,sequence_no`, workspaceId),
    all(db, `SELECT billing_cycle_id || ':' || occurrence_id AS id,workspace_id AS workspaceId,
                    billing_cycle_id AS billingCycleId,occurrence_id AS occurrenceId,
                    position,earned_pence AS earnedPence,created_at AS createdAt
             FROM tutoring_billing_cycle_occurrences WHERE workspace_id=?1
             ORDER BY billing_cycle_id,position`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,name,phone,notes,active,
                    created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt
             FROM appointments_clients WHERE workspace_id=?1 ORDER BY name,id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,client_id AS clientId,title,
                    appointment_date AS appointmentDate,start_time AS startTime,
                    duration_minutes AS durationMinutes,travel_minutes AS travelMinutes,
                    location,price_pence AS pricePence,status,note,completed_at AS completedAt,
                    created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt
             FROM appointments_items WHERE workspace_id=?1 ORDER BY appointment_date,start_time,id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,payer_ref_type AS payerRefType,
                    payer_ref_id AS payerRefId,amount_pence AS amountPence,received_at AS receivedAt,
                    payment_method AS paymentMethod,source_kind AS sourceKind,
                    source_module AS sourceModule,source_entity_type AS sourceEntityType,
                    source_entity_id AS sourceEntityId,note,deleted_at AS deletedAt,
                    created_at AS createdAt,updated_at AS updatedAt,0 AS pendingSync
             FROM finance_receipts WHERE workspace_id=?1 ORDER BY received_at,id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,receipt_id AS receiptId,
                    target_module AS targetModule,target_type AS targetType,target_id AS targetId,
                    amount_pence AS amountPence,created_at AS createdAt
             FROM finance_receipt_allocations WHERE workspace_id=?1 ORDER BY receipt_id,id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,expense_date AS expenseDate,scope,category,
                    amount_pence AS amountPence,note,deleted_at AS deletedAt,
                    created_at AS createdAt,updated_at AS updatedAt
             FROM finance_expenses WHERE workspace_id=?1 ORDER BY expense_date,id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,income_date AS incomeDate,category,
                    amount_pence AS amountPence,note,deleted_at AS deletedAt,
                    created_at AS createdAt,updated_at AS updatedAt
             FROM finance_other_income WHERE workspace_id=?1 ORDER BY income_date,id`, workspaceId),
    all(db, `SELECT id,workspace_id AS workspaceId,check_date AS checkDate,
                    expected_balance_pence AS expectedBalancePence,
                    actual_balance_pence AS actualBalancePence,difference_pence AS differencePence,
                    note,deleted_at AS deletedAt,created_at AS createdAt,updated_at AS updatedAt
             FROM finance_cash_checks WHERE workspace_id=?1 ORDER BY check_date,id`, workspaceId),
  ]);

  const links = new Map<string, string[]>();
  for (const row of sessionStudentRows) {
    const list = links.get(row.sessionId) ?? [];
    list.push(row.studentId);
    links.set(row.sessionId, list);
  }
  const attendance = new Map<string, Array<{ studentId: string; status: string }>>();
  for (const row of attendanceRows) {
    const list = attendance.get(row.occurrenceId) ?? [];
    list.push({ studentId: row.studentId, status: row.status });
    attendance.set(row.occurrenceId, list);
  }

  const tutoringSessions = sessionRows.map((row) => ({
    ...row,
    active: Boolean(row.active),
    studentIds: links.get(row.id) ?? [],
  }));
  const tutoringOccurrences = occurrenceRows.map((row) => {
    const items = attendance.get(row.id) ?? [];
    return {
      ...row,
      studentIds: items.filter((item) => item.status === 'attended').map((item) => item.studentId),
      attendance: items,
    };
  });

  return {
    schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      templateKey: workspace.template_key,
      locale: workspace.locale,
      timezone: workspace.timezone,
      currencyCode: workspace.currency_code,
      currencyLabel: workspace.currency_label,
    },
    stores: {
      coreWorkspaceModules: coreWorkspaceModules.map((r) => ({ ...r, enabled: Boolean(r.enabled) })),
      coreWorkspaceLabels,
      coreWorkspaceSettings,
      coreSurfaceLayouts,
      coreActivityEvents: coreActivityEvents.map((r) => ({ ...r, undoable: Boolean(r.undoable) })),
      tutoringStudents: tutoringStudents.map((r) => ({ ...r, active: Boolean(r.active) })),
      tutoringStudentBaselines,
      tutoringSessions,
      tutoringOccurrences,
      tutoringBillingPlans,
      tutoringBillingCycles,
      tutoringBillingCycleOccurrences,
      appointmentsClients: appointmentsClients.map((r) => ({ ...r, active: Boolean(r.active) })),
      appointmentsItems,
      financeReceipts: financeReceipts.map((r) => ({ ...r, pendingSync: false })),
      financeAllocations,
      financeExpenses,
      financeOtherIncome,
      financeCashChecks,
    },
  };
}

function r(row: Record<string, unknown>): Row {
  return row as Row;
}

async function restoreBackup(db: D1Database, workspaceId: string, backup: WorkspaceBackup): Promise<number> {
  const s = backup.stores;
  const statements: D1PreparedStatement[] = [
    // Delete children before parents. Workspace identity/auth membership stays intact.
    db.prepare(`DELETE FROM finance_receipt_allocations WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM tutoring_billing_cycle_occurrences WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM tutoring_occurrence_students WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM tutoring_session_students WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM finance_cash_checks WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM finance_other_income WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM finance_expenses WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM finance_receipts WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM tutoring_billing_cycles WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM tutoring_billing_plans WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM tutoring_student_baselines WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM tutoring_occurrences WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM tutoring_recurring_sessions WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM tutoring_students WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM appointments_items WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM appointments_clients WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM core_activity_events WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM core_surface_layouts WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM core_workspace_settings WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM core_workspace_labels WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(`DELETE FROM core_workspace_modules WHERE workspace_id=?1`).bind(workspaceId),
    db.prepare(
      `UPDATE core_workspaces
       SET name=?2,template_key=?3,locale=?4,timezone=?5,currency_code=?6,currency_label=?7,
           updated_at=CURRENT_TIMESTAMP
       WHERE id=?1`,
    ).bind(
      workspaceId,
      backup.workspace.name,
      backup.workspace.templateKey,
      backup.workspace.locale,
      backup.workspace.timezone,
      backup.workspace.currencyCode,
      backup.workspace.currencyLabel,
    ),
  ];

  for (const raw of s.coreWorkspaceModules) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO core_workspace_modules(workspace_id,module_key,enabled,position,config_json,updated_at)
       VALUES(?1,?2,?3,?4,?5,?6)`,
    ).bind(workspaceId,x.moduleKey,x.enabled?1:0,x.position,x.configJson??null,x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.coreWorkspaceLabels) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO core_workspace_labels(workspace_id,label_key,value,updated_at) VALUES(?1,?2,?3,?4)`,
    ).bind(workspaceId,x.labelKey,x.value,x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.coreWorkspaceSettings) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO core_workspace_settings(workspace_id,key,value) VALUES(?1,?2,?3)`,
    ).bind(workspaceId,x.key,x.value));
  }
  for (const raw of s.coreSurfaceLayouts) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO core_surface_layouts(workspace_id,user_id,surface_key,layout_json,updated_at)
       VALUES(?1,?2,?3,?4,?5)`,
    ).bind(workspaceId,x.userId??null,x.surfaceKey,x.layoutJson,x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.tutoringStudents) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO tutoring_students(
         id,workspace_id,name,age,guardian_name,guardian_phone,level,notes,active,deleted_at,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
    ).bind(x.id,workspaceId,x.name,x.age??null,x.guardianName??null,x.guardianPhone??null,x.level??null,
      x.notes??null,x.active===false?0:1,x.deletedAt??null,x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.tutoringStudentBaselines) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO tutoring_student_baselines(
         workspace_id,student_id,completed_lessons_before_tracking,source_note,observed_at,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7)`,
    ).bind(workspaceId,x.studentId,x.completedLessonsBeforeTracking,x.sourceNote??null,x.observedAt,
      x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.tutoringSessions) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO tutoring_recurring_sessions(
         id,workspace_id,title,session_type,schedule_status,weekday,start_time,duration_minutes,travel_minutes,
         location,price_basis,default_price_pence,expected_student_count,center_cut_bps,active,payer_student_id,
         deleted_at,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)`,
    ).bind(x.id,workspaceId,x.title,x.sessionType,x.scheduleStatus,x.weekday??null,x.startTime??null,
      x.durationMinutes,x.travelMinutes,x.location??null,x.priceBasis,x.defaultPricePence,x.expectedStudentCount,
      x.centerCutBps,x.active===false?0:1,x.payerStudentId??null,x.deletedAt??null,
      x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
    for (const studentId of Array.isArray(x.studentIds)?x.studentIds:[]) {
      statements.push(db.prepare(
        `INSERT INTO tutoring_session_students(workspace_id,recurring_session_id,student_id)
         VALUES(?1,?2,?3)`,
      ).bind(workspaceId,x.id,studentId));
    }
  }
  for (const raw of s.tutoringOccurrences) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO tutoring_occurrences(
         id,workspace_id,recurring_session_id,session_date,scheduled_start,rescheduled_to_date,rescheduled_to_start,
         status,gross_pence,center_cut_pence,earned_pence,completed_at,note,
         duration_minutes_snapshot,travel_minutes_snapshot,session_type_snapshot,location_snapshot,
         price_basis_snapshot,default_price_pence_snapshot,payer_student_id_snapshot,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)`,
    ).bind(x.id,workspaceId,x.recurringSessionId,x.sessionDate,x.scheduledStart??null,x.rescheduledToDate??null,
      x.rescheduledToStart??null,x.status,x.grossPence??0,x.centerCutPence??0,x.earnedPence??0,x.completedAt??null,
      x.note??null,x.durationMinutesSnapshot??null,x.travelMinutesSnapshot??null,x.sessionTypeSnapshot??null,
      x.locationSnapshot??null,x.priceBasisSnapshot??null,x.defaultPricePenceSnapshot??null,
      x.payerStudentIdSnapshot??null,x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
    const attendance = Array.isArray(x.attendance)
      ? x.attendance
      : (Array.isArray(x.studentIds)?x.studentIds:[]).map((studentId:string)=>({studentId,status:'attended'}));
    for (const item of attendance) {
      statements.push(db.prepare(
        `INSERT INTO tutoring_occurrence_students(workspace_id,occurrence_id,student_id,attendance_status)
         VALUES(?1,?2,?3,?4)`,
      ).bind(workspaceId,x.id,item.studentId,item.status));
    }
  }
  for (const raw of s.tutoringBillingPlans) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO tutoring_billing_plans(
         workspace_id,student_id,billing_mode,package_size,package_price_pence,cycle_anchor_date,effective_from,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
    ).bind(workspaceId,x.studentId,x.billingMode,x.packageSize??null,x.packagePricePence??null,x.cycleAnchorDate??null,
      x.effectiveFrom,x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.tutoringBillingCycles) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO tutoring_billing_cycles(
         id,workspace_id,student_id,sequence_no,session_limit,price_pence,opening_completed_count,
         opening_progress_locked_at,status,started_on,completed_on,paid_on,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`,
    ).bind(x.id,workspaceId,x.studentId,x.sequenceNo,x.sessionLimit,x.pricePence,x.openingCompletedCount,
      x.openingProgressLockedAt??null,x.status,x.startedOn??null,x.completedOn??null,x.paidOn??null,
      x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.tutoringBillingCycleOccurrences) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO tutoring_billing_cycle_occurrences(
         workspace_id,billing_cycle_id,occurrence_id,position,earned_pence,created_at
       ) VALUES(?1,?2,?3,?4,?5,?6)`,
    ).bind(workspaceId,x.billingCycleId,x.occurrenceId,x.position,x.earnedPence??0,x.createdAt??new Date().toISOString()));
  }
  for (const raw of s.appointmentsClients) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO appointments_clients(id,workspace_id,name,phone,notes,active,created_at,updated_at,deleted_at)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
    ).bind(x.id,workspaceId,x.name,x.phone??null,x.notes??null,x.active===false?0:1,
      x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString(),x.deletedAt??null));
  }
  for (const raw of s.appointmentsItems) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO appointments_items(
         id,workspace_id,client_id,title,appointment_date,start_time,duration_minutes,travel_minutes,location,
         price_pence,status,note,completed_at,created_at,updated_at,deleted_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`,
    ).bind(x.id,workspaceId,x.clientId??null,x.title,x.appointmentDate,x.startTime??null,x.durationMinutes,
      x.travelMinutes,x.location??null,x.pricePence??0,x.status,x.note??null,x.completedAt??null,
      x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString(),x.deletedAt??null));
  }

  // Receipts are inserted active so allocation guards can validate them. Their
  // deleted_at state is restored only after allocations are inserted.
  for (const raw of s.financeReceipts) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO finance_receipts(
         id,workspace_id,payer_ref_type,payer_ref_id,amount_pence,received_at,payment_method,source_kind,
         source_module,source_entity_type,source_entity_id,note,deleted_at,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,NULL,?13,?14)`,
    ).bind(x.id,workspaceId,x.payerRefType??null,x.payerRefId??null,x.amountPence,x.receivedAt,x.paymentMethod,
      x.sourceKind,x.sourceModule??null,x.sourceEntityType??null,x.sourceEntityId??null,x.note??null,
      x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.financeAllocations) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO finance_receipt_allocations(
         id,workspace_id,receipt_id,target_module,target_type,target_id,amount_pence,created_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`,
    ).bind(x.id,workspaceId,x.receiptId,x.targetModule,x.targetType,x.targetId,x.amountPence,
      x.createdAt??new Date().toISOString()));
  }
  for (const raw of s.financeReceipts) {
    const x=r(raw); if (x.deletedAt) statements.push(db.prepare(
      `UPDATE finance_receipts SET deleted_at=?3 WHERE workspace_id=?1 AND id=?2`,
    ).bind(workspaceId,x.id,x.deletedAt));
  }
  for (const raw of s.financeExpenses) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO finance_expenses(
         id,workspace_id,expense_date,scope,category,amount_pence,note,deleted_at,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
    ).bind(x.id,workspaceId,x.expenseDate,x.scope,x.category,x.amountPence,x.note??null,x.deletedAt??null,
      x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.financeOtherIncome) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO finance_other_income(
         id,workspace_id,income_date,category,amount_pence,note,deleted_at,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
    ).bind(x.id,workspaceId,x.incomeDate,x.category,x.amountPence,x.note??null,x.deletedAt??null,
      x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.financeCashChecks) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO finance_cash_checks(
         id,workspace_id,check_date,expected_balance_pence,actual_balance_pence,difference_pence,
         note,deleted_at,created_at,updated_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
    ).bind(x.id,workspaceId,x.checkDate,x.expectedBalancePence,x.actualBalancePence,x.differencePence,
      x.note??null,x.deletedAt??null,x.createdAt??new Date().toISOString(),x.updatedAt??new Date().toISOString()));
  }
  for (const raw of s.coreActivityEvents) {
    const x=r(raw); statements.push(db.prepare(
      `INSERT INTO core_activity_events(
         id,workspace_id,module_key,entity_type,entity_id,action,title,detail,before_json,after_json,
         undoable,undone_at,created_at
       ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`,
    ).bind(x.id,workspaceId,x.moduleKey,x.entityType,x.entityId??null,x.action,x.title,x.detail??null,
      x.beforeJson??null,x.afterJson??null,x.undoable?1:0,x.undoneAt??null,x.createdAt??new Date().toISOString()));
  }

  const nextRevision = (await currentRevision(db, workspaceId)) + 1;
  statements.push(db.prepare(
    `UPDATE core_workspace_sync_revisions
     SET revision=?2,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=?1`,
  ).bind(workspaceId,nextRevision));

  await db.batch(statements);
  return nextRevision;
}

function routeError(error: unknown): { status: 400 | 401 | 403 | 503; error: string } {
  const access = accessError(error);
  if (access) return access;
  return { status: 400, error: error instanceof Error ? error.message : 'BACKUP_FAILED' };
}

export const backupRoutes = new Hono<{ Bindings: Env }>();

backupRoutes.get('/:workspaceId/export', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId);
    const db = requireDatabase(c.env);
    return c.json(await exportBackup(db, workspaceId));
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

backupRoutes.post('/:workspaceId/restore', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    const access = await requireWorkspaceAccess(c, workspaceId, true);
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json({ error: 'WORKSPACE_ADMIN_REQUIRED' }, 403);
    }
    const backup = workspaceBackupSchema.parse(await c.req.json());
    assertBackupWorkspaceScope(backup);
    if (backup.workspace.id !== workspaceId) {
      return c.json({ error: 'BACKUP_WORKSPACE_ID_MISMATCH' }, 400);
    }
    const db = requireDatabase(c.env);
    const revision = await restoreBackup(db, workspaceId, backup);
    return c.json({
      ok: true,
      revision,
      restoredAt: new Date().toISOString(),
    });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

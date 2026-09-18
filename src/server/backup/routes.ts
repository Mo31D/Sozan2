import { Hono } from 'hono';
import {
  assertBackupWorkspaceScope,
  BACKUP_ENGINE_VERSION,
  backupImportRequestSchema,
  FULL_BACKUP_SCHEMA_VERSION,
  validateWorkspaceBackup,
  workspaceBackupSchema,
  type BackupImportStatus,
  type WorkspaceBackup,
} from '../../modules/backup/workspace-backup';
import { accessError, requireWorkspaceAccess } from '../auth/guard';
import type { Env } from '../env';
import { requireDatabase } from '../env';
import {
  abortWorkspaceWrite,
  finalizeWorkspaceWrite,
  reserveWorkspaceWrite,
  withStableWorkspaceRead,
  withWorkspaceWrite,
} from '../sync/workspace-revision';

type Row = Record<string, any>;

async function all(db: D1Database, sql: string, workspaceId: string): Promise<Row[]> {
  const result = await db.prepare(sql).bind(workspaceId).all<Row>();
  return result.results ?? [];
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
                    rescheduled_at AS rescheduledAt,reschedule_note AS rescheduleNote,created_from AS createdFrom,
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
    all(db, `SELECT c.id,c.workspace_id AS workspaceId,c.student_id AS studentId,c.sequence_no AS sequenceNo,
                    c.session_limit AS sessionLimit,c.price_pence AS pricePence,
                    c.opening_completed_count AS openingCompletedCount,
                    c.opening_progress_locked_at AS openingProgressLockedAt,
                    (SELECT COUNT(*) FROM tutoring_billing_cycle_occurrences co
                     JOIN tutoring_occurrences o
                       ON o.workspace_id=co.workspace_id AND o.id=co.occurrence_id
                     WHERE co.workspace_id=c.workspace_id
                       AND co.billing_cycle_id=c.id
                       AND o.status='completed') AS realCompletedCount,
                    c.status,c.started_on AS startedOn,c.completed_on AS completedOn,c.paid_on AS paidOn,
                    c.created_at AS createdAt,c.updated_at AS updatedAt
             FROM tutoring_billing_cycles c WHERE c.workspace_id=?1
             ORDER BY c.student_id,c.sequence_no`, workspaceId),
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
    all(db, `SELECT a.id,a.workspace_id AS workspaceId,a.receipt_id AS receiptId,
                    a.target_module AS targetModule,a.target_type AS targetType,a.target_id AS targetId,
                    a.amount_pence AS amountPence,a.created_at AS createdAt
             FROM finance_receipt_allocations a
             JOIN finance_receipts r
               ON r.workspace_id=a.workspace_id AND r.id=a.receipt_id AND r.deleted_at IS NULL
             WHERE a.workspace_id=?1 ORDER BY a.receipt_id,a.id`, workspaceId),
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
    engineVersion: BACKUP_ENGINE_VERSION,
    backupId: crypto.randomUUID(),
    exportedAt: new Date().toISOString(),
    manifest: {
      students: tutoringStudents.length,
      sessions: tutoringSessions.length,
      baselines: tutoringStudentBaselines.length,
      occurrences: tutoringOccurrences.length,
      receipts: financeReceipts.length,
      expenses: financeExpenses.length,
      activityEvents: coreActivityEvents.length,
    },
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

type SqlValue = string | number | null;
const MAX_BOUND_PARAMS = 90;
const MAX_ATOMIC_STATEMENTS = 90;

function bulkInsert(
  db: D1Database,
  table: string,
  columns: readonly string[],
  rows: readonly SqlValue[][],
): D1PreparedStatement[] {
  if (!rows.length) return [];
  const perStatement = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns.length));
  const result: D1PreparedStatement[] = [];
  for (let index = 0; index < rows.length; index += perStatement) {
    const chunk = rows.slice(index, index + perStatement);
    const values: SqlValue[] = [];
    const tuples = chunk.map((row) => {
      if (row.length !== columns.length) throw new Error('BACKUP_INTERNAL_COLUMN_MISMATCH');
      const placeholders = row.map((value) => {
        values.push(value);
        return `?${values.length}`;
      });
      return `(${placeholders.join(',')})`;
    });
    result.push(
      db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES ${tuples.join(',')}`).bind(...values),
    );
  }
  return result;
}

function asBool(value: unknown): number {
  return value === false || value === 0 ? 0 : 1;
}

function nowFor(value: unknown): string {
  return typeof value === 'string' && value ? value : new Date().toISOString();
}

async function restoreBackupAtomic(db: D1Database, workspaceId: string, backup: WorkspaceBackup): Promise<void> {
  const validation = validateWorkspaceBackup(backup);
  if (!validation.valid) throw new Error(validation.errors[0] ?? 'BACKUP_VALIDATION_FAILED');

  const s = backup.stores;
  const statements: D1PreparedStatement[] = [
    // Delete children before parents. The workspace identity, user and membership
    // intentionally remain intact.
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

  statements.push(...bulkInsert(db, 'core_workspace_modules',
    ['workspace_id','module_key','enabled','position','config_json','updated_at'],
    s.coreWorkspaceModules.map((raw) => { const x=r(raw); return [
      workspaceId,String(x.moduleKey),asBool(x.enabled),Number(x.position),x.configJson==null?null:String(x.configJson),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'core_workspace_labels',
    ['workspace_id','label_key','value','updated_at'],
    s.coreWorkspaceLabels.map((raw) => { const x=r(raw); return [
      workspaceId,String(x.labelKey),String(x.value),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'core_workspace_settings',
    ['workspace_id','key','value'],
    s.coreWorkspaceSettings.map((raw) => { const x=r(raw); return [
      workspaceId,String(x.key),String(x.value),
    ]; })));

  statements.push(...bulkInsert(db, 'core_surface_layouts',
    ['workspace_id','user_id','surface_key','layout_json','updated_at'],
    s.coreSurfaceLayouts.map((raw) => { const x=r(raw); return [
      workspaceId,x.userId==null?null:String(x.userId),String(x.surfaceKey),String(x.layoutJson),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'tutoring_students',
    ['id','workspace_id','name','age','guardian_name','guardian_phone','level','notes','active','deleted_at','created_at','updated_at'],
    s.tutoringStudents.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.name),x.age==null?null:Number(x.age),
      x.guardianName==null?null:String(x.guardianName),x.guardianPhone==null?null:String(x.guardianPhone),
      x.level==null?null:String(x.level),x.notes==null?null:String(x.notes),asBool(x.active),
      x.deletedAt==null?null:String(x.deletedAt),nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'tutoring_student_baselines',
    ['workspace_id','student_id','completed_lessons_before_tracking','source_note','observed_at','created_at','updated_at'],
    s.tutoringStudentBaselines.map((raw) => { const x=r(raw); return [
      workspaceId,String(x.studentId),Number(x.completedLessonsBeforeTracking),x.sourceNote==null?null:String(x.sourceNote),
      String(x.observedAt),nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'tutoring_recurring_sessions',
    ['id','workspace_id','title','session_type','schedule_status','weekday','start_time','duration_minutes','travel_minutes',
     'location','price_basis','default_price_pence','expected_student_count','center_cut_bps','active','payer_student_id',
     'deleted_at','created_at','updated_at'],
    s.tutoringSessions.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.title),String(x.sessionType),String(x.scheduleStatus),
      x.weekday==null?null:Number(x.weekday),x.startTime==null?null:String(x.startTime),Number(x.durationMinutes),
      Number(x.travelMinutes),x.location==null?null:String(x.location),String(x.priceBasis),Number(x.defaultPricePence),
      Number(x.expectedStudentCount),Number(x.centerCutBps),asBool(x.active),
      x.payerStudentId==null?null:String(x.payerStudentId),x.deletedAt==null?null:String(x.deletedAt),
      nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  const sessionLinks: SqlValue[][] = [];
  for (const raw of s.tutoringSessions) {
    const x=r(raw);
    const ids = Array.isArray(x.studentIds) ? x.studentIds : [];
    for (const studentId of ids) sessionLinks.push([workspaceId,String(x.id),String(studentId)]);
  }
  statements.push(...bulkInsert(db, 'tutoring_session_students',
    ['workspace_id','recurring_session_id','student_id'], sessionLinks));

  statements.push(...bulkInsert(db, 'tutoring_occurrences',
    ['id','workspace_id','recurring_session_id','session_date','scheduled_start','rescheduled_to_date','rescheduled_to_start',
     'rescheduled_at','reschedule_note','status','gross_pence','center_cut_pence','earned_pence','completed_at','note',
     'duration_minutes_snapshot','travel_minutes_snapshot','session_type_snapshot','location_snapshot',
     'price_basis_snapshot','default_price_pence_snapshot','payer_student_id_snapshot','created_from','created_at','updated_at'],
    s.tutoringOccurrences.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.recurringSessionId),String(x.sessionDate),
      x.scheduledStart==null?null:String(x.scheduledStart),x.rescheduledToDate==null?null:String(x.rescheduledToDate),
      x.rescheduledToStart==null?null:String(x.rescheduledToStart),x.rescheduledAt==null?null:String(x.rescheduledAt),
      x.rescheduleNote==null?null:String(x.rescheduleNote),String(x.status),Number(x.grossPence??0),
      Number(x.centerCutPence??0),Number(x.earnedPence??0),x.completedAt==null?null:String(x.completedAt),
      x.note==null?null:String(x.note),x.durationMinutesSnapshot==null?null:Number(x.durationMinutesSnapshot),
      x.travelMinutesSnapshot==null?null:Number(x.travelMinutesSnapshot),
      x.sessionTypeSnapshot==null?null:String(x.sessionTypeSnapshot),
      x.locationSnapshot==null?null:String(x.locationSnapshot),
      x.priceBasisSnapshot==null?null:String(x.priceBasisSnapshot),
      x.defaultPricePenceSnapshot==null?null:Number(x.defaultPricePenceSnapshot),
      x.payerStudentIdSnapshot==null?null:String(x.payerStudentIdSnapshot),
      typeof x.createdFrom==='string'?x.createdFrom:'schedule',nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  const attendanceRows: SqlValue[][] = [];
  for (const raw of s.tutoringOccurrences) {
    const x=r(raw);
    const attendance = Array.isArray(x.attendance)
      ? x.attendance
      : (Array.isArray(x.studentIds)?x.studentIds:[]).map((studentId:unknown)=>({studentId,status:'attended'}));
    for (const item of attendance) {
      if (!item || typeof item !== 'object') continue;
      const a=r(item as Record<string, unknown>);
      attendanceRows.push([workspaceId,String(x.id),String(a.studentId),String(a.status)]);
    }
  }
  statements.push(...bulkInsert(db, 'tutoring_occurrence_students',
    ['workspace_id','occurrence_id','student_id','attendance_status'], attendanceRows));

  statements.push(...bulkInsert(db, 'tutoring_billing_plans',
    ['workspace_id','student_id','billing_mode','package_size','package_price_pence','cycle_anchor_date','effective_from','created_at','updated_at'],
    s.tutoringBillingPlans.map((raw) => { const x=r(raw); return [
      workspaceId,String(x.studentId),String(x.billingMode),x.packageSize==null?null:Number(x.packageSize),
      x.packagePricePence==null?null:Number(x.packagePricePence),x.cycleAnchorDate==null?null:String(x.cycleAnchorDate),
      String(x.effectiveFrom),nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'tutoring_billing_cycles',
    ['id','workspace_id','student_id','sequence_no','session_limit','price_pence','opening_completed_count',
     'opening_progress_locked_at','status','started_on','completed_on','paid_on','created_at','updated_at'],
    s.tutoringBillingCycles.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.studentId),Number(x.sequenceNo),Number(x.sessionLimit),Number(x.pricePence),
      Number(x.openingCompletedCount),x.openingProgressLockedAt==null?null:String(x.openingProgressLockedAt),
      String(x.status),x.startedOn==null?null:String(x.startedOn),x.completedOn==null?null:String(x.completedOn),
      x.paidOn==null?null:String(x.paidOn),nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'tutoring_billing_cycle_occurrences',
    ['workspace_id','billing_cycle_id','occurrence_id','position','earned_pence','created_at'],
    s.tutoringBillingCycleOccurrences.map((raw) => { const x=r(raw); return [
      workspaceId,String(x.billingCycleId),String(x.occurrenceId),Number(x.position),Number(x.earnedPence??0),nowFor(x.createdAt),
    ]; })));

  statements.push(...bulkInsert(db, 'appointments_clients',
    ['id','workspace_id','name','phone','notes','active','created_at','updated_at','deleted_at'],
    s.appointmentsClients.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.name),x.phone==null?null:String(x.phone),x.notes==null?null:String(x.notes),
      asBool(x.active),nowFor(x.createdAt),nowFor(x.updatedAt),x.deletedAt==null?null:String(x.deletedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'appointments_items',
    ['id','workspace_id','client_id','title','appointment_date','start_time','duration_minutes','travel_minutes','location',
     'price_pence','status','note','completed_at','created_at','updated_at','deleted_at'],
    s.appointmentsItems.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,x.clientId==null?null:String(x.clientId),String(x.title),String(x.appointmentDate),
      x.startTime==null?null:String(x.startTime),Number(x.durationMinutes),Number(x.travelMinutes),
      x.location==null?null:String(x.location),Number(x.pricePence??0),String(x.status),x.note==null?null:String(x.note),
      x.completedAt==null?null:String(x.completedAt),nowFor(x.createdAt),nowFor(x.updatedAt),
      x.deletedAt==null?null:String(x.deletedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'finance_receipts',
    ['id','workspace_id','payer_ref_type','payer_ref_id','amount_pence','received_at','payment_method','source_kind',
     'source_module','source_entity_type','source_entity_id','note','deleted_at','created_at','updated_at'],
    s.financeReceipts.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,x.payerRefType==null?null:String(x.payerRefType),x.payerRefId==null?null:String(x.payerRefId),
      Number(x.amountPence),String(x.receivedAt),String(x.paymentMethod),String(x.sourceKind),
      x.sourceModule==null?null:String(x.sourceModule),x.sourceEntityType==null?null:String(x.sourceEntityType),
      x.sourceEntityId==null?null:String(x.sourceEntityId),x.note==null?null:String(x.note),
      x.deletedAt==null?null:String(x.deletedAt),nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'finance_receipt_allocations',
    ['id','workspace_id','receipt_id','target_module','target_type','target_id','amount_pence','created_at'],
    s.financeAllocations.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.receiptId),String(x.targetModule),String(x.targetType),String(x.targetId),
      Number(x.amountPence),nowFor(x.createdAt),
    ]; })));

  statements.push(...bulkInsert(db, 'finance_expenses',
    ['id','workspace_id','expense_date','scope','category','amount_pence','note','deleted_at','created_at','updated_at'],
    s.financeExpenses.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.expenseDate),String(x.scope),String(x.category),Number(x.amountPence),
      x.note==null?null:String(x.note),x.deletedAt==null?null:String(x.deletedAt),nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'finance_other_income',
    ['id','workspace_id','income_date','category','amount_pence','note','deleted_at','created_at','updated_at'],
    s.financeOtherIncome.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.incomeDate),String(x.category),Number(x.amountPence),
      x.note==null?null:String(x.note),x.deletedAt==null?null:String(x.deletedAt),nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'finance_cash_checks',
    ['id','workspace_id','check_date','expected_balance_pence','actual_balance_pence','difference_pence',
     'note','deleted_at','created_at','updated_at'],
    s.financeCashChecks.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.checkDate),Number(x.expectedBalancePence),Number(x.actualBalancePence),
      Number(x.differencePence),x.note==null?null:String(x.note),x.deletedAt==null?null:String(x.deletedAt),
      nowFor(x.createdAt),nowFor(x.updatedAt),
    ]; })));

  statements.push(...bulkInsert(db, 'core_activity_events',
    ['id','workspace_id','module_key','entity_type','entity_id','action','title','detail','before_json','after_json',
     'undoable','undone_at','created_at'],
    s.coreActivityEvents.map((raw) => { const x=r(raw); return [
      String(x.id),workspaceId,String(x.moduleKey),String(x.entityType),x.entityId==null?null:String(x.entityId),
      String(x.action),String(x.title),x.detail==null?null:String(x.detail),x.beforeJson==null?null:String(x.beforeJson),
      x.afterJson==null?null:String(x.afterJson),x.undoable?1:0,x.undoneAt==null?null:String(x.undoneAt),nowFor(x.createdAt),
    ]; })));

  // D1 batch is the atomic boundary. Refuse a backup that would exceed the
  // safe statement budget rather than risk a destructive multi-batch restore.
  if (statements.length > MAX_ATOMIC_STATEMENTS) throw new Error('BACKUP_TOO_LARGE_FOR_ATOMIC_RESTORE');
  await db.batch(statements);
}

function routeError(error: unknown): { status: 400 | 401 | 403 | 409 | 503; error: string } {
  const access = accessError(error);
  if (access) return access;
  if (error instanceof Error && error.name === 'ZodError') return { status: 400, error: 'BACKUP_FILE_INVALID' };
  const code = error instanceof Error ? error.message : 'BACKUP_FAILED';
  if (code === 'SYNC_WRITE_IN_PROGRESS' || code === 'SYNC_SNAPSHOT_UNSTABLE') {
    return { status: 503, error: code };
  }
  if ([
    'BACKUP_IMPORT_REVISION_CONFLICT',
    'BACKUP_IMPORT_IN_PROGRESS',
    'BACKUP_IMPORT_ID_REUSED',
    'BACKUP_IMPORT_ALREADY_FAILED',
  ].includes(code)) {
    return { status: 409, error: code };
  }
  return { status: 400, error: code };
}


type ImportJobRow = {
  import_id: string;
  backup_fingerprint: string;
  expected_revision: number;
  status: 'applying' | 'completed' | 'failed';
  applied_revision: number | null;
  error_code: string | null;
};

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

async function importJob(
  db: D1Database,
  workspaceId: string,
  importId: string,
): Promise<ImportJobRow | null> {
  return db.prepare(
    `SELECT import_id,backup_fingerprint,expected_revision,status,applied_revision,error_code
     FROM core_backup_imports
     WHERE workspace_id=?1 AND import_id=?2`,
  ).bind(workspaceId, importId).first<ImportJobRow>();
}

function importStatus(row: ImportJobRow): BackupImportStatus {
  if (row.status === 'completed') {
    return {
      importId: row.import_id,
      status: 'completed',
      expectedRevision: row.expected_revision,
      revision: Number(row.applied_revision ?? 0),
      error: null,
    };
  }
  if (row.status === 'failed') {
    return {
      importId: row.import_id,
      status: 'failed',
      expectedRevision: row.expected_revision,
      revision: row.applied_revision == null ? null : Number(row.applied_revision),
      error: row.error_code ?? 'BACKUP_IMPORT_FAILED',
    };
  }
  return {
    importId: row.import_id,
    status: 'applying',
    expectedRevision: row.expected_revision,
    revision: null,
    error: null,
  };
}

async function beginImportJob(
  db: D1Database,
  workspaceId: string,
  importId: string,
  fingerprint: string,
  expectedRevision: number,
): Promise<{ row: ImportJobRow; created: boolean }> {
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO core_backup_imports(
       workspace_id,import_id,backup_fingerprint,expected_revision,status
     ) VALUES(?1,?2,?3,?4,'applying')`,
  ).bind(workspaceId, importId, fingerprint, expectedRevision).run();

  const row = await importJob(db, workspaceId, importId);
  if (!row) throw new Error('BACKUP_IMPORT_JOURNAL_FAILED');
  if (row.backup_fingerprint !== fingerprint || row.expected_revision !== expectedRevision) {
    throw new Error('BACKUP_IMPORT_ID_REUSED');
  }
  return { row, created: (inserted.meta?.changes ?? 0) > 0 };
}

async function failImportJob(
  db: D1Database,
  workspaceId: string,
  importId: string,
  errorCode: string,
): Promise<void> {
  await db.prepare(
    `UPDATE core_backup_imports
     SET status='failed',error_code=?3,updated_at=CURRENT_TIMESTAMP
     WHERE workspace_id=?1 AND import_id=?2 AND status<>'completed'`,
  ).bind(workspaceId, importId, errorCode).run();
}

async function completeImportJob(
  db: D1Database,
  workspaceId: string,
  importId: string,
  revision: number,
): Promise<void> {
  await db.prepare(
    `UPDATE core_backup_imports
     SET status='completed',applied_revision=?3,error_code=NULL,
         updated_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP
     WHERE workspace_id=?1 AND import_id=?2`,
  ).bind(workspaceId, importId, revision).run();
}

export const backupRoutes = new Hono<{ Bindings: Env }>();

backupRoutes.get('/:workspaceId/export', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId);
    const db = requireDatabase(c.env);
    const stable = await withStableWorkspaceRead(
      db,
      workspaceId,
      () => exportBackup(db, workspaceId),
    );
    return c.json(stable.value);
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

backupRoutes.post('/:workspaceId/validate', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    await requireWorkspaceAccess(c, workspaceId);
    const backup = workspaceBackupSchema.parse(await c.req.json());
    assertBackupWorkspaceScope(backup);
    if (backup.workspace.id !== workspaceId) {
      return c.json({ ok: false, error: 'BACKUP_WORKSPACE_ID_MISMATCH' }, 400);
    }
    const validation = validateWorkspaceBackup(backup);
    return c.json({ ok: validation.valid, validation });
  } catch (error) {
    const response = routeError(error);
    return c.json({ ok: false, error: response.error }, response.status);
  }
});

backupRoutes.get('/:workspaceId/imports/:importId', async (c) => {
  try {
    const workspaceId = c.req.param('workspaceId');
    const importId = c.req.param('importId');
    await requireWorkspaceAccess(c, workspaceId);
    const db = requireDatabase(c.env);
    const row = await importJob(db, workspaceId, importId);
    if (!row) return c.json({ error: 'BACKUP_IMPORT_NOT_FOUND' }, 404);
    return c.json(importStatus(row));
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

backupRoutes.post('/:workspaceId/import', async (c) => {
  const workspaceId = c.req.param('workspaceId');
  let db: D1Database | null = null;
  let importId = '';
  let leaseToken: string | null = null;
  let dataApplied = false;

  try {
    const access = await requireWorkspaceAccess(c, workspaceId, true);
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json({ error: 'WORKSPACE_ADMIN_REQUIRED' }, 403);
    }

    const parsed = backupImportRequestSchema.parse(await c.req.json());
    importId = parsed.importId;
    const backup = parsed.backup;

    assertBackupWorkspaceScope(backup);
    if (backup.workspace.id !== workspaceId) {
      return c.json({ error: 'BACKUP_WORKSPACE_ID_MISMATCH' }, 400);
    }

    const validation = validateWorkspaceBackup(backup);
    if (!validation.valid) {
      return c.json({ error: validation.errors[0] ?? 'BACKUP_VALIDATION_FAILED', validation }, 400);
    }

    db = requireDatabase(c.env);
    const fingerprint = await sha256(JSON.stringify(backup));
    const started = await beginImportJob(
      db,
      workspaceId,
      importId,
      fingerprint,
      parsed.expectedRevision,
    );
    const existing = started.row;

    if (!started.created) {
      if (existing.status === 'completed') {
        return c.json({
          ok: true,
          importId,
          revision: Number(existing.applied_revision ?? parsed.expectedRevision),
          replayed: true,
        });
      }
      if (existing.status === 'failed') throw new Error('BACKUP_IMPORT_ALREADY_FAILED');
      throw new Error('BACKUP_IMPORT_IN_PROGRESS');
    }

    const token = `backup-import:${importId}`;
    const reserved = await reserveWorkspaceWrite(
      db,
      workspaceId,
      parsed.expectedRevision,
      token,
    );
    if (!reserved.ok) {
      const code = reserved.busy ? 'SYNC_WRITE_IN_PROGRESS' : 'BACKUP_IMPORT_REVISION_CONFLICT';
      await failImportJob(db, workspaceId, importId, code);
      throw new Error(code);
    }

    leaseToken = token;
    await restoreBackupAtomic(db, workspaceId, backup);
    dataApplied = true;

    const revision = await finalizeWorkspaceWrite(db, workspaceId, token);
    leaseToken = null;
    await completeImportJob(db, workspaceId, importId, revision);

    return c.json({
      ok: true,
      importId,
      revision,
      restoredAt: new Date().toISOString(),
      validation,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'BACKUP_IMPORT_FAILED';

    if (db && leaseToken && !dataApplied) {
      try {
        await abortWorkspaceWrite(db, workspaceId, leaseToken);
        leaseToken = null;
      } catch {
        // If lease release itself fails, stale-write recovery will conservatively
        // advance the revision. The import journal remains the recovery anchor.
      }
    }
    if (db && importId && !dataApplied) {
      try { await failImportJob(db, workspaceId, importId, code); } catch {}
    }

    const response = routeError(error);
    return c.json({ error: response.error, importId: importId || null }, response.status);
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
    const guarded = await withWorkspaceWrite(
      db,
      workspaceId,
      () => restoreBackupAtomic(db, workspaceId, backup),
    );
    return c.json({
      ok: true,
      revision: guarded.revision,
      restoredAt: new Date().toISOString(),
    });
  } catch (error) {
    const response = routeError(error);
    return c.json({ error: response.error }, response.status);
  }
});

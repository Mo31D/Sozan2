type LegacyRow = Record<string, unknown>;

type Sozan1Export = {
  schemaVersion: string;
  source?: string;
  exportedAt?: string;
  summary?: Record<string, unknown>;
  tables: Record<string, LegacyRow[]>;
};

type ImportSummary = {
  students: number;
  recurringSessions: number;
  occurrences: number;
  billingPlans: number;
  billingCycles: number;
  receipts: number;
  allocations: number;
  expenses: number;
  otherIncome: number;
  cashChecks: number;
  activityEvents: number;
  skippedShadowSessions: number;
  skippedShadowOccurrences: number;
  legacyMonthlyDues: number;
};

const encoder = new TextEncoder();

export function parseSozan1Export(value: unknown): Sozan1Export {
  if (!value || typeof value !== 'object') throw new Error('MIGRATION_FILE_INVALID');
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 'sozan1-d1-export-v1') {
    throw new Error('MIGRATION_FILE_VERSION_UNSUPPORTED');
  }
  if (!candidate.tables || typeof candidate.tables !== 'object' || Array.isArray(candidate.tables)) {
    throw new Error('MIGRATION_FILE_INVALID');
  }

  const tables: Record<string, LegacyRow[]> = {};
  for (const [name, rows] of Object.entries(candidate.tables as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    tables[name] = rows.filter((row): row is LegacyRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
  }

  return {
    schemaVersion: candidate.schemaVersion,
    source: typeof candidate.source === 'string' ? candidate.source : undefined,
    exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : undefined,
    summary: candidate.summary && typeof candidate.summary === 'object' && !Array.isArray(candidate.summary)
      ? candidate.summary as Record<string, unknown>
      : undefined,
    tables,
  };
}

export async function importSozan1(
  db: D1Database,
  workspaceId: string,
  actorUserId: string,
  payload: Sozan1Export,
): Promise<{ summary: ImportSummary; warnings: string[] }> {
  await assertTargetReady(db, workspaceId);
  await upsertSetting(db, workspaceId, 'migration.sozan1.started_at', new Date().toISOString());

  const table = (name: string) => payload.tables[name] ?? [];
  const students = table('students_v3');
  const sessions = table('recurring_sessions_v3');
  const occurrences = table('session_occurrences_v3');
  const payments = table('payments_v3');
  const receipts = table('student_receipts_v4');
  const receiptAllocations = table('receipt_allocations_v4');
  const expenses = table('expenses_v3');
  const otherIncome = table('other_income_v3');
  const cashChecks = table('cash_checks_v3');
  const settings = table('settings_v3');
  const activities = table('activity_events_v4');
  const billingPlans = table('student_billing_v6');
  const billingCycles = table('package_cycles_v6');
  const cycleOccurrences = table('package_cycle_occurrences_v6');
  const packageAllocations = table('package_receipt_allocations_v6');
  const openingProgress = table('package_opening_progress_v7');
  const monthlyDues = table('monthly_dues_v5');

  const shadowSessionIds = new Set(openingProgress.map((row) => legacyKey(row.shadow_session_id)).filter(Boolean));
  const sessionRowsById = new Map<string, LegacyRow[]>();
  const sessionById = new Map<string, LegacyRow>();
  for (const row of sessions) {
    const key = legacyKey(row.id);
    if (!key) continue;
    const grouped = sessionRowsById.get(key) ?? [];
    grouped.push(row);
    sessionRowsById.set(key, grouped);
    if (!sessionById.has(key)) sessionById.set(key, row);
  }
  const occurrenceById = new Map(occurrences.map((row) => [legacyKey(row.id), row]));
  const shadowOccurrenceIds = new Set(
    occurrences
      .filter((row) => shadowSessionIds.has(legacyKey(row.recurring_session_id)))
      .map((row) => legacyKey(row.id)),
  );

  const openingByCycle = new Map(openingProgress.map((row) => [legacyKey(row.cycle_id), row]));
  const realCycleOccurrencesByCycle = new Map<string, LegacyRow[]>();
  for (const row of cycleOccurrences) {
    if (shadowOccurrenceIds.has(legacyKey(row.occurrence_id))) continue;
    const key = legacyKey(row.cycle_id);
    const existing = realCycleOccurrencesByCycle.get(key) ?? [];
    existing.push(row);
    realCycleOccurrencesByCycle.set(key, existing);
  }

  const ids = new LegacyIds(workspaceId);
  const studentIds = await ids.mapRows('student', students);
  const sessionIds = await ids.mapRows('session', sessions.filter((row) => !shadowSessionIds.has(legacyKey(row.id))));
  const occurrenceIds = await ids.mapRows('occurrence', occurrences.filter((row) => !shadowOccurrenceIds.has(legacyKey(row.id))));
  const cycleIds = await ids.mapRows('cycle', billingCycles);
  const receiptIds = await ids.mapRows('receipt', receipts);
  const paymentReceiptIds = await ids.mapRows('payment-receipt', payments);
  const expenseIds = await ids.mapRows('expense', expenses);
  const incomeIds = await ids.mapRows('income', otherIncome);
  const cashCheckIds = await ids.mapRows('cash-check', cashChecks);
  const activityIds = await ids.mapRows('activity', activities);

  const mappedParticipantsForSession = (legacySessionId: string): string[] => {
    const participants = (sessionRowsById.get(legacySessionId) ?? [])
      .map((sessionRow) => studentIds.get(legacyKey(sessionRow.student_id)))
      .filter((value): value is string => Boolean(value));
    return [...new Set(participants)];
  };

  const receiptStudentIds = new Map<string, string>();
  for (const row of receipts) {
    const mapped = studentIds.get(legacyKey(row.student_id));
    if (mapped) receiptStudentIds.set(legacyKey(row.id), mapped);
  }

  let ambiguousGroupPaymentCount = 0;
  let skippedOccurrenceAllocationCount = 0;
  const statements: D1PreparedStatement[] = [];

  for (const row of students) {
    const legacyId = legacyKey(row.id);
    const id = studentIds.get(legacyId);
    if (!id) continue;
    const ageRaw = nullableInt(row.age);
    const age = ageRaw !== null && ageRaw >= 1 && ageRaw <= 120 ? ageRaw : null;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO tutoring_students(
         id, workspace_id, name, age, guardian_name, guardian_phone, level, notes,
         active, deleted_at, created_at, updated_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
    ).bind(
      id, workspaceId, text(row.name, `Student ${legacyId}`), age,
      nullableText(row.guardian_name), nullableText(row.guardian_phone), nullableText(row.level), nullableText(row.notes),
      flag(row.active, 1), nullableText(row.deleted_at), timestamp(row.created_at), timestamp(row.updated_at),
    ));
  }

  for (const row of sessions) {
    const oldId = legacyKey(row.id);
    if (shadowSessionIds.has(oldId)) continue;
    const id = sessionIds.get(oldId);
    if (!id) continue;
    const scheduleStatus = row.schedule_status === 'pending' ? 'pending' : 'confirmed';
    const weekday = nullableInt(row.weekday);
    const startTime = nullableText(row.start_time);
    const safeStatus = scheduleStatus === 'confirmed' && (weekday === null || !startTime) ? 'pending' : scheduleStatus;
    const sessionType = mapSessionType(text(row.session_type, 'online'));
    const centerBps = clamp(Math.round(number(row.center_cut_percent) * 100), 0, 10000);
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO tutoring_recurring_sessions(
         id, workspace_id, title, session_type, schedule_status, weekday, start_time,
         duration_minutes, travel_minutes, location, price_basis, default_price_pence,
         expected_student_count, center_cut_bps, active, created_at, updated_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`,
    ).bind(
      id, workspaceId, text(row.title, `Session ${oldId}`), sessionType, safeStatus,
      weekday, startTime, clamp(int(row.duration_minutes, 60), 15, 360), clamp(int(row.travel_minutes, 0), 0, 360),
      nullableText(row.location), row.price_basis === 'per_student' ? 'per_student' : 'total_session',
      Math.max(0, int(row.price_pence, 0)), clamp(int(row.student_count, 1), 1, 100), centerBps,
      flag(row.active, 1), timestamp(row.created_at), timestamp(row.updated_at),
    ));

    const oldStudentId = legacyKey(row.student_id);
    const newStudentId = studentIds.get(oldStudentId);
    if (newStudentId) {
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO tutoring_session_students(workspace_id, recurring_session_id, student_id, created_at)
         VALUES (?1,?2,?3,?4)`,
      ).bind(workspaceId, id, newStudentId, timestamp(row.created_at)));
    }
  }

  for (const row of occurrences) {
    const oldId = legacyKey(row.id);
    if (shadowOccurrenceIds.has(oldId)) continue;
    const id = occurrenceIds.get(oldId);
    const sessionId = sessionIds.get(legacyKey(row.recurring_session_id));
    if (!id || !sessionId) continue;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO tutoring_occurrences(
         id, workspace_id, recurring_session_id, session_date, scheduled_start,
         rescheduled_to_date, rescheduled_to_start, rescheduled_at, reschedule_note,
         status, gross_pence, center_cut_pence, earned_pence, completed_at, note,
         created_from, created_at, updated_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'migration',?16,?17)`,
    ).bind(
      id, workspaceId, sessionId, text(row.session_date), nullableText(row.scheduled_start),
      nullableText(row.rescheduled_to_date), nullableText(row.rescheduled_to_start), nullableText(row.rescheduled_at), nullableText(row.reschedule_note),
      mapOccurrenceStatus(row.status), Math.max(0, int(row.gross_pence)), Math.max(0, int(row.center_cut_pence)), Math.max(0, int(row.earned_pence)),
      nullableText(row.completed_at), nullableText(row.note), timestamp(row.created_at), timestamp(row.updated_at),
    ));
  }

  for (const row of billingPlans) {
    const studentId = studentIds.get(legacyKey(row.student_id));
    if (!studentId) continue;
    const mode = row.billing_mode === 'package' ? 'package' : 'per_session';
    const packageSize = mode === 'package' ? clamp(int(row.package_size, 8), 1, 100) : null;
    const packagePrice = mode === 'package' ? Math.max(0, int(row.package_price_pence, 0)) : null;
    const effectiveFrom = nullableText(row.created_at) ?? nullableText(row.cycle_anchor_date) ?? new Date().toISOString();
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO tutoring_billing_plans(
         workspace_id, student_id, billing_mode, package_size, package_price_pence,
         cycle_anchor_date, effective_from, created_at, updated_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
    ).bind(
      workspaceId, studentId, mode, packageSize, packagePrice,
      nullableText(row.cycle_anchor_date), effectiveFrom, timestamp(row.created_at), timestamp(row.updated_at),
    ));
  }

  for (const row of billingCycles) {
    const oldCycleId = legacyKey(row.id);
    const id = cycleIds.get(oldCycleId);
    const studentId = studentIds.get(legacyKey(row.student_id));
    if (!id || !studentId) continue;
    const opening = openingByCycle.get(oldCycleId);
    const openingCompleted = opening ? clamp(int(opening.opening_completed), 0, clamp(int(row.package_size, 8), 1, 100)) : 0;
    const realRows = realCycleOccurrencesByCycle.get(oldCycleId) ?? [];
    const openingLockedAt = openingCompleted > 0 && realRows.length > 0
      ? timestamp(opening?.updated_at ?? opening?.created_at)
      : null;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO tutoring_billing_cycles(
         id, workspace_id, student_id, sequence_no, session_limit, price_pence,
         opening_completed_count, opening_progress_locked_at, status,
         started_on, completed_on, paid_on, created_at, updated_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`,
    ).bind(
      id, workspaceId, studentId, Math.max(1, int(row.cycle_no, 1)), clamp(int(row.package_size, 8), 1, 100),
      Math.max(0, int(row.package_price_pence)), openingCompleted, openingLockedAt, mapCycleStatus(row.status),
      nullableText(opening?.cycle_start_date) ?? nullableText(row.started_on), nullableText(row.completed_on), nullableText(row.paid_on),
      timestamp(row.created_at), timestamp(row.updated_at),
    ));
  }

  for (const row of cycleOccurrences) {
    const occurrenceOldId = legacyKey(row.occurrence_id);
    if (shadowOccurrenceIds.has(occurrenceOldId)) continue;
    const cycleId = cycleIds.get(legacyKey(row.cycle_id));
    const occurrenceId = occurrenceIds.get(occurrenceOldId);
    if (!cycleId || !occurrenceId) continue;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO tutoring_billing_cycle_occurrences(
         workspace_id, billing_cycle_id, occurrence_id, position, earned_pence, created_at
       ) VALUES (?1,?2,?3,?4,?5,?6)`,
    ).bind(
      workspaceId, cycleId, occurrenceId, Math.max(1, int(row.position, 1)), Math.max(0, int(row.earned_pence)), timestamp(row.created_at),
    ));
  }

  for (const row of receipts) {
    const oldId = legacyKey(row.id);
    const id = receiptIds.get(oldId);
    const studentId = studentIds.get(legacyKey(row.student_id));
    if (!id || !studentId || int(row.amount_pence) <= 0) continue;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO finance_receipts(
         id, workspace_id, payer_ref_type, payer_ref_id, amount_pence, received_at,
         payment_method, source_kind, note, deleted_at, created_at, updated_at
       ) VALUES (?1,?2,'tutoring.student',?3,?4,?5,?6,'migration',?7,?8,?9,?10)`,
    ).bind(
      id, workspaceId, studentId, int(row.amount_pence), text(row.received_at), paymentMethod(row.payment_method),
      nullableText(row.note), nullableText(row.deleted_at), timestamp(row.created_at), timestamp(row.updated_at),
    ));
  }

  for (const row of payments) {
    const oldId = legacyKey(row.id);
    const id = paymentReceiptIds.get(oldId);
    const occurrenceOldId = legacyKey(row.occurrence_id);
    const occurrenceId = occurrenceIds.get(occurrenceOldId);
    if (!id || !occurrenceId || int(row.amount_pence) <= 0) continue;
    const occurrence = occurrenceById.get(occurrenceOldId);
    const session = occurrence ? sessionById.get(legacyKey(occurrence.recurring_session_id)) : undefined;
    const studentId = session ? studentIds.get(legacyKey(session.student_id)) : undefined;
    const note = [nullableText(row.note), nullableText(row.reversal_reason)].filter(Boolean).join(' · ') || null;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO finance_receipts(
         id, workspace_id, payer_ref_type, payer_ref_id, amount_pence, received_at,
         payment_method, source_kind, source_module, source_entity_type, source_entity_id,
         note, deleted_at, created_at, updated_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,'migration','tutoring','occurrence',?8,?9,?10,?11,?12)`,
    ).bind(
      id, workspaceId, studentId ? 'tutoring.student' : null, studentId ?? null,
      int(row.amount_pence), text(row.paid_at), paymentMethod(row.payment_method), occurrenceId,
      note, nullableText(row.reversed_at), timestamp(row.created_at), timestamp(row.created_at),
    ));
  }

  const allocationMap = new Map<string, { idSeed: string; receiptId: string; targetType: string; targetId: string; amount: number; createdAt: string }>();
  for (const row of receiptAllocations) {
    const receiptId = receiptIds.get(legacyKey(row.receipt_id));
    const occurrenceId = occurrenceIds.get(legacyKey(row.occurrence_id));
    if (!receiptId || !occurrenceId || int(row.amount_pence) <= 0) continue;
    addAllocation(allocationMap, `receipt:${legacyKey(row.receipt_id)}:occurrence:${legacyKey(row.occurrence_id)}`, receiptId, 'occurrence', occurrenceId, int(row.amount_pence), timestamp(row.created_at));
  }
  for (const row of packageAllocations) {
    const receiptId = receiptIds.get(legacyKey(row.receipt_id));
    const cycleId = cycleIds.get(legacyKey(row.cycle_id));
    if (!receiptId || !cycleId || int(row.amount_pence) <= 0) continue;
    addAllocation(allocationMap, `receipt:${legacyKey(row.receipt_id)}:cycle:${legacyKey(row.cycle_id)}`, receiptId, 'package_cycle', cycleId, int(row.amount_pence), timestamp(row.created_at));
  }
  for (const row of payments) {
    const receiptId = paymentReceiptIds.get(legacyKey(row.id));
    const occurrenceId = occurrenceIds.get(legacyKey(row.occurrence_id));
    if (!receiptId || !occurrenceId || int(row.amount_pence) <= 0) continue;
    addAllocation(allocationMap, `payment:${legacyKey(row.id)}:occurrence:${legacyKey(row.occurrence_id)}`, receiptId, 'occurrence', occurrenceId, int(row.amount_pence), timestamp(row.created_at));
  }
  for (const allocation of allocationMap.values()) {
    const id = await ids.id('allocation', allocation.idSeed);
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO finance_receipt_allocations(
         id, workspace_id, receipt_id, target_module, target_type, target_id, amount_pence, created_at
       ) VALUES (?1,?2,?3,'tutoring',?4,?5,?6,?7)`,
    ).bind(id, workspaceId, allocation.receiptId, allocation.targetType, allocation.targetId, allocation.amount, allocation.createdAt));
  }

  for (const row of expenses) {
    const id = expenseIds.get(legacyKey(row.id));
    if (!id || int(row.amount_pence) <= 0) continue;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO finance_expenses(
         id, workspace_id, expense_date, scope, category, amount_pence, note,
         deleted_at, created_at, updated_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`,
    ).bind(
      id, workspaceId, text(row.expense_date), row.scope === 'personal' ? 'personal' : 'business',
      text(row.category, 'other'), int(row.amount_pence), nullableText(row.note), nullableText(row.deleted_at),
      timestamp(row.created_at), timestamp(row.updated_at),
    ));
  }

  for (const row of otherIncome) {
    const id = incomeIds.get(legacyKey(row.id));
    if (!id || int(row.amount_pence) <= 0) continue;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO finance_other_income(
         id, workspace_id, income_date, category, amount_pence, note,
         deleted_at, created_at, updated_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`,
    ).bind(
      id, workspaceId, text(row.income_date), text(row.category, 'other'), int(row.amount_pence), nullableText(row.note),
      nullableText(row.deleted_at), timestamp(row.created_at), timestamp(row.updated_at),
    ));
  }

  for (const row of cashChecks) {
    const id = cashCheckIds.get(legacyKey(row.id));
    if (!id) continue;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO finance_cash_checks(
         id, workspace_id, check_date, expected_balance_pence, actual_balance_pence,
         difference_pence, note, created_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
    ).bind(
      id, workspaceId, text(row.check_date), int(row.expected_balance_pence), int(row.actual_balance_pence),
      int(row.difference_pence), nullableText(row.note), timestamp(row.created_at),
    ));
  }

  for (const row of activities) {
    const id = activityIds.get(legacyKey(row.id));
    if (!id) continue;
    const mapped = mapActivityEntity(row, studentIds, sessionIds, occurrenceIds, receiptIds, paymentReceiptIds, expenseIds, incomeIds);
    if (mapped.skip) continue;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO core_activity_events(
         id, workspace_id, module_key, entity_type, entity_id, action, title, detail,
         before_json, after_json, undoable, undone_at, actor_user_id, created_at
       ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`,
    ).bind(
      id, workspaceId, mapped.moduleKey, mapped.entityType, mapped.entityId,
      text(row.action, 'imported'), text(row.title, 'Imported activity'), nullableText(row.detail),
      nullableText(row.before_json), nullableText(row.after_json), flag(row.undoable, 0), nullableText(row.undone_at),
      actorUserId, timestamp(row.created_at),
    ));
  }

  await runBatches(db, statements, 50);

  for (const row of settings) {
    const key = text(row.key);
    if (!key) continue;
    const value = text(row.value);
    if (key === 'currency_label' && value) {
      await db.prepare(`UPDATE core_workspaces SET currency_label = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`)
        .bind(workspaceId, value).run();
    }
    if (key === 'opening_balance_pence') await upsertSetting(db, workspaceId, 'finance.opening_balance_pence', value);
    if (key === 'cash_check_frequency_days') await upsertSetting(db, workspaceId, 'finance.cash_check_frequency_days', value);
    await upsertSetting(db, workspaceId, `legacy.sozan1.${key}`, value);
  }

  const summary: ImportSummary = {
    students: students.length,
    recurringSessions: sessions.length - shadowSessionIds.size,
    occurrences: occurrences.length - shadowOccurrenceIds.size,
    billingPlans: billingPlans.length,
    billingCycles: billingCycles.length,
    receipts: receipts.length + payments.length,
    allocations: allocationMap.size,
    expenses: expenses.length,
    otherIncome: otherIncome.length,
    cashChecks: cashChecks.length,
    activityEvents: activities.length,
    skippedShadowSessions: shadowSessionIds.size,
    skippedShadowOccurrences: shadowOccurrenceIds.size,
    legacyMonthlyDues: monthlyDues.length,
  };

  const warnings: string[] = [];
  if (monthlyDues.length > 0) {
    warnings.push('LEGACY_MONTHLY_DUES_PRESERVED_AS_LEGACY_ONLY');
    await upsertSetting(db, workspaceId, 'migration.sozan1.monthly_dues_count', String(monthlyDues.length));
  }
  await upsertSetting(db, workspaceId, 'migration.sozan1.source_exported_at', payload.exportedAt ?? 'unknown');
  await upsertSetting(db, workspaceId, 'migration.sozan1.summary', JSON.stringify(summary));
  await upsertSetting(db, workspaceId, 'migration.sozan1.completed_at', new Date().toISOString());

  return { summary, warnings };
}

async function assertTargetReady(db: D1Database, workspaceId: string): Promise<void> {
  const completed = await db.prepare(
    `SELECT value FROM core_workspace_settings WHERE workspace_id=?1 AND key='migration.sozan1.completed_at'`,
  ).bind(workspaceId).first<{ value: string }>();
  if (completed) throw new Error('MIGRATION_ALREADY_COMPLETED');

  const started = await db.prepare(
    `SELECT value FROM core_workspace_settings WHERE workspace_id=?1 AND key='migration.sozan1.started_at'`,
  ).bind(workspaceId).first<{ value: string }>();
  if (started) return;

  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM tutoring_students WHERE workspace_id=?1) +
       (SELECT COUNT(*) FROM tutoring_recurring_sessions WHERE workspace_id=?1) +
       (SELECT COUNT(*) FROM tutoring_occurrences WHERE workspace_id=?1) +
       (SELECT COUNT(*) FROM finance_receipts WHERE workspace_id=?1) +
       (SELECT COUNT(*) FROM finance_expenses WHERE workspace_id=?1) +
       (SELECT COUNT(*) FROM finance_other_income WHERE workspace_id=?1) AS total`,
  ).bind(workspaceId).first<{ total: number }>();
  if (Number(counts?.total ?? 0) > 0) throw new Error('MIGRATION_TARGET_NOT_EMPTY');
}

async function upsertSetting(db: D1Database, workspaceId: string, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO core_workspace_settings(workspace_id,key,value,updated_at)
     VALUES (?1,?2,?3,CURRENT_TIMESTAMP)
     ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`,
  ).bind(workspaceId, key, value).run();
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[], size: number): Promise<void> {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

class LegacyIds {
  private readonly cache = new Map<string, string>();
  constructor(private readonly workspaceId: string) {}

  async id(kind: string, legacyId: string): Promise<string> {
    const key = `${kind}:${legacyId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${this.workspaceId}|sozan1|${key}`)));
    const bytes = digest.slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    this.cache.set(key, uuid);
    return uuid;
  }

  async mapRows(kind: string, rows: LegacyRow[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const row of rows) {
      const oldId = legacyKey(row.id);
      if (!oldId) continue;
      result.set(oldId, await this.id(kind, oldId));
    }
    return result;
  }
}

function addAllocation(
  map: Map<string, { idSeed: string; receiptId: string; targetType: string; targetId: string; amount: number; createdAt: string }>,
  seed: string,
  receiptId: string,
  targetType: string,
  targetId: string,
  amount: number,
  createdAt: string,
): void {
  const key = `${receiptId}|${targetType}|${targetId}`;
  const existing = map.get(key);
  if (existing) {
    existing.amount += amount;
    if (createdAt < existing.createdAt) existing.createdAt = createdAt;
    return;
  }
  map.set(key, { idSeed: seed, receiptId, targetType, targetId, amount, createdAt });
}

function mapActivityEntity(
  row: LegacyRow,
  students: Map<string, string>,
  sessions: Map<string, string>,
  occurrences: Map<string, string>,
  receipts: Map<string, string>,
  paymentReceipts: Map<string, string>,
  expenses: Map<string, string>,
  income: Map<string, string>,
): { moduleKey: string; entityType: string; entityId: string | null; skip?: boolean } {
  const type = text(row.entity_type, 'legacy');
  const oldId = legacyKey(row.entity_id);
  if (type === 'student') return { moduleKey: 'tutoring', entityType: 'student', entityId: students.get(oldId) ?? null, skip: oldId !== '' && !students.has(oldId) };
  if (type === 'session') return { moduleKey: 'tutoring', entityType: 'session', entityId: sessions.get(oldId) ?? null, skip: oldId !== '' && !sessions.has(oldId) };
  if (type === 'occurrence') return { moduleKey: 'tutoring', entityType: 'occurrence', entityId: occurrences.get(oldId) ?? null, skip: oldId !== '' && !occurrences.has(oldId) };
  if (type === 'receipt') return { moduleKey: 'finance', entityType: 'receipt', entityId: receipts.get(oldId) ?? null };
  if (type === 'payment') return { moduleKey: 'finance', entityType: 'receipt', entityId: paymentReceipts.get(oldId) ?? occurrences.get(oldId) ?? null };
  if (type === 'expense') return { moduleKey: 'finance', entityType: 'expense', entityId: expenses.get(oldId) ?? null };
  if (type === 'other_income') return { moduleKey: 'finance', entityType: 'other_income', entityId: income.get(oldId) ?? null };
  if (type === 'settings') return { moduleKey: 'core', entityType: 'settings', entityId: null };
  return { moduleKey: 'core', entityType: `legacy.${type}`, entityId: null };
}

function legacyKey(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string') return value.trim();
  return '';
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(value: unknown, fallback = 0): number {
  return Math.trunc(number(value, fallback));
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function flag(value: unknown, fallback: 0 | 1): 0 | 1 {
  if (value === 0 || value === '0' || value === false) return 0;
  if (value === 1 || value === '1' || value === true) return 1;
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function timestamp(value: unknown): string {
  return nullableText(value) ?? new Date().toISOString();
}

function mapSessionType(value: string): 'private_student_home' | 'private_tutor_home' | 'online' | 'center_group' | 'own_group' {
  if (value === 'private_student_home' || value === 'online' || value === 'center_group' || value === 'own_group') return value;
  if (value === 'private_sozan_home') return 'private_tutor_home';
  return 'online';
}

function mapOccurrenceStatus(value: unknown): 'scheduled' | 'completed' | 'cancelled' | 'missed' {
  return value === 'completed' || value === 'cancelled' || value === 'missed' ? value : 'scheduled';
}

function mapCycleStatus(value: unknown): 'open' | 'due' | 'paid' | 'cancelled' {
  return value === 'due' || value === 'paid' ? value : 'open';
}

function paymentMethod(value: unknown): 'cash' | 'bank' | 'wallet' | 'other' {
  return value === 'bank' || value === 'wallet' || value === 'other' ? value : 'cash';
}

import { z } from 'zod';

export const FULL_BACKUP_SCHEMA_VERSION = 'sozan2-full-backup-v1' as const;
export const BACKUP_ENGINE_VERSION = 'backup-engine-v2' as const;

const backupRow = z.record(z.string(), z.unknown());
const rows = z.array(backupRow);

export const workspaceBackupSchema = z.object({
  schemaVersion: z.literal(FULL_BACKUP_SCHEMA_VERSION),
  engineVersion: z.literal(BACKUP_ENGINE_VERSION).optional(),
  backupId: z.string().uuid().optional(),
  exportedAt: z.string().min(10).max(50),
  manifest: z.object({
    students: z.number().int().min(0),
    sessions: z.number().int().min(0),
    baselines: z.number().int().min(0),
    occurrences: z.number().int().min(0),
    receipts: z.number().int().min(0),
    expenses: z.number().int().min(0),
    activityEvents: z.number().int().min(0),
  }).optional(),
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200),
    templateKey: z.string().min(1).max(80),
    locale: z.string().min(1).max(40),
    timezone: z.string().min(1).max(100),
    currencyCode: z.string().min(1).max(12),
    currencyLabel: z.string().min(1).max(40),
  }),
  stores: z.object({
    coreWorkspaceModules: rows,
    coreWorkspaceLabels: rows,
    coreWorkspaceSettings: rows,
    coreSurfaceLayouts: rows,
    coreActivityEvents: rows,
    tutoringStudents: rows,
    tutoringStudentBaselines: rows,
    tutoringSessions: rows,
    tutoringOccurrences: rows,
    tutoringBillingPlans: rows,
    tutoringBillingCycles: rows,
    tutoringBillingCycleOccurrences: rows,
    appointmentsClients: rows,
    appointmentsItems: rows,
    financeReceipts: rows,
    financeAllocations: rows,
    financeExpenses: rows,
    financeOtherIncome: rows,
    financeCashChecks: rows,
  }),
});

export type WorkspaceBackup = z.infer<typeof workspaceBackupSchema>;

export const backupImportRequestSchema = z.object({
  importId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  backup: workspaceBackupSchema,
});

export type BackupImportRequest = z.infer<typeof backupImportRequestSchema>;

export type BackupImportStatus =
  | {
      importId: string;
      status: 'applying';
      expectedRevision: number;
      revision: null;
      error: null;
    }
  | {
      importId: string;
      status: 'completed';
      expectedRevision: number;
      revision: number;
      error: null;
    }
  | {
      importId: string;
      status: 'failed';
      expectedRevision: number;
      revision: number | null;
      error: string;
    };

export const BACKUP_STORE_KEYS = Object.keys(
  workspaceBackupSchema.shape.stores.shape,
) as Array<keyof WorkspaceBackup['stores']>;

export function assertBackupWorkspaceScope(backup: WorkspaceBackup): void {
  const workspaceId = backup.workspace.id;
  for (const key of BACKUP_STORE_KEYS) {
    for (const row of backup.stores[key]) {
      if (row.workspaceId !== workspaceId) {
        throw new Error('BACKUP_WORKSPACE_SCOPE_MISMATCH');
      }
    }
  }
}


export type BackupValidationSummary = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  counts: {
    students: number;
    sessions: number;
    baselines: number;
    occurrences: number;
    receipts: number;
    expenses: number;
    activityEvents: number;
  };
};

function stringId(row: Record<string, unknown>, key = 'id'): string {
  return typeof row[key] === 'string' ? String(row[key]) : '';
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function uniqueFieldError(
  rows: Array<Record<string, unknown>>,
  key: string,
  code: string,
  errors: string[],
): void {
  if (duplicateValues(rows.map((row) => stringId(row, key))).length) errors.push(code);
}

function validClock(value: unknown): boolean {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

export function validateWorkspaceBackup(backup: WorkspaceBackup): BackupValidationSummary {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    assertBackupWorkspaceScope(backup);
  } catch {
    errors.push('BACKUP_WORKSPACE_SCOPE_MISMATCH');
  }

  const s = backup.stores;
  const students = s.tutoringStudents as Array<Record<string, unknown>>;
  const sessions = s.tutoringSessions as Array<Record<string, unknown>>;
  const baselines = s.tutoringStudentBaselines as Array<Record<string, unknown>>;
  const occurrences = s.tutoringOccurrences as Array<Record<string, unknown>>;
  const billingPlans = s.tutoringBillingPlans as Array<Record<string, unknown>>;
  const billingCycles = s.tutoringBillingCycles as Array<Record<string, unknown>>;
  const cycleOccurrences = s.tutoringBillingCycleOccurrences as Array<Record<string, unknown>>;
  const clients = s.appointmentsClients as Array<Record<string, unknown>>;
  const appointments = s.appointmentsItems as Array<Record<string, unknown>>;
  const receipts = s.financeReceipts as Array<Record<string, unknown>>;
  const allocations = s.financeAllocations as Array<Record<string, unknown>>;
  const expenses = s.financeExpenses as Array<Record<string, unknown>>;
  const settings = s.coreWorkspaceSettings as Array<Record<string, unknown>>;
  const labels = s.coreWorkspaceLabels as Array<Record<string, unknown>>;
  const modules = s.coreWorkspaceModules as Array<Record<string, unknown>>;

  uniqueFieldError(students, 'id', 'BACKUP_DUPLICATE_STUDENT_ID', errors);
  uniqueFieldError(sessions, 'id', 'BACKUP_DUPLICATE_SESSION_ID', errors);
  uniqueFieldError(occurrences, 'id', 'BACKUP_DUPLICATE_OCCURRENCE_ID', errors);
  uniqueFieldError(billingCycles, 'id', 'BACKUP_DUPLICATE_BILLING_CYCLE_ID', errors);
  uniqueFieldError(clients, 'id', 'BACKUP_DUPLICATE_CLIENT_ID', errors);
  uniqueFieldError(appointments, 'id', 'BACKUP_DUPLICATE_APPOINTMENT_ID', errors);
  uniqueFieldError(receipts, 'id', 'BACKUP_DUPLICATE_RECEIPT_ID', errors);
  uniqueFieldError(expenses, 'id', 'BACKUP_DUPLICATE_EXPENSE_ID', errors);
  uniqueFieldError(settings, 'key', 'BACKUP_DUPLICATE_SETTING_KEY', errors);
  uniqueFieldError(labels, 'labelKey', 'BACKUP_DUPLICATE_LABEL_KEY', errors);
  uniqueFieldError(modules, 'moduleKey', 'BACKUP_DUPLICATE_MODULE_KEY', errors);

  const studentIds = new Set(students.map((row) => stringId(row)).filter(Boolean));
  const sessionIds = new Set(sessions.map((row) => stringId(row)).filter(Boolean));
  const occurrenceIds = new Set(occurrences.map((row) => stringId(row)).filter(Boolean));
  const cycleIds = new Set(billingCycles.map((row) => stringId(row)).filter(Boolean));
  const clientIds = new Set(clients.map((row) => stringId(row)).filter(Boolean));
  const receiptIds = new Set(receipts.map((row) => stringId(row)).filter(Boolean));

  for (const row of students) {
    if (!stringId(row) || typeof row.name !== 'string' || !row.name.trim()) {
      errors.push('BACKUP_STUDENT_INVALID');
      break;
    }
  }

  for (const row of sessions) {
    const id = stringId(row);
    const linked = Array.isArray(row.studentIds)
      ? [...new Set(row.studentIds.filter((value): value is string => typeof value === 'string'))]
      : [];
    if (!id || typeof row.title !== 'string' || !row.title.trim()) {
      errors.push('BACKUP_SESSION_INVALID');
      continue;
    }
    if (linked.some((studentId) => !studentIds.has(studentId))) {
      errors.push('BACKUP_SESSION_STUDENT_MISSING');
    }
    const payer = typeof row.payerStudentId === 'string' ? row.payerStudentId : null;
    if (payer && !linked.includes(payer)) errors.push('BACKUP_SESSION_PAYER_NOT_LINKED');
    if (row.scheduleStatus === 'confirmed') {
      const weekday = Number(row.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !validClock(row.startTime)) {
        errors.push('BACKUP_CONFIRMED_SESSION_SCHEDULE_INVALID');
      }
    }
    const duration = Number(row.durationMinutes);
    const travel = Number(row.travelMinutes);
    const expected = Number(row.expectedStudentCount);
    if (!Number.isInteger(duration) || duration < 15 || duration > 360) {
      errors.push('BACKUP_SESSION_DURATION_INVALID');
    }
    if (!Number.isInteger(travel) || travel < 0 || travel > 360) {
      errors.push('BACKUP_SESSION_TRAVEL_INVALID');
    }
    if (!Number.isInteger(expected) || expected < 1 || expected > 100 || expected < linked.length) {
      errors.push('BACKUP_SESSION_STUDENT_COUNT_INVALID');
    }
    if (row.sessionType === 'center_group' && linked.length === 0 && expected > 0) {
      warnings.push('BACKUP_CENTER_GROUP_MEMBERSHIP_DAY_UNASSIGNED');
    }
  }

  const baselineStudents = new Set<string>();
  for (const row of baselines) {
    const studentId = stringId(row, 'studentId');
    const completed = Number(row.completedLessonsBeforeTracking);
    if (!studentIds.has(studentId)) errors.push('BACKUP_BASELINE_STUDENT_MISSING');
    if (baselineStudents.has(studentId)) errors.push('BACKUP_DUPLICATE_STUDENT_BASELINE');
    baselineStudents.add(studentId);
    if (!Number.isInteger(completed) || completed < 0) errors.push('BACKUP_BASELINE_COUNT_INVALID');
  }

  for (const row of occurrences) {
    if (!sessionIds.has(stringId(row, 'recurringSessionId'))) {
      errors.push('BACKUP_OCCURRENCE_SESSION_MISSING');
    }
    const attendance = Array.isArray(row.attendance) ? row.attendance : [];
    for (const item of attendance) {
      if (!item || typeof item !== 'object') {
        errors.push('BACKUP_ATTENDANCE_INVALID');
        continue;
      }
      const studentId = stringId(item as Record<string, unknown>, 'studentId');
      if (!studentIds.has(studentId)) errors.push('BACKUP_ATTENDANCE_STUDENT_MISSING');
    }
  }

  const planStudents = new Set<string>();
  for (const row of billingPlans) {
    const studentId = stringId(row, 'studentId');
    if (!studentIds.has(studentId)) errors.push('BACKUP_BILLING_PLAN_STUDENT_MISSING');
    if (planStudents.has(studentId)) errors.push('BACKUP_DUPLICATE_BILLING_PLAN');
    planStudents.add(studentId);
  }

  for (const row of billingCycles) {
    if (!studentIds.has(stringId(row, 'studentId'))) errors.push('BACKUP_BILLING_CYCLE_STUDENT_MISSING');
    const limit = Number(row.sessionLimit);
    const opening = Number(row.openingCompletedCount);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isInteger(opening) || opening < 0 || opening > limit) {
      errors.push('BACKUP_BILLING_CYCLE_PROGRESS_INVALID');
    }
  }

  for (const row of cycleOccurrences) {
    if (!cycleIds.has(stringId(row, 'billingCycleId'))) errors.push('BACKUP_CYCLE_LINK_CYCLE_MISSING');
    if (!occurrenceIds.has(stringId(row, 'occurrenceId'))) errors.push('BACKUP_CYCLE_LINK_OCCURRENCE_MISSING');
  }

  for (const row of appointments) {
    const clientId = typeof row.clientId === 'string' ? row.clientId : null;
    if (clientId && !clientIds.has(clientId)) errors.push('BACKUP_APPOINTMENT_CLIENT_MISSING');
  }

  for (const row of allocations) {
    if (!receiptIds.has(stringId(row, 'receiptId'))) errors.push('BACKUP_ALLOCATION_RECEIPT_MISSING');
  }

  const counts = {
    students: students.length,
    sessions: sessions.length,
    baselines: baselines.length,
    occurrences: occurrences.length,
    receipts: receipts.length,
    expenses: expenses.length,
    activityEvents: s.coreActivityEvents.length,
  };

  if (backup.manifest) {
    for (const [key, value] of Object.entries(counts)) {
      if (backup.manifest[key as keyof typeof counts] !== value) {
        errors.push('BACKUP_MANIFEST_COUNT_MISMATCH');
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    counts,
  };
}

export function backupManifest(backup: Pick<WorkspaceBackup, 'stores'>): NonNullable<WorkspaceBackup['manifest']> {
  return {
    students: backup.stores.tutoringStudents.length,
    sessions: backup.stores.tutoringSessions.length,
    baselines: backup.stores.tutoringStudentBaselines.length,
    occurrences: backup.stores.tutoringOccurrences.length,
    receipts: backup.stores.financeReceipts.length,
    expenses: backup.stores.financeExpenses.length,
    activityEvents: backup.stores.coreActivityEvents.length,
  };
}

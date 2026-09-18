import { z } from 'zod';

export const FULL_BACKUP_SCHEMA_VERSION = 'sozan2-full-backup-v1' as const;

const backupRow = z.record(z.string(), z.unknown());
const rows = z.array(backupRow);

export const workspaceBackupSchema = z.object({
  schemaVersion: z.literal(FULL_BACKUP_SCHEMA_VERSION),
  exportedAt: z.string().min(10).max(50),
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

import { describe, expect, it } from 'vitest';
import {
  assertBackupWorkspaceScope,
  FULL_BACKUP_SCHEMA_VERSION,
  workspaceBackupSchema,
} from '../src/modules/backup/workspace-backup';

function emptyStores() {
  return {
    coreWorkspaceModules: [],
    coreWorkspaceLabels: [],
    coreWorkspaceSettings: [],
    coreSurfaceLayouts: [],
    coreActivityEvents: [],
    tutoringStudents: [],
    tutoringStudentBaselines: [],
    tutoringSessions: [],
    tutoringOccurrences: [],
    tutoringBillingPlans: [],
    tutoringBillingCycles: [],
    tutoringBillingCycleOccurrences: [],
    appointmentsClients: [],
    appointmentsItems: [],
    financeReceipts: [],
    financeAllocations: [],
    financeExpenses: [],
    financeOtherIncome: [],
    financeCashChecks: [],
  };
}

describe('full workspace backup schema', () => {
  it('accepts a portable same-workspace backup', () => {
    const workspaceId = '10000000-0000-4000-8000-000000000001';
    const backup = workspaceBackupSchema.parse({
      schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-09-18T12:00:00.000Z',
      workspace: {
        id: workspaceId,
        name: 'Sozan',
        templateKey: 'tutoring',
        locale: 'ar-EG',
        timezone: 'Europe/London',
        currencyCode: 'EGP',
        currencyLabel: 'ج',
      },
      stores: {
        ...emptyStores(),
        tutoringStudents: [{
          id: '10000000-0000-4000-8000-000000000002',
          workspaceId,
          name: 'Student',
          active: true,
        }],
      },
    });

    expect(() => assertBackupWorkspaceScope(backup)).not.toThrow();
  });

  it('rejects rows belonging to another workspace', () => {
    const workspaceId = '10000000-0000-4000-8000-000000000001';
    const backup = workspaceBackupSchema.parse({
      schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-09-18T12:00:00.000Z',
      workspace: {
        id: workspaceId,
        name: 'Sozan',
        templateKey: 'tutoring',
        locale: 'ar-EG',
        timezone: 'Europe/London',
        currencyCode: 'EGP',
        currencyLabel: 'ج',
      },
      stores: {
        ...emptyStores(),
        financeReceipts: [{
          id: '10000000-0000-4000-8000-000000000003',
          workspaceId: '10000000-0000-4000-8000-000000000099',
        }],
      },
    });

    expect(() => assertBackupWorkspaceScope(backup))
      .toThrow('BACKUP_WORKSPACE_SCOPE_MISMATCH');
  });
});

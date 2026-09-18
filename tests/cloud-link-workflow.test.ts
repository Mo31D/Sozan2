import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceBackup } from '../src/modules/backup/workspace-backup';
import type { LocalPlatformSnapshot } from '../src/client/adapters/indexeddb/platform.repository';
import {
  linkExistingLocalWorkspaceToCloud,
  type CloudLinkWorkflowDependencies,
} from '../src/client/cloud/link-workflow';

const workspaceId = '10000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000002';

function snapshot(cloud = false): LocalPlatformSnapshot {
  return {
    user: {
      id: userId,
      displayName: 'User',
      locale: 'ar-EG',
      timezone: 'Europe/London',
      active: true,
      createdAt: '2026-09-18T00:00:00.000Z',
      updatedAt: '2026-09-18T00:00:00.000Z',
    },
    workspace: {
      id: workspaceId,
      name: 'Workspace',
      templateKey: 'tutoring',
      locale: 'ar-EG',
      timezone: 'Europe/London',
      currencyCode: 'EGP',
      currencyLabel: 'ج',
      ownerUserId: userId,
      active: true,
      createdAt: '2026-09-18T00:00:00.000Z',
      updatedAt: '2026-09-18T00:00:00.000Z',
    },
    modules: [],
    labels: {},
    cloudLink: cloud ? {
      workspaceId,
      userId,
      loginName: 'user',
      linkedAt: '2026-09-18T00:00:00.000Z',
      lastCloudPullAt: null,
      lastCloudPushAt: null,
      serverRevision: 1,
    } : null,
  };
}

function backup(): WorkspaceBackup {
  return {
    schemaVersion: 'sozan2-full-backup-v1',
    exportedAt: '2026-09-18T00:00:00.000Z',
    workspace: {
      id: workspaceId,
      name: 'Workspace',
      templateKey: 'tutoring',
      locale: 'ar-EG',
      timezone: 'Europe/London',
      currencyCode: 'EGP',
      currencyLabel: 'ج',
    },
    stores: {
      coreWorkspaceModules: [],
      coreWorkspaceLabels: [],
      coreWorkspaceSettings: [{ workspaceId, key: 'finance.opening_balance_pence', value: '5000' }],
      coreSurfaceLayouts: [],
      coreActivityEvents: [],
      tutoringStudents: [{ id: 'student-1', workspaceId, name: 'Student' }],
      tutoringStudentBaselines: [],
      tutoringSessions: [],
      tutoringOccurrences: [{ id: 'occurrence-1', workspaceId, status: 'completed' }],
      tutoringBillingPlans: [{ id: 'student-1', workspaceId, studentId: 'student-1', billingMode: 'package' }],
      tutoringBillingCycles: [{ id: 'cycle-1', workspaceId, studentId: 'student-1' }],
      tutoringBillingCycleOccurrences: [],
      appointmentsClients: [],
      appointmentsItems: [],
      financeReceipts: [{ id: 'receipt-1', workspaceId, amountPence: 5000 }],
      financeAllocations: [],
      financeExpenses: [{ id: 'expense-1', workspaceId, amountPence: 1000 }],
      financeOtherIncome: [],
      financeCashChecks: [],
    },
  };
}

describe('local workspace cloud promotion', () => {
  it('restores the complete workspace before marking the device cloud-linked', async () => {
    const original = snapshot(false);
    const linked = snapshot(true);
    const fullBackup = backup();
    const order: string[] = [];

    const deps: CloudLinkWorkflowDependencies = {
      createBackup: vi.fn(async () => { order.push('backup'); return fullBackup; }),
      register: vi.fn(async () => {
        order.push('register');
        return {
          account: {
            user: {
              id: userId,
              loginName: 'user',
              displayName: 'User',
              locale: 'ar-EG',
              timezone: 'Europe/London',
            },
            workspaces: [{
              id: workspaceId,
              name: 'Workspace',
              templateKey: 'tutoring',
              locale: 'ar-EG',
              timezone: 'Europe/London',
              currencyCode: 'EGP',
              currencyLabel: 'ج',
              role: 'owner',
            }],
          },
          recoveryCode: 'recovery-code-123',
          recoveryCodeShownOnce: true,
        };
      }),
      restoreCloud: vi.fn(async (_workspaceId, value) => {
        order.push('restore');
        expect(value.stores.financeReceipts).toHaveLength(1);
        expect(value.stores.financeExpenses).toHaveLength(1);
        expect(value.stores.tutoringBillingCycles).toHaveLength(1);
        expect(value.stores.tutoringOccurrences).toHaveLength(1);
        expect(value.stores.coreWorkspaceSettings).toHaveLength(1);
        return 1;
      }),
      clearOutbox: vi.fn(async () => { order.push('clear-outbox'); }),
      link: vi.fn(async () => { order.push('link'); }),
      load: vi.fn(async () => { order.push('load'); return linked; }),
      sync: vi.fn(async () => {
        order.push('sync');
        return { pushed: 0, pulled: true, pending: 0, failed: 0, deadLetters: 0, syncedAt: '2026-09-18T00:00:01.000Z' };
      }),
    };

    const result = await linkExistingLocalWorkspaceToCloud(
      original,
      { loginName: 'user', password: 'password-12345' },
      deps,
    );

    expect(result.recoveryCode).toBe('recovery-code-123');
    expect(order).toEqual(['backup', 'register', 'restore', 'clear-outbox', 'link', 'load', 'sync']);
  });

  it('never marks the local device linked when the initial cloud restore fails', async () => {
    const original = snapshot(false);
    const link = vi.fn(async () => undefined);
    const sync = vi.fn(async () => ({
      pushed: 0, pulled: true, pending: 0, failed: 0, deadLetters: 0, syncedAt: null,
    }));

    const deps: CloudLinkWorkflowDependencies = {
      createBackup: async () => backup(),
      register: async () => ({
        account: {
          user: { id: userId, loginName: 'user', displayName: 'User', locale: 'ar-EG', timezone: 'Europe/London' },
          workspaces: [],
        },
        recoveryCode: 'recovery-code-123',
        recoveryCodeShownOnce: true,
      }),
      restoreCloud: async () => { throw new Error('BACKUP_RESTORE_FAILED'); },
      clearOutbox: async () => undefined,
      link,
      load: async () => snapshot(true),
      sync,
    };

    await expect(linkExistingLocalWorkspaceToCloud(
      original,
      { loginName: 'user', password: 'password-12345' },
      deps,
    )).rejects.toThrow('BACKUP_RESTORE_FAILED');

    expect(link).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });
});

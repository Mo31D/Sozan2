import { describe, expect, it } from 'vitest';
import {
  FULL_BACKUP_SCHEMA_VERSION,
  validateWorkspaceBackup,
  type WorkspaceBackup,
} from '../src/modules/backup/workspace-backup';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';

function backup(): WorkspaceBackup {
  return {
    schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-09-18T17:00:00.000Z',
    workspace: {
      id: workspaceId,
      name: 'دروسي',
      templateKey: 'tutoring',
      locale: 'ar-EG',
      timezone: 'Europe/London',
      currencyCode: 'EGP',
      currencyLabel: 'جنيه',
    },
    stores: {
      coreWorkspaceModules: [],
      coreWorkspaceLabels: [],
      coreWorkspaceSettings: [],
      coreSurfaceLayouts: [],
      coreActivityEvents: [],
      tutoringStudents: [{
        id: studentId,
        workspaceId,
        name: 'طالب',
        active: true,
      }],
      tutoringStudentBaselines: [{
        id: studentId,
        workspaceId,
        studentId,
        completedLessonsBeforeTracking: 4,
        sourceNote: null,
        observedAt: '2026-09-17',
      }],
      tutoringSessions: [{
        id: sessionId,
        workspaceId,
        title: 'طالب',
        sessionType: 'online',
        scheduleStatus: 'confirmed',
        weekday: 1,
        startTime: '18:00',
        durationMinutes: 90,
        travelMinutes: 0,
        location: null,
        priceBasis: 'total_session',
        defaultPricePence: 0,
        expectedStudentCount: 1,
        centerCutBps: 0,
        active: true,
        payerStudentId: studentId,
        studentIds: [studentId],
      }],
      tutoringOccurrences: [],
      tutoringBillingPlans: [],
      tutoringBillingCycles: [],
      tutoringBillingCycleOccurrences: [],
      tutoringBillingAccounts: [],
      tutoringBillingAccountMembers: [],
      tutoringBillingAccountCycles: [],
      appointmentsClients: [],
      appointmentsItems: [],
      financeReceipts: [],
      financeAllocations: [],
      financeExpenses: [],
      financeOtherIncome: [],
      financeCashChecks: [],
    },
  };
}

describe('Sozan2 full backup validation', () => {
  it('accepts a coherent editable Sozan2 backup', () => {
    const result = validateWorkspaceBackup(backup());
    expect(result.valid).toBe(true);
    expect(result.counts).toMatchObject({
      students: 1,
      sessions: 1,
      baselines: 1,
    });
  });

  it('rejects a session linked to a missing student', () => {
    const value = backup();
    value.stores.tutoringSessions[0].studentIds = [
      '44444444-4444-4444-8444-444444444444',
    ];
    value.stores.tutoringSessions[0].payerStudentId = null;
    const result = validateWorkspaceBackup(value);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('BACKUP_SESSION_STUDENT_MISSING');
  });

  it('rejects a manifest whose counts no longer match an edited file', () => {
    const value = backup();
    value.manifest = {
      students: 2,
      sessions: 1,
      baselines: 1,
      occurrences: 0,
      receipts: 0,
      expenses: 0,
      activityEvents: 0,
    };
    const result = validateWorkspaceBackup(value);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('BACKUP_MANIFEST_COUNT_MISMATCH');
  });

  it('validates family billing references and prevents duplicate active membership', () => {
    const value = backup();
    value.stores.tutoringStudents.push({
      id: '22222222-2222-4222-8222-222222222223',
      workspaceId,
      name: 'طالب 2',
      active: true,
    });
    value.stores.tutoringBillingAccounts.push({
      id: '55555555-5555-4555-8555-555555555555',
      workspaceId,
      displayName: 'طالب + طالب 2',
      accountType: 'family',
      countingMode: 'per_member_quota',
      primaryStudentId: studentId,
      packageSize: 8,
      packagePricePence: 70000,
      effectiveFrom: '2026-09-19',
      active: true,
    });
    value.stores.tutoringBillingAccountMembers.push(
      {
        id: '66666666-6666-4666-8666-666666666661',
        workspaceId,
        billingAccountId: '55555555-5555-4555-8555-555555555555',
        studentId,
        position: 0,
        active: true,
      },
      {
        id: '66666666-6666-4666-8666-666666666662',
        workspaceId,
        billingAccountId: '55555555-5555-4555-8555-555555555555',
        studentId: '22222222-2222-4222-8222-222222222223',
        position: 1,
        active: true,
      },
    );
    value.stores.tutoringBillingAccountCycles.push({
      id: '77777777-7777-4777-8777-777777777777',
      workspaceId,
      billingAccountId: '55555555-5555-4555-8555-555555555555',
      sequenceNo: 1,
      packageSize: 8,
      pricePence: 70000,
      status: 'open',
      startedOn: '2026-09-19',
      completedOn: null,
      paidOn: null,
    });

    expect(validateWorkspaceBackup(value).valid).toBe(true);

    value.stores.tutoringBillingAccountMembers.push({
      id: '66666666-6666-4666-8666-666666666663',
      workspaceId,
      billingAccountId: '55555555-5555-4555-8555-555555555555',
      studentId,
      position: 2,
      active: true,
    });
    const invalid = validateWorkspaceBackup(value);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain('BACKUP_STUDENT_IN_MULTIPLE_ACTIVE_BILLING_ACCOUNTS');
  });

  it('allows center membership without inventing a weekday-specific student list', () => {
    const value = backup();
    value.stores.tutoringSessions[0] = {
      ...value.stores.tutoringSessions[0],
      title: 'السنتر',
      sessionType: 'center_group',
      expectedStudentCount: 5,
      studentIds: [],
      payerStudentId: null,
    };
    const result = validateWorkspaceBackup(value);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('BACKUP_CENTER_GROUP_MEMBERSHIP_DAY_UNASSIGNED');
  });
});

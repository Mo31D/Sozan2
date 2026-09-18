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

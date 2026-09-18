import { describe, expect, it } from 'vitest';
import type { SimpleWorkspaceData } from '../src/client/simple/data';
import { buildWorkspaceReportForRange, currentDuePence } from '../src/modules/reports/insights';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';

function archivedHistoryData(): SimpleWorkspaceData {
  return {
    students: [],
    archivedStudents: [{
      id: studentId,
      workspaceId,
      name: 'طالب متوقف',
      age: null,
      guardianName: null,
      guardianPhone: null,
      level: null,
      notes: null,
      active: false,
    }],
    studentBaselines: [],
    sessions: [],
    archivedSessions: [{
      id: sessionId,
      workspaceId,
      title: 'حصة قديمة',
      sessionType: 'online',
      scheduleStatus: 'confirmed',
      weekday: 1,
      startTime: '18:00',
      durationMinutes: 60,
      travelMinutes: 15,
      location: null,
      priceBasis: 'total_session',
      defaultPricePence: 5000,
      expectedStudentCount: 1,
      centerCutBps: 0,
      active: false,
      studentIds: [studentId],
      payerStudentId: studentId,
    }],
    occurrences: [{
      id: '44444444-4444-4444-8444-444444444444',
      workspaceId,
      recurringSessionId: sessionId,
      sessionDate: '2026-09-10',
      scheduledStart: '18:00',
      rescheduledToDate: null,
      rescheduledToStart: null,
      status: 'completed',
      grossPence: 5000,
      centerCutPence: 0,
      earnedPence: 5000,
      completedAt: '2026-09-10T18:00:00Z',
      note: null,
      studentIds: [studentId],
      durationMinutesSnapshot: 60,
      travelMinutesSnapshot: 15,
      sessionTypeSnapshot: 'online',
      locationSnapshot: null,
      priceBasisSnapshot: 'total_session',
      defaultPricePenceSnapshot: 5000,
      payerStudentIdSnapshot: studentId,
    }],
    billingPlans: [{
      id: studentId,
      workspaceId,
      studentId,
      billingMode: 'per_session',
      packageSize: null,
      packagePricePence: null,
      cycleAnchorDate: null,
      effectiveFrom: '2026-09-01',
    }],
    billingCycles: [],
    receipts: [],
    allocations: [],
    expenses: [],
    otherIncome: [],
    cashChecks: [],
    workspaceSettings: [],
    openingBalancePence: 0,
  };
}

describe('archived student historical projections', () => {
  it('keeps archived lesson time and earnings in historical reports', () => {
    const data = archivedHistoryData();
    const report = buildWorkspaceReportForRange(data, {
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    });

    expect(report.completedLessons).toBe(1);
    expect(report.teachingMinutes).toBe(60);
    expect(report.travelMinutes).toBe(15);
    expect(report.earnedPence).toBe(5000);
  });

  it('keeps unpaid completed work due after the student is archived', () => {
    expect(currentDuePence(archivedHistoryData())).toBe(5000);
  });
});

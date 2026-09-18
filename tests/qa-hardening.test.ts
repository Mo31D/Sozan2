import { describe, expect, it } from 'vitest';
import type { ControlCenterData } from '../src/client/control/data';
import { expectedBalance } from '../src/client/control/data';
import { todayIso as controlTodayIso } from '../src/client/control/presentation';
import type { SimpleWorkspaceData } from '../src/client/simple/data';
import { dueTotal, scheduleEntriesForDate } from '../src/client/simple/v2/utils';
import type { RecurringSession } from '../src/modules/tutoring/domain/session';

const workspaceId = '10000000-0000-4000-8000-000000000001';
const studentId = '10000000-0000-4000-8000-000000000002';
const sessionId = '10000000-0000-4000-8000-000000000003';

const session: RecurringSession = {
  id: sessionId,
  workspaceId,
  title: 'فريدة',
  sessionType: 'private_student_home',
  scheduleStatus: 'confirmed',
  weekday: 4,
  startTime: '16:00',
  durationMinutes: 60,
  travelMinutes: 0,
  location: null,
  priceBasis: 'total_session',
  defaultPricePence: 2500,
  expectedStudentCount: 1,
  centerCutBps: 0,
  active: true,
  studentIds: [studentId],
  payerStudentId: studentId,
};

function emptyData(): SimpleWorkspaceData {
  return {
    students: [],
    studentBaselines: [],
    sessions: [],
    occurrences: [],
    billingPlans: [],
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

describe('QA hardening regressions', () => {
  it('keeps both the normal recurring lesson and an older lesson rescheduled onto the same day', () => {
    const data = emptyData();
    data.sessions = [session];
    data.occurrences = [{
      id: '10000000-0000-4000-8000-000000000010',
      workspaceId,
      recurringSessionId: sessionId,
      sessionDate: '2026-09-10',
      scheduledStart: '16:00',
      rescheduledToDate: '2026-09-17',
      rescheduledToStart: '18:00',
      status: 'scheduled',
      grossPence: 0,
      centerCutPence: 0,
      earnedPence: 0,
      completedAt: null,
      note: null,
      studentIds: [],
      durationMinutesSnapshot: null,
      travelMinutesSnapshot: null,
      sessionTypeSnapshot: null,
      locationSnapshot: null,
      priceBasisSnapshot: null,
      defaultPricePenceSnapshot: null,
      payerStudentIdSnapshot: null,
    }];

    const entries = scheduleEntriesForDate(data, '2026-09-17');

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.startTime)).toEqual(['16:00', '18:00']);
    expect(entries.filter((entry) => entry.occurrence)).toHaveLength(1);
  });

  it('includes outstanding per-session work in the same due-now projection used by the main UI', () => {
    const data = emptyData();
    data.sessions = [session];
    data.billingPlans = [{
      workspaceId,
      studentId,
      billingMode: 'per_session',
      packageSize: null,
      packagePricePence: null,
      cycleAnchorDate: null,
      effectiveFrom: '2026-09-01',
    }];
    data.occurrences = [{
      id: '10000000-0000-4000-8000-000000000011',
      workspaceId,
      recurringSessionId: sessionId,
      sessionDate: '2026-09-17',
      scheduledStart: '16:00',
      rescheduledToDate: null,
      rescheduledToStart: null,
      status: 'completed',
      grossPence: 2500,
      centerCutPence: 0,
      earnedPence: 2500,
      completedAt: '2026-09-17T16:00:00.000Z',
      note: null,
      studentIds: [studentId],
      durationMinutesSnapshot: 60,
      travelMinutesSnapshot: 0,
      sessionTypeSnapshot: 'private_student_home',
      locationSnapshot: null,
      priceBasisSnapshot: 'total_session',
      defaultPricePenceSnapshot: 2500,
      payerStudentIdSnapshot: studentId,
    }];
    data.allocations = [{
      id: 'allocation-1',
      workspaceId,
      receiptId: 'receipt-1',
      targetModule: 'tutoring',
      targetType: 'student_occurrence',
      targetId: '10000000-0000-4000-8000-000000000011:10000000-0000-4000-8000-000000000002',
      amountPence: 1000,
    }];

    expect(dueTotal(data)).toBe(1500);
  });

  it('includes the migrated opening balance in cash reconciliation', () => {
    const simple = emptyData();
    simple.openingBalancePence = 5000;
    const data = {
      simple,
      receipts: [{ amountPence: 2000, deletedAt: null }],
      expenses: [{ amountPence: 500, deletedAt: null }],
      income: [{ amountPence: 1000, deletedAt: null }],
      cashChecks: [],
      sessions: [],
      activity: [],
    } as unknown as ControlCenterData;

    expect(expectedBalance(data)).toBe(7500);
  });

  it('builds control-center today from the local calendar date rather than UTC slicing', () => {
    const local = new Date(2026, 8, 17, 0, 15, 0);
    expect(controlTodayIso(local)).toBe('2026-09-17');
  });
});

import { describe, expect, it } from 'vitest';
import { completedLessonCountForStudent, type SimpleWorkspaceData } from '../src/client/simple/data';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';

function data(): SimpleWorkspaceData {
  return {
    students: [],
    studentBaselines: [{
      id: studentId,
      workspaceId,
      studentId,
      completedLessonsBeforeTracking: 7,
      sourceNote: null,
      observedAt: '2026-09-17',
    }],
    sessions: [{
      id: sessionId,
      workspaceId,
      title: 'يحيى',
      sessionType: 'private_student_home',
      scheduleStatus: 'confirmed',
      weekday: 1,
      startTime: '18:00',
      durationMinutes: 90,
      travelMinutes: 30,
      location: null,
      priceBasis: 'total_session',
      defaultPricePence: 0,
      expectedStudentCount: 1,
      centerCutBps: 0,
      active: true,
      payerStudentId: studentId,
      studentIds: [studentId],
    }],
    occurrences: [{
      id: '44444444-4444-4444-8444-444444444444',
      workspaceId,
      recurringSessionId: sessionId,
      sessionDate: '2026-09-18',
      scheduledStart: '18:00',
      rescheduledToDate: null,
      rescheduledToStart: null,
      status: 'completed',
      grossPence: 0,
      centerCutPence: 0,
      earnedPence: 0,
      completedAt: '2026-09-18T18:00:00Z',
      note: null,
      studentIds: [studentId],
      durationMinutesSnapshot: 90,
      travelMinutesSnapshot: 30,
      sessionTypeSnapshot: 'private_student_home',
      locationSnapshot: null,
      priceBasisSnapshot: 'total_session',
      defaultPricePenceSnapshot: 0,
      payerStudentIdSnapshot: studentId,
    }],
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

describe('completedLessonCountForStudent', () => {
  it('adds imported historical baseline to attended completed lessons', () => {
    expect(completedLessonCountForStudent(data(), studentId)).toEqual({
      beforeTracking: 7,
      tracked: 1,
      total: 8,
    });
  });

  it('does not invent attendance when the student is not in the occurrence attendance list', () => {
    const value = data();
    value.occurrences[0].studentIds = [];
    expect(completedLessonCountForStudent(value, studentId)).toEqual({
      beforeTracking: 7,
      tracked: 0,
      total: 7,
    });
  });
});

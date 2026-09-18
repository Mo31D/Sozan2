import { describe, expect, it } from 'vitest';
import type { SimpleWorkspaceData } from '../src/client/simple/data';
import type { ScheduledEntry } from '../src/client/simple/v2/types';
import {
  addDays,
  packageLessonLabelForEntry,
  packageLessonNumberForEntry,
  todayIso,
  weekdayForIso,
} from '../src/client/simple/v2/utils';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';

function data(): SimpleWorkspaceData {
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  return {
    students: [{
      id: studentId,
      workspaceId,
      name: 'جودي',
      age: null,
      guardianName: null,
      guardianPhone: null,
      level: null,
      notes: null,
      active: true,
      deletedAt: null,
    }],
    studentBaselines: [],
    sessions: [
      {
        id: '33333333-3333-4333-8333-333333333331',
        workspaceId,
        title: 'جودي',
        sessionType: 'online',
        scheduleStatus: 'confirmed',
        weekday: weekdayForIso(today),
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
      },
      {
        id: '33333333-3333-4333-8333-333333333332',
        workspaceId,
        title: 'جودي',
        sessionType: 'online',
        scheduleStatus: 'confirmed',
        weekday: weekdayForIso(tomorrow),
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
      },
    ],
    occurrences: [],
    billingPlans: [{
      id: studentId,
      workspaceId,
      studentId,
      billingMode: 'package',
      packageSize: 8,
      packagePricePence: 0,
      cycleAnchorDate: today,
      effectiveFrom: today,
    }],
    billingCycles: [{
      id: '44444444-4444-4444-8444-444444444444',
      workspaceId,
      studentId,
      sequenceNo: 1,
      sessionLimit: 8,
      pricePence: 0,
      openingCompletedCount: 2,
      openingProgressLockedAt: null,
      realCompletedCount: 0,
      status: 'open',
      startedOn: today,
      completedOn: null,
      paidOn: null,
    }],
    receipts: [],
    allocations: [],
    expenses: [],
    otherIncome: [],
    cashChecks: [],
    workspaceSettings: [],
    openingBalancePence: 0,
  };
}

function entry(value: SimpleWorkspaceData, index: number, date: string): ScheduledEntry {
  return {
    session: value.sessions[index],
    occurrence: null,
    date,
    startTime: value.sessions[index].startTime,
    status: 'scheduled',
  };
}

describe('package lesson number display', () => {
  it('projects successive lesson numbers across upcoming weekly sessions', () => {
    const value = data();
    const today = todayIso();
    const tomorrow = addDays(today, 1);

    expect(packageLessonNumberForEntry(value, entry(value, 0, today), studentId)).toBe('3/8');
    expect(packageLessonNumberForEntry(value, entry(value, 1, tomorrow), studentId)).toBe('4/8');
    expect(packageLessonLabelForEntry(value, entry(value, 0, today))).toBe('الحصة 3/8');
  });

  it('wraps the next scheduled lesson into the next package after 8/8', () => {
    const value = data();
    value.billingCycles[0].openingCompletedCount = 7;
    const today = todayIso();
    const tomorrow = addDays(today, 1);

    expect(packageLessonNumberForEntry(value, entry(value, 0, today), studentId)).toBe('8/8');
    expect(packageLessonNumberForEntry(value, entry(value, 1, tomorrow), studentId)).toBe('1/8');
  });

  it('shows unknown lesson number when package starting progress is unknown', () => {
    const value = data();
    value.billingCycles = [];
    const today = todayIso();
    expect(packageLessonNumberForEntry(value, entry(value, 0, today), studentId)).toBe('؟/8');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildMonthlyForecast,
  type MonthlyForecastInput,
} from '../src/modules/reports/monthly-forecast';

function baseData(): MonthlyForecastInput {
  return {
    sessions: [],
    occurrences: [],
    receipts: [],
    expenses: [],
    otherIncome: [],
    billingPlans: [],
    billingCycles: [],
    allocations: [],
  };
}

describe('monthly forecast', () => {
  it('projects confirmed recurring work and future package/per-session dues without treating them as cash', () => {
    const data = baseData();
    data.sessions = [
      {
        id: 'package-session',
        scheduleStatus: 'confirmed',
        weekday: 0,
        startTime: '10:00',
        durationMinutes: 60,
        travelMinutes: 15,
        studentIds: ['package-student'],
        priceBasis: 'total_session',
        defaultPricePence: 10000,
        expectedStudentCount: 1,
        centerCutBps: 0,
        payerStudentId: 'package-student',
      },
      {
        id: 'single-session',
        scheduleStatus: 'confirmed',
        weekday: 1,
        startTime: '12:00',
        durationMinutes: 60,
        travelMinutes: 0,
        studentIds: ['single-student'],
        priceBasis: 'total_session',
        defaultPricePence: 30000,
        expectedStudentCount: 1,
        centerCutBps: 0,
        payerStudentId: 'single-student',
      },
    ];
    data.occurrences = [
      {
        id: 'past',
        recurringSessionId: 'single-session',
        sessionDate: '2026-09-14',
        rescheduledToDate: null,
        status: 'completed',
        earnedPence: 30000,
        studentIds: ['single-student'],
      },
    ];
    data.billingPlans = [
      {
        studentId: 'package-student',
        billingMode: 'package',
        packageSize: 8,
        packagePricePence: 80000,
        effectiveFrom: '2026-09-01',
      },
      {
        studentId: 'single-student',
        billingMode: 'per_session',
        packageSize: null,
        packagePricePence: null,
        effectiveFrom: '2026-09-01',
      },
    ];
    data.billingCycles = [{
      id: 'cycle-1',
      studentId: 'package-student',
      sequenceNo: 1,
      sessionLimit: 8,
      openingCompletedCount: 6,
      realCompletedCount: 0,
      status: 'open',
      pricePence: 80000,
    }];

    const forecast = buildMonthlyForecast(data, '2026-09-18');

    expect(forecast.futureConfirmedLessons).toBe(4);
    expect(forecast.actualEarnedPence).toBe(30000);
    expect(forecast.projectedRemainingEarnedPence).toBe(80000);
    expect(forecast.projectedMonthEarnedPence).toBe(110000);
    expect(forecast.projectedPackageCompletions).toBe(1);
    expect(forecast.projectedNewDuePence).toBe(140000);
    expect(forecast.currentDuePence).toBe(30000);
  });

  it('honours cancellations and reschedules and excludes pending schedules from the projection', () => {
    const data = baseData();
    data.sessions = [
      {
        id: 'weekly',
        scheduleStatus: 'confirmed',
        weekday: 0,
        startTime: '10:00',
        durationMinutes: 60,
        travelMinutes: 0,
        studentIds: ['s1'],
        priceBasis: 'total_session',
        defaultPricePence: 10000,
        expectedStudentCount: 1,
        centerCutBps: 0,
        payerStudentId: 's1',
      },
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `pending-${index}`,
        scheduleStatus: 'pending' as const,
        weekday: null,
        startTime: null,
        durationMinutes: 60,
        travelMinutes: 0,
        studentIds: ['s1'],
        priceBasis: 'total_session' as const,
        defaultPricePence: 10000,
        expectedStudentCount: 1,
        centerCutBps: 0,
        payerStudentId: 's1',
      })),
    ];
    data.occurrences = [
      {
        id: 'cancelled-20',
        recurringSessionId: 'weekly',
        sessionDate: '2026-09-20',
        rescheduledToDate: null,
        status: 'cancelled',
        earnedPence: 0,
      },
      {
        id: 'moved-from-13',
        recurringSessionId: 'weekly',
        sessionDate: '2026-09-13',
        rescheduledToDate: '2026-09-22',
        rescheduledToStart: '11:00',
        status: 'scheduled',
        earnedPence: 0,
      },
    ];
    data.billingPlans = [{
      studentId: 's1',
      billingMode: 'per_session',
      packageSize: null,
      packagePricePence: null,
      effectiveFrom: '2026-09-01',
    }];

    const forecast = buildMonthlyForecast(data, '2026-09-18');

    expect(forecast.futureConfirmedLessons).toBe(2);
    expect(forecast.projectedRemainingEarnedPence).toBe(20000);
    expect(forecast.projectedNewDuePence).toBe(20000);
    expect(forecast.pendingScheduleCount).toBe(24);
    expect(forecast.confidence).toBe('limited');
    expect(forecast.insights.some((item) => item.key === 'pending-excluded')).toBe(true);
  });

  it('projects business expenses from current actuals plus the historical remaining-month baseline and ignores personal spend', () => {
    const data = baseData();
    data.expenses = [
      { expenseDate: '2026-06-10', scope: 'business', category: 'مواصلات', amountPence: 10000 },
      { expenseDate: '2026-07-10', scope: 'business', category: 'مواصلات', amountPence: 20000 },
      { expenseDate: '2026-08-10', scope: 'business', category: 'مواصلات', amountPence: 30000 },
      { expenseDate: '2026-09-05', scope: 'business', category: 'مواصلات', amountPence: 24000 },
      { expenseDate: '2026-09-06', scope: 'personal', category: 'بيت', amountPence: 999999 },
    ];

    const forecast = buildMonthlyForecast(data, '2026-09-18');

    expect(forecast.expenseHistoryMonths).toBe(3);
    expect(forecast.historicalAverageBusinessExpensesPence).toBe(20000);
    expect(forecast.businessExpensesToDatePence).toBe(24000);
    expect(forecast.projectedBusinessExpensesPence).toBe(32000);
    expect(forecast.expenseVarianceToDatePct).toBe(100);
    expect(forecast.insights.some((item) => item.key === 'expense-variance')).toBe(true);
  });

  it('projects one shared package charge for two siblings in one lesson', () => {
    const data = baseData();
    data.sessions = [{
      id: 'siblings',
      scheduleStatus: 'confirmed',
      weekday: 0,
      startTime: '14:00',
      durationMinutes: 90,
      travelMinutes: 30,
      studentIds: ['arwa', 'sofyan'],
      priceBasis: 'total_session',
      defaultPricePence: 0,
      expectedStudentCount: 2,
      centerCutBps: 0,
      payerStudentId: 'arwa',
    }];
    data.billingPlans = [
      {
        studentId: 'arwa',
        billingMode: 'package',
        packageSize: 8,
        packagePricePence: 50000,
        effectiveFrom: '2026-09-01',
      },
      {
        studentId: 'sofyan',
        billingMode: 'package',
        packageSize: 8,
        packagePricePence: 50000,
        effectiveFrom: '2026-09-01',
      },
    ];
    data.billingCycles = [
      {
        id: 'arwa-cycle',
        studentId: 'arwa',
        sequenceNo: 1,
        sessionLimit: 8,
        openingCompletedCount: 7,
        realCompletedCount: 0,
        status: 'open',
        pricePence: 50000,
      },
      {
        id: 'sofyan-cycle',
        studentId: 'sofyan',
        sequenceNo: 1,
        sessionLimit: 8,
        openingCompletedCount: 7,
        realCompletedCount: 0,
        status: 'open',
        pricePence: 50000,
      },
    ];

    const forecast = buildMonthlyForecast(data, '2026-09-19');

    expect(forecast.futureConfirmedLessons).toBe(2);
    expect(forecast.projectedPackageCompletions).toBe(1);
    expect(forecast.projectedNewDuePence).toBe(50000);
  });

  it('does not invent a historical expense baseline when there is no prior activity', () => {
    const data = baseData();
    data.expenses = [
      { expenseDate: '2026-09-03', scope: 'business', category: 'أدوات', amountPence: 12000 },
    ];

    const forecast = buildMonthlyForecast(data, '2026-09-18');

    expect(forecast.historicalAverageBusinessExpensesPence).toBeNull();
    expect(forecast.projectedBusinessExpensesPence).toBe(12000);
    expect(forecast.confidenceReasons.some((reason) => reason.includes('لا يوجد تاريخ شهري'))).toBe(true);
  });
});

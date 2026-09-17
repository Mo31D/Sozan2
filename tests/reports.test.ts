import { describe, expect, it } from 'vitest';
import { buildWorkspaceReport } from '../src/modules/reports/insights';

describe('workspace reports', () => {
  it('combines lessons, money, travel and current dues deterministically', () => {
    const report = buildWorkspaceReport({
      sessions: [
        { id: 's1', scheduleStatus: 'confirmed', durationMinutes: 60, travelMinutes: 30 },
        { id: 's2', scheduleStatus: 'pending', durationMinutes: 45, travelMinutes: 0 },
      ],
      occurrences: [
        { recurringSessionId: 's1', sessionDate: '2026-09-15', rescheduledToDate: null, status: 'completed', earnedPence: 45000 },
        { recurringSessionId: 's1', sessionDate: '2026-09-14', rescheduledToDate: null, status: 'cancelled', earnedPence: 0 },
      ],
      receipts: [{ receivedAt: '2026-09-15', amountPence: 45000 }],
      expenses: [{ expenseDate: '2026-09-15', amountPence: 10000 }],
      otherIncome: [{ incomeDate: '2026-09-12', amountPence: 5000 }],
      billingCycles: [{ id: 'c1', status: 'due', pricePence: 80000 }],
      allocations: [{ targetId: 'c1', amountPence: 30000 }],
    }, '2026-09-16');

    expect(report.completedLessons).toBe(1);
    expect(report.cancelledLessons).toBe(1);
    expect(report.receivedPence).toBe(45000);
    expect(report.otherIncomePence).toBe(5000);
    expect(report.expensesPence).toBe(10000);
    expect(report.netCashPence).toBe(40000);
    expect(report.duePence).toBe(50000);
    expect(report.teachingMinutes).toBe(60);
    expect(report.travelMinutes).toBe(30);
    expect(report.effectiveHourlyPence).toBe(30000);
    expect(report.insights.some((item) => item.key === 'due')).toBe(true);
    expect(report.insights.some((item) => item.key === 'pending')).toBe(true);
  });

  it('surfaces probable duplicate expenses as an attention insight', () => {
    const report = buildWorkspaceReport({
      sessions: [],
      occurrences: [],
      receipts: [],
      expenses: [
        { id: 'e1', expenseDate: '2026-09-15', scope: 'business', category: 'مواصلات', amountPence: 1250 },
        { id: 'e2', expenseDate: '2026-09-15', scope: 'business', category: ' مواصلات ', amountPence: 1250 },
        { id: 'e3', expenseDate: '2026-09-15', scope: 'business', category: 'مواصلات', amountPence: 1400 },
      ],
      otherIncome: [],
      billingCycles: [],
      allocations: [],
    }, '2026-09-16');

    const insight = report.insights.find((item) => item.key === 'duplicate-expenses');
    expect(insight).toMatchObject({
      level: 'attention',
      title: 'راجعي المصروفات المتشابهة',
    });
    expect(insight?.detail).toContain('2 تسجيلات');
  });
});

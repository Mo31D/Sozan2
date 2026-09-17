import { describe, expect, it } from 'vitest';
import { currentDuePence } from '../src/modules/reports/insights';
import { buildStudentFinancialSummary } from '../src/modules/reports/student-finance';

describe('unconfigured tutoring billing', () => {
  const session = {
    id: 'session-1',
    scheduleStatus: 'confirmed' as const,
    durationMinutes: 60,
    travelMinutes: 0,
    studentIds: ['student-1'],
    priceBasis: 'per_student' as const,
    defaultPricePence: 2500,
    expectedStudentCount: 1,
  };
  const occurrence = {
    id: 'occurrence-1',
    recurringSessionId: 'session-1',
    sessionDate: '2026-09-17',
    rescheduledToDate: null,
    status: 'completed' as const,
    grossPence: 2500,
    earnedPence: 2500,
  };

  it('does not invent a per-session debt when no billing plan exists', () => {
    expect(currentDuePence({
      sessions: [session],
      occurrences: [occurrence],
      receipts: [],
      expenses: [],
      otherIncome: [],
      billingPlans: [],
      billingCycles: [],
      allocations: [],
    })).toBe(0);
  });

  it('keeps historical receipts as credit rather than allocating them to an invented debt', () => {
    const summary = buildStudentFinancialSummary({
      sessions: [session],
      occurrences: [occurrence],
      billingPlans: [],
      billingCycles: [],
      receipts: [{
        id: 'receipt-1',
        payerRefId: 'student-1',
        amountPence: 2000,
        receivedAt: '2026-09-17',
      }],
      allocations: [],
    }, 'student-1');

    expect(summary).toMatchObject({
      receivedPence: 2000,
      allocatedPence: 0,
      creditPence: 2000,
      duePence: 0,
    });
  });

  it('creates per-session debt only after that billing mode is explicitly configured', () => {
    expect(currentDuePence({
      sessions: [session],
      occurrences: [occurrence],
      receipts: [],
      expenses: [],
      otherIncome: [],
      billingPlans: [{ studentId: 'student-1', billingMode: 'per_session' }],
      billingCycles: [],
      allocations: [],
    })).toBe(2500);
  });
});

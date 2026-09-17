import { describe, expect, it } from 'vitest';
import { buildStudentFinancialSummary } from '../src/modules/reports/student-finance';

describe('student financial summary', () => {
  it('keeps advance package payment as credit before the package is due', () => {
    const summary = buildStudentFinancialSummary({
      sessions: [],
      occurrences: [],
      billingPlans: [{ studentId: 'student-1', billingMode: 'package' }],
      billingCycles: [{
        id: 'cycle-1',
        studentId: 'student-1',
        status: 'open',
        pricePence: 8000,
      }],
      receipts: [{
        id: 'receipt-1',
        payerRefId: 'student-1',
        amountPence: 8000,
        receivedAt: '2026-09-17',
      }],
      allocations: [],
    }, 'student-1');

    expect(summary).toEqual({
      receivedPence: 8000,
      allocatedPence: 0,
      creditPence: 8000,
      duePence: 0,
      lastPayment: {
        id: 'receipt-1',
        amountPence: 8000,
        receivedAt: '2026-09-17',
      },
    });
  });

  it('shows the unpaid remainder of a due package', () => {
    const summary = buildStudentFinancialSummary({
      sessions: [],
      occurrences: [],
      billingPlans: [{ studentId: 'student-1', billingMode: 'package' }],
      billingCycles: [{
        id: 'cycle-1',
        studentId: 'student-1',
        status: 'due',
        pricePence: 8000,
      }],
      receipts: [{
        id: 'receipt-1',
        payerRefId: 'student-1',
        amountPence: 3000,
        receivedAt: '2026-09-18',
      }],
      allocations: [{
        receiptId: 'receipt-1',
        targetModule: 'tutoring',
        targetType: 'package_cycle',
        targetId: 'cycle-1',
        amountPence: 3000,
      }],
    }, 'student-1');

    expect(summary.receivedPence).toBe(3000);
    expect(summary.allocatedPence).toBe(3000);
    expect(summary.creditPence).toBe(0);
    expect(summary.duePence).toBe(5000);
    expect(summary.lastPayment?.receivedAt).toBe('2026-09-18');
  });

  it('derives per-session due after partial collection', () => {
    const summary = buildStudentFinancialSummary({
      sessions: [{
        id: 'session-1',
        studentIds: ['student-1'],
        priceBasis: 'per_student',
        defaultPricePence: 2500,
        expectedStudentCount: 1,
      }],
      occurrences: [{
        id: 'occurrence-1',
        recurringSessionId: 'session-1',
        status: 'completed',
        grossPence: 2500,
      }],
      billingPlans: [{ studentId: 'student-1', billingMode: 'per_session' }],
      billingCycles: [],
      receipts: [{
        id: 'receipt-1',
        payerRefId: 'student-1',
        amountPence: 1000,
        receivedAt: '2026-09-19',
      }],
      allocations: [{
        receiptId: 'receipt-1',
        targetModule: 'tutoring',
        targetType: 'occurrence',
        targetId: 'occurrence-1',
        amountPence: 1000,
      }],
    }, 'student-1');

    expect(summary.receivedPence).toBe(1000);
    expect(summary.allocatedPence).toBe(1000);
    expect(summary.creditPence).toBe(0);
    expect(summary.duePence).toBe(1500);
  });

  it('uses the newest receipt as the last payment', () => {
    const summary = buildStudentFinancialSummary({
      sessions: [],
      occurrences: [],
      billingPlans: [{ studentId: 'student-1', billingMode: 'package' }],
      billingCycles: [],
      receipts: [
        { id: 'receipt-old', payerRefId: 'student-1', amountPence: 1000, receivedAt: '2026-09-10' },
        { id: 'receipt-new-b', payerRefId: 'student-1', amountPence: 2000, receivedAt: '2026-09-20' },
        { id: 'receipt-new-a', payerRefId: 'student-1', amountPence: 3000, receivedAt: '2026-09-20' },
      ],
      allocations: [],
    }, 'student-1');

    expect(summary.lastPayment).toEqual({
      id: 'receipt-new-b',
      amountPence: 2000,
      receivedAt: '2026-09-20',
    });
  });
});

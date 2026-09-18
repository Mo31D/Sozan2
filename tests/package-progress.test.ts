import { describe, expect, it } from 'vitest';
import type { SimpleWorkspaceData } from '../src/client/simple/data';
import { packageProgress } from '../src/client/simple/v2/utils';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';

function baseData(): SimpleWorkspaceData {
  return {
    students: [],
    studentBaselines: [],
    sessions: [],
    occurrences: [],
    billingPlans: [{
      id: studentId,
      workspaceId,
      studentId,
      billingMode: 'package',
      packageSize: 8,
      packagePricePence: 0,
      cycleAnchorDate: '2026-09-15',
      effectiveFrom: '2026-09-15',
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

describe('packageProgress', () => {
  it('shows unknown progress instead of inventing zero when no cycle count exists', () => {
    expect(packageProgress(baseData(), studentId)).toBe('؟/8');
  });

  it('shows imported opening progress from the current package cycle', () => {
    const value = baseData();
    value.billingCycles.push({
      id: '33333333-3333-4333-8333-333333333333',
      workspaceId,
      studentId,
      sequenceNo: 1,
      sessionLimit: 8,
      pricePence: 0,
      openingCompletedCount: 2,
      openingProgressLockedAt: null,
      realCompletedCount: 0,
      status: 'open',
      startedOn: '2026-09-15',
      completedOn: null,
      paidOn: null,
    });
    expect(packageProgress(value, studentId)).toBe('2/8');
  });
});

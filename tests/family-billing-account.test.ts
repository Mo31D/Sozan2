import { describe, expect, it } from 'vitest';
import {
  familySequenceComplete,
  familySequenceCompletedOn,
  type BillingAccount,
  type BillingAccountMember,
  type StudentProgressCycle,
} from '../src/modules/tutoring/domain/billing-account';

const account: BillingAccount = {
  id: 'family-1',
  workspaceId: 'ws',
  displayName: 'ملك + جودي',
  accountType: 'family',
  countingMode: 'per_member_quota',
  primaryStudentId: 'malak',
  packageSize: 8,
  packagePricePence: 70000,
  effectiveFrom: '2026-09-19',
  active: true,
};

const members: BillingAccountMember[] = [
  { id: 'm1', workspaceId: 'ws', billingAccountId: 'family-1', studentId: 'malak', position: 0, active: true },
  { id: 'm2', workspaceId: 'ws', billingAccountId: 'family-1', studentId: 'judy', position: 1, active: true },
];

function cycle(studentId: string, completed: number, completedOn: string | null): StudentProgressCycle {
  return {
    id: `cycle-${studentId}`,
    studentId,
    sequenceNo: 1,
    sessionLimit: 8,
    openingCompletedCount: completed,
    realCompletedCount: 0,
    status: completed >= 8 ? 'due' : 'open',
    startedOn: '2026-09-01',
    completedOn,
  };
}

describe('family billing account domain', () => {
  it('waits for every member quota before one family cycle becomes due', () => {
    expect(familySequenceComplete(account, members, [
      cycle('malak', 8, '2026-09-20'),
      cycle('judy', 7, null),
    ], 1)).toBe(false);

    expect(familySequenceComplete(account, members, [
      cycle('malak', 8, '2026-09-20'),
      cycle('judy', 8, '2026-09-22'),
    ], 1)).toBe(true);

    expect(familySequenceCompletedOn(account, members, [
      cycle('malak', 8, '2026-09-20'),
      cycle('judy', 8, '2026-09-22'),
    ], 1)).toBe('2026-09-22');
  });

  it('uses one primary progress ledger for a shared-occurrence household', () => {
    const shared = { ...account, countingMode: 'shared_occurrence' as const, primaryStudentId: 'malak' };
    expect(familySequenceComplete(shared, members, [
      cycle('malak', 8, '2026-09-20'),
      cycle('judy', 1, null),
    ], 1)).toBe(true);
  });
});

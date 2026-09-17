import { describe, expect, it } from 'vitest';
import { duplicateExpenseIds, duplicateReceiptIds } from '../src/client/control/correction-model';
import type { LocalExpense } from '../src/client/simple/data';
import type { LocalReceipt } from '../src/client/tutoring/local-commands';

function receipt(id: string, studentId: string, amountPence: number, receivedAt: string, deletedAt: string | null = null): LocalReceipt {
  return {
    id,
    workspaceId: '11111111-1111-4111-8111-111111111111',
    payerRefType: 'tutoring.student',
    payerRefId: studentId,
    amountPence,
    receivedAt,
    paymentMethod: 'cash',
    sourceKind: 'manual',
    sourceModule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    note: null,
    deletedAt,
    pendingSync: false,
  };
}

function expense(
  id: string,
  amountPence: number,
  expenseDate: string,
  category = 'مواصلات',
  scope: LocalExpense['scope'] = 'business',
  deletedAt: string | null = null,
): LocalExpense {
  return {
    id,
    workspaceId: '11111111-1111-4111-8111-111111111111',
    expenseDate,
    scope,
    category,
    amountPence,
    note: null,
    deletedAt,
  };
}

describe('financial correction model', () => {
  it('flags same student, amount and date as a probable duplicate', () => {
    const rows = [
      receipt('r1', 'student-a', 45000, '2026-09-15'),
      receipt('r2', 'student-a', 45000, '2026-09-15'),
      receipt('r3', 'student-a', 20000, '2026-09-15'),
      receipt('r4', 'student-b', 45000, '2026-09-15'),
    ];
    expect([...duplicateReceiptIds(rows)].sort()).toEqual(['r1', 'r2']);
  });

  it('ignores soft-deleted receipts when detecting duplicates', () => {
    const rows = [
      receipt('r1', 'student-a', 45000, '2026-09-15'),
      receipt('r2', 'student-a', 45000, '2026-09-15', '2026-09-16T10:00:00Z'),
    ];
    expect([...duplicateReceiptIds(rows)]).toEqual([]);
  });

  it('flags same expense date, scope, normalized category and amount as a probable duplicate', () => {
    const rows = [
      expense('e1', 1250, '2026-09-17', ' مواصلات '),
      expense('e2', 1250, '2026-09-17', 'مواصلات'),
      expense('e3', 1400, '2026-09-17', 'مواصلات'),
      expense('e4', 1250, '2026-09-17', 'مواصلات', 'personal'),
      expense('e5', 1250, '2026-09-18', 'مواصلات'),
    ];

    expect([...duplicateExpenseIds(rows)].sort()).toEqual(['e1', 'e2']);
  });

  it('ignores soft-deleted expenses when detecting duplicates', () => {
    const rows = [
      expense('e1', 1250, '2026-09-17'),
      expense('e2', 1250, '2026-09-17', 'مواصلات', 'business', '2026-09-17T12:00:00Z'),
    ];

    expect([...duplicateExpenseIds(rows)]).toEqual([]);
  });
});

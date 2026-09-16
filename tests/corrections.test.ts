import { describe, expect, it } from 'vitest';
import { duplicateReceiptIds } from '../src/client/control/correction-model';
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

  it('ignores soft-deleted rows when detecting duplicates', () => {
    const rows = [
      receipt('r1', 'student-a', 45000, '2026-09-15'),
      receipt('r2', 'student-a', 45000, '2026-09-15', '2026-09-16T10:00:00Z'),
    ];
    expect([...duplicateReceiptIds(rows)]).toEqual([]);
  });
});

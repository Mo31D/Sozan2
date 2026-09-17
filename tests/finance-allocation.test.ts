import { describe, expect, it } from 'vitest';
import { FinanceCollectionService } from '../src/modules/finance/allocation.service';
import type {
  AllocateReceiptCommand,
  ExternalReference,
  FinanceGateway,
  RecordReceiptCommand,
} from '../src/modules/finance/contracts';

class MemoryFinanceGateway implements FinanceGateway {
  receipts: RecordReceiptCommand[] = [];
  allocations: AllocateReceiptCommand[] = [];

  async recordReceipt(command: RecordReceiptCommand): Promise<void> {
    const existing = this.receipts.find((item) => item.id === command.id);
    if (!existing) this.receipts.push(command);
  }

  async allocateReceipt(command: AllocateReceiptCommand): Promise<void> {
    const existing = this.allocations.find((item) =>
      item.receiptId === command.receiptId
      && item.target.module === command.target.module
      && item.target.type === command.target.type
      && item.target.id === command.target.id,
    );
    if (!existing) this.allocations.push(command);
  }

  async getAllocatedTotal(_workspaceId: string, target: ExternalReference): Promise<number> {
    return this.allocations
      .filter((item) => item.target.module === target.module && item.target.type === target.type && item.target.id === target.id)
      .reduce((sum, item) => sum + item.amountPence, 0);
  }

  async getReceiptAllocatedTotal(_workspaceId: string, receiptId: string): Promise<number> {
    return this.allocations
      .filter((item) => item.receiptId === receiptId)
      .reduce((sum, item) => sum + item.amountPence, 0);
  }
}

describe('FinanceCollectionService', () => {
  it('preserves a client-stable receipt id for offline sync and allocates oldest obligations first', async () => {
    const gateway = new MemoryFinanceGateway();
    const service = new FinanceCollectionService(
      gateway,
      [{
        async listOpenObligations() {
          return [
            { target: { module: 'tutoring', type: 'package_cycle', id: 'cycle-1' }, dueAt: '2026-09-01', amountDuePence: 1000 },
            { target: { module: 'tutoring', type: 'package_cycle', id: 'cycle-2' }, dueAt: '2026-09-10', amountDuePence: 800 },
          ];
        },
      }],
      () => `generated-${gateway.allocations.length + 1}`,
    );

    const result = await service.collect({
      receiptId: 'receipt-from-device',
      workspaceId: 'workspace-1',
      payer: { type: 'tutoring.student', id: 'student-1' },
      amountPence: 1500,
      receivedAt: '2026-09-16',
      paymentMethod: 'cash',
      sourceKind: 'manual',
    });

    expect(gateway.receipts[0]?.id).toBe('receipt-from-device');
    expect(gateway.allocations.map((item) => item.amountPence)).toEqual([1000, 500]);
    expect(result).toMatchObject({
      receiptId: 'receipt-from-device',
      allocatedPence: 1500,
      creditPence: 0,
    });
  });

  it('resumes a partially allocated receipt without spending the receipt twice', async () => {
    const gateway = new MemoryFinanceGateway();
    gateway.receipts.push({
      id: 'retry-receipt',
      workspaceId: 'workspace-1',
      payer: { type: 'tutoring.student', id: 'student-1' },
      amountPence: 1500,
      receivedAt: '2026-09-16',
      paymentMethod: 'cash',
      sourceKind: 'manual',
    });
    gateway.allocations.push({
      id: 'first-attempt-allocation',
      workspaceId: 'workspace-1',
      receiptId: 'retry-receipt',
      target: { module: 'tutoring', type: 'package_cycle', id: 'cycle-1' },
      amountPence: 1000,
    });

    const service = new FinanceCollectionService(
      gateway,
      [{
        async listOpenObligations() {
          return [
            { target: { module: 'tutoring', type: 'package_cycle', id: 'cycle-1' }, dueAt: '2026-09-01', amountDuePence: 1000 },
            { target: { module: 'tutoring', type: 'package_cycle', id: 'cycle-2' }, dueAt: '2026-09-10', amountDuePence: 1000 },
          ];
        },
      }],
      () => `retry-${gateway.allocations.length + 1}`,
    );

    const result = await service.collect({
      receiptId: 'retry-receipt',
      workspaceId: 'workspace-1',
      payer: { type: 'tutoring.student', id: 'student-1' },
      amountPence: 1500,
      receivedAt: '2026-09-16',
      paymentMethod: 'cash',
      sourceKind: 'manual',
    });

    expect(gateway.allocations.map((item) => [item.target.id, item.amountPence])).toEqual([
      ['cycle-1', 1000],
      ['cycle-2', 500],
    ]);
    expect(result).toMatchObject({ allocatedPence: 1500, creditPence: 0 });
    expect(await gateway.getReceiptAllocatedTotal('workspace-1', 'retry-receipt')).toBe(1500);
  });

  it('uses a stable target tie-breaker when obligations share a due date', async () => {
    const gateway = new MemoryFinanceGateway();
    const service = new FinanceCollectionService(
      gateway,
      [{
        async listOpenObligations() {
          return [
            { target: { module: 'tutoring', type: 'package_cycle', id: 'cycle-b' }, dueAt: '2026-09-01', amountDuePence: 1000 },
            { target: { module: 'tutoring', type: 'package_cycle', id: 'cycle-a' }, dueAt: '2026-09-01', amountDuePence: 1000 },
          ];
        },
      }],
      () => `generated-${gateway.allocations.length + 1}`,
    );

    await service.collect({
      workspaceId: 'workspace-1',
      payer: { type: 'tutoring.student', id: 'student-1' },
      amountPence: 1200,
      receivedAt: '2026-09-16',
      paymentMethod: 'cash',
      sourceKind: 'manual',
    });

    expect(gateway.allocations.map((item) => [item.target.id, item.amountPence])).toEqual([
      ['cycle-a', 1000],
      ['cycle-b', 200],
    ]);
  });

  it('keeps excess money as credit after all obligations are covered', async () => {
    const gateway = new MemoryFinanceGateway();
    const service = new FinanceCollectionService(
      gateway,
      [{
        async listOpenObligations() {
          return [{
            target: { module: 'tutoring', type: 'occurrence', id: 'lesson-1' },
            dueAt: '2026-09-15',
            amountDuePence: 600,
          }];
        },
      }],
      () => crypto.randomUUID(),
    );

    const result = await service.collect({
      workspaceId: 'workspace-1',
      payer: { type: 'tutoring.student', id: 'student-1' },
      amountPence: 1000,
      receivedAt: '2026-09-16',
      paymentMethod: 'cash',
      sourceKind: 'manual',
    });

    expect(result.allocatedPence).toBe(600);
    expect(result.creditPence).toBe(400);
  });
});

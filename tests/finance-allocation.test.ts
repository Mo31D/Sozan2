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
    this.receipts.push(command);
  }

  async allocateReceipt(command: AllocateReceiptCommand): Promise<void> {
    this.allocations.push(command);
  }

  async getAllocatedTotal(_workspaceId: string, target: ExternalReference): Promise<number> {
    return this.allocations
      .filter((item) => item.target.module === target.module && item.target.type === target.type && item.target.id === target.id)
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

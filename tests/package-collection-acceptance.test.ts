import { describe, expect, it } from 'vitest';
import {
  FinanceCollectionService,
  type FinancialObligation,
  type ObligationProvider,
} from '../src/modules/finance/allocation.service';
import type {
  AllocateReceiptCommand,
  ExternalReference,
  FinanceGateway,
  PayerReference,
  RecordReceiptCommand,
} from '../src/modules/finance/contracts';
import type { BillingCycle, BillingPlan } from '../src/modules/tutoring/domain/billing-plan';
import type { BillingRepository } from '../src/modules/tutoring/ports/billing-repository';
import { BillingService } from '../src/modules/tutoring/services/billing.service';

type LinkedOccurrence = {
  occurrenceId: string;
  position: number;
  earnedPence: number;
};

class AcceptanceBillingRepository implements BillingRepository {
  plan: BillingPlan | null = null;
  cycles: BillingCycle[] = [];
  linkedOccurrences: LinkedOccurrence[] = [];

  async getPlan(workspaceId: string, studentId: string): Promise<BillingPlan | null> {
    return this.plan?.workspaceId === workspaceId && this.plan.studentId === studentId ? this.plan : null;
  }

  async upsertPlan(plan: BillingPlan): Promise<void> {
    this.plan = plan;
  }

  async hasBillingHistory(workspaceId: string, studentId: string): Promise<boolean> {
    return this.cycles.some((cycle) => cycle.workspaceId === workspaceId && cycle.studentId === studentId);
  }

  async getCurrentCycle(workspaceId: string, studentId: string): Promise<BillingCycle | null> {
    return this.cycles
      .filter((cycle) => cycle.workspaceId === workspaceId && cycle.studentId === studentId && cycle.status !== 'cancelled')
      .sort((a, b) => b.sequenceNo - a.sequenceNo)[0] ?? null;
  }

  async getOpenCycle(workspaceId: string, studentId: string): Promise<BillingCycle | null> {
    return this.cycles
      .filter((cycle) => cycle.workspaceId === workspaceId && cycle.studentId === studentId && cycle.status === 'open')
      .sort((a, b) => b.sequenceNo - a.sequenceNo)[0] ?? null;
  }

  async getNextSequenceNo(workspaceId: string, studentId: string): Promise<number> {
    return this.cycles
      .filter((cycle) => cycle.workspaceId === workspaceId && cycle.studentId === studentId)
      .reduce((max, cycle) => Math.max(max, cycle.sequenceNo), 0) + 1;
  }

  async createCycle(input: Omit<BillingCycle, 'realCompletedCount'>): Promise<BillingCycle> {
    const cycle: BillingCycle = { ...input, realCompletedCount: 0 };
    this.cycles.push(cycle);
    return cycle;
  }

  async updateOpeningProgress(input: {
    workspaceId: string;
    cycleId: string;
    openingCompletedCount: number;
    status: 'open' | 'due';
    completedOn: string | null;
  }): Promise<void> {
    const cycle = this.cycles.find((item) => item.workspaceId === input.workspaceId && item.id === input.cycleId);
    if (!cycle) throw new Error('BILLING_CYCLE_NOT_FOUND');
    cycle.openingCompletedCount = input.openingCompletedCount;
    cycle.status = input.status;
    cycle.completedOn = input.completedOn;
    cycle.paidOn = null;
  }

  async addOccurrenceToCycle(input: {
    workspaceId: string;
    cycleId: string;
    occurrenceId: string;
    position: number;
    earnedPence: number;
  }): Promise<void> {
    const cycle = this.cycles.find((item) => item.workspaceId === input.workspaceId && item.id === input.cycleId);
    if (!cycle) throw new Error('BILLING_CYCLE_NOT_FOUND');
    if (this.linkedOccurrences.some((item) => item.occurrenceId === input.occurrenceId)) return;
    this.linkedOccurrences.push({
      occurrenceId: input.occurrenceId,
      position: input.position,
      earnedPence: input.earnedPence,
    });
    cycle.realCompletedCount += 1;
    cycle.openingProgressLockedAt ??= '2026-09-17T00:00:00.000Z';
  }

  async markCycleDue(input: {
    workspaceId: string;
    cycleId: string;
    completedOn: string;
  }): Promise<void> {
    const cycle = this.cycles.find((item) => item.workspaceId === input.workspaceId && item.id === input.cycleId);
    if (!cycle) throw new Error('BILLING_CYCLE_NOT_FOUND');
    cycle.status = 'due';
    cycle.completedOn = input.completedOn;
  }
}

class AcceptanceFinanceGateway implements FinanceGateway {
  receipts = new Map<string, RecordReceiptCommand>();
  allocations: AllocateReceiptCommand[] = [];

  async recordReceipt(command: RecordReceiptCommand): Promise<void> {
    this.receipts.set(command.id, command);
  }

  async allocateReceipt(command: AllocateReceiptCommand): Promise<void> {
    this.allocations.push(command);
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

  clearAllocations(): void {
    this.allocations = [];
  }
}

class PackageObligationProvider implements ObligationProvider {
  constructor(private readonly billing: AcceptanceBillingRepository) {}

  async listOpenObligations(workspaceId: string, payer: PayerReference): Promise<FinancialObligation[]> {
    if (payer.type !== 'tutoring.student') return [];
    const cycle = await this.billing.getCurrentCycle(workspaceId, payer.id);
    if (!cycle || (cycle.status !== 'due' && cycle.status !== 'paid')) return [];
    return [{
      target: { module: 'tutoring', type: 'package_cycle', id: cycle.id },
      dueAt: cycle.completedOn ?? cycle.startedOn ?? '9999-12-31',
      amountDuePence: cycle.pricePence,
    }];
  }
}

describe('package + collection acceptance flow', () => {
  it('moves 5/8 to 8/8 using only real occurrences, then exposes one package obligation', async () => {
    const billingRepository = new AcceptanceBillingRepository();
    let nextCycle = 0;
    const billing = new BillingService(billingRepository, () => `cycle-${++nextCycle}`);

    const opening = await billing.configure('workspace-1', 'student-1', {
      billingMode: 'package',
      packageSize: 8,
      packagePricePence: 8000,
      cycleAnchorDate: '2026-09-04',
      effectiveFrom: '2026-09-17',
      openingCompletedCount: 5,
    });

    expect(opening.currentCycle?.progress).toMatchObject({
      completed: 5,
      remaining: 3,
      nextPosition: 6,
      due: false,
    });
    expect(billingRepository.linkedOccurrences).toEqual([]);

    const afterSix = await billing.recordCompletedOccurrence('workspace-1', 'student-1', 'occurrence-6', '2026-09-19');
    expect(afterSix.currentCycle?.progress).toMatchObject({ completed: 6, remaining: 2, nextPosition: 7, due: false });

    const afterSeven = await billing.recordCompletedOccurrence('workspace-1', 'student-1', 'occurrence-7', '2026-09-22');
    expect(afterSeven.currentCycle?.progress).toMatchObject({ completed: 7, remaining: 1, nextPosition: 8, due: false });

    const afterEight = await billing.recordCompletedOccurrence('workspace-1', 'student-1', 'occurrence-8', '2026-09-25');
    expect(afterEight.currentCycle?.progress).toMatchObject({ completed: 8, remaining: 0, nextPosition: null, due: true });
    expect(afterEight.currentCycle?.status).toBe('due');

    expect(billingRepository.linkedOccurrences).toEqual([
      { occurrenceId: 'occurrence-6', position: 6, earnedPence: 1000 },
      { occurrenceId: 'occurrence-7', position: 7, earnedPence: 1000 },
      { occurrenceId: 'occurrence-8', position: 8, earnedPence: 1000 },
    ]);

    const provider = new PackageObligationProvider(billingRepository);
    const obligations = await provider.listOpenObligations('workspace-1', { type: 'tutoring.student', id: 'student-1' });
    expect(obligations).toEqual([{
      target: { module: 'tutoring', type: 'package_cycle', id: 'cycle-1' },
      dueAt: '2026-09-25',
      amountDuePence: 8000,
    }]);
  });

  it('keeps advance payment as credit at 5/8 and reallocates it when the package reaches 8/8', async () => {
    const billingRepository = new AcceptanceBillingRepository();
    const billing = new BillingService(billingRepository, () => 'cycle-1');
    await billing.configure('workspace-1', 'student-1', {
      billingMode: 'package',
      packageSize: 8,
      packagePricePence: 8000,
      cycleAnchorDate: '2026-09-04',
      effectiveFrom: '2026-09-17',
      openingCompletedCount: 5,
    });

    const financeGateway = new AcceptanceFinanceGateway();
    let generatedId = 0;
    const finance = new FinanceCollectionService(
      financeGateway,
      [new PackageObligationProvider(billingRepository)],
      () => `generated-${++generatedId}`,
    );

    const advance = await finance.collect({
      receiptId: 'advance-receipt',
      workspaceId: 'workspace-1',
      payer: { type: 'tutoring.student', id: 'student-1' },
      amountPence: 8000,
      receivedAt: '2026-09-17',
      paymentMethod: 'bank',
      sourceKind: 'manual',
    });
    expect(advance).toMatchObject({ allocatedPence: 0, creditPence: 8000 });
    expect(financeGateway.allocations).toEqual([]);

    await billing.recordCompletedOccurrence('workspace-1', 'student-1', 'occurrence-6', '2026-09-19');
    await billing.recordCompletedOccurrence('workspace-1', 'student-1', 'occurrence-7', '2026-09-22');
    await billing.recordCompletedOccurrence('workspace-1', 'student-1', 'occurrence-8', '2026-09-25');

    // Server/local reconciliation rebuilds allocations from the original receipt after obligations change.
    financeGateway.clearAllocations();
    const reconciled = await finance.collect({
      receiptId: 'advance-receipt',
      workspaceId: 'workspace-1',
      payer: { type: 'tutoring.student', id: 'student-1' },
      amountPence: 8000,
      receivedAt: '2026-09-17',
      paymentMethod: 'bank',
      sourceKind: 'manual',
    });

    expect(financeGateway.receipts.size).toBe(1);
    expect(reconciled).toMatchObject({ allocatedPence: 8000, creditPence: 0 });
    expect(financeGateway.allocations).toHaveLength(1);
    expect(financeGateway.allocations[0]).toMatchObject({
      receiptId: 'advance-receipt',
      target: { module: 'tutoring', type: 'package_cycle', id: 'cycle-1' },
      amountPence: 8000,
    });
  });
});

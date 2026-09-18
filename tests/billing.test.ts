import { describe, expect, it } from 'vitest';
import {
  canChangeOpeningProgress,
  packageProgress,
  packageUnitShare,
} from '../src/modules/tutoring/domain/billing';
import type { BillingCycle, BillingPlan } from '../src/modules/tutoring/domain/billing-plan';
import type { BillingRepository } from '../src/modules/tutoring/ports/billing-repository';
import { BillingService } from '../src/modules/tutoring/services/billing.service';

class MemoryBillingRepository implements BillingRepository {
  constructor(
    public plan: BillingPlan | null,
    public cycle: BillingCycle | null,
  ) {}

  async getPlan(): Promise<BillingPlan | null> {
    return this.plan;
  }

  async upsertPlan(plan: BillingPlan): Promise<void> {
    this.plan = plan;
  }

  async hasBillingHistory(): Promise<boolean> {
    return Boolean(this.cycle);
  }

  async getCurrentCycle(): Promise<BillingCycle | null> {
    return this.cycle;
  }

  async getOpenCycle(): Promise<BillingCycle | null> {
    return this.cycle?.status === 'open' ? this.cycle : null;
  }

  async getCycleForOccurrence(): Promise<BillingCycle | null> {
    return null;
  }

  async getNextSequenceNo(): Promise<number> {
    return (this.cycle?.sequenceNo ?? 0) + 1;
  }

  async createCycle(input: Omit<BillingCycle, 'realCompletedCount'>): Promise<BillingCycle> {
    this.cycle = { ...input, realCompletedCount: 0 };
    return this.cycle;
  }

  async updateOpeningProgress(input: {
    workspaceId: string;
    cycleId: string;
    openingCompletedCount: number;
    status: 'open' | 'due';
    completedOn: string | null;
  }): Promise<void> {
    if (!this.cycle || this.cycle.workspaceId !== input.workspaceId || this.cycle.id !== input.cycleId) {
      throw new Error('BILLING_CYCLE_NOT_FOUND');
    }
    this.cycle = {
      ...this.cycle,
      openingCompletedCount: input.openingCompletedCount,
      status: input.status,
      completedOn: input.completedOn,
      paidOn: null,
    };
  }

  async addOccurrenceToCycle(): Promise<void> {}

  async markCycleDue(input: {
    workspaceId: string;
    cycleId: string;
    completedOn: string;
  }): Promise<void> {
    if (!this.cycle || this.cycle.workspaceId !== input.workspaceId || this.cycle.id !== input.cycleId) {
      throw new Error('BILLING_CYCLE_NOT_FOUND');
    }
    this.cycle = { ...this.cycle, status: 'due', completedOn: input.completedOn };
  }
}

function packagePlan(): BillingPlan {
  return {
    workspaceId: 'workspace-1',
    studentId: 'student-1',
    billingMode: 'package',
    packageSize: 8,
    packagePricePence: 8000,
    cycleAnchorDate: '2026-09-01',
    effectiveFrom: '2026-09-01',
  };
}

function packageCycle(
  realCompletedCount = 0,
  openingProgressLockedAt: string | null = null,
): BillingCycle {
  return {
    id: 'cycle-1',
    workspaceId: 'workspace-1',
    studentId: 'student-1',
    sequenceNo: 1,
    sessionLimit: 8,
    pricePence: 8000,
    openingCompletedCount: 3,
    openingProgressLockedAt,
    realCompletedCount,
    status: 'open',
    startedOn: '2026-09-01',
    completedOn: null,
    paidOn: null,
  };
}

describe('package billing', () => {
  it('allocates every penny of a package exactly once', () => {
    const total = 10001;
    const size = 8;
    const shares = Array.from({ length: size }, (_, index) =>
      packageUnitShare(total, size, index + 1),
    );

    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(total);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it('combines opening progress with real lessons', () => {
    expect(packageProgress(8, 3, 2)).toEqual({
      size: 8,
      openingCompleted: 3,
      realCompleted: 2,
      completed: 5,
      remaining: 3,
      nextPosition: 6,
      due: false,
    });
    expect(packageProgress(8, 3, 5).due).toBe(true);
    expect(packageProgress(8, 3, 5).nextPosition).toBeNull();
  });

  it('does not silently rewrite opening history after real lessons begin', () => {
    expect(canChangeOpeningProgress(3, 4, 0)).toBe(true);
    expect(canChangeOpeningProgress(3, 3, 2)).toBe(true);
    expect(canChangeOpeningProgress(3, 4, 2)).toBe(false);
    expect(canChangeOpeningProgress(3, 4, 0, true)).toBe(false);
  });

  it('rejects impossible progress', () => {
    expect(() => packageProgress(8, 9, 0)).toThrow();
    expect(() => packageProgress(8, 4, 5)).toThrow();
  });

  it('corrects opening progress before any real lesson is recorded', async () => {
    const repository = new MemoryBillingRepository(packagePlan(), packageCycle());
    const service = new BillingService(repository, () => 'new-cycle');

    const result = await service.configure('workspace-1', 'student-1', {
      billingMode: 'package',
      packageSize: 8,
      packagePricePence: 8000,
      cycleAnchorDate: '2026-09-01',
      effectiveFrom: '2026-09-16',
      openingCompletedCount: 5,
    });

    expect(repository.cycle?.openingCompletedCount).toBe(5);
    expect(result.currentCycle?.progress).toMatchObject({
      completed: 5,
      remaining: 3,
      nextPosition: 6,
      due: false,
    });
  });

  it('rejects an opening correction after real lessons and leaves the plan untouched', async () => {
    const repository = new MemoryBillingRepository(packagePlan(), packageCycle(2));
    const service = new BillingService(repository, () => 'new-cycle');

    await expect(service.configure('workspace-1', 'student-1', {
      billingMode: 'package',
      packageSize: 8,
      packagePricePence: 9000,
      cycleAnchorDate: '2026-09-01',
      effectiveFrom: '2026-09-16',
      openingCompletedCount: 4,
    })).rejects.toThrow('OPENING_PROGRESS_LOCKED_BY_REAL_LESSONS');

    expect(repository.cycle?.openingCompletedCount).toBe(3);
    expect(repository.plan?.packagePricePence).toBe(8000);
  });

  it('keeps opening progress locked after a real lesson is reopened', async () => {
    const repository = new MemoryBillingRepository(
      packagePlan(),
      packageCycle(0, '2026-09-10T12:00:00.000Z'),
    );
    const service = new BillingService(repository, () => 'new-cycle');

    await expect(service.configure('workspace-1', 'student-1', {
      billingMode: 'package',
      packageSize: 8,
      packagePricePence: 8000,
      cycleAnchorDate: '2026-09-01',
      effectiveFrom: '2026-09-16',
      openingCompletedCount: 4,
    })).rejects.toThrow('OPENING_PROGRESS_LOCKED_BY_REAL_LESSONS');

    expect(repository.cycle?.openingCompletedCount).toBe(3);
  });

  it('rejects impossible opening progress before writing a new plan', async () => {
    const repository = new MemoryBillingRepository(null, null);
    const service = new BillingService(repository, () => 'new-cycle');

    await expect(service.configure('workspace-1', 'student-1', {
      billingMode: 'package',
      packageSize: 8,
      packagePricePence: 8000,
      cycleAnchorDate: '2026-09-01',
      effectiveFrom: '2026-09-16',
      openingCompletedCount: 9,
    })).rejects.toThrow('OPENING_PROGRESS_EXCEEDS_PACKAGE');

    expect(repository.plan).toBeNull();
    expect(repository.cycle).toBeNull();
  });
});

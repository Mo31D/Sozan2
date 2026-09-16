import {
  configureBillingSchema,
  snapshotCycle,
  type BillingPlan,
  type StudentBillingSnapshot,
} from '../domain/billing-plan';
import type { BillingRepository } from '../ports/billing-repository';

export class BillingService {
  constructor(
    private readonly repository: BillingRepository,
    private readonly idFactory: () => string,
  ) {}

  async getStudentBilling(workspaceId: string, studentId: string): Promise<StudentBillingSnapshot> {
    const [plan, cycle] = await Promise.all([
      this.repository.getPlan(workspaceId, studentId),
      this.repository.getCurrentCycle(workspaceId, studentId),
    ]);
    return { plan, currentCycle: cycle ? snapshotCycle(cycle) : null };
  }

  async configure(workspaceId: string, studentId: string, input: unknown): Promise<StudentBillingSnapshot> {
    const parsed = configureBillingSchema.parse(input);
    const existing = await this.repository.getPlan(workspaceId, studentId);
    const hasHistory = await this.repository.hasBillingHistory(workspaceId, studentId);

    if (existing && hasHistory && existing.billingMode !== parsed.billingMode) {
      throw new Error('BILLING_MODE_LOCKED_BY_HISTORY');
    }

    const plan: BillingPlan = parsed.billingMode === 'package'
      ? {
          workspaceId,
          studentId,
          billingMode: 'package',
          packageSize: parsed.packageSize,
          packagePricePence: parsed.packagePricePence,
          cycleAnchorDate: parsed.cycleAnchorDate,
          effectiveFrom: parsed.effectiveFrom,
        }
      : {
          workspaceId,
          studentId,
          billingMode: 'per_session',
          packageSize: null,
          packagePricePence: null,
          cycleAnchorDate: null,
          effectiveFrom: parsed.effectiveFrom,
        };

    await this.repository.upsertPlan(plan);

    if (parsed.billingMode === 'package') {
      const current = await this.repository.getCurrentCycle(workspaceId, studentId);
      if (!current) {
        if (parsed.openingCompletedCount > parsed.packageSize) {
          throw new Error('OPENING_PROGRESS_EXCEEDS_PACKAGE');
        }
        await this.repository.createCycle({
          id: this.idFactory(),
          workspaceId,
          studentId,
          sequenceNo: 1,
          sessionLimit: parsed.packageSize,
          pricePence: parsed.packagePricePence,
          openingCompletedCount: parsed.openingCompletedCount,
          status: parsed.openingCompletedCount === parsed.packageSize ? 'due' : 'open',
          startedOn: parsed.cycleAnchorDate ?? parsed.effectiveFrom,
          completedOn: parsed.openingCompletedCount === parsed.packageSize
            ? parsed.effectiveFrom
            : null,
          paidOn: null,
        });
      }
    }

    return this.getStudentBilling(workspaceId, studentId);
  }
}

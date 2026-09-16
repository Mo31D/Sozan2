import { canChangeOpeningProgress, packageUnitShare } from '../domain/billing';
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
    const current = parsed.billingMode === 'package'
      ? await this.repository.getCurrentCycle(workspaceId, studentId)
      : null;

    if (existing && hasHistory && existing.billingMode !== parsed.billingMode) {
      throw new Error('BILLING_MODE_LOCKED_BY_HISTORY');
    }

    if (parsed.billingMode === 'package') {
      if (!current && parsed.openingCompletedCount > parsed.packageSize) {
        throw new Error('OPENING_PROGRESS_EXCEEDS_PACKAGE');
      }
      if (current) {
        if (parsed.openingCompletedCount > current.sessionLimit) {
          throw new Error('OPENING_PROGRESS_EXCEEDS_PACKAGE');
        }
        if (!canChangeOpeningProgress(
          current.openingCompletedCount,
          parsed.openingCompletedCount,
          current.realCompletedCount,
          Boolean(current.openingProgressLockedAt),
        )) {
          throw new Error('OPENING_PROGRESS_LOCKED_BY_REAL_LESSONS');
        }
      }
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

    if (parsed.billingMode === 'package' && current
      && current.openingCompletedCount !== parsed.openingCompletedCount) {
      const due = parsed.openingCompletedCount + current.realCompletedCount === current.sessionLimit;
      await this.repository.updateOpeningProgress({
        workspaceId,
        cycleId: current.id,
        openingCompletedCount: parsed.openingCompletedCount,
        status: due ? 'due' : 'open',
        completedOn: due ? (current.completedOn ?? parsed.effectiveFrom) : null,
      });
    }

    await this.repository.upsertPlan(plan);

    if (parsed.billingMode === 'package' && !current) {
      await this.repository.createCycle({
        id: this.idFactory(),
        workspaceId,
        studentId,
        sequenceNo: 1,
        sessionLimit: parsed.packageSize,
        pricePence: parsed.packagePricePence,
        openingCompletedCount: parsed.openingCompletedCount,
        openingProgressLockedAt: null,
        status: parsed.openingCompletedCount === parsed.packageSize ? 'due' : 'open',
        startedOn: parsed.cycleAnchorDate ?? parsed.effectiveFrom,
        completedOn: parsed.openingCompletedCount === parsed.packageSize
          ? parsed.effectiveFrom
          : null,
        paidOn: null,
      });
    }

    return this.getStudentBilling(workspaceId, studentId);
  }

  async recordCompletedOccurrence(
    workspaceId: string,
    studentId: string,
    occurrenceId: string,
    occurredOn: string,
  ): Promise<StudentBillingSnapshot> {
    const plan = await this.repository.getPlan(workspaceId, studentId);
    if (!plan || plan.billingMode !== 'package') {
      return this.getStudentBilling(workspaceId, studentId);
    }
    if (plan.packageSize === null || plan.packagePricePence === null) {
      throw new Error('PACKAGE_PLAN_INVALID');
    }

    let cycle = await this.repository.getOpenCycle(workspaceId, studentId);
    if (!cycle) {
      cycle = await this.repository.createCycle({
        id: this.idFactory(),
        workspaceId,
        studentId,
        sequenceNo: await this.repository.getNextSequenceNo(workspaceId, studentId),
        sessionLimit: plan.packageSize,
        pricePence: plan.packagePricePence,
        openingCompletedCount: 0,
        openingProgressLockedAt: null,
        status: 'open',
        startedOn: occurredOn,
        completedOn: null,
        paidOn: null,
      });
    }

    const position = cycle.openingCompletedCount + cycle.realCompletedCount + 1;
    if (position > cycle.sessionLimit) throw new Error('PACKAGE_CYCLE_ALREADY_COMPLETE');

    await this.repository.addOccurrenceToCycle({
      workspaceId,
      cycleId: cycle.id,
      occurrenceId,
      position,
      earnedPence: packageUnitShare(cycle.pricePence, cycle.sessionLimit, position),
    });

    if (position === cycle.sessionLimit) {
      await this.repository.markCycleDue({
        workspaceId,
        cycleId: cycle.id,
        completedOn: occurredOn,
      });
    }

    return this.getStudentBilling(workspaceId, studentId);
  }
}

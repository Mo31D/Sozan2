import type { BillingCycle, BillingPlan } from '../domain/billing-plan';

export interface BillingRepository {
  getPlan(workspaceId: string, studentId: string): Promise<BillingPlan | null>;
  upsertPlan(plan: BillingPlan): Promise<void>;
  hasBillingHistory(workspaceId: string, studentId: string): Promise<boolean>;
  getCurrentCycle(workspaceId: string, studentId: string): Promise<BillingCycle | null>;
  getOpenCycle(workspaceId: string, studentId: string): Promise<BillingCycle | null>;
  getNextSequenceNo(workspaceId: string, studentId: string): Promise<number>;
  createCycle(input: Omit<BillingCycle, 'realCompletedCount'>): Promise<BillingCycle>;
  addOccurrenceToCycle(input: {
    workspaceId: string;
    cycleId: string;
    occurrenceId: string;
    position: number;
    earnedPence: number;
  }): Promise<void>;
  markCycleDue(input: {
    workspaceId: string;
    cycleId: string;
    completedOn: string;
  }): Promise<void>;
}

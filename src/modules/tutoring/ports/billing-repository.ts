import type { BillingCycle, BillingPlan } from '../domain/billing-plan';

export interface BillingRepository {
  getPlan(workspaceId: string, studentId: string): Promise<BillingPlan | null>;
  upsertPlan(plan: BillingPlan): Promise<void>;
  hasBillingHistory(workspaceId: string, studentId: string): Promise<boolean>;
  getCurrentCycle(workspaceId: string, studentId: string): Promise<BillingCycle | null>;
  createCycle(input: Omit<BillingCycle, 'realCompletedCount'>): Promise<BillingCycle>;
}

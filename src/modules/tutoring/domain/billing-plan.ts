import { z } from 'zod';
import { packageProgress, type PackageProgress } from './billing';

export const configureBillingSchema = z.discriminatedUnion('billingMode', [
  z.object({
    billingMode: z.literal('per_session'),
    effectiveFrom: z.string().date(),
  }),
  z.object({
    billingMode: z.literal('package'),
    packageSize: z.number().int().min(1).max(100),
    packagePricePence: z.number().int().min(0),
    effectiveFrom: z.string().date(),
    cycleAnchorDate: z.string().date().nullable().optional().default(null),
    openingCompletedCount: z.number().int().min(0).max(100).default(0),
  }),
]);

export type ConfigureBillingInput = z.infer<typeof configureBillingSchema>;

export type BillingPlan = {
  workspaceId: string;
  studentId: string;
  billingMode: 'per_session' | 'package';
  packageSize: number | null;
  packagePricePence: number | null;
  cycleAnchorDate: string | null;
  effectiveFrom: string;
};

export type BillingCycle = {
  id: string;
  workspaceId: string;
  studentId: string;
  sequenceNo: number;
  sessionLimit: number;
  pricePence: number;
  openingCompletedCount: number;
  realCompletedCount: number;
  status: 'open' | 'due' | 'paid' | 'cancelled';
  startedOn: string | null;
  completedOn: string | null;
  paidOn: string | null;
};

export type StudentBillingSnapshot = {
  plan: BillingPlan | null;
  currentCycle: (BillingCycle & { progress: PackageProgress }) | null;
};

export function snapshotCycle(cycle: BillingCycle): BillingCycle & { progress: PackageProgress } {
  return {
    ...cycle,
    progress: packageProgress(
      cycle.sessionLimit,
      cycle.openingCompletedCount,
      cycle.realCompletedCount,
    ),
  };
}

export const FAMILY_PACKAGE_TARGET_TYPE = 'family_package_cycle' as const;
export const FAMILY_PAYER_REF_TYPE = 'tutoring.billing_account' as const;

export type BillingAccountCountingMode = 'shared_occurrence' | 'per_member_quota';

export type BillingAccount = {
  id: string;
  workspaceId: string;
  displayName: string;
  accountType: 'family';
  countingMode: BillingAccountCountingMode;
  primaryStudentId: string;
  packageSize: number;
  packagePricePence: number;
  effectiveFrom: string;
  active: boolean;
};

export type BillingAccountMember = {
  id: string;
  workspaceId: string;
  billingAccountId: string;
  studentId: string;
  position: number;
  active: boolean;
};

export type BillingAccountCycle = {
  id: string;
  workspaceId: string;
  billingAccountId: string;
  sequenceNo: number;
  packageSize: number;
  pricePence: number;
  status: 'open' | 'due' | 'paid' | 'cancelled';
  startedOn: string | null;
  completedOn: string | null;
  paidOn: string | null;
};

export type StudentProgressCycle = {
  id: string;
  studentId: string;
  sequenceNo: number;
  sessionLimit: number;
  openingCompletedCount: number;
  realCompletedCount: number;
  status: 'open' | 'due' | 'paid' | 'cancelled';
  startedOn: string | null;
  completedOn: string | null;
};

export type FamilyAccountState = {
  account: BillingAccount;
  members: BillingAccountMember[];
  financialCycle: BillingAccountCycle | null;
  memberProgress: Array<{
    studentId: string;
    sequenceNo: number;
    completed: number;
    limit: number;
    complete: boolean;
  }>;
};

export function completedStudentCycleCount(cycle: Pick<StudentProgressCycle, 'openingCompletedCount' | 'realCompletedCount'>): number {
  return Math.max(0, Number(cycle.openingCompletedCount || 0)) + Math.max(0, Number(cycle.realCompletedCount || 0));
}

export function familyAccountForStudent(
  accounts: readonly BillingAccount[],
  members: readonly BillingAccountMember[],
  studentId: string,
): BillingAccount | null {
  const membership = members.find((row) => row.active && row.studentId === studentId);
  if (!membership) return null;
  return accounts.find((row) => row.active && row.id === membership.billingAccountId) ?? null;
}

export function activeFamilyMembers(
  members: readonly BillingAccountMember[],
  accountId: string,
): BillingAccountMember[] {
  return members
    .filter((row) => row.active && row.billingAccountId === accountId)
    .sort((a, b) => a.position - b.position || a.studentId.localeCompare(b.studentId));
}

export function requiredProgressStudentIds(
  account: BillingAccount,
  members: readonly BillingAccountMember[],
): string[] {
  return account.countingMode === 'shared_occurrence'
    ? [account.primaryStudentId]
    : activeFamilyMembers(members, account.id).map((row) => row.studentId);
}

export function studentCycleForSequence(
  cycles: readonly StudentProgressCycle[],
  studentId: string,
  sequenceNo: number,
): StudentProgressCycle | null {
  return cycles.find((row) =>
    row.studentId === studentId
    && row.sequenceNo === sequenceNo
    && row.status !== 'cancelled') ?? null;
}

export function familySequenceComplete(
  account: BillingAccount,
  members: readonly BillingAccountMember[],
  cycles: readonly StudentProgressCycle[],
  sequenceNo: number,
): boolean {
  const required = requiredProgressStudentIds(account, members);
  if (!required.length) return false;
  return required.every((studentId) => {
    const cycle = studentCycleForSequence(cycles, studentId, sequenceNo);
    return Boolean(cycle && completedStudentCycleCount(cycle) >= cycle.sessionLimit);
  });
}

export function familySequenceCompletedOn(
  account: BillingAccount,
  members: readonly BillingAccountMember[],
  cycles: readonly StudentProgressCycle[],
  sequenceNo: number,
): string | null {
  if (!familySequenceComplete(account, members, cycles, sequenceNo)) return null;
  const dates = requiredProgressStudentIds(account, members)
    .map((studentId) => studentCycleForSequence(cycles, studentId, sequenceNo)?.completedOn ?? null)
    .filter((value): value is string => Boolean(value))
    .sort();
  return dates.at(-1) ?? null;
}

export function nextRelevantFamilySequence(
  account: BillingAccount,
  members: readonly BillingAccountMember[],
  cycles: readonly StudentProgressCycle[],
): number {
  const relevant = new Set(requiredProgressStudentIds(account, members));
  return Math.max(
    1,
    ...cycles
      .filter((row) => relevant.has(row.studentId) && row.status !== 'cancelled')
      .map((row) => row.sequenceNo),
  );
}

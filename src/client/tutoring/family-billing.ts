import {
  FAMILY_PACKAGE_TARGET_TYPE,
  FAMILY_PAYER_REF_TYPE,
  activeFamilyMembers,
  familySequenceComplete,
  familySequenceCompletedOn,
  requiredProgressStudentIds,
  type BillingAccount,
  type BillingAccountCycle,
  type BillingAccountMember,
} from '../../modules/tutoring/domain/billing-account';
import {
  compareFinancialObligations,
  type FinancialObligation,
} from '../../modules/finance/allocation.service';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import type { LocalAllocation } from '../finance/types';
import type { LocalBillingCycle, LocalReceipt } from './local-commands';

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function accountObligations(cycles: readonly BillingAccountCycle[]): FinancialObligation[] {
  return cycles
    .filter((cycle) => cycle.status === 'due' || cycle.status === 'paid')
    .map((cycle) => ({
      target: { module: 'tutoring', type: FAMILY_PACKAGE_TARGET_TYPE, id: cycle.id },
      dueAt: cycle.completedOn ?? cycle.startedOn ?? '9999-12-31',
      amountDuePence: cycle.pricePence,
    }))
    .sort(compareFinancialObligations);
}

export async function activeFamilyAccountIdsForStudentsLocally(
  workspaceId: string,
  studentIds: readonly string[],
): Promise<string[]> {
  if (!studentIds.length) return [];
  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [STORES.tutoringBillingAccounts, STORES.tutoringBillingAccountMembers],
    'readonly',
  );
  const [accounts, members] = await Promise.all([
    requestResult<BillingAccount[]>(transaction.objectStore(STORES.tutoringBillingAccounts).getAll()),
    requestResult<BillingAccountMember[]>(transaction.objectStore(STORES.tutoringBillingAccountMembers).getAll()),
  ]);
  const activeAccountIds = new Set(accounts
    .filter((row) => row.workspaceId === workspaceId && row.active)
    .map((row) => row.id));
  const wanted = new Set(studentIds);
  return unique(members
    .filter((row) =>
      row.workspaceId === workspaceId
      && row.active
      && wanted.has(row.studentId)
      && activeAccountIds.has(row.billingAccountId))
    .map((row) => row.billingAccountId));
}

export async function reconcileFamilyAccountLocally(
  workspaceId: string,
  accountId: string,
): Promise<void> {
  const db = await openLocalDatabase();
  const readStores = [
    STORES.tutoringBillingAccounts,
    STORES.tutoringBillingAccountMembers,
    STORES.tutoringBillingCycles,
    STORES.tutoringBillingAccountCycles,
    STORES.financeAllocations,
    STORES.financeReceipts,
  ];
  const read = db.transaction(readStores, 'readonly');
  const [accounts, members, studentCycles, familyCycles, allocations, receipts] = await Promise.all([
    requestResult<BillingAccount[]>(read.objectStore(STORES.tutoringBillingAccounts).getAll()),
    requestResult<BillingAccountMember[]>(read.objectStore(STORES.tutoringBillingAccountMembers).getAll()),
    requestResult<LocalBillingCycle[]>(read.objectStore(STORES.tutoringBillingCycles).getAll()),
    requestResult<BillingAccountCycle[]>(read.objectStore(STORES.tutoringBillingAccountCycles).getAll()),
    requestResult<LocalAllocation[]>(read.objectStore(STORES.financeAllocations).getAll()),
    requestResult<LocalReceipt[]>(read.objectStore(STORES.financeReceipts).getAll()),
  ]);

  const account = accounts.find((row) =>
    row.workspaceId === workspaceId && row.id === accountId && row.active);
  if (!account) return;

  const accountMembers = activeFamilyMembers(
    members.filter((row) => row.workspaceId === workspaceId),
    account.id,
  );
  const requiredIds = new Set(requiredProgressStudentIds(account, accountMembers));
  if (!requiredIds.size) return;

  const relevantStudentCycles = studentCycles.filter((row) =>
    row.workspaceId === workspaceId
    && requiredIds.has(row.studentId)
    && row.status !== 'cancelled');
  const sequenceNos = unique(relevantStudentCycles.map((row) => row.sequenceNo)).sort((a, b) => a - b);
  if (!sequenceNos.length) return;

  const activeReceiptIds = new Set(receipts
    .filter((row) => row.workspaceId === workspaceId && !row.deletedAt)
    .map((row) => row.id));
  const allocatedForCycle = (cycleId: string) => allocations
    .filter((row) =>
      row.workspaceId === workspaceId
      && activeReceiptIds.has(row.receiptId)
      && row.targetModule === 'tutoring'
      && row.targetType === FAMILY_PACKAGE_TARGET_TYPE
      && row.targetId === cycleId)
    .reduce((sum, row) => sum + row.amountPence, 0);

  const storeCycles = familyCycles.filter((row) =>
    row.workspaceId === workspaceId
    && row.billingAccountId === account.id
    && row.status !== 'cancelled');
  const updates: BillingAccountCycle[] = [];

  for (const sequenceNo of sequenceNos) {
    const existing = storeCycles.find((row) => row.sequenceNo === sequenceNo) ?? null;
    const requiredCycles = [...requiredIds]
      .map((studentId) => relevantStudentCycles.find((row) =>
        row.studentId === studentId && row.sequenceNo === sequenceNo) ?? null)
      .filter((row): row is LocalBillingCycle => Boolean(row));

    // A family cycle can start as soon as any required member enters that sequence.
    const startedOn = requiredCycles
      .map((row) => row.startedOn)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? existing?.startedOn ?? null;

    const base: BillingAccountCycle = existing ?? {
      id: crypto.randomUUID(),
      workspaceId,
      billingAccountId: account.id,
      sequenceNo,
      packageSize: account.packageSize,
      pricePence: account.packagePricePence,
      status: 'open',
      startedOn,
      completedOn: null,
      paidOn: null,
    };

    const complete = familySequenceComplete(account, accountMembers, relevantStudentCycles, sequenceNo);
    const completedOn = complete
      ? (familySequenceCompletedOn(account, accountMembers, relevantStudentCycles, sequenceNo)
        ?? base.completedOn
        ?? startedOn)
      : null;
    const allocated = allocatedForCycle(base.id);
    const paid = complete && allocated >= base.pricePence;
    const paidReceiptDates = paid
      ? allocations
          .filter((row) =>
            row.workspaceId === workspaceId
            && activeReceiptIds.has(row.receiptId)
            && row.targetModule === 'tutoring'
            && row.targetType === FAMILY_PACKAGE_TARGET_TYPE
            && row.targetId === base.id)
          .map((row) => receipts.find((receipt) => receipt.id === row.receiptId)?.receivedAt ?? '')
          .filter(Boolean)
          .sort()
      : [];

    updates.push({
      ...base,
      startedOn,
      status: complete ? (paid ? 'paid' : 'due') : 'open',
      completedOn,
      paidOn: paid ? (paidReceiptDates.at(-1) ?? base.paidOn ?? completedOn) : null,
    });
  }

  const write = db.transaction(STORES.tutoringBillingAccountCycles, 'readwrite');
  const store = write.objectStore(STORES.tutoringBillingAccountCycles);
  for (const row of updates) store.put(row);
  await transactionDone(write);
}

export async function rebalanceFamilyAccountLocally(
  workspaceId: string,
  accountId: string,
): Promise<void> {
  await reconcileFamilyAccountLocally(workspaceId, accountId);

  const db = await openLocalDatabase();
  const read = db.transaction([
    STORES.tutoringBillingAccounts,
    STORES.tutoringBillingAccountCycles,
    STORES.financeReceipts,
    STORES.financeAllocations,
  ], 'readonly');
  const [accounts, cycles, receipts, allocations] = await Promise.all([
    requestResult<BillingAccount[]>(read.objectStore(STORES.tutoringBillingAccounts).getAll()),
    requestResult<BillingAccountCycle[]>(read.objectStore(STORES.tutoringBillingAccountCycles).getAll()),
    requestResult<LocalReceipt[]>(read.objectStore(STORES.financeReceipts).getAll()),
    requestResult<LocalAllocation[]>(read.objectStore(STORES.financeAllocations).getAll()),
  ]);
  const account = accounts.find((row) =>
    row.workspaceId === workspaceId && row.id === accountId && row.active);
  if (!account) return;

  const activeReceipts = receipts
    .filter((row) =>
      row.workspaceId === workspaceId
      && row.payerRefType === FAMILY_PAYER_REF_TYPE
      && row.payerRefId === accountId
      && !row.deletedAt)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  const activeReceiptIds = new Set(activeReceipts.map((row) => row.id));
  const accountAllocations = allocations.filter((row) =>
    row.workspaceId === workspaceId && activeReceiptIds.has(row.receiptId));
  const obligations = accountObligations(cycles.filter((row) =>
    row.workspaceId === workspaceId
    && row.billingAccountId === accountId
    && row.status !== 'cancelled'));

  const allocatedByTarget = new Map<string, number>();
  for (const row of accountAllocations) {
    const key = `${row.targetType}:${row.targetId}`;
    allocatedByTarget.set(key, (allocatedByTarget.get(key) ?? 0) + row.amountPence);
  }

  const generated: LocalAllocation[] = [];
  for (const receipt of activeReceipts) {
    const alreadyFromReceipt = accountAllocations
      .filter((row) => row.receiptId === receipt.id)
      .reduce((sum, row) => sum + row.amountPence, 0);
    if (alreadyFromReceipt > receipt.amountPence) throw new Error('RECEIPT_OVERALLOCATED');

    let remaining = receipt.amountPence - alreadyFromReceipt;
    for (const obligation of obligations) {
      if (remaining <= 0) break;
      const key = `${obligation.target.type}:${obligation.target.id}`;
      const already = allocatedByTarget.get(key) ?? 0;
      const outstanding = Math.max(0, obligation.amountDuePence - already);
      if (!outstanding) continue;
      const amountPence = Math.min(remaining, outstanding);
      generated.push({
        id: crypto.randomUUID(),
        workspaceId,
        receiptId: receipt.id,
        targetModule: obligation.target.module,
        targetType: obligation.target.type,
        targetId: obligation.target.id,
        amountPence,
      });
      allocatedByTarget.set(key, already + amountPence);
      remaining -= amountPence;
    }
  }

  if (generated.length) {
    const write = db.transaction(STORES.financeAllocations, 'readwrite');
    const store = write.objectStore(STORES.financeAllocations);
    for (const row of generated) store.put(row);
    await transactionDone(write);
  }

  await reconcileFamilyAccountLocally(workspaceId, accountId);
}

export async function rebalanceFamilyAccountsForStudentsLocally(
  workspaceId: string,
  studentIds: readonly string[],
): Promise<void> {
  const accountIds = await activeFamilyAccountIdsForStudentsLocally(workspaceId, studentIds);
  for (const accountId of accountIds) {
    await rebalanceFamilyAccountLocally(workspaceId, accountId);
  }
}

import {
  compareFinancialObligations,
  type FinancialObligation,
} from '../../modules/finance/allocation.service';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import type { LocalAllocation, LocalOccurrence } from '../simple/data';
import type { LocalBillingCycle, LocalBillingPlan, LocalReceipt } from '../tutoring/local-commands';

export async function rebalanceStudentLocally(workspaceId: string, studentId: string): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction([
    STORES.financeReceipts,
    STORES.financeAllocations,
    STORES.tutoringBillingCycles,
    STORES.tutoringBillingPlans,
    STORES.tutoringOccurrences,
    STORES.tutoringSessions,
  ], 'readonly');
  const [receipts, allocations, cycles, plans, occurrences, sessions] = await Promise.all([
    requestResult<LocalReceipt[]>(read.objectStore(STORES.financeReceipts).getAll()),
    requestResult<LocalAllocation[]>(read.objectStore(STORES.financeAllocations).getAll()),
    requestResult<LocalBillingCycle[]>(read.objectStore(STORES.tutoringBillingCycles).getAll()),
    requestResult<LocalBillingPlan[]>(read.objectStore(STORES.tutoringBillingPlans).getAll()),
    requestResult<LocalOccurrence[]>(read.objectStore(STORES.tutoringOccurrences).getAll()),
    requestResult<RecurringSession[]>(read.objectStore(STORES.tutoringSessions).getAll()),
  ]);

  const studentReceipts = receipts
    .filter((row) => row.workspaceId === workspaceId && row.payerRefId === studentId);
  const receiptIds = new Set(studentReceipts.map((row) => row.id));
  const activeReceipts = studentReceipts
    .filter((row) => !row.deletedAt)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  const plan = plans.find((row) => row.workspaceId === workspaceId && row.studentId === studentId) ?? null;
  const studentCycles = cycles
    .filter((row) => row.workspaceId === workspaceId && row.studentId === studentId && row.status !== 'cancelled');

  const obligations: FinancialObligation[] = [];

  for (const cycle of studentCycles) {
    const complete = cycle.openingCompletedCount + cycle.realCompletedCount >= cycle.sessionLimit;
    if (!complete) continue;
    obligations.push({
      target: { module: 'tutoring', type: 'package_cycle', id: cycle.id },
      dueAt: cycle.completedOn ?? cycle.startedOn ?? '9999-12-31',
      amountDuePence: cycle.pricePence,
    });
  }

  if (!plan || plan.billingMode === 'per_session') {
    for (const occurrence of occurrences.filter((row) => row.workspaceId === workspaceId && row.status === 'completed')) {
      const session = sessions.find((row) => row.workspaceId === workspaceId && row.id === occurrence.recurringSessionId);
      if (!session || !session.studentIds.includes(studentId)) continue;
      if (session.priceBasis !== 'per_student' && session.expectedStudentCount !== 1) continue;
      const amountPence = session.priceBasis === 'per_student' ? session.defaultPricePence : occurrence.grossPence;
      if (amountPence <= 0) continue;
      obligations.push({
        target: { module: 'tutoring', type: 'occurrence', id: occurrence.id },
        dueAt: occurrence.completedAt ?? occurrence.sessionDate,
        amountDuePence: amountPence,
      });
    }
  }
  obligations.sort(compareFinancialObligations);

  const generated: LocalAllocation[] = [];
  const allocatedByTarget = new Map<string, number>();
  for (const receipt of activeReceipts) {
    let remaining = receipt.amountPence;
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

  const write = db.transaction([STORES.financeAllocations, STORES.tutoringBillingCycles], 'readwrite');
  const allocationStore = write.objectStore(STORES.financeAllocations);
  for (const allocation of allocations) {
    if (allocation.workspaceId === workspaceId && receiptIds.has(allocation.receiptId)) {
      allocationStore.delete(allocation.id);
    }
  }
  for (const allocation of generated) allocationStore.put(allocation);

  const cycleStore = write.objectStore(STORES.tutoringBillingCycles);
  for (const cycle of studentCycles) {
    const complete = cycle.openingCompletedCount + cycle.realCompletedCount >= cycle.sessionLimit;
    if (!complete) {
      if (cycle.status !== 'open' || cycle.paidOn) cycleStore.put({ ...cycle, status: 'open', paidOn: null });
      continue;
    }
    const allocated = allocatedByTarget.get(`package_cycle:${cycle.id}`) ?? 0;
    const paid = allocated >= cycle.pricePence;
    const paidReceiptDates = generated
      .filter((row) => row.targetType === 'package_cycle' && row.targetId === cycle.id)
      .map((row) => activeReceipts.find((receipt) => receipt.id === row.receiptId)?.receivedAt ?? '')
      .filter(Boolean)
      .sort();
    cycleStore.put({
      ...cycle,
      status: paid ? 'paid' : 'due',
      paidOn: paid ? (paidReceiptDates.at(-1) ?? cycle.paidOn ?? null) : null,
    } satisfies LocalBillingCycle);
  }
  await transactionDone(write);
}

export async function refreshAllStudentBalancesLocally(workspaceId: string): Promise<void> {
  const db = await openLocalDatabase();
  const receipts = await requestResult<LocalReceipt[]>(
    db.transaction(STORES.financeReceipts, 'readonly').objectStore(STORES.financeReceipts).getAll(),
  );
  const studentIds = [...new Set(receipts.filter((row) => row.workspaceId === workspaceId).map((row) => row.payerRefId))];
  for (const studentId of studentIds) await rebalanceStudentLocally(workspaceId, studentId);
}

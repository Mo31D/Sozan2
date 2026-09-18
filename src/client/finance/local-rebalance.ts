import {
  compareFinancialObligations,
  type FinancialObligation,
} from '../../modules/finance/allocation.service';
import {
  STUDENT_OCCURRENCE_TARGET_TYPE,
  studentOccurrenceTargetId,
} from '../../modules/tutoring/domain/finance-target';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import type { LocalAllocation, LocalOccurrence } from '../simple/data';
import type { LocalBillingCycle, LocalBillingPlan, LocalReceipt } from '../tutoring/local-commands';

function studentObligations(input: {
  workspaceId: string;
  studentId: string;
  plan: LocalBillingPlan | null;
  cycles: LocalBillingCycle[];
  occurrences: LocalOccurrence[];
  sessions: RecurringSession[];
}): FinancialObligation[] {
  const { workspaceId, studentId, plan, cycles, occurrences, sessions } = input;
  const obligations: FinancialObligation[] = [];

  if (plan?.billingMode === 'package') {
    for (const cycle of cycles) {
      const complete = cycle.openingCompletedCount + cycle.realCompletedCount >= cycle.sessionLimit;
      if (!complete) continue;
      obligations.push({
        target: { module: 'tutoring', type: 'package_cycle', id: cycle.id },
        dueAt: cycle.completedOn ?? cycle.startedOn ?? '9999-12-31',
        amountDuePence: cycle.pricePence,
      });
    }
  }

  if (plan?.billingMode === 'per_session') {
    for (const occurrence of occurrences.filter((row) =>
      row.workspaceId === workspaceId && row.status === 'completed')) {
      const session = sessions.find((row) =>
        row.workspaceId === workspaceId && row.id === occurrence.recurringSessionId);
      if (!session) continue;

      const priceBasis = occurrence.priceBasisSnapshot ?? session.priceBasis;
      let amountPence = 0;
      if (priceBasis === 'per_student') {
        if (!(occurrence.studentIds ?? []).includes(studentId)) continue;
        amountPence = occurrence.defaultPricePenceSnapshot ?? session.defaultPricePence;
      } else {
        const payerStudentId = occurrence.payerStudentIdSnapshot ?? session.payerStudentId;
        if (payerStudentId !== studentId) continue;
        amountPence = occurrence.grossPence;
      }
      if (amountPence <= 0) continue;

      obligations.push({
        target: {
          module: 'tutoring',
          type: STUDENT_OCCURRENCE_TARGET_TYPE,
          id: studentOccurrenceTargetId(occurrence.id, studentId),
        },
        dueAt: occurrence.completedAt ?? occurrence.rescheduledToDate ?? occurrence.sessionDate,
        amountDuePence: amountPence,
      });
    }
  }

  return obligations.sort(compareFinancialObligations);
}

/**
 * Incrementally applies unallocated receipt credit to newly available
 * obligations. Existing allocations are preserved in normal operation so a
 * tutoring edit cannot silently rewrite payment history.
 */
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
  const activeReceipts = studentReceipts
    .filter((row) => !row.deletedAt)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  const activeReceiptIds = new Set(activeReceipts.map((row) => row.id));
  const studentAllocations = allocations.filter((row) =>
    row.workspaceId === workspaceId && activeReceiptIds.has(row.receiptId));
  const plan = plans.find((row) => row.workspaceId === workspaceId && row.studentId === studentId) ?? null;
  const studentCycles = cycles
    .filter((row) => row.workspaceId === workspaceId && row.studentId === studentId && row.status !== 'cancelled');
  const obligations = studentObligations({
    workspaceId,
    studentId,
    plan,
    cycles: studentCycles,
    occurrences,
    sessions,
  });

  const allocatedByTarget = new Map<string, number>();
  for (const row of studentAllocations) {
    const key = `${row.targetType}:${row.targetId}`;
    allocatedByTarget.set(key, (allocatedByTarget.get(key) ?? 0) + row.amountPence);
  }

  const generated: LocalAllocation[] = [];
  for (const receipt of activeReceipts) {
    const alreadyFromReceipt = studentAllocations
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
      const allocation: LocalAllocation = {
        id: crypto.randomUUID(),
        workspaceId,
        receiptId: receipt.id,
        targetModule: obligation.target.module,
        targetType: obligation.target.type,
        targetId: obligation.target.id,
        amountPence,
      };
      generated.push(allocation);
      allocatedByTarget.set(key, already + amountPence);
      remaining -= amountPence;
    }
  }

  const write = db.transaction([STORES.financeAllocations, STORES.tutoringBillingCycles], 'readwrite');
  const allocationStore = write.objectStore(STORES.financeAllocations);
  for (const allocation of generated) allocationStore.put(allocation);

  const allStudentAllocations = [...studentAllocations, ...generated];
  const cycleStore = write.objectStore(STORES.tutoringBillingCycles);
  if (plan?.billingMode === 'package') {
    for (const cycle of studentCycles) {
      const complete = cycle.openingCompletedCount + cycle.realCompletedCount >= cycle.sessionLimit;
      if (!complete) {
        if (cycle.status !== 'open' || cycle.paidOn) {
          cycleStore.put({ ...cycle, status: 'open', paidOn: null });
        }
        continue;
      }

      const allocated = allocatedByTarget.get(`package_cycle:${cycle.id}`) ?? 0;
      const paid = allocated >= cycle.pricePence;
      const paidReceiptDates = allStudentAllocations
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
  }
  await transactionDone(write);
}

/**
 * Explicit correction path. Only correction workflows may release existing
 * allocations before rebuilding them against corrected obligations.
 */
export async function rebuildStudentLocally(workspaceId: string, studentId: string): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction([STORES.financeReceipts, STORES.financeAllocations], 'readonly');
  const [receipts, allocations] = await Promise.all([
    requestResult<LocalReceipt[]>(read.objectStore(STORES.financeReceipts).getAll()),
    requestResult<LocalAllocation[]>(read.objectStore(STORES.financeAllocations).getAll()),
  ]);
  const receiptIds = new Set(receipts
    .filter((row) => row.workspaceId === workspaceId && row.payerRefId === studentId)
    .map((row) => row.id));

  if (receiptIds.size) {
    const write = db.transaction(STORES.financeAllocations, 'readwrite');
    const store = write.objectStore(STORES.financeAllocations);
    for (const allocation of allocations) {
      if (allocation.workspaceId === workspaceId && receiptIds.has(allocation.receiptId)) {
        store.delete(allocation.id);
      }
    }
    await transactionDone(write);
  }

  await rebalanceStudentLocally(workspaceId, studentId);
}

export async function refreshAllStudentBalancesLocally(workspaceId: string): Promise<void> {
  const db = await openLocalDatabase();
  const receipts = await requestResult<LocalReceipt[]>(
    db.transaction(STORES.financeReceipts, 'readonly').objectStore(STORES.financeReceipts).getAll(),
  );
  const studentIds = [...new Set(receipts
    .filter((row) => row.workspaceId === workspaceId)
    .map((row) => row.payerRefId))];
  for (const studentId of studentIds) await rebalanceStudentLocally(workspaceId, studentId);
}

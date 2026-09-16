import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { makeActivityEvent, activitySyncMutation } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { newSyncOutboxRecord } from '../sync/outbox';
import type { LocalAllocation, LocalExpense, LocalOccurrence } from '../simple/data';
import type { LocalBillingCycle, LocalBillingPlan, LocalReceipt } from '../tutoring/local-commands';

export type ReceiptCorrectionInput = {
  studentId: string;
  amountPence: number;
  receivedAt: string;
  paymentMethod: 'cash' | 'bank' | 'wallet' | 'other';
  note?: string | null;
};

export type ExpenseCorrectionInput = {
  expenseDate: string;
  scope: 'business' | 'personal';
  category: string;
  amountPence: number;
  note?: string | null;
};

function assertAmount(amountPence: number): void {
  if (!Number.isSafeInteger(amountPence) || amountPence <= 0) throw new Error('AMOUNT_INVALID');
}

function normaliseNote(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export async function updateLocalReceipt(
  workspaceId: string,
  receiptId: string,
  input: ReceiptCorrectionInput,
): Promise<void> {
  assertAmount(input.amountPence);
  const db = await openLocalDatabase();
  const read = db.transaction(STORES.financeReceipts, 'readonly');
  const current = await requestResult<LocalReceipt | undefined>(read.objectStore(STORES.financeReceipts).get(receiptId));
  if (!current || current.workspaceId !== workspaceId) throw new Error('RECEIPT_NOT_FOUND');
  if (current.deletedAt) throw new Error('RECEIPT_DELETED');

  const updated: LocalReceipt = {
    ...current,
    payerRefType: 'tutoring.student',
    payerRefId: input.studentId,
    amountPence: input.amountPence,
    receivedAt: input.receivedAt,
    paymentMethod: input.paymentMethod,
    note: normaliseNote(input.note),
    pendingSync: true,
  };
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'finance',
    entityType: 'receipt',
    entityId: receiptId,
    action: 'receipt.updated',
    title: 'تم تعديل تحصيل',
    before: current,
    after: updated,
    undoable: true,
  });

  const transaction = db.transaction(
    [STORES.financeReceipts, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeReceipts).put(updated);
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'finance',
    operation: 'receipt.update',
    entityType: 'receipt',
    entityId: receiptId,
    payload: input,
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);

  await rebuildLocalStudentAllocations(workspaceId, current.payerRefId);
  if (input.studentId !== current.payerRefId) await rebuildLocalStudentAllocations(workspaceId, input.studentId);
}

export async function deleteLocalReceipt(workspaceId: string, receiptId: string): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction(STORES.financeReceipts, 'readonly');
  const current = await requestResult<LocalReceipt | undefined>(read.objectStore(STORES.financeReceipts).get(receiptId));
  if (!current || current.workspaceId !== workspaceId) throw new Error('RECEIPT_NOT_FOUND');
  if (current.deletedAt) return;
  const deletedAt = new Date().toISOString();
  const updated = { ...current, deletedAt, pendingSync: true } satisfies LocalReceipt;
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'finance',
    entityType: 'receipt',
    entityId: receiptId,
    action: 'receipt.deleted',
    title: 'تم حذف تحصيل',
    detail: 'يمكن استرجاع العملية من السجل.',
    before: current,
    after: updated,
    undoable: true,
  });
  const transaction = db.transaction(
    [STORES.financeReceipts, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeReceipts).put(updated);
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'finance',
    operation: 'receipt.delete',
    entityType: 'receipt',
    entityId: receiptId,
    payload: { deletedAt },
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
  await rebuildLocalStudentAllocations(workspaceId, current.payerRefId);
}

export async function restoreLocalReceipt(workspaceId: string, receiptId: string): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction(STORES.financeReceipts, 'readonly');
  const current = await requestResult<LocalReceipt | undefined>(read.objectStore(STORES.financeReceipts).get(receiptId));
  if (!current || current.workspaceId !== workspaceId) throw new Error('RECEIPT_NOT_FOUND');
  if (!current.deletedAt) return;
  const updated = { ...current, deletedAt: null, pendingSync: true } satisfies LocalReceipt;
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'finance',
    entityType: 'receipt',
    entityId: receiptId,
    action: 'receipt.restored',
    title: 'تم استرجاع تحصيل',
    before: current,
    after: updated,
  });
  const transaction = db.transaction(
    [STORES.financeReceipts, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeReceipts).put(updated);
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'finance',
    operation: 'receipt.restore',
    entityType: 'receipt',
    entityId: receiptId,
    payload: {},
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
  await rebuildLocalStudentAllocations(workspaceId, current.payerRefId);
}

export async function updateLocalExpense(
  workspaceId: string,
  expenseId: string,
  input: ExpenseCorrectionInput,
): Promise<void> {
  assertAmount(input.amountPence);
  const category = input.category.trim();
  if (!category) throw new Error('EXPENSE_CATEGORY_REQUIRED');
  const db = await openLocalDatabase();
  const read = db.transaction(STORES.financeExpenses, 'readonly');
  const current = await requestResult<LocalExpense | undefined>(read.objectStore(STORES.financeExpenses).get(expenseId));
  if (!current || current.workspaceId !== workspaceId) throw new Error('EXPENSE_NOT_FOUND');
  if (current.deletedAt) throw new Error('EXPENSE_DELETED');
  const updated: LocalExpense = {
    ...current,
    expenseDate: input.expenseDate,
    scope: input.scope,
    category,
    amountPence: input.amountPence,
    note: normaliseNote(input.note),
  };
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'finance',
    entityType: 'expense',
    entityId: expenseId,
    action: 'expense.updated',
    title: 'تم تعديل مصروف',
    before: current,
    after: updated,
    undoable: true,
  });
  const transaction = db.transaction(
    [STORES.financeExpenses, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeExpenses).put(updated);
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'finance',
    operation: 'expense.update',
    entityType: 'expense',
    entityId: expenseId,
    payload: { ...input, category, note: updated.note },
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
}

export async function deleteLocalExpense(workspaceId: string, expenseId: string): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction(STORES.financeExpenses, 'readonly');
  const current = await requestResult<LocalExpense | undefined>(read.objectStore(STORES.financeExpenses).get(expenseId));
  if (!current || current.workspaceId !== workspaceId) throw new Error('EXPENSE_NOT_FOUND');
  if (current.deletedAt) return;
  const deletedAt = new Date().toISOString();
  const updated = { ...current, deletedAt } satisfies LocalExpense;
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'finance',
    entityType: 'expense',
    entityId: expenseId,
    action: 'expense.deleted',
    title: 'تم حذف مصروف',
    detail: 'يمكن استرجاع العملية من السجل.',
    before: current,
    after: updated,
    undoable: true,
  });
  const transaction = db.transaction(
    [STORES.financeExpenses, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeExpenses).put(updated);
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'finance',
    operation: 'expense.delete',
    entityType: 'expense',
    entityId: expenseId,
    payload: { deletedAt },
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
}

export async function restoreLocalExpense(workspaceId: string, expenseId: string): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction(STORES.financeExpenses, 'readonly');
  const current = await requestResult<LocalExpense | undefined>(read.objectStore(STORES.financeExpenses).get(expenseId));
  if (!current || current.workspaceId !== workspaceId) throw new Error('EXPENSE_NOT_FOUND');
  if (!current.deletedAt) return;
  const updated = { ...current, deletedAt: null } satisfies LocalExpense;
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'finance',
    entityType: 'expense',
    entityId: expenseId,
    action: 'expense.restored',
    title: 'تم استرجاع مصروف',
    before: current,
    after: updated,
  });
  const transaction = db.transaction(
    [STORES.financeExpenses, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeExpenses).put(updated);
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'finance',
    operation: 'expense.restore',
    entityType: 'expense',
    entityId: expenseId,
    payload: {},
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
}

export async function rebuildLocalStudentAllocations(workspaceId: string, studentId: string): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction([
    STORES.financeReceipts,
    STORES.financeAllocations,
    STORES.tutoringBillingCycles,
    STORES.tutoringBillingPlans,
    STORES.tutoringOccurrences,
    STORES.tutoringSessions,
  ], 'readonly');
  const [allReceipts, allAllocations, cycles, plans, occurrences, sessions] = await Promise.all([
    requestResult<LocalReceipt[]>(read.objectStore(STORES.financeReceipts).getAll()),
    requestResult<LocalAllocation[]>(read.objectStore(STORES.financeAllocations).getAll()),
    requestResult<LocalBillingCycle[]>(read.objectStore(STORES.tutoringBillingCycles).getAll()),
    requestResult<LocalBillingPlan[]>(read.objectStore(STORES.tutoringBillingPlans).getAll()),
    requestResult<LocalOccurrence[]>(read.objectStore(STORES.tutoringOccurrences).getAll()),
    requestResult<RecurringSession[]>(read.objectStore(STORES.tutoringSessions).getAll()),
  ]);

  const receiptsForStudent = allReceipts.filter((row) => row.workspaceId === workspaceId && row.payerRefId === studentId);
  const receiptIds = new Set(receiptsForStudent.map((row) => row.id));
  const activeReceipts = receiptsForStudent
    .filter((row) => !row.deletedAt)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
  const plan = plans.find((row) => row.workspaceId === workspaceId && row.studentId === studentId) ?? null;

  const obligations: Array<{ targetType: 'package_cycle' | 'occurrence'; targetId: string; dueAt: string; amountPence: number }> = [];
  for (const cycle of cycles.filter((row) => row.workspaceId === workspaceId && row.studentId === studentId && row.status === 'due')) {
    obligations.push({
      targetType: 'package_cycle',
      targetId: cycle.id,
      dueAt: cycle.completedOn ?? cycle.startedOn ?? '9999-12-31',
      amountPence: cycle.pricePence,
    });
  }
  if (!plan || plan.billingMode === 'per_session') {
    for (const occurrence of occurrences.filter((row) => row.workspaceId === workspaceId && row.status === 'completed')) {
      const session = sessions.find((row) => row.id === occurrence.recurringSessionId && row.workspaceId === workspaceId);
      if (!session || !session.studentIds.includes(studentId)) continue;
      if (session.priceBasis !== 'per_student' && session.expectedStudentCount !== 1) continue;
      const amountPence = session.priceBasis === 'per_student' ? session.defaultPricePence : occurrence.grossPence;
      if (amountPence <= 0) continue;
      obligations.push({
        targetType: 'occurrence',
        targetId: occurrence.id,
        dueAt: occurrence.completedAt ?? occurrence.sessionDate,
        amountPence,
      });
    }
  }
  obligations.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.targetId.localeCompare(b.targetId));

  const generated: LocalAllocation[] = [];
  const allocatedByTarget = new Map<string, number>();
  for (const receipt of activeReceipts) {
    let left = receipt.amountPence;
    for (const obligation of obligations) {
      if (left <= 0) break;
      const key = `${obligation.targetType}:${obligation.targetId}`;
      const already = allocatedByTarget.get(key) ?? 0;
      const outstanding = Math.max(0, obligation.amountPence - already);
      if (!outstanding) continue;
      const amountPence = Math.min(left, outstanding);
      generated.push({
        id: crypto.randomUUID(),
        workspaceId,
        receiptId: receipt.id,
        targetModule: 'tutoring',
        targetType: obligation.targetType,
        targetId: obligation.targetId,
        amountPence,
      });
      allocatedByTarget.set(key, already + amountPence);
      left -= amountPence;
    }
  }

  const write = db.transaction(STORES.financeAllocations, 'readwrite');
  const store = write.objectStore(STORES.financeAllocations);
  for (const allocation of allAllocations) {
    if (allocation.workspaceId === workspaceId && receiptIds.has(allocation.receiptId)) store.delete(allocation.id);
  }
  for (const allocation of generated) store.put(allocation);
  await transactionDone(write);
}

import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import type { LocalAllocation, LocalExpense } from '../simple/data';
import { newSyncOutboxRecord } from '../sync/outbox';
import type { LocalReceipt } from '../tutoring/local-commands';
import { rebuildStudentLocally } from './local-rebalance';

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

async function receiptById(workspaceId: string, receiptId: string): Promise<LocalReceipt> {
  const db = await openLocalDatabase();
  const receipt = await requestResult<LocalReceipt | undefined>(
    db.transaction(STORES.financeReceipts, 'readonly').objectStore(STORES.financeReceipts).get(receiptId),
  );
  if (!receipt || receipt.workspaceId !== workspaceId) throw new Error('RECEIPT_NOT_FOUND');
  return receipt;
}

export async function updateLocalReceipt(
  workspaceId: string,
  receiptId: string,
  input: ReceiptCorrectionInput,
): Promise<void> {
  assertAmount(input.amountPence);
  const current = await receiptById(workspaceId, receiptId);
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

  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [STORES.financeReceipts, STORES.financeAllocations, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeReceipts).put(updated);
  const allocationStore = transaction.objectStore(STORES.financeAllocations);
  const rows = await requestResult<LocalAllocation[]>(allocationStore.getAll());
  for (const row of rows) {
    if (row.workspaceId === workspaceId && row.receiptId === receiptId) allocationStore.delete(row.id);
  }
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'finance',
    operation: 'receipt.update',
    entityType: 'receipt',
    entityId: receiptId,
    payload: {
      studentId: updated.payerRefId,
      amountPence: updated.amountPence,
      receivedAt: updated.receivedAt,
      paymentMethod: updated.paymentMethod,
      note: updated.note,
    },
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);

  await rebuildStudentLocally(workspaceId, current.payerRefId);
  if (updated.payerRefId !== current.payerRefId) {
    await rebuildStudentLocally(workspaceId, updated.payerRefId);
  }
}

export async function deleteLocalReceipt(workspaceId: string, receiptId: string): Promise<void> {
  const current = await receiptById(workspaceId, receiptId);
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
  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [STORES.financeReceipts, STORES.financeAllocations, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeReceipts).put(updated);
  const allocationStore = transaction.objectStore(STORES.financeAllocations);
  const allocationRows = await requestResult<LocalAllocation[]>(allocationStore.getAll());
  for (const row of allocationRows) {
    if (row.workspaceId === workspaceId && row.receiptId === receiptId) allocationStore.delete(row.id);
  }
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
  await rebuildStudentLocally(workspaceId, current.payerRefId);
}

export async function restoreLocalReceipt(workspaceId: string, receiptId: string): Promise<void> {
  const current = await receiptById(workspaceId, receiptId);
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
  const db = await openLocalDatabase();
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
  await rebuildStudentLocally(workspaceId, current.payerRefId);
}

async function expenseById(workspaceId: string, expenseId: string): Promise<LocalExpense> {
  const db = await openLocalDatabase();
  const expense = await requestResult<LocalExpense | undefined>(
    db.transaction(STORES.financeExpenses, 'readonly').objectStore(STORES.financeExpenses).get(expenseId),
  );
  if (!expense || expense.workspaceId !== workspaceId) throw new Error('EXPENSE_NOT_FOUND');
  return expense;
}

export async function updateLocalExpense(
  workspaceId: string,
  expenseId: string,
  input: ExpenseCorrectionInput,
): Promise<void> {
  assertAmount(input.amountPence);
  const category = input.category.trim();
  if (!category) throw new Error('EXPENSE_CATEGORY_REQUIRED');
  const current = await expenseById(workspaceId, expenseId);
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
  const db = await openLocalDatabase();
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
    payload: {
      expenseDate: updated.expenseDate,
      scope: updated.scope,
      category: updated.category,
      amountPence: updated.amountPence,
      note: updated.note,
    },
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
}

export async function deleteLocalExpense(workspaceId: string, expenseId: string): Promise<void> {
  const current = await expenseById(workspaceId, expenseId);
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
  const db = await openLocalDatabase();
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
  const current = await expenseById(workspaceId, expenseId);
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
  const db = await openLocalDatabase();
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
  await rebuildStudentLocally(workspaceId, studentId);
}

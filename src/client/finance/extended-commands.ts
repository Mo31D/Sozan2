import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import type { LocalCashCheck, LocalOtherIncome } from '../simple/data';
import { newSyncOutboxRecord } from '../sync/outbox';

function assertAmount(value: number, allowNegative = false): void {
  if (!Number.isSafeInteger(value) || (!allowNegative && value <= 0)) throw new Error('AMOUNT_INVALID');
}

function note(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

async function incomeById(workspaceId: string, id: string): Promise<LocalOtherIncome> {
  const db = await openLocalDatabase();
  const row = await requestResult<LocalOtherIncome | undefined>(
    db.transaction(STORES.financeOtherIncome, 'readonly').objectStore(STORES.financeOtherIncome).get(id),
  );
  if (!row || row.workspaceId !== workspaceId) throw new Error('INCOME_NOT_FOUND');
  return row;
}

export async function addLocalOtherIncome(input: {
  workspaceId: string;
  incomeDate: string;
  category: string;
  amountPence: number;
  note?: string | null;
}): Promise<LocalOtherIncome> {
  assertAmount(input.amountPence);
  const category = input.category.trim();
  if (!category) throw new Error('INCOME_CATEGORY_REQUIRED');
  const row: LocalOtherIncome = {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    incomeDate: input.incomeDate,
    category,
    amountPence: input.amountPence,
    note: note(input.note),
    deletedAt: null,
  };
  const activity = makeActivityEvent({
    workspaceId: input.workspaceId,
    moduleKey: 'finance',
    entityType: 'other_income',
    entityId: row.id,
    action: 'income.created',
    title: `تم تسجيل دخل آخر · ${category}`,
    after: row,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.financeOtherIncome, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.financeOtherIncome).add(row);
  tx.objectStore(STORES.coreActivityEvents).add(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId: input.workspaceId,
    moduleKey: 'finance',
    operation: 'income.create',
    entityType: 'other_income',
    entityId: row.id,
    payload: { incomeDate: row.incomeDate, category: row.category, amountPence: row.amountPence, note: row.note },
  }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
  return row;
}

export async function updateLocalOtherIncome(workspaceId: string, id: string, input: {
  incomeDate: string;
  category: string;
  amountPence: number;
  note?: string | null;
}): Promise<void> {
  assertAmount(input.amountPence);
  const current = await incomeById(workspaceId, id);
  if (current.deletedAt) throw new Error('INCOME_DELETED');
  const category = input.category.trim();
  if (!category) throw new Error('INCOME_CATEGORY_REQUIRED');
  const updated: LocalOtherIncome = { ...current, incomeDate: input.incomeDate, category, amountPence: input.amountPence, note: note(input.note) };
  const activity = makeActivityEvent({
    workspaceId, moduleKey: 'finance', entityType: 'other_income', entityId: id,
    action: 'income.updated', title: 'تم تعديل دخل آخر', before: current, after: updated, undoable: true,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.financeOtherIncome, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.financeOtherIncome).put(updated);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId, moduleKey: 'finance', operation: 'income.update', entityType: 'other_income', entityId: id,
    payload: { incomeDate: updated.incomeDate, category: updated.category, amountPence: updated.amountPence, note: updated.note },
  }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

export async function deleteLocalOtherIncome(workspaceId: string, id: string): Promise<void> {
  const current = await incomeById(workspaceId, id);
  if (current.deletedAt) return;
  const updated: LocalOtherIncome = { ...current, deletedAt: new Date().toISOString() };
  const activity = makeActivityEvent({
    workspaceId, moduleKey: 'finance', entityType: 'other_income', entityId: id,
    action: 'income.deleted', title: 'تم حذف دخل آخر', before: current, after: updated, undoable: true,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.financeOtherIncome, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.financeOtherIncome).put(updated);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({ workspaceId, moduleKey: 'finance', operation: 'income.delete', entityType: 'other_income', entityId: id, payload: { deletedAt: updated.deletedAt } }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

export async function restoreLocalOtherIncome(workspaceId: string, id: string): Promise<void> {
  const current = await incomeById(workspaceId, id);
  if (!current.deletedAt) return;
  const updated: LocalOtherIncome = { ...current, deletedAt: null };
  const activity = makeActivityEvent({
    workspaceId, moduleKey: 'finance', entityType: 'other_income', entityId: id,
    action: 'income.restored', title: 'تم استرجاع دخل آخر', before: current, after: updated,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.financeOtherIncome, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.financeOtherIncome).put(updated);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({ workspaceId, moduleKey: 'finance', operation: 'income.restore', entityType: 'other_income', entityId: id, payload: {} }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

async function cashById(workspaceId: string, id: string): Promise<LocalCashCheck> {
  const db = await openLocalDatabase();
  const row = await requestResult<LocalCashCheck | undefined>(
    db.transaction(STORES.financeCashChecks, 'readonly').objectStore(STORES.financeCashChecks).get(id),
  );
  if (!row || row.workspaceId !== workspaceId) throw new Error('CASH_CHECK_NOT_FOUND');
  return row;
}

export async function addLocalCashCheck(input: {
  workspaceId: string;
  checkDate: string;
  expectedBalancePence: number;
  actualBalancePence: number;
  note?: string | null;
}): Promise<LocalCashCheck> {
  assertAmount(input.expectedBalancePence, true);
  assertAmount(input.actualBalancePence, true);
  const row: LocalCashCheck = {
    id: crypto.randomUUID(), workspaceId: input.workspaceId, checkDate: input.checkDate,
    expectedBalancePence: input.expectedBalancePence, actualBalancePence: input.actualBalancePence,
    differencePence: input.actualBalancePence - input.expectedBalancePence,
    note: note(input.note), deletedAt: null,
  };
  const activity = makeActivityEvent({
    workspaceId: input.workspaceId, moduleKey: 'finance', entityType: 'cash_check', entityId: row.id,
    action: 'cash.created', title: 'تمت مطابقة الرصيد', detail: `الفرق ${row.differencePence / 100}`, after: row,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.financeCashChecks, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.financeCashChecks).add(row);
  tx.objectStore(STORES.coreActivityEvents).add(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId: input.workspaceId, moduleKey: 'finance', operation: 'cash.create', entityType: 'cash_check', entityId: row.id,
    payload: { checkDate: row.checkDate, expectedBalancePence: row.expectedBalancePence, actualBalancePence: row.actualBalancePence, differencePence: row.differencePence, note: row.note },
  }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
  return row;
}

export async function updateLocalCashCheck(workspaceId: string, id: string, input: {
  checkDate: string;
  expectedBalancePence: number;
  actualBalancePence: number;
  note?: string | null;
}): Promise<void> {
  assertAmount(input.expectedBalancePence, true);
  assertAmount(input.actualBalancePence, true);
  const current = await cashById(workspaceId, id);
  if (current.deletedAt) throw new Error('CASH_CHECK_DELETED');
  const updated: LocalCashCheck = {
    ...current, checkDate: input.checkDate, expectedBalancePence: input.expectedBalancePence,
    actualBalancePence: input.actualBalancePence, differencePence: input.actualBalancePence - input.expectedBalancePence,
    note: note(input.note),
  };
  const activity = makeActivityEvent({
    workspaceId, moduleKey: 'finance', entityType: 'cash_check', entityId: id,
    action: 'cash.updated', title: 'تم تعديل مطابقة الرصيد', before: current, after: updated, undoable: true,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.financeCashChecks, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.financeCashChecks).put(updated);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId, moduleKey: 'finance', operation: 'cash.update', entityType: 'cash_check', entityId: id,
    payload: { checkDate: updated.checkDate, expectedBalancePence: updated.expectedBalancePence, actualBalancePence: updated.actualBalancePence, differencePence: updated.differencePence, note: updated.note },
  }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

export async function deleteLocalCashCheck(workspaceId: string, id: string): Promise<void> {
  const current = await cashById(workspaceId, id);
  if (current.deletedAt) return;
  const updated: LocalCashCheck = { ...current, deletedAt: new Date().toISOString() };
  const activity = makeActivityEvent({
    workspaceId, moduleKey: 'finance', entityType: 'cash_check', entityId: id,
    action: 'cash.deleted', title: 'تم حذف مطابقة رصيد', before: current, after: updated, undoable: true,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.financeCashChecks, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.financeCashChecks).put(updated);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({ workspaceId, moduleKey: 'finance', operation: 'cash.delete', entityType: 'cash_check', entityId: id, payload: { deletedAt: updated.deletedAt } }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

export async function restoreLocalCashCheck(workspaceId: string, id: string): Promise<void> {
  const current = await cashById(workspaceId, id);
  if (!current.deletedAt) return;
  const updated: LocalCashCheck = { ...current, deletedAt: null };
  const activity = makeActivityEvent({
    workspaceId, moduleKey: 'finance', entityType: 'cash_check', entityId: id,
    action: 'cash.restored', title: 'تم استرجاع مطابقة الرصيد', before: current, after: updated,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.financeCashChecks, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.financeCashChecks).put(updated);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({ workspaceId, moduleKey: 'finance', operation: 'cash.restore', entityType: 'cash_check', entityId: id, payload: {} }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

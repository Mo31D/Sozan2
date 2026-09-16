import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, STORES, transactionDone } from '../adapters/indexeddb/database';
import { newSyncOutboxRecord } from '../sync/outbox';
import type { LocalExpense } from '../simple/data';

export async function addLocalExpense(input: {
  workspaceId: string;
  expenseDate: string;
  scope: 'business' | 'personal';
  category: string;
  amountPence: number;
  note?: string | null;
}): Promise<LocalExpense> {
  if (!Number.isSafeInteger(input.amountPence) || input.amountPence <= 0) {
    throw new Error('EXPENSE_AMOUNT_INVALID');
  }
  const category = input.category.trim();
  if (!category) throw new Error('EXPENSE_CATEGORY_REQUIRED');
  const expense: LocalExpense = {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    expenseDate: input.expenseDate,
    scope: input.scope,
    category,
    amountPence: input.amountPence,
    note: input.note?.trim() || null,
    deletedAt: null,
  };
  const activity = makeActivityEvent({
    workspaceId: input.workspaceId,
    moduleKey: 'finance',
    entityType: 'expense',
    entityId: expense.id,
    action: 'expense.created',
    title: `تم تسجيل مصروف · ${category}`,
    after: expense,
  });

  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [STORES.financeExpenses, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeExpenses).add(expense);
  transaction.objectStore(STORES.coreActivityEvents).add(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId: input.workspaceId,
    moduleKey: 'finance',
    operation: 'expense.create',
    entityType: 'expense',
    entityId: expense.id,
    payload: {
      expenseDate: expense.expenseDate,
      scope: expense.scope,
      category: expense.category,
      amountPence: expense.amountPence,
      note: expense.note,
    },
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
  return expense;
}

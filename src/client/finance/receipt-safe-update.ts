import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import type { LocalAllocation } from '../simple/data';
import type { LocalReceipt } from '../tutoring/local-commands';
import { type ReceiptCorrectionInput, updateLocalReceipt } from './corrections';

export async function updateLocalReceiptSafely(
  workspaceId: string,
  receiptId: string,
  input: ReceiptCorrectionInput,
): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction(STORES.financeReceipts, 'readonly');
  const current = await requestResult<LocalReceipt | undefined>(read.objectStore(STORES.financeReceipts).get(receiptId));
  if (!current || current.workspaceId !== workspaceId) throw new Error('RECEIPT_NOT_FOUND');

  if (current.payerRefId !== input.studentId) {
    const transaction = db.transaction(STORES.financeAllocations, 'readwrite');
    const store = transaction.objectStore(STORES.financeAllocations);
    const rows = await requestResult<LocalAllocation[]>(store.getAll());
    for (const row of rows) {
      if (row.workspaceId === workspaceId && row.receiptId === receiptId) store.delete(row.id);
    }
    await transactionDone(transaction);
  }

  await updateLocalReceipt(workspaceId, receiptId, input);
}

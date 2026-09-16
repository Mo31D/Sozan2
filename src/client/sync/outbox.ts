import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';

export type SyncOutboxRecord = {
  id: string;
  workspaceId: string;
  moduleKey: string;
  operation: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: string;
  status: 'pending' | 'syncing' | 'failed';
  attempts: number;
  lastError: string | null;
};

export async function enqueueSyncMutation(input: Omit<SyncOutboxRecord, 'id' | 'createdAt' | 'status' | 'attempts' | 'lastError'>): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.syncOutbox, 'readwrite');
  transaction.objectStore(STORES.syncOutbox).add({
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    lastError: null,
  } satisfies SyncOutboxRecord);
  await transactionDone(transaction);
}

export async function listPendingSyncMutations(workspaceId: string): Promise<SyncOutboxRecord[]> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.syncOutbox, 'readonly');
  const rows = await requestResult<SyncOutboxRecord[]>(
    transaction.objectStore(STORES.syncOutbox).getAll(),
  );
  return rows
    .filter((row) => row.workspaceId === workspaceId && (row.status === 'pending' || row.status === 'failed'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeSyncMutation(id: string): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.syncOutbox, 'readwrite');
  transaction.objectStore(STORES.syncOutbox).delete(id);
  await transactionDone(transaction);
}

export async function failSyncMutation(id: string, message: string): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.syncOutbox, 'readwrite');
  const store = transaction.objectStore(STORES.syncOutbox);
  const row = await requestResult<SyncOutboxRecord | undefined>(store.get(id));
  if (row) {
    store.put({
      ...row,
      status: 'failed',
      attempts: row.attempts + 1,
      lastError: message.slice(0, 500),
    } satisfies SyncOutboxRecord);
  }
  await transactionDone(transaction);
}

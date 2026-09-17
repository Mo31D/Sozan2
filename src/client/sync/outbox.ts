import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';

export type SyncOutboxStatus = 'pending' | 'syncing' | 'failed' | 'dead_letter';

export type SyncOutboxRecord = {
  id: string;
  workspaceId: string;
  moduleKey: string;
  operation: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: string;
  status: SyncOutboxStatus;
  attempts: number;
  lastError: string | null;
};

export type NewSyncMutation = Omit<
  SyncOutboxRecord,
  'id' | 'createdAt' | 'status' | 'attempts' | 'lastError'
>;

export function newSyncOutboxRecord(input: NewSyncMutation): SyncOutboxRecord {
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    lastError: null,
  };
}

export async function enqueueSyncMutation(input: NewSyncMutation): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.syncOutbox, 'readwrite');
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord(input));
  await transactionDone(transaction);
}

async function listWorkspaceSyncMutations(workspaceId: string): Promise<SyncOutboxRecord[]> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.syncOutbox, 'readonly');
  const rows = await requestResult<SyncOutboxRecord[]>(
    transaction.objectStore(STORES.syncOutbox).getAll(),
  );
  return rows
    .filter((row) => row.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Mutations that still have to reach the server before a snapshot may overwrite local state. */
export async function listPendingSyncMutations(workspaceId: string): Promise<SyncOutboxRecord[]> {
  const rows = await listWorkspaceSyncMutations(workspaceId);
  return rows.filter((row) => row.status === 'pending' || row.status === 'failed');
}

/** Terminal conflicts are retained for audit but deliberately do not block cloud pulls. */
export async function listDeadLetterSyncMutations(workspaceId: string): Promise<SyncOutboxRecord[]> {
  const rows = await listWorkspaceSyncMutations(workspaceId);
  return rows.filter((row) => row.status === 'dead_letter');
}

export async function pendingSyncCount(workspaceId: string): Promise<number> {
  return (await listPendingSyncMutations(workspaceId)).length;
}

export async function removeSyncMutation(id: string): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.syncOutbox, 'readwrite');
  transaction.objectStore(STORES.syncOutbox).delete(id);
  await transactionDone(transaction);
}

async function updateFailureState(
  id: string,
  status: Extract<SyncOutboxStatus, 'failed' | 'dead_letter'>,
  message: string,
): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.syncOutbox, 'readwrite');
  const store = transaction.objectStore(STORES.syncOutbox);
  const row = await requestResult<SyncOutboxRecord | undefined>(store.get(id));
  if (row) {
    store.put({
      ...row,
      status,
      attempts: row.attempts + 1,
      lastError: message.slice(0, 500),
    } satisfies SyncOutboxRecord);
  }
  await transactionDone(transaction);
}

export async function failSyncMutation(id: string, message: string): Promise<void> {
  await updateFailureState(id, 'failed', message);
}

export async function deadLetterSyncMutation(id: string, message: string): Promise<void> {
  await updateFailureState(id, 'dead_letter', message);
}

import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { newSyncOutboxRecord, type SyncOutboxRecord } from '../sync/outbox';

export type LocalActivityEvent = {
  id: string;
  workspaceId: string;
  moduleKey: string;
  entityType: string;
  entityId: string | null;
  action: string;
  title: string;
  detail: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  undoable: boolean;
  undoneAt: string | null;
  createdAt: string;
};

export type NewActivityEvent = {
  workspaceId: string;
  moduleKey: string;
  entityType: string;
  entityId?: string | null;
  action: string;
  title: string;
  detail?: string | null;
  before?: unknown;
  after?: unknown;
  undoable?: boolean;
};

function serialise(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export function makeActivityEvent(input: NewActivityEvent): LocalActivityEvent {
  return {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    moduleKey: input.moduleKey,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    title: input.title,
    detail: input.detail?.trim() || null,
    beforeJson: serialise(input.before),
    afterJson: serialise(input.after),
    undoable: input.undoable ?? false,
    undoneAt: null,
    createdAt: new Date().toISOString(),
  };
}

export function activitySyncMutation(event: LocalActivityEvent): SyncOutboxRecord {
  return newSyncOutboxRecord({
    workspaceId: event.workspaceId,
    moduleKey: 'core',
    operation: 'activity.record',
    entityType: 'activity_event',
    entityId: event.id,
    payload: event,
  });
}

export async function listLocalActivity(workspaceId: string, limit = 200): Promise<LocalActivityEvent[]> {
  const db = await openLocalDatabase();
  const rows = await requestResult<LocalActivityEvent[]>(
    db.transaction(STORES.coreActivityEvents, 'readonly').objectStore(STORES.coreActivityEvents).getAll(),
  );
  return rows
    .filter((row) => row.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, limit));
}

export async function markActivityUndone(eventId: string, workspaceId: string): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction([STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  const store = transaction.objectStore(STORES.coreActivityEvents);
  const event = await requestResult<LocalActivityEvent | undefined>(store.get(eventId));
  if (!event || event.workspaceId !== workspaceId) throw new Error('ACTIVITY_NOT_FOUND');
  if (event.undoneAt) {
    await transactionDone(transaction);
    return;
  }
  const undoneAt = new Date().toISOString();
  store.put({ ...event, undoneAt, undoable: false } satisfies LocalActivityEvent);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'core',
    operation: 'activity.undo',
    entityType: 'activity_event',
    entityId: eventId,
    payload: { undoneAt },
  }));
  await transactionDone(transaction);
}

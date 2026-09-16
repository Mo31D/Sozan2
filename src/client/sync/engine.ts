import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import type { LocalCloudLinkRecord } from '../adapters/indexeddb/platform.repository';
import {
  failSyncMutation,
  listPendingSyncMutations,
  newSyncOutboxRecord,
  removeSyncMutation,
  type SyncOutboxRecord,
} from './outbox';

export type SyncRunResult = {
  pushed: number;
  pulled: boolean;
  pending: number;
  failed: number;
  syncedAt: string | null;
};

type PushResponse = {
  results: Array<{
    mutationId: string;
    status: 'applied' | 'duplicate' | 'failed';
    error?: string;
  }>;
  serverTime: string;
};

type ModuleSnapshot = {
  moduleKey: string;
  data: unknown;
};

type SnapshotResponse = {
  workspaceId: string;
  generatedAt: string;
  modules: ModuleSnapshot[];
};

type CoreSnapshot = {
  activityEvents: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
};

type TutoringSnapshot = {
  students: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
  sessions: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
  occurrences: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
  billingPlans: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
  billingCycles: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
  billingCycleOccurrences?: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
};

type FinanceSnapshot = {
  receipts: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
  allocations: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
  expenses: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
  otherIncome: Array<Record<string, unknown> & { id: string; workspaceId: string }>;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `SYNC_HTTP_${response.status}`);
  return body;
}

async function updateCloudLink(
  workspaceId: string,
  update: Partial<Pick<LocalCloudLinkRecord, 'lastCloudPullAt' | 'lastCloudPushAt'>>,
): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.coreCloudLinks, 'readwrite');
  const store = transaction.objectStore(STORES.coreCloudLinks);
  const current = await requestResult<LocalCloudLinkRecord | undefined>(store.get(workspaceId));
  if (current) store.put({ ...current, ...update });
  await transactionDone(transaction);
}

async function seedInitialLocalState(workspaceId: string): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction(
    [STORES.tutoringStudents, STORES.tutoringSessions, STORES.syncOutbox],
    'readonly',
  );
  const [students, sessions, existing] = await Promise.all([
    requestResult<Array<Record<string, unknown> & { id: string; workspaceId: string }>>(
      read.objectStore(STORES.tutoringStudents).getAll(),
    ),
    requestResult<Array<Record<string, unknown> & { id: string; workspaceId: string }>>(
      read.objectStore(STORES.tutoringSessions).getAll(),
    ),
    requestResult<SyncOutboxRecord[]>(read.objectStore(STORES.syncOutbox).getAll()),
  ]);

  const queued = new Set(existing.map((row) => `${row.operation}:${row.entityId}`));
  const additions: SyncOutboxRecord[] = [];
  for (const student of students.filter((row) => row.workspaceId === workspaceId)) {
    const key = `student.create:${student.id}`;
    if (!queued.has(key)) {
      additions.push(newSyncOutboxRecord({
        workspaceId,
        moduleKey: 'tutoring',
        operation: 'student.create',
        entityType: 'student',
        entityId: student.id,
        payload: student,
      }));
    }
  }
  for (const session of sessions.filter((row) => row.workspaceId === workspaceId)) {
    const key = `session.create:${session.id}`;
    if (!queued.has(key)) {
      additions.push(newSyncOutboxRecord({
        workspaceId,
        moduleKey: 'tutoring',
        operation: 'session.create',
        entityType: 'session',
        entityId: session.id,
        payload: session,
      }));
    }
  }

  if (!additions.length) return;
  const write = db.transaction(STORES.syncOutbox, 'readwrite');
  const store = write.objectStore(STORES.syncOutbox);
  for (const item of additions) store.add(item);
  await transactionDone(write);
}

async function replaceWorkspaceRows(
  store: IDBObjectStore,
  workspaceId: string,
  rows: Array<Record<string, unknown> & { id: string; workspaceId: string }>,
): Promise<void> {
  const existing = await requestResult<Array<Record<string, unknown> & { id: string; workspaceId: string }>>(
    store.getAll(),
  );
  for (const row of existing) {
    if (row.workspaceId === workspaceId) store.delete(row.id);
  }
  for (const row of rows) store.put(row);
}

async function applySnapshot(snapshot: SnapshotResponse): Promise<void> {
  const core = snapshot.modules.find((item) => item.moduleKey === 'core')?.data as CoreSnapshot | undefined;
  const tutoring = snapshot.modules.find((item) => item.moduleKey === 'tutoring')?.data as TutoringSnapshot | undefined;
  const finance = snapshot.modules.find((item) => item.moduleKey === 'finance')?.data as FinanceSnapshot | undefined;
  const stores = [
    STORES.coreActivityEvents,
    STORES.tutoringStudents,
    STORES.tutoringSessions,
    STORES.tutoringOccurrences,
    STORES.tutoringBillingPlans,
    STORES.tutoringBillingCycles,
    STORES.tutoringBillingCycleOccurrences,
    STORES.financeReceipts,
    STORES.financeAllocations,
    STORES.financeExpenses,
    STORES.financeOtherIncome,
  ];
  const db = await openLocalDatabase();
  const transaction = db.transaction(stores, 'readwrite');

  if (core) {
    await replaceWorkspaceRows(transaction.objectStore(STORES.coreActivityEvents), snapshot.workspaceId, core.activityEvents);
  }
  if (tutoring) {
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringStudents), snapshot.workspaceId, tutoring.students);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringSessions), snapshot.workspaceId, tutoring.sessions);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringOccurrences), snapshot.workspaceId, tutoring.occurrences);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringBillingPlans), snapshot.workspaceId, tutoring.billingPlans);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringBillingCycles), snapshot.workspaceId, tutoring.billingCycles);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringBillingCycleOccurrences), snapshot.workspaceId, tutoring.billingCycleOccurrences ?? []);
  }
  if (finance) {
    await replaceWorkspaceRows(transaction.objectStore(STORES.financeReceipts), snapshot.workspaceId, finance.receipts);
    await replaceWorkspaceRows(transaction.objectStore(STORES.financeAllocations), snapshot.workspaceId, finance.allocations);
    await replaceWorkspaceRows(transaction.objectStore(STORES.financeExpenses), snapshot.workspaceId, finance.expenses);
    await replaceWorkspaceRows(transaction.objectStore(STORES.financeOtherIncome), snapshot.workspaceId, finance.otherIncome);
  }
  await transactionDone(transaction);
}

export async function runWorkspaceSync(
  workspaceId: string,
  options: { seedInitialState?: boolean } = {},
): Promise<SyncRunResult> {
  if (options.seedInitialState) await seedInitialLocalState(workspaceId);

  const pending = await listPendingSyncMutations(workspaceId);
  let pushed = 0;
  let failed = 0;

  if (pending.length) {
    const response = await requestJson<PushResponse>(`/api/sync/${encodeURIComponent(workspaceId)}/push`, {
      method: 'POST',
      body: JSON.stringify({ mutations: pending }),
    });
    for (const result of response.results) {
      if (result.status === 'applied' || result.status === 'duplicate') {
        await removeSyncMutation(result.mutationId);
        pushed += 1;
      } else {
        await failSyncMutation(result.mutationId, result.error ?? 'SYNC_MUTATION_FAILED');
        failed += 1;
      }
    }
    if (pushed) await updateCloudLink(workspaceId, { lastCloudPushAt: response.serverTime });
  }

  const remaining = await listPendingSyncMutations(workspaceId);
  if (remaining.length) {
    return {
      pushed,
      pulled: false,
      pending: remaining.length,
      failed: Math.max(failed, remaining.filter((row) => row.status === 'failed').length),
      syncedAt: null,
    };
  }

  const snapshot = await requestJson<SnapshotResponse>(
    `/api/sync/${encodeURIComponent(workspaceId)}/snapshot`,
  );
  await applySnapshot(snapshot);
  await updateCloudLink(workspaceId, { lastCloudPullAt: snapshot.generatedAt });

  return {
    pushed,
    pulled: true,
    pending: 0,
    failed: 0,
    syncedAt: snapshot.generatedAt,
  };
}

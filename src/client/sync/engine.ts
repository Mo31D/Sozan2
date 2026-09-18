import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import type { LocalCloudLinkRecord } from '../adapters/indexeddb/platform.repository';
import {
  deadLetterSyncMutation,
  failSyncMutation,
  listDeadLetterSyncMutations,
  listPendingSyncMutations,
  removeSyncMutation,
} from './outbox';

export type SyncRunResult = {
  pushed: number;
  pulled: boolean;
  pending: number;
  failed: number;
  deadLetters: number;
  syncedAt: string | null;
};

type PushResponse = {
  results: Array<{
    mutationId: string;
    status: 'applied' | 'duplicate' | 'failed';
    error?: string;
    retryable?: boolean;
  }>;
  serverTime: string;
  revision: number;
};
type ModuleSnapshot = { moduleKey: string; data: unknown };
export type SnapshotResponse = { workspaceId: string; generatedAt: string; revision: number; modules: ModuleSnapshot[] };
type WorkspaceRow = Record<string, unknown> & { workspaceId: string };
type EntitySyncRow = WorkspaceRow & { id: string };
type CoreSnapshot = {
  activityEvents: EntitySyncRow[];
  workspaceSettings?: Array<WorkspaceRow & { key: string; value: string }>;
};
type TutoringSnapshot = {
  students: EntitySyncRow[];
  studentBaselines?: EntitySyncRow[];
  sessions: EntitySyncRow[];
  occurrences: EntitySyncRow[];
  billingPlans: EntitySyncRow[];
  billingCycles: EntitySyncRow[];
  billingCycleOccurrences?: EntitySyncRow[];
};
type AppointmentsSnapshot = { clients: EntitySyncRow[]; appointments: EntitySyncRow[] };
type FinanceSnapshot = {
  receipts: EntitySyncRow[];
  allocations: EntitySyncRow[];
  expenses: EntitySyncRow[];
  otherIncome: EntitySyncRow[];
  cashChecks?: EntitySyncRow[];
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `SYNC_HTTP_${response.status}`);
  return body;
}

async function updateCloudLink(
  workspaceId: string,
  update: Partial<Pick<LocalCloudLinkRecord, 'lastCloudPullAt' | 'lastCloudPushAt' | 'serverRevision'>>,
): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.coreCloudLinks, 'readwrite');
  const store = transaction.objectStore(STORES.coreCloudLinks);
  const current = await requestResult<LocalCloudLinkRecord | undefined>(store.get(workspaceId));
  if (current) store.put({ ...current, ...update });
  await transactionDone(transaction);
}

async function cloudRevision(workspaceId: string): Promise<number> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.coreCloudLinks, 'readonly');
  const row = await requestResult<LocalCloudLinkRecord | undefined>(
    transaction.objectStore(STORES.coreCloudLinks).get(workspaceId),
  );
  return Math.max(0, Number(row?.serverRevision ?? 0));
}

async function replaceWorkspaceRows(
  store: IDBObjectStore,
  workspaceId: string,
  rows: WorkspaceRow[],
): Promise<void> {
  const existing = await requestResult<WorkspaceRow[]>(store.getAll());
  for (const row of existing) {
    if (row.workspaceId !== workspaceId) continue;
    const key = store.keyPath;
    if (Array.isArray(key)) store.delete(key.map((part) => row[String(part)] as IDBValidKey));
    else if (typeof key === 'string') store.delete(row[key] as IDBValidKey);
  }
  for (const row of rows) store.put(row);
}

export async function applySnapshot(snapshot: SnapshotResponse): Promise<void> {
  const core = snapshot.modules.find((item) => item.moduleKey === 'core')?.data as CoreSnapshot | undefined;
  const tutoring = snapshot.modules.find((item) => item.moduleKey === 'tutoring')?.data as TutoringSnapshot | undefined;
  const appointments = snapshot.modules.find((item) => item.moduleKey === 'appointments')?.data as AppointmentsSnapshot | undefined;
  const finance = snapshot.modules.find((item) => item.moduleKey === 'finance')?.data as FinanceSnapshot | undefined;
  const stores = [
    STORES.coreActivityEvents,
    STORES.coreWorkspaceSettings,
    STORES.tutoringStudents,
    STORES.tutoringStudentBaselines,
    STORES.tutoringSessions,
    STORES.tutoringOccurrences,
    STORES.tutoringBillingPlans,
    STORES.tutoringBillingCycles,
    STORES.tutoringBillingCycleOccurrences,
    STORES.appointmentsClients,
    STORES.appointmentsItems,
    STORES.financeReceipts,
    STORES.financeAllocations,
    STORES.financeExpenses,
    STORES.financeOtherIncome,
    STORES.financeCashChecks,
  ];
  const db = await openLocalDatabase();
  const transaction = db.transaction(stores, 'readwrite');
  if (core) {
    await replaceWorkspaceRows(transaction.objectStore(STORES.coreActivityEvents), snapshot.workspaceId, core.activityEvents);
    await replaceWorkspaceRows(transaction.objectStore(STORES.coreWorkspaceSettings), snapshot.workspaceId, core.workspaceSettings ?? []);
  }
  if (tutoring) {
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringStudents), snapshot.workspaceId, tutoring.students);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringStudentBaselines), snapshot.workspaceId, tutoring.studentBaselines ?? []);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringSessions), snapshot.workspaceId, tutoring.sessions);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringOccurrences), snapshot.workspaceId, tutoring.occurrences);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringBillingPlans), snapshot.workspaceId, tutoring.billingPlans);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringBillingCycles), snapshot.workspaceId, tutoring.billingCycles);
    await replaceWorkspaceRows(transaction.objectStore(STORES.tutoringBillingCycleOccurrences), snapshot.workspaceId, tutoring.billingCycleOccurrences ?? []);
  }
  if (appointments) {
    await replaceWorkspaceRows(transaction.objectStore(STORES.appointmentsClients), snapshot.workspaceId, appointments.clients);
    await replaceWorkspaceRows(transaction.objectStore(STORES.appointmentsItems), snapshot.workspaceId, appointments.appointments);
  }
  if (finance) {
    await replaceWorkspaceRows(transaction.objectStore(STORES.financeReceipts), snapshot.workspaceId, finance.receipts);
    await replaceWorkspaceRows(transaction.objectStore(STORES.financeAllocations), snapshot.workspaceId, finance.allocations);
    await replaceWorkspaceRows(transaction.objectStore(STORES.financeExpenses), snapshot.workspaceId, finance.expenses);
    await replaceWorkspaceRows(transaction.objectStore(STORES.financeOtherIncome), snapshot.workspaceId, finance.otherIncome);
    await replaceWorkspaceRows(transaction.objectStore(STORES.financeCashChecks), snapshot.workspaceId, finance.cashChecks ?? []);
  }
  await transactionDone(transaction);
}

export async function runWorkspaceSync(
  workspaceId: string,
): Promise<SyncRunResult> {
  const pending = await listPendingSyncMutations(workspaceId);
  let pushed = 0;
  let failed = 0;
  if (pending.length) {
    const baseRevision = await cloudRevision(workspaceId);
    const response = await requestJson<PushResponse>(`/api/sync/${encodeURIComponent(workspaceId)}/push`, {
      method: 'POST',
      body: JSON.stringify({ baseRevision, mutations: pending }),
    });
    for (const result of response.results) {
      if (result.status === 'applied' || result.status === 'duplicate') {
        await removeSyncMutation(result.mutationId);
        pushed += 1;
      } else if (result.retryable === false) {
        await deadLetterSyncMutation(result.mutationId, result.error ?? 'SYNC_MUTATION_REJECTED');
      } else {
        await failSyncMutation(result.mutationId, result.error ?? 'SYNC_MUTATION_FAILED');
        failed += 1;
      }
    }
    await updateCloudLink(workspaceId, {
      serverRevision: response.revision,
      ...(pushed ? { lastCloudPushAt: response.serverTime } : {}),
    });
  }

  const remaining = await listPendingSyncMutations(workspaceId);
  const deadLetters = (await listDeadLetterSyncMutations(workspaceId)).length;
  if (remaining.length) {
    return {
      pushed,
      pulled: false,
      pending: remaining.length,
      failed: Math.max(failed, remaining.filter((row) => row.status === 'failed').length),
      deadLetters,
      syncedAt: null,
    };
  }

  const snapshot = await requestJson<SnapshotResponse>(`/api/sync/${encodeURIComponent(workspaceId)}/snapshot`);
  await applySnapshot(snapshot);
  await updateCloudLink(workspaceId, {
    lastCloudPullAt: snapshot.generatedAt,
    serverRevision: snapshot.revision,
  });
  return { pushed, pulled: true, pending: 0, failed: 0, deadLetters, syncedAt: snapshot.generatedAt };
}

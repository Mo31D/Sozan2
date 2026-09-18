import {
  assertBackupWorkspaceScope,
  FULL_BACKUP_SCHEMA_VERSION,
  workspaceBackupSchema,
  type WorkspaceBackup,
} from '../../modules/backup/workspace-backup';
import type { LocalPlatformSnapshot, LocalWorkspaceRecord } from '../adapters/indexeddb/platform.repository';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';

type Row = Record<string, any>;

const STORE_MAP = {
  coreWorkspaceModules: STORES.coreWorkspaceModules,
  coreWorkspaceLabels: STORES.coreWorkspaceLabels,
  coreWorkspaceSettings: STORES.coreWorkspaceSettings,
  coreSurfaceLayouts: STORES.coreSurfaceLayouts,
  coreActivityEvents: STORES.coreActivityEvents,
  tutoringStudents: STORES.tutoringStudents,
  tutoringStudentBaselines: STORES.tutoringStudentBaselines,
  tutoringSessions: STORES.tutoringSessions,
  tutoringOccurrences: STORES.tutoringOccurrences,
  tutoringBillingPlans: STORES.tutoringBillingPlans,
  tutoringBillingCycles: STORES.tutoringBillingCycles,
  tutoringBillingCycleOccurrences: STORES.tutoringBillingCycleOccurrences,
  appointmentsClients: STORES.appointmentsClients,
  appointmentsItems: STORES.appointmentsItems,
  financeReceipts: STORES.financeReceipts,
  financeAllocations: STORES.financeAllocations,
  financeExpenses: STORES.financeExpenses,
  financeOtherIncome: STORES.financeOtherIncome,
  financeCashChecks: STORES.financeCashChecks,
} as const;

async function workspaceRows(storeName: string, workspaceId: string): Promise<Row[]> {
  const db = await openLocalDatabase();
  const rows = await requestResult<Row[]>(
    db.transaction(storeName, 'readonly').objectStore(storeName).getAll(),
  );
  return rows.filter((row) => row.workspaceId === workspaceId);
}

function enrichLocalAttendance(stores: WorkspaceBackup['stores']): void {
  const sessions = new Map(
    stores.tutoringSessions.map((row) => [String(row.id), row as Row]),
  );
  stores.tutoringOccurrences = stores.tutoringOccurrences.map((raw) => {
    const row = raw as Row;
    if (Array.isArray(row.attendance)) return row;
    if (row.status !== 'completed') return { ...row, attendance: [] };
    const session = sessions.get(String(row.recurringSessionId));
    const linked = Array.isArray(session?.studentIds) ? session.studentIds.map(String) : [];
    const attended = new Set(Array.isArray(row.studentIds) ? row.studentIds.map(String) : []);
    return {
      ...row,
      attendance: linked.map((studentId) => ({
        studentId,
        status: attended.has(studentId) ? 'attended' : 'absent',
      })),
    };
  });
}

export async function createLocalWorkspaceBackup(
  snapshot: LocalPlatformSnapshot,
): Promise<WorkspaceBackup> {
  const workspaceId = snapshot.workspace.id;
  const entries = await Promise.all(
    Object.entries(STORE_MAP).map(async ([key, storeName]) => [
      key,
      await workspaceRows(storeName, workspaceId),
    ] as const),
  );
  const stores = Object.fromEntries(entries) as WorkspaceBackup['stores'];
  enrichLocalAttendance(stores);
  const activeReceiptIds = new Set(
    stores.financeReceipts
      .filter((row) => !(row as Row).deletedAt)
      .map((row) => String((row as Row).id)),
  );
  stores.financeAllocations = stores.financeAllocations.filter(
    (row) => activeReceiptIds.has(String((row as Row).receiptId)),
  );

  const backup: WorkspaceBackup = {
    schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: {
      id: workspaceId,
      name: snapshot.workspace.name,
      templateKey: snapshot.workspace.templateKey,
      locale: snapshot.workspace.locale,
      timezone: snapshot.workspace.timezone,
      currencyCode: snapshot.workspace.currencyCode,
      currencyLabel: snapshot.workspace.currencyLabel,
    },
    stores,
  };
  assertBackupWorkspaceScope(backup);
  return backup;
}

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
  if (!response.ok) throw new Error(body.error ?? `BACKUP_HTTP_${response.status}`);
  return body;
}

export async function createWorkspaceBackup(
  snapshot: LocalPlatformSnapshot,
): Promise<WorkspaceBackup> {
  if (!snapshot.cloudLink) return createLocalWorkspaceBackup(snapshot);
  const backup = workspaceBackupSchema.parse(await requestJson<unknown>(
    `/api/backup/${encodeURIComponent(snapshot.workspace.id)}/export`,
  ));
  assertBackupWorkspaceScope(backup);
  return backup;
}

function keyForRow(store: IDBObjectStore, row: Row): IDBValidKey | IDBKeyRange {
  const key = store.keyPath;
  if (Array.isArray(key)) return key.map((part) => row[String(part)] as IDBValidKey);
  if (typeof key === 'string') return row[key] as IDBValidKey;
  throw new Error('BACKUP_STORE_KEY_UNSUPPORTED');
}

async function deleteWorkspaceRows(
  store: IDBObjectStore,
  workspaceId: string,
): Promise<void> {
  const rows = await requestResult<Row[]>(store.getAll());
  for (const row of rows) {
    if (row.workspaceId === workspaceId) store.delete(keyForRow(store, row));
  }
}

export async function clearWorkspaceSyncOutbox(workspaceId: string): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.syncOutbox, 'readwrite');
  const store = transaction.objectStore(STORES.syncOutbox);
  const rows = await requestResult<Row[]>(store.getAll());
  for (const row of rows) {
    if (row.workspaceId === workspaceId) store.delete(row.id);
  }
  await transactionDone(transaction);
}

export async function restoreLocalWorkspaceBackup(
  snapshot: LocalPlatformSnapshot,
  input: unknown,
): Promise<void> {
  const backup = workspaceBackupSchema.parse(input);
  assertBackupWorkspaceScope(backup);
  const workspaceId = snapshot.workspace.id;
  if (backup.workspace.id !== workspaceId) throw new Error('BACKUP_WORKSPACE_ID_MISMATCH');

  const db = await openLocalDatabase();
  const stores = [
    STORES.coreWorkspaces,
    STORES.syncOutbox,
    ...Object.values(STORE_MAP),
  ];
  const transaction = db.transaction([...new Set(stores)], 'readwrite');

  for (const [key, storeName] of Object.entries(STORE_MAP) as Array<
    [keyof WorkspaceBackup['stores'], string]
  >) {
    const store = transaction.objectStore(storeName);
    await deleteWorkspaceRows(store, workspaceId);
    for (const row of backup.stores[key]) store.put(row);
  }

  const outbox = transaction.objectStore(STORES.syncOutbox);
  const outboxRows = await requestResult<Row[]>(outbox.getAll());
  for (const row of outboxRows) {
    if (row.workspaceId === workspaceId) outbox.delete(row.id);
  }

  const workspaceStore = transaction.objectStore(STORES.coreWorkspaces);
  const current = await requestResult<LocalWorkspaceRecord | undefined>(
    workspaceStore.get(workspaceId),
  );
  if (!current) throw new Error('WORKSPACE_NOT_FOUND');
  workspaceStore.put({
    ...current,
    name: backup.workspace.name,
    templateKey: backup.workspace.templateKey,
    locale: backup.workspace.locale,
    timezone: backup.workspace.timezone,
    currencyCode: backup.workspace.currencyCode,
    currencyLabel: backup.workspace.currencyLabel,
    updatedAt: new Date().toISOString(),
  } satisfies LocalWorkspaceRecord);

  await transactionDone(transaction);
}

export async function restoreWorkspaceBackup(
  snapshot: LocalPlatformSnapshot,
  input: unknown,
): Promise<void> {
  const backup = workspaceBackupSchema.parse(input);
  assertBackupWorkspaceScope(backup);
  if (backup.workspace.id !== snapshot.workspace.id) {
    throw new Error('BACKUP_WORKSPACE_ID_MISMATCH');
  }

  if (!snapshot.cloudLink) {
    await restoreLocalWorkspaceBackup(snapshot, backup);
    return;
  }

  await requestJson<{ ok: true; revision: number }>(
    `/api/backup/${encodeURIComponent(snapshot.workspace.id)}/restore`,
    { method: 'POST', body: JSON.stringify(backup) },
  );
  await clearWorkspaceSyncOutbox(snapshot.workspace.id);
}

export function downloadWorkspaceBackup(backup: WorkspaceBackup, suffix = ''): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const date = new Date().toISOString().slice(0, 10);
  link.download = `sozan2-full-backup-${date}${suffix ? `-${suffix}` : ''}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

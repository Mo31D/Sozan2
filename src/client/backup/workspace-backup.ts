import {
  assertBackupWorkspaceScope,
  BACKUP_ENGINE_VERSION,
  backupManifest,
  FULL_BACKUP_SCHEMA_VERSION,
  validateWorkspaceBackup,
  workspaceBackupSchema,
  type BackupImportStatus,
  type BackupValidationSummary,
  type WorkspaceBackup,
} from '../../modules/backup/workspace-backup';
import {
  markLocalCloudLinkProvisioning,
  markLocalCloudLinkReady,
  type LocalPlatformSnapshot,
  type LocalWorkspaceRecord,
} from '../adapters/indexeddb/platform.repository';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { withWorkspaceOperationWhenFree } from '../sync/workspace-operation';
import {
  executeLocalFirstImport,
  type LocalFirstImportOutcome as WorkspaceBackupImportOutcome,
} from './import-workflow';

type Row = Record<string, any>;

export type { WorkspaceBackupImportOutcome };

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
  const db = await openLocalDatabase();
  const storeNames = [...new Set(Object.values(STORE_MAP))];
  const transaction = db.transaction(storeNames, 'readonly');
  const done = transactionDone(transaction);
  const entries = await Promise.all(
    Object.entries(STORE_MAP).map(async ([key, storeName]) => {
      const rows = await requestResult<Row[]>(transaction.objectStore(storeName).getAll());
      return [key, rows.filter((row) => row.workspaceId === workspaceId)] as const;
    }),
  );
  await done;
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
    engineVersion: BACKUP_ENGINE_VERSION,
    backupId: crypto.randomUUID(),
    exportedAt: new Date().toISOString(),
    manifest: backupManifest({ stores }),
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
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('BACKUP_REQUEST_TIMEOUT');
    }
    throw new Error('BACKUP_NETWORK_ERROR');
  } finally {
    window.clearTimeout(timeout);
  }

  const raw = await response.text();
  let body: (T & { error?: string }) | null = null;
  try {
    body = raw ? JSON.parse(raw) as T & { error?: string } : null;
  } catch {
    if (!response.ok) throw new Error(`BACKUP_HTTP_${response.status}`);
    throw new Error('BACKUP_RESPONSE_INVALID');
  }

  if (!response.ok) throw new Error(body?.error ?? `BACKUP_HTTP_${response.status}`);
  if (!body) throw new Error('BACKUP_RESPONSE_EMPTY');
  return body;
}

/**
 * Import validation is deliberately local. Selecting a file must never depend
 * on the network: Sozan2 is local-first and the same exported file is editable
 * and portable. The server repeats validation inside the one destructive cloud
 * request immediately before committing.
 */
export async function validateWorkspaceBackupForImport(
  snapshot: LocalPlatformSnapshot,
  input: unknown,
): Promise<{ backup: WorkspaceBackup; validation: BackupValidationSummary }> {
  const backup = workspaceBackupSchema.parse(input);
  assertBackupWorkspaceScope(backup);
  if (backup.workspace.id !== snapshot.workspace.id) {
    throw new Error('BACKUP_WORKSPACE_ID_MISMATCH');
  }

  const validation = validateWorkspaceBackup(backup);
  if (!validation.valid) {
    throw new Error(validation.errors[0] ?? 'BACKUP_VALIDATION_FAILED');
  }
  return { backup, validation };
}

/**
 * User-facing export is always the current local working copy. This preserves
 * unsynced local edits and matches the local-first architecture.
 */
export async function createWorkspaceBackup(
  snapshot: LocalPlatformSnapshot,
): Promise<WorkspaceBackup> {
  return createLocalWorkspaceBackup(snapshot);
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

/**
 * Replaces every workspace-owned IndexedDB store in one IndexedDB transaction.
 * Auth identity and cloud-link credentials are intentionally not part of a
 * portable backup.
 */
export async function restoreLocalWorkspaceBackup(
  snapshot: LocalPlatformSnapshot,
  input: unknown,
): Promise<void> {
  const backup = workspaceBackupSchema.parse(input);
  assertBackupWorkspaceScope(backup);
  const workspaceId = snapshot.workspace.id;
  if (backup.workspace.id !== workspaceId) throw new Error('BACKUP_WORKSPACE_ID_MISMATCH');

  const validation = validateWorkspaceBackup(backup);
  if (!validation.valid) throw new Error(validation.errors[0] ?? 'BACKUP_VALIDATION_FAILED');

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

/**
 * Legacy whole-cloud restore is retained only for initial account promotion and
 * recovery of an already-provisioning cloud link. DataTools uses Import V2.
 */
export async function restoreCloudWorkspaceBackup(
  workspaceId: string,
  input: unknown,
): Promise<number> {
  const backup = workspaceBackupSchema.parse(input);
  assertBackupWorkspaceScope(backup);
  if (backup.workspace.id !== workspaceId) {
    throw new Error('BACKUP_WORKSPACE_ID_MISMATCH');
  }

  const result = await requestJson<{ ok: true; revision: number }>(
    `/api/backup/${encodeURIComponent(workspaceId)}/restore`,
    { method: 'POST', body: JSON.stringify(backup) },
  );
  return result.revision;
}

async function cloudImportStatus(
  workspaceId: string,
  importId: string,
): Promise<BackupImportStatus> {
  return requestJson<BackupImportStatus>(
    `/api/backup/${encodeURIComponent(workspaceId)}/imports/${encodeURIComponent(importId)}`,
  );
}

async function publishBackupImportToCloud(
  snapshot: LocalPlatformSnapshot,
  backup: WorkspaceBackup,
  importId: string,
  expectedRevision: number,
): Promise<number> {
  try {
    const result = await requestJson<{ ok: true; importId: string; revision: number }>(
      `/api/backup/${encodeURIComponent(snapshot.workspace.id)}/import`,
      {
        method: 'POST',
        body: JSON.stringify({ importId, expectedRevision, backup }),
      },
    );
    return result.revision;
  } catch (error) {
    const code = error instanceof Error ? error.message : 'BACKUP_CLOUD_IMPORT_FAILED';
    if (code !== 'BACKUP_NETWORK_ERROR' && code !== 'BACKUP_REQUEST_TIMEOUT') throw error;

    // A lost response is not evidence that the commit failed. Poll the import
    // journal briefly before declaring the cloud outcome unknown.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const status = await cloudImportStatus(snapshot.workspace.id, importId);
        if (status.status === 'completed') return status.revision;
        if (status.status === 'failed') throw new Error(status.error);
      } catch (statusError) {
        const statusCode = statusError instanceof Error ? statusError.message : '';
        if (!['BACKUP_NETWORK_ERROR', 'BACKUP_REQUEST_TIMEOUT'].includes(statusCode)) {
          throw statusError;
        }
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 500 * (attempt + 1)));
    }
    throw new Error('BACKUP_CLOUD_STATUS_UNKNOWN');
  }
}

/**
 * Backup Engine V2:
 * 1) blocks normal sync;
 * 2) puts a cloud-linked workspace into provisioning before touching local data;
 * 3) atomically replaces IndexedDB first, so a network outage cannot prevent
 *    the user from getting the corrected local data;
 * 4) publishes the exact same backup with one idempotent cloud request;
 * 5) keeps cloud sync blocked if that publish cannot be confirmed.
 */
export async function importWorkspaceBackupLocalFirst(
  snapshot: LocalPlatformSnapshot,
  input: unknown,
  options: { onSafetyBackup?: (backup: WorkspaceBackup) => void | Promise<void> } = {},
): Promise<WorkspaceBackupImportOutcome> {
  const { backup } = await validateWorkspaceBackupForImport(snapshot, input);
  const workspaceId = snapshot.workspace.id;

  return withWorkspaceOperationWhenFree(workspaceId, 'backup-import', async () => {
    if (options.onSafetyBackup) {
      const safety = await createLocalWorkspaceBackup(snapshot);
      await options.onSafetyBackup(safety);
    }

    const cloudLink = snapshot.cloudLink;
    const importId = cloudLink ? crypto.randomUUID() : null;
    const expectedRevision = Math.max(0, Number(cloudLink?.serverRevision ?? 0));

    return executeLocalFirstImport(
      {
        cloudLinked: Boolean(cloudLink),
        expectedRevision,
        importId,
      },
      {
        markProvisioning: async (id) => {
          await markLocalCloudLinkProvisioning(workspaceId, 'backup-import', id);
        },
        restoreLocal: async () => {
          await restoreLocalWorkspaceBackup(snapshot, backup);
        },
        publishCloud: async (id, revision) => publishBackupImportToCloud(
          snapshot,
          backup,
          id,
          revision,
        ),
        markReady: async (revision) => {
          await markLocalCloudLinkReady(workspaceId, revision);
        },
      },
    );
  });
}

/**
 * Compatibility wrapper for callers that only need "restore completed".
 * A pending cloud publish is still a successful local restore.
 */
export async function restoreWorkspaceBackup(
  snapshot: LocalPlatformSnapshot,
  input: unknown,
): Promise<void> {
  await importWorkspaceBackupLocalFirst(snapshot, input);
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

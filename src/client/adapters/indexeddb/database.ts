const DATABASE_NAME = 'sozan2-local';
const DATABASE_VERSION = 2;

export const STORES = {
  coreUsers: 'core_users',
  coreWorkspaces: 'core_workspaces',
  coreWorkspaceMembers: 'core_workspace_members',
  coreWorkspaceModules: 'core_workspace_modules',
  coreWorkspaceLabels: 'core_workspace_labels',
  coreSurfaceLayouts: 'core_surface_layouts',
  tutoringStudents: 'tutoring_students',
} as const;

let databasePromise: Promise<IDBDatabase> | null = null;

function ensureStore(
  db: IDBDatabase,
  name: string,
  options: IDBObjectStoreParameters,
  indexes: Array<{ name: string; keyPath: string | string[]; unique?: boolean }> = [],
): void {
  if (db.objectStoreNames.contains(name)) return;
  const store = db.createObjectStore(name, options);
  for (const index of indexes) {
    store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
  }
}

export function openLocalDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      ensureStore(db, STORES.coreUsers, { keyPath: 'id' }, [
        { name: 'active', keyPath: 'active' },
      ]);
      ensureStore(db, STORES.coreWorkspaces, { keyPath: 'id' }, [
        { name: 'active', keyPath: 'active' },
      ]);
      ensureStore(db, STORES.coreWorkspaceMembers, { keyPath: ['workspaceId', 'userId'] }, [
        { name: 'userId', keyPath: 'userId' },
        { name: 'workspaceId', keyPath: 'workspaceId' },
      ]);
      ensureStore(db, STORES.coreWorkspaceModules, { keyPath: ['workspaceId', 'moduleKey'] }, [
        { name: 'workspaceId', keyPath: 'workspaceId' },
      ]);
      ensureStore(db, STORES.coreWorkspaceLabels, { keyPath: ['workspaceId', 'labelKey'] }, [
        { name: 'workspaceId', keyPath: 'workspaceId' },
      ]);
      ensureStore(db, STORES.coreSurfaceLayouts, { keyPath: ['workspaceId', 'userId', 'surfaceKey'] }, [
        { name: 'workspaceId', keyPath: 'workspaceId' },
      ]);
      ensureStore(db, STORES.tutoringStudents, { keyPath: 'id' }, [
        { name: 'workspaceId', keyPath: 'workspaceId' },
      ]);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_OPEN_FAILED'));
  });

  return databasePromise;
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_REQUEST_FAILED'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('INDEXEDDB_TRANSACTION_ABORTED'));
    transaction.onerror = () => reject(transaction.error ?? new Error('INDEXEDDB_TRANSACTION_FAILED'));
  });
}

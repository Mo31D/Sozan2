const DATABASE_NAME = 'sozan2-local';
const DATABASE_VERSION = 1;

export const STORES = {
  tutoringStudents: 'tutoring_students',
} as const;

let databasePromise: Promise<IDBDatabase> | null = null;

export function openLocalDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.tutoringStudents)) {
        const store = db.createObjectStore(STORES.tutoringStudents, { keyPath: 'id' });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
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

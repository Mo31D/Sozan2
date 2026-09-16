export type PersistenceMode = 'local' | 'cloud';

export type StorageCapabilities = {
  mode: PersistenceMode;
  offline: boolean;
  multiDevice: boolean;
  sharedWorkspace: boolean;
};

export type EntityIdFactory = () => string;

export type WorkspaceScope = {
  workspaceId: string;
  userId?: string;
};

export interface TransactionBoundary {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface PersistenceProvider {
  readonly capabilities: StorageCapabilities;
  readonly ids: EntityIdFactory;
  readonly transactions: TransactionBoundary;
}

export function browserUuid(): string {
  return crypto.randomUUID();
}

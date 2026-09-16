export type SyncMutation = {
  id: string;
  workspaceId: string;
  moduleKey: string;
  operation: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: string;
};

export type SyncApplyResult = {
  mutationId: string;
  status: 'applied' | 'duplicate';
};

export type ModuleSnapshot = {
  moduleKey: string;
  data: unknown;
};

export interface ModuleSyncHandler {
  readonly moduleKey: string;
  apply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void>;
  snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot>;
}

export function getSyncHandler(
  handlers: readonly ModuleSyncHandler[],
  moduleKey: string,
): ModuleSyncHandler {
  const handler = handlers.find((candidate) => candidate.moduleKey === moduleKey);
  if (!handler) throw new Error('SYNC_MODULE_UNSUPPORTED');
  return handler;
}

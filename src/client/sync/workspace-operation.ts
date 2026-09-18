type WorkspaceOperation = {
  name: string;
  token: string;
};

const activeOperations = new Map<string, WorkspaceOperation>();

export function currentWorkspaceOperation(workspaceId: string): WorkspaceOperation | null {
  return activeOperations.get(workspaceId) ?? null;
}

export function beginWorkspaceOperation(workspaceId: string, name: string): () => void {
  const current = activeOperations.get(workspaceId);
  if (current) throw new Error('WORKSPACE_OPERATION_BUSY');

  const token = crypto.randomUUID();
  activeOperations.set(workspaceId, { name, token });

  return () => {
    const latest = activeOperations.get(workspaceId);
    if (latest?.token === token) activeOperations.delete(workspaceId);
  };
}

export async function withWorkspaceOperation<T>(
  workspaceId: string,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const release = beginWorkspaceOperation(workspaceId, name);
  try {
    return await run();
  } finally {
    release();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function withWorkspaceOperationWhenFree<T>(
  workspaceId: string,
  name: string,
  run: () => Promise<T>,
  waitMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + waitMs;
  while (currentWorkspaceOperation(workspaceId)) {
    if (Date.now() >= deadline) throw new Error('WORKSPACE_OPERATION_BUSY');
    await sleep(100);
  }
  return withWorkspaceOperation(workspaceId, name, run);
}

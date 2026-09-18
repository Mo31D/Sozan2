import { describe, expect, it } from 'vitest';
import {
  beginWorkspaceOperation,
  currentWorkspaceOperation,
  withWorkspaceOperation,
} from '../src/client/sync/workspace-operation';

describe('workspace operation mutex', () => {
  it('prevents sync/import overlap for the same workspace', async () => {
    const release = beginWorkspaceOperation('workspace-a', 'sync');
    expect(currentWorkspaceOperation('workspace-a')?.name).toBe('sync');
    await expect(withWorkspaceOperation('workspace-a', 'backup-import', async () => undefined))
      .rejects.toThrow('WORKSPACE_OPERATION_BUSY');
    release();
    expect(currentWorkspaceOperation('workspace-a')).toBeNull();
  });

  it('does not block operations in a different workspace', async () => {
    const release = beginWorkspaceOperation('workspace-a', 'sync');
    await expect(withWorkspaceOperation('workspace-b', 'backup-import', async () => 'ok'))
      .resolves.toBe('ok');
    release();
  });

  it('releases the lock when an operation throws', async () => {
    await expect(withWorkspaceOperation('workspace-a', 'backup-import', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(currentWorkspaceOperation('workspace-a')).toBeNull();
  });
});

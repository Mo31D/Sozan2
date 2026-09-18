import { describe, expect, it, vi } from 'vitest';
import { executeLocalFirstImport } from '../src/client/backup/import-workflow';

describe('Backup Engine V2 local-first policy', () => {
  it('keeps corrected local data successful when cloud publication fails', async () => {
    const order: string[] = [];
    const outcome = await executeLocalFirstImport(
      { cloudLinked: true, expectedRevision: 7, importId: '11111111-1111-4111-8111-111111111111' },
      {
        markProvisioning: vi.fn(async () => { order.push('provisioning'); }),
        restoreLocal: vi.fn(async () => { order.push('local'); }),
        publishCloud: vi.fn(async () => {
          order.push('cloud');
          throw new Error('BACKUP_NETWORK_ERROR');
        }),
        markReady: vi.fn(async () => { order.push('ready'); }),
      },
    );

    expect(order).toEqual(['provisioning', 'local', 'cloud']);
    expect(outcome).toMatchObject({
      localApplied: true,
      cloud: 'pending',
      cloudError: 'BACKUP_NETWORK_ERROR',
    });
  });

  it('marks the cloud ready only after the exact backup is published', async () => {
    const order: string[] = [];
    const outcome = await executeLocalFirstImport(
      { cloudLinked: true, expectedRevision: 9, importId: '22222222-2222-4222-8222-222222222222' },
      {
        markProvisioning: vi.fn(async () => { order.push('provisioning'); }),
        restoreLocal: vi.fn(async () => { order.push('local'); }),
        publishCloud: vi.fn(async (_id, revision) => {
          order.push(`cloud:${revision}`);
          return 10;
        }),
        markReady: vi.fn(async (revision) => { order.push(`ready:${revision}`); }),
      },
    );

    expect(order).toEqual(['provisioning', 'local', 'cloud:9', 'ready:10']);
    expect(outcome).toMatchObject({
      localApplied: true,
      cloud: 'synced',
      revision: 10,
      cloudError: null,
    });
  });

  it('restores cloud-ready state if local replacement itself fails', async () => {
    const markReady = vi.fn(async () => undefined);
    await expect(executeLocalFirstImport(
      { cloudLinked: true, expectedRevision: 4, importId: '33333333-3333-4333-8333-333333333333' },
      {
        markProvisioning: vi.fn(async () => undefined),
        restoreLocal: vi.fn(async () => { throw new Error('INDEXEDDB_TRANSACTION_ABORTED'); }),
        publishCloud: vi.fn(async () => 5),
        markReady,
      },
    )).rejects.toThrow('INDEXEDDB_TRANSACTION_ABORTED');

    expect(markReady).toHaveBeenCalledWith(4);
  });

  it('never requires the network for a local-only workspace', async () => {
    const publishCloud = vi.fn(async () => 1);
    const outcome = await executeLocalFirstImport(
      { cloudLinked: false, expectedRevision: 0, importId: null },
      {
        markProvisioning: vi.fn(async () => undefined),
        restoreLocal: vi.fn(async () => undefined),
        publishCloud,
        markReady: vi.fn(async () => undefined),
      },
    );

    expect(publishCloud).not.toHaveBeenCalled();
    expect(outcome.cloud).toBe('not-linked');
  });
});

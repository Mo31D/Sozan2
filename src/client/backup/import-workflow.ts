export type LocalFirstImportOutcome = {
  importId: string | null;
  localApplied: true;
  cloud: 'not-linked' | 'synced' | 'pending';
  revision: number | null;
  cloudError: string | null;
};

export type LocalFirstImportDependencies = {
  markProvisioning(importId: string): Promise<void>;
  restoreLocal(): Promise<void>;
  publishCloud(importId: string, expectedRevision: number): Promise<number>;
  markReady(revision: number): Promise<void>;
};

/**
 * Pure orchestration policy for destructive backup import.
 *
 * Local IndexedDB is authoritative for the user's immediate working state.
 * Cloud publication is a second phase. If cloud publication cannot be
 * confirmed, the caller leaves the link in provisioning state so normal sync
 * cannot overwrite the newly imported local data.
 */
export async function executeLocalFirstImport(
  input: {
    cloudLinked: boolean;
    expectedRevision: number;
    importId: string | null;
  },
  dependencies: LocalFirstImportDependencies,
): Promise<LocalFirstImportOutcome> {
  if (input.cloudLinked && !input.importId) throw new Error('BACKUP_IMPORT_ID_REQUIRED');

  if (input.cloudLinked && input.importId) {
    await dependencies.markProvisioning(input.importId);
  }

  try {
    await dependencies.restoreLocal();
  } catch (error) {
    if (input.cloudLinked) {
      await dependencies.markReady(input.expectedRevision);
    }
    throw error;
  }

  if (!input.cloudLinked || !input.importId) {
    return {
      importId: null,
      localApplied: true,
      cloud: 'not-linked',
      revision: null,
      cloudError: null,
    };
  }

  try {
    const revision = await dependencies.publishCloud(input.importId, input.expectedRevision);
    await dependencies.markReady(revision);
    return {
      importId: input.importId,
      localApplied: true,
      cloud: 'synced',
      revision,
      cloudError: null,
    };
  } catch (error) {
    return {
      importId: input.importId,
      localApplied: true,
      cloud: 'pending',
      revision: null,
      cloudError: error instanceof Error ? error.message : 'BACKUP_CLOUD_IMPORT_FAILED',
    };
  }
}

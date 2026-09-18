import type { WorkspaceBackup } from '../../modules/backup/workspace-backup';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import {
  linkLocalPlatformToCloud,
  loadLocalPlatform,
  markLocalCloudLinkReady,
} from '../adapters/indexeddb/platform.repository';
import {
  clearWorkspaceSyncOutbox,
  createLocalWorkspaceBackup,
  restoreCloudWorkspaceBackup,
} from '../backup/workspace-backup';
import type { SyncRunResult } from '../sync/engine';
import { runWorkspaceSync } from '../sync/engine';
import { beginWorkspaceOperation } from '../sync/workspace-operation';
import {
  registerCloudAccount,
  type CloudRegisterResponse,
} from './account-api';

export type CloudLinkWorkflowDependencies = {
  createBackup(snapshot: LocalPlatformSnapshot): Promise<WorkspaceBackup>;
  register(
    snapshot: LocalPlatformSnapshot,
    loginName: string,
    password: string,
  ): Promise<CloudRegisterResponse>;
  link(
    snapshot: LocalPlatformSnapshot,
    loginName: string,
    state?: 'provisioning' | 'ready',
  ): Promise<void>;
  markReady(workspaceId: string, serverRevision: number): Promise<void>;
  load(): Promise<LocalPlatformSnapshot | null>;
  restoreCloud(workspaceId: string, backup: WorkspaceBackup): Promise<number>;
  clearOutbox(workspaceId: string): Promise<void>;
  sync(workspaceId: string): Promise<SyncRunResult>;
};

const defaultDependencies: CloudLinkWorkflowDependencies = {
  createBackup: createLocalWorkspaceBackup,
  register: registerCloudAccount,
  link: linkLocalPlatformToCloud,
  markReady: markLocalCloudLinkReady,
  load: loadLocalPlatform,
  restoreCloud: restoreCloudWorkspaceBackup,
  clearOutbox: clearWorkspaceSyncOutbox,
  sync: runWorkspaceSync,
};

/**
 * Promotes an existing local-only workspace to cloud mode without replaying a
 * partial set of entity mutations.
 *
 * The complete local workspace is snapshotted before account creation, restored
 * into the newly-created cloud workspace, then pulled back through the normal
 * sync path. This makes cloud linking a lossless state transfer for every
 * enabled module, not just tutoring students/sessions.
 */
export async function linkExistingLocalWorkspaceToCloud(
  snapshot: LocalPlatformSnapshot,
  credentials: { loginName: string; password: string },
  dependencies: CloudLinkWorkflowDependencies = defaultDependencies,
  onRegistered?: (recoveryCode: string) => void,
): Promise<{ recoveryCode: string; sync: SyncRunResult }> {
  if (snapshot.cloudLink) throw new Error('WORKSPACE_ALREADY_CLOUD_LINKED');

  const backup = await dependencies.createBackup(snapshot);
  const registration = await dependencies.register(
    snapshot,
    credentials.loginName,
    credentials.password,
  );

  onRegistered?.(registration.recoveryCode);

  // Persist a recoverable provisioning state immediately after account
  // creation. Normal sync refuses to run in this state, so even if cloud
  // restore fails (or the app is closed) an empty cloud can never overwrite
  // the complete local workspace.
  await dependencies.link(
    snapshot,
    registration.account.user.loginName,
    'provisioning',
  );

  const revision = await dependencies.restoreCloud(snapshot.workspace.id, backup);
  await dependencies.clearOutbox(snapshot.workspace.id);
  await dependencies.markReady(snapshot.workspace.id, revision);

  const linkedSnapshot = await dependencies.load();
  if (
    !linkedSnapshot
    || linkedSnapshot.workspace.id !== snapshot.workspace.id
    || !linkedSnapshot.cloudLink
    || linkedSnapshot.cloudLink.initializationState === 'provisioning'
  ) {
    throw new Error('CLOUD_LINK_STATE_INVALID');
  }

  const sync = await dependencies.sync(snapshot.workspace.id);

  return {
    recoveryCode: registration.recoveryCode,
    sync,
  };
}


/**
 * Completes a cloud promotion that was interrupted after account creation.
 * The local workspace remains authoritative until the full restore succeeds.
 */
export async function resumeCloudWorkspacePromotion(
  snapshot: LocalPlatformSnapshot,
  dependencies: CloudLinkWorkflowDependencies = defaultDependencies,
): Promise<SyncRunResult> {
  if (!snapshot.cloudLink || snapshot.cloudLink.initializationState !== 'provisioning') {
    throw new Error('CLOUD_PROMOTION_NOT_PENDING');
  }

  const release = beginWorkspaceOperation(snapshot.workspace.id, 'cloud-promotion');
  try {
    const backup = await dependencies.createBackup(snapshot);
    const revision = await dependencies.restoreCloud(snapshot.workspace.id, backup);
    await dependencies.clearOutbox(snapshot.workspace.id);
    await dependencies.markReady(snapshot.workspace.id, revision);
  } finally {
    release();
  }
  return dependencies.sync(snapshot.workspace.id);
}

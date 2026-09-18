import type { WorkspaceBackup } from '../../modules/backup/workspace-backup';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';
import {
  linkLocalPlatformToCloud,
  loadLocalPlatform,
} from '../adapters/indexeddb/platform.repository';
import {
  clearWorkspaceSyncOutbox,
  createLocalWorkspaceBackup,
  restoreCloudWorkspaceBackup,
} from '../backup/workspace-backup';
import type { SyncRunResult } from '../sync/engine';
import { runWorkspaceSync } from '../sync/engine';
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
  link(snapshot: LocalPlatformSnapshot, loginName: string): Promise<void>;
  load(): Promise<LocalPlatformSnapshot | null>;
  restoreCloud(workspaceId: string, backup: WorkspaceBackup): Promise<number>;
  clearOutbox(workspaceId: string): Promise<void>;
  sync(workspaceId: string): Promise<SyncRunResult>;
};

const defaultDependencies: CloudLinkWorkflowDependencies = {
  createBackup: createLocalWorkspaceBackup,
  register: registerCloudAccount,
  link: linkLocalPlatformToCloud,
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
): Promise<{ recoveryCode: string; sync: SyncRunResult }> {
  if (snapshot.cloudLink) throw new Error('WORKSPACE_ALREADY_CLOUD_LINKED');

  const backup = await dependencies.createBackup(snapshot);
  const registration = await dependencies.register(
    snapshot,
    credentials.loginName,
    credentials.password,
  );

  // Restore first. If the cloud write fails, the device deliberately remains
  // local-only, so a transient server failure can never turn the next sync into
  // an empty-cloud overwrite of the user's complete local state.
  await dependencies.restoreCloud(snapshot.workspace.id, backup);
  await dependencies.clearOutbox(snapshot.workspace.id);
  await dependencies.link(snapshot, registration.account.user.loginName);

  const linkedSnapshot = await dependencies.load();
  if (
    !linkedSnapshot
    || linkedSnapshot.workspace.id !== snapshot.workspace.id
    || !linkedSnapshot.cloudLink
  ) {
    throw new Error('CLOUD_LINK_STATE_INVALID');
  }

  const sync = await dependencies.sync(snapshot.workspace.id);

  return {
    recoveryCode: registration.recoveryCode,
    sync,
  };
}

import type { LocalPlatformSnapshot, LocalUserRecord, LocalWorkspaceRecord } from '../adapters/indexeddb/platform.repository';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { newSyncOutboxRecord } from '../sync/outbox';
import type { LocalWorkspaceSetting } from './types';

export const PROFILE_SETTING_KEYS = {
  displayName: 'profile.display_name',
  workspaceName: 'workspace.display_name',
  currencyCode: 'workspace.currency_code',
  currencyLabel: 'workspace.currency_label',
} as const;

export type WorkspacePresentation = {
  displayName: string;
  workspaceName: string;
  currencyCode: string;
  currencyLabel: string;
};

function settingMap(settings: readonly LocalWorkspaceSetting[]): Map<string, string> {
  return new Map(settings.map((item) => [item.key, item.value]));
}

export function resolveWorkspacePresentation(
  snapshot: LocalPlatformSnapshot,
  settings: readonly LocalWorkspaceSetting[],
): WorkspacePresentation {
  const values = settingMap(settings);
  return {
    displayName: values.get(PROFILE_SETTING_KEYS.displayName)?.trim() || snapshot.user.displayName,
    workspaceName: values.get(PROFILE_SETTING_KEYS.workspaceName)?.trim() || snapshot.workspace.name,
    currencyCode: values.get(PROFILE_SETTING_KEYS.currencyCode)?.trim().toUpperCase() || snapshot.workspace.currencyCode,
    currencyLabel: values.get(PROFILE_SETTING_KEYS.currencyLabel)?.trim() || snapshot.workspace.currencyLabel,
  };
}

function clean(input: string, error: string, max = 120): string {
  const value = input.trim();
  if (!value) throw new Error(error);
  if (value.length > max) throw new Error(`${error}_TOO_LONG`);
  return value;
}

export async function updateWorkspacePresentation(
  snapshot: LocalPlatformSnapshot,
  input: WorkspacePresentation,
): Promise<void> {
  const displayName = clean(input.displayName, 'DISPLAY_NAME_REQUIRED', 100);
  const workspaceName = clean(input.workspaceName, 'WORKSPACE_NAME_REQUIRED', 120);
  const currencyCode = clean(input.currencyCode, 'CURRENCY_CODE_REQUIRED', 8).toUpperCase();
  const currencyLabel = clean(input.currencyLabel, 'CURRENCY_LABEL_REQUIRED', 12);
  const now = new Date().toISOString();
  const values = [
    [PROFILE_SETTING_KEYS.displayName, displayName],
    [PROFILE_SETTING_KEYS.workspaceName, workspaceName],
    [PROFILE_SETTING_KEYS.currencyCode, currencyCode],
    [PROFILE_SETTING_KEYS.currencyLabel, currencyLabel],
  ] as const;

  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [STORES.coreUsers, STORES.coreWorkspaces, STORES.coreWorkspaceSettings, STORES.syncOutbox],
    'readwrite',
  );
  const userStore = transaction.objectStore(STORES.coreUsers);
  const workspaceStore = transaction.objectStore(STORES.coreWorkspaces);
  const currentUser = await requestResult<LocalUserRecord | undefined>(userStore.get(snapshot.user.id));
  const currentWorkspace = await requestResult<LocalWorkspaceRecord | undefined>(workspaceStore.get(snapshot.workspace.id));
  if (!currentUser || !currentWorkspace) throw new Error('LOCAL_PROFILE_NOT_FOUND');

  userStore.put({ ...currentUser, displayName, updatedAt: now });
  workspaceStore.put({
    ...currentWorkspace,
    name: workspaceName,
    currencyCode,
    currencyLabel,
    updatedAt: now,
  });

  const settingStore = transaction.objectStore(STORES.coreWorkspaceSettings);
  const outbox = transaction.objectStore(STORES.syncOutbox);
  for (const [key, value] of values) {
    settingStore.put({ workspaceId: snapshot.workspace.id, key, value });
    outbox.add(newSyncOutboxRecord({
      workspaceId: snapshot.workspace.id,
      moduleKey: 'core',
      operation: 'setting.set',
      entityType: 'workspace-setting',
      entityId: crypto.randomUUID(),
      payload: { key, value },
    }));
  }
  await transactionDone(transaction);
}

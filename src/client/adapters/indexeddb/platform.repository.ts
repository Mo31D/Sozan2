import type { AuthenticatedAccount } from '../../../platform/auth/contracts';
import { BUILTIN_MODULES } from '../../../platform/modules/catalog';
import { getWorkspaceTemplate } from '../../../templates/catalog';
import { openLocalDatabase, requestResult, STORES, transactionDone } from './database';

export type LocalUserRecord = {
  id: string;
  displayName: string;
  locale: string;
  timezone: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LocalWorkspaceRecord = {
  id: string;
  name: string;
  templateKey: string;
  locale: string;
  timezone: string;
  currencyCode: string;
  currencyLabel: string;
  ownerUserId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LocalWorkspaceModuleRecord = {
  workspaceId: string;
  moduleKey: string;
  enabled: boolean;
  position: number;
  configJson?: string;
  updatedAt: string;
};

export type LocalCloudLinkRecord = {
  workspaceId: string;
  userId: string;
  loginName: string;
  linkedAt: string;
  lastCloudPullAt: string | null;
  lastCloudPushAt: string | null;
  /** Last authoritative workspace revision pulled/acknowledged from cloud. */
  serverRevision: number | null;
};

export type LocalPlatformSnapshot = {
  user: LocalUserRecord;
  workspace: LocalWorkspaceRecord;
  modules: LocalWorkspaceModuleRecord[];
  labels: Record<string, string>;
  cloudLink: LocalCloudLinkRecord | null;
};

export type CloudWorkspaceBootstrap = {
  workspace: {
    id: string;
    name: string;
    templateKey: string;
    locale: string;
    timezone: string;
    currencyCode: string;
    currencyLabel: string;
  };
  modules: Array<{
    moduleKey: string;
    enabled: boolean;
    position: number;
    configJson: string | null;
    updatedAt: string;
  }>;
  labels: Record<string, string>;
};

const nowIso = () => new Date().toISOString();

export async function loadLocalPlatform(): Promise<LocalPlatformSnapshot | null> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [
      STORES.coreUsers,
      STORES.coreWorkspaces,
      STORES.coreWorkspaceModules,
      STORES.coreWorkspaceLabels,
      STORES.coreCloudLinks,
    ],
    'readonly',
  );

  const [users, workspaces, modules, labels, cloudLinks] = await Promise.all([
    requestResult<LocalUserRecord[]>(transaction.objectStore(STORES.coreUsers).getAll()),
    requestResult<LocalWorkspaceRecord[]>(transaction.objectStore(STORES.coreWorkspaces).getAll()),
    requestResult<LocalWorkspaceModuleRecord[]>(transaction.objectStore(STORES.coreWorkspaceModules).getAll()),
    requestResult<Array<{ workspaceId: string; labelKey: string; value: string }>>(
      transaction.objectStore(STORES.coreWorkspaceLabels).getAll(),
    ),
    requestResult<LocalCloudLinkRecord[]>(transaction.objectStore(STORES.coreCloudLinks).getAll()),
  ]);

  const user = users.find((item) => item.active);
  const workspace = workspaces.find((item) => item.active);
  if (!user || !workspace) return null;

  return {
    user,
    workspace,
    modules: modules
      .filter((item) => item.workspaceId === workspace.id)
      .sort((a, b) => a.position - b.position),
    labels: Object.fromEntries(
      labels
        .filter((item) => item.workspaceId === workspace.id)
        .map((item) => [item.labelKey, item.value]),
    ),
    cloudLink: cloudLinks.find((item) => item.workspaceId === workspace.id) ?? null,
  };
}

export async function bootstrapLocalPlatform(input: {
  displayName: string;
  workspaceName: string;
  templateKey: string;
}): Promise<LocalPlatformSnapshot> {
  const displayName = input.displayName.trim();
  const workspaceName = input.workspaceName.trim();
  if (!displayName || !workspaceName) throw new Error('NAME_REQUIRED');

  const template = getWorkspaceTemplate(input.templateKey);
  if (!template?.implemented) throw new Error('TEMPLATE_NOT_IMPLEMENTED');

  const db = await openLocalDatabase();
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const now = nowIso();
  const transaction = db.transaction(
    [
      STORES.coreUsers,
      STORES.coreWorkspaces,
      STORES.coreWorkspaceMembers,
      STORES.coreWorkspaceModules,
      STORES.coreWorkspaceLabels,
    ],
    'readwrite',
  );

  transaction.objectStore(STORES.coreUsers).put({
    id: userId,
    displayName,
    locale: 'ar-EG',
    timezone: 'Europe/London',
    active: true,
    createdAt: now,
    updatedAt: now,
  } satisfies LocalUserRecord);

  transaction.objectStore(STORES.coreWorkspaces).put({
    id: workspaceId,
    name: workspaceName,
    templateKey: template.key,
    locale: 'ar-EG',
    timezone: 'Europe/London',
    currencyCode: 'EGP',
    currencyLabel: 'ج',
    ownerUserId: userId,
    active: true,
    createdAt: now,
    updatedAt: now,
  } satisfies LocalWorkspaceRecord);

  transaction.objectStore(STORES.coreWorkspaceMembers).put({
    workspaceId,
    userId,
    role: 'owner',
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  template.modules.forEach((moduleKey, index) => {
    transaction.objectStore(STORES.coreWorkspaceModules).put({
      workspaceId,
      moduleKey,
      enabled: true,
      position: (index + 1) * 10,
      updatedAt: now,
    } satisfies LocalWorkspaceModuleRecord);
  });

  for (const [labelKey, value] of Object.entries(template.labels)) {
    transaction.objectStore(STORES.coreWorkspaceLabels).put({
      workspaceId,
      labelKey,
      value,
      updatedAt: now,
    });
  }

  await transactionDone(transaction);
  const snapshot = await loadLocalPlatform();
  if (!snapshot) throw new Error('LOCAL_BOOTSTRAP_FAILED');
  return snapshot;
}

export async function linkLocalPlatformToCloud(
  snapshot: LocalPlatformSnapshot,
  loginName: string,
): Promise<void> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.coreCloudLinks, 'readwrite');
  transaction.objectStore(STORES.coreCloudLinks).put({
    workspaceId: snapshot.workspace.id,
    userId: snapshot.user.id,
    loginName,
    linkedAt: nowIso(),
    lastCloudPullAt: null,
    lastCloudPushAt: null,
    serverRevision: null,
  } satisfies LocalCloudLinkRecord);
  await transactionDone(transaction);
}

export async function hydrateLocalPlatformFromCloud(
  account: AuthenticatedAccount,
  bootstrap: CloudWorkspaceBootstrap,
): Promise<LocalPlatformSnapshot> {
  const membership = account.workspaces.find((item) => item.id === bootstrap.workspace.id);
  if (!membership) throw new Error('WORKSPACE_NOT_IN_ACCOUNT');
  const db = await openLocalDatabase();
  const now = nowIso();

  const previousUsers = await requestResult<LocalUserRecord[]>(
    db.transaction(STORES.coreUsers, 'readonly').objectStore(STORES.coreUsers).getAll(),
  );
  const previousWorkspaces = await requestResult<LocalWorkspaceRecord[]>(
    db.transaction(STORES.coreWorkspaces, 'readonly').objectStore(STORES.coreWorkspaces).getAll(),
  );

  const transaction = db.transaction(
    [
      STORES.coreUsers,
      STORES.coreWorkspaces,
      STORES.coreWorkspaceMembers,
      STORES.coreWorkspaceModules,
      STORES.coreWorkspaceLabels,
      STORES.coreCloudLinks,
    ],
    'readwrite',
  );
  const userStore = transaction.objectStore(STORES.coreUsers);
  const workspaceStore = transaction.objectStore(STORES.coreWorkspaces);
  for (const user of previousUsers) userStore.put({ ...user, active: false, updatedAt: now });
  for (const workspace of previousWorkspaces) {
    workspaceStore.put({ ...workspace, active: false, updatedAt: now });
  }

  userStore.put({
    id: account.user.id,
    displayName: account.user.displayName,
    locale: account.user.locale,
    timezone: account.user.timezone,
    active: true,
    createdAt: now,
    updatedAt: now,
  } satisfies LocalUserRecord);

  workspaceStore.put({
    ...bootstrap.workspace,
    ownerUserId: account.user.id,
    active: true,
    createdAt: now,
    updatedAt: now,
  } satisfies LocalWorkspaceRecord);

  transaction.objectStore(STORES.coreWorkspaceMembers).put({
    workspaceId: bootstrap.workspace.id,
    userId: account.user.id,
    role: membership.role,
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  const moduleStore = transaction.objectStore(STORES.coreWorkspaceModules);
  for (const module of bootstrap.modules) {
    moduleStore.put({
      workspaceId: bootstrap.workspace.id,
      moduleKey: module.moduleKey,
      enabled: module.enabled,
      position: module.position,
      configJson: module.configJson ?? undefined,
      updatedAt: module.updatedAt,
    } satisfies LocalWorkspaceModuleRecord);
  }

  const labelStore = transaction.objectStore(STORES.coreWorkspaceLabels);
  for (const [labelKey, value] of Object.entries(bootstrap.labels)) {
    labelStore.put({ workspaceId: bootstrap.workspace.id, labelKey, value, updatedAt: now });
  }

  transaction.objectStore(STORES.coreCloudLinks).put({
    workspaceId: bootstrap.workspace.id,
    userId: account.user.id,
    loginName: account.user.loginName,
    linkedAt: now,
    lastCloudPullAt: now,
    lastCloudPushAt: null,
    serverRevision: null,
  } satisfies LocalCloudLinkRecord);

  await transactionDone(transaction);
  const snapshot = await loadLocalPlatform();
  if (!snapshot) throw new Error('CLOUD_HYDRATE_FAILED');
  return snapshot;
}

export async function setLocalModuleEnabled(
  workspaceId: string,
  moduleKey: string,
  enabled: boolean,
): Promise<void> {
  const moduleDefinition = BUILTIN_MODULES.find((module) => module.key === moduleKey);
  if (!moduleDefinition) throw new Error('UNKNOWN_MODULE');

  const db = await openLocalDatabase();
  const transaction = db.transaction(STORES.coreWorkspaceModules, 'readwrite');
  const store = transaction.objectStore(STORES.coreWorkspaceModules);
  const existing = await requestResult<LocalWorkspaceModuleRecord | undefined>(
    store.get([workspaceId, moduleKey]),
  );

  store.put({
    workspaceId,
    moduleKey,
    enabled,
    position: existing?.position ?? 100,
    configJson: existing?.configJson,
    updatedAt: nowIso(),
  } satisfies LocalWorkspaceModuleRecord);
  await transactionDone(transaction);
}

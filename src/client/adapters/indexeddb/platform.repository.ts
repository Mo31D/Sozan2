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

export type LocalPlatformSnapshot = {
  user: LocalUserRecord;
  workspace: LocalWorkspaceRecord;
  modules: LocalWorkspaceModuleRecord[];
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
    ],
    'readonly',
  );

  const [users, workspaces, modules, labels] = await Promise.all([
    requestResult<LocalUserRecord[]>(transaction.objectStore(STORES.coreUsers).getAll()),
    requestResult<LocalWorkspaceRecord[]>(transaction.objectStore(STORES.coreWorkspaces).getAll()),
    requestResult<LocalWorkspaceModuleRecord[]>(transaction.objectStore(STORES.coreWorkspaceModules).getAll()),
    requestResult<Array<{ workspaceId: string; labelKey: string; value: string }>>(
      transaction.objectStore(STORES.coreWorkspaceLabels).getAll(),
    ),
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

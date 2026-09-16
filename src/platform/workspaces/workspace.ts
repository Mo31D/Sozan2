export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type UserProfile = {
  id: string;
  displayName: string;
  locale: string;
  timezone: string;
  active: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  templateKey: string;
  locale: string;
  timezone: string;
  currencyCode: string;
  currencyLabel: string;
  active: boolean;
};

export type WorkspaceMembership = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  active: boolean;
};

export function canManageWorkspace(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canWriteWorkspace(role: WorkspaceRole): boolean {
  return role !== 'viewer';
}

export function resolveLabel(
  key: string,
  workspaceOverrides: Readonly<Record<string, string>>,
  moduleDefaults: Readonly<Record<string, string>>,
  fallback: string,
): string {
  return workspaceOverrides[key] ?? moduleDefaults[key] ?? fallback;
}

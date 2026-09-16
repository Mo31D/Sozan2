import type { AuthenticatedAccount } from '../../platform/auth/contracts';
import type { LocalPlatformSnapshot } from '../adapters/indexeddb/platform.repository';

export type CloudAccountResponse = {
  account: AuthenticatedAccount;
};

export type CloudRegisterResponse = CloudAccountResponse & {
  recoveryCode: string;
  recoveryCodeShownOnce: true;
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `HTTP_${response.status}`);
  return body;
}

export async function getCloudAccount(): Promise<AuthenticatedAccount | null> {
  const response = await fetch('/api/auth/me', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`AUTH_ME_${response.status}`);
  const body = await response.json() as CloudAccountResponse;
  return body.account;
}

export function registerCloudAccount(
  snapshot: LocalPlatformSnapshot,
  loginName: string,
  password: string,
): Promise<CloudRegisterResponse> {
  return jsonRequest<CloudRegisterResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      userId: snapshot.user.id,
      workspaceId: snapshot.workspace.id,
      loginName,
      password,
      displayName: snapshot.user.displayName,
      workspaceName: snapshot.workspace.name,
      templateKey: snapshot.workspace.templateKey,
      locale: snapshot.workspace.locale,
      timezone: snapshot.workspace.timezone,
      currencyCode: snapshot.workspace.currencyCode,
      currencyLabel: snapshot.workspace.currencyLabel,
    }),
  });
}

export function loginCloudAccount(loginName: string, password: string): Promise<CloudAccountResponse> {
  return jsonRequest<CloudAccountResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ loginName, password }),
  });
}

export async function logoutCloudAccount(): Promise<void> {
  await jsonRequest<{ ok: boolean }>('/api/auth/logout', {
    method: 'POST',
    body: '{}',
  });
}

export function recoverCloudAccount(
  loginName: string,
  recoveryCode: string,
  newPassword: string,
): Promise<{ ok: true; recoveryCode: string; recoveryCodeShownOnce: true }> {
  return jsonRequest('/api/auth/recover', {
    method: 'POST',
    body: JSON.stringify({ loginName, recoveryCode, newPassword }),
  });
}

export async function getWorkspaceBootstrap(workspaceId: string): Promise<{
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
}> {
  return jsonRequest(`/api/workspaces/${encodeURIComponent(workspaceId)}/bootstrap`);
}

export type CloudUser = {
  id: string;
  loginName: string;
  displayName: string;
  locale: string;
  timezone: string;
};

export type CloudWorkspace = {
  id: string;
  name: string;
  templateKey: string;
  locale: string;
  timezone: string;
  currencyCode: string;
  currencyLabel: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
};

export type AuthenticatedAccount = {
  user: CloudUser;
  workspaces: CloudWorkspace[];
};

export type CredentialRecord = CloudUser & {
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  recoveryCodeHash: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
};

export type SessionRecord = {
  id: string;
  userId: string;
  expiresAt: string;
};

export interface AuthRepository {
  findCredential(loginName: string): Promise<CredentialRecord | null>;
  isLoginNameAvailable(loginName: string): Promise<boolean>;
  createAccount(input: {
    user: CloudUser;
    workspace: Omit<CloudWorkspace, 'role'>;
    passwordHash: string;
    passwordSalt: string;
    passwordIterations: number;
    recoveryCodeHash: string;
    modules: Array<{ moduleKey: string; position: number }>;
    labels: Array<{ key: string; value: string }>;
  }): Promise<void>;
  recordFailedLogin(userId: string, lockedUntil: string | null): Promise<void>;
  clearFailedLogins(userId: string): Promise<void>;
  createSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    userAgentHint: string | null;
  }): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(sessionId: string): Promise<void>;
  revokeSession(sessionId: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<void>;
  loadAccount(userId: string): Promise<AuthenticatedAccount | null>;
  replacePassword(input: {
    userId: string;
    passwordHash: string;
    passwordSalt: string;
    passwordIterations: number;
    recoveryCodeHash: string;
  }): Promise<void>;
}

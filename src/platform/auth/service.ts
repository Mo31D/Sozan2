import type { AuthRepository, AuthenticatedAccount, CloudUser, CloudWorkspace } from './contracts';
import {
  createPasswordHash,
  createRecoveryCode,
  createSessionToken,
  hashRecoveryCode,
  hashSessionToken,
  normalizeLoginName,
  SESSION_TTL_SECONDS,
  verifyPassword,
} from './security';

const LOGIN_RE = /^[\p{L}\p{N}._-]{3,64}$/u;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export class AuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type SessionIssue = {
  token: string;
  expiresAt: string;
  account: AuthenticatedAccount;
};

function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
}

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async register(input: {
    loginName: string;
    password: string;
    displayName: string;
    locale: string;
    timezone: string;
    workspaceName: string;
    templateKey: string;
    currencyCode: string;
    currencyLabel: string;
    modules: Array<{ moduleKey: string; position: number }>;
    labels: Array<{ key: string; value: string }>;
    userAgentHint?: string | null;
  }): Promise<SessionIssue & { recoveryCode: string }> {
    const loginName = normalizeLoginName(input.loginName);
    if (!LOGIN_RE.test(loginName)) throw new AuthError('LOGIN_NAME_INVALID');
    if (!input.displayName.trim() || !input.workspaceName.trim()) throw new AuthError('NAME_REQUIRED');
    if (!(await this.repository.isLoginNameAvailable(loginName))) {
      throw new AuthError('LOGIN_NAME_TAKEN');
    }

    const userId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const password = await createPasswordHash(input.password);
    const recovery = await createRecoveryCode();

    const user: CloudUser = {
      id: userId,
      loginName,
      displayName: input.displayName.trim(),
      locale: input.locale,
      timezone: input.timezone,
    };
    const workspace: Omit<CloudWorkspace, 'role'> = {
      id: workspaceId,
      name: input.workspaceName.trim(),
      templateKey: input.templateKey,
      locale: input.locale,
      timezone: input.timezone,
      currencyCode: input.currencyCode,
      currencyLabel: input.currencyLabel,
    };

    await this.repository.createAccount({
      user,
      workspace,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordIterations: password.iterations,
      recoveryCodeHash: recovery.hash,
      modules: input.modules,
      labels: input.labels,
    });

    const session = await this.issueSession(userId, input.userAgentHint ?? null);
    const account = await this.repository.loadAccount(userId);
    if (!account) throw new AuthError('ACCOUNT_BOOTSTRAP_FAILED');
    return { ...session, account, recoveryCode: recovery.code };
  }

  async login(input: {
    loginName: string;
    password: string;
    userAgentHint?: string | null;
  }): Promise<SessionIssue> {
    const loginName = normalizeLoginName(input.loginName);
    const credential = await this.repository.findCredential(loginName);
    if (!credential) throw new AuthError('INVALID_CREDENTIALS');

    if (credential.lockedUntil && Date.parse(credential.lockedUntil) > Date.now()) {
      throw new AuthError('ACCOUNT_TEMPORARILY_LOCKED');
    }

    const valid = await verifyPassword(
      input.password,
      credential.passwordHash,
      credential.passwordSalt,
      credential.passwordIterations,
    );
    if (!valid) {
      const nextAttempts = credential.failedAttempts + 1;
      const lockedUntil = nextAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
        : null;
      await this.repository.recordFailedLogin(credential.id, lockedUntil);
      throw new AuthError(lockedUntil ? 'ACCOUNT_TEMPORARILY_LOCKED' : 'INVALID_CREDENTIALS');
    }

    await this.repository.clearFailedLogins(credential.id);
    const session = await this.issueSession(credential.id, input.userAgentHint ?? null);
    const account = await this.repository.loadAccount(credential.id);
    if (!account) throw new AuthError('ACCOUNT_NOT_FOUND');
    return { ...session, account };
  }

  async authenticate(token: string): Promise<{ sessionId: string; account: AuthenticatedAccount }> {
    const tokenHash = await hashSessionToken(token);
    const session = await this.repository.findSession(tokenHash);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      throw new AuthError('UNAUTHENTICATED');
    }
    const account = await this.repository.loadAccount(session.userId);
    if (!account) throw new AuthError('UNAUTHENTICATED');
    await this.repository.touchSession(session.id);
    return { sessionId: session.id, account };
  }

  async logout(token: string): Promise<void> {
    const session = await this.repository.findSession(await hashSessionToken(token));
    if (session) await this.repository.revokeSession(session.id);
  }

  async recover(input: {
    loginName: string;
    recoveryCode: string;
    newPassword: string;
  }): Promise<{ recoveryCode: string }> {
    const credential = await this.repository.findCredential(normalizeLoginName(input.loginName));
    if (!credential?.recoveryCodeHash) throw new AuthError('RECOVERY_FAILED');
    const suppliedHash = await hashRecoveryCode(input.recoveryCode);
    if (suppliedHash !== credential.recoveryCodeHash) throw new AuthError('RECOVERY_FAILED');

    const password = await createPasswordHash(input.newPassword);
    const recovery = await createRecoveryCode();
    await this.repository.replacePassword({
      userId: credential.id,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordIterations: password.iterations,
      recoveryCodeHash: recovery.hash,
    });
    await this.repository.revokeAllSessions(credential.id);
    return { recoveryCode: recovery.code };
  }

  private async issueSession(userId: string, userAgentHint: string | null): Promise<{
    token: string;
    expiresAt: string;
  }> {
    const token = await createSessionToken();
    const expiresAt = sessionExpiry();
    await this.repository.createSession({
      id: crypto.randomUUID(),
      userId,
      tokenHash: token.hash,
      expiresAt,
      userAgentHint,
    });
    return { token: token.token, expiresAt };
  }
}

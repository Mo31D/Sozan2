import type {
  AuthRepository,
  AuthenticatedAccount,
  CloudWorkspace,
  CredentialRecord,
  SessionRecord,
} from '../../../platform/auth/contracts';

type CredentialRow = {
  id: string;
  login_name: string;
  display_name: string;
  locale: string;
  timezone: string;
  password_hash: string;
  password_salt: string | null;
  password_iterations: number;
  recovery_code_hash: string | null;
  failed_attempts: number;
  locked_until: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  expires_at: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  template_key: string;
  locale: string;
  timezone: string;
  currency_code: string;
  currency_label: string;
  role: CloudWorkspace['role'];
};

export class D1AuthRepository implements AuthRepository {
  constructor(private readonly db: D1Database) {}

  async findCredential(loginName: string): Promise<CredentialRecord | null> {
    const row = await this.db.prepare(
      `SELECT u.id, u.login_name, u.display_name, u.locale, u.timezone,
              c.password_hash, c.password_salt, c.password_iterations,
              c.recovery_code_hash, c.failed_attempts, c.locked_until
       FROM core_users u
       JOIN core_auth_credentials c ON c.user_id = u.id
       WHERE u.login_name = ?1 COLLATE NOCASE AND u.active = 1`,
    ).bind(loginName).first<CredentialRow>();

    if (!row?.password_salt) return null;
    return {
      id: row.id,
      loginName: row.login_name,
      displayName: row.display_name,
      locale: row.locale,
      timezone: row.timezone,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      passwordIterations: row.password_iterations,
      recoveryCodeHash: row.recovery_code_hash,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until,
    };
  }

  async isLoginNameAvailable(loginName: string): Promise<boolean> {
    const row = await this.db.prepare(
      `SELECT 1 AS found FROM core_users WHERE login_name = ?1 COLLATE NOCASE LIMIT 1`,
    ).bind(loginName).first<{ found: number }>();
    return !row;
  }

  async createAccount(input: Parameters<AuthRepository['createAccount']>[0]): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `INSERT INTO core_users(id, login_name, display_name, locale, timezone)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(
        input.user.id,
        input.user.loginName,
        input.user.displayName,
        input.user.locale,
        input.user.timezone,
      ),
      this.db.prepare(
        `INSERT INTO core_auth_credentials(
           user_id, password_hash, password_salt, password_iterations,
           recovery_code_hash, password_changed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)`,
      ).bind(
        input.user.id,
        input.passwordHash,
        input.passwordSalt,
        input.passwordIterations,
        input.recoveryCodeHash,
      ),
      this.db.prepare(
        `INSERT INTO core_workspaces(
           id, name, template_key, locale, timezone, currency_code, currency_label, owner_user_id
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        input.workspace.id,
        input.workspace.name,
        input.workspace.templateKey,
        input.workspace.locale,
        input.workspace.timezone,
        input.workspace.currencyCode,
        input.workspace.currencyLabel,
        input.user.id,
      ),
      this.db.prepare(
        `INSERT INTO core_workspace_members(workspace_id, user_id, role)
         VALUES (?1, ?2, 'owner')`,
      ).bind(input.workspace.id, input.user.id),
    ];

    for (const module of input.modules) {
      statements.push(
        this.db.prepare(
          `INSERT INTO core_workspace_modules(workspace_id, module_key, enabled, position)
           VALUES (?1, ?2, 1, ?3)`,
        ).bind(input.workspace.id, module.moduleKey, module.position),
      );
    }
    for (const label of input.labels) {
      statements.push(
        this.db.prepare(
          `INSERT INTO core_workspace_labels(workspace_id, label_key, value)
           VALUES (?1, ?2, ?3)`,
        ).bind(input.workspace.id, label.key, label.value),
      );
    }

    await this.db.batch(statements);
  }

  async recordFailedLogin(userId: string, lockedUntil: string | null): Promise<void> {
    await this.db.prepare(
      `UPDATE core_auth_credentials
       SET failed_attempts = failed_attempts + 1, locked_until = ?2, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1`,
    ).bind(userId, lockedUntil).run();
  }

  async clearFailedLogins(userId: string): Promise<void> {
    await this.db.prepare(
      `UPDATE core_auth_credentials
       SET failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1`,
    ).bind(userId).run();
  }

  async createSession(input: Parameters<AuthRepository['createSession']>[0]): Promise<void> {
    await this.db.prepare(
      `INSERT INTO core_auth_sessions(id, user_id, token_hash, expires_at, user_agent_hint)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(input.id, input.userId, input.tokenHash, input.expiresAt, input.userAgentHint).run();
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.db.prepare(
      `SELECT id, user_id, expires_at
       FROM core_auth_sessions
       WHERE token_hash = ?1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    ).bind(tokenHash).first<SessionRow>();
    return row ? { id: row.id, userId: row.user_id, expiresAt: row.expires_at } : null;
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.db.prepare(
      `UPDATE core_auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1`,
    ).bind(sessionId).run();
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.prepare(
      `UPDATE core_auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?1`,
    ).bind(sessionId).run();
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.db.prepare(
      `UPDATE core_auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1 AND revoked_at IS NULL`,
    ).bind(userId).run();
  }

  async loadAccount(userId: string): Promise<AuthenticatedAccount | null> {
    const user = await this.db.prepare(
      `SELECT id, login_name, display_name, locale, timezone
       FROM core_users WHERE id = ?1 AND active = 1`,
    ).bind(userId).first<{
      id: string;
      login_name: string | null;
      display_name: string;
      locale: string;
      timezone: string;
    }>();
    if (!user?.login_name) return null;

    const workspaces = await this.db.prepare(
      `SELECT w.id, w.name, w.template_key, w.locale, w.timezone,
              w.currency_code, w.currency_label, m.role
       FROM core_workspace_members m
       JOIN core_workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ?1 AND m.active = 1 AND w.active = 1
       ORDER BY w.created_at, w.id`,
    ).bind(userId).all<WorkspaceRow>();

    return {
      user: {
        id: user.id,
        loginName: user.login_name,
        displayName: user.display_name,
        locale: user.locale,
        timezone: user.timezone,
      },
      workspaces: (workspaces.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        templateKey: row.template_key,
        locale: row.locale,
        timezone: row.timezone,
        currencyCode: row.currency_code,
        currencyLabel: row.currency_label,
        role: row.role,
      })),
    };
  }

  async replacePassword(input: Parameters<AuthRepository['replacePassword']>[0]): Promise<void> {
    await this.db.prepare(
      `UPDATE core_auth_credentials
       SET password_hash = ?2,
           password_salt = ?3,
           password_iterations = ?4,
           recovery_code_hash = ?5,
           failed_attempts = 0,
           locked_until = NULL,
           password_changed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?1`,
    ).bind(
      input.userId,
      input.passwordHash,
      input.passwordSalt,
      input.passwordIterations,
      input.recoveryCodeHash,
    ).run();
  }
}

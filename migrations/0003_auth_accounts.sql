-- Cloud accounts for multi-device access. No paid auth provider is required.
-- The login name is case-insensitive. Passwords/recovery codes are never stored raw.

ALTER TABLE core_users ADD COLUMN login_name TEXT COLLATE NOCASE;
ALTER TABLE core_users ADD COLUMN email TEXT COLLATE NOCASE;

CREATE UNIQUE INDEX idx_core_users_login_name
  ON core_users(login_name)
  WHERE login_name IS NOT NULL;

CREATE UNIQUE INDEX idx_core_users_email
  ON core_users(email)
  WHERE email IS NOT NULL;

-- Replace the original passcode-oriented credential shape with account credentials.
ALTER TABLE core_auth_credentials RENAME COLUMN passcode_hash TO password_hash;
ALTER TABLE core_auth_credentials ADD COLUMN password_salt TEXT;
ALTER TABLE core_auth_credentials ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 210000
  CHECK (password_iterations BETWEEN 100000 AND 1000000);
ALTER TABLE core_auth_credentials ADD COLUMN recovery_code_hash TEXT;
ALTER TABLE core_auth_credentials ADD COLUMN password_changed_at TEXT;

CREATE TABLE core_auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent_hint TEXT,
  FOREIGN KEY (user_id) REFERENCES core_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_core_auth_sessions_user
  ON core_auth_sessions(user_id, revoked_at, expires_at);

-- Small D1-backed limiter. It protects account endpoints without a third-party service.
CREATE TABLE core_auth_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR REPLACE INTO core_schema_meta(key, value)
VALUES ('auth_accounts', '1');

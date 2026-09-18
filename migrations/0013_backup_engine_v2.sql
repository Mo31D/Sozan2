PRAGMA foreign_keys = ON;

-- Backup Engine V2 import journal.
-- Import IDs make full-workspace replacement idempotent and recoverable when
-- the client loses the HTTP response after the cloud commit has already landed.
CREATE TABLE core_backup_imports (
  workspace_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  backup_fingerprint TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  status TEXT NOT NULL CHECK (status IN ('applying', 'completed', 'failed')),
  applied_revision INTEGER CHECK (applied_revision IS NULL OR applied_revision >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  PRIMARY KEY (workspace_id, import_id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_backup_imports_workspace_created
  ON core_backup_imports(workspace_id, created_at DESC);

INSERT OR REPLACE INTO core_schema_meta(key, value, updated_at)
VALUES ('backup_engine', '2', CURRENT_TIMESTAMP);

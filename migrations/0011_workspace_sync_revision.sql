PRAGMA foreign_keys = ON;

-- Workspace-wide optimistic concurrency token for cloud sync.
-- A push reserves the next revision with one compare-and-swap UPDATE before it
-- applies any mutations. Two devices cannot both write from the same base
-- revision.
CREATE TABLE core_workspace_sync_revisions (
  workspace_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO core_workspace_sync_revisions(workspace_id, revision)
SELECT id, 0 FROM core_workspaces;

INSERT OR REPLACE INTO core_schema_meta(key, value, updated_at)
VALUES ('workspace_sync_revision', '1', CURRENT_TIMESTAMP);

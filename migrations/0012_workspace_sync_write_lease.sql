PRAGMA foreign_keys = ON;

ALTER TABLE core_workspace_sync_revisions ADD COLUMN writer_token TEXT;
ALTER TABLE core_workspace_sync_revisions ADD COLUMN write_started_at TEXT;

CREATE INDEX idx_workspace_sync_revision_writer
  ON core_workspace_sync_revisions(writer_token, write_started_at);

INSERT OR REPLACE INTO core_schema_meta(key, value, updated_at)
VALUES ('workspace_sync_write_lease', '1', CURRENT_TIMESTAMP);

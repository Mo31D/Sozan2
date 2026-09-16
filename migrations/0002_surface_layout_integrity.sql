-- SQLite permits NULLs in composite PRIMARY KEY columns on ordinary rowid tables.
-- These partial unique indexes make workspace-default and per-user layouts explicit.

CREATE UNIQUE INDEX idx_core_surface_layout_workspace_default
  ON core_surface_layouts(workspace_id, surface_key)
  WHERE user_id IS NULL;

CREATE UNIQUE INDEX idx_core_surface_layout_user
  ON core_surface_layouts(workspace_id, user_id, surface_key)
  WHERE user_id IS NOT NULL;

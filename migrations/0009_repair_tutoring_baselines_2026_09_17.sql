PRAGMA foreign_keys = ON;

-- Historical filename retained for migration ordering only.
-- The original tenant-specific baseline repair was intentionally removed from
-- source control. Tenant data repairs belong in an authenticated admin/data
-- migration channel, never in reusable schema migrations.
INSERT OR REPLACE INTO core_schema_meta(key, value, updated_at)
VALUES ('tenant_baseline_repairs_externalized', '1', CURRENT_TIMESTAMP);

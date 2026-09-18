PRAGMA foreign_keys = ON;

-- Historical filename retained because this migration may already be recorded
-- as applied in deployed D1 databases.
--
-- IMPORTANT: tenant/customer/student data must never live in source-controlled
-- schema migrations. The original one-off data correction that used this
-- filename has been removed from the repository. Production databases that
-- already applied it keep their data; fresh databases intentionally do nothing.
INSERT OR REPLACE INTO core_schema_meta(key, value, updated_at)
VALUES ('tenant_data_migrations_externalized', '1', CURRENT_TIMESTAMP);

PRAGMA foreign_keys = ON;

-- Product hardening: cash reconciliation entries are auditable/correctable in the
-- same way as receipts, expenses and other income. Existing rows remain active.
ALTER TABLE finance_cash_checks ADD COLUMN deleted_at TEXT;
ALTER TABLE finance_cash_checks ADD COLUMN updated_at TEXT;
UPDATE finance_cash_checks SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_finance_cash_checks_active
  ON finance_cash_checks(workspace_id, check_date, deleted_at, id);

INSERT OR REPLACE INTO core_schema_meta(key, value, updated_at)
VALUES ('schema_version', '5', CURRENT_TIMESTAMP);

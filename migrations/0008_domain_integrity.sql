PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- TUTORING: observed pre-system lesson counts are facts about history, not a
-- billing configuration. Store them independently from billing plans/cycles.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tutoring_student_baselines (
  workspace_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  completed_lessons_before_tracking INTEGER NOT NULL CHECK (completed_lessons_before_tracking >= 0),
  source_note TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, student_id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, student_id) REFERENCES tutoring_students(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tutoring_student_baselines_workspace
  ON tutoring_student_baselines(workspace_id, student_id);

-- ---------------------------------------------------------------------------
-- FINANCE: enforce conservation of receipt money at the persistence boundary.
-- Service code is retry-safe too, but storage must independently prevent a
-- receipt from being allocated for more than the amount actually received.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_finance_allocation_guard_insert;
CREATE TRIGGER trg_finance_allocation_guard_insert
BEFORE INSERT ON finance_receipt_allocations
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_receipts r
      WHERE r.workspace_id=NEW.workspace_id
        AND r.id=NEW.receipt_id
        AND r.deleted_at IS NULL
    ) THEN RAISE(ABORT, 'RECEIPT_NOT_FOUND')
  END;

  SELECT CASE
    WHEN COALESCE((
      SELECT SUM(a.amount_pence)
      FROM finance_receipt_allocations a
      WHERE a.workspace_id=NEW.workspace_id
        AND a.receipt_id=NEW.receipt_id
    ),0) + NEW.amount_pence > (
      SELECT r.amount_pence
      FROM finance_receipts r
      WHERE r.workspace_id=NEW.workspace_id
        AND r.id=NEW.receipt_id
        AND r.deleted_at IS NULL
    ) THEN RAISE(ABORT, 'RECEIPT_ALLOCATION_EXCEEDS_AMOUNT')
  END;
END;

DROP TRIGGER IF EXISTS trg_finance_allocation_guard_update;
CREATE TRIGGER trg_finance_allocation_guard_update
BEFORE UPDATE OF workspace_id, receipt_id, amount_pence ON finance_receipt_allocations
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM finance_receipts r
      WHERE r.workspace_id=NEW.workspace_id
        AND r.id=NEW.receipt_id
        AND r.deleted_at IS NULL
    ) THEN RAISE(ABORT, 'RECEIPT_NOT_FOUND')
  END;

  SELECT CASE
    WHEN COALESCE((
      SELECT SUM(a.amount_pence)
      FROM finance_receipt_allocations a
      WHERE a.workspace_id=NEW.workspace_id
        AND a.receipt_id=NEW.receipt_id
        AND a.id<>OLD.id
    ),0) + NEW.amount_pence > (
      SELECT r.amount_pence
      FROM finance_receipts r
      WHERE r.workspace_id=NEW.workspace_id
        AND r.id=NEW.receipt_id
        AND r.deleted_at IS NULL
    ) THEN RAISE(ABORT, 'RECEIPT_ALLOCATION_EXCEEDS_AMOUNT')
  END;
END;

CREATE VIEW IF NOT EXISTS finance_allocation_integrity_violations AS
SELECT
  r.workspace_id,
  r.id AS receipt_id,
  r.amount_pence AS receipt_amount_pence,
  COALESCE(SUM(a.amount_pence),0) AS allocated_pence
FROM finance_receipts r
LEFT JOIN finance_receipt_allocations a
  ON a.workspace_id=r.workspace_id AND a.receipt_id=r.id
WHERE r.deleted_at IS NULL
GROUP BY r.workspace_id, r.id
HAVING COALESCE(SUM(a.amount_pence),0) > r.amount_pence;

INSERT OR REPLACE INTO core_schema_meta(key, value, updated_at)
VALUES
  ('tutoring_student_baselines', '1', CURRENT_TIMESTAMP),
  ('finance_receipt_allocation_guard', '1', CURRENT_TIMESTAMP);

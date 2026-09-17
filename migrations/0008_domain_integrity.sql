PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- TUTORING: separate observed pre-system lesson counts from billing.
--
-- A paper count says how many lessons had already happened. It does not, by
-- itself, prove package size, price, or even billing mode. Keep that fact in a
-- neutral tutoring table and let billing remain unconfigured until explicitly
-- supplied by the user.
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

WITH baseline(student_id, completed) AS (
  VALUES
    ('074a0fb8-e41b-5805-9a01-8c1a9c2fe1e9',2),
    ('4a8667e8-2c2d-596e-8608-f0533fe211e8',2),
    ('76606fd7-1949-571c-9075-e05c5b8e96b7',2),
    ('17c41524-df99-5ba1-8a63-47a5b3153143',2),
    ('7e8da426-8129-5a81-92d1-17b4a1f35fd1',5),
    ('93ed6a6d-fe3a-5af9-b828-18a9285a1739',7),
    ('c7366468-d86f-594d-88fe-576c18c5a0d4',4),
    ('d74ea2a6-9792-5b00-b221-c3a30d96a76c',7),
    ('e3569fef-8867-5d76-a3ed-27b1d297f524',2),
    ('c7a5a3cf-a855-5ea4-b722-d13071482563',2),
    ('f07e8487-4e2d-5ae7-b84f-14af1dfc5c45',3),
    ('10a567b1-646a-579a-a574-37dadfd40ddb',3),
    ('be986860-cd58-5aa1-97cd-56fa41d2d804',1),
    ('066ee55b-4dfe-5e78-afbb-a02a3fab5725',3),
    ('0bd74a8f-befd-55e7-9df5-5baddf0a388f',3),
    ('c592b234-5f25-5298-8c60-09222de350aa',8),
    ('ae978dbf-00ac-5fda-821b-3ad5ce2b0339',5),
    ('4c39497c-b89b-5c66-acd9-aada19f2ad50',7)
)
INSERT INTO tutoring_student_baselines(
  workspace_id, student_id, completed_lessons_before_tracking, source_note, observed_at
)
SELECT
  'fb71d118-de05-4fe0-9001-c7a764adc0ff',
  baseline.student_id,
  baseline.completed,
  'العدد المكتوب بجوار الطالب في الورقة البيضاء؛ عدد حصص سابقة وليس تعريفًا لنظام الدفع.',
  '2026-09-17'
FROM baseline
JOIN tutoring_students s
  ON s.workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff'
 AND s.id=baseline.student_id
WHERE EXISTS (
  SELECT 1 FROM core_workspaces
  WHERE id='fb71d118-de05-4fe0-9001-c7a764adc0ff'
)
ON CONFLICT(workspace_id, student_id) DO UPDATE SET
  completed_lessons_before_tracking=excluded.completed_lessons_before_tracking,
  source_note=excluded.source_note,
  observed_at=excluded.observed_at,
  updated_at=CURRENT_TIMESTAMP;

-- Remove only the exact zero-value cycles synthesized by migration 0007, and
-- only if no real occurrence has subsequently been attached. Any cycle that
-- has acquired real history is left intact rather than rewritten destructively.
DELETE FROM tutoring_billing_cycles
WHERE workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff'
  AND price_pence=0
  AND id IN (
    '6ad6bcba-50ad-5c6e-8fb1-0343f894b4ff',
    '5d2aea81-bc66-56cc-b5d4-7ae9861b7229',
    'f99819dc-fb0a-5de6-a288-83a5a4a24401',
    '79d2bc49-fbce-567b-a37c-a9ccc8e09dff',
    'aee4e914-f43f-5fdd-8591-1841a9960ff9',
    '70dc1a42-d319-546f-945e-62dd13a0ac01',
    '3600ae3b-caee-5bbd-8e2e-1235f3691794',
    '99d71a3c-49c6-56b4-ba23-4011ad63fa71',
    'd014eca8-9b31-5ec3-bc43-3f691e3015e8',
    'a765624d-b0a9-58b5-987a-7b55123f254a',
    '0356a055-52ad-5176-bba7-47046ca404b4',
    'c3ecad76-f6f5-53a0-917c-b5d148f1a00a',
    'af10ecff-487c-5bf5-b69c-605754cae69a',
    '96c1f8df-a8ae-5ce7-80a0-9bdb64c9a12c',
    'dd945541-3329-50e6-88b4-1d78c4461715',
    '59186dda-7fbe-5597-b198-9369e6eab705',
    '5757d6d3-5203-5955-934f-9f686a662f0e',
    '91737e14-8dc1-5a64-b4af-8a168f921959'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM tutoring_billing_cycle_occurrences co
    WHERE co.workspace_id=tutoring_billing_cycles.workspace_id
      AND co.billing_cycle_id=tutoring_billing_cycles.id
  );

-- A zero-price 8-session plan created by the migration is not a financial fact.
-- Remove it only when its signature is still exactly synthetic and no cycle is
-- left for that student. Explicit user changes therefore survive this cleanup.
DELETE FROM tutoring_billing_plans
WHERE workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff'
  AND billing_mode='package'
  AND package_size=8
  AND package_price_pence=0
  AND cycle_anchor_date='2026-09-15'
  AND effective_from='2026-09-15 21:27:29'
  AND NOT EXISTS (
    SELECT 1
    FROM tutoring_billing_cycles c
    WHERE c.workspace_id=tutoring_billing_plans.workspace_id
      AND c.student_id=tutoring_billing_plans.student_id
  );

-- ---------------------------------------------------------------------------
-- FINANCE: enforce conservation of receipt money at the persistence boundary.
-- Service code is retry-safe too, but the database must independently prevent
-- allocations from ever summing to more than their receipt.
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

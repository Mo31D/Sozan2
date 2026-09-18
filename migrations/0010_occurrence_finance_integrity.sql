PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- TUTORING OCCURRENCE INTEGRITY
-- Completed lessons own their participant list and work-time snapshot. A
-- recurring-session edit must never rewrite historical attendance or reports.
-- ---------------------------------------------------------------------------
ALTER TABLE tutoring_recurring_sessions ADD COLUMN payer_student_id TEXT;

ALTER TABLE tutoring_occurrences ADD COLUMN duration_minutes_snapshot INTEGER;
ALTER TABLE tutoring_occurrences ADD COLUMN travel_minutes_snapshot INTEGER;
ALTER TABLE tutoring_occurrences ADD COLUMN session_type_snapshot TEXT;
ALTER TABLE tutoring_occurrences ADD COLUMN location_snapshot TEXT;

CREATE TABLE tutoring_occurrence_students (
  workspace_id TEXT NOT NULL,
  occurrence_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  attendance_status TEXT NOT NULL CHECK (attendance_status IN ('attended','absent','excused')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (occurrence_id, student_id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, occurrence_id) REFERENCES tutoring_occurrences(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, student_id) REFERENCES tutoring_students(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_tutoring_occurrence_students_student
  ON tutoring_occurrence_students(workspace_id, student_id, occurrence_id);

-- Existing completed group lessons historically treated every linked student as
-- present. Preserve that exact legacy meaning while making future attendance
-- explicit per student.
INSERT OR IGNORE INTO tutoring_occurrence_students(
  workspace_id, occurrence_id, student_id, attendance_status
)
SELECT o.workspace_id, o.id, ss.student_id, 'attended'
FROM tutoring_occurrences o
JOIN tutoring_session_students ss
  ON ss.workspace_id=o.workspace_id
 AND ss.recurring_session_id=o.recurring_session_id
WHERE o.status='completed';

UPDATE tutoring_occurrences
SET duration_minutes_snapshot = (
      SELECT s.duration_minutes
      FROM tutoring_recurring_sessions s
      WHERE s.workspace_id=tutoring_occurrences.workspace_id
        AND s.id=tutoring_occurrences.recurring_session_id
    ),
    travel_minutes_snapshot = (
      SELECT s.travel_minutes
      FROM tutoring_recurring_sessions s
      WHERE s.workspace_id=tutoring_occurrences.workspace_id
        AND s.id=tutoring_occurrences.recurring_session_id
    ),
    session_type_snapshot = (
      SELECT s.session_type
      FROM tutoring_recurring_sessions s
      WHERE s.workspace_id=tutoring_occurrences.workspace_id
        AND s.id=tutoring_occurrences.recurring_session_id
    ),
    location_snapshot = (
      SELECT s.location
      FROM tutoring_recurring_sessions s
      WHERE s.workspace_id=tutoring_occurrences.workspace_id
        AND s.id=tutoring_occurrences.recurring_session_id
    )
WHERE status='completed';

-- A one-student total-session lesson has an unambiguous payer. Group sessions
-- remain unassigned until the user explicitly chooses who is billed.
UPDATE tutoring_recurring_sessions
SET payer_student_id = (
  SELECT MIN(ss.student_id)
  FROM tutoring_session_students ss
  WHERE ss.workspace_id=tutoring_recurring_sessions.workspace_id
    AND ss.recurring_session_id=tutoring_recurring_sessions.id
)
WHERE (
  SELECT COUNT(*)
  FROM tutoring_session_students ss
  WHERE ss.workspace_id=tutoring_recurring_sessions.workspace_id
    AND ss.recurring_session_id=tutoring_recurring_sessions.id
)=1;

-- ---------------------------------------------------------------------------
-- FINANCE TARGET ISOLATION
-- A per-student charge in a group lesson must not share one allocation target
-- with another student. Convert legacy tutoring occurrence allocations to a
-- payer-scoped target.
-- ---------------------------------------------------------------------------
UPDATE finance_receipt_allocations
SET target_type='student_occurrence',
    target_id=target_id || ':' || (
      SELECT r.payer_ref_id
      FROM finance_receipts r
      WHERE r.workspace_id=finance_receipt_allocations.workspace_id
        AND r.id=finance_receipt_allocations.receipt_id
    )
WHERE target_module='tutoring'
  AND target_type='occurrence'
  AND EXISTS (
    SELECT 1
    FROM finance_receipts r
    WHERE r.workspace_id=finance_receipt_allocations.workspace_id
      AND r.id=finance_receipt_allocations.receipt_id
      AND r.payer_ref_type='tutoring.student'
      AND r.payer_ref_id IS NOT NULL
  );

-- Receipt edits are not allowed to create an over-allocated receipt even
-- transiently. Corrections must first release/rebuild the relevant allocation.
DROP TRIGGER IF EXISTS trg_finance_receipt_amount_guard_update;
CREATE TRIGGER trg_finance_receipt_amount_guard_update
BEFORE UPDATE OF amount_pence, deleted_at ON finance_receipts
BEGIN
  SELECT RAISE(ABORT, 'RECEIPT_ALLOCATION_EXCEEDS_AMOUNT')
  WHERE NEW.deleted_at IS NULL
    AND COALESCE((
      SELECT SUM(a.amount_pence)
      FROM finance_receipt_allocations a
      WHERE a.workspace_id=NEW.workspace_id
        AND a.receipt_id=NEW.id
    ),0) > NEW.amount_pence;
END;

INSERT OR REPLACE INTO core_schema_meta(key, value, updated_at)
VALUES
  ('tutoring_occurrence_attendance', '1', CURRENT_TIMESTAMP),
  ('tutoring_occurrence_work_snapshot', '1', CURRENT_TIMESTAMP),
  ('tutoring_session_payer', '1', CURRENT_TIMESTAMP),
  ('tutoring_student_occurrence_targets', '1', CURRENT_TIMESTAMP),
  ('finance_receipt_update_guard', '1', CURRENT_TIMESTAMP);

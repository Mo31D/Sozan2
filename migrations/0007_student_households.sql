-- Student household/family grouping is tutoring-owned entity metadata.
-- It is intentionally nullable and does not alter billing, attendance or finance.
ALTER TABLE tutoring_students ADD COLUMN family_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tutoring_students_family
  ON tutoring_students(workspace_id, family_id, active);

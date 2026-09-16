-- A group lesson may advance multiple students' package cycles.
-- The original UNIQUE(occurrence_id) incorrectly allowed only one student cycle.

DROP INDEX IF EXISTS idx_tutoring_cycle_occurrences_cycle;
ALTER TABLE tutoring_billing_cycle_occurrences RENAME TO tutoring_billing_cycle_occurrences_old;

CREATE TABLE tutoring_billing_cycle_occurrences (
  workspace_id TEXT NOT NULL,
  billing_cycle_id TEXT NOT NULL,
  occurrence_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  earned_pence INTEGER NOT NULL DEFAULT 0 CHECK (earned_pence >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (billing_cycle_id, occurrence_id),
  UNIQUE (billing_cycle_id, position),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, billing_cycle_id) REFERENCES tutoring_billing_cycles(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, occurrence_id) REFERENCES tutoring_occurrences(workspace_id, id) ON DELETE RESTRICT
);

INSERT INTO tutoring_billing_cycle_occurrences(
  workspace_id, billing_cycle_id, occurrence_id, position, earned_pence, created_at
)
SELECT workspace_id, billing_cycle_id, occurrence_id, position, earned_pence, created_at
FROM tutoring_billing_cycle_occurrences_old;

DROP TABLE tutoring_billing_cycle_occurrences_old;

CREATE INDEX idx_tutoring_cycle_occurrences_cycle
  ON tutoring_billing_cycle_occurrences(workspace_id, billing_cycle_id, position);
CREATE INDEX idx_tutoring_cycle_occurrences_occurrence
  ON tutoring_billing_cycle_occurrences(workspace_id, occurrence_id);

INSERT OR REPLACE INTO core_schema_meta(key, value)
VALUES ('group_package_occurrences', '1');

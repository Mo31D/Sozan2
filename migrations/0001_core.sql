PRAGMA foreign_keys = ON;

-- Sozan2 initial schema.
-- This file is intentionally comprehensive because no Sozan2 D1 database has
-- been created yet. Product history belongs in migration/import tooling, not
-- in runtime compatibility code.

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age INTEGER CHECK (age IS NULL OR age BETWEEN 1 AND 120),
  guardian_name TEXT,
  guardian_phone TEXT,
  level TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE recurring_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (
    session_type IN ('private_student_home', 'private_sozan_home', 'online', 'center_group', 'own_group')
  ),
  schedule_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (schedule_status IN ('confirmed', 'pending')),
  weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  start_time TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 15 AND 360),
  travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK (travel_minutes BETWEEN 0 AND 360),
  location TEXT,
  price_basis TEXT NOT NULL DEFAULT 'total_session' CHECK (price_basis IN ('total_session', 'per_student')),
  default_price_pence INTEGER NOT NULL DEFAULT 0 CHECK (default_price_pence >= 0),
  expected_student_count INTEGER NOT NULL DEFAULT 1 CHECK (expected_student_count BETWEEN 1 AND 100),
  center_cut_bps INTEGER NOT NULL DEFAULT 0 CHECK (center_cut_bps BETWEEN 0 AND 10000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    schedule_status = 'pending'
    OR (weekday IS NOT NULL AND start_time IS NOT NULL)
  )
);

CREATE TABLE recurring_session_students (
  recurring_session_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (recurring_session_id, student_id),
  FOREIGN KEY (recurring_session_id) REFERENCES recurring_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
);

CREATE TABLE lesson_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recurring_session_id INTEGER NOT NULL,
  session_date TEXT NOT NULL,
  scheduled_start TEXT,
  rescheduled_to_date TEXT,
  rescheduled_to_start TEXT,
  rescheduled_at TEXT,
  reschedule_note TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'completed', 'cancelled', 'missed')
  ),
  gross_pence INTEGER NOT NULL DEFAULT 0 CHECK (gross_pence >= 0),
  center_cut_pence INTEGER NOT NULL DEFAULT 0 CHECK (center_cut_pence >= 0),
  earned_pence INTEGER NOT NULL DEFAULT 0 CHECK (earned_pence >= 0),
  completed_at TEXT,
  note TEXT,
  created_from TEXT NOT NULL DEFAULT 'schedule' CHECK (created_from IN ('schedule', 'manual', 'migration')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (recurring_session_id, session_date),
  FOREIGN KEY (recurring_session_id) REFERENCES recurring_sessions(id) ON DELETE RESTRICT
);

-- Current student-level billing configuration. Historical package terms are
-- snapshotted onto billing_cycles, so changing a future plan never rewrites history.
CREATE TABLE billing_plans (
  student_id INTEGER PRIMARY KEY,
  billing_mode TEXT NOT NULL DEFAULT 'per_session' CHECK (billing_mode IN ('per_session', 'package')),
  package_size INTEGER CHECK (package_size IS NULL OR package_size BETWEEN 1 AND 100),
  package_price_pence INTEGER CHECK (package_price_pence IS NULL OR package_price_pence >= 0),
  cycle_anchor_date TEXT,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (billing_mode = 'per_session' AND package_size IS NULL AND package_price_pence IS NULL)
    OR
    (billing_mode = 'package' AND package_size IS NOT NULL AND package_price_pence IS NOT NULL)
  ),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
);

-- Opening progress is first-class data. It replaces Sozan1's hidden shadow
-- sessions and synthetic occurrences used when a student joins mid-package.
CREATE TABLE billing_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL,
  session_limit INTEGER NOT NULL CHECK (session_limit BETWEEN 1 AND 100),
  price_pence INTEGER NOT NULL CHECK (price_pence >= 0),
  opening_completed_count INTEGER NOT NULL DEFAULT 0,
  opening_progress_locked_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'due', 'paid', 'cancelled')),
  started_on TEXT,
  completed_on TEXT,
  paid_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, sequence_no),
  CHECK (opening_completed_count BETWEEN 0 AND session_limit),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
);

CREATE TABLE billing_cycle_occurrences (
  billing_cycle_id INTEGER NOT NULL,
  occurrence_id INTEGER NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK (position > 0),
  earned_pence INTEGER NOT NULL DEFAULT 0 CHECK (earned_pence >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (billing_cycle_id, occurrence_id),
  UNIQUE (billing_cycle_id, position),
  FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (occurrence_id) REFERENCES lesson_occurrences(id) ON DELETE RESTRICT
);

-- Every amount received from a student uses one canonical receipt model.
-- "Completed and paid" creates a receipt with source_kind='lesson_quick'; it
-- does not create a second payment ledger.
CREATE TABLE receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  received_at TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'wallet', 'other')),
  source_kind TEXT NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('manual', 'lesson_quick', 'migration')),
  source_occurrence_id INTEGER,
  note TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    source_kind <> 'lesson_quick'
    OR source_occurrence_id IS NOT NULL
  ),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_occurrence_id) REFERENCES lesson_occurrences(id) ON DELETE RESTRICT
);

CREATE TABLE receipt_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL,
  occurrence_id INTEGER,
  billing_cycle_id INTEGER,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (occurrence_id IS NOT NULL AND billing_cycle_id IS NULL)
    OR
    (occurrence_id IS NULL AND billing_cycle_id IS NOT NULL)
  ),
  FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
  FOREIGN KEY (occurrence_id) REFERENCES lesson_occurrences(id) ON DELETE RESTRICT,
  FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id) ON DELETE RESTRICT
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_date TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('business', 'personal')),
  category TEXT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  note TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE other_income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  income_date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  note TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cash_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_date TEXT NOT NULL,
  expected_balance_pence INTEGER NOT NULL,
  actual_balance_pence INTEGER NOT NULL,
  difference_pence INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  before_json TEXT,
  after_json TEXT,
  undoable INTEGER NOT NULL DEFAULT 0 CHECK (undoable IN (0, 1)),
  undone_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotency is a platform concern, not a version patch. API mutations may
-- provide a stable key and replay a completed response instead of duplicating money.
CREATE TABLE mutation_dedupe (
  dedupe_key TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  response_status INTEGER,
  response_body TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_students_active ON students(active, deleted_at);
CREATE INDEX idx_sessions_schedule ON recurring_sessions(active, schedule_status, weekday, start_time);
CREATE INDEX idx_session_students_student ON recurring_session_students(student_id, recurring_session_id);
CREATE INDEX idx_occurrences_date ON lesson_occurrences(session_date, status);
CREATE INDEX idx_occurrences_rescheduled ON lesson_occurrences(rescheduled_to_date, status);
CREATE INDEX idx_occurrences_session_status ON lesson_occurrences(recurring_session_id, status, session_date);
CREATE INDEX idx_billing_cycles_student ON billing_cycles(student_id, status, sequence_no);
CREATE INDEX idx_billing_cycle_occurrences_cycle ON billing_cycle_occurrences(billing_cycle_id, position);
CREATE INDEX idx_receipts_student ON receipts(student_id, received_at, deleted_at);
CREATE INDEX idx_receipt_allocations_receipt ON receipt_allocations(receipt_id);
CREATE INDEX idx_receipt_allocations_occurrence ON receipt_allocations(occurrence_id);
CREATE INDEX idx_receipt_allocations_cycle ON receipt_allocations(billing_cycle_id);
CREATE UNIQUE INDEX idx_receipts_quick_occurrence
  ON receipts(source_occurrence_id)
  WHERE source_kind = 'lesson_quick' AND deleted_at IS NULL;
CREATE INDEX idx_expenses_date ON expenses(expense_date, deleted_at);
CREATE INDEX idx_other_income_date ON other_income(income_date, deleted_at);
CREATE INDEX idx_cash_checks_date ON cash_checks(check_date, id);
CREATE INDEX idx_activity_created ON activity_log(created_at, id);
CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id, id);
CREATE INDEX idx_mutation_dedupe_created ON mutation_dedupe(created_at);

INSERT INTO settings(key, value) VALUES ('currency_label', 'ج');
INSERT INTO settings(key, value) VALUES ('display_name', 'سوزان');
INSERT INTO settings(key, value) VALUES ('opening_balance_pence', '0');
INSERT INTO settings(key, value) VALUES ('cash_check_frequency_days', '7');
INSERT INTO settings(key, value) VALUES ('timezone', 'Europe/London');

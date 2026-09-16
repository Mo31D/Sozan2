PRAGMA foreign_keys = ON;

-- Sozan2 initial schema.
-- This is the first cloud schema and is intentionally workspace-first, modular,
-- and sync-friendly. Business modules own their tables; the core owns identity,
-- workspace configuration, module activation, layout, audit and idempotency.
--
-- IDs are TEXT so local-first records can be created offline with UUID/ULID-style
-- identifiers and later synced without integer-id collisions.

CREATE TABLE core_schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE core_users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'ar-EG',
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  avatar_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cloud authentication is optional. Local-only mode can operate without a row
-- here. Never store a plain-text passcode.
CREATE TABLE core_auth_credentials (
  user_id TEXT PRIMARY KEY,
  passcode_hash TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL DEFAULT 'pbkdf2-sha256',
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES core_users(id) ON DELETE CASCADE
);

CREATE TABLE core_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_key TEXT NOT NULL DEFAULT 'tutoring',
  locale TEXT NOT NULL DEFAULT 'ar-EG',
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  currency_code TEXT NOT NULL DEFAULT 'EGP',
  currency_label TEXT NOT NULL DEFAULT 'ج',
  owner_user_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES core_users(id) ON DELETE SET NULL
);

CREATE TABLE core_workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES core_users(id) ON DELETE CASCADE
);

-- Module definitions live in code. This table stores which modules a workspace
-- has enabled, their order, and workspace-specific module configuration.
CREATE TABLE core_workspace_modules (
  workspace_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 100,
  config_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, module_key),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

-- Terminology is presentation configuration, not domain renaming. A tutoring
-- workspace may display طالب/حصة while another template can display عميل/موعد.
CREATE TABLE core_workspace_labels (
  workspace_id TEXT NOT NULL,
  label_key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, label_key),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE core_workspace_settings (
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, key),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

-- User-customisable surfaces such as "أنا" are composed from module widgets.
-- The layout is presentation state and cannot contain canonical business totals.
CREATE TABLE core_surface_layouts (
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  surface_key TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id, surface_key),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES core_users(id) ON DELETE CASCADE
);

CREATE TABLE core_activity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  module_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  before_json TEXT,
  after_json TEXT,
  undoable INTEGER NOT NULL DEFAULT 0 CHECK (undoable IN (0, 1)),
  undone_at TEXT,
  actor_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES core_users(id) ON DELETE SET NULL
);

-- First-class idempotency. Duplicate network retries must not duplicate money,
-- attendance, expenses or other state-changing commands.
CREATE TABLE core_idempotency_keys (
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  response_status INTEGER,
  response_body TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  PRIMARY KEY (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- TUTORING MODULE
-- Product behaviour is derived from Sozan1, but the module is isolated from
-- core and from the finance implementation.
-- ---------------------------------------------------------------------------

CREATE TABLE tutoring_students (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  age INTEGER CHECK (age IS NULL OR age BETWEEN 1 AND 120),
  guardian_name TEXT,
  guardian_phone TEXT,
  level TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE tutoring_recurring_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (
    session_type IN ('private_student_home', 'private_tutor_home', 'online', 'center_group', 'own_group')
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
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  CHECK (schedule_status = 'pending' OR (weekday IS NOT NULL AND start_time IS NOT NULL)),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE tutoring_session_students (
  workspace_id TEXT NOT NULL,
  recurring_session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (recurring_session_id, student_id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, recurring_session_id) REFERENCES tutoring_recurring_sessions(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, student_id) REFERENCES tutoring_students(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE tutoring_occurrences (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  recurring_session_id TEXT NOT NULL,
  session_date TEXT NOT NULL,
  scheduled_start TEXT,
  rescheduled_to_date TEXT,
  rescheduled_to_start TEXT,
  rescheduled_at TEXT,
  reschedule_note TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'missed')),
  gross_pence INTEGER NOT NULL DEFAULT 0 CHECK (gross_pence >= 0),
  center_cut_pence INTEGER NOT NULL DEFAULT 0 CHECK (center_cut_pence >= 0),
  earned_pence INTEGER NOT NULL DEFAULT 0 CHECK (earned_pence >= 0),
  completed_at TEXT,
  note TEXT,
  created_from TEXT NOT NULL DEFAULT 'schedule' CHECK (created_from IN ('schedule', 'manual', 'migration')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (recurring_session_id, session_date),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, recurring_session_id) REFERENCES tutoring_recurring_sessions(workspace_id, id) ON DELETE RESTRICT
);

-- Current student-level billing configuration. Historical package terms are
-- snapshotted on each billing cycle so future edits never rewrite history.
CREATE TABLE tutoring_billing_plans (
  workspace_id TEXT NOT NULL,
  student_id TEXT PRIMARY KEY,
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
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, student_id) REFERENCES tutoring_students(workspace_id, id) ON DELETE RESTRICT
);

-- Opening progress is native state. No hidden session, fake lesson or synthetic
-- 1900 date is used when a student starts Sozan2 mid-package.
CREATE TABLE tutoring_billing_cycles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
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
  UNIQUE (workspace_id, id),
  UNIQUE (student_id, sequence_no),
  CHECK (opening_completed_count BETWEEN 0 AND session_limit),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, student_id) REFERENCES tutoring_students(workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE tutoring_billing_cycle_occurrences (
  workspace_id TEXT NOT NULL,
  billing_cycle_id TEXT NOT NULL,
  occurrence_id TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK (position > 0),
  earned_pence INTEGER NOT NULL DEFAULT 0 CHECK (earned_pence >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (billing_cycle_id, occurrence_id),
  UNIQUE (billing_cycle_id, position),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, billing_cycle_id) REFERENCES tutoring_billing_cycles(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, occurrence_id) REFERENCES tutoring_occurrences(workspace_id, id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- FINANCE MODULE
-- Finance does not foreign-key directly into tutoring. Cross-module references
-- are typed references validated by application services, keeping modules Lego-like.
-- ---------------------------------------------------------------------------

CREATE TABLE finance_receipts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  payer_ref_type TEXT,
  payer_ref_id TEXT,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  received_at TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'wallet', 'other')),
  source_kind TEXT NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('manual', 'quick', 'migration')),
  source_module TEXT,
  source_entity_type TEXT,
  source_entity_id TEXT,
  note TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  CHECK (
    (source_module IS NULL AND source_entity_type IS NULL AND source_entity_id IS NULL)
    OR
    (source_module IS NOT NULL AND source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL)
  ),
  CHECK (payer_ref_id IS NOT NULL OR source_entity_id IS NOT NULL),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE finance_receipt_allocations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  target_module TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (receipt_id, target_module, target_type, target_id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, receipt_id) REFERENCES finance_receipts(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE finance_expenses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('business', 'personal')),
  category TEXT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  note TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE finance_other_income (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  income_date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  note TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE finance_cash_checks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  check_date TEXT NOT NULL,
  expected_balance_pence INTEGER NOT NULL,
  actual_balance_pence INTEGER NOT NULL,
  difference_pence INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX idx_core_members_user ON core_workspace_members(user_id, active, workspace_id);
CREATE INDEX idx_core_modules_workspace ON core_workspace_modules(workspace_id, enabled, position);
CREATE INDEX idx_core_activity_workspace ON core_activity_events(workspace_id, created_at, id);
CREATE INDEX idx_core_activity_entity ON core_activity_events(workspace_id, module_key, entity_type, entity_id, created_at);
CREATE INDEX idx_core_idempotency_created ON core_idempotency_keys(workspace_id, created_at);

CREATE INDEX idx_tutoring_students_active ON tutoring_students(workspace_id, active, deleted_at, name);
CREATE INDEX idx_tutoring_sessions_schedule ON tutoring_recurring_sessions(workspace_id, active, schedule_status, weekday, start_time);
CREATE INDEX idx_tutoring_session_students_student ON tutoring_session_students(workspace_id, student_id, recurring_session_id);
CREATE INDEX idx_tutoring_occurrences_date ON tutoring_occurrences(workspace_id, session_date, status);
CREATE INDEX idx_tutoring_occurrences_rescheduled ON tutoring_occurrences(workspace_id, rescheduled_to_date, status);
CREATE INDEX idx_tutoring_occurrences_session ON tutoring_occurrences(workspace_id, recurring_session_id, status, session_date);
CREATE INDEX idx_tutoring_billing_cycles_student ON tutoring_billing_cycles(workspace_id, student_id, status, sequence_no);
CREATE INDEX idx_tutoring_cycle_occurrences_cycle ON tutoring_billing_cycle_occurrences(workspace_id, billing_cycle_id, position);

CREATE INDEX idx_finance_receipts_workspace ON finance_receipts(workspace_id, received_at, deleted_at);
CREATE INDEX idx_finance_receipts_payer ON finance_receipts(workspace_id, payer_ref_type, payer_ref_id, received_at);
CREATE INDEX idx_finance_receipts_source ON finance_receipts(workspace_id, source_module, source_entity_type, source_entity_id);
CREATE INDEX idx_finance_allocations_receipt ON finance_receipt_allocations(workspace_id, receipt_id);
CREATE INDEX idx_finance_allocations_target ON finance_receipt_allocations(workspace_id, target_module, target_type, target_id);
CREATE UNIQUE INDEX idx_finance_quick_source
  ON finance_receipts(workspace_id, source_module, source_entity_type, source_entity_id)
  WHERE source_kind = 'quick' AND deleted_at IS NULL;
CREATE INDEX idx_finance_expenses_date ON finance_expenses(workspace_id, expense_date, deleted_at);
CREATE INDEX idx_finance_income_date ON finance_other_income(workspace_id, income_date, deleted_at);
CREATE INDEX idx_finance_cash_checks_date ON finance_cash_checks(workspace_id, check_date, id);

INSERT INTO core_schema_meta(key, value) VALUES ('schema_version', '1');
INSERT INTO core_schema_meta(key, value) VALUES ('architecture', 'modular-workspace-local-first');

PRAGMA foreign_keys = ON;

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
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
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK (travel_minutes >= 0),
  location TEXT,
  center_cut_bps INTEGER NOT NULL DEFAULT 0 CHECK (center_cut_bps BETWEEN 0 AND 10000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  scheduled_start TEXT NOT NULL,
  rescheduled_to_date TEXT,
  rescheduled_to_start TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'completed', 'cancelled', 'missed')
  ),
  gross_pence INTEGER NOT NULL DEFAULT 0 CHECK (gross_pence >= 0),
  center_cut_pence INTEGER NOT NULL DEFAULT 0 CHECK (center_cut_pence >= 0),
  earned_pence INTEGER NOT NULL DEFAULT 0 CHECK (earned_pence >= 0),
  completed_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (recurring_session_id, session_date),
  FOREIGN KEY (recurring_session_id) REFERENCES recurring_sessions(id) ON DELETE RESTRICT
);

CREATE TABLE billing_plans (
  student_id INTEGER PRIMARY KEY,
  billing_mode TEXT NOT NULL DEFAULT 'per_session' CHECK (billing_mode IN ('per_session', 'package')),
  per_session_price_pence INTEGER NOT NULL DEFAULT 0 CHECK (per_session_price_pence >= 0),
  package_size INTEGER CHECK (package_size IS NULL OR package_size BETWEEN 1 AND 100),
  package_price_pence INTEGER CHECK (package_price_pence IS NULL OR package_price_pence >= 0),
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

CREATE TABLE billing_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  sequence_no INTEGER NOT NULL,
  session_limit INTEGER NOT NULL CHECK (session_limit BETWEEN 1 AND 100),
  price_pence INTEGER NOT NULL CHECK (price_pence >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'due', 'paid', 'cancelled')),
  started_on TEXT,
  completed_on TEXT,
  paid_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, sequence_no),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
);

CREATE TABLE billing_cycle_occurrences (
  billing_cycle_id INTEGER NOT NULL,
  occurrence_id INTEGER NOT NULL UNIQUE,
  position INTEGER NOT NULL CHECK (position > 0),
  earned_pence INTEGER NOT NULL DEFAULT 0 CHECK (earned_pence >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (billing_cycle_id, occurrence_id),
  FOREIGN KEY (billing_cycle_id) REFERENCES billing_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (occurrence_id) REFERENCES lesson_occurrences(id) ON DELETE RESTRICT
);

CREATE TABLE receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  received_at TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank', 'wallet', 'other')),
  note TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
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

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_students_active ON students(active, deleted_at);
CREATE INDEX idx_recurring_sessions_day ON recurring_sessions(weekday, active);
CREATE INDEX idx_occurrences_date ON lesson_occurrences(session_date, status);
CREATE INDEX idx_occurrences_rescheduled ON lesson_occurrences(rescheduled_to_date, status);
CREATE INDEX idx_billing_cycles_student ON billing_cycles(student_id, status, sequence_no);
CREATE INDEX idx_receipts_student ON receipts(student_id, received_at, deleted_at);
CREATE INDEX idx_receipt_allocations_receipt ON receipt_allocations(receipt_id);
CREATE INDEX idx_receipt_allocations_occurrence ON receipt_allocations(occurrence_id);
CREATE INDEX idx_receipt_allocations_cycle ON receipt_allocations(billing_cycle_id);
CREATE INDEX idx_expenses_date ON expenses(expense_date, deleted_at);
CREATE INDEX idx_other_income_date ON other_income(income_date, deleted_at);
CREATE INDEX idx_activity_created ON activity_log(created_at, id);

INSERT INTO settings(key, value) VALUES ('currency_label', 'ج');
INSERT INTO settings(key, value) VALUES ('display_name', 'سوزان');
INSERT INTO settings(key, value) VALUES ('opening_balance_pence', '0');

-- Family billing accounts keep attendance/progress per student while money belongs
-- to one household account. Existing student billing cycles remain the package
-- progress ledger; family cycles are the financial obligation snapshot.

CREATE TABLE tutoring_billing_accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'family' CHECK (account_type IN ('family')),
  counting_mode TEXT NOT NULL CHECK (counting_mode IN ('shared_occurrence','per_member_quota')),
  primary_student_id TEXT NOT NULL,
  package_size INTEGER NOT NULL CHECK (package_size BETWEEN 1 AND 100),
  package_price_pence INTEGER NOT NULL CHECK (package_price_pence >= 0),
  effective_from TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id,id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,primary_student_id) REFERENCES tutoring_students(workspace_id,id) ON DELETE RESTRICT
);

CREATE TABLE tutoring_billing_account_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  billing_account_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id,id),
  UNIQUE (billing_account_id,student_id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,billing_account_id) REFERENCES tutoring_billing_accounts(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,student_id) REFERENCES tutoring_students(workspace_id,id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_tutoring_active_family_member
  ON tutoring_billing_account_members(workspace_id,student_id)
  WHERE active=1;

CREATE INDEX idx_tutoring_family_members_account
  ON tutoring_billing_account_members(workspace_id,billing_account_id,position);

CREATE TABLE tutoring_billing_account_cycles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  billing_account_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  package_size INTEGER NOT NULL CHECK (package_size BETWEEN 1 AND 100),
  price_pence INTEGER NOT NULL CHECK (price_pence >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','due','paid','cancelled')),
  started_on TEXT,
  completed_on TEXT,
  paid_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id,id),
  UNIQUE (billing_account_id,sequence_no),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,billing_account_id) REFERENCES tutoring_billing_accounts(workspace_id,id) ON DELETE CASCADE
);

CREATE INDEX idx_tutoring_family_cycles_account
  ON tutoring_billing_account_cycles(workspace_id,billing_account_id,status,sequence_no);

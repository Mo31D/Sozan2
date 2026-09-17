PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS appointments_clients (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE(workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS appointments_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  client_id TEXT,
  title TEXT NOT NULL,
  appointment_date TEXT NOT NULL,
  start_time TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 1440),
  travel_minutes INTEGER NOT NULL DEFAULT 0 CHECK (travel_minutes BETWEEN 0 AND 1440),
  location TEXT,
  price_pence INTEGER NOT NULL DEFAULT 0 CHECK (price_pence >= 0),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','missed')),
  note TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE(workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES core_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, client_id) REFERENCES appointments_clients(workspace_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_clients_active
  ON appointments_clients(workspace_id, active, deleted_at, name);
CREATE INDEX IF NOT EXISTS idx_appointments_items_date
  ON appointments_items(workspace_id, appointment_date, start_time, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_appointments_items_client
  ON appointments_items(workspace_id, client_id, appointment_date);

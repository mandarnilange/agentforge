-- Definitions + history for SQLite mode. v0.2.0 baseline.
-- Do not edit after release — add a new migration file to evolve.

CREATE TABLE IF NOT EXISTS resource_definitions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  spec_yaml TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, name)
);

CREATE TABLE IF NOT EXISTS resource_definition_history (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  spec_yaml TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  change_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_def_kind_name ON resource_definitions(kind, name);
CREATE INDEX IF NOT EXISTS idx_def_history_def ON resource_definition_history(definition_id);

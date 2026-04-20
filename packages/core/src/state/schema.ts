/**
 * SQLite schema DDL for the state store.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  session_name TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL,
  pipeline_name TEXT NOT NULL,
  status TEXT NOT NULL,
  current_phase INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
  agent_name TEXT NOT NULL,
  phase INTEGER NOT NULL,
  node_name TEXT NOT NULL,
  status TEXT NOT NULL,
  input_artifact_ids TEXT NOT NULL DEFAULT '[]',
  output_artifact_ids TEXT NOT NULL DEFAULT '[]',
  token_usage TEXT,
  provider TEXT,
  model_name TEXT,
  cost_usd REAL,
  duration_ms INTEGER,
  error TEXT,
  revision_notes TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  recovery_token TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gates (
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
  phase_completed INTEGER NOT NULL,
  phase_next INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer TEXT,
  comment TEXT,
  revision_notes TEXT,
  artifact_version_ids TEXT NOT NULL DEFAULT '[]',
  cross_cutting_findings TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  max_concurrent_runs INTEGER,
  status TEXT NOT NULL,
  active_runs INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_pipeline ON agent_runs(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_gates_pipeline ON gates(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_gates_status ON gates(pipeline_run_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_pipeline ON audit_log(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);

CREATE TABLE IF NOT EXISTS conversation_logs (
  run_id TEXT PRIMARY KEY,
  log_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_logs_run ON execution_logs(agent_run_id);
`;

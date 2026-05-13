-- P45-T4: DB-backed agent job queue with claim semantics.
-- Replaces per-replica in-memory pendingRunQueues map. Workers claim rows
-- atomically via FOR UPDATE SKIP LOCKED so multiple control-plane replicas
-- can dispatch without lost or duplicate work.

CREATE TABLE IF NOT EXISTS agent_jobs (
  run_id TEXT PRIMARY KEY,
  node_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  claim_ttl_ms INTEGER
);

-- Hot path: claim() filters by node_name + (claimed_by IS NULL).
CREATE INDEX IF NOT EXISTS idx_agent_jobs_pending
  ON agent_jobs (node_name, enqueued_at)
  WHERE claimed_by IS NULL;

-- Sweep path: reclaimStale() filters claimed rows by claimed_at.
CREATE INDEX IF NOT EXISTS idx_agent_jobs_claimed_at
  ON agent_jobs (claimed_at)
  WHERE claimed_at IS NOT NULL;

-- P45-T6: partial index for the per-node active-run count query used by
-- the stateless scheduler. Filters on the small "active" subset so every
-- scheduling decision is O(active rows for node), not O(all agent runs).

CREATE INDEX IF NOT EXISTS idx_agent_runs_active_by_node
  ON agent_runs (node_name)
  WHERE status IN ('pending', 'scheduled', 'running');

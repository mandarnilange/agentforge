# State model — what every status means

Authoritative source files (read directly when in doubt):

- `packages/core/src/domain/models/pipeline-run.model.ts`
- `packages/core/src/domain/models/agent-run.model.ts`
- `packages/core/src/domain/models/gate.model.ts`
- `packages/core/src/domain/models/node.model.ts`

## `PipelineRunStatus`

```
running           → at least one agent is executing or pending
paused_at_gate    → all phase-N agents done; waiting for human gate decision
completed         → all phases finished, every gate approved
failed            → an agent's failure was unrecoverable; pipeline halted
cancelled         → manually aborted via CLI / dashboard
```

Transitions:
- `running` → `paused_at_gate` after a gated phase's agents complete
- `paused_at_gate` → `running` after gate `approved`
- `paused_at_gate` → `failed` after gate `rejected` or timeout
- `running` → `failed` when an agent run fails and there are no retries left
- any → `cancelled` via explicit cancel

`completed` and `failed` are terminal except via `agentforge run --continue`
(only valid when `paused_at_gate` or in the middle of a recoverable failure).

## `AgentRunRecordStatus`

```
pending           → created but not yet claimed by a node
scheduled         → assigned to a node, awaiting execution slot
running           → executing on a node right now
succeeded         → finished, output validated, artifacts persisted
failed            → run did not produce a valid output
```

A `pending` agent run with no matching node hangs the pipeline. A
`scheduled` agent run that never advances to `running` suggests the worker
crashed between claim and start — the reconciler should reclaim within
`claim_ttl`.

## `AgentRunExitReason`

Populated only when non-obvious. ADR-0003 has the rationale.

```
timeout           → wall-clock budget hit (LLM call or step)
budget-tokens     → token ceiling exceeded
budget-cost       → USD ceiling exceeded
cancelled         → user cancelled mid-run
error             → catch-all (LLM error, script non-zero exit, schema invalid)
```

Absent `exitReason` on `succeeded` is normal. Absent on `failed` means the
failure path is unspecified — read the `error` field for the message.

## `GateStatus`

```
pending             → awaiting decision
approved            → human approved; pipeline proceeds to next phase
rejected            → human rejected; pipeline marked failed
revision_requested  → human asked for revision; phase agents re-run with revisionNotes
```

`revision_requested` re-runs the phase's agents with the revision note
inlined into their input. The new agent runs are full executions —
budgets and timeouts apply afresh.

## `NodeStatus`

```
online            → recent heartbeat, accepting work
offline            → no recent heartbeat (default ~60s threshold)
unknown            → never heartbeated since registration
degraded          → online but reporting partial capability loss
```

`offline` for longer than the heartbeat threshold triggers reclaim of any
agent runs claimed by that node. `degraded` is informational — the node
still receives work that fits its remaining capabilities.

## How transitions are persisted

Every status change writes a row to the state store:

- `pipeline_runs` — one row per run, `version` column for optimistic
  concurrency.
- `agent_runs` — one row per agent execution, includes `tokenUsage`,
  `cost_usd`, `duration_ms`, `error`, `exitReason`, `recoveryToken`,
  `lastStatusAt`, `statusMessage`.
- `gates` — one row per gate, status updates atomic.

Reading the state store directly (read-only) is fine for diagnostics.
Mutating it directly is not — always go through the CLI / API.

## Reading the state store directly (last resort)

```bash
sqlite3 ./output/.state.db "SELECT id, status, current_phase, started_at FROM pipeline_runs WHERE id LIKE '<prefix>%' ORDER BY created_at DESC LIMIT 10;"

sqlite3 ./output/.state.db "SELECT agent_name, phase, status, exit_reason, error, cost_usd FROM agent_runs WHERE pipeline_run_id = '<run-id>' ORDER BY phase, started_at;"

sqlite3 ./output/.state.db "SELECT id, phase_completed, status, reviewer, decided_at FROM gates WHERE pipeline_run_id = '<run-id>';"
```

For Postgres deployments swap to `psql $AGENTFORGE_POSTGRES_URL`. Same
schema.

Treat raw SQL output as a debugging aid — present findings to the user
in plain English, not as table dumps.

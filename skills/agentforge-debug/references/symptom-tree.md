# Symptom → cause → first command

Walk the user from observable symptom to a single CLI command that will
either confirm or eliminate a suspected cause.

## "The run is stuck — nothing is happening"

**Step 1.** Read pipeline state:
```bash
agentforge get pipeline <run-id>
```

Branch on `status`:

| `status` | Likely cause | Next |
|---|---|---|
| `running` | Agent stuck inside an LLM call or loop | Read agent run records |
| `paused_at_gate` | Gate awaiting approval | List pending gates |
| `failed` | Latest agent failed, run halted | Inspect last agent run |
| `completed` | The run is done — user is looking at the wrong run | Confirm run-id |
| `cancelled` | Someone aborted it | Check audit log |

**Step 2 — `running` branch.** Find the active agent:
- Dashboard: `/runs/<run-id>` shows the live phase + agent.
- CLI: `agentforge logs <run-id>` and look at the most recent agent name.

If the agent has been `running` for more than its `timeoutSeconds`,
suspect a timeout that has not yet propagated. Check the worker node:
```bash
agentforge get nodes
```
Stale heartbeat → node crashed mid-run; reconciliation should mark the
agent `failed` within ~60s.

**Step 2 — `paused_at_gate` branch.** Pending gate is waiting:
```bash
# List pending gates for the run (via dashboard or DB query)
# Dashboard: /runs/<run-id>/gates
```
Gate status `pending` with a non-empty `phaseCompleted` → the user (or
their reviewer) needs to take action. Gate timeout (`gateDefaults.timeout`
or per-gate) automatically rejects when expired.

## "Agent X is failing"

**Step 1.** Read agent run record:
```bash
agentforge logs <run-id> --agent <agent-name>     # if your CLI supports it
# or via dashboard /runs/<run-id>/agents/<agent-name>
```

Branch on `exitReason`:

| `exitReason` | Cause | First fix path |
|---|---|---|
| `error` | LLM returned bad output, script step failed, or unhandled error | Read `error` field — message tells you which |
| `budget-tokens` | Hit `resources.budget.maxTotalTokens` | Inspect `tokenUsage`; raise budget or shorten prompt |
| `budget-cost` | Hit `resources.budget.maxCostUsd` | Inspect `cost_usd`; raise budget or pick cheaper model |
| `timeout` | Wall-clock budget exhausted | Raise `timeoutSeconds` or split work |
| `cancelled` | Manually cancelled via CLI / dashboard | Confirm intent |

If `exitReason` is missing, the agent succeeded or failed for an
unspecified reason — read the `error` field directly.

**Step 2 — Schema validation failures** (within `error: ...`):
- Look for `ZodError` or `validate` step output.
- Read the failing step's `instructions` (LLM prompt) and the schema file.
- 90% of the time: the prompt does not constrain the LLM toward the schema.
  Fix is a one-line prompt addition stating the required fields.

**Step 2 — Script step failures** (within `error: ...`):
- The error contains the step's stderr / exit code.
- Read the agent's `definitions.<step-name>.run` block.
- Common: missing tool on the node (`eslint`, `pytest`, `gofmt`), missing
  env var (`PATH`), or a `cd {{run.workdir}}` referring to a path the
  agent did not create. Fix in the YAML.

## "It's looping — same error over and over"

This is a `loop` block hitting `maxIterations` without the `until`
predicate going truthy.

**Step 1.** Read the agent definition's loop:
```bash
# Pull the YAML — could be in .agentforge/ or under packages/<pkg>/src/templates/
cat .agentforge/agents/<agent>.agent.yaml
```

**Step 2.** Inspect the predicate step's output across iterations via the
dashboard timeline or logs. The predicate (`test-gate`, etc.) should emit a
truthy sentinel when work is done. If it never does, either:
- The work genuinely cannot be completed by the LLM with current
  constraints (raise `maxIterations`, change model, refine prompt).
- The predicate is wrong (logic error in the script that decides done-ness).

Do **not** raise `maxIterations` past a sane ceiling (5–10) without first
reading what the LLM is doing — silent infinite-loop on the user's bill.

## "Node not picking up the job"

**Step 1.**:
```bash
agentforge get nodes
```

Branch:

| State | Cause | Fix |
|---|---|---|
| Node `offline` / stale heartbeat | Worker process crashed | Restart the worker; reconciler will re-dispatch |
| All nodes online but agent `pending` | `nodeAffinity.required` not satisfied | Inspect agent's required capabilities vs node capabilities |
| All nodes at max capacity | `maxConcurrentRuns` reached | Wait, scale the pool, or raise per-node concurrency |
| No nodes at all | No worker registered | Start one — `agentforge node start --control-plane-url ...` |

**Step 2.** For `nodeAffinity` mismatches:
```bash
# What the agent requires
grep -A 5 "nodeAffinity" .agentforge/agents/<agent>.agent.yaml

# What the nodes provide
agentforge get nodes
```
Resolve by either relaxing the agent's requirements or starting a node
with the missing capability.

## "Cost ceiling hit / budget blown"

**Step 1.** The agent's `exitReason` will be `budget-tokens` or
`budget-cost`. Read its `tokenUsage` and `cost_usd` from the run record.

**Step 2.** Decide path:
- **The agent's task is genuinely larger than the budget** → raise
  `resources.budget.maxTotalTokens` / `maxCostUsd` in the agent YAML.
- **The prompt is leaky** (LLM rambling, stuffed system prompt) → tighten
  the prompt, lower `maxTokens`, lower `thinking` from `high` to `medium`.
- **A loop is consuming budget** → lower `maxIterations` or fix the
  predicate (see "looping" above).

## "Pipeline stuck dispatching — never reaches an agent"

This is the scheduler not finding a node, OR a worker not claiming the
pending job. Order of investigation:

1. `agentforge get nodes` — any nodes online?
2. Inspect `nodeAffinity` requirements (above).
3. If nodes online and capabilities match, suspect the event bus or job
   queue. Check the control-plane logs for "no eligible node" messages
   and the reconciler logs for claim races.
4. Worst case: restart the control plane. The state store survives;
   dispatch resumes.

## "I cancelled by accident — can I resume?"

`pipeline_run.status = cancelled` is terminal. The state store keeps the
record but `agentforge run --continue <run-id>` will not work. Use:
- `agentforge get pipeline <run-id>` to read the artifacts produced so far.
- Start a fresh pipeline that wires those artifacts as inputs (manual
  inputs to the new run).

There is no automatic "uncancel". Confirm with the user before they
re-run from scratch (cost, time).

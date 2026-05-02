# Fix paths — concrete recipes per root cause

Each section: smallest reversible action first, then escalations. Always
get explicit user confirmation before any state-mutating action.

## Gate hung

**Smallest action — make the decision via dashboard or CLI:**
```bash
agentforge gate approve <gate-id>                              # accept
agentforge gate reject  <gate-id> --reason "..."               # reject
agentforge gate revise  <gate-id> --notes "Tighten section 3"  # ask for revision
```

**If approver is unavailable:** check `gateDefaults.timeout` in the pipeline.
Expired gates auto-reject. Adjust the timeout in the pipeline YAML for
future runs.

**If the gate should never have existed:** edit the pipeline to drop the
`gate:` block on that phase. This requires a re-run; cannot retroactively
remove a gate from an in-flight run.

## Agent failed — LLM error

**Smallest action — read the error field, retry once if transient:**
```bash
agentforge run --continue <run-id>
```
Anthropic 529 (overloaded) and transient network errors are retried 3× by
the runtime already. A failure surfaced to the agent run record means
those retries were exhausted.

**If the LLM keeps producing the same wrong output:** the prompt is the
problem. Read the agent's `prompts/<name>.system.md`, identify the
ambiguity, and tighten with a one-line constraint. Re-run the failed
agent only:
```bash
agentforge run --continue <run-id>
```

**If the model is the problem (capability gap):** swap `spec.model.name`
to a stronger model on that agent. Note the cost impact; warn the user.

## Agent failed — schema invalid

**Smallest action — inspect the failing artifact:**
- Dashboard: `/runs/<run-id>/agents/<agent-name>` shows the LLM's last
  output and the validation error.
- CLI: `agentforge logs <run-id> --agent <agent>` (then look for the
  `validate` step).

**Branch on root cause:**

| Cause | Fix |
|---|---|
| LLM hallucinated a missing field | Tighten the prompt to require it |
| LLM emitted the right field with the wrong type | Add an example to the prompt |
| Schema is too strict for the use case | Loosen the schema — minimum change wins |
| Schema is wrong (typo, missing optional) | Fix the schema |

**Re-run only the failed agent:**
```bash
agentforge run --continue <run-id>
```

**Do not** disable validation to make the run pass. The validate step
exists exactly to catch this; bypassing it pollutes downstream phases.

## Agent failed — script step

**Smallest action — read the error field for stderr + exit code.**

**Most common causes and fixes:**
- Missing tool on the node (`eslint`, `pytest`, `gofmt`):
  ```bash
  # On the node, install it. Then re-run.
  npm i -g eslint  # or whatever
  agentforge run --continue <run-id>
  ```
- Wrong working directory: the script `cd {{run.workdir}}`s but `workdir`
  is empty because a prior step did not create it. Add `mkdir -p` to the
  setup step.
- Path / env var missing on the worker: the local node has it but the
  Docker / SSH worker does not. Bake the dep into the worker image, or
  declare it as a `nodeAffinity.required` capability and run the agent
  on a different node.

## Loop spinning at maxIterations

**First — read what the LLM is doing each iteration.** The dashboard's
agent timeline shows every iteration's input and output. If the LLM is
making no progress, the prompt is the problem; if each iteration improves,
the predicate is wrong.

**Fixes:**
- Predicate wrong (script always emits the same value): rewrite the
  predicate's `run` block. Re-run only the agent.
- Prompt too vague: add a "what the previous iteration got wrong" hint
  using `{{steps.run-tests.output}}`.
- Genuinely too hard: raise `maxIterations` (with caution — costs
  multiply) or break the work into two agents.

**Never raise `maxIterations` past 10** without explicit user buy-in.
Cost and wall-clock both compound.

## Budget hit (`budget-tokens` / `budget-cost`)

**Read `tokenUsage` and `cost_usd` to see how close to the ceiling the run
came.**

**Three honest fixes:**
1. **Raise the budget** in `spec.resources.budget`. Justified when the
   task is genuinely larger than the original estimate.
2. **Shorten the prompt** — system prompts that have grown over time
   often duplicate context. Read for redundancy.
3. **Pick a cheaper model** — `claude-haiku-4-5` for cost-sensitive
   agents that do not need deep reasoning.

Do not silently disable budgets. They exist to bound runaway spend.

## Timeout

**Smallest action — bump the timeout for that agent only:**
```yaml
spec:
  resources:
    timeoutSeconds: 1800   # was 600 (default)
```

`0` disables. Use sparingly — disabled timeouts mean a hung LLM call
holds the worker forever.

**If the agent has multiple steps:** add per-step timeouts in
`spec.definitions.<step>.timeoutSeconds` rather than raising the
agent-level one. The script step is usually the one that needs more
time, not the LLM call.

## Stuck dispatching / node affinity miss

**First — confirm a node satisfies the agent's required capabilities:**
```bash
agentforge get nodes
grep -A 5 "nodeAffinity" .agentforge/agents/<agent>.agent.yaml
```

**Two fix paths:**
- **Relax the agent**: drop a `required:` capability the user does not
  actually need.
- **Strengthen the pool**: start a worker with the missing capability:
  ```bash
  NODE_NAME=worker-gpu \
  NODE_CAPABILITIES=llm-access,docker,gpu \
  CONTROL_PLANE_URL=http://cp:3001 \
    docker compose -f packages/platform/docker-compose.worker.yml up -d
  ```

If all nodes are at `maxConcurrentRuns`: wait, raise the limit on a node,
or scale the pool horizontally.

## Node down

**Verify:**
```bash
agentforge get nodes      # is the node `offline` / heartbeat stale?
```

**Fixes:**
- Restart the worker process. The reconciler reclaims its in-flight runs
  within `claim_ttl` (default ~60s) and re-dispatches.
- If the node is permanently gone, drop it from the pool. Existing
  agent runs reassigned automatically.

## Cancelled by accident

`cancelled` is terminal. There is no "uncancel."

**Recovery path:**
- Read what artifacts the cancelled run produced via dashboard or CLI.
- Start a fresh pipeline. If you want to skip phases that already
  completed, manually feed those artifacts as inputs to the new run.

Make sure the user understands the cost / time implications before
re-running the full pipeline.

---

## When to escalate to a code change

If the same class of failure has happened more than twice on different
runs of the same template / agent, the root cause is in the YAML or the
framework, not the run. Examples:
- Repeated schema-invalid failures from the same agent → prompt or schema
  bug; fix and PR.
- Repeated timeouts on the same agent → unrealistic budget; raise default.
- Repeated stuck-dispatch on the same affinity → template author should
  loosen the `required:` to `preferred:`.

In these cases, file an issue or a PR rather than re-running the same
broken pipeline.

# Testing Guide

> Part of the [AgentForge documentation](README.md).

This guide covers how to test AgentForge — from unit tests through to running a real pipeline with an actual API key.

All examples use the bundled `simple-sdlc` template's three agents: `analyst`, `architect`, `developer`. Swap in your own agent names once you've scaffolded a project with `agentforge init`.

---

## 1. Unit & Integration Tests (No API Key Needed)

The entire test suite runs against mocks. No API key or Docker required.

```bash
# Run all tests
npm test

# Watch mode (re-runs on file save)
npm run test:watch

# Run a specific test file
npx vitest run packages/core/tests/adapters/docker-sandbox.test.ts

# Run tests matching a pattern
npx vitest run --reporter=verbose packages/core/tests/control-plane/
```

---

## 2. Lint & Type Check

```bash
# Lint + auto-format
npm run lint

# Check only (no writes)
npx biome check .

# Type-check
npm run typecheck
```

---

## 3. Dry Run — Single Agent (No API Key)

Validates CLI wiring, config loading, and agent registration without calling the LLM.

```bash
# Scaffold the simple-sdlc template into .agentforge/
npx agentforge init --template simple-sdlc

# Dry run any agent
npx tsx packages/core/src/cli/index.ts exec analyst --input "Build a SaaS invoicing app" --dry-run

# Expected output:
# --- DRY RUN ---
# Agent:      analyst
# Executor:   pi-ai
# Model:      anthropic/claude-sonnet-4-20250514
# Output dir: ./output
# Inputs:     raw-brief
# Outputs:    requirements
# Input file: Build a SaaS invoicing app
# ---
# No LLM call made.
```

Dry-run every agent in the template:

```bash
for agent in analyst architect developer; do
  echo "--- $agent ---"
  npx tsx packages/core/src/cli/index.ts exec $agent --input "test" --dry-run
done
```

---

## 4. List & Info Commands (No API Key)

```bash
# List all registered agents
npx tsx packages/core/src/cli/index.ts list

# Detailed info for a specific agent
npx tsx packages/core/src/cli/index.ts info analyst
npx tsx packages/core/src/cli/index.ts info developer
```

---

## 5. Real Agent Run (API Key Required)

### Setup

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Optional overrides
export AGENTFORGE_OUTPUT_DIR=./my-output
export AGENTFORGE_LOG_LEVEL=debug
```

### Run the analyst (Phase 1 — Requirements)

```bash
# Inline brief
npx tsx packages/core/src/cli/index.ts exec analyst \
  --input "Build a freelance invoicing SaaS. Users create clients, log time, generate invoices, and accept payment via Stripe."

# From a file
echo "Build a task management app with teams, kanban boards, and time tracking." > brief.txt
npx tsx packages/core/src/cli/index.ts exec analyst --input brief.txt
```

Output artifact appears in `./output/`:
- `requirements.json` — structured epics, user stories, acceptance criteria

### Chain to the architect (Phase 2 — Architecture)

```bash
# Uses the analyst's output as input
npx tsx packages/core/src/cli/index.ts exec architect --input ./output
```

Produces:
- `architecture-plan.json` — components, tech stack, API design, ADRs

### Chain to the developer (Phase 3 — Implementation)

```bash
npx tsx packages/core/src/cli/index.ts exec developer --input ./output
```

Produces:
- `code-output.json` — generated code summary with lint + test results

---

## 6. Pipeline Run (Full Orchestration)

The pipeline runs all agents sequentially with SQLite-backed state and human approval gates.

### Step 1 — Start the pipeline

```bash
npx tsx packages/core/src/cli/index.ts run \
  --project "freelance-invoicing" \
  --pipeline simple-sdlc \
  --input "brief=Build a freelance invoicing SaaS with Stripe payments"
```

You'll see output like:

```
Pipeline started: pipe-abc123
Phase 1 scheduled: analyst
...
analyst completed. Gate opened: gate-xyz456
Pipeline paused at gate. Use 'gate approve gate-xyz456' to continue.
```

### Step 2 — Check what was produced

```bash
# List all pipeline runs
npx tsx packages/core/src/cli/index.ts get pipelines

# Inspect this specific run
npx tsx packages/core/src/cli/index.ts get pipeline pipe-abc123

# Check pending gates
npx tsx packages/core/src/cli/index.ts get gates --pipeline pipe-abc123

# See all agent runs
npx tsx packages/core/src/cli/index.ts get runs --pipeline pipe-abc123
```

### Step 3 — Review artifacts

```bash
ls ./output/
cat ./output/requirements.json | python3 -m json.tool | head -50
```

### Step 4 — Approve the gate (advance to Phase 2)

```bash
npx tsx packages/core/src/cli/index.ts gate approve gate-xyz456 \
  --reviewer "alice" \
  --comment "Requirements look solid. Approved."
```

The architect (Phase 2) starts automatically.

### Step 5 — Reject a gate (stops the pipeline)

```bash
npx tsx packages/core/src/cli/index.ts gate reject gate-xyz456 \
  --reviewer "alice" \
  --comment "Requirements are missing payment flow details."
```

### Step 6 — Request revision (re-run the agent)

```bash
npx tsx packages/core/src/cli/index.ts gate revise gate-xyz456 \
  --notes "Add: user must be able to set invoice due date and send reminders." \
  --reviewer "alice"
```

---

## 7. Inspect Logs

```bash
# View logs for a specific agent run
npx tsx packages/core/src/cli/index.ts logs run-abc123

# Include the full LLM conversation
npx tsx packages/core/src/cli/index.ts logs run-abc123 --conversation
```

---

## 8. Apply YAML Definitions

Load custom agent or pipeline definitions:

```bash
# Apply a single YAML file
npx tsx packages/core/src/cli/index.ts apply -f .agentforge/agents/analyst.agent.yaml

# Apply all definitions in a directory
npx tsx packages/core/src/cli/index.ts apply -f .agentforge/agents/
npx tsx packages/core/src/cli/index.ts apply -f .agentforge/pipelines/
```

---

## 9. Model Override

Switch models per-run without changing config:

```bash
# Use a faster/cheaper model for testing
npx tsx packages/core/src/cli/index.ts exec analyst \
  --input "Build an app" \
  --model claude-haiku-4-5-20251001

# Use Sonnet for production
npx tsx packages/core/src/cli/index.ts exec analyst \
  --input brief.txt \
  --model claude-sonnet-4-20250514
```

---

## 10. Verbose Debugging

```bash
# Enable debug logging
npx tsx packages/core/src/cli/index.ts exec analyst \
  --input "Build an app" \
  --verbose

# Or via env var
AGENTFORGE_LOG_LEVEL=debug npx tsx packages/core/src/cli/index.ts exec analyst --input "Build an app"
```

---

## End-to-End Test Walkthrough

A complete session through Phase 1 → Phase 2 → Phase 3:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AGENTFORGE_OUTPUT_DIR=./output/test-run

# Phase 1: Requirements
npx tsx packages/core/src/cli/index.ts exec analyst \
  --input "Build a SaaS for managing restaurant reservations. Customers book online, restaurants manage availability, and owners see revenue reports."

ls ./output/test-run/    # requirements.json

# Phase 2: Architecture (uses Phase 1 output)
npx tsx packages/core/src/cli/index.ts exec architect --input ./output/test-run

ls ./output/test-run/    # + architecture-plan.json

# Phase 3: Implementation (uses Phases 1+2 output)
npx tsx packages/core/src/cli/index.ts exec developer --input ./output/test-run

ls ./output/test-run/    # + code-output.json
```

---

## 11. Multi-worker Validation

Two layers — one in-process (always runs), one against real Docker (opt-in).

### In-process HTTP dispatch test

Boots a real control-plane HTTP server and attaches three in-process polling
workers that register/heartbeat/poll/report-results via `fetch` — the same
protocol the `docker-entrypoint.sh worker` path uses in production. Covers
concurrency, capability routing, and silent-drop protection.

```bash
npx vitest run packages/platform/tests/integration/multi-worker.test.ts
```

No Docker daemon, no API key — runs as part of `npm test`.

### Docker Compose smoke test

Brings up `postgres` + `control-plane` + three heterogeneous workers
(different names, capabilities, concurrency caps) under Docker Compose and
asserts each one registers, advertises the right capabilities, and
heartbeats within the last 30s. Gated behind an explicit shell invocation;
**not** wired into `npm test`.

```bash
./packages/platform/tests/docker/multi-worker-smoke.sh
```

Requires `docker compose` v2, `jq`, `curl`. First run builds the image —
expect ~2 minutes. No LLM key needed; the workers just register and idle.

For full pipeline validation across multiple workers, run the stack with a
real `ANTHROPIC_API_KEY` and use `agentforge run` per the sections above.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Error: ANTHROPIC_API_KEY is required` | `export ANTHROPIC_API_KEY=sk-ant-...` |
| `Unknown agent: "xyz"` | Run `agentforge list` to see valid IDs in your `.agentforge/` scaffold |
| Empty artifacts (`{}`) | Check `--verbose` output; LLM may have returned malformed JSON |
| Pipeline stuck at gate | Run `get gates --pipeline <id>` to find pending gate ID, then `gate approve <id>` |
| State DB locked | Another process has the DB open; kill it or wait |
| Tests failing | Run `npm run lint` first, then `npm test` |

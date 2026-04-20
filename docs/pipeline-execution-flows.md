# Pipeline Execution Flows

Complete reference for how pipelines start, execute, produce artifacts, and handle gates.

---

## Overview

```
                          +---------------------+
                          |   Entry Points      |
                          |  CLI / Dashboard    |
                          +----------+----------+
                                     |
                          +----------v----------+
                          | PipelineController   |
                          | .startPipeline()     |
                          +----------+----------+
                                     |
                    +----------------+----------------+
                    |                                 |
          +---------v---------+            +----------v----------+
          | DB: pipeline_runs |            | schedulePhase()     |
          | status: running   |            | creates agent_runs  |
          | phase: 1          |            | status: pending     |
          +-------------------+            +----------+----------+
                                                      |
                                           +----------v----------+
                                           | executePipeline()    |
                                           | main execution loop  |
                                           +----------+----------+
                                                      |
                                           +----------v----------+
                                           | executeAgentRun()    |
                                           | per agent            |
                                           +----------+----------+
                                                      |
                              +----------+------------+----------+
                              |          |                       |
                    +---------v--+  +----v--------+   +----------v--------+
                    | DB: update |  | Filesystem  |   | onAgentRunCompleted|
                    | agent_run  |  | artifacts   |   | phase transition   |
                    | succeeded  |  | conv logs   |   +-------------------+
                    +------------+  +-------------+
```

---

## 1. Pipeline Start

Two entry points, same internal flow.

### CLI: `agentforge run`

```
User runs:  agentforge run --project myapp --pipeline simple-sdlc --input brief="Build a calculator"

File: src/cli/commands/run-pipeline.ts

Steps:
  1. Load AppConfig (API key, LLM provider, output dir)
  2. Load pipeline YAML from ./pipelines/{name}.pipeline.yaml
  3. Parse --input flags into Record<string, string>
  4. controller.startPipeline(projectName, pipelineDef, inputs)
  5. executePipeline(runId, projectName, store, controller, config, outputBase, pipelineDef, inputs)
```

### Dashboard: POST /api/v1/pipelines

```
User clicks "New Pipeline" in React UI

File: src/dashboard/routes/api-routes.ts (line 205)

Steps:
  1. Parse JSON body: { definition, projectName, ...inputs }
  2. Look up pipeline definition from DefinitionStore
  3. controller.startPipeline(projectName, pipelineDef, inputs)
  4. Fire executePipeline() in background (don't await)
  5. Return 201 with PipelineRun record
```

### What startPipeline() does

```
File: src/control-plane/pipeline-controller.ts

startPipeline(projectName, pipelineDef, inputs):
  |
  +---> store.createPipelineRun({
  |       projectName, pipelineName, status: "running",
  |       currentPhase: 1, startedAt: now
  |     })
  |     --> INSERT INTO pipeline_runs (...)
  |
  +---> activePipelineDefs.set(run.id, pipelineDef)   // in-memory cache
  |
  +---> schedulePhase(run.id, phase=1, pipelineDef)
          |
          +---> For each agent in phase 1:
                  |
                  +---> loadAgentDefFromDisk("analyst")    // ./agents/analyst.agent.yaml
                  +---> scheduler.schedule(agentDef, nodePool)  // pick node
                  +---> store.createAgentRun({
                          pipelineRunId, agentName, phase: 1,
                          nodeName: "local", status: "pending",
                          startedAt: now
                        })
                        --> INSERT INTO agent_runs (...)
```

**DB state after start:**
```
pipeline_runs:  { id: "abc", status: "running", currentPhase: 1 }
agent_runs:     { id: "r1", agentName: "analyst", phase: 1, status: "pending" }
```

---

## 2. Agent Execution Loop

```
File: src/cli/pipeline-executor.ts

executePipeline(pipelineRunId, ...):
  |
  |  // Seed artifact dirs from already-succeeded runs (for cross-process resume)
  |  allPrevPhaseDirs = [phase-1, phase-2, ...] from succeeded runs
  |
  +---> LOOP (max 100 iterations):
          |
          +---> pipeline = store.getPipelineRun(id)
          |     if status is completed/failed/cancelled --> RETURN
          |     if status is paused_at_gate --> RETURN { pausedAtGate: true }
          |
          +---> pendingRuns = store.listAgentRuns(id).filter(status == "pending")
          |     if none --> BREAK
          |
          +---> currentPhase = pendingRuns[0].phase
          |     phaseOutputDir = "{outputBase}/phase-{currentPhase}"
          |     sourceDir = "{outputBase}/source"   // shared across all phases
          |
          +---> Build phase input:
          |       Phase 1 --> user-provided inputs (formatted as "## key\nvalue")
          |       Phase N --> allPrevPhaseDirs (all prior phase output dirs)
          |
          +---> If phase is parallel:
          |       await Promise.all(pendingRuns.map(executeAgentRun))
          |     Else:
          |       for each run: await executeAgentRun(run)
          |
          +---> allPrevPhaseDirs.push(phaseOutputDir)
          |
          +---> Continue loop (next iteration picks up new pending runs)
```

### Single Agent Execution

```
executeAgentRun(agentRun, ctx):
  |
  +---> 1. MARK RUNNING
  |       store.updateAgentRun(id, { status: "running", startedAt: now })
  |       --> UPDATE agent_runs SET status='running' WHERE id=...
  |
  +---> 2. INITIALIZE CONVERSATION LOG
  |       logPath = "{phaseOutputDir}/{agentName}-conversation.jsonl"
  |       Write initial entry: { role: "user", content: inputSummary }
  |
  +---> 3. CREATE DI CONTAINER
  |       createContainerForAgent(executor, config, {
  |         workdir: sourceDir,
  |         onEvent: (entry) => appendFileSync(logPath, JSON.stringify(entry))
  |       })
  |       --> Selects backend: pi-ai (chat) or pi-coding-agent (code)
  |       --> Wires onEvent for real-time log streaming
  |
  +---> 4. INJECT REVISION NOTES (if present)
  |       prompt = "## Revision Request\n{notes}\n\nPlease address the feedback..."
  |
  +---> 5. RUN AGENT
  |       result = runner.run({ input, prompt, outputDir: phaseOutputDir })
  |       --> Loads system prompt from ./src/agents/prompts/{agent}.system.md
  |       --> Calls LLM with input + system prompt
  |       --> Saves artifacts to phaseOutputDir
  |       --> Returns { artifacts, tokenUsage, savedFiles, conversationLog }
  |
  +---> 6. UPDATE DB WITH RESULTS
  |       store.updateAgentRun(id, {
  |         durationMs, tokenUsage, outputArtifactIds: savedFiles,
  |         provider, modelName, costUsd
  |       })
  |
  +---> 7. TRIGGER PHASE TRANSITION
  |       controller.onAgentRunCompleted(agentRun.id, savedFiles)
  |
  +---> ON ERROR:
          controller.onAgentRunFailed(agentRun.id, error.message)
          --> agent_runs.status = "failed", pipeline_runs.status = "failed"
```

---

## 3. Phase Transitions

```
File: src/control-plane/pipeline-controller.ts

onAgentRunCompleted(agentRunId, outputArtifactIds):
  |
  +---> Mark agent "succeeded" in DB
  |
  +---> Check: are ALL agents in this phase done?
  |     (only considers latest run per agent -- handles retries)
  |
  |     NOT all done --> return (wait for parallel agents)
  |
  +---> ALL DONE:
          |
          +---> Look up phase definition from pipeline YAML
          |
          +---> GATE REQUIRED? (default: yes)
          |       |
          |       YES --> gateController.openGate(pipelineRunId, phase, nextPhase)
          |               --> INSERT INTO gates (status: "pending")
          |               --> UPDATE pipeline_runs SET status = "paused_at_gate"
          |               --> Executor loop sees "paused_at_gate", returns
          |
          |       NO, next phase exists --> schedulePhase(nextPhase)
          |                                 --> Creates new pending agent_runs
          |                                 --> Executor loop picks them up
          |
          |       NO, last phase --> UPDATE pipeline_runs SET status = "completed"
```

---

## 4. Gate Flow

```
                    Phase completes
                         |
                         v
              +--------------------+
              |   Gate PENDING     |
              | pipeline: paused   |
              | executor: stopped  |
              +----+-------+-------+
                   |       |       |
            APPROVE    REJECT    REVISE
                   |       |       |
                   v       v       v
             +---------+ +------+ +------------------+
             |APPROVED | |REJECT| |REVISION_REQUESTED|
             +---------+ +------+ +------------------+
                   |       |       |
                   v       v       v
            schedule    pipeline  re-schedule same
            next phase  "failed"  phase with notes
            "running"             "running"
```

### Gate Approve (Dashboard or CLI)

```
Dashboard: POST /api/v1/gates/{id}/approve
CLI:       agentforge gate approve {id}

File: src/control-plane/pipeline-controller.ts

approveGate(gateId, pipelineDef, reviewer, comment):
  |
  +---> gateController.approve(gateId, reviewer, comment)
  |       --> UPDATE gates SET status="approved", decided_at=now
  |       --> INSERT INTO audit_log (action: "approve_gate")
  |
  +---> Next phase exists?
  |       YES --> updatePipelineRun(status: "running", currentPhase: nextPhase)
  |               schedulePhase(nextPhase)
  |       NO  --> updatePipelineRun(status: "completed")
  |
  +---> Dashboard fires executePipeline() in background
          --> Picks up newly scheduled pending agent_runs
```

### Gate Revise

```
reviseGate(gateId, notes, reviewer):
  |
  +---> gateController.revise(gateId, notes, reviewer)
  |       --> UPDATE gates SET status="revision_requested", revision_notes=notes
  |       --> INSERT INTO audit_log (action: "revise_gate")
  |
  +---> updatePipelineRun(status: "running", currentPhase: phaseCompleted)
  +---> schedulePhase(phaseCompleted, pipelineDef, revisionNotes)
          --> New agent_runs created with revisionNotes field populated
          --> When executed, revision notes prepended as prompt
```

---

## 5. Stop & Retry Flow

### Stop Pipeline

```
Dashboard: POST /api/v1/pipelines/{id}/stop

stopPipeline(pipelineRunId):
  |
  +---> Validate: status must be "running" or "paused_at_gate"
  |
  +---> For each agent run (pending/scheduled/running):
  |       UPDATE agent_runs SET status="failed", error="Cancelled by user"
  |
  +---> UPDATE pipeline_runs SET status="cancelled", completedAt=now
  |
  +---> Clear cached pipeline def
  |
  +---> Executor loop (if running):
          Next iteration sees status="cancelled" --> exits loop
          NOTE: Currently executing LLM call finishes (no abort signal)
```

### Retry Pipeline

```
Dashboard: POST /api/v1/pipelines/{id}/retry

retryPipeline(pipelineRunId, pipelineDef):
  |
  +---> Validate: status must be "failed" or "cancelled"
  |
  +---> UPDATE pipeline_runs SET status="running"
  |
  +---> schedulePhase(pipelineRunId, currentPhase, pipelineDef)
  |       --> Creates NEW agent_run records (old ones remain for audit)
  |
  +---> Dashboard fires executePipeline() in background
```

---

## 6. Filesystem Layout

```
{config.outputDir}/
  {projectName}/                          # e.g. output/calculator-app/
    source/                               # Shared working directory for coding agents
      src/                                # Agent-generated source code
      tests/
      package.json
      ...
    phase-1/                              # Requirements phase output
      analyst-conversation.jsonl          # Real-time conversation log
      requirements.json                   # Analyst artifact
    phase-2/                              # Architecture phase output
      architect-conversation.jsonl
      architecture-plan.json              # Architect artifact
    phase-3/                              # Implementation phase output
      developer-conversation.jsonl
      code-output.json                    # Developer artifact
      *.ts, *.json                        # Generated code under source/
```

### Conversation Log Format (JSONL)

Each line is a JSON object:

```jsonl
{"role":"user","content":"## brief\nBuild a calculator app","timestamp":1712434567890}
{"role":"assistant","content":"I'll analyze the requirements...","timestamp":1712434568100}
{"role":"tool_use","name":"write","input":{"path":"src/calc.ts"},"timestamp":1712434569000}
{"role":"tool_result","content":"File written successfully","timestamp":1712434569100}
```

Written in two ways:
1. **Real-time:** `onEvent` callback appends each entry as agent runs
2. **Final:** Agent's `conversationLog` array overwrites file on completion

---

## 7. Artifact Chaining Between Phases

```
Phase 1 (Requirements — analyst)
  Input:  User-provided brief/constraints (from --input flags or dashboard form)
  Output: phase-1/ directory with requirements artifact

Phase 2 (Architecture — architect)
  Input:  ["output/myapp/phase-1"]           # Can read all phase-1 artifacts
  Output: phase-2/ directory with architecture-plan artifact

Phase 3 (Implementation — developer)
  Input:  ["output/myapp/phase-1", "output/myapp/phase-2"]   # All prior phases
  Output: phase-3/ directory + files in source/
```

Chaining is **implicit** -- each phase receives all prior phase output directories. No explicit artifact wiring needed.

On **cross-process resume** (e.g., after gate approval from CLI while dashboard was the original executor), the executor scans DB for succeeded runs and rebuilds the `allPrevPhaseDirs` list.

---

## 8. DB Schema

```sql
pipeline_runs
  id              TEXT PRIMARY KEY
  project_name    TEXT
  pipeline_name   TEXT
  status          TEXT    -- running | paused_at_gate | completed | failed | cancelled
  current_phase   INTEGER
  started_at      TEXT    -- ISO timestamp
  completed_at    TEXT    -- ISO timestamp (nullable)
  created_at      TEXT    -- ISO timestamp

agent_runs
  id                  TEXT PRIMARY KEY
  pipeline_run_id     TEXT REFERENCES pipeline_runs(id)
  agent_name          TEXT    -- e.g. "analyst", "developer"
  phase               INTEGER
  node_name           TEXT    -- e.g. "local"
  status              TEXT    -- pending | scheduled | running | succeeded | failed
  input_artifact_ids  TEXT    -- JSON array
  output_artifact_ids TEXT    -- JSON array of saved file paths
  token_usage         TEXT    -- JSON { inputTokens, outputTokens }
  provider            TEXT    -- e.g. "anthropic"
  model_name          TEXT    -- e.g. "claude-sonnet-4-20250514"
  cost_usd            REAL
  duration_ms         INTEGER
  error               TEXT    -- error message if failed
  revision_notes      TEXT    -- from gate revision
  started_at          TEXT
  completed_at        TEXT
  created_at          TEXT

gates
  id                    TEXT PRIMARY KEY
  pipeline_run_id       TEXT REFERENCES pipeline_runs(id)
  phase_completed       INTEGER
  phase_next            INTEGER
  status                TEXT    -- pending | approved | rejected | revision_requested
  reviewer              TEXT
  comment               TEXT
  revision_notes        TEXT
  artifact_version_ids  TEXT    -- JSON array
  decided_at            TEXT
  created_at            TEXT

audit_log
  id                TEXT PRIMARY KEY
  pipeline_run_id   TEXT
  actor             TEXT    -- reviewer name or "system"
  action            TEXT    -- approve_gate | reject_gate | revise_gate
  resource_type     TEXT    -- "gate"
  resource_id       TEXT
  metadata          TEXT    -- JSON
  created_at        TEXT

nodes
  name                TEXT PRIMARY KEY
  type                TEXT
  capabilities        TEXT    -- JSON array
  max_concurrent_runs INTEGER
  status              TEXT    -- online | offline
  active_runs         INTEGER
  last_heartbeat      TEXT
  updated_at          TEXT
```

---

## 9. API Endpoints Reference

### GET Endpoints

| Endpoint | Returns |
|----------|---------|
| `/api/v1/summary` | Pipeline/run/gate counts, costs |
| `/api/v1/pipelines` | All pipeline runs |
| `/api/v1/pipelines/{id}` | Pipeline detail: run + agents + gates + phase summary |
| `/api/v1/pipeline-definitions` | Available YAML templates with input specs |
| `/api/v1/runs?pipelineId=` | Agent runs (optionally filtered) |
| `/api/v1/runs/{id}` | Single agent run detail |
| `/api/v1/runs/{id}/artifacts` | Artifact file list for a run |
| `/api/v1/runs/{id}/conversation` | Parsed JSONL conversation log |
| `/api/v1/runs/{id}/logs` | Formatted text logs |
| `/api/v1/gates?pipelineId=` | Gates for a pipeline |
| `/api/v1/gates/{id}` | Single gate detail |
| `/api/v1/gates/pending` | All pending gates across all pipelines |
| `/api/v1/artifacts?pipelineId=` | All artifacts |
| `/api/v1/artifact-content?path=` | Raw artifact file content |
| `/api/v1/artifact-pdf?path=` | PDF render of JSON artifact |
| `/api/v1/nodes` | All registered nodes |
| `/api/v1/nodes/{name}` | Single node detail |

### POST Endpoints

| Endpoint | Body | Effect |
|----------|------|--------|
| `/api/v1/pipelines` | `{ definition, projectName, ...inputs }` | Start pipeline |
| `/api/v1/pipelines/{id}/stop` | `{}` | Cancel running pipeline |
| `/api/v1/pipelines/{id}/retry` | `{}` | Retry failed/cancelled pipeline |
| `/api/v1/gates/{id}/approve` | `{ reviewer?, comment? }` | Approve gate, advance pipeline |
| `/api/v1/gates/{id}/reject` | `{ reviewer?, comment? }` | Reject gate, fail pipeline |
| `/api/v1/gates/{id}/revise` | `{ notes, reviewer? }` | Request revision, re-run phase |

---

## 10. State Machine

### Pipeline Status

```
                    +----------+
                    | running  |<---------+----------+
                    +----+-----+          |          |
                         |           (retry)    (revise gate)
              (all phase |                |          |
               agents    |          +-----+----+ +---+------+
               complete) |          | cancelled | | revision |
                         v          +-----^----+ +----------+
                  +------+------+         |
                  |paused_at_gate|   (stop while
                  +--+-----+----+    running/paused)
                     |     |
              (approve)   (reject)
                     |     |
                     v     v
              +---------+ +--------+
              |completed| | failed |
              +---------+ +---^----+
                              |
                        (agent error)
```

### Agent Run Status

```
  pending --> scheduled --> running --> succeeded
                              |
                              +--> failed (error or cancelled by user)
```

### Gate Status

```
  pending --> approved
         +--> rejected
         +--> revision_requested
```

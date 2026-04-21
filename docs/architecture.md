# AgentForge — Architecture

> Part of the [AgentForge documentation](README.md).

## Overview

The AgentForge is a **Kubernetes-style control plane** for running AI agents as a coordinated pipeline. Agents are declaratively defined in YAML, executed sequentially through phases, and gated by human approval at each phase boundary.

The framework is built on **Clean Architecture** — the domain layer has zero external dependencies. All infrastructure concerns are injected through ports (interfaces).

---

## System Context

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer / Product Team                  │
│                                                             │
│   "Build a SaaS invoicing platform for freelancers"         │
└────────────────────────┬────────────────────────────────────┘
                         │ brief.md
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   AgentForge                       │
│                                                             │
│   CLI / SDK  →  Pipeline  →  Agents  →  Artifacts           │
│                                                             │
│   Human gates between each phase                            │
└────────────────────────┬────────────────────────────────────┘
                         │ code, docs, configs
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Output Directory  +  State DB                   │
│                                                             │
│   output/frd.json  output/architecture.json  output/...     │
│   .sdlc-state.db  (pipeline runs, gates, audit log)         │
└─────────────────────────────────────────────────────────────┘
```

---

## Reference Pipeline Shape

The shipped reference pipeline is organised into 6 phases. Phase 4 runs 3 agents in parallel. A cross-cutting security agent runs after each phase.

```
┌─────────────────────────────────────────────────────────────────────┐
│  INPUT: Product Brief                                               │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                    ┌───────▼────────┐
                    │    Phase 1     │
                    │ Business       │  → FRD, NFR, wireframes,
                    │ Analyst        │    timeline, estimate
                    │  (pi-ai)       │
                    └───────┬────────┘
                            │
                    ◀── GATE 1 ──▶  (human approval)
                            │
                    ┌───────▼────────┐
                    │    Phase 2     │
                    │ Architect      │  → architecture, ADRs,
                    │  (pi-ai)       │    component diagrams
                    └───────┬────────┘
                            │
                    ◀── GATE 2 ──▶
                            │
                    ┌───────▼────────┐
                    │    Phase 3     │
                    │ Tech Lead      │  → sprint plan, risks,
                    │  (pi-ai)       │    DoD checklist
                    └───────┬────────┘
                            │
                    ◀── GATE 3 ──▶
                            │
           ┌────────────────┼────────────────┐
  ┌────────▼──────┐ ┌───────▼──────┐ ┌───────▼──────┐
  │   Phase 4a    │ │  Phase 4b    │ │  Phase 4c    │
  │  Frontend     │ │  Backend     │ │  Data        │  ← parallel
  │  Dev          │ │  Dev         │ │  Engineer    │
  │ (pi-coding)   │ │ (pi-coding)  │ │ (pi-coding)  │
  └────────┬──────┘ └───────┬──────┘ └───────┬──────┘
           └────────────────┼────────────────┘
                            │
                    ◀── GATE 4 ──▶
                            │
                    ┌───────▼────────┐
                    │    Phase 5     │
                    │ QA / Testing   │  → test suites,
                    │  (pi-coding)   │    coverage report
                    └───────┬────────┘
                            │
                    ◀── GATE 5 ──▶
                            │
                    ┌───────▼────────┐
                    │    Phase 6     │
                    │ DevOps / SRE   │  → CI/CD, IaC,
                    │  (pi-coding)   │    runbooks
                    └───────┬────────┘
                            │
                    ◀── GATE 6 ──▶
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  OUTPUT: All artifacts saved to output/ directory                    │
└─────────────────────────────────────────────────────────────────────┘

  ╔═══════════════════════════════════════════════════════════════════╗
  ║  Security (cross-cutting) — runs after phases 2, 3, 4, 5, 6       ║
  ║  Incrementally appends findings to threat model + security report  ║
  ╚═══════════════════════════════════════════════════════════════════╝
```

---

## Deployment Model

The target deployment model is **separated control plane + separately deployable node runtimes**.

### Control Plane
Owns orchestration and shared state:
- pipeline controller
- gate controller
- scheduler
- state store
- observability aggregation
- CLI/API surface

The control plane should be deployable as its own long-running service/process and should not depend on executing agent workloads in-process once multi-node support is complete.

### Node Runtimes
Own execution responsibilities and can be deployed independently from the control plane:
- receive run requests
- execute agent workloads
- manage sandbox/container lifecycle
- emit heartbeats and availability
- report status, token usage, cost, and completion back to control plane

Nodes may be local, SSH-accessed remote machines, or dedicated worker deployments.

### Planned Separation by Phase
- **P10** introduces the runtime/control-plane boundary, remote node scheduling, health checks, and runtime observability.
- **P10.5** adds the control-plane resource API and live dashboard for monitoring pipelines, runs, nodes, gates, logs, conversations, artifacts, and spend.
- **P12** hardens this into a production deployment topology with separate control plane and node deployment/runbooks.

## Control Plane API + Live Dashboard

The dashboard is served by the control plane and should remain a **thin transport/UI layer** over application handlers and domain ports.

### Design rules
- HTTP routes do request parsing, status codes, and response serialization only.
- Application/query handlers assemble dashboard resources from the state store, artifacts, and conversation logs.
- Domain models remain transport-agnostic.
- The dashboard UI consumes resource-oriented endpoints instead of reading SQLite directly.

### Resource-oriented endpoints
Current/target API shape follows Kubernetes-style resource access patterns:
- `GET /api/v1/summary`
- `GET /api/v1/pipelines`
- `GET /api/v1/pipelines/:id`
- `GET /api/v1/runs?pipelineId=:id`
- `GET /api/v1/runs/:id`
- `GET /api/v1/runs/:id/logs`
- `GET /api/v1/runs/:id/conversation`
- `GET /api/v1/runs/:id/artifacts`
- `GET /api/v1/nodes`
- `GET /api/v1/nodes/:name`
- `GET /api/v1/gates?pipelineId=:id`
- `GET /api/v1/gates/:id`
- `GET /api/v1/artifacts`

### Dashboard scope
The live dashboard should allow operators to:
- monitor all pipelines and current phases
- drill into individual runs
- inspect logs and conversation traces
- inspect node health and capacity
- inspect gates and revision requests
- inspect produced artifacts and cost/token usage

## Component Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                          CLI / SDK Layer                               │
│                                                                       │
│   exec | list | info | run | get | gate | apply | logs                │
└────────────────────────────────┬──────────────────────────────────────┘
                                 │
┌────────────────────────────────▼──────────────────────────────────────┐
│                       Application Layer                                │
│                                                                       │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐  │
│  │  AgentRunner        │    │  PipelineController                  │  │
│  │                     │    │                                      │  │
│  │  createAgent(id)    │    │  startPipeline()                     │  │
│  │  runner.run()       │    │  onAgentRunCompleted()               │  │
│  │                     │    │  approveGate() / rejectGate()        │  │
│  └─────────────────────┘    └──────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐  │
│  │  GateController     │    │  LocalAgentScheduler                 │  │
│  │                     │    │                                      │  │
│  │  openGate()         │    │  schedule(run, nodes)                │  │
│  │  approve()          │    │  Filters by capability               │  │
│  │  reject()           │    │  Respects maxConcurrentRuns          │  │
│  │  revise()           │    │                                      │  │
│  └─────────────────────┘    └──────────────────────────────────────┘  │
└────────────────────────────────┬──────────────────────────────────────┘
                                 │
┌────────────────────────────────▼──────────────────────────────────────┐
│                         Domain Layer                                   │
│                    (zero external dependencies)                        │
│                                                                       │
│  Ports (interfaces):                  Models (plain types):           │
│  ┌──────────────────────┐             ┌──────────────────────────┐    │
│  │ IExecutionBackend    │             │ AgentDefinition          │    │
│  │ IArtifactStore       │             │ ArtifactData             │    │
│  │ IPromptLoader        │             │ PipelineRun              │    │
│  │ IStateStore          │             │ AgentRunRecord           │    │
│  │ ISandboxProvider     │             │ Gate                     │    │
│  │ ILogger              │             │ AgentEvent               │    │
│  └──────────────────────┘             └──────────────────────────┘    │
└────────────────────────────────┬──────────────────────────────────────┘
                                 │
┌────────────────────────────────▼──────────────────────────────────────┐
│                        Infrastructure Layer                            │
│                                                                       │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐  │
│  │ PiAiExecution       │    │ PiCodingAgentExecution               │  │
│  │ Backend             │    │ Backend                              │  │
│  │                     │    │                                      │  │
│  │ Analysis phases     │    │ Coding / QA / DevOps / Security      │  │
│  │ Pure LLM (stream)   │    │ LLM + file tools (read/write/bash)   │  │
│  └─────────────────────┘    └──────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐  │
│  │ FsArtifactStore     │    │ SqliteStateStore                     │  │
│  │                     │    │                                      │  │
│  │ Saves artifacts to  │    │ Pipeline runs, agent runs,           │  │
│  │ filesystem as       │    │ gates, audit log                     │  │
│  │ JSON + Markdown     │    │ (.sdlc-state.db)                     │  │
│  └─────────────────────┘    └──────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐  │
│  │ FilePromptLoader    │    │ PinoLogger                           │  │
│  │                     │    │                                      │  │
│  │ Loads .md prompt    │    │ Structured JSON logging              │  │
│  │ files from disk     │    │ + OpenTelemetry spans                │  │
│  └─────────────────────┘    └──────────────────────────────────────┘  │
│                                                                       │
│  ┌─────────────────────┐                                             │
│  │ DockerSandboxAdapter│                                             │
│  │ LocalSandboxAdapter │    Isolated code execution (optional)       │
│  └─────────────────────┘                                             │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Execution Backends

Two backends implement `IExecutionBackend`, selected per-agent based on the agent's `executor` field.

```
┌─────────────────────────────────────────────────────────────────┐
│  IExecutionBackend                                              │
│  runAgent(request: AgentRunRequest): Promise<AgentRunResult>    │
└────────────────┬────────────────────────────────────────────────┘
                 │
      ┌──────────┴────────────┐
      │                       │
┌─────▼──────────┐    ┌───────▼────────────────────┐
│  PiAiExecution │    │  PiCodingAgentExecution     │
│  Backend       │    │  Backend                   │
│                │    │                             │
│  executor:     │    │  executor: pi-coding-agent  │
│  "pi-ai"       │    │                             │
│                │    │  Wraps @mariozechner/       │
│  Uses stream() │    │  pi-agent-core Agent        │
│  from pi-ai    │    │                             │
│                │    │  Has access to tools:       │
│  Agents with   │    │  read, write, edit,         │
│  executor:     │    │  bash, grep, find           │
│  pi-ai         │    │                             │
│                │    │  Agents with executor:      │
│                │    │  pi-coding-agent            │
└────────────────┘    └────────────────────────────┘
```

---

## Data Flow — Single Agent Run

```
User
 │  npx tsx packages/core/src/cli/index.ts exec <agent-name> --input brief.md
 ▼
CLI (exec.ts)
 │  Validates agent ID
 │  Loads config (env vars + overrides)
 ▼
DI Container (di/container.ts)
 │  Creates: backend, store, promptLoader, logger
 ▼
AgentRunner (agents/runner.ts)
 │  Loads system prompt (FilePromptLoader)
 │  Loads input artifacts (FsArtifactStore or inline)
 ▼
IExecutionBackend.runAgent()
 │  Builds context: systemPrompt + inputArtifacts
 │  Calls LLM (streaming)
 │  Parses JSON response → ArtifactData[]
 │  Validates each artifact against Zod schema
 ▼
FsArtifactStore.save()
 │  Writes JSON files to output/
 │  Also renders Markdown summaries
 ▼
CLI prints summary table
 │  "frd.json (frd) — 12 fields"
 │  "nfr.json (nfr) — 8 requirements"
```

---

## Data Flow — Full Pipeline Run

```
User
 │  npx tsx packages/core/src/cli/index.ts run --project my-app
 ▼
CLI (run-pipeline.ts)
 │  Creates SqliteStateStore
 │  Creates PipelineController
 ▼
PipelineController.startPipeline()
 │  Creates PipelineRun record (status: running)
 │  Finds Phase 1 agents → creates AgentRunRecord(s)
 │  Schedules via LocalAgentScheduler
 ▼
AgentRunner.run() × (phase agents)
 │  [same as single agent flow above]
 ▼
PipelineController.onAgentRunCompleted()
 │  Marks AgentRunRecord as done
 │  Attaches artifacts
 │  If all phase agents done → opens Gate
 ▼
GateController.openGate()
 │  Creates Gate record (status: pending)
 │  Pipeline status → paused_at_gate
 ▼
                ┌─── Human Review ────────────────────────┐
                │                                         │
                │  npx tsx packages/core/src/cli/index.ts get gates \   │
                │    --pipeline <run-id>                  │
                │                                         │
                │  npx tsx packages/core/src/cli/index.ts gate approve \ │
                │    <gate-id> --reviewer alice           │
                └─────────────────────────────────────────┘
 ▼
PipelineController.approveGate()
 │  Updates Gate status → approved
 │  Finds next phase agents
 │  Schedules them → repeat cycle
 ▼
[Last phase approved]
 │  No more phases → PipelineRun status → completed
 ▼
All artifacts in output/
All state in .sdlc-state.db
```

---

## State Machine

### Pipeline Run Status

```
              startPipeline()
                    │
                    ▼
               ┌─────────┐
               │ running  │
               └────┬─────┘
                    │ phase complete
                    ▼
          ┌──────────────────┐
          │  paused_at_gate  │◄──────── revise()
          └────────┬─────────┘
                   │
         ┌─────────┴──────────┐
   approve()              reject()
         │                    │
         ▼                    ▼
    ┌─────────┐          ┌────────┐
    │ running │          │ failed │
    └────┬────┘          └────────┘
         │ (last phase approved)
         ▼
    ┌───────────┐
    │ completed │
    └───────────┘

  Also: cancelled (via CLI or timeout)
```

### Gate Status

```
openGate()
    │
    ▼
┌─────────┐
│ pending │
└────┬────┘
     │
  ┌──┴────────────┬─────────────┐
approve()      reject()     revise()
  │               │              │
  ▼               ▼              ▼
┌──────────┐  ┌────────┐  ┌──────────────────┐
│ approved │  │rejected│  │revision_requested│
└──────────┘  └────────┘  └──────────────────┘
```

---

## YAML Definitions

The framework is declaratively configured through YAML files (Kubernetes-style).

### Agent Definition

Agent inputs declare **what** an agent needs, not **where** it comes from. Data wiring between agents is defined separately in the pipeline's `spec.wiring` section, keeping agent definitions fully decoupled and reusable across pipelines.

```yaml
# agents/analyst.agent.yaml
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  displayName: Business Analyst
  description: Business Analyst Agent

spec:
  executor: pi-ai                       # pi-ai | pi-coding-agent
  systemPrompt: prompts/analyst.system.md
  inputs:
    - name: raw-brief
      type: raw-brief
      required: true
    - name: stakeholder-notes
      type: stakeholder-notes
      required: false
  outputs:
    - type: frd
    - type: nfr
    - type: tech-stack-recommendation
    - type: wireframes
    - type: design-tokens
    - type: timeline
    - type: effort-estimate
    - type: project-proposal
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
    maxTokens: 64000
```

### Pipeline Definition

Pipelines define phases, gates, and **wiring** — the data flow between agents. The `spec.wiring` section maps each consumer agent to the producer agent for each artifact type it needs. This decouples agent definitions from pipeline topology.

```yaml
# pipelines/simple-sdlc.pipeline.yaml
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: simple-sdlc

spec:
  phases:
    - id: phase-1
      name: requirements
      agents: [analyst]
      gate:
        required: true
        roles: [admin, reviewer]

    - id: phase-2
      name: architecture
      agents: [architect]
      gate:
        required: true

    - id: phase-4
      name: implementation
      parallel: true                    # all agents run simultaneously
      agents: [frontend-dev, backend-dev, data-engineer]
      gate:
        required: true
        waitForAll: true

  wiring:
    architect:
      frd: analyst                      # Architect reads FRD from Analyst
      nfr: analyst
      tech-stack-recommendation: analyst
    frontend-dev:
      architecture: architect           # Frontend Dev reads architecture from Architect
      wireframes: analyst
      design-tokens: analyst
      sprint-plan: tech-lead
    backend-dev:
      architecture: architect
      sprint-plan: tech-lead
      api-code: null                    # no upstream — Backend Dev produces this
    data-engineer:
      architecture: architect
      sprint-plan: tech-lead

  crossCuttingAgents:
    security:
      trigger: after-phase             # runs after each phase
      mode: incremental                # appends to prior findings
      attachTo: gate                   # findings attached to gate review
```

---

## Artifact System

Every agent produces **typed artifacts**. Each artifact type is validated before it is saved, using a dual schema engine.

### Schema System

AgentForge supports two schema sources, unified behind the `SchemaValidator` interface:

1. **Declarative JSON Schema YAML** (`.agentforge/schemas/*.schema.yaml`) — auto-discovered at runtime, validated with ajv. Takes precedence when present. Teams can define custom artifact types without writing TypeScript.
2. **Built-in Zod schemas** (`packages/core/src/schemas/*.schema.ts`) — ship with the framework as defaults. Provide TypeScript types for compile-time safety.

```
Schema resolution order:
  1. .agentforge/schemas/<type>.schema.yaml   ← JSON Schema (ajv), wins if present
  2. packages/core/src/schemas/<type>.ts    ← Zod (built-in fallback)
```

Example declarative schema:

```yaml
# .agentforge/schemas/frd.schema.yaml
$schema: "http://json-schema.org/draft-07/schema#"
title: FRD
description: Functional Requirements Document
type: object
required: [projectName, features]
properties:
  projectName:
    type: string
  features:
    type: array
    items:
      type: object
      required: [id, title, description]
      properties:
        id: { type: string }
        title: { type: string }
        description: { type: string }
        priority: { type: string, enum: [must, should, could, wont] }
```

### Validation Flow

```
Agent Output (JSON text from LLM)
        │
        ▼
  extractJson()           ← strips markdown fences, finds { }
        │
        ▼
  JSON.parse()
        │
        ▼
  SchemaValidator.validate()
        │  1. Check .agentforge/schemas/<type>.schema.yaml → ajv
        │  2. Fall back to src/schemas/<type>.schema.ts  → Zod
        │
        ├── valid → save to output/<type>.json
        │           also write output/<type>.md (Markdown summary)
        │
        └── invalid → log warning, save raw file with .invalid.json suffix
```

### Artifact Types by Phase

| Phase | Role | Artifact Types |
|-------|------|----------------|
| 1 | Business Analyst | `frd`, `nfr`, `tech-stack-recommendation`, `timeline`, `effort-estimate`, `project-proposal`, `wireframes`, `design-tokens` |
| 2 | Architect | `architecture`, `component-diagram`, `deployment-topology`, `adrs`, `arch-options`, `security-design`, `tech-stack-confirmed` |
| 3 | Tech Lead | `sprint-plan`, `dependency-map`, `risk-register`, `dod-checklist` |
| 4 | Frontend Dev | `ui-components`, `accessibility-audit`, `component-docs` |
| 4 | Backend Dev | `api-code`, `openapi-spec`, `api-tests`, `api-docs` |
| 4 | Data Engineer | `erd`, `schema-ddl`, `migrations`, `data-contracts`, `indexing-strategy` |
| 5 | QA | `test-suite`, `coverage-report`, `defect-log`, `release-readiness` |
| cross | Security | `threat-model`, `vulnerability-scan`, `compliance-evidence`, `security-backlog` |
| 6 | DevOps | `cicd-config`, `deployment-runbook`, `iac-templates`, `monitoring-config`, `deployment-risk` |

---

## State Store Schema

State is persisted in SQLite at `output/.sdlc-state.db`.

```
┌─────────────────────────────────────────────────────────────────┐
│  pipeline_runs                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  id TEXT PK          │ status TEXT         │ project_name TEXT  │
│  pipeline_name TEXT  │ current_phase INT   │ created_at INT     │
│  input_refs TEXT     │ completed_at INT    │ metadata TEXT      │
└──────────────────────┬──────────────────────────────────────────┘
                       │ 1:N
┌──────────────────────▼──────────────────────────────────────────┐
│  agent_runs                                                     │
│  ─────────────────────────────────────────────────────────────  │
│  id TEXT PK          │ pipeline_run_id FK  │ agent_id TEXT      │
│  phase INT           │ status TEXT         │ artifacts TEXT     │
│  started_at INT      │ completed_at INT    │ token_usage TEXT   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  gates                                                          │
│  ─────────────────────────────────────────────────────────────  │
│  id TEXT PK          │ pipeline_run_id FK  │ phase INT          │
│  status TEXT         │ reviewer TEXT       │ comment TEXT       │
│  opened_at INT       │ resolved_at INT     │ artifacts TEXT     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  audit_log                                                      │
│  ─────────────────────────────────────────────────────────────  │
│  id TEXT PK          │ timestamp INT       │ actor TEXT         │
│  action TEXT         │ resource_type TEXT  │ resource_id TEXT   │
│  details TEXT        │                     │                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Observability

The framework instruments all agent runs with **OpenTelemetry**.

```
┌─────────────────────────────────────────────────────────────────┐
│  Trace: pipeline.run                                            │
│                                                                 │
│  ├── Span: agent.run (analyst, phase=1)                         │
│  │     attributes: agent.id, agent.phase, model.name           │
│  │     events: token.usage, artifact.produced                  │
│  │                                                             │
│  ├── Span: gate.review (phase=1, reviewer=alice)               │
│  │                                                             │
│  ├── Span: agent.run (architect, phase=2)                       │
│  │                                                             │
│  └── ...                                                       │
└─────────────────────────────────────────────────────────────────┘
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to export to any OTLP-compatible backend (Jaeger, Honeycomb, Datadog, etc.).

---

## Dependency Injection

The DI container is wired at the composition root (`src/di/container.ts`) and passed into all application-layer components. Nothing imports infrastructure directly — all dependencies flow inward through interfaces.

```typescript
// Composition root
const container = createContainerForAgent(agent.executor, config, {
  onProgress: (event) => spinner.update(event),
});

// container provides:
// - container.executionBackend  (PiAiBackend | PiCodingAgentBackend)
// - container.artifactStore     (FsArtifactStore)
// - container.promptLoader      (FilePromptLoader)
// - container.logger            (PinoLogger)
// - container.config            (AppConfig)
```

---

## Design Decisions

### Why Kubernetes-style YAML?
Declarative definitions let teams version-control their agent configurations, swap executors, and compose pipelines without touching application code. The YAML schema mirrors Kubernetes CRD conventions (`apiVersion`, `kind`, `metadata`, `spec`) to leverage familiar mental models.

### Why two execution backends?
Some agents produce pure **document generation** — the LLM needs no tools, just a strong system prompt and input context. Others require **file manipulation** (reading existing code, writing new files, running shell commands). Separating these keeps each backend simple and testable, and the per-agent `executor` field lets pipeline authors pick per step.

### Why SQLite for state?
Pipeline runs can take hours. SQLite gives durable, zero-configuration persistence that survives process restarts, works in CI, and doesn't require a running database server. The schema is simple enough that SQLite is more than sufficient for single-node deployments.

### Why strict schema validation?
LLMs produce variable-structure JSON. Schemas enforce contracts between agents — if an upstream agent is supposed to produce an `openapi-spec`, a downstream agent can rely on its shape being valid. Invalid artifacts are flagged immediately rather than silently propagating bad data downstream. The dual schema engine (JSON Schema YAML + Zod) lets teams define custom artifact types declaratively without writing TypeScript, while built-in Zod schemas provide compile-time type safety for the framework's own artifact types.

---

## Extension Points

| What to extend | How |
|----------------|-----|
| New LLM provider | Implement `IExecutionBackend`, wire in `di/container.ts` |
| New artifact store | Implement `IArtifactStore` (e.g., S3, database) |
| New agent | Add YAML to `agents/`, add system prompt to `src/agents/prompts/`, register in `src/agents/registry.ts`, add schemas to `.agentforge/schemas/` (JSON Schema YAML) or `src/schemas/` (Zod) |
| New pipeline | Add YAML to `pipelines/` |
| Remote execution nodes | Implement `IAgentScheduler` with remote node awareness (P10) |
| Custom gates | Gate controller supports approve / reject / revise — additional actions can be wired via the CLI |

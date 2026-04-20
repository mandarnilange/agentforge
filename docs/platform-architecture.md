# AgentForge Platform — Architecture Reference

> Comprehensive architecture document for the Kubernetes-style AI agent orchestration platform.
> Covers control plane, execution plane, communication, failure recovery, clean architecture,
> deployment, and executor extensibility.

---

## Table of Contents

1. [Platform Vision](#1-platform-vision)
2. [System Architecture Overview](#2-system-architecture-overview)
   - 2.1 [Two-Plane Architecture](#21-two-plane-architecture)
   - 2.2 [Kubernetes Alignment](#22-kubernetes-alignment)
   - 2.3 [Component Map](#23-component-map)
3. [Control Plane](#3-control-plane)
   - 3.1 [Pipeline Controller](#31-pipeline-controller)
   - 3.2 [Gate Controller](#32-gate-controller)
   - 3.3 [Agent Scheduler](#33-agent-scheduler)
   - 3.4 [Reconciliation Loop](#34-reconciliation-loop)
   - 3.5 [Node Health Monitor](#35-node-health-monitor)
   - 3.6 [Event Bus](#36-event-bus)
   - 3.7 [HTTP API Server](#37-http-api-server)
4. [Execution Plane](#4-execution-plane)
   - 4.1 [IAgentExecutor Interface](#41-iagenexecutor-interface)
   - 4.2 [LocalAgentExecutor](#42-localagentexecutor)
   - 4.3 [DockerAgentExecutor](#43-dockeragentexecutor)
   - 4.4 [RemoteAgentExecutor](#44-remoteagentexecutor)
   - 4.5 [Execution Backends (LLM Layer)](#45-execution-backends-llm-layer)
   - 4.6 [Step Pipeline Engine](#46-step-pipeline-engine)
   - 4.7 [Sandbox Execution](#47-sandbox-execution)
5. [State Management](#5-state-management)
   - 5.1 [State Store Schema](#51-state-store-schema)
   - 5.2 [State Machines](#52-state-machines)
   - 5.3 [Audit Trail](#53-audit-trail)
6. [Declarative Resource Model](#6-declarative-resource-model)
   - 6.1 [Agent Definitions](#61-agent-definitions)
   - 6.2 [Pipeline Definitions](#62-pipeline-definitions)
   - 6.3 [Node Definitions](#63-node-definitions)
   - 6.4 [Definition Storage and Persistence](#64-definition-storage-and-persistence)
   - 6.5 [Definition Lifecycle](#65-definition-lifecycle)
   - 6.6 [kubectl-Aligned CLI Commands](#66-kubectl-aligned-cli-commands)
   - 6.7 [Output Formats](#67-output-formats)
   - 6.8 [Definition Versioning](#68-definition-versioning)
   - 6.9 [kubectl Alignment Summary](#69-kubectl-alignment-summary)
7. [Communication Protocols](#7-communication-protocols)
   - 7.1 [In-Process Communication](#71-in-process-communication)
   - 7.2 [HTTP Control Plane API](#72-http-control-plane-api)
   - 7.3 [Node Watch API (SSE)](#73-node-watch-api-sse)
   - 7.4 [Dashboard SSE](#74-dashboard-sse)
   - 7.5 [Docker Container Protocol](#75-docker-container-protocol)
8. [The Nine-Agent Pipeline](#8-the-nine-agent-pipeline)
   - 8.1 [Agent Roster](#81-agent-roster)
   - 8.2 [Pipeline Flow](#82-pipeline-flow)
   - 8.3 [Artifact Lifecycle](#83-artifact-lifecycle)
   - 8.4 [Cost Tracking](#84-cost-tracking)
9. [Failure Recovery](#9-failure-recovery)
   - 9.1 [Executor Timeout Detection](#91-executor-timeout-detection)
   - 9.2 [Node Failure and Failover](#92-node-failure-and-failover)
   - 9.3 [Pipeline Crash Recovery](#93-pipeline-crash-recovery)
   - 9.4 [Gate Revision Flow](#94-gate-revision-flow)
   - 9.5 [Optimistic Concurrency Control](#95-optimistic-concurrency-control)
10. [Clean Architecture](#10-clean-architecture)
    - 10.1 [Layer Diagram](#101-layer-diagram)
    - 10.2 [Domain Layer (Ports & Models)](#102-domain-layer-ports--models)
    - 10.3 [Application Layer](#103-application-layer)
    - 10.4 [Adapters Layer](#104-adapters-layer)
    - 10.5 [Composition Root (DI)](#105-composition-root-di)
    - 10.6 [Dependency Rules](#106-dependency-rules)
11. [Deployment Architecture](#11-deployment-architecture)
    - 11.1 [Single-Machine (Development)](#111-single-machine-development)
    - 11.2 [Docker Compose (Team)](#112-docker-compose-team)
    - 11.3 [Distributed (Production)](#113-distributed-production)
    - 11.4 [Configuration System](#114-configuration-system)
12. [Extending the Platform](#12-extending-the-platform)
    - 12.1 [Writing a Custom Executor](#121-writing-a-custom-executor)
    - 12.2 [Docker Executor Image Contract](#122-docker-executor-image-contract)
    - 12.3 [Adding an LLM Provider](#123-adding-an-llm-provider)
    - 12.4 [Adding a Data Source](#124-adding-a-data-source)
    - 12.5 [Extension Points Summary](#125-extension-points-summary)
13. [Observability](#13-observability)
14. [Security Model](#14-security-model)
    - 14.1 [Agent Identity and Access Control](#141-agent-identity-and-access-control)
15. [Glossary](#15-glossary)

---

## 1. Platform Vision

The AgentForge Platform automates the entire software development lifecycle through 9 specialized AI agents coordinated by a Kubernetes-style control plane.

**Core principles:**

- **Declarative**: Agents, pipelines, and nodes defined in YAML — desired state as code
- **Separated concerns**: Control plane orchestrates; execution plane runs agents
- **Human-in-the-loop**: Approval gates between phases for quality assurance
- **Observable**: OpenTelemetry traces, structured logs, cost tracking
- **Extensible**: Port-based architecture — swap executors, LLM providers, storage backends

**What it produces**: From a single project brief, the pipeline generates requirements documents, architecture, sprint plans, frontend code, backend code, database schemas, tests, security scans, and deployment configurations — all reviewed by humans at each phase boundary.

---

## 2. System Architecture Overview

### 2.1 Two-Plane Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CONTROL PLANE                                │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐              │
│  │  Pipeline     │  │    Gate      │  │    Agent      │              │
│  │  Controller   │  │  Controller  │  │   Scheduler   │              │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘              │
│         │                 │                   │                       │
│  ┌──────▼─────────────────▼───────────────────▼───────┐              │
│  │              Reconciliation Loop                    │              │
│  │           Node Health Monitor                       │              │
│  └──────────────────────┬─────────────────────────────┘              │
│                         │                                            │
│  ┌──────────────────────▼─────────────────────────────┐              │
│  │              State Store (SQLite / PostgreSQL)       │              │
│  │  pipeline_runs | agent_runs | gates | nodes | logs  │              │
│  └──────────────────────┬─────────────────────────────┘              │
│                         │                                            │
│  ┌──────────────────────▼─────────────────────────────┐              │
│  │           Event Bus  →  SSE  →  Dashboard           │              │
│  └─────────────────────────────────────────────────────┘              │
│                                                                      │
│  ┌─────────────────────────────────────────────────────┐              │
│  │         HTTP API Server (Control Plane API)          │              │
│  │  /api/v1/nodes/register  |  /heartbeat  |  /runs    │              │
│  └──────────────────────┬──────────────────────────────┘              │
└─────────────────────────┼────────────────────────────────────────────┘
                          │ IAgentExecutor interface
                          │ (function call / HTTP / Docker API)
┌─────────────────────────┼────────────────────────────────────────────┐
│                         ▼        EXECUTION PLANE                     │
│                                                                      │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐     │
│  │ LocalAgent      │  │  DockerAgent     │  │  RemoteAgent    │     │
│  │ Executor        │  │  Executor        │  │  Executor       │     │
│  │ (same process)  │  │  (container/job) │  │  (HTTP client)  │     │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬────────┘     │
│           │                    │                      │              │
│  ┌────────▼────────────────────▼──────────────────────▼────────┐     │
│  │                    IExecutionBackend                         │     │
│  │         PiAiBackend  |  PiCodingAgentBackend                │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │              Step Pipeline Engine                            │     │
│  │    script → llm → validate → transform (per agent YAML)     │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │         Sandbox (Local | Docker | Remote)                    │     │
│  └─────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Kubernetes Alignment

| Platform Component | K8s Equivalent | Responsibility |
|---|---|---|
| **State Store** (SQLite/PG) | etcd | Single source of truth for all runtime state |
| **HTTP API Server** | kube-apiserver | All mutations through authenticated HTTP API |
| **Agent Scheduler** | kube-scheduler | Decides WHERE an agent runs (node selection) |
| **Pipeline Controller** | Controller Manager | Watches desired vs actual state; advances phases |
| **Reconciliation Loop** | Controller reconcile | Detects drift, reschedules failed work |
| **Node Health Monitor** | Node controller | Heartbeat-based health, auto-failover |
| **NodeWorker** | kubelet | Runs on each node; polls for work; reports status |
| **AgentRun** | Pod | Single execution of an agent on a node |
| **Gate Controller** | Admission Controller | Human-in-the-loop governance |
| **YAML Definitions** | CRDs / Pod Specs | Declarative desired-state configuration |
| **Node Capabilities** | Node labels/taints | Capability-based scheduling constraints |
| **Sandbox** | Container Runtime | Isolated code execution environment |

### 2.3 Component Map

```
src/
├── cli/                    # CLI entry points (Commander)
│   ├── index.ts           # Program setup, definition loading, DI wiring
│   ├── commands/          # run, gate, exec, list, info, logs, dashboard, apply, get
│   └── pipeline-executor.ts  # Phase loop (delegates to IAgentExecutor)
├── domain/                 # ZERO external dependencies
│   ├── models/            # PipelineRun, AgentRun, Gate, Node, Artifact, Events
│   └── ports/             # IStateStore, IExecutionBackend, IAgentExecutor, IEventBus, ...
├── control-plane/          # Orchestration
│   ├── pipeline-controller.ts  # Phase transitions, gate creation
│   ├── gate-controller.ts      # Approve/reject/revise gates
│   ├── scheduler.ts            # Node selection (affinity, capabilities)
│   ├── reconciler.ts           # Desired vs actual state reconciliation [P18]
│   └── node-health-monitor.ts  # Heartbeat monitoring, failover [P18]
├── adapters/               # Port implementations
│   ├── execution/          # PiAiBackend, PiCodingAgentBackend, LocalAgentExecutor
│   ├── store/              # FsArtifactStore
│   ├── sandbox/            # LocalSandbox, DockerSandbox
│   ├── control-plane/      # InProcessControlPlaneApi, HttpControlPlaneClient [P18]
│   └── events/             # InMemoryEventBus [P18]
├── engine/                 # Step pipeline executor
│   ├── step-pipeline.ts    # Orchestrates script→llm→validate→transform
│   └── steps/              # Individual step handlers
├── nodes/                  # Node runtimes
│   ├── worker.ts           # NodeWorker (register, poll, execute, heartbeat)
│   ├── local-runtime.ts    # Local execution
│   ├── ssh-runtime.ts      # Remote SSH execution
│   ├── registry.ts         # In-memory node registry
│   ├── health-check.ts     # Periodic ping health checker
│   ├── cost-calculator.ts  # Token-to-USD cost estimation
│   └── executor-service.ts # HTTP server wrapping LocalAgentExecutor [P18]
├── state/                  # Persistence
│   ├── schema.ts           # DDL for all tables
│   └── store.ts            # SqliteStateStore implements IStateStore
├── dashboard/              # HTTP server + React SPA
│   ├── server.ts           # Node.js HTTP server
│   ├── routes/             # api-routes, sse-routes, control-plane-routes [P18]
│   └── app/                # React + Vite + Tailwind + TanStack Query
├── schemas/                # Zod artifact schemas
├── agents/                 # Agent definitions, prompts, registry, runner
├── definitions/            # YAML parser and in-memory definition store
├── observability/          # OpenTelemetry init, metrics
└── di/                     # Composition root (container.ts, config.ts)
```

---

## 3. Control Plane

The control plane is the brain of the platform. It never executes agent work directly — it orchestrates, schedules, monitors, and reconciles.

### 3.1 Pipeline Controller

**File**: `src/control-plane/pipeline-controller.ts`

The Pipeline Controller manages the lifecycle of pipeline runs. It is **event-driven** (reacts to agent completion) and backed by a **reconciliation loop** (detects drift).

**Responsibilities:**
- Start pipelines: create `PipelineRun`, schedule first phase's agents
- React to agent completion: check if phase is done, open gate or advance
- React to agent failure: mark pipeline as failed
- Handle gate decisions: approve → next phase, reject → fail, revise → re-run phase
- Stop/retry pipelines

**Key methods:**

```typescript
class PipelineController {
  startPipeline(projectName, pipelineDef, inputs): PipelineRun
  onAgentRunCompleted(agentRunId, outputArtifactIds): void
  onAgentRunFailed(agentRunId, error): void
  approveGate(gateId, pipelineDef, reviewer?, comment?): void
  rejectGate(gateId, reviewer?, comment?): void
  reviseGate(gateId, notes, reviewer?): void
  stopPipeline(pipelineRunId): PipelineRun
  retryPipeline(pipelineRunId, pipelineDef): PipelineRun
}
```

**Phase advancement logic** (in `onAgentRunCompleted`):
1. Get all agent runs for current phase
2. Filter to latest run per agent (handles retries)
3. If ALL agents succeeded → check for gate
4. If gate required → `GateController.openGate()`, pipeline status → `paused_at_gate`
5. If no gate → schedule next phase agents, increment `currentPhase`
6. If last phase → pipeline status → `completed`

### 3.2 Gate Controller

**File**: `src/control-plane/gate-controller.ts`

Gates are human-in-the-loop checkpoints between pipeline phases. They act as admission controllers — no phase transition occurs without explicit human approval.

**Gate lifecycle:**

```
                    ┌─── approve ──→ approved (pipeline advances)
                    │
  pending ──────────┼─── reject ───→ rejected (pipeline fails)
                    │
                    └─── revise ───→ revision_requested
                                         │
                                         └──→ agents re-run with revision notes
                                              └──→ new gate created (pending)
```

**Side effects of each decision:**
- **Approve**: Pipeline status → `running`, next phase scheduled, audit log entry
- **Reject**: Pipeline status → `failed`, audit log entry
- **Revise**: New agent runs created with `revisionNotes`, re-scheduled on same phase

**Validation**: Only `pending` gates can be decided. Attempting to decide a non-pending gate throws an error.

**Deduplication**: The controller checks for existing pending/approved gates before creating new ones (prevents duplicate gates from concurrent agent completions).

### 3.3 Agent Scheduler

**File**: `src/control-plane/scheduler.ts`

The scheduler decides which node runs each agent. It implements capability-based scheduling inspired by Kubernetes node affinity.

```typescript
interface IAgentScheduler {
  schedule(agent: AgentDefinitionYaml, nodePool: NodeDefinitionYaml[]): NodeDefinitionYaml
  recordRunStarted(nodeName: string): void
  recordRunCompleted(nodeName: string): void
  getActiveRunCount(nodeName: string): number
}
```

**Scheduling algorithm:**
1. Filter nodes by **required capabilities** (must ALL match)
2. Filter by **online status** (exclude offline/degraded nodes)
3. Filter by **maxConcurrentRuns** (exclude nodes at capacity)
4. Score remaining candidates by count of **preferred capabilities** matched
5. Return highest-scoring node

**Example**: A `developer` agent requires `[llm-access, docker]` and prefers `[high-memory]`. Node A has `[llm-access, docker, high-memory]` (score: 1), Node B has `[llm-access, docker]` (score: 0). Node A is selected.

### 3.4 Reconciliation Loop

**File**: `src/control-plane/reconciler.ts` [P18-T10]

The reconciler is the "controller-manager" — it continuously compares actual state with desired state and takes corrective action.

**Runs every N seconds (default: 15s).**

**What it detects and fixes:**

| Condition | Detection | Action |
|-----------|-----------|--------|
| Stale agent run | `status = "running"` AND `lastStatusAt` older than 60s | Mark failed, reschedule to different node (up to `maxRetries`) |
| Orphaned pipeline | `status = "running"` with no active agent runs | Check if phase should advance; mark failed if stuck |
| Offline node with work | Node `status = "offline"` with assigned runs | Fail runs, reschedule to healthy nodes |

**Idempotency**: Running reconcile twice with the same state produces the same result.

**Audit**: All reconciliation actions are logged to `audit_log` table and emitted via event bus.

```typescript
interface ReconciliationResult {
  staleRunsDetected: number;
  runsRescheduled: number;
  pipelinesAdvanced: number;
  errors: string[];
}
```

### 3.5 Node Health Monitor

**File**: `src/control-plane/node-health-monitor.ts` [P18-T11]

Monitors node heartbeats and manages automatic node lifecycle transitions.

**Node status state machine:**

```
  unknown ──── (register) ──→ online ──── (heartbeat late >30s) ──→ degraded
     ▲                          ▲                                      │
     │                          │                                      │
     │                   (heartbeat                            (heartbeat
     │                    received)                             missed >120s)
     │                          │                                      │
     │                          └──── (heartbeat received) ◄───────────┤
     │                                                                 │
     └───────────────────────────────────────────────────── offline ◄──┘
```

| Status | Heartbeat Age | Scheduling | Dashboard Badge |
|--------|---------------|------------|-----------------|
| **online** | < 30s | Eligible | Green |
| **degraded** | 30s – 120s | Eligible (deprioritized) | Yellow |
| **offline** | > 120s | Excluded | Red |
| **unknown** | No heartbeat ever | Excluded | Gray |

**Automated failover**: When a node transitions to `offline`:
1. Stop scheduling new work to it
2. Find all agent runs assigned to that node with `status = "running"`
3. Mark them as `failed` with error `"node offline"`
4. Reconciler picks them up for rescheduling

### 3.6 Event Bus

**Port**: `src/domain/ports/event-bus.port.ts` [P18-T5]
**Adapter**: `src/adapters/events/in-memory-event-bus.ts`

The event bus is an ephemeral pub/sub channel for real-time notifications. It is NOT a persistence layer — the state store is the source of truth.

```typescript
type PipelineEvent =
  | { type: "pipeline_updated"; pipelineRunId: string; status: string }
  | { type: "run_updated"; runId: string; status: string; statusUpdate?: StatusUpdate }
  | { type: "gate_opened"; gateId: string; pipelineRunId: string }
  | { type: "gate_decided"; gateId: string; decision: string }
  | { type: "node_online"; nodeName: string }
  | { type: "node_degraded"; nodeName: string }
  | { type: "node_offline"; nodeName: string };

interface IEventBus {
  emit(event: PipelineEvent): void;
  subscribe(listener: (event: PipelineEvent) => void): () => void;  // returns unsubscribe fn
}
```

**Emitters**: PipelineController, GateController, NodeHealthMonitor, Reconciler
**Subscribers**: SSE endpoint (forwards to dashboard clients)

### 3.7 HTTP API Server

**File**: `src/dashboard/routes/control-plane-routes.ts` [P18-T9]

Exposes `IControlPlaneApi` over HTTP so remote nodes can register and communicate with the control plane over the network. This is the "kube-apiserver" equivalent.

**Node-facing endpoints (for remote NodeWorker):**

| Method | Path | Purpose | Request Body | Response |
|--------|------|---------|-------------|----------|
| POST | `/api/v1/nodes/register` | Node registers itself | `{ definition: NodeDefinitionYaml }` | `{ status: "registered" }` |
| POST | `/api/v1/nodes/:name/heartbeat` | Periodic health report | `{ activeRuns: number }` | `{ status: "ok" }` |
| GET | `/api/v1/nodes/:name/pending-runs` | Node polls for work (fallback) | — | `{ runs: NodeRunRequest[] }` |
| GET | `/api/v1/nodes/:name/watch` | SSE: push work to node (preferred) | — | SSE stream |
| POST | `/api/v1/runs/:id/result` | Node reports completion | `{ result: NodeRunResult }` | `{ status: "accepted" }` |

**Dashboard-facing endpoints (existing):**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/summary` | Dashboard overview (counts, costs) |
| GET | `/api/v1/pipelines` | List all pipeline runs |
| GET | `/api/v1/pipelines/:id` | Pipeline detail + agent runs + gates |
| POST | `/api/v1/pipelines` | Start new pipeline |
| POST | `/api/v1/pipelines/:id/stop` | Stop running pipeline |
| POST | `/api/v1/pipelines/:id/retry` | Retry failed pipeline |
| GET | `/api/v1/gates/pending` | List pending gates |
| POST | `/api/v1/gates/:id/approve` | Approve gate |
| POST | `/api/v1/gates/:id/reject` | Reject gate |
| POST | `/api/v1/gates/:id/revise` | Request revision |
| GET | `/api/v1/runs?pipelineId=X` | List agent runs |
| GET | `/api/v1/runs/:id` | Agent run detail |
| GET | `/api/v1/runs/:id/conversation` | LLM conversation log |
| GET | `/api/v1/runs/:id/logs` | Centralized execution logs |
| GET | `/api/v1/runs/:id/artifacts` | Artifacts for run |
| GET | `/api/v1/nodes` | List nodes with health |
| GET | `/api/v1/events` | SSE stream for real-time updates |

**Authentication**: Node endpoints use `X-Node-Token` header. Dashboard endpoints are unauthenticated (internal network assumption for MVP).

---

## 4. Execution Plane

The execution plane runs agents. It has zero knowledge of pipelines, phases, or gates. It receives an `AgentJob`, executes it, streams status updates, and returns an `AgentJobResult`.

### 4.1 IAgentExecutor Interface

**File**: `src/domain/ports/agent-executor.port.ts`

This is the boundary between control plane and execution plane.

```typescript
interface AgentJob {
  readonly runId: string;
  readonly agentId: string;
  readonly agentDefinition: AgentDefinitionYaml;
  readonly inputs: readonly ArtifactData[];
  readonly workdir: string;
  readonly outputDir: string;
  readonly model: {
    readonly provider: string;
    readonly name: string;
    readonly maxTokens: number;
  };
  readonly revisionNotes?: string;
  readonly identity?: AgentJobIdentity;  // access control (see Sec 14.1)
}

interface AgentJobResult {
  readonly status: "succeeded" | "failed";
  readonly artifacts: readonly ArtifactData[];
  readonly savedFiles: readonly string[];
  readonly tokenUsage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly costUsd: number;
  readonly durationMs: number;
  readonly conversationLog: readonly ConversationEntry[];
  readonly error?: string;
}

type StatusUpdateType =
  | "started" | "progress" | "step_started"
  | "step_completed" | "completed" | "failed";

interface StatusUpdate {
  readonly type: StatusUpdateType;
  readonly runId: string;
  readonly step?: string;
  readonly message?: string;
  readonly tokensGenerated?: number;
  readonly timestamp: number;
}

interface IAgentExecutor {
  execute(
    job: AgentJob,
    onStatus?: (update: StatusUpdate) => void,
  ): Promise<AgentJobResult>;
  cancel?(runId: string): void;
}
```

**Key design decisions:**
- `AgentJob` contains everything the executor needs — no back-references to control plane
- `onStatus` callback is optional — local executors use it for in-process status, remote executors use HTTP/SSE
- `cancel` is optional — not all executors support mid-flight cancellation
- Executor NEVER touches the state store — it returns results, control plane persists them

### 4.2 LocalAgentExecutor

**File**: `src/adapters/execution/local-agent-executor.ts`

Runs agents in the same process as the control plane. Used for development and single-machine deployments.

**Execution flow:**
1. Emit `StatusUpdate { type: "started" }`
2. Select `IExecutionBackend` based on `job.agentDefinition.spec.executor` (pi-ai or pi-coding-agent)
3. Build `AgentRunRequest` from `AgentJob`
4. Create `AgentRunner` via `createAgent(agentId, container)`
5. Execute step pipeline (if agent has steps) or single-step LLM call
6. Emit `StatusUpdate { type: "step_started/step_completed" }` for each step
7. Calculate cost from token usage
8. Emit `StatusUpdate { type: "completed" }` or `{ type: "failed" }`
9. Return `AgentJobResult`

**What it does NOT do**: Update database, call PipelineController, write audit logs.

### 4.3 DockerAgentExecutor

**File**: `src/adapters/execution/docker-agent-executor.ts` [P18-T8]

Launches a Docker container per agent job. The user provides the Docker image.

**Container lifecycle:**

```
1. Create container
   - Image: from agent definition or CLI flag
   - Mounts: job.workdir → /workspace, job.outputDir → /output
   - Env vars: AGENT_ID, RUN_ID, MODEL_PROVIDER, MODEL_NAME, API_KEY, MAX_TOKENS
   - Labels: { "sdlc.run-id": runId } (for cancel/cleanup)
   - Resource limits: memory, CPU from agent definition

2. Start container

3. Stream stdout (JSON lines → StatusUpdate events → onStatus callback)
   Each line: {"type":"progress","message":"Generating architecture...","timestamp":1234567890}

4. Wait for container exit
   - Exit 0 → succeeded
   - Exit non-zero → failed

5. Read /output/_result.json for AgentJobResult
   {
     "artifacts": [...],
     "tokenUsage": { "inputTokens": N, "outputTokens": N },
     "costUsd": N,
     "conversationLog": [...]
   }

6. Remove container
```

**Cancel**: Find container by label `sdlc.run-id=<runId>`, stop and remove it.

### 4.4 RemoteAgentExecutor

**File**: `src/adapters/execution/remote-agent-executor.ts` [P18-T6]

Sends agent jobs to a remote executor service over HTTP. Used for distributed deployments where execution nodes are on different machines.

**Communication flow:**

```
Control Plane                           Remote Executor Service
     │                                         │
     │── POST /execute {AgentJob} ────────────▶│
     │◀─ { runId: "abc" } ───────────────────│
     │                                         │ (starts LocalAgentExecutor)
     │── GET /status/abc (SSE) ──────────────▶│
     │◀─ event: {"type":"started"} ──────────│
     │◀─ event: {"type":"progress"} ─────────│
     │◀─ event: {"type":"completed"} ────────│
     │                                         │
     │── GET /result/abc ────────────────────▶│
     │◀─ AgentJobResult ─────────────────────│
     │                                         │
```

**Executor service** (`src/nodes/executor-service.ts`): HTTP server that wraps `LocalAgentExecutor` for network access. This is what runs on remote nodes.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/execute` | Accept AgentJob, start execution |
| GET | `/status/:runId` | SSE stream of StatusUpdate events |
| GET | `/result/:runId` | Get AgentJobResult (after completion) |
| POST | `/cancel/:runId` | Cancel running job |

### 4.5 Execution Backends (LLM Layer)

**Port**: `src/domain/ports/execution-backend.port.ts`

This is the LLM-level abstraction **inside** the executor. It is NOT exposed to the control plane.

```typescript
interface IExecutionBackend {
  runAgent(request: AgentRunRequest): Promise<AgentRunResult>;
}
```

**Two implementations:**

| Backend | Library | Used By | Capabilities |
|---------|---------|---------|-------------|
| `PiAiExecutionBackend` | `@mariozechner/pi-ai` | Pure-LLM agents (e.g., analyst, architect) | LLM streaming, document generation |
| `PiCodingAgentExecutionBackend` | `@mariozechner/pi-coding-agent` | Tool-using agents (e.g., developer, QA, security) | LLM + file tools + bash |

**Backend selection**: Based on `agentDefinition.spec.executor` field (`"pi-ai"` or `"pi-coding-agent"`).

### 4.6 Step Pipeline Engine

**File**: `src/engine/step-pipeline.ts`

Agents can define multi-step workflows in their YAML definition. The step pipeline executes them sequentially with context passing.

**Step types:**

| Type | Handler | Description | Example |
|------|---------|-------------|---------|
| `script` | `executeScriptStep()` | Run shell command | `npm run lint` |
| `llm` | `executeLlmStep()` | Call LLM via backend | Generate architecture doc |
| `validate` | `executeValidateStep()` | Validate against Zod schema | Check artifact structure |
| `transform` | `executeTransformStep()` | Transform data | Extract section from doc |

**Template context**: Steps can reference prior step outputs via `{{steps.stepName.output}}` and run metadata via `{{run.id}}`, `{{pipeline.name}}`, etc.

**Execution flow:**
```
For each step in pipeline:
  1. Evaluate condition (skip if false)
  2. Resolve template variables
  3. Execute step handler
  4. Store result in context.steps[step.name]
  5. If step fails and !continueOnError → stop pipeline
```

### 4.7 Sandbox Execution

**Port**: `src/domain/ports/sandbox.port.ts`

Sandboxes provide isolated execution environments for script steps.

```typescript
interface ISandbox {
  run(command: string, options?: RunOptions): Promise<RunResult>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  readFile(path: string): Promise<string>;
  copyIn(localPath: string, sandboxPath: string): Promise<void>;
  copyOut(sandboxPath: string, localPath: string): Promise<void>;
  destroy(): Promise<void>;
}

interface ISandboxProvider {
  create(options: SandboxOptions): Promise<ISandbox>;
}
```

| Sandbox | Isolation | Use Case |
|---------|-----------|----------|
| `LocalSandbox` | None (host) | Development, trusted scripts |
| `DockerSandbox` | Container | Production, untrusted code execution |

**DockerSandbox details:**
- Image: `agentforge-base:latest` (configurable)
- Container command: `tail -f /dev/null` (kept alive for multi-command sessions)
- Working directory: `/workspace`
- File transfer: tar archives via Docker API
- Memory limits: parsed from config (`"1g"`, `"512m"`)
- Cleanup: `destroy()` force-removes container

---

## 5. State Management

### 5.1 State Store Schema

**File**: `src/state/schema.ts`

The state store is the single source of truth — the "etcd" of the platform.

```sql
-- Pipeline runs (the top-level orchestration unit)
CREATE TABLE pipeline_runs (
  id              TEXT PRIMARY KEY,
  project_name    TEXT NOT NULL,
  pipeline_name   TEXT NOT NULL,
  status          TEXT NOT NULL,        -- running | paused_at_gate | completed | failed | cancelled
  current_phase   INTEGER NOT NULL DEFAULT 1,
  inputs          TEXT,                 -- JSON: user-provided inputs [P18]
  started_at      TEXT NOT NULL,
  completed_at    TEXT,
  created_at      TEXT NOT NULL
);

-- Agent runs (individual agent executions within a pipeline phase)
CREATE TABLE agent_runs (
  id                  TEXT PRIMARY KEY,
  pipeline_run_id     TEXT NOT NULL REFERENCES pipeline_runs(id),
  agent_name          TEXT NOT NULL,
  phase               INTEGER NOT NULL,
  node_name           TEXT NOT NULL,
  status              TEXT NOT NULL,    -- pending | scheduled | running | succeeded | failed
  input_artifact_ids  TEXT NOT NULL DEFAULT '[]',   -- JSON array
  output_artifact_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array
  token_usage         TEXT,                         -- JSON: {inputTokens, outputTokens}
  provider            TEXT,
  model_name          TEXT,
  cost_usd            REAL,
  duration_ms         INTEGER,
  error               TEXT,
  revision_notes      TEXT,
  last_status_at      TEXT,            -- [P18] for liveness detection
  status_message      TEXT,            -- [P18] latest status from executor
  started_at          TEXT NOT NULL,
  completed_at        TEXT,
  created_at          TEXT NOT NULL
);

-- Gates (human approval checkpoints between phases)
CREATE TABLE gates (
  id                    TEXT PRIMARY KEY,
  pipeline_run_id       TEXT NOT NULL REFERENCES pipeline_runs(id),
  phase_completed       INTEGER NOT NULL,
  phase_next            INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | revision_requested
  reviewer              TEXT,
  comment               TEXT,
  revision_notes        TEXT,
  artifact_version_ids  TEXT NOT NULL DEFAULT '[]',       -- JSON array
  cross_cutting_findings TEXT,                            -- JSON: cross-cutting agent output (e.g., security scan)
  decided_at            TEXT,
  created_at            TEXT NOT NULL
);

-- Execution nodes (where agents run)
CREATE TABLE nodes (
  name                TEXT PRIMARY KEY,
  type                TEXT NOT NULL,          -- local | ssh | docker | remote
  capabilities        TEXT NOT NULL DEFAULT '[]',  -- JSON array: ["llm-access", "docker", "gpu"]
  max_concurrent_runs INTEGER,
  status              TEXT NOT NULL,          -- online | offline | unknown | degraded
  active_runs         INTEGER NOT NULL DEFAULT 0,
  last_heartbeat      TEXT,
  updated_at          TEXT NOT NULL
);

-- Audit log (immutable record of all significant actions)
CREATE TABLE audit_log (
  id              TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL,
  actor           TEXT NOT NULL,       -- "system", "reconciler", reviewer name
  action          TEXT NOT NULL,       -- "gate_approved", "run_rescheduled", etc.
  resource_type   TEXT NOT NULL,       -- "gate", "agent_run", "pipeline_run", "node"
  resource_id     TEXT NOT NULL,
  metadata        TEXT,                -- JSON: additional context
  created_at      TEXT NOT NULL
);

-- Centralized execution logs [P18]
CREATE TABLE execution_logs (
  id            TEXT PRIMARY KEY,
  agent_run_id  TEXT NOT NULL,
  level         TEXT NOT NULL,         -- info | warn | error | debug
  message       TEXT NOT NULL,
  metadata      TEXT,                  -- JSON: step name, tool name, etc.
  timestamp     TEXT NOT NULL
);

-- Resource definitions — DB-backed (replaces in-memory store) [P15.5]
CREATE TABLE resource_definitions (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,           -- AgentDefinition | PipelineDefinition | NodeDefinition
  name        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  spec_yaml   TEXT NOT NULL,           -- Full YAML content
  metadata    TEXT,                    -- JSON: parsed metadata for fast queries
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(kind, name)
);

-- Revision history for definitions [P15.5]
CREATE TABLE resource_definition_history (
  id              TEXT PRIMARY KEY,
  definition_id   TEXT NOT NULL,
  version         INTEGER NOT NULL,
  spec_yaml       TEXT NOT NULL,
  changed_by      TEXT NOT NULL,       -- cli | dashboard | api
  change_type     TEXT NOT NULL,       -- created | updated | rolled_back | deleted
  created_at      TEXT NOT NULL
);
```

### 5.2 State Machines

#### Pipeline Run States

```
                        ┌──────── stopPipeline() ────────┐
                        │                                 ▼
  ──→ running ─────────┬──→ paused_at_gate              cancelled
        ▲   │          │        │   │   │                   │
        │   │          │        │   │   └─ revise → running │
        │   │          │        │   └─── reject → failed    │
        │   │          │        └────── approve → running   │
        │   │          │                                    │
        │   │          └── agent fails ──→ failed ◄─────────┘
        │   │                               │
        │   │                     retry ────┘
        │   └── all agents + no more phases ──→ completed (terminal)
        │
        └── retryPipeline()
```

| Transition | From | To | Trigger |
|-----------|------|-----|---------|
| Start | — | `running` | `startPipeline()` |
| Gate needed | `running` | `paused_at_gate` | All phase agents succeed + gate defined |
| Approve gate | `paused_at_gate` | `running` | `approveGate()` |
| Reject gate | `paused_at_gate` | `failed` | `rejectGate()` |
| Revise gate | `paused_at_gate` | `running` | `reviseGate()` — re-runs phase agents |
| Agent fails | `running` | `failed` | `onAgentRunFailed()` |
| All done | `running` | `completed` | Last phase, all agents succeeded |
| Cancel | `running` | `cancelled` | `stopPipeline()` |
| Retry | `failed`/`cancelled` | `running` | `retryPipeline()` |

#### Agent Run States

```
  pending ──→ running ──→ succeeded
                 │
                 └──→ failed ──→ (reconciler may create new pending run)
```

| Transition | Trigger | Code Location |
|-----------|---------|---------------|
| `pending` → `running` | Pipeline executor picks up run | `pipeline-executor.ts` |
| `running` → `succeeded` | Executor returns `status: "succeeded"` | `onAgentRunCompleted()` |
| `running` → `failed` | Executor returns `status: "failed"` or timeout | `onAgentRunFailed()` |

#### Gate States

```
  pending ──┬── approve ──→ approved (terminal)
            ├── reject ───→ rejected (terminal)
            └── revise ───→ revision_requested (terminal, triggers new run cycle)
```

#### Node States

```
  unknown ──→ online ──→ degraded ──→ offline
                 ▲           │           │
                 └───────────┘           │
                 └───────────────────────┘
                   (heartbeat received)
```

### 5.3 Audit Trail

Every significant action is recorded in the `audit_log` table:

| Action | Actor | Resource |
|--------|-------|----------|
| `gate_approved` | Reviewer name | Gate ID |
| `gate_rejected` | Reviewer name | Gate ID |
| `gate_revision_requested` | Reviewer name | Gate ID |
| `run_rescheduled` | `"reconciler"` | Agent Run ID |
| `node_offline_detected` | `"health_monitor"` | Node name |
| `pipeline_started` | `"system"` | Pipeline Run ID |
| `pipeline_stopped` | `"user"` | Pipeline Run ID |

---

## 6. Declarative Resource Model

All configuration is declarative YAML — the "Custom Resource Definitions" of the platform.

### 6.1 Agent Definitions

**File location**: `agents/{agent-name}.agent.yaml`

```yaml
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: developer
  displayName: Developer
  phase: 3
  role: Developer
spec:
  executor: pi-coding-agent          # pi-ai (docs) or pi-coding-agent (code)
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
    maxTokens: 64000
    thinking: true
  systemPrompt:
    file: prompts/developer.system.md
  tools:
    - file-read
    - file-write
    - bash
  inputs:
    - type: requirements
      from: analyst
      required: true
    - type: architecture-plan
      from: architect
      required: true
  outputs:
    - type: code-output
      schema: code-output
  nodeAffinity:
    required:
      - capability: llm-access
      - capability: docker
    preferred:
      - capability: high-memory
  resources:
    estimatedTokens: 50000
    estimatedDuration: 120s
    maxRetries: 2
  sandbox:
    image: agentforge-base:latest
    memory: 1g
    timeout: 300s
  steps:
    - name: generate-code
      type: llm
      prompt: "Generate code matching the architecture plan..."
    - name: lint
      type: script
      command: "npm run lint"
    - name: validate
      type: validate
      schema: code-output
```

### 6.2 Pipeline Definitions

**File location**: `pipelines/{pipeline-name}.pipeline.yaml`

```yaml
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: simple-sdlc
  displayName: Simple SDLC Pipeline
  description: Three-phase SDLC (requirements → architecture → implementation)
spec:
  input:
    - name: brief
      type: text
      required: true
    - name: constraints
      type: text
  repository:
    mode: auto-init
  phases:
    - name: Requirements
      phase: 1
      agents: [analyst]
      gate: true
    - name: Architecture
      phase: 2
      agents: [architect]
      gate: true
    - name: Implementation
      phase: 3
      agents: [developer]
      gate: true
  gateDefaults:
    timeout: 24h
  retryPolicy:
    maxRetries: 2
    backoff: exponential
```

### 6.3 Node Definitions

**File location**: `nodes/{node-name}.node.yaml`

```yaml
apiVersion: agentforge/v1
kind: NodeDefinition
metadata:
  name: local
  displayName: Local Node
  type: local                           # local | ssh | docker | remote
spec:
  connection:
    type: local                         # local | ssh | http | docker
    # SSH example:
    # type: ssh
    # host: gpu-server.internal
    # user: sdlc
    # Docker example:
    # type: docker
    # image: my-executor-image:latest
    # Remote example:
    # type: http
    # url: http://executor-node:8080
  capabilities:
    - llm-access
    - local-fs
    - docker
    - git
  resources:
    maxConcurrentRuns: 3
    maxTokensPerMinute: 100000          # optional rate limit
  env:
    CUSTOM_VAR: value                   # injected into agent env
  healthCheck:
    interval: 30s
    timeout: 5s
```

### 6.4 Definition Storage and Persistence

Definitions are persisted to the database in the `resource_definitions` table — the platform's equivalent of etcd. YAML files on disk are the authoring format; the database is the runtime source of truth.

**Implementation**: `SqliteDefinitionStore` (`src/adapters/store/sqlite-definition-store.ts`) — full CRUD with versioning, history tracking, and backward-compatible `asLegacyStore()` adapter for existing code.

```sql
-- Resource definitions (agents, pipelines, nodes)
CREATE TABLE resource_definitions (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,           -- 'AgentDefinition' | 'PipelineDefinition' | 'NodeDefinition'
  name        TEXT NOT NULL,           -- unique per kind
  version     INTEGER NOT NULL DEFAULT 1,
  spec_yaml   TEXT NOT NULL,           -- full YAML content
  metadata    TEXT,                    -- JSON: parsed metadata for fast queries
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(kind, name)
);

-- Revision history (every past version preserved)
CREATE TABLE resource_definition_history (
  id              TEXT PRIMARY KEY,
  definition_id   TEXT NOT NULL,
  version         INTEGER NOT NULL,
  spec_yaml       TEXT NOT NULL,
  changed_by      TEXT NOT NULL,       -- "cli", "dashboard", "api"
  change_type     TEXT NOT NULL,       -- "created" | "updated" | "rolled_back" | "deleted"
  created_at      TEXT NOT NULL
);
```

### 6.5 Definition Lifecycle

```
  YAML file on disk (authoring format)
       │
       ▼
  agentforge apply -f agents/        ← CLI command
       │
       ▼
  parseDefinitionFile()               ← Zod schema validation
       │
       ▼
  SqliteDefinitionStore.upsert()      ← DB persistence (auto-increment version)
       │
       ├── resource_definitions       ← Current version (source of truth)
       ├── resource_definition_history ← Previous version archived
       └── audit_log                  ← Mutation logged
       │
       ▼
  Available for scheduling            ← Scheduler, Controller read from DB
```

**Seeding**: On first startup, if `resource_definitions` table is empty, the platform seeds from YAML files in `agents/`, `pipelines/`, `nodes/` directories. After that, the database is authoritative.

### 6.6 kubectl-Aligned CLI Commands

The CLI mirrors kubectl patterns for resource management:

```bash
# Apply — declarative resource creation/update (the primary workflow)
agentforge apply -f agents/developer.agent.yaml     # Apply single file
agentforge apply -f agents/                       # Apply all files in directory
agentforge apply -f pipeline.yaml -f nodes/       # Apply multiple sources

# Get — list resources
agentforge get agents                             # List all agent definitions
agentforge get pipelines                          # List all pipeline definitions
agentforge get nodes                              # List all node definitions
agentforge get agents -o json                     # JSON output (pipeable)
agentforge get agents -o yaml                     # YAML output
agentforge get agents -o wide                     # Extra columns (inputs, outputs, etc.)

# Describe — detailed view of a single resource
agentforge describe agent developer                  # Full YAML + version + timestamps
agentforge describe pipeline simple-sdlc          # Pipeline with phase breakdown
agentforge describe node local                    # Node with capabilities + health status

# Create — imperative creation (errors if exists)
agentforge create -f agent.yaml                   # Create only (fails if name taken)

# Edit — open in $EDITOR, save on close
agentforge edit agent developer                      # Opens YAML in $EDITOR
                                                  # Saves to DB on close, version++

# Delete — remove resource
agentforge delete agent developer                    # Remove (fails if used by running pipeline)
agentforge delete node gpu-server                 # Remove (fails if node has active runs)

# Diff — show what would change
agentforge diff -f agents/developer.agent.yaml       # Colored diff: file vs current DB version

# History — revision tracking
agentforge history agent developer                   # List all versions with timestamps

# Rollback — restore previous version
agentforge rollback agent developer --to-version 2   # Restores version 2 as new version N+1
```

### 6.7 Output Formats

All `get` and `describe` commands support the `-o` flag:

| Format | Flag | Description | Use Case |
|--------|------|-------------|----------|
| Table | (default) | Colored columns, human-readable | Interactive use |
| JSON | `-o json` | Valid JSON, no color codes | Scripting, piping to `jq` |
| YAML | `-o yaml` | Valid YAML document(s) | Re-import with `apply -f` |
| Wide | `-o wide` | Extra columns (capabilities, inputs, etc.) | Detailed listing |

**Examples:**

```bash
# Pipe to jq for filtering
agentforge get agents -o json | jq '.[] | select(.spec.executor == "pi-coding-agent")'

# Export all definitions for backup
agentforge get agents -o yaml > backup/agents.yaml
agentforge get pipelines -o yaml > backup/pipelines.yaml

# Diff before applying
agentforge diff -f agents/
```

### 6.8 Definition Versioning

Every mutation (create, update, rollback) increments the version number. The full history is preserved in `resource_definition_history`.

```
Version 1: Created via 'apply -f developer.agent.yaml'
Version 2: Updated via 'edit agent developer' (changed model to opus)
Version 3: Updated via 'apply -f developer.agent.yaml' (changed maxTokens)
Version 4: Rolled back to version 1 via 'rollback agent developer --to-version 1'
```

**Pipeline runs record which definition version was used**, enabling "what ran when" auditing.

### 6.9 kubectl Alignment Summary

| kubectl Command | Platform Equivalent | Status |
|----------------|-------------------|--------|
| `kubectl apply -f` | `agentforge apply -f` | Exists (upgrade to DB-backed) |
| `kubectl get pods` | `agentforge get agents\|pipelines\|nodes` | Extend with -o flags |
| `kubectl describe pod X` | `agentforge describe agent\|pipeline\|node X` | Extend to all resource types |
| `kubectl create -f` | `agentforge create -f` | New |
| `kubectl edit deployment X` | `agentforge edit agent\|pipeline\|node X` | New |
| `kubectl delete pod X` | `agentforge delete agent\|pipeline\|node X` | New |
| `kubectl diff -f` | `agentforge diff -f` | New |
| `kubectl rollout history` | `agentforge history agent X` | New |
| `kubectl rollout undo` | `agentforge rollback agent X --to-version N` | New |
| `-o json, -o yaml, -o wide` | Same flags | New |

---

## 7. Communication Protocols

### 7.1 In-Process Communication

**Used by**: `LocalAgentExecutor`, `InProcessControlPlaneApi`

```
PipelineController ──→ IAgentExecutor.execute(job, onStatus) ──→ LocalAgentExecutor
                                                                      │
                                                                      │ (direct function call)
                                                                      ▼
                                                               AgentJobResult returned
```

- Zero serialization overhead
- `onStatus` callback is a direct function reference
- `InProcessControlPlaneApi` uses in-memory Map queues for run dispatch

### 7.2 HTTP Control Plane API

**Used by**: Remote `NodeWorker` instances, `HttpControlPlaneClient`

```
Remote Node                                  Control Plane HTTP Server
    │                                                │
    │── POST /api/v1/nodes/register ───────────────▶│ (upsert node, mark online)
    │◀─ 200 { status: "registered" } ──────────────│
    │                                                │
    │── POST /api/v1/nodes/local/heartbeat ────────▶│ (update last_heartbeat)
    │◀─ 200 { status: "ok" } ─────────────────────│
    │                                                │
    │── GET /api/v1/nodes/local/pending-runs ──────▶│ (drain queue)
    │◀─ 200 { runs: [NodeRunRequest] } ───────────│
    │                                                │
    │── POST /api/v1/runs/abc/result ──────────────▶│ (trigger onAgentRunCompleted)
    │◀─ 200 { status: "accepted" } ───────────────│
```

**NodeWorker loop** (unchanged regardless of transport):
```typescript
async start() { this.api.registerNode(this.runtime.nodeDefinition); }
async pollOnce() { const runs = this.api.getPendingRuns(name); /* execute each */ }
async reportHeartbeat() { this.api.reportHeartbeat(name, activeRuns); }
```

The `api` field is `IControlPlaneApi` — swap `InProcessControlPlaneApi` for `HttpControlPlaneClient` and the NodeWorker works remotely.

### 7.3 Node Watch API (SSE)

**Used by**: Remote `NodeWorker` instances for push-based work dispatch

Instead of short-polling `/pending-runs` every N seconds (wasteful when idle), nodes maintain a persistent SSE connection to the control plane. This mirrors Kubernetes' `watch` API where kubelets receive Pod assignments via a long-lived connection.

```
Remote Node                                  Control Plane Watch Endpoint
    │                                                │
    │── GET /api/v1/nodes/:name/watch ─────────────▶│
    │◀─ Content-Type: text/event-stream ───────────│
    │                                                │
    │   (connection held open, node blocks waiting)   │
    │                                                │
    │◀─ data: {"type":"run_assigned","run":{...}} ──│  (new work pushed instantly)
    │◀─ data: {"type":"run_cancelled","runId":"x"} ─│  (cancel pushed)
    │◀─ data: {"type":"heartbeat_ack"} ─────────────│  (keepalive every 30s)
    │                                                │
    │   (node processes run, posts result via HTTP)   │
    │── POST /api/v1/runs/:id/result ──────────────▶│
```

**Dual-mode support**: `IControlPlaneApi` supports both modes:
- `getPendingRuns()` — poll-based (backward compatible, simpler for local dev)
- `watchRuns()` — SSE-based (production, lower latency, lower DB load)

**Fallback**: If SSE connection drops, node falls back to polling until reconnected.

### 7.4 Dashboard SSE

**Used by**: Dashboard for real-time UI updates

```
Dashboard (React)                           Control Plane SSE Endpoint
    │                                                │
    │── GET /api/v1/events ────────────────────────▶│
    │◀─ Content-Type: text/event-stream ───────────│
    │                                                │
    │◀─ data: {"type":"run_updated","runId":"x"} ──│  (event bus subscriber)
    │◀─ data: {"type":"gate_opened","gateId":"y"} ─│
    │                                                │
    │   (TanStack Query cache invalidation)          │
```

**React hook** (`useSSE`):
- Creates `EventSource` connection to `/api/v1/events`
- On `run_updated` → invalidate runs query
- On `pipeline_updated` → invalidate pipelines query
- On `gate_opened`/`gate_decided` → invalidate gates query
- On `node_*` → invalidate nodes query
- Native reconnection (EventSource auto-reconnects)

### 7.5 Docker Container Protocol

**Used by**: `DockerAgentExecutor`

The user's Docker image must implement this contract:

**Environment variables (set by platform):**

| Variable | Description | Example |
|----------|-------------|---------|
| `AGENT_ID` | Agent name | `developer` |
| `RUN_ID` | Unique run identifier | `run-abc-123` |
| `MODEL_PROVIDER` | LLM provider | `anthropic` |
| `MODEL_NAME` | Model identifier | `claude-sonnet-4-20250514` |
| `API_KEY` | LLM API key | `sk-ant-...` |
| `MAX_TOKENS` | Token limit | `64000` |

**Volume mounts:**

| Host Path | Container Path | Access |
|-----------|---------------|--------|
| `job.workdir` | `/workspace` | Read-write |
| `job.outputDir` | `/output` | Read-write |

**Stdout protocol** (JSON lines):
```jsonl
{"type":"started","runId":"run-abc","timestamp":1234567890}
{"type":"progress","message":"Generating API code...","timestamp":1234567891}
{"type":"step_started","step":"lint","timestamp":1234567900}
{"type":"step_completed","step":"lint","timestamp":1234567910}
{"type":"completed","runId":"run-abc","timestamp":1234567920}
```

**Output contract:**
- Write artifacts to `/output/` directory
- Write result manifest to `/output/_result.json`:

```json
{
  "artifacts": [
    { "type": "api-code", "path": "api-code.json", "content": "..." }
  ],
  "savedFiles": ["src/routes/users.ts", "src/routes/auth.ts"],
  "tokenUsage": { "inputTokens": 8420, "outputTokens": 12150 },
  "costUsd": 0.207,
  "conversationLog": [
    { "role": "user", "content": "...", "timestamp": 1234567890 },
    { "role": "assistant", "content": "...", "timestamp": 1234567900 }
  ]
}
```

**Exit codes**: `0` = succeeded, non-zero = failed.

---

## 8. Reference Pipeline — simple-sdlc

The `simple-sdlc` template (bundled in `agentforge-core`) wires three agents into a minimal, end-to-end flow. It exists to demonstrate framework mechanics — define your own roster for real work.

### 8.1 Agent Roster

| Agent | Phase | Role | Executor | Produces |
|-------|-------|------|----------|----------|
| `analyst` | 1 | Requirements Analyst | pi-ai | Requirements (epics, stories, acceptance criteria) |
| `architect` | 2 | Architect | pi-ai | Architecture plan (components, tech stack, ADRs) |
| `developer` | 3 | Developer | pi-coding-agent | Generated code + lint/test results |

### 8.2 Pipeline Flow

```
Brief ──→ Phase 1 (analyst) ──→ [Gate] ──→ Phase 2 (architect) ──→ [Gate] ──→ Phase 3 (developer) ──→ Done
```

**Artifact chaining**: Each phase receives all prior phase output directories as input. Platform templates (`api-builder`, `code-review`, `data-pipeline`, `content-generation`, `seo-review`) add parallel phases and cross-cutting security agents using the same mechanics.

### 8.3 Artifact Lifecycle

```
Agent execution
    │
    ▼
AgentRunResult.artifacts[]        ← In-memory artifact data
    │
    ▼
IArtifactStore.save(artifact)     ← Write to disk
    │
    ├── {type}.json               ← Machine-readable (JSON)
    ├── {type}.md                 ← Human-readable (Markdown)
    └── _metadata.json            ← Index file
    │
    ▼
State store (outputArtifactIds)   ← File paths stored as references
    │
    ▼
Dashboard API                     ← GET /api/v1/runs/:id/artifacts
```

**Storage path**: `{outputDir}/phase-{N}/{artifactType}.json`

**Artifact types** (10 categories): `code`, `test`, `spec`, `config`, `documentation`, `diagram`, `report`, `prompt`, `other`

### 8.4 Cost Tracking

**File**: `src/nodes/cost-calculator.ts`

**Formula**: `(inputTokens × input_price + outputTokens × output_price) / 1,000,000`

**Price table** (per 1M tokens):

| Model | Input | Output |
|-------|-------|--------|
| claude-sonnet-4-20250514 | $3.00 | $15.00 |
| claude-opus-4-20250514 | $15.00 | $75.00 |
| claude-haiku-4-5-20251001 | $0.80 | $4.00 |

**Stored on**: `agent_runs.cost_usd` column
**Aggregated by**: Dashboard summary API (total across all runs)
**Recorded in**: OpenTelemetry metrics (`sdlc.run.cost`)

---

## 9. Failure Recovery

### 9.1 Executor Timeout Detection

**Mechanism**: Reconciliation loop checks `agent_runs.last_status_at`

```
Executor sends StatusUpdate → Control plane writes last_status_at
                                        │
                                        ▼
                              Reconciler checks every 15s:
                              "Is last_status_at > 60s old?"
                                    │            │
                                   YES           NO
                                    │            └── OK, continue
                                    ▼
                              Mark run as failed
                              Error: "executor timeout (no status for 65s)"
                                    │
                                    ▼
                              If retries < maxRetries:
                                Create new pending agent run
                                Schedule on different node
```

### 9.2 Node Failure and Failover

```
Node stops sending heartbeats
         │
         ▼
Health monitor detects (>120s since last heartbeat)
         │
         ▼
Node status → "offline"
         │
         ├── Stop scheduling new work to this node
         ├── Find all running agent runs on this node
         ├── Mark them as failed (error: "node offline")
         ├── Emit "node_offline" event
         └── Write audit log entry
         │
         ▼
Reconciler picks up failed runs
         │
         ▼
Reschedule to healthy nodes (if retries available)
```

**Recovery**: When the node resumes heartbeats, it transitions back to `online` and becomes eligible for scheduling again.

### 9.3 Pipeline Crash Recovery

**Current state**: If the control plane process crashes, active pipelines are stuck in `running` state.

**Recovery strategy** (P17 / Reconciler):
1. On restart, reconciler scans for pipelines in `running` state
2. For each, check if any agent runs are actually active
3. If all runs completed but phase didn't advance → advance phase
4. If runs are stuck (no executor responding) → mark failed, reschedule
5. Resume normal operation

### 9.4 Gate Revision Flow

When a human reviewer requests changes:

```
Gate status → "revision_requested"
         │
         ▼
PipelineController.reviseGate()
         │
         ├── Create new agent runs for current phase
         │   (with revisionNotes field populated)
         ├── Pipeline status → "running"
         └── Pipeline executor picks up new pending runs
                  │
                  ▼
         Agent receives revision notes as additional prompt context
                  │
                  ▼
         Agent re-generates artifacts incorporating feedback
                  │
                  ▼
         On completion → new gate created (pending)
```

### 9.5 Optimistic Concurrency Control

Prevents race conditions when multiple users/processes mutate the same resource simultaneously (e.g., two reviewers approve the same gate at the same instant).

**Mechanism**: Every mutable resource carries a `version` (integer) that increments on each write. Mutation requests must include the expected version — if it doesn't match the current version, the write is rejected.

```typescript
// Gate example: approve with version check
approveGate(gateId: string, expectedVersion: number, reviewer: string): Gate {
  const gate = this.store.getGate(gateId);
  if (gate.version !== expectedVersion) {
    throw new ConflictError(`Gate ${gateId} was modified (expected v${expectedVersion}, actual v${gate.version})`);
  }
  // proceed with transition...
}
```

**Applied to:**

| Resource | Conflict Scenario | Protection |
|----------|------------------|------------|
| **Gates** | Two reviewers approve simultaneously | `version` check on decide |
| **Resource Definitions** | Two users edit same agent YAML | `version` check on update |
| **Pipeline Runs** | Concurrent stop + retry | `version` check on status transition |
| **Nodes** | Concurrent health update + manual update | `version` check on upsert |

**HTTP API**: Clients send `If-Match: <version>` header. Server returns `409 Conflict` if version mismatch.

**Dashboard**: On conflict, shows "This resource was modified by another user. Reload and try again."

---

## 10. Clean Architecture

### 10.1 Layer Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  CLI / Dashboard / SDK                    │  Entry points
│            (Commander, HTTP server, API)                  │
└────────────────────────┬────────────────────────────────┘
                         │ depends on
┌────────────────────────▼────────────────────────────────┐
│                 Application Layer                        │  Orchestration
│      PipelineController, GateController, Scheduler       │
│      AgentRunner, StepPipelineExecutor                   │
└────────────────────────┬────────────────────────────────┘
                         │ depends on
┌────────────────────────▼────────────────────────────────┐
│                  Domain Layer (ZERO deps)                 │  Ports & Models
│                                                          │
│  Ports:  IStateStore, IAgentExecutor, IExecutionBackend  │
│          IEventBus, ISandboxProvider, INodeRuntime        │
│          IArtifactStore, IPromptLoader, ILogger           │
│                                                          │
│  Models: PipelineRun, AgentRunRecord, Gate, NodeRecord   │
│          ArtifactData, AgentEvent, StatusUpdate           │
│          ConversationEntry                                │
└────────────────────────┬────────────────────────────────┘
                         │ implements
┌────────────────────────▼────────────────────────────────┐
│                  Adapters Layer                           │  Implementations
│                                                          │
│  SqliteStateStore, FsArtifactStore, FilePromptLoader     │
│  PiAiBackend, PiCodingAgentBackend                       │
│  LocalAgentExecutor, DockerAgentExecutor, RemoteExecutor  │
│  InMemoryEventBus, LocalSandbox, DockerSandbox           │
│  InProcessControlPlaneApi, HttpControlPlaneClient        │
└────────────────────────┬────────────────────────────────┘
                         │ wired at
┌────────────────────────▼────────────────────────────────┐
│               Composition Root (DI Container)            │
│                    src/di/container.ts                    │
└─────────────────────────────────────────────────────────┘
```

### 10.2 Domain Layer (Ports & Models)

**Location**: `src/domain/`

**Rule**: ZERO external dependencies. No imports from `node_modules`, no I/O, no side effects.

**Ports** (interfaces that adapters implement):

| Port | File | Purpose |
|------|------|---------|
| `IStateStore` | `ports/state-store.port.ts` | Pipeline/run/gate/node persistence |
| `IAgentExecutor` | `ports/agent-executor.port.ts` | Agent job execution (control↔execution boundary) |
| `IExecutionBackend` | `ports/execution-backend.port.ts` | LLM-level abstraction (inside executor) |
| `IEventBus` | `ports/event-bus.port.ts` | Pub/sub for real-time notifications |
| `ISandboxProvider` | `ports/sandbox.port.ts` | Isolated execution environments |
| `INodeRuntime` | `ports/node-runtime.port.ts` | Remote node execution |
| `IControlPlaneApi` | `ports/control-plane-api.port.ts` | Node↔control plane communication |
| `IArtifactStore` | `ports/artifact-store.port.ts` | Artifact persistence |
| `IPromptLoader` | `ports/prompt-loader.port.ts` | System prompt loading |
| `ILogger` | `ports/logger.port.ts` | Structured logging |
| `IAgentScheduler` | `ports/scheduler.port.ts` | Node selection for agent runs |

**Models** (pure data structures with type definitions):

| Model | File | Fields |
|-------|------|--------|
| `PipelineRun` | `models/pipeline-run.model.ts` | id, projectName, status, currentPhase, inputs, ... |
| `AgentRunRecord` | `models/agent-run.model.ts` | id, agentName, phase, nodeName, status, tokenUsage, costUsd, ... |
| `Gate` | `models/gate.model.ts` | id, phaseCompleted, phaseNext, status, reviewer, ... |
| `NodeRecord` | `models/node.model.ts` | name, type, capabilities, status, lastHeartbeat, ... |
| `ArtifactData` | `models/artifact.model.ts` | type, path, content, metadata |
| `AgentEvent` | `models/events.model.ts` | Discriminated union: thinking, tool_use, tool_result, error, ... |

### 10.3 Application Layer

**Location**: `src/control-plane/`, `src/agents/`, `src/engine/`

Depends on domain ports. Contains business logic for orchestration, agent running, and step execution.

- `PipelineController` uses `IStateStore` + `IAgentScheduler`
- `GateController` uses `IStateStore`
- `AgentRunner` uses `IExecutionBackend` + `IArtifactStore` + `IPromptLoader`
- `StepPipelineExecutor` uses `IExecutionBackend` + `ISandboxProvider`

### 10.4 Adapters Layer

**Location**: `src/adapters/`, `src/state/`, `src/nodes/`

Implements domain ports with concrete technologies:

| Adapter | Implements | Technology |
|---------|-----------|------------|
| `SqliteStateStore` | `IStateStore` | better-sqlite3 |
| `FsArtifactStore` | `IArtifactStore` | Node.js fs |
| `FilePromptLoader` | `IPromptLoader` | Node.js fs |
| `PiAiExecutionBackend` | `IExecutionBackend` | @mariozechner/pi-ai |
| `PiCodingAgentExecutionBackend` | `IExecutionBackend` | @mariozechner/pi-coding-agent |
| `LocalAgentExecutor` | `IAgentExecutor` | In-process |
| `DockerAgentExecutor` | `IAgentExecutor` | dockerode |
| `RemoteAgentExecutor` | `IAgentExecutor` | HTTP/fetch |
| `InMemoryEventBus` | `IEventBus` | Node.js EventEmitter |
| `LocalSandbox` | `ISandboxProvider` | Child process |
| `DockerSandbox` | `ISandboxProvider` | dockerode |
| `InProcessControlPlaneApi` | `IControlPlaneApi` | In-memory Maps |
| `HttpControlPlaneClient` | `IControlPlaneApi` | HTTP/fetch |
| `PinoLogger` | `ILogger` | pino |

### 10.5 Composition Root (DI)

**File**: `src/di/container.ts`

All wiring happens here. No adapter knows about another adapter.

```typescript
type ExecutorType = "pi-ai" | "pi-coding-agent";
type ExecutorMode = "local" | "docker" | "remote";

function createContainerForAgent(
  executor: ExecutorType,
  config: AppConfig,
  options?: { onProgress?, onEvent?, workdir? },
): Container

function createAgentExecutor(
  mode: ExecutorMode,
  config: AppConfig,
  options?: { image?: string; remoteUrl?: string },
): IAgentExecutor
```

### 10.6 Dependency Rules

```
✅ Domain imports nothing external
✅ Application imports only from Domain
✅ Adapters import from Domain (to implement ports)
✅ Composition Root imports everything (to wire)
✅ CLI/Dashboard imports Application + Composition Root

❌ Domain NEVER imports from Adapters
❌ Application NEVER imports from Adapters
❌ Adapters NEVER import from each other
```

---

## 11. Deployment Architecture

### 11.1 Single-Machine (Development)

```
Developer Laptop
┌─────────────────────────────────────────┐
│  agentforge run --project X             │
│  agentforge dashboard --port 3001       │
│                                         │
│  Everything in one process:             │
│  CLI + Control Plane + LocalExecutor    │
│  + SQLite + Dashboard                   │
└─────────────────────────────────────────┘
```

**Commands:**
```bash
npx tsx packages/core/src/cli/index.ts dashboard              # Start dashboard
npx tsx packages/core/src/cli/index.ts run --project myapp    # Run pipeline
npx tsx packages/core/src/cli/index.ts gate approve <id>      # Approve gate
```

### 11.2 Docker Compose (Team)

**File**: `docker-compose.yml`

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Host                               │
│                                                                  │
│  ┌──────────────────────────────────────────────┐               │
│  │  dashboard (always-on)                        │               │
│  │  Port: 3001                                   │               │
│  │  Control Plane + Dashboard UI + API           │               │
│  │  Volume: ./examples → /app/examples           │               │
│  └──────────────────────────────────────────────┘               │
│                                                                  │
│  ┌──────────────────────────────────────────────┐               │
│  │  runner (one-shot, docker-compose run)        │               │
│  │  Executes pipeline, exits when done/paused    │               │
│  │  Env: PROJECT, PIPELINE, BRIEF_FILE           │               │
│  └──────────────────────────────────────────────┘               │
│                                                                  │
│  ┌──────────────────────────────────────────────┐               │
│  │  gate (one-shot, docker-compose run)          │               │
│  │  Approves/rejects/revises gates               │               │
│  │  Env: GATE_ID, GATE_ACTION                    │               │
│  └──────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### 11.3 Distributed (Production)

```
┌──── Cloud / Datacenter ─────────────────────────────────────────────┐
│                                                                      │
│  ┌─── Control Plane (always-on) ──────────────────────────────┐     │
│  │  HTTP API Server (:3001)                                    │     │
│  │  Dashboard UI                                               │     │
│  │  Pipeline Controller + Gate Controller + Scheduler          │     │
│  │  Reconciler + Node Health Monitor                           │     │
│  │  PostgreSQL (state store)                                   │     │
│  │  Event Bus → SSE                                            │     │
│  └─────────────────────────┬──────────────────────────────────┘     │
│                             │ HTTP API                               │
│            ┌────────────────┼────────────────┐                      │
│            │                │                │                      │
│  ┌─────────▼──────┐  ┌─────▼──────────┐  ┌──▼───────────────┐     │
│  │  Local Node     │  │  GPU Node      │  │  Docker Node     │     │
│  │  (developer     │  │  (remote       │  │  (container      │     │
│  │   laptop)       │  │   server)      │  │   per job)       │     │
│  │                 │  │                │  │                  │     │
│  │  NodeWorker     │  │  NodeWorker    │  │  NodeWorker      │     │
│  │  + LocalRuntime │  │  + LocalRuntime│  │  + DockerRuntime │     │
│  │                 │  │                │  │                  │     │
│  │  Capabilities:  │  │  Capabilities: │  │  Capabilities:   │     │
│  │  llm-access     │  │  llm-access   │  │  llm-access      │     │
│  │  docker         │  │  gpu          │  │  docker           │     │
│  │  local-fs       │  │  high-memory  │  │  isolated         │     │
│  └─────────────────┘  └──────────────┘  └──────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

**Node registration flow:**
1. Node starts → `POST /api/v1/nodes/register` with `NodeDefinitionYaml`
2. Control plane stores node in state store, marks online
3. Node starts heartbeat loop → `POST /api/v1/nodes/:name/heartbeat` every 15s
4. Node starts poll loop → `GET /api/v1/nodes/:name/pending-runs`
5. When work arrives → execute agent → `POST /api/v1/runs/:id/result`

### 11.4 Configuration System

**Precedence** (lowest → highest):
1. **Defaults** (hardcoded in `src/di/config.ts`)
2. **Config file** (`agentforge.config.json` in project root)
3. **Environment variables**
4. **CLI flags**

**Environment variables:**

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | LLM authentication | (required) |
| `AGENTFORGE_LLM_PROVIDER` | LLM provider | `anthropic` |
| `AGENTFORGE_DEFAULT_MODEL` | Default model | `claude-sonnet-4-20250514` |
| `AGENTFORGE_MAX_TOKENS` | Token limit per request | `64000` |
| `AGENTFORGE_OUTPUT_DIR` | Output directory | `./output` |
| `AGENTFORGE_PROMPTS_DIR` | Agent prompts directory | `src/agents/prompts` |
| `AGENTFORGE_LOG_LEVEL` | Log verbosity | `info` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector | `http://localhost:4318` |
| `PORT` | Dashboard HTTP port | `3001` |

---

## 12. Extending the Platform

### 12.1 Writing a Custom Executor

To add a new execution mode (e.g., Kubernetes, AWS Lambda, Firecracker):

**Step 1**: Implement `IAgentExecutor`

```typescript
// src/adapters/execution/my-executor.ts
import type { IAgentExecutor, AgentJob, AgentJobResult, StatusUpdate }
  from "../../domain/ports/agent-executor.port.js";

export class MyCustomExecutor implements IAgentExecutor {
  constructor(/* your config */) {}

  async execute(
    job: AgentJob,
    onStatus?: (update: StatusUpdate) => void,
  ): Promise<AgentJobResult> {
    // 1. Emit started
    onStatus?.({ type: "started", runId: job.runId, timestamp: Date.now() });

    // 2. Launch your execution environment
    //    - Pass job.agentDefinition, job.inputs, job.model
    //    - Set up workspace at job.workdir, output at job.outputDir

    // 3. Stream status updates during execution
    onStatus?.({ type: "progress", runId: job.runId, message: "Running...", timestamp: Date.now() });

    // 4. Collect results
    return {
      status: "succeeded",
      artifacts: [/* collected artifacts */],
      savedFiles: [/* created files */],
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      costUsd: 0,
      durationMs: elapsed,
      conversationLog: [],
    };
  }

  cancel(runId: string): void {
    // Optional: stop running execution
  }
}
```

**Step 2**: Register in DI container

```typescript
// src/di/container.ts
case "my-custom":
  return new MyCustomExecutor(config);
```

**Step 3**: Add CLI flag value

```typescript
// src/cli/commands/run.ts
.option("--executor <mode>", "Executor mode", "local")
// "local" | "docker" | "remote" | "my-custom"
```

**Step 4**: Add node definition

```yaml
# nodes/my-custom.node.yaml
apiVersion: agentforge/v1
kind: NodeDefinition
metadata:
  name: my-custom-node
  type: my-custom
spec:
  connection:
    type: my-custom
    # your connection config
  capabilities:
    - llm-access
  resources:
    maxConcurrentRuns: 10
```

### 12.2 Docker Executor Image Contract

To build a custom Docker image for the `DockerAgentExecutor`:

**Dockerfile example:**

```dockerfile
FROM node:20-alpine
WORKDIR /app

# Install your agent runtime
COPY package.json .
RUN npm ci
COPY src/ ./src/

# Entrypoint reads env vars, executes agent, writes results
ENTRYPOINT ["node", "src/executor-entrypoint.js"]
```

**Entrypoint requirements:**

```javascript
// src/executor-entrypoint.js

// 1. Read configuration from environment
const agentId = process.env.AGENT_ID;
const runId = process.env.RUN_ID;
const modelProvider = process.env.MODEL_PROVIDER;
const modelName = process.env.MODEL_NAME;
const apiKey = process.env.API_KEY;
const maxTokens = parseInt(process.env.MAX_TOKENS);

// 2. Read inputs from /workspace/inputs/
const inputs = readInputsFromDir("/workspace/inputs");

// 3. Stream status to stdout as JSON lines
console.log(JSON.stringify({ type: "started", runId, timestamp: Date.now() }));

// 4. Execute your agent logic
const result = await executeAgent({ agentId, inputs, modelProvider, modelName, apiKey, maxTokens });

// 5. Write artifacts to /output/
writeArtifacts("/output", result.artifacts);

// 6. Write result manifest
writeFileSync("/output/_result.json", JSON.stringify({
  artifacts: result.artifacts,
  savedFiles: result.savedFiles,
  tokenUsage: result.tokenUsage,
  costUsd: result.costUsd,
  conversationLog: result.conversationLog,
}));

// 7. Stream completion status
console.log(JSON.stringify({ type: "completed", runId, timestamp: Date.now() }));

// 8. Exit with code 0 for success, non-zero for failure
process.exit(0);
```

### 12.3 Adding an LLM Provider

Platform wraps core backends with `ProviderAwareBackend` middleware that validates API keys and handles provider-specific concerns based on `model.provider`:

| `model.provider` | Env Var Required | Notes |
|-----------------|------------------|-------|
| `openai` | `OPENAI_API_KEY` | GPT-4o, o1, o1-mini |
| `google` | `GOOGLE_API_KEY` | Gemini 2.5 Pro/Flash |
| `ollama` | None (`OLLAMA_BASE_URL` optional) | Local models, free. Mapped to OpenAI-compatible API. |

The executor type (`pi-ai` / `pi-coding-agent`) and model provider are orthogonal:

```yaml
spec:
  executor: pi-ai              # backend type (LLM-only vs LLM+tools)
  model:
    provider: openai           # LLM provider (what changes)
    name: gpt-4o
    maxTokens: 16384
```

`createPlatformBackendForExecutor()` in `platform/src/di/platform-container.ts` wraps core backends with `ProviderAwareBackend`, which validates API keys at runtime.

**Adding a new provider** — add config to `PROVIDER_CONFIGS` in `provider-aware-backend.ts`:

```typescript
myProvider: {
  envVar: "MY_PROVIDER_API_KEY",
  envVarLabel: "MY_PROVIDER_API_KEY",
}
```

Then add pricing to `platformEstimateCostUsd()`.

See [Multi-Provider Execution](multi-provider.md) for full configuration details.

### 12.4 Adding a Data Source

Implement the data source port for new input types:

```typescript
interface IDataSource {
  load(query: DataSourceQuery): Promise<string>;
}

// Examples: GitHubDataSource, ConfluenceDataSource, URLDataSource
```

### 12.5 Extension Points Summary

| Extension Point | Port Interface | What to Implement | Registration |
|----------------|---------------|-------------------|-------------|
| Agent Executor | `IAgentExecutor` | `execute()`, optional `cancel()` | DI container |
| LLM Provider | `IExecutionBackend` | `runAgent()` | DI container |
| State Store | `IStateStore` | Full CRUD for all entities | DI container |
| Artifact Store | `IArtifactStore` | `save()`, `load()`, `list()` | DI container |
| Sandbox | `ISandboxProvider` | `create()` → `ISandbox` | DI container |
| Event Bus | `IEventBus` | `emit()`, `subscribe()` | DI container |
| Data Source | `IDataSource` | `load()` | DI container |
| Node Runtime | `INodeRuntime` | `execute()`, `ping()` | Node registry |

---

## 13. Observability

**Stack**: OpenTelemetry + Traceloop

**Traces**: Each pipeline run = root span. Agent runs = child spans. Step executions = nested spans.

**Metrics** (via `src/observability/metrics.ts`):
- `sdlc.run.cost` — Cost per agent run (provider, model, agent dimensions)
- `sdlc.run.duration` — Duration per agent run
- `sdlc.run.tokens` — Token usage per agent run
- `sdlc.node.heartbeat.count` — Heartbeat events per node
- `sdlc.pipeline.phase.duration` — Time per pipeline phase

**Logs**: Pino structured JSON logs. Configurable level via `AGENTFORGE_LOG_LEVEL`.

**Dashboard**: Real-time visualization of pipeline progress, agent status, node health, and cost breakdown.

---

## 14. Security Model

**Current (MVP):**
- API keys for LLM providers stored as environment variables
- Node authentication via `X-Node-Token` header
- Docker sandbox isolation for untrusted code execution
- No inter-agent network access (sandbox network: none)
- Audit log for all gate decisions and state changes

**Future (P19/P20):**
- Namespace-level secret management
- RBAC per namespace (admin/operator/viewer)
- External service proxy with audit trail
- Resource quotas per namespace/team

### 14.1 Agent Identity and Access Control

Inspired by Kubernetes ServiceAccounts, each agent run carries an **identity token** that controls what it can access during execution.

```typescript
// Added to AgentJob
interface AgentJobIdentity {
  readonly agentId: string;
  readonly pipelineRunId: string;
  readonly phase: number;
  readonly allowedInputTypes: readonly string[];  // artifact types this agent can read
  readonly allowedOutputTypes: readonly string[];  // artifact types this agent can produce
  readonly secretRefs?: readonly string[];         // named secrets this agent can access
}
```

**Access control rules:**

| Rule | Description | Example |
|------|-------------|---------|
| **Input filtering** | Agent only receives artifacts matching `allowedInputTypes` | A `developer` agent sees `requirements` + `architecture-plan`, not unrelated phase artifacts |
| **Output validation** | Agent can only produce artifacts matching `allowedOutputTypes` | A `qa` agent can produce `test-suite`, not `api-code` |
| **Secret scoping** | Agent only receives secrets listed in `secretRefs` | A `devops` agent gets `DEPLOY_KEY`; a `developer` gets `DB_URL` |
| **Phase isolation** | Agent cannot access artifacts from phases it hasn't been granted | Phase 4 agents can't see Phase 5 test results |

**Why this matters:**
- Prevents accidental data leakage (e.g., credentials in brief reaching all agents)
- Enables principle of least privilege per agent
- Audit trail shows exactly what each agent accessed
- Required for multi-tenant deployments (P20) where teams share a control plane

---

## 15. Glossary

| Term | Definition |
|------|-----------|
| **Agent** | An AI-powered worker that produces specific artifacts (e.g., a `developer` agent produces code) |
| **Agent Run** | A single execution of an agent on a node (equivalent to a K8s Pod) |
| **Artifact** | A versioned output from an agent run (code, docs, configs, tests) |
| **Control Plane** | The orchestration layer: scheduling, state management, gates, reconciliation |
| **Execution Plane** | The layer that runs agents: LLM calls, step pipelines, sandboxes |
| **Executor** | An `IAgentExecutor` implementation that runs agent jobs (Local, Docker, Remote) |
| **Gate** | A human approval checkpoint between pipeline phases |
| **Node** | An execution environment where agents run (local machine, remote server, Docker host) |
| **NodeWorker** | The kubelet equivalent — runs on each node, registers, polls for work, reports status |
| **Phase** | A stage in the pipeline (1=Requirements, 2=Architecture, etc.) |
| **Pipeline** | A sequence of phases that transform a brief into a complete software project |
| **Pipeline Run** | A runtime instance of a pipeline for a specific project |
| **Reconciliation** | Continuous comparison of desired state vs actual state with corrective action |
| **Sandbox** | An isolated execution environment (Docker container) for running untrusted code |
| **SSE** | Server-Sent Events — unidirectional server→client streaming for real-time dashboard updates |
| **Status Update** | A structured event from executor to control plane reporting execution progress |
| **Step Pipeline** | A sequence of deterministic + LLM steps defined in agent YAML |
| **Watch API** | SSE-based push channel from control plane to nodes (replaces polling) — like K8s watch |
| **Agent Identity** | Access control token attached to AgentJob defining what artifacts/secrets the agent can access |
| **Optimistic Concurrency** | Version-based conflict detection — mutations fail if resource was modified since last read |

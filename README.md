# AgentForge

**Kubernetes for AI agent workflows.** Declarative agent orchestration for engineering teams.

Define agents and pipelines in YAML. AgentForge handles execution, artifact chaining, approval gates, observability, and state management — the way Kubernetes handles container workloads.

Ships with a reference set of SDLC agents so you can see an end-to-end pipeline working out of the box. The framework is general-purpose — define your own agents and pipelines for any domain (content generation, data pipelines, code review, ops runbooks, etc.).

---

## How It Works

1. **Define agents** — each agent has a system prompt, input/output types, and optional step pipeline
2. **Wire a pipeline** — sequence agents into phases with approval gates between them
3. **Run it** — AgentForge orchestrates execution, chains artifacts, and pauses at gates for human review

```yaml
# .agentforge/pipelines/my-pipeline.pipeline.yaml
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: my-pipeline
  displayName: My Custom Pipeline
spec:
  input:
    - name: brief
      type: raw-brief
      required: true
  phases:
    - name: analysis
      phase: 1
      agents: [my-analyst]
      gate: { required: true }
    - name: implementation
      phase: 2
      parallel: true
      agents: [my-coder, my-tester]
      gate: { required: true }
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx agentforge-core run --project my-app --pipeline my-pipeline --input "brief=Build a todo app"
```

---

## Quick Start (5 minutes)

```bash
# 1. Install
npm install agentforge-core

# 2. Set your Anthropic API key (get one at https://console.anthropic.com/settings/keys)
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Scaffold .agentforge/ with reference agents and a starter pipeline
npx agentforge-core init

# 4. Run a single agent against a brief
npx agentforge-core exec <agent-name> --input "Build a freelance invoicing SaaS"

# 5. Run the full reference pipeline (approval gates between phases)
npx agentforge-core run --project my-app --input "brief=Build a freelance invoicing SaaS"

# 6. Start the web dashboard to watch it live
npx agentforge-core dashboard
# Open http://localhost:3001
```

If `ANTHROPIC_API_KEY` is missing or `.agentforge/` is empty, the CLI prints a friendly pointer telling you what to do next.

---

## Defining Agents

Agents are defined in YAML at `.agentforge/agents/<name>.agent.yaml`:

```yaml
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: my-analyst
  displayName: My Analyst
  description: Analyzes requirements and produces a specification
  phase: "1"
  role: analyst

spec:
  # Executor type: pi-ai (LLM only) or pi-coding-agent (LLM + file tools)
  executor: pi-ai

  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
    maxTokens: 16384
    thinking: medium

  # System prompt — the agent's personality and instructions
  systemPrompt:
    file: prompts/my-analyst.system.md

  # Tools available to the agent (pi-coding-agent executor only)
  tools: []  # or: [read, write, edit, bash, grep, find]

  # What this agent consumes
  inputs:
    - type: raw-brief
      required: true
    - type: existing-docs
      required: false

  # What this agent produces (validated against Zod schemas)
  outputs:
    - type: specification
      schema: schemas/specification.schema.ts

  # Optional: multi-step execution pipeline
  steps:
    - name: validate-input
      type: validate
      schema: raw-brief
      description: Ensure brief is structurally valid

    - name: analyze
      type: llm
      description: Run the LLM to produce the specification

    - name: post-process
      type: script
      run: |
        cd {{run.workdir}}
        echo "Post-processing complete"
      continueOnError: true

  # Node scheduling preferences
  nodeAffinity:
    preferred:
      - capability: llm-access

  resources:
    estimatedTokens: 15000
    maxRetries: 2
    timeout: 120s
    # Wall-clock LLM-call timeout for this agent (seconds).
    # Overrides AGENTFORGE_LLM_TIMEOUT_SECONDS. Set to 0 to disable.
    timeoutSeconds: 1200
```

### Step Types

Agents can define a multi-step execution pipeline:

| Step Type | What it does |
|-----------|-------------|
| `llm` | Invokes the LLM with the agent's system prompt and inputs |
| `script` | Runs a shell command (linting, testing, post-processing) |
| `validate` | Validates an artifact against a Zod schema |
| `transform` | Transforms data between steps |

Steps run in order. Use `continueOnError: true` for non-critical steps. Template variables (`{{run.workdir}}`, `{{pipeline.id}}`) are resolved at runtime.

### Executor Types

| Executor | Use case |
|----------|----------|
| `pi-ai` | Pure LLM — no file system access, no tools. For analysis, planning, document generation. |
| `pi-coding-agent` | LLM + tools (read, write, edit, bash, grep, find). For code generation, testing, DevOps. |

Both executor types work with any LLM provider. Set `model.provider` to `anthropic` (default), `openai`, `google`, or `ollama`. Multi-provider support requires `agentforge`. See [Multi-Provider Execution](docs/multi-provider.md).

---

## Defining Pipelines

Pipelines wire agents into phases at `.agentforge/pipelines/<name>.pipeline.yaml`:

```yaml
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: my-pipeline
  displayName: My Pipeline

spec:
  # Pipeline-level inputs (passed to first phase)
  input:
    - name: brief
      type: raw-brief
      required: true

  # Phases execute sequentially; agents within a parallel phase run concurrently
  phases:
    - name: requirements
      phase: 1
      agents: [analyst]
      gate:
        required: true           # Human must approve before next phase
        approvers:
          minCount: 1
          roles: [admin, reviewer]

    - name: implementation
      phase: 2
      parallel: true             # These agents run concurrently
      agents: [frontend-dev, backend-dev, db-engineer]
      gate:
        required: true
        waitForAll: true          # Gate opens only after ALL parallel agents finish

    - name: review
      phase: 3
      agents: [qa-agent]
      gate:
        required: false           # Auto-advance (no human approval needed)

  # Cross-cutting agents run after each phase (e.g., security audit)
  crossCuttingAgents:
    security:
      agent: security-auditor
      trigger: after-phase
      mode: incremental

  # Gate defaults
  gateDefaults:
    actions: [approve, reject, request-revision]
    timeout: 72h

  # Retry policy for failed agent runs
  retryPolicy:
    maxRetries: 2
    backoff: exponential
    initialDelay: 30s
```

### Pipeline Features

- **Sequential phases** — each phase waits for the previous to complete + gate approval
- **Parallel agents** — agents within a phase can run concurrently (`parallel: true`)
- **Approval gates** — human review between phases (approve / reject / request revision)
- **Cross-cutting agents** — run after every phase (security audits, compliance checks)
- **Artifact chaining** — outputs from phase N are automatically available as inputs to phase N+1
- **Retry policy** — automatic retry with exponential backoff on failures
- **Continue/resume** — resume paused pipelines with `agentforge run --continue <run-id>`

---

## Defining Nodes

Nodes define where agents execute at `.agentforge/nodes/<name>.node.yaml`:

```yaml
apiVersion: agentforge/v1
kind: NodeDefinition
metadata:
  name: local
  displayName: Local Node
  type: local          # local or ssh
spec:
  connection:
    type: local        # or: ssh (with host, user, keyFile)
  capabilities:
    - llm-access
    - local-fs
    - docker
    - git
  resources:
    maxConcurrentRuns: 3
```

Agents declare `nodeAffinity` to specify which capabilities they need. The scheduler matches agents to nodes based on capabilities and current load.

---

## Reference Pipeline

`agentforge-core init` scaffolds a reference SDLC pipeline covering the typical roles of a product-to-production flow:

| Phase | Role | Typical Outputs |
|-------|------|-----------------|
| 1 | Business Analyst | FRD, NFR, wireframes, timeline |
| 2 | Architect | architecture, ADRs, component diagrams |
| 3 | Tech Lead | sprint plan, risk register, dependency map |
| 4 | Frontend / Backend / Data (parallel) | UI components, API code, ERD, DDL, migrations |
| 5 | QA | test suites, coverage report |
| 6 | DevOps | CI/CD config, deployment runbook |
| cross | Security | threat model, vulnerability scan (runs after every phase) |

These are just YAML definitions in `.agentforge/agents/`. Rename, edit, delete, or replace them — they exist as a working starting point, not a required part of the framework.

---

## CLI Reference

```bash
agentforge exec <agent> [options]       # Run a single agent
agentforge run --project <name>         # Start a pipeline
agentforge run --continue <run-id>      # Resume a paused pipeline
agentforge dashboard                    # Start the web dashboard
agentforge list                         # List all agents
agentforge info <agent>                 # Agent details
agentforge get pipelines                # List pipeline runs
agentforge get pipeline <id>            # Inspect a run
agentforge gate approve <gate-id>       # Approve a gate
agentforge gate reject <gate-id>        # Reject a gate
agentforge gate revise <gate-id>        # Request revision
agentforge logs <run-id>                # View agent run logs
```

---

## Dashboard

The web dashboard provides real-time visibility into pipeline execution:

- Pipeline run list with status, progress, and cost tracking
- Phase-by-phase progress with agent status indicators
- Gate management (approve/reject/revise directly from UI)
- Artifact viewer with type-specific renderers
- Audit timeline of all actions
- PDF export of pipeline results

```bash
npx agentforge-core dashboard --port 3001
```

---

## Artifact Typing & Validation

Every agent declares typed inputs and outputs. Artifacts are validated against Zod schemas at pipeline boundaries — invalid output fails the agent run before it reaches the next phase.

### How It Works

```
Agent YAML                    Zod Schema                      Runtime
┌─────────────────┐    ┌──────────────────────┐    ┌─────────────────────┐
│ outputs:        │    │ export const FrdSchema│    │ Agent produces JSON  │
│   - type: frd   │───▶│   = z.object({       │───▶│ → safeParse(output) │
│     schema: frd │    │     projectName: ...  │    │ → pass ✓ or fail ✗  │
└─────────────────┘    │     epics: z.array()  │    └─────────────────────┘
                       │   })                  │
                       └──────────────────────┘
```

### Built-in Schemas (45 types)

AgentForge ships with 45 artifact schemas covering the full SDLC:

| Category | Schemas |
|----------|---------|
| **Requirements** | FRD, NFR, project-proposal, wireframes, design-tokens, effort-estimate, timeline |
| **Architecture** | architecture, component-diagram, ADRs, arch-options, security-design, tech-stack-rec |
| **Planning** | sprint-plan, dependency-map, risk-register, dod-checklist |
| **Code** | api-code, ui-components, openapi-spec, api-tests, api-docs, component-docs |
| **Data** | ERD, schema-DDL, migrations, data-contracts, indexing-strategy |
| **Testing** | test-suite, coverage-report, defect-log, release-readiness |
| **Security** | threat-model, vulnerability-scan, compliance-evidence, security-backlog |
| **DevOps** | cicd-config, deployment-runbook, deployment-topology, deployment-risk, iac-templates, monitoring-config |

### Custom Schemas

Define your own artifact types with Zod:

```typescript
// packages/core/src/schemas/my-report.schema.ts
import { z } from "zod/v4";

export const MyReportSchema = z.object({
  title: z.string(),
  summary: z.string().min(50),
  findings: z.array(z.object({
    severity: z.enum(["critical", "high", "medium", "low"]),
    description: z.string(),
    recommendation: z.string(),
  })).min(1),
  score: z.number().min(0).max(100),
});

export type MyReport = z.infer<typeof MyReportSchema>;
```

Reference in your agent YAML:

```yaml
spec:
  outputs:
    - type: my-report
      schema: schemas/my-report.schema.ts

  steps:
    - name: generate
      type: llm
      description: Produce the report

    - name: validate-output
      type: validate
      schema: my-report          # Validates against MyReportSchema
```

### Validation in Step Pipelines

The `validate` step type runs Zod schema validation inline:

```yaml
steps:
  # Validate inputs before LLM call (fail fast)
  - name: check-input
    type: validate
    schema: architecture         # Validates the input artifact
    input: architecture
    description: Ensure architecture doc is structurally valid

  - name: generate
    type: llm

  # Validate outputs after LLM call (catch hallucinated structure)
  - name: check-output
    type: validate
    schema: api-code             # Validates the generated output
```

If validation fails:
- `continueOnError: false` (default) — agent run fails immediately, pipeline stops
- `continueOnError: true` — logged as warning, execution continues

### Artifact Chaining Between Phases

Outputs from phase N automatically become available as inputs to phase N+1:

```yaml
# Phase 1 agent produces FRD
outputs:
  - type: frd
    schema: schemas/frd.schema.ts

# Phase 2 agent consumes FRD
inputs:
  - type: frd
    required: true
    from: analyst              # Explicit source agent (by name)
```

The pipeline engine resolves artifact dependencies, copies files to the next phase's working directory, and injects them into the agent's context.

### Composing Schemas

Build complex schemas from shared primitives:

```typescript
// schemas/common.schema.ts
export const UserStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  asA: z.string(),
  iWant: z.string(),
  soThat: z.string(),
  acceptanceCriteria: z.array(z.string()).min(1),
  priority: z.enum(["must-have", "should-have", "could-have", "wont-have"]),
});

// schemas/frd.schema.ts
import { UserStorySchema } from "./common.schema.js";

export const FrdSchema = z.object({
  projectName: z.string(),
  epics: z.array(z.object({
    title: z.string(),
    userStories: z.array(UserStorySchema).min(1),
  })).min(1),
  businessRules: z.array(z.string()),
});
```

---

## Extending AgentForge

### Custom System Prompts

Write system prompts in Markdown at `packages/core/src/agents/prompts/`:

```markdown
You are a requirements analyst. Given a project brief, produce a detailed
functional requirements document (FRD) in JSON format matching the schema.

Focus on: user stories, acceptance criteria, non-functional requirements.
```

### Platform Extensions

Install `agentforge` for production capabilities:

```bash
npm install agentforge-core agentforge
```

Adds: Multi-provider LLM backends (OpenAI, Gemini, Ollama), Docker/remote executors, PostgreSQL, OpenTelemetry, crash recovery, rate limiting, multi-node workers. See [agentforge README](packages/platform/README.md).

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes (core) | — | Anthropic API key |
| `OPENAI_API_KEY` | If using OpenAI | — | OpenAI API key (platform) |
| `GOOGLE_API_KEY` | If using Gemini | — | Google AI API key (platform) |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama server URL (platform) |
| `AGENTFORGE_DEFAULT_MODEL` | No | `claude-sonnet-4-20250514` | Model name |
| `AGENTFORGE_MAX_TOKENS` | No | `64000` | Max output tokens |
| `AGENTFORGE_LLM_TIMEOUT_SECONDS` | No | `600` | Per-agent LLM call wall-clock timeout (set `0` to disable) |
| `AGENTFORGE_OUTPUT_DIR` | No | `./output` | Artifact output directory |
| `AGENTFORGE_DIR` | No | `./.agentforge` | Path to definitions directory |
| `AGENTFORGE_LOG_LEVEL` | No | `info` | Log level |
| `AGENTFORGE_STATE_STORE` | No | `sqlite` | `sqlite` or `postgres` (platform only) |
| `AGENTFORGE_POSTGRES_URL` | If `AGENTFORGE_STATE_STORE=postgres` | — | `postgres://user:pass@host:port/db` (platform only) |

### Reliability

- **LLM timeouts.** Each agent's LLM call is bounded by `AGENTFORGE_LLM_TIMEOUT_SECONDS` (default 600s). Individual agents can override via `spec.resources.timeoutSeconds` in their YAML (e.g., coding agents get `1200` in the shipped definitions). On timeout, the pipeline fails with an actionable error. Set either knob to `0` to disable.
- **Automatic retry on `overloaded_error`.** Anthropic HTTP 529 (`overloaded_error`) is retried up to 3 times with exponential backoff (2s, 4s, 8s). Caller-side aborts and timeouts take precedence over retries.
- **Secret masking.** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `AGENTFORGE_POSTGRES_URL` are registered at startup and masked (`***`) in logs, error messages, and conversation transcripts.

---

## Docker

```bash
docker compose up -d              # Start dashboard
PROJECT=my-app BRIEF="Build a todo app" docker compose run --rm runner
```

---

## Project Structure

```
.agentforge/                  YAML definitions (agents, pipelines, nodes)
packages/
  core/                     Core framework (agentforge-core)
  platform/                 Enterprise extensions (agentforge)
```

## License

MIT

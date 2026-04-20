# agentforge-core

**Kubernetes for AI agent workflows.** The core orchestration framework.

Define agents and pipelines in YAML — AgentForge handles execution, artifact chaining, approval gates, and state management. Like Kubernetes for containers, AgentForge is the control plane for AI agent workloads.

Ships with a minimal `simple-sdlc` starter template (analyst → architect → developer) to get you up and running. The framework is general-purpose — define your own agents and pipelines for any domain.

## Quick Start

```bash
npm install agentforge-core
export ANTHROPIC_API_KEY=sk-ant-...

# Scaffold a starter .agentforge/ directory
npx agentforge-core init --template simple-sdlc

# Run a single agent
npx agentforge-core exec analyst --input "Build a freelance invoicing SaaS"

# Run the full pipeline
npx agentforge-core run --project my-app --input "brief=Build a freelance invoicing SaaS"

# Start the web dashboard
npx agentforge-core dashboard
# Open http://localhost:3001
```

## Defining Agents

Create `.agentforge/agents/my-agent.agent.yaml`:

```yaml
apiVersion: sdlc/v1
kind: AgentDefinition
metadata:
  name: my-agent
  displayName: My Agent
  description: Does something useful
  phase: "1"
  role: analyst

spec:
  executor: pi-ai              # pi-ai (LLM only) or pi-coding-agent (LLM + tools)

  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
    maxTokens: 16384

  systemPrompt:
    file: prompts/my-agent.system.md

  tools: []                     # pi-coding-agent: [read, write, edit, bash, grep, find]

  inputs:
    - type: raw-brief
      required: true

  outputs:
    - type: specification
      schema: schemas/specification.schema.ts

  # Optional: multi-step execution pipeline
  steps:
    - name: validate
      type: validate
      schema: raw-brief

    - name: analyze
      type: llm
      description: Produce the specification

    - name: post-process
      type: script
      run: |
        cd {{run.workdir}}
        echo "done"
      continueOnError: true

  resources:
    estimatedTokens: 15000
    maxRetries: 2
    timeout: 120s
    # Wall-clock LLM-call timeout for this agent (seconds). Overrides
    # AGENTFORGE_LLM_TIMEOUT_SECONDS. Set to 0 to disable.
    timeoutSeconds: 1200
```

### Step Types

| Type | What it does |
|------|-------------|
| `llm` | Invokes the LLM with system prompt and inputs |
| `script` | Runs a shell command (lint, test, post-process) |
| `validate` | Validates artifact against a Zod schema |
| `transform` | Transforms data between steps |

### Executor Types

| Executor | Use case |
|----------|----------|
| `pi-ai` | Pure LLM — no file tools. Analysis, planning, documents. |
| `pi-coding-agent` | LLM + tools (read/write/edit/bash). Code generation, testing, DevOps. |

> **Multi-provider**: Install `agentforge` to use OpenAI, Google Gemini, or Ollama as `model.provider` with any executor type. See [Multi-Provider Execution](../../docs/multi-provider.md).

## Defining Pipelines

Create `.agentforge/pipelines/my-pipeline.pipeline.yaml`:

```yaml
apiVersion: sdlc/v1
kind: PipelineDefinition
metadata:
  name: my-pipeline
  displayName: My Pipeline

spec:
  input:
    - name: brief
      type: raw-brief
      required: true

  phases:
    - name: analysis
      phase: 1
      agents: [analyst]
      gate:
        required: true
        approvers: { minCount: 1, roles: [admin] }

    - name: implementation
      phase: 2
      parallel: true              # Agents run concurrently
      agents: [coder, tester]
      gate:
        required: true
        waitForAll: true

    - name: review
      phase: 3
      agents: [reviewer]
      gate:
        required: false           # Auto-advance

  crossCuttingAgents:
    security:
      agent: security-auditor
      trigger: after-phase

  retryPolicy:
    maxRetries: 2
    backoff: exponential
```

### Pipeline Features

- **Sequential phases** with human approval gates
- **Parallel agents** within a phase (`parallel: true`)
- **Cross-cutting agents** run after every phase (security, compliance)
- **Artifact chaining** — outputs from phase N flow to phase N+1
- **Resume** paused pipelines: `agentforge-core run --continue <run-id>`
- **Retry** with exponential backoff on failures

## Defining Nodes

Create `.agentforge/nodes/my-node.node.yaml`:

```yaml
apiVersion: sdlc/v1
kind: NodeDefinition
metadata:
  name: local
  type: local
spec:
  connection:
    type: local             # or: ssh (with host, user, keyFile)
  capabilities:
    - llm-access
    - docker
    - git
  resources:
    maxConcurrentRuns: 3
```

Agents declare `nodeAffinity` to request capabilities. The scheduler matches agents to nodes.

## Artifact Typing & Validation

Every agent declares typed inputs/outputs validated against Zod schemas. Invalid output fails the agent run before reaching the next phase.

```yaml
spec:
  outputs:
    - type: my-report
      schema: schemas/my-report.schema.ts    # Zod schema

  steps:
    - name: generate
      type: llm

    - name: validate
      type: validate
      schema: my-report                      # Validates LLM output
```

**Custom schemas** — define any artifact type:

```typescript
// schemas/my-report.schema.ts
import { z } from "zod/v4";

export const MyReportSchema = z.object({
  title: z.string(),
  findings: z.array(z.object({
    severity: z.enum(["critical", "high", "medium", "low"]),
    description: z.string(),
    recommendation: z.string(),
  })).min(1),
  score: z.number().min(0).max(100),
});
```

Ships with **45 built-in schemas** covering requirements, architecture, code, data, testing, security, and DevOps artifacts. Artifacts chain automatically between phases — outputs from phase N flow as inputs to phase N+1.

## Starter Template: simple-sdlc

| Agent | Phase | Role | Outputs |
|-------|-------|------|---------|
| **analyst** | 1 | Business Analyst | requirements |
| **architect** | 2 | Architect | architecture plan |
| **developer** | 3 | Developer | code output |

Scaffold it with `npx agentforge-core init --template simple-sdlc`. These are YAML definitions — modify them, extend them, or build your own from scratch.

## CLI Reference

```bash
agentforge-core exec <agent> [options]       # Run a single agent
agentforge-core run --project <name>         # Start a pipeline
agentforge-core run --continue <run-id>      # Resume a paused pipeline
agentforge-core dashboard                    # Web dashboard
agentforge-core list                         # List agents
agentforge-core info <agent>                 # Agent details
agentforge-core get pipelines                # List runs
agentforge-core gate approve <gate-id>       # Approve a gate
agentforge-core logs <run-id>                # View logs
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key. Missing key prints a friendly multi-line error with a link to `https://console.anthropic.com/settings/keys`. |
| `AGENTFORGE_DEFAULT_MODEL` | No | `claude-sonnet-4-20250514` | Model name |
| `AGENTFORGE_MAX_TOKENS` | No | `64000` | Max output tokens |
| `AGENTFORGE_LLM_TIMEOUT_SECONDS` | No | `600` | Wall-clock timeout per agent LLM call. Set `0` to disable. |
| `AGENTFORGE_OUTPUT_DIR` | No | `./output` | Artifact output directory |
| `AGENTFORGE_DIR` | No | `./.agentforge` | Path to definitions directory |
| `AGENTFORGE_LOG_LEVEL` | No | `info` | Log level |

Config file: `agentforge.config.json` in project root.

### Reliability

- **LLM timeouts** — every agent call is bounded by `AGENTFORGE_LLM_TIMEOUT_SECONDS` (default 600s). Per-agent override via `spec.resources.timeoutSeconds` in YAML. Timeouts abort in-flight HTTP and fail the run with an actionable error.
- **Retry on `overloaded_error`** — Anthropic HTTP 529 is retried 3× with exponential backoff (2s, 4s, 8s). Aborts take precedence.
- **Secret masking** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `AGENTFORGE_POSTGRES_URL` are registered at startup and replaced with `***` in logs, error messages, and conversation transcripts.

## Docker

```bash
docker compose up -d
PROJECT=my-app BRIEF="Build a todo app" docker compose run --rm runner
```

## Platform Extensions

For distributed execution, PostgreSQL, OTel, and multi-node workers:

```bash
npm install agentforge
```

See [agentforge](https://www.npmjs.com/package/agentforge).

## License

MIT

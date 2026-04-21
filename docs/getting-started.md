# Getting Started with AgentForge

> Part of the [AgentForge documentation](README.md).

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Prerequisites](#2-prerequisites)
3. [Installation](#3-installation)
4. [Running Your First Pipeline](#4-running-your-first-pipeline)
5. [Using the Dashboard](#5-using-the-dashboard)
6. [Working with Gates](#6-working-with-gates)
7. [Docker Deployment](#7-docker-deployment)
8. [Running Remote Executor Nodes](#8-running-remote-executor-nodes)
9. [Building a Custom Docker Executor Image](#9-building-a-custom-docker-executor-image)
10. [Custom Schemas and Pipeline Wiring](#10-custom-schemas-and-pipeline-wiring)
11. [Configuration Reference](#11-configuration-reference)
12. [CLI Reference](#12-cli-reference)

---

## 1. Quick Start

```bash
# Install from npm (pulls in agentforge-core transitively)
npm install agentforge

# Set your API key — grab one from https://console.anthropic.com/settings/keys
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# Scaffold your .agentforge/ directory (agents, pipelines, schemas)
npx agentforge init                            # blank template
npx agentforge init --template simple-sdlc     # analyst → architect → developer starter

# Start the dashboard
npx agentforge dashboard

# In another terminal: run a pipeline
npx agentforge run --project my-saas --input "brief=Build a SaaS invoicing platform"

# Open http://localhost:3001/dashboard to watch progress
```

> **Contributing / running from source?** Clone the repo, `npm ci`, then swap `npx agentforge` for `npx tsx packages/platform/src/platform-cli.ts` in any command below (or `npx agentforge` if you're on the core package).

---

## 2. Prerequisites

- **Node.js** 20 or later
- **npm** 9 or later
- **An LLM API key** (Anthropic by default)
- **Docker** (optional — for sandboxed execution and Docker executor mode)

---

## 3. Installation

### From npm (recommended)

```bash
npm install agentforge
```

`agentforge` depends on `agentforge-core`, so a single install gives you both. Defaults (SQLite, local executor, Anthropic) work with zero extra configuration.

If you want the framework primitives without the platform binary or the multi-provider / Postgres / Docker executor extras, install core directly:

```bash
npm install agentforge-core
```

### From source

```bash
git clone https://github.com/mandarnilange/agentforge && cd agentforge
npm ci
npm run build
```

Verify the installation:

```bash
npx agentforge --version         # prints 0.2.0
npx agentforge list              # lists scaffolded agents (after init)
npx agentforge templates list    # lists bundled pipeline templates
```

### Initialize the project

Scaffold the `.agentforge/` directory with agent, pipeline, and schema templates:

```bash
npx agentforge init                             # blank template
npx agentforge init --template simple-sdlc      # analyst → architect → developer
```

This creates:
- `.agentforge/agents/` — agent definition YAML files
- `.agentforge/pipelines/` — pipeline definition YAML files
- `.agentforge/schemas/` — declarative JSON Schema YAML files for artifact validation

---

## 4. Running Your First Pipeline

### From CLI

```bash
# Provide a project brief as inline text
npx agentforge run \
  --project my-app \
  --pipeline simple-sdlc \
  --input "brief=Build a task management app with user authentication"

# Or provide a brief file
npx agentforge run \
  --project my-app \
  --input "brief=@path/to/brief.md"
```

The pipeline will:
1. Start Phase 1 (the first configured agent — e.g. Business Analysis in the reference pipeline)
2. Pause at a gate for your approval
3. Continue through subsequent phases as you approve each gate

### From Dashboard

1. Start the dashboard: `npx agentforge dashboard`
2. Open http://localhost:3001/dashboard
3. Click "New Pipeline"
4. Fill in project name and brief
5. Click "Start"

### Running a Single Agent

```bash
npx agentforge exec <agent-name> \
  --input path/to/brief.md \
  --output ./output/<agent-name> \
  --verbose
```

---

## 5. Using the Dashboard

The dashboard provides real-time visibility into pipeline execution.

**URL**: http://localhost:3001/dashboard

**Pages:**

| Page | Path | Purpose |
|------|------|---------|
| Overview | `/` | Summary cards, pipeline table, cost totals |
| Pipeline Detail | `/pipelines/:id` | Phase stepper, agent runs, gates, artifacts |
| Gates | `/gates` | All pending gates awaiting approval |
| Nodes | `/nodes` | Execution node health and status |

**Real-time updates**: The dashboard uses Server-Sent Events (SSE) for instant updates when pipeline state changes — no manual refresh needed.

---

## 6. Working with Gates

Gates are human approval checkpoints between pipeline phases.

### Approve a gate (pipeline advances to next phase)

```bash
npx agentforge gate approve <gate-id> \
  --reviewer "Alice" \
  --comment "Looks good, approved"
```

### Reject a gate (pipeline fails)

```bash
npx agentforge gate reject <gate-id> \
  --reviewer "Bob" \
  --comment "Architecture needs rework"
```

### Request revision (agents re-run with feedback)

```bash
npx agentforge gate revise <gate-id> \
  --notes "Add rate limiting to the API design" \
  --reviewer "Alice"
```

### Via Dashboard

Click on a pending gate in the Gates page. Use the Approve/Reject/Revise buttons with optional comments.

### List pending gates

```bash
npx agentforge get gates --pipeline <pipeline-run-id>
```

---

## 7. Docker Deployment

### Using Docker Compose

```bash
# Start the dashboard (always-on)
docker-compose up -d dashboard

# Run a pipeline
PROJECT=my-app BRIEF="Build a todo app" docker-compose run --rm runner

# Approve a gate
GATE_ID=<id> GATE_ACTION=approve docker-compose run --rm gate
```

**Environment variables for `runner`:**
- `PROJECT` — Project name (required)
- `PIPELINE` — Pipeline definition name (default: `simple-sdlc`)
- `BRIEF` — Inline brief text
- `BRIEF_FILE` — Path to brief file (inside container)

### Building the Docker image

```bash
docker build -t agentforge .
```

---

## 8. Running Remote Executor Nodes

Remote nodes allow you to distribute agent execution across multiple machines.

### Start the control plane

```bash
# On your server/cloud machine
npx agentforge dashboard --host 0.0.0.0 --port 3001
```

### Start a remote node

```bash
# On a different machine (or same machine for testing)
npx agentforge node start \
  --control-plane-url http://control-plane-host:3001 \
  --token your-node-api-key \
  --name gpu-node \
  --capabilities llm-access,gpu,high-memory \
  --max-concurrent-runs 5
```

The node will:
1. Register itself with the control plane
2. Start sending heartbeats every 15 seconds
3. Poll for pending work
4. Execute agent jobs and report results back

### Using Docker executor mode

```bash
# Run pipeline with Docker executor (launches container per agent job)
npx agentforge run \
  --project my-app \
  --executor docker \
  --executor-image my-executor:latest
```

### Using remote executor mode

```bash
# Run pipeline delegating to a remote executor service
npx agentforge run \
  --project my-app \
  --executor remote \
  --executor-url http://gpu-node:8080
```

---

## 9. Building a Custom Docker Executor Image

Your Docker image must follow this contract to work with the `DockerAgentExecutor`.

### Environment variables (set by platform)

| Variable | Description |
|----------|-------------|
| `AGENT_ID` | Agent name (as declared in the agent YAML `metadata.name`) |
| `RUN_ID` | Unique run identifier |
| `MODEL_PROVIDER` | LLM provider (e.g., `anthropic`) |
| `MODEL_NAME` | Model name (e.g., `claude-sonnet-4-20250514`) |
| `API_KEY` | LLM API key |
| `MAX_TOKENS` | Token limit |

### Volume mounts

| Container Path | Purpose | Access |
|---------------|---------|--------|
| `/workspace` | Working directory + input artifacts in `/workspace/inputs/` | Read-write |
| `/output` | Write artifacts and result manifest here | Read-write |

### Stdout protocol

Stream status updates as JSON lines to stdout:

```jsonl
{"type":"started","runId":"run-123","timestamp":1234567890}
{"type":"progress","message":"Generating code...","timestamp":1234567891}
{"type":"step_started","step":"lint","timestamp":1234567900}
{"type":"step_completed","step":"lint","timestamp":1234567910}
{"type":"completed","runId":"run-123","timestamp":1234567920}
```

### Output files

Write a result manifest to `/output/_result.json`:

```json
{
  "artifacts": [
    { "type": "api-code", "path": "api-code.json", "content": "{...}" }
  ],
  "savedFiles": ["src/routes/users.ts"],
  "tokenUsage": { "inputTokens": 8420, "outputTokens": 12150 },
  "costUsd": 0.207,
  "conversationLog": []
}
```

### Exit codes

- `0` — Success
- Non-zero — Failure (stderr captured as error message)

### Example Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm ci
COPY src/ ./src/
ENTRYPOINT ["node", "src/executor-entrypoint.js"]
```

---

## 10. Custom Schemas and Pipeline Wiring

### Declarative artifact schemas

Define custom artifact types as JSON Schema YAML in `.agentforge/schemas/`. These are auto-discovered at runtime and take precedence over built-in Zod schemas.

```yaml
# .agentforge/schemas/api-code.schema.yaml
$schema: "http://json-schema.org/draft-07/schema#"
title: API Code
type: object
required: [routes, middleware]
properties:
  routes:
    type: array
    items:
      type: object
      required: [method, path, handler]
      properties:
        method: { type: string, enum: [GET, POST, PUT, DELETE, PATCH] }
        path: { type: string }
        handler: { type: string }
  middleware:
    type: array
    items: { type: string }
```

Built-in Zod schemas in `packages/core/src/schemas/` serve as fallbacks when no `.agentforge/schemas/` file exists for a given type.

### Pipeline wiring

Agent inputs no longer specify where their data comes from. Instead, the pipeline definition's `spec.wiring` section maps each consumer agent to its producer for each artifact type:

```yaml
# In your pipeline YAML
spec:
  wiring:
    architect:
      frd: analyst                      # Architect reads FRD produced by Analyst
      nfr: analyst
    frontend-dev:
      architecture: architect
      wireframes: analyst
      sprint-plan: tech-lead
    backend-dev:
      architecture: architect
      sprint-plan: tech-lead
```

This keeps agent definitions reusable across different pipelines with different data flows.

---

## 11. Configuration Reference

### Config file

Create `agentforge.config.json` in the project root:

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 64000
  },
  "outputDir": "./output",
  "logLevel": "info"
}
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | LLM API key (required for core). Missing key produces a friendly multi-line error with a link to create one. |
| `OPENAI_API_KEY` | — | OpenAI API key (platform, for `openai` executor) |
| `GOOGLE_API_KEY` | — | Google AI API key (platform, for `gemini` executor) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL (platform, for `ollama` executor) |
| `AGENTFORGE_LLM_PROVIDER` | `anthropic` | LLM provider |
| `AGENTFORGE_DEFAULT_MODEL` | `claude-sonnet-4-20250514` | Default model |
| `AGENTFORGE_MAX_TOKENS` | `64000` | Max tokens per request |
| `AGENTFORGE_LLM_TIMEOUT_SECONDS` | `600` | Wall-clock timeout per agent LLM call. Set `0` to disable. On timeout the pipeline fails with `Agent "X" timed out after Ns.` |
| `AGENTFORGE_OUTPUT_DIR` | `./output` | Output directory |
| `AGENTFORGE_DIR` | `./.agentforge` | Path to agent/pipeline/node definitions |
| `AGENTFORGE_LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |
| `AGENTFORGE_STATE_STORE` | `sqlite` | Platform only — `sqlite` or `postgres`. `postgres` requires `AGENTFORGE_POSTGRES_URL`; a `SELECT 1` preflight runs at startup. |
| `AGENTFORGE_POSTGRES_URL` | — | Platform only — `postgres://user:pass@host:port/db`. Required when `AGENTFORGE_STATE_STORE=postgres`. Registered as a secret (masked in logs). |
| `PORT` | `3001` | Dashboard server port |

### Reliability defaults

AgentForge ships with three reliability features enabled out of the box:

1. **LLM timeouts.** Every agent run is bounded by `AGENTFORGE_LLM_TIMEOUT_SECONDS` (default 600s). Individual agents can override the default by setting `spec.resources.timeoutSeconds` in their YAML — the shipped coding agents use longer limits (typically `1200`s) to allow for code generation and test runs, while cross-cutting security agents use `900`s. Timeouts abort in-flight HTTP requests and fail the run with an actionable error.
2. **Automatic retry on `overloaded_error` / HTTP 529.** Transient Anthropic overloads are retried up to 3 times with exponential backoff (2s, 4s, 8s). Caller aborts/timeouts take precedence.
3. **Secret masking.** API keys and Postgres URLs are registered at startup and replaced with `***` in logs, error messages, and conversation transcripts. Any secret you register via the `ISecretProvider` port is also masked.

### Precedence (lowest to highest)

1. Hardcoded defaults
2. Config file (`agentforge.config.json`)
3. Environment variables
4. CLI flags

---

## 12. CLI Reference

```
agentforge <command> [options]

Commands:
  init [--template <name>]      Scaffold .agentforge/ directory (blank, simple-sdlc)
  list                          List all available agents
  info <agent>                  Show agent details
  exec <agent>                  Execute a single agent
  run                           Run a pipeline
  gate approve|reject|revise    Manage gates
  dashboard                     Start HTTP dashboard
  apply -f <path>               Load YAML definitions
  get pipelines|gates|runs      Query state
  get nodes                     List execution nodes
  describe node <name>          Show node details
  logs <run-id>                 Show run logs
  node start                    Start a remote executor node

Global flags:
  --version                     Show version
  --help                        Show help

Run flags:
  --project <name>              Project name (required)
  --pipeline <name>             Pipeline definition (default: simple-sdlc)
  --input <key=value>           Input parameter (repeatable)
  --continue <runId>            Resume a paused pipeline
  --executor <mode>             Executor: local|docker|remote
  --executor-image <image>      Docker image (for docker executor)
  --executor-url <url>          Remote URL (for remote executor)

Dashboard flags:
  --host <host>                 Bind address (default: 127.0.0.1)
  --port <port>                 Port (default: 3001)

Node start flags:
  --control-plane-url <url>     Control plane HTTP URL
  --token <token>               API authentication token
  --name <name>                 Node name
  --capabilities <list>         Comma-separated capabilities
  --max-concurrent-runs <n>     Max parallel agent runs
```

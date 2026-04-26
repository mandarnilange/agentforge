# AgentForge

[![CI](https://github.com/mandarnilange/agentforge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mandarnilange/agentforge/actions/workflows/ci.yml)
[![npm @mandarnilange/agentforge-core](https://img.shields.io/npm/v/@mandarnilange/agentforge-core?label=%40mandarnilange%2Fagentforge-core&color=blue)](https://www.npmjs.com/package/@mandarnilange/agentforge-core)
[![npm @mandarnilange/agentforge](https://img.shields.io/npm/v/@mandarnilange/agentforge?label=%40mandarnilange%2Fagentforge&color=blue)](https://www.npmjs.com/package/@mandarnilange/agentforge)
[![License: MIT](https://img.shields.io/github/license/mandarnilange/agentforge?color=green)](LICENSE)
[![Node ≥20](https://img.shields.io/node/v/@mandarnilange/agentforge-core?color=brightgreen)](package.json)

**Kubernetes for AI agent workflows.** Declarative agent orchestration in YAML, with approval gates, artifact validation, and a real observability story.

AgentForge lets engineering teams define agents and pipelines the way Kubernetes lets them define pods and deployments — and then handles the execution, state, and scheduling underneath. Ships with a reference SDLC template so you can see an end-to-end pipeline running in minutes. The framework is domain-agnostic: point it at code review, content generation, ops runbooks, data pipelines — anything where multiple LLM calls need to be coordinated with humans in the loop.

> **Status:** v0.2.0 release candidate (`v0.2.0-rc.2`) — early-feedback build. API surface is stabilising but may still shift; `npm install @mandarnilange/agentforge` pulls the RC. Please [open an issue](https://github.com/mandarnilange/agentforge/issues) for anything that looks rough, or use [Discussions](https://github.com/mandarnilange/agentforge/discussions) for usage questions.

---

## Agent orchestration platform for every team

Any team running LLM-driven work — marketing, sales, HR, operations, legal, product, engineering — gets the same platform: cost control, observability, human-in-the-loop gates, typed artifacts, scheduling, recovery. You build the agents your domain needs; AgentForge handles the orchestration around them.

- **Marketing, sales, HR, ops, legal, finance** — run LLM workflows through the same dashboard the engineers use. Plain-English revision notes, no code, no engineering escalations. Domain expertise stays with the domain experts.
- **Product & engineering teams** — ship AI-assisted features without giving up code-review discipline. Your linter, tests, and security scanners gate the LLM; the dashboard gives a full audit trail for every decision.
- **Platform teams** — stand up AgentForge once; every team in the org inherits cost tracking, audit logs, sandboxing, and observability. Zero per-team glue code to maintain. Adding a new team is a `git push`.

One binary, one control plane, one audit trail. You focus on the systems; AgentForge handles the harness.

---

## Key Features

- **Declarative YAML for everything.** Agents, pipelines, nodes, and artifact schemas are data, not code. Version-control them, diff them, generate them, `apply` them to a persistent store.
- **Deterministic + LLM harness per agent.** Each agent is a named flow of `llm`, `script`, `validate`, and `transform` steps — wrapped in loops and conditionals. Wire in your linter, test runner, or security scanner and the LLM's output is checked by *your tools* on every run. The framework becomes the harness you customize; your tools stay in charge of correctness.
- **Multiple execution targets — nodes.** `local` (in-process), Docker containers (per-agent isolation), and remote workers over SSH / HTTP. Agents declare `nodeAffinity`; the scheduler matches them to nodes by capabilities + load. Run heterogeneous worker pools (GPU, high-memory, lightweight) from the same image.
- **Bring your own LLM provider.** Anthropic, OpenAI (GPT-4o, o1), Google Gemini, and Ollama (local). Mix providers *per agent* in the same pipeline — `model.provider` is agent-level, not global.
- **Bring your own coding agent.** The `IExecutionBackend` port is the plug-in point for any coding-agent runtime. Ships today with `@mariozechner/pi-coding-agent` (`read`, `write`, `edit`, `bash`, `grep`, `find`). Adapt Codex, OpenCode, Goose, Gemini CLI, Aider, or your internal tool by implementing one interface. Add per-agent custom tools — query your database, file a Jira ticket, call an internal API — through a tool-definition API that doesn't require a framework recompile. Open source and extensible by design.
- **Typed artifacts with schema validation.** 45 built-in Zod / JSON Schemas for SDLC outputs; define your own in a single file. Malformed LLM output fails the run before it poisons the next phase.
- **Humans in the loop, not just observers.** Between phases, a reviewer accepts, rejects, or redirects with a note in plain English — no YAML, no code. The LLM proposes; the human decides. Revision notes steer the next LLM call, so gates are a two-way conversation, not a rubber stamp. Every decision is signed, timestamped, and survives restarts.
- **Cost guardrails at every layer.** Each agent declares its own token + dollar ceiling; pipelines carry org-wide limits set by the platform team; the dashboard shows spend accumulating in real time. A runaway LLM call aborts cleanly before it bills you — not after.
- **Real-time dashboard in the binary.** React SPA + Server-Sent Events: pipeline timeline, live agent conversation, gate actions, artifact viewer, PDF export, cost tracking. No extra install.
- **Batteries-included templates.** `simple-sdlc` starter (3 agents) in core. Platform binary ships `api-builder`, `code-review`, `content-generation`, `data-pipeline`, `seo-review` — real, runnable pipelines, not demos.
- **Laptop-to-production continuum.** SQLite → PostgreSQL, local → Docker → remote workers, no-op OTel → full SDK with Jaeger/Grafana. Same YAML, same binary, env-var upgrades only. No migration.
- **Open source, MIT.** No paid tier, no cloud dependency, no telemetry. You own the stack.

---

## Quick Start (5 minutes)

```bash
# 1. Install
npm install @mandarnilange/agentforge

# 2. Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Scaffold the reference template into .agentforge/
npx @mandarnilange/agentforge init --template simple-sdlc

# 4. Run a single agent against a brief
npx @mandarnilange/agentforge exec analyst --input "Build a freelance invoicing SaaS"

# 5. Run the full pipeline (approval gates between phases)
npx @mandarnilange/agentforge run --project my-app --input "brief=Build a freelance invoicing SaaS"

# 6. Open the dashboard to watch it live
npx @mandarnilange/agentforge dashboard
# → http://localhost:3001
```

That's it. If `ANTHROPIC_API_KEY` is missing or `.agentforge/` is empty, the CLI prints a friendly pointer. Full walkthrough: [`docs/getting-started.md`](docs/getting-started.md).

---

## Architecture: control plane + execution plane

AgentForge borrows Kubernetes' separation of concerns. A **control plane** decides *what* runs, *where*, and *when*. An **execution plane** — one or more **nodes** — actually runs the agents.

```
                ┌─────────────────────────────────────────────┐
                │              CONTROL PLANE                  │
                │                                             │
                │   ┌──────────┐   ┌──────────┐   ┌────────┐  │
                │   │Dashboard │   │Scheduler │   │ Gates  │  │
                │   │ + HTTP   │   │          │   │        │  │
                │   └──────────┘   └──────────┘   └────────┘  │
                │   ┌────────────────┐   ┌──────────────────┐ │
                │   │ Definition     │   │  State store     │ │
                │   │ store (YAML /  │   │  SQLite / Postgres│ │
                │   │ DB-backed)     │   │                  │ │
                │   └────────────────┘   └──────────────────┘ │
                └──────────────────┬──────────────────────────┘
                                   │
                  dispatch jobs    │    report results
                                   ▼
                ┌─────────────────────────────────────────────┐
                │             EXECUTION PLANE                 │
                │                                             │
                │   ┌───────────┐  ┌───────────┐  ┌────────┐  │
                │   │  node:    │  │  node:    │  │ node:  │  │
                │   │  local    │  │  docker   │  │worker-1│  │
                │   │ (in-proc) │  │(container)│  │(ssh/ht)│  │
                │   └───────────┘  └───────────┘  └────────┘  │
                │                                             │
                │  Agents run here — file system, LLM calls,  │
                │  shell, tools all live on the node.         │
                └─────────────────────────────────────────────┘
```

- **Control plane** — pipeline controller, gate controller, scheduler, definition store, state store, event bus, dashboard server. On a laptop it's a single Node.js process; in production it's one or more control-plane containers backed by Postgres.
- **Execution plane — nodes.** A node is anywhere an agent can run: the local process, a Docker container, a remote worker reached over SSH or HTTP. Nodes advertise **capabilities** (`llm-access`, `docker`, `local-fs`, `high-memory`, `git`, …) and the scheduler matches each agent's `nodeAffinity` to the pool.
- **Same binary.** Both planes are in the `agentforge` binary. On a laptop, one process hosts both. In distributed deployments, you run control-plane and worker containers from the same image — just different CLI invocations.

Deep dive: [`docs/platform-architecture.md`](docs/platform-architecture.md) · [`docs/pipeline-execution-flows.md`](docs/pipeline-execution-flows.md).

---

## Core Concepts

| Concept | What it is | Defined in |
|---|---|---|
| **Agent** | A system prompt + typed I/O + optional step pipeline. Runs on a node. | `.agentforge/agents/*.agent.yaml` |
| **Pipeline** | A sequence of phases; each phase runs one or more agents and may end with an approval gate. | `.agentforge/pipelines/*.pipeline.yaml` |
| **Node** | An execution target — `local`, Docker, or remote SSH — with declared capabilities. | `.agentforge/nodes/*.node.yaml` |
| **Artifact** | A typed, validated JSON document passed between agents. | `.agentforge/schemas/*.schema.yaml` |
| **Gate** | A pause point between phases for human review (approve / reject / revise). | Inline in the pipeline |

### Nodes in more detail

Nodes are declarative like everything else:

```yaml
# .agentforge/nodes/local.node.yaml
apiVersion: agentforge/v1
kind: NodeDefinition
metadata:
  name: local
  type: local
spec:
  connection:
    type: local
  capabilities: [llm-access, local-fs, git]
  resources:
    maxConcurrentRuns: 3
```

```yaml
# .agentforge/nodes/worker-1.node.yaml   (platform binary)
apiVersion: agentforge/v1
kind: NodeDefinition
metadata:
  name: worker-1
  type: ssh
spec:
  connection:
    type: ssh
    host: worker1.internal
    user: ci
    keyFile: ~/.ssh/deploy-key
  capabilities: [llm-access, docker, high-memory]
  resources:
    maxConcurrentRuns: 10
```

Agents ask for capabilities they need:

```yaml
# .agentforge/agents/developer.agent.yaml (excerpt)
spec:
  nodeAffinity:
    required:
      - capability: llm-access
      - capability: docker            # agent writes files + runs shell — needs isolation
    preferred:
      - capability: high-memory       # prefer a beefy node if one's available
```

The scheduler picks the highest-scoring node whose capabilities satisfy the required set. Soft preferences break ties.

Deeper architectural tour: [`docs/architecture.md`](docs/architecture.md).

---

## Reference template — `simple-sdlc`

Three agents wired into a classic requirements → architecture → implementation flow. Use it to learn the mechanics; customise for your own domain.

```
Brief ──► analyst ─► [gate] ─► architect ─► [gate] ─► developer ─► done
```

```yaml
# .agentforge/pipelines/simple-sdlc.pipeline.yaml
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: simple-sdlc
spec:
  input:
    - name: brief
      type: raw-brief
      required: true
  phases:
    - name: requirements
      phase: 1
      agents: [analyst]
      gate: { required: true }
    - name: architecture
      phase: 2
      agents: [architect]
      gate: { required: true }
    - name: implementation
      phase: 3
      agents: [developer]
```

```yaml
# .agentforge/agents/analyst.agent.yaml (excerpt)
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  role: Requirements Analyst
spec:
  executor: pi-ai
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
  systemPrompt:
    file: prompts/analyst.system.md
  inputs:
    - type: raw-brief
      required: true
  outputs:
    - type: requirements
      schema: schemas/requirements.schema.yaml
```

More templates — `api-builder`, `code-review`, `content-generation`, `data-pipeline`, `seo-review` — ship with the platform binary. Catalog: [`docs/templates.md`](docs/templates.md).

---

## Agents are mini-pipelines — the harness model

An agent isn't forced to be "one LLM call". Each agent can declare a **flow** of named steps — LLM calls, shell scripts, schema validation, transforms — and wrap them in conditionals and loops. The LLM produces code or content; your own tools validate it, your linter fixes it, your test runner verifies it, your security scanner flags it. Agents become a harness around the LLM, not a thin wrapper over it.

### Step types

| Type | What it does |
|---|---|
| `llm` | Invokes the agent's model with the system prompt + inputs. The normal LLM call. |
| `script` | Runs a shell command on the node. Has access to template variables (`{{run.workdir}}`, `{{pipeline.id}}`, `{{steps.<name>.output}}`, `{{steps.<name>.exitCode}}`). |
| `validate` | Runs a Zod / JSON Schema check against a named artifact or the last LLM output. Fails the run by default; set `continueOnError: true` to log and continue. |
| `transform` | Pure data reshape between steps (no side effects). |

Plus two control-flow constructs usable anywhere in a flow:

- **`loop`** — retry a block until a predicate step outputs a success sentinel, with a `maxIterations` ceiling.
- **`condition`** — skip a step when a referenced step's output doesn't match.

### Real example — the bundled `developer` agent

This is from `packages/core/src/templates/simple-sdlc/agents/developer.agent.yaml`. It shows the *generate → lint → test → fix-until-passing* pattern that `script` + `loop` unlock together:

```yaml
spec:
  executor: pi-coding-agent
  tools: [read, write, edit, bash, grep, find]

  definitions:
    generate-code:
      type: llm
      instructions: |
        Generate the full implementation based on the requirements and architecture plan.

    lint-and-format:
      type: script
      run: |
        cd {{run.workdir}}
        # Auto-detect + run the project's linter/formatter
        if   [ -f package.json  ]; then npx eslint src/ --fix; npx prettier --write "src/**/*.{ts,js}"
        elif [ -f pyproject.toml ]; then python -m black .; python -m ruff check --fix .
        elif [ -f go.mod        ]; then gofmt -w .
        fi
      continueOnError: true

    run-tests:
      type: script
      run: |
        cd {{run.workdir}}
        if   [ -f package.json  ]; then npm test
        elif [ -f pyproject.toml ]; then python -m pytest -v
        elif [ -f go.mod        ]; then go test ./...
        fi
      captureOutput: true
      continueOnError: true

    test-gate:
      type: script
      run: |
        if [ "{{steps.run-tests.exitCode}}" = "0" ]; then echo "PASS"; else echo "false"; fi

    fix-code:
      type: llm
      instructions: |
        Fix attempt {{loop.iteration}} of {{loop.maxIterations}}.
        Failing tests:
        {{steps.run-tests.output}}
        Fix the source code — don't modify tests unless they have a genuine bug.

    validate-output:
      type: validate
      schema: code-output

    git-commit:
      type: script
      run: |
        cd {{run.workdir}}
        git add -A && git commit -m "feat(developer): pipeline {{pipeline.id}}"
      continueOnError: true

  flow:
    - step: generate-code
    - step: lint-and-format
    - loop:
        until: "{{steps.test-gate.output}}"     # exits when test-gate emits "PASS"
        maxIterations: 3
        do:
          - step: run-tests
          - step: test-gate
          - step: fix-code
            condition: "{{steps.test-gate.output}}"   # skip fix if tests passed
    - step: validate-output
    - step: git-commit
```

### Why this matters

- **Your existing tools stay in charge of correctness.** The LLM proposes; `eslint`, `pytest`, `go vet`, `trivy`, `semgrep`, whatever you already trust, decide whether it's acceptable. Bad LLM output doesn't leak into the next phase.
- **Customize without forking.** Want a different linter, a stricter security scan, a different commit convention? It's YAML — edit the `run:` block. No framework recompile.
- **Domain-agnostic.** The same mechanics build a content agent (generate → SEO audit → Grammarly → publish), a data agent (generate SQL → explain-plan → dry-run → apply), an ops agent (generate runbook → shellcheck → render to PDF). Scripts are the universal glue.
- **Observable.** Every step — LLM and script — lands in the state store with output, exit code, duration, and a span in your OTel trace. The dashboard timeline shows the whole harness, not just the LLM turn.

Deeper dive on step pipelines, template variables, and loop semantics: [`docs/architecture.md`](docs/architecture.md) and [`docs/pipeline-execution-flows.md`](docs/pipeline-execution-flows.md).

---

## `@mandarnilange/agentforge` vs `@mandarnilange/agentforge-core`

Two npm packages ship from this repo. Pick based on your target environment.

| | **`@mandarnilange/agentforge-core`** | **`@mandarnilange/agentforge`** (platform) |
|---|---|---|
| **Install** | `npm install @mandarnilange/agentforge-core` | `npm install @mandarnilange/agentforge` (pulls in core) |
| **Binary** | `agentforge-core` | `agentforge` |
| **Intended for** | Local dev, evaluation, library embed | Production, teams, multi-host |
| **LLM providers** | Anthropic | Anthropic + OpenAI + Gemini + Ollama |
| **Executors** | Local (in-process) | Local + **Docker container** + **Remote HTTP** |
| **Node types** | `local` | `local` + `ssh` + remote workers |
| **State store** | SQLite (file) | SQLite **or** PostgreSQL |
| **Persistent definitions** | YAML on disk, loaded per run | YAML on disk **or** `apply` to DB (versioned, hot-reload) |
| **Observability** | OTel API (no-op without SDK) | Full OTel SDK + Jaeger / Grafana export |
| **Crash recovery** | — | Pipeline rehydration + reconciliation loop |
| **Rate limiting** | — | Token / cost / concurrency per pipeline |
| **Multi-host deploy** | — | Control-plane + worker Docker Compose files |
| **Docker image** | `ghcr.io/mandarnilange/agentforge-core` (~289 MB) | `ghcr.io/mandarnilange/agentforge-platform` (~336 MB) |

**Rule of thumb:** start with `@mandarnilange/agentforge-core` if you want the smallest surface for experimentation or you're embedding AgentForge inside your own CLI. Otherwise install `@mandarnilange/agentforge` — defaults are identical for local dev (SQLite, local executor, Anthropic), and every production feature is available the day you need it. *You won't have to migrate.*

Multi-provider setup (OpenAI, Gemini, Ollama): [`docs/multi-provider.md`](docs/multi-provider.md).

---

## Deployment topologies

Three ways to run AgentForge, smallest to largest. Same YAML, same binary — only the deployment shape changes.

### 1. Laptop — single process

```
┌─────────────────────────────────────────────────┐
│  agentforge  (one Node.js process)              │
│                                                 │
│   control plane ──dispatch──► local node        │
│                                                 │
│   SQLite state    (./output/.state.db)          │
│   Anthropic LLM   (ANTHROPIC_API_KEY)           │
└─────────────────────────────────────────────────┘
```

For evaluation, demos, and most small projects. `npx @mandarnilange/agentforge dashboard` starts everything. If you prefer running it in Docker without Postgres or OTel:

```bash
docker compose up -d                                  # Dashboard at :3001
PROJECT=my-app BRIEF="Build a todo app" \
  docker compose run --rm runner                      # One-shot pipeline
```

### 2. Single host — production on one box

```
┌─────────────────────────────────────────────────────┐
│                    Docker host                      │
│                                                     │
│   ┌──────────┐     ┌────────────┐     ┌──────────┐  │
│   │ Postgres │◄───►│ agentforge │────►│ Docker   │  │
│   │          │     │ (control + │     │ executor │  │
│   └──────────┘     │ local node)│     │  (node)  │  │
│                    └────────────┘     └──────────┘  │
│                          │                          │
│                          ▼                          │
│                    Jaeger + Grafana                 │
└─────────────────────────────────────────────────────┘
```

```bash
docker compose -f packages/platform/docker-compose.prod.yml up -d
```

One-box setup for a small team. Postgres durability, OTel tracing, Docker-isolated agent runs, dashboard at `:3001`.

### 3. Distributed — control plane + worker pool

```
 ┌────────────────────────────────┐        ┌─────────────────────────────┐
 │      Control-plane host        │        │       Worker host #1        │
 │                                │        │                             │
 │  ┌──────────────────────────┐  │        │  ┌───────────────────────┐  │
 │  │ agentforge               │  │  HTTP  │  │ agentforge node start │  │
 │  │  scheduler · dashboard   │◄─┼────────┼─►│                       │  │
 │  │  gates · state · events  │  │        │  │  Docker executor      │  │
 │  └──────────────────────────┘  │        │  │  local-fs · git       │  │
 │  ┌──────────────────────────┐  │        │  └───────────────────────┘  │
 │  │ Postgres                 │  │        └─────────────────────────────┘
 │  └──────────────────────────┘  │                     ▲
 └────────────────────────────────┘                     │
                                        ┌───────────────┴─────────────┐
                                        │      Worker host #2 … N     │
                                        │   (same image, more pods)   │
                                        └─────────────────────────────┘
```

```bash
# Control plane host
docker compose -f packages/platform/docker-compose.control-plane.yml up -d

# Every worker host
CONTROL_PLANE_URL=http://cp-host:3001 \
  docker compose -f packages/platform/docker-compose.worker.yml up -d
```

Workers register with the control plane, heartbeat, and receive dispatched agent jobs. Scale horizontally by adding worker hosts; the scheduler routes work using node capabilities + current load.

> **Current limitation — control plane is single-replica.** The execution plane scales horizontally to many worker hosts, but the control plane itself should be run as a single instance today. The pending-job queue, scheduler state, and event bus are process-local, so running two control-plane replicas will split-brain (lost dispatches, halved SSE updates, racing reconcilers). This is tracked as a roadmap item with a concrete path to fix — see [`ROADMAP.md`](ROADMAP.md#horizontal-scaling-of-the-control-plane).

#### Heterogeneous worker pools

Two workers with different capabilities on different hosts — the scheduler picks the right one for each agent via `nodeAffinity`.

```bash
# Worker A — beefy, Docker-isolated, GPU
NODE_NAME=worker-gpu \
NODE_CAPABILITIES=llm-access,docker,high-memory,gpu \
NODE_MAX_CONCURRENT_RUNS=4 \
CONTROL_PLANE_URL=http://cp:3001 \
  docker compose -f packages/platform/docker-compose.worker.yml up -d

# Worker B — lightweight, llm-calls only
NODE_NAME=worker-light \
NODE_CAPABILITIES=llm-access \
NODE_MAX_CONCURRENT_RUNS=10 \
CONTROL_PLANE_URL=http://cp:3001 \
  docker compose -f packages/platform/docker-compose.worker.yml up -d
```

Matching agent — the `developer` agent demands Docker isolation and benefits from GPU, so it routes to `worker-gpu`. The `analyst` agent only needs LLM access, so it lands on `worker-light`:

```yaml
# .agentforge/agents/developer.agent.yaml
spec:
  nodeAffinity:
    required:  [{ capability: llm-access }, { capability: docker }]
    preferred: [{ capability: gpu }, { capability: high-memory }]
```

```yaml
# .agentforge/agents/analyst.agent.yaml
spec:
  nodeAffinity:
    required: [{ capability: llm-access }]
```

Verify the pool:

```bash
agentforge get nodes
# NAME          STATUS   CAPABILITIES                                    ACTIVE/MAX
# worker-gpu    online   llm-access, docker, high-memory, gpu            0/4
# worker-light  online   llm-access                                      0/10
```

Docker image build commands:

```bash
docker build --target core     -t agentforge-core     .   # ~289 MB
docker build --target platform -t agentforge-platform .   # ~336 MB
```

---

## Dashboard

A React SPA served by the same binary. Real-time pipeline view via Server-Sent Events:

- Pipeline run list with status, cost, and progress
- Phase-by-phase timeline with live agent conversations
- Gate management (approve / reject / revise in-browser)
- Artifact viewer with type-aware renderers
- PDF export of a completed run

```bash
npx @mandarnilange/agentforge dashboard --port 3001
```

When `ANTHROPIC_API_KEY` isn't set, the dashboard renders a read-only banner — useful for browsing completed runs.

---

## CLI Reference

```bash
agentforge init --template <name>       # Scaffold .agentforge/ from a template
agentforge templates list               # Show bundled templates
agentforge list                         # List agents in the current project
agentforge info <agent>                 # Agent details
agentforge exec <agent> [options]       # Run a single agent
agentforge run --project <name>         # Start a pipeline
agentforge run --continue <run-id>      # Resume a paused pipeline
agentforge dashboard                    # Start the web dashboard
agentforge get pipelines                # List pipeline runs
agentforge get pipeline <id>            # Inspect a run
agentforge gate approve <gate-id>       # Approve a gate
agentforge gate reject <gate-id>        # Reject a gate
agentforge gate revise <gate-id>        # Request revision
agentforge logs <run-id>                # View agent run logs
agentforge apply -f <path>              # Apply persistent YAML definitions (platform)
agentforge get nodes                    # List registered worker nodes (platform)
agentforge node start --control-plane-url <url>   # Run as a worker (platform)
```

Full command semantics, flag reference, and resume flow: [`docs/getting-started.md`](docs/getting-started.md).

---

## Artifact Typing & Validation

Every agent declares typed inputs and outputs. Artifacts are validated against Zod / JSON Schemas at every pipeline boundary — invalid output fails the agent run before it reaches the next phase.

```
Agent YAML                    Zod Schema                      Runtime
┌─────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ outputs:        │    │ RequirementsSchema   │    │ Agent produces JSON  │
│   - type:       │───▶│   = z.object({       │───▶│ → safeParse(output)  │
│     requirements│    │     epics: [...],    │    │ → pass ✓  or fail ✗  │
│     schema: ... │    │     ...              │    └──────────────────────┘
└─────────────────┘    │   })                 │
                       └──────────────────────┘
```

Ships with 45 built-in schemas covering requirements, architecture, code, data, testing, security, and DevOps. Define your own in TypeScript with Zod and reference them from agent YAML. Details: [`docs/architecture.md`](docs/architecture.md#artifact-flow).

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key. Missing key prints a friendly error with a link to the console. |
| `OPENAI_API_KEY` | If using OpenAI | — | OpenAI API key. |
| `GOOGLE_API_KEY` | If using Gemini | — | Google AI API key. |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama server URL. |
| `AGENTFORGE_DEFAULT_MODEL` | No | `claude-sonnet-4-20250514` | Default model. |
| `AGENTFORGE_MAX_TOKENS` | No | `64000` | Max output tokens. |
| `AGENTFORGE_LLM_TIMEOUT_SECONDS` | No | `600` | Wall-clock timeout per agent LLM call. Set `0` to disable. |
| `AGENTFORGE_OUTPUT_DIR` | No | `./output` | Artifact output directory. |
| `AGENTFORGE_DIR` | No | `./.agentforge` | Path to definitions directory. |
| `AGENTFORGE_LOG_LEVEL` | No | `info` | Log level. |
| `AGENTFORGE_STATE_STORE` | No | `sqlite` | `sqlite` or `postgres`. |
| `AGENTFORGE_POSTGRES_URL` | If `postgres` | — | `postgres://user:pass@host:port/db` — masked in logs. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | — | Enables OTel tracing export. |

### Reliability

- **LLM timeouts.** Every agent LLM call is bounded (default 600s, per-agent override via `spec.resources.timeoutSeconds`). Timeouts abort in-flight HTTP and fail with an actionable error.
- **Retry on `overloaded_error`.** Anthropic HTTP 529 is retried 3× with exponential backoff (2s, 4s, 8s). Caller aborts take precedence.
- **Secret masking.** API keys and the Postgres URL are registered at startup and replaced with `***` in logs, errors, and conversation transcripts.

---

## Documentation

Deep-dive guides live in [`docs/`](docs/):

- **[Getting Started](docs/getting-started.md)** — full walkthrough from install to running a pipeline.
- **[Architecture](docs/architecture.md)** — control plane, domain model, ports & adapters.
- **[Platform Architecture](docs/platform-architecture.md)** — distributed execution, schedulers, recovery.
- **[Pipeline Execution Flows](docs/pipeline-execution-flows.md)** — how a run actually moves through the system.
- **[Multi-Provider Execution](docs/multi-provider.md)** — using OpenAI, Gemini, and Ollama alongside Anthropic.
- **[Templates](docs/templates.md)** — catalog of bundled pipeline templates.
- **[pi-coding-agent Extensions](docs/pi-coding-agent-extensions.md)** — adding custom tools and lifecycle hooks.
- **[Testing Guide](docs/testing-guide.md)** — how to run tests, dry-runs, and real pipelines.

---

## Contributing

Contributions are welcome — bug reports, feature ideas, documentation fixes, and code.

- **Bug reports / feature requests:** [GitHub issues](https://github.com/mandarnilange/agentforge/issues).
- **Development setup and conventions:** [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Testing workflow:** [`docs/testing-guide.md`](docs/testing-guide.md).
- **Larger architectural work / deferred items:** [`ROADMAP.md`](ROADMAP.md) — each entry is issue-ready, pick one up.
- **Pull requests:** small, focused, with tests. Conventional-commit messages preferred.

Everything is MIT-licensed. Contributions land under the same licence.

---

## Using just the framework (`@mandarnilange/agentforge-core`)

If you're embedding the engine into your own CLI or service — or you want the framework without the platform binary, multi-provider middleware, or Postgres — install `@mandarnilange/agentforge-core` directly:

```bash
npm install @mandarnilange/agentforge-core
npx @mandarnilange/agentforge-core init --template simple-sdlc
```

Same YAML schema, same executors, same control plane. You wire your own entry point. Package-level docs: [`packages/core/README.md`](packages/core/README.md).

---

## License

MIT — see [`LICENSE`](LICENSE).

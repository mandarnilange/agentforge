# AgentForge

[![CI](https://github.com/mandarnilange/agentforge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mandarnilange/agentforge/actions/workflows/ci.yml)
[![npm @mandarnilange/agentforge-core](https://img.shields.io/npm/v/@mandarnilange/agentforge-core?label=%40mandarnilange%2Fagentforge-core&color=blue)](https://www.npmjs.com/package/@mandarnilange/agentforge-core)
[![npm @mandarnilange/agentforge](https://img.shields.io/npm/v/@mandarnilange/agentforge?label=%40mandarnilange%2Fagentforge&color=blue)](https://www.npmjs.com/package/@mandarnilange/agentforge)
[![License: MIT](https://img.shields.io/github/license/mandarnilange/agentforge?color=green)](LICENSE)
[![Node ≥20](https://img.shields.io/node/v/@mandarnilange/agentforge-core?color=brightgreen)](package.json)

**An open framework for agentic workflows. Bring your process, LLMs, scripts, agents, and infra — we handle the orchestration.**

- **Compose** agent harnesses in YAML — LLM calls, scripts, validators, transforms, loops, and conditionals.
- **Gate the LLM with your tools** — deterministic steps (linters, tests, schemas) wrap non-deterministic LLM calls, so output is checked on every run.
- **Plug in your stack** — Anthropic, OpenAI, Gemini, Ollama, coding-agent runtimes. Every layer has an extension point where the built-in doesn't fit.
- **Run anywhere** — local, Docker, or remote workers; SQLite or Postgres; OTel-native.
- **Scale like infra** — multi-worker scheduling, approval gates, cost ceilings, live dashboard.

Ships with a reference SDLC template — runnable end-to-end in minutes. Domain-agnostic: code review, content generation, ops runbooks, data pipelines — anywhere multiple LLM calls need to be coordinated with humans in the loop.

---

## Quick Start

```bash
# 1. Install
npm install @mandarnilange/agentforge

# 2. Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Scaffold the reference template into .agentforge/
npx @mandarnilange/agentforge init --template simple-sdlc

# 4. Run the full pipeline (approval gates between phases)
npx @mandarnilange/agentforge run --project my-app --input "brief=Build a freelance invoicing SaaS"

# 5. Watch it live
npx @mandarnilange/agentforge dashboard           # → http://localhost:3001
```

---

## The harness model — what makes AgentForge different

Other frameworks treat an "agent" as one LLM call wrapped in tools. AgentForge treats an agent as a **harness** — a named flow of steps where your existing tools are first-class:

- `llm` — call the model with the system prompt + inputs.
- `script` — run any shell command (linter, test runner, security scanner, your custom CLI).
- `validate` — Zod / JSON Schema check against an artifact. Fails the run by default.
- `transform` — pure data reshape between steps.

Wrap any of these in `loop` (with a `until` predicate + `maxIterations`) or `condition` blocks. The LLM proposes; *your tools* decide whether the output is acceptable. Bad output never leaks into the next phase.

A real example — the bundled `developer` agent's *generate → lint → test → fix-until-passing* flow:

```yaml
spec:
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

Each step's output, exit code, duration, and OTel span land in the state store. The dashboard shows the whole harness, not just the LLM turn.

---

## Architecture: control plane + execution plane

```
                ┌─────────────────────────────────────────────┐
                │              CONTROL PLANE                  │
                │   Dashboard · Scheduler · Gates             │
                │   Definition store · State store · Events   │
                └──────────────────┬──────────────────────────┘
                                   │
                  dispatch jobs    │    report results
                                   ▼
                ┌─────────────────────────────────────────────┐
                │             EXECUTION PLANE                 │
                │   node: local · docker · ssh / http worker  │
                │                                             │
                │  Agents run here — file system, LLM calls,  │
                │  shell, tools all live on the node.         │
                └─────────────────────────────────────────────┘
```

- **Control plane** — pipeline / gate controllers, scheduler, definition store, state store, event bus, dashboard server.
- **Execution plane (nodes)** — the local process, a Docker container, or a remote worker over SSH / HTTP. Nodes advertise **capabilities** (`llm-access`, `docker`, `local-fs`, `git`, `gpu`, …) and the scheduler matches each agent's `nodeAffinity` to the pool.
- **Same binary.** On a laptop, one process hosts both. In production, run control-plane and worker containers from the same image with different CLI invocations.

---

## Core concepts

| Concept | What it is | Defined in |
|---|---|---|
| **Agent** | A system prompt + typed I/O + optional step pipeline. Runs on a node. | `.agentforge/agents/*.agent.yaml` |
| **Pipeline** | A sequence of phases; each phase runs one or more agents and may end with an approval gate. | `.agentforge/pipelines/*.pipeline.yaml` |
| **Node** | An execution target — `local`, Docker, or remote SSH — with declared capabilities. | `.agentforge/nodes/*.node.yaml` |
| **Artifact** | A typed, validated JSON document passed between agents. | `.agentforge/schemas/*.schema.yaml` |
| **Gate** | A pause point between phases for human review (approve / reject / revise). | Inline in the pipeline |

Agents declare which capabilities they need:

```yaml
# .agentforge/agents/developer.agent.yaml (excerpt)
spec:
  nodeAffinity:
    required:
      - capability: llm-access
      - capability: docker        # writes files + runs shell — needs isolation
    preferred:
      - capability: high-memory   # prefer a beefy node if available
```

The scheduler picks the highest-scoring node whose capabilities satisfy the required set; soft preferences break ties.

---

## Reference template — `simple-sdlc`

Three agents wired into a classic requirements → architecture → implementation flow.

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
    - { name: brief, type: raw-brief, required: true }
  phases:
    - { name: requirements, phase: 1, agents: [analyst],   gate: { required: true } }
    - { name: architecture, phase: 2, agents: [architect], gate: { required: true } }
    - { name: implementation, phase: 3, agents: [developer] }
```

More templates — `api-builder`, `code-review`, `content-generation`, `data-pipeline`, `seo-review` — ship with the platform binary.

---

## Deployment topologies

Same YAML, same binary — three shapes from smallest to largest.

### 1. Laptop — single process

```
┌─────────────────────────────────────────────────┐
│  agentforge  (one Node.js process)              │
│   control plane ──dispatch──► local node        │
│   SQLite state · Anthropic LLM                  │
└─────────────────────────────────────────────────┘
```

`npx @mandarnilange/agentforge dashboard` starts everything. Dockerized variant available without Postgres / OTel:

```bash
docker compose up -d                                  # Dashboard at :3001
PROJECT=my-app BRIEF="Build a todo app" \
  docker compose run --rm runner                      # One-shot pipeline
```

### 2. Single host — production on one box

Postgres durability, OTel tracing, Docker-isolated agent runs.

```bash
docker compose -f packages/platform/docker-compose.prod.yml up -d
```

### 3. Distributed — control plane + worker pool

```bash
# Control-plane host
docker compose -f packages/platform/docker-compose.control-plane.yml up -d

# Each worker host
CONTROL_PLANE_URL=http://cp-host:3001 \
  docker compose -f packages/platform/docker-compose.worker.yml up -d
```

Workers register, heartbeat, and receive dispatched jobs. Heterogeneous pools (GPU vs lightweight) are routed by `nodeAffinity`.

> **Current limitation — control plane is single-replica.** The execution plane scales horizontally to many worker hosts, but the control plane itself should be run as a single instance today. Pending-job queue, scheduler state, and event bus are process-local; running two replicas will split-brain. Tracked with a concrete fix path — see [`ROADMAP.md`](ROADMAP.md#horizontal-scaling-of-the-control-plane).

---

## Two packages — which one to install

Install **`@mandarnilange/agentforge`** unless you have a specific reason not to. Defaults are identical for local dev (SQLite, local executor, Anthropic), and every production feature is available the day you need it — no migration.

Install **`@mandarnilange/agentforge-core`** if you want the framework primitives without multi-provider middleware, Postgres, or the Docker / SSH executors — typically when embedding AgentForge in your own CLI.

---

## Dashboard

A React SPA served by the same binary. Real-time pipeline view via Server-Sent Events: run list with status / cost / progress, phase-by-phase timeline with live agent conversations, gate management (approve / reject / revise in-browser), artifact viewer with type-aware renderers, PDF export.

```bash
npx @mandarnilange/agentforge dashboard --port 3001
```

When `ANTHROPIC_API_KEY` isn't set, the dashboard renders a read-only banner — useful for browsing completed runs.

---

## Agent Skills

Designing an AgentForge workflow from scratch is a lot of YAML. The repo ships an [agent skill](https://skills.sh) that walks any Claude Code / Cursor / Codex session through the design — agents, phases, gates, loops, parallelism, wiring, nodes — and emits a working `.agentforge/` directory.

```bash
npx skills add mandarnilange/agentforge/agentforge-workflow
```

Then ask the agent something like *"help me design an AgentForge pipeline for PR triage"* and the skill kicks in. Catalog and authoring docs: [`skills/`](skills/).

---

## CLI reference

```bash
agentforge init --template <name>       # Scaffold .agentforge/ from a template
agentforge templates list               # Show bundled templates
agentforge exec <agent> [options]       # Run a single agent
agentforge run --project <name>         # Start a pipeline
agentforge run --continue <run-id>      # Resume a paused pipeline
agentforge dashboard                    # Start the web dashboard
agentforge get pipelines                # List pipeline runs
agentforge gate {approve,reject,revise} # Gate actions
agentforge logs <run-id>                # View agent run logs
agentforge apply -f <path>              # Apply persistent YAML definitions (platform)
agentforge get nodes                    # List registered worker nodes (platform)
agentforge node start --control-plane-url <url>   # Run as a worker (platform)
```

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key. |
| `OPENAI_API_KEY` / `GOOGLE_API_KEY` | If using | — | Other providers. |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama server URL. |
| `AGENTFORGE_DEFAULT_MODEL` | No | `claude-sonnet-4-20250514` | Default model. |
| `AGENTFORGE_LLM_TIMEOUT_SECONDS` | No | `600` | Wall-clock timeout per LLM call (`0` disables). |
| `AGENTFORGE_OUTPUT_DIR` / `AGENTFORGE_DIR` | No | `./output` / `./.agentforge` | Output and definitions paths. |
| `AGENTFORGE_STATE_STORE` | No | `sqlite` | `sqlite` or `postgres`. |
| `AGENTFORGE_POSTGRES_URL` | If `postgres` | — | Connection URL — masked in logs. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | — | Enables OTel tracing export. |

**Reliability:** every LLM call is bounded by `timeoutSeconds` (per-agent override available). Anthropic HTTP 529 (`overloaded_error`) is retried 3× with exponential backoff. API keys and the Postgres URL are masked in logs, errors, and conversation transcripts.

---

## Learn more

Every deep-dive lives in [`docs/`](docs/). Pick a track:

**Get started**
- **[Getting Started](docs/getting-started.md)** — install to first pipeline run, full CLI walkthrough, resume flow.
- **[Who Uses It](docs/who-uses-it.md)** — what platform engineers, software engineers, and domain owners each get out of AgentForge.
- **[Templates](docs/templates.md)** — catalog of bundled pipeline templates.

**Concepts**
- **[Harness Model](docs/harness-model.md)** — full step-grammar walkthrough and the bundled `developer` agent's test-fix loop.
- **[Architecture](docs/architecture.md)** — control plane, domain model, ports & adapters, step grammar.
- **[Pipeline Execution Flows](docs/pipeline-execution-flows.md)** — how a run moves through the system.
- **[Artifact Typing](docs/artifacts.md)** — typed inputs/outputs, schema validation, why malformed LLM output fails fast.

**Operate**
- **[Platform Architecture](docs/platform-architecture.md)** — distributed execution, schedulers, recovery, heterogeneous worker pools.
- **[Packages — core vs platform](docs/packages.md)** — feature comparison and embedding the framework.
- **[Multi-Provider Execution](docs/multi-provider.md)** — OpenAI, Gemini, and Ollama alongside Anthropic.

**Extend & test**
- **[pi-coding-agent Extensions](docs/pi-coding-agent-extensions.md)** — adding custom tools and lifecycle hooks.
- **[Testing Guide](docs/testing-guide.md)** — running tests, dry-runs, and real pipelines.

---

## Stability

v0.2.0 release candidate (`v0.2.0-rc.2`) — early-feedback build. API surface is stabilising but may still shift. `npm install @mandarnilange/agentforge` pulls the RC. [Open an issue](https://github.com/mandarnilange/agentforge/issues) for anything that looks rough, or use [Discussions](https://github.com/mandarnilange/agentforge/discussions) for usage questions.

---

## Contributing

Bug reports, feature ideas, doc fixes, and code are all welcome.

- **Issues / requests:** [GitHub issues](https://github.com/mandarnilange/agentforge/issues).
- **Dev setup and conventions:** [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Larger architectural work:** [`ROADMAP.md`](ROADMAP.md) — every entry is issue-ready.
- **Pull requests:** small, focused, with tests. Conventional-commit messages preferred.

MIT-licensed — see [`LICENSE`](LICENSE).

# @mandarnilange/agentforge

**Production infrastructure for AgentForge.** Distributed execution, PostgreSQL, full observability, crash recovery.

Extends [@mandarnilange/agentforge-core](https://www.npmjs.com/package/@mandarnilange/agentforge-core) with everything needed to run AI agent workflows at scale — Docker/remote executors, PostgreSQL persistence, OpenTelemetry tracing, rate limiting, and multi-node worker scheduling.

> **Note:** This package requires `@mandarnilange/agentforge-core` as a peer dependency. The platform listing depends on it directly, so a single install pulls both:
> ```bash
> npm install @mandarnilange/agentforge
> ```

## Quick Start

### Single Machine (PostgreSQL + OTel)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AGENTFORGE_STATE_STORE=postgres
export AGENTFORGE_POSTGRES_URL=postgres://user:pass@localhost:5432/agentforge
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

npx agentforge dashboard
```

### Docker (Full Stack)

```bash
cp .env.example .env
# Set ANTHROPIC_API_KEY and POSTGRES_PASSWORD

# All-in-one: PostgreSQL + Dashboard + Worker + Jaeger + Grafana
docker compose -f packages/platform/docker-compose.prod.yml up -d
```

### Distributed (Control Plane + Workers)

```bash
# Control plane host
docker compose -f packages/platform/docker-compose.control-plane.yml up -d

# Worker hosts (can be multiple)
CONTROL_PLANE_URL=http://cp-host:3001 \
docker compose -f packages/platform/docker-compose.worker.yml up -d
```

## What Platform Adds Over Core

| Capability | Core | Platform |
|-----------|------|----------|
| LLM Provider | Anthropic only | + OpenAI (GPT-4o, o1), Google Gemini, Ollama (local) |
| Executor | Local (in-process) | + Docker containers, Remote HTTP workers |
| State Store | SQLite | + PostgreSQL (connection pooling, JSONB) |
| Definitions | YAML files (in-memory) | + `apply` command (persistent, versioned, hot-reload) |
| Observability | OTel API (no-op) | Full OTel SDK + Jaeger export + Grafana |
| Crash Recovery | None | Auto-rehydration, stuck run detection, retry |
| Rate Limiting | None | Token/cost/concurrency limits per pipeline |
| Node Management | None | Worker registration, health checks, SSH runtime |
| Deployment | Single Docker compose | Control plane + worker split, multi-host |

## CLI Commands (extends core)

All core commands are available, plus:

```bash
# Apply YAML definitions to persistent store (hot-reload)
agentforge apply -f .agentforge/agents/

# Node management
agentforge get nodes
agentforge node start --control-plane-url http://cp:3001

# Everything from core works too
agentforge run --project my-app --input "brief=Build a SaaS"
agentforge dashboard
agentforge gate approve <gate-id>
```

## Configuration

### Environment Variables (in addition to core)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | If using `openai` executor | — | OpenAI API key |
| `GOOGLE_API_KEY` | If using `gemini` executor | — | Google AI API key |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama server URL |
| `AGENTFORGE_STATE_STORE` | No | `sqlite` | `sqlite` or `postgres`. When `postgres`, `AGENTFORGE_POSTGRES_URL` is validated and a `SELECT 1` preflight runs at startup — misconfiguration fails fast with a friendly error. |
| `AGENTFORGE_POSTGRES_URL` | If postgres | — | `postgres://user:pass@host:port/db` — registered as a secret and masked in logs. |
| `AGENTFORGE_LLM_PROVIDER` | No | `anthropic` | LLM provider override |
| `AGENTFORGE_NODE_SECRET` | No | — | Shared secret for worker auth |
| `AGENTFORGE_MAX_TOKENS_PER_PIPELINE` | No | — | Token limit per pipeline |
| `AGENTFORGE_MAX_COST_PER_PIPELINE` | No | — | Cost limit (USD) per pipeline |
| `AGENTFORGE_MAX_CONCURRENT_RUNS_PER_PROJECT` | No | — | Concurrency limit |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | — | OTLP endpoint (enables tracing) |

## Docker Deployments

### All-in-One Production

```bash
docker compose -f packages/platform/docker-compose.prod.yml up -d
```

Services: PostgreSQL, Control Plane (dashboard + API on :3001), Worker, Jaeger (:16686), Grafana (:3000).

### Separate Control Plane + Workers

**Control plane:**
```bash
docker compose -f packages/platform/docker-compose.control-plane.yml up -d
```

**Workers** (deploy on execution hosts):
```bash
CONTROL_PLANE_URL=http://cp-host:3001 \
docker compose -f packages/platform/docker-compose.worker.yml up -d
```

## Architecture

Platform extends core via its ports/adapters pattern:

```
src/
  adapters/execution/    Docker, remote HTTP, OpenAI, Gemini, Ollama backends + registry
  adapters/store/        SqliteDefinitionStore (persistent, versioned)
  control-plane/         Recovery, reconciliation, rate limiter, node health
  di/                    Platform container factory (multi-provider DI)
  nodes/                 Worker registration, health checks, SSH runtime
  state/                 PostgreSQL state store
  utils/                 Platform cost calculator (OpenAI/Gemini/Ollama pricing)
  observability/         OTel SDK init + preload
  cli/commands/          apply, node-start, nodes commands
  platform-cli.ts        Entry point (extends core CLI)
```

### Multi-Provider LLM Support

Platform adds provider-aware middleware for OpenAI, Google Gemini, and Ollama. Set `model.provider` in agent YAML (executor stays `pi-ai` or `pi-coding-agent`):

```yaml
spec:
  executor: pi-ai              # backend type (unchanged)
  model:
    provider: openai           # LLM provider (what changes)
    name: gpt-4o
    maxTokens: 16384
```

Mix providers in the same pipeline — each agent independently selects its `model.provider`. See [Multi-Provider Execution](../../docs/multi-provider.md).

## License

MIT

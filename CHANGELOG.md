# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] — First public release

### `agentforge-core` — the framework

- Kubernetes-style control plane for AI agent workflows. Declarative YAML agents, pipelines, and nodes (`apiVersion: agentforge/v1`).
- Step pipeline engine: `llm`, `script`, `validate`, and `transform` steps, with parallel blocks and loop constructs for LLM-fix-and-retest patterns.
- Approval gates between phases (`approve` / `reject` / `request-revision`).
- Artifact chaining between phases with automatic Zod / JSON-Schema validation at boundaries.
- Per-agent token budget enforcement and wall-clock LLM timeouts (`AGENTFORGE_LLM_TIMEOUT_SECONDS`, default 600s; per-agent override via `spec.resources.timeoutSeconds`).
- Exponential backoff on Anthropic `overloaded_error` / HTTP 529 (3 attempts: 2s, 4s, 8s).
- Secret masking — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AGENTFORGE_POSTGRES_URL` replaced with `***` in logs, errors, and conversation transcripts.
- SQLite state store (zero-config persistence).
- OpenTelemetry API instrumentation (no-op without SDK; zero runtime cost).
- Clean architecture with ports & adapters. Domain layer has no external dependencies.
- Web dashboard (React SPA) with pipeline list/detail, gate actions, artifact rendering, PDF export, and cost tracking. Served by `agentforge-core dashboard`.
- `simple-sdlc` template bundled: three generic agents (`analyst`, `architect`, `developer`) demonstrating the framework end-to-end. Swap in your own agents for any domain.
- CLI: `init`, `templates`, `list`, `info`, `exec`, `apply`, `dashboard`, `logs`, `run`, `get`, `gate`, `describe`, `node`.

### `agentforge` — production infrastructure (optional add-on)

- Multi-provider LLM backends — OpenAI (GPT-4o, o1), Google Gemini (2.5 Pro/Flash), Ollama (local). Mixed providers per pipeline: each agent picks its own `model.provider`.
- Docker container and remote HTTP executors for isolated/distributed agent runs.
- PostgreSQL state store with connection pooling, JSONB, and `SELECT 1` preflight at startup.
- PostgreSQL definition store — in `AGENTFORGE_STATE_STORE=postgres` mode the `resource_definitions` + `resource_definition_history` tables move to Postgres alongside state. No SQLite file is created. The runtime sync `DefinitionStore` is in-memory (populated from YAML at boot and `apply`) and PG holds the persistence + audit trail.
- Versioned schema migrations — both SQLite and Postgres stores run `.sql` migration files from `dist/state/migrations/{sqlite,postgres}/` at startup, tracked in a `schema_migrations` table (see `packages/core/src/state/migrate.ts`). Replaces the previous ad-hoc `CREATE TABLE IF NOT EXISTS` + try/catch `ALTER TABLE` approach with a proper append-only migration chain. Future schema changes ship as new `NNN-description.sql` files.
- Full OpenTelemetry SDK with Jaeger export.
- Crash recovery (pipeline rehydration) and a reconciliation loop for stuck-run detection.
- Rate limiting — token, cost, and concurrency limits per pipeline.
- Worker node registration, heartbeat monitoring, SSH runtime.
- Multi-host Docker Compose deployments (control plane + workers).
- Extra pipeline templates: `api-builder`, `code-review`, `content-generation`, `data-pipeline`, `seo-review`.

### Packaging & distribution

- Two MIT-licensed npm packages:
  - `agentforge-core` → bin `agentforge-core`
  - `agentforge` → bin `agentforge` (peer-depends on `agentforge-core`)
- Multi-target Dockerfile: `agentforge-core` (slim, SQLite + local executor + dashboard) and `agentforge-platform` (full stack with Docker/Postgres/OTel/worker modes).
- GitHub Actions CI (Node 20 + 22 matrix) and tag-triggered release workflow that publishes to npm (with `--provenance`) and GHCR.

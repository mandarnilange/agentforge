# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0-rc.2] — Move both packages under `@mandarnilange/*`

The framework package is now published as `@mandarnilange/agentforge-core`
(was `agentforge-core`), matching the platform package's scope from
rc.1. Both packages now live under one consistent npm scope, which
keeps install paths uniform across docs and removes the lingering
similarity-policy risk on the unscoped name.

CLI binaries are unchanged — `agentforge-core` and `agentforge` keep
their existing names; only the install paths carry the scope.

The unscoped versions of `agentforge-core` (`0.2.0-rc.0` and
`0.2.0-rc.1`) are deprecated on npm and direct installs to the new
scoped name. Anyone who only depends on `@mandarnilange/agentforge`
gets the new core transparently as a transitive dependency.

This rc.2 also bundles `npm audit` fixes for the
`fast-xml-parser` XML-injection advisory (moderate, transitive
via the AWS SDK pulled in by OpenTelemetry exporters). No API
surface change.

The remaining two `npm audit` warnings are for `uuid <14.0.0` reached
through `dockerode@4.x` (`@aws-sdk` no longer applies after the fix
above). The advisory only affects `uuid.v3/v5/v6` when called with a
pre-allocated `buf` argument; `dockerode` uses `uuid.v4()`, which is
unaffected, so AgentForge is not exposed. `dockerode@5.x` removes the
`uuid` dependency entirely — we'll bump to it in v0.3 once
`@types/dockerode` ships v5 (currently at 4.0.1 on DefinitelyTyped).

## [0.2.0-rc.1] — Scope the platform package + retag

The platform package is now published as `@mandarnilange/agentforge`
because the unscoped name `agentforge` is blocked by npm's
typosquatting / similarity policy (existing `agent-forge` package).
The CLI binary stays `agentforge`; only the install path changes:
`npm install @mandarnilange/agentforge`.

`agentforge-core@0.2.0-rc.0` was published successfully on the first
attempt; `0.2.0-rc.1` is a fresh version of both packages so the tag
chain is consistent.

## [0.2.0-rc.0] — Release candidate (npm name registration + early feedback)

This is a release candidate for the first public release. It claims the
`agentforge-core` and `@mandarnilange/agentforge` npm names and exposes
the framework to early users for feedback before the v0.2.0 final tag.

The complete feature set below is shipped and tested. Two limitations
worth flagging for early adopters:

- **`apply` requires the prompt file alongside the agent yaml.** If your
  agent uses `spec.systemPrompt.file`, the file has to be reachable
  relative to the yaml's directory (or under `<dir>/prompts/`). Apply
  hard-fails with a clear error otherwise. Or use `spec.systemPrompt.text`
  inline. Prompts becoming a first-class apply-able resource is on the
  roadmap (`Prompt` kind, dashboard tab) — that lands in v0.3.
- **Definition propagation across processes uses 5-second polling.** In
  PG mode, an apply on one process becomes visible to other CP / worker
  processes within ~5 seconds (configurable via
  `AGENTFORGE_PG_DEFINITIONS_REFRESH_MS`). For high-throughput
  multi-replica deployments where this is too coarse, the Postgres
  `LISTEN/NOTIFY` push-based replacement is on the roadmap.

Please file issues at https://github.com/mandarnilange/agentforge/issues
or use Discussions for usage questions.

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

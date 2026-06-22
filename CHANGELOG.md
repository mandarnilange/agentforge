# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.1] — Dependency migration & Node 22 requirement

Maintenance release: migrates off the deprecated `@mariozechner/pi-*` packages
and hardens the first-run experience on npm 11+.

### Changed

- **BREAKING — Node.js ≥ 22.19 is now required.** The pi execution backends
  (`@earendil-works/pi-*` 0.79) declare `engines.node >= 22.19.0` (their bundled
  undici relies on a Node 22 API), so Node 20 is no longer supported. `engines`
  across all packages, the CI matrix, the runtime Docker images
  (`node:22-alpine`), and the docs are updated accordingly.
- **pi backends migrated to `@earendil-works/pi-*`** — `pi-ai`, `pi-agent-core`,
  and `pi-coding-agent` move from the deprecated/renamed `@mariozechner/pi-*`
  packages to `@earendil-works/pi-*` `^0.79.9`. This clears the deprecation
  warnings shown on `npm install`. No public API change.

### Added

- **Actionable native-binding error.** A missing or incompatible `better-sqlite3`
  build now fails with guidance to run `npm approve-scripts better-sqlite3 koffi`
  then `npm rebuild`, instead of a cryptic "Could not locate the bindings file".
- **npm 11+ install-script note** in both READMEs and the getting-started guide —
  npm 11 gates dependency install scripts, and the native modules
  (`better-sqlite3`, `koffi`) must be approved to build.

## [0.3.0] — Per-agent model selection

Agent definitions can now choose their own model. Previously `spec.model`
(provider/name/maxTokens/thinking) was parsed but silently ignored — every
run used the global config model regardless of what the agent declared.

### Added

- **`spec.model` now drives execution**: an agent's declared provider, model
  name, and `maxTokens` are honored for both single-agent `exec` and pipeline
  runs, falling back to config per field when omitted.
- **`thinking` wired end-to-end**: `spec.model.thinking` maps to the pi-ai
  `reasoning` option and the pi-coding-agent `thinkingLevel`. Invalid levels
  are validated and safely coerced (omitted for pi-ai; defaults to `medium`
  for pi-coding-agent) so a typo can't reach the provider API.

### Changed

- **Model precedence** (highest first): `--model` CLI flag → agent
  `spec.model` → config default (config file / `AGENTFORGE_DEFAULT_MODEL` /
  built-in). An explicit `--model` still overrides an agent's declared model.
- **`--model` accepts `[provider/]name`**: a bare name (`claude-sonnet-4-6`)
  overrides the model name and uses the default provider; `provider/name`
  (`openai/gpt-4o`) overrides both, avoiding a name/provider mismatch when an
  agent declares a non-default provider.
- **`exec --dry-run`** now resolves and prints the model the agent would
  actually use (including `spec.model` provider/name, plus `maxTokens` and
  `thinking`) instead of only the CLI/env default.
- **Pipeline accounting**: persisted `modelName`/`provider`, metrics, and cost
  estimation now reflect the model that actually ran.
- **Default model** bumped to `claude-sonnet-4-6` across shipped templates,
  the `init`-generated config, and the built-in config default.

## [0.2.0] — First stable: config validation, distributed control plane, skill family

First stable release on the `@mandarnilange/*` scope. Promotes the rc.2
package layout and adds two substantive tracks (P40 + P45) plus a
docs-and-skills authoring surface that landed since rc.2.

### Added — Configuration validation (P40)

- **`ANTHROPIC_API_KEY`**: friendly startup error in core exec / run-pipeline
  instead of a deep SDK stack; dashboard surfaces a read-only banner when
  the key is absent.
- **Empty `.agentforge/` warning**: core warns when no agents or pipelines
  are discovered at startup so the failure mode is obvious.
- **`AGENTFORGE_POSTGRES_URL`**: platform validates the URL is parseable
  and the database is reachable before any controller starts.
- **Docker socket**: nodes hosting Docker executors verify the socket
  is reachable and the daemon responds before accepting work, with a
  persistent error sink on the probe socket.
- **SSH preflight**: SSH nodes validate key file readability and host
  TCP/SSH-handshake reachability at startup.

### Added — Distributed control plane (P45)

- **Heterogeneous worker compose example**: GPU-heavy / Docker-light
  worker profiles in `docker-compose.heterogeneous.yml` plus a worked
  README walkthrough and `platform-architecture.md` §15.
- **Pluggable event bus**: `PostgresEventBus` adapter with
  `LISTEN/NOTIFY` for fan-out across control-plane replicas; factory
  selects between in-memory and Postgres transports.
- **DB-backed job queue with claim semantics**: `PostgresJobQueue` —
  visibility-timeout based claiming, stale-claim reclaim, and corrupt
  payload eviction (no infinite re-claim loop on JSON parse errors).
- **Leader election**: `PostgresLeaderElector` via advisory locks +
  pooled-client destroy on error; `LeaderGatedLoop` wraps singleton
  loops (reconciler, scheduler) with a self-scheduling async tick and
  acquire-then-run / release-on-shutdown lifecycle.
- **Stateless scheduler**: reads active-run counts from the DB
  (`DbActiveRunCounter`) instead of in-process state, enabling N
  control-plane replicas behind a load balancer.
- **Migrations**: `003-job-queue.sql` and `004-active-run-index.sql`.
- **Limitation note**: README and platform README link to the P45
  follow-up roadmap; the 2-replica integration suite (P45-T7) is
  scheduled for v0.2.1.

### Added — Skill family + docs (since rc.2)

- **`agentforge-workflow` skill**: guided workflow authoring that emits
  a complete schema-valid `.agentforge/` directory.
- **`agentforge-template-author` skill**: contributor guide for shipping
  new templates under `packages/core/src/templates/`.
- **`agentforge-debug` skill**: triages stuck or failing pipeline runs.
- **`agentforge-cli` skill**: conversational front-end over the
  `agentforge` / `agentforge-core` CLIs.
- **Vercel skills publish pipeline** + validator + skills changelog +
  version-bump release flow.
- **README revamp**: harness-first framing, bullet hero, consolidated
  "Learn more" launchpad; `npx` invocations scoped under
  `@mandarnilange/*` across all docs.

### Fixed

- 8 CodeRabbit findings on PR #14 covering concurrent `acquire()` in the
  local leader, overlapping leader-loop executions, postgres event-bus
  teardown ordering and listener-leak on `LISTEN` failure, postgres
  job-queue corrupt-payload handling, postgres leader-elector
  pooled-client destruction on error paths, docker-availability second
  `error` event, and a `db-active-run-counter` test that didn't
  exercise the empty-rows fallback.

### Notes

- P45-T7 (two-replica integration test) deferred to v0.2.1.
- `uuid <14.0.0` advisory reached through `dockerode@4.x` remains an
  audit warning; AgentForge calls `uuid.v4()` exclusively and is not
  exposed. Bump to `dockerode@5.x` is queued for v0.3 once
  `@types/dockerode` ships v5.

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

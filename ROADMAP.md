# AgentForge Roadmap

This file tracks architectural work intentionally deferred past the current release. Each entry is written as an issue-ready brief — **Problem**, **Proposal**, **Touches** — so a contributor can pick it up without a fresh round of archaeology.

Short-term maintenance, bug fixes, small features, and release-checklist items are tracked as GitHub issues, not here. This file is for work that *changes architecture*.

---

## Already shipped in v0.2.0

Context for anyone skimming the roadmap — these pieces are already live:

- Declarative YAML control plane — agents, pipelines, nodes, and artifact schemas as data.
- Step pipeline engine with `llm` / `script` / `validate` / `transform` steps, plus `parallel` and `loop` constructs.
- Approval gates between phases with a full audit trail.
- Typed artifacts with 45 built-in schemas; Zod + JSON Schema validation.
- SQLite state store (`@mandarnilange/agentforge-core`) and PostgreSQL (`@mandarnilange/agentforge`).
- Local, Docker, and remote HTTP executors.
- Multi-provider LLMs — Anthropic, OpenAI, Gemini, Ollama. Mixed per-agent.
- OpenTelemetry instrumentation (API-only in core; full SDK + Jaeger export in platform).
- Crash recovery + stuck-run reconciliation (platform).
- Per-agent cost + token budgets; org-wide rate limiting (platform).
- Heterogeneous worker pools with capability-based scheduling.
- Six pipeline templates — `simple-sdlc`, `api-builder`, `code-review`, `content-generation`, `data-pipeline`, `seo-review`.
- React dashboard with live updates, artifact rendering, PDF export, and cost tracking.
- Process-wide secret masking (API keys, Postgres URL) across logs, traces, and errors.

Detailed release notes: [`CHANGELOG.md`](CHANGELOG.md).

---

## Pluggability & extensibility

### MCP tool integration

**Problem.** The Model Context Protocol (MCP) is becoming the standard way to expose tools to LLM agents. AgentForge agents today can add custom tools via the pi-coding-agent extension API, but each integration is hand-written TypeScript. MCP would let an agent declare *"I need tools from this MCP server"* in YAML and have them wired in at runtime.

**Proposal.** Add an `mcp:` section to agent YAML declaring MCP servers to connect to — stdio, SSE, or HTTP transports. An `MCPClient` manager connects at agent startup, merges remote tools into the local tool set, and tears them down on exit. Tool invocations route through the MCP protocol; errors surface as normal tool errors.

```yaml
spec:
  mcp:
    servers:
      - name: github
        transport: stdio
        command: ["mcp-server-github"]
      - name: filesystem
        transport: sse
        url: http://localhost:3333
```

**Touches.** New `packages/core/src/adapters/mcp/` (client + lifecycle), agent YAML schema, agent runner tool wiring, tests against a mock MCP server.

### OpenCode execution backend

**Problem.** `@mandarnilange/agentforge-core` ships with `@mariozechner/pi-coding-agent` as the only coding runtime. The `IExecutionBackend` port exists so others can plug in, but no adapter has been written yet. OpenCode is a strong candidate — actively developed, TypeScript, similar tool surface.

**Proposal.** New `OpenCodeExecutionBackend` in the platform package. Accepts an `AgentJob`, delegates to OpenCode's CLI or SDK, forwards status updates back via the `onStatus` callback, returns an `AgentJobResult`. Config via agent YAML `executor: opencode`.

**Touches.** `packages/platform/src/adapters/execution/opencode-execution-backend.ts`, backend registry, DI wiring, YAML schema (new executor enum value), integration test.

### Codex execution backend

**Problem.** Same as OpenCode — the port is there; no adapter yet. Codex is OpenAI's coding-agent offering; an adapter lets AgentForge users mix GPT-5-Codex into agent workflows.

**Proposal.** Mirror the OpenCode adapter structure. Auth via `OPENAI_API_KEY` (already a registered secret). Config via agent YAML `executor: codex`.

**Touches.** `packages/platform/src/adapters/execution/codex-execution-backend.ts`, backend registry, DI wiring, YAML schema, integration test.

### pi-coding-agent subagent + validation loops

**Problem.** Coding agents today run end-to-end, then the *outer* pipeline validates the output. If tests fail, the agent has to be re-invoked from scratch — losing session context. This is inefficient for iterative work.

**Proposal.** A pi-coding-agent extension that (a) runs validation — tests, lint, type-check — *inside* the coding session, (b) spawns subagents focused on specific failures, (c) returns only when validation passes or retries exhaust. Higher-quality artifacts, fewer re-runs from the outer pipeline.

**Touches.** New extension module alongside pi-coding-agent, `turn_end` lifecycle hook, subagent dispatch logic, configuration (max retries, validation commands).

---

## Security, policy, and secrets

### Policy as YAML — ToolPolicy / NetworkPolicy / SecurityPolicy

**Problem.** Agents today can use any tool in their declared list, egress to any network, and read anything their executor node can read. No policy layer. Multi-tenant deployments need to constrain what agents can do — without editing every agent YAML.

**Proposal.** Three new YAML kinds mirroring Kubernetes:

- `ToolPolicy` — whitelist / blacklist of tool names per agent scope.
- `NetworkPolicy` — allowed egress CIDRs / hostnames.
- `SecurityPolicy` — composite wrapper binding the above with filesystem and secrets scopes.

Policies bind to agents or pipeline phases. The executor checks each tool call / network request against the applicable policy set; violations fail cleanly with an audit-log entry.

**Touches.** New `kind:` parsers, enforcement in `pi-coding-agent-backend` and `docker-agent-executor`, policy resolver in the agent runner, audit log entries for policy decisions, tests.

### Pluggable secret providers — `ISecretProvider`

**Problem.** Secrets today live in environment variables. Production deployments need proper secret management — AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, Azure Key Vault. Agents shouldn't see raw secret values; they declare what they need and the vault resolves it at runtime.

**Proposal.** `ISecretProvider` port in core; default `EnvSecretProvider` ships with core. Platform adds `AwsSecretsManagerProvider`, `GcpSecretManagerProvider`, `VaultProvider`, `AzureKeyVaultProvider`. Secrets are declared in `SecurityPolicy` as `secretRefs`, resolved at tool-call time. The existing secret-masking registry automatically picks up new values so they're redacted from logs, traces, and conversation transcripts.

**Touches.** New port in core, four new adapters in platform, `SecurityPolicy` integration, config env vars for each vault backend (`AWS_REGION`, `VAULT_ADDR`, etc.), integration tests that spin up each vault in a container.

---

## Prompts as first-class resources

**Problem.** System prompts are embedded inside agent definitions today (`spec.systemPrompt.text` inline, or `spec.systemPrompt.file: "prompts/<name>.system.md"` resolved against the agent's source dir at apply time). There's no way to:

- `apply` a prompt directly (no `Prompt` kind)
- View / edit prompts in the dashboard (no Prompts tab)
- Reference a shared prompt across multiple agents (each has its own copy)
- Update a prompt without touching the agent yaml

This shows up in two practical pain points: editing one agent yaml in isolation silently strips the inlined prompt unless the prompt file travels alongside, and a prompt update means a version-bump on every agent that copy-pasted it.

**Proposal.** Mirror the schema pattern landed in v0.2.0:

- New `Prompt` kind. `apply` walks `prompts/*.system.md` files alongside agents/pipelines/nodes/schemas, persists each with `kind="Prompt"`, `name=<filename without .system.md>`, body in `spec_yaml` as the markdown.
- Agent yaml gains a third option in `systemPrompt`: `ref: "<prompt-name>"` — looks up by name at runtime through a new `getDiscoveredPrompt()` global (parallel to `getDiscoveredSchema()`).
- `apply` continues to inline `file:` references for backward compat, but emits a deprecation hint nudging toward the explicit `ref:` form.
- Dashboard gets a Prompts tab in Settings (parallel to Schemas).
- Single-file `apply` of `*.system.md` resolves to a Prompt resource — gives users a no-yaml way to update a shared prompt.

**Touches.** New `Prompt` kind in `DefinitionKind` union (both stores already accept it as a string). New `prompts/index.ts` registry parallel to `schemas/index.ts`. Apply command directory + single-file branches. Dashboard route + Settings tab. Backward-compat shim that keeps `systemPrompt.file` working.

---

## Definition propagation across processes

### Async `DefinitionStore` interface

**Problem.** The runtime `DefinitionStore` interface is synchronous (`getAgent(name): T | undefined`). PG queries are async. To bridge the gap, platform-cli holds an in-memory cache hydrated from PG at boot and refreshed every 5 seconds. That cache is a real moving part: every long-running process (control plane, every worker) carries its own copy, and they drift between refresh ticks. Eliminating the cache requires every consumer of `DefinitionStore.getAgent / listAgents / getPipeline / getNode` (50+ call sites in the agent runner, pipeline controller, scheduler, dashboard server, init / list / info / exec / gate CLIs) to become async-aware.

**Proposal.** Widen `DefinitionStore` to async — `getAgent(): Promise<T | undefined>` etc. — and have platform-cli return a thin async wrapper around `pgDefinitionStore` (or a sync-to-async wrapper around `sqliteDefinitionStore`). Drop the in-memory hydration + 5s refresh. Reads always hit the underlying store; PG / SQLite WAL handle the concurrency.

**Touches.** `packages/core/src/definitions/store.ts` (interface widening), every call site under `packages/core/src/{agents,cli,control-plane,engine}` and `packages/platform/src` that calls `definitionStore.X()` (audit + add `await`), platform-cli boot (drop `pgRefreshInterval`, drop the in-memory hydration loop, drop the `pgKnown*` sets), tests.

### Postgres LISTEN/NOTIFY for definition changes

**Problem.** Even if the cache stays in v0.2.0, the 5s polling refresh is a real failure mode in distributed deployments:

- **Apply / run race.** Apply at T=0 on CP-1 → CP-1 sees it immediately. Worker on host B last polled at T=4 → its in-memory cache is stale through T=8. A job dispatched in that window can run against the old definition.
- **Cost.** N workers × 4 LIST queries every 5s = 48N PG queries/minute just for definition staleness. Tolerable at 3 workers, wasteful at 50.
- **Latency floor.** Worst-case propagation = 2 × `AGENTFORGE_PG_DEFINITIONS_REFRESH_MS` ≈ 10s. Tightening the interval scales the cost linearly.

**Proposal.** PostgreSQL `LISTEN` channel `agentforge_definitions`. `apply` performs `NOTIFY agentforge_definitions, '<kind>:<name>'` after each `INSERT`/`UPDATE`. Every CP / worker process holds one dedicated `pg.Client` LISTEN'ing on that channel; on receipt, it re-fetches the affected row (or the full set on `*`) and updates its cache atomically. Push instead of poll — propagation drops from 5s to <100ms; PG query cost drops to ~zero in steady state.

**Touches.** New module `packages/platform/src/state/pg-listen.ts` (Client lifecycle, reconnect, channel name constant), `pg-definition-store.ts` (emit `NOTIFY` from `create` / `update` / `delete`), `platform-cli.ts` (replace `pgRefreshInterval` with the listener), keep-alive ping per [pg docs](https://node-postgres.com/apis/client#async-notifications). Optional: same channel for state-store changes so dashboard live-update doesn't depend on SSE alone.

**Together with the async-DefinitionStore item above, these eliminate the in-memory cache entirely.** The async migration is the architectural cleanup; LISTEN/NOTIFY is the performance + correctness story for distributed deployments. Either is useful on its own; both together remove a whole class of "did the apply propagate yet?" question.

---

## Memory & context

### Per-project vector store + RAG

**Problem.** Agents today start every run with a clean slate. They don't remember: *"this project uses TypeScript strict mode"*, *"last sprint's PR was rejected for missing rate limits"*, *"the team picked Fastify over Express"*. Every run re-discovers context.

**Proposal.** Per-project vector store — `pgvector` when Postgres is the state store; local LanceDB / Chroma otherwise. A background indexer ingests completed pipeline artifacts (requirements, architecture plans, code outputs). A retrieval step injects top-k relevant memories into the agent's context via a new `memory:` section in agent YAML. An explicit `memory.query` tool is also available for on-demand lookups during a run.

**Touches.** New `packages/platform/src/memory/` with indexer + retriever, agent YAML schema, Postgres migration (enable `pgvector`), retrieval tool, dashboard UI for memory inspection.

---

## Multi-tenancy & governance

### Namespaces + RBAC + quotas

**Problem.** Every agent, pipeline, run, and artifact lives in one global pool. Teams can't isolate their runs from each other; platform teams can't set per-team caps.

**Proposal.** Kubernetes-style namespaces — every resource belongs to a namespace (`default` unless specified). RBAC roles (viewer / editor / admin) bind to namespaces. Resource quotas — max concurrent runs, max cost per day, max tokens per pipeline — enforced at the namespace level. CLI gets `--namespace` on every command; dashboard adds a namespace switcher.

**Touches.** Schema migration adding `namespace` column to every state-store table, CLI flag plumbing, dashboard namespace-aware queries, policy engine for RBAC, quota enforcement in the scheduler + LLM client.

### Agent service mesh + discovery

**Problem.** Agents today can't directly call each other or external APIs safely. If an agent needs data from another agent (e.g., a QA agent wanting the architect's output), the pipeline has to explicitly wire artifacts. There's no service registry — and no managed way to expose an external API to agents.

**Proposal.** A Kubernetes-style service registry: agents advertise capabilities, consumers resolve via `service: <name>` in agent YAML. An external service catalog for third-party APIs — the control plane proxies calls, injects auth, and logs every request. Agents never see raw API keys.

**Touches.** Service registry in the state store, new `ServiceDefinition` YAML kind, proxy middleware in the control plane, audit-log entries for every proxied call, CLI `get services` + dashboard view.

---

## Pipeline topology

### `dependsOn` / complex DAG flows

**Problem.** Pipeline phases today are series-parallel — a phase runs, gates, next phase runs. Real workflows have DAGs: `test-frontend` depends on `build-frontend` *and* `build-api`; `test-api` only depends on `build-api`. The current model forces over-serialisation.

**Proposal.** Add a `dependsOn: [<step-name>]` field to flow step entries. The engine builds a DAG (topological sort + cycle detection), dispatches ready steps in parallel, tracks completions, and unblocks dependents on fan-in. Platform package — ties into the control-plane scheduler for cross-node dispatch.

**Touches.** Pipeline YAML schema, new DAG engine in `packages/platform/src/control-plane/`, dashboard DAG visualisation, tests covering cycle detection + fan-in.

---

## Horizontal scaling of the control plane

**Context.** As of v0.2.0 the execution plane scales horizontally — many worker hosts, one control plane. The control plane itself is a singleton: its pending-job queue, scheduler active-run counts, and event bus are all in-process state. Running two control-plane replicas today split-brains (lost dispatches to whichever replica a worker polls, halved SSE updates, racing reconcilers).

The four items below are the concrete path from "singleton control plane" to "N-replica control plane behind a load balancer." They should land together before we advertise horizontal CP scaling as a supported deployment — each is useful on its own, but the split-brain failure mode is only eliminated once all four are in place.

### Durable, claim-based job queue

**Problem.** `pendingRunQueues: Map<string, AgentJob[]>` in `packages/core/src/dashboard/server.ts` is per-process. A worker polling replica-A sees jobs that only replica-A scheduled; jobs scheduled by replica-B for the same worker are invisible.

**Proposal.** New `agent_jobs` table with columns `(id, run_id, node_name, payload, claimed_by, claimed_at, expires_at, status)`. Replace the in-memory map with a store port (`IJobQueue`) whose Postgres adapter issues:

```sql
UPDATE agent_jobs
   SET claimed_by = $1, claimed_at = NOW(), expires_at = NOW() + interval '60 s'
 WHERE id = (
   SELECT id FROM agent_jobs
    WHERE node_name = $2 AND (claimed_by IS NULL OR expires_at < NOW())
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
 )
 RETURNING *;
```

SQLite adapter can use a simpler `UPDATE ... WHERE claimed_by IS NULL` since only one writer contends. The worker-polling endpoint switches from reading the map to calling the store.

**Touches.** `packages/core/src/domain/ports/` (new port), `packages/core/src/state/store.ts`, `packages/platform/src/state/pg-store.ts`, `packages/core/src/state/schema.ts` (+ pg-schema), the polling HTTP handler, tests.

### Distributed event bus (Postgres LISTEN/NOTIFY or Redis)

**Problem.** `InMemoryEventBus` is the only implementation. SSE clients connected to replica-A never see events emitted by replica-B, so live dashboard updates are unreliable the moment a second CP replica exists.

**Proposal.** Keep `IEventBus` as-is; add a Postgres-LISTEN adapter first (zero extra infra when Postgres is already in play). `NOTIFY channel, json_payload` on emit; a single LISTEN loop per replica forwards to local subscribers. Add a Redis adapter later for deployments that prefer it.

**Touches.** `packages/platform/src/adapters/events/pg-listen-event-bus.ts` (new), DI wiring in `platform-cli.ts`, config env var (`AGENTFORGE_EVENT_BUS=postgres|redis|in-memory`, default `in-memory`).

### Leader-elected singleton loops

**Problem.** `PipelineRecoveryService` runs on startup, and the reconciler runs on a timer. With two replicas, both execute both loops — racing on the same zombie pipelines, potentially making conflicting edits.

**Proposal.** Wrap recovery + reconciliation in a leader election. Postgres path: `pg_try_advisory_lock(<bigint>)` per loop; if acquired, run; otherwise skip this tick. Release on process exit. The second replica becomes leader automatically when the first dies.

**Touches.** New utility `acquireAdvisoryLock` in platform; call sites in `PipelineRecoveryService` and the reconciliation tick; tests that simulate two processes contending.

### Stateless scheduler — read active-run counts from DB

**Problem.** `LocalAgentScheduler.activeRuns: Map<string, number>` is per-process. Two replicas disagree on node load; both may dispatch to a node already at `maxConcurrentRuns`.

**Proposal.** Drop the in-memory counter. Query `SELECT COUNT(*) FROM agent_runs WHERE node_name = $1 AND status IN ('running','scheduled')` at schedule time. With the claim-based queue (above) landed, this is cheap — a partial index on `(node_name, status)` keeps it fast.

**Touches.** `packages/core/src/control-plane/scheduler.ts`, its tests, a small index migration on `agent_runs(node_name, status)`.

### Definition of done for horizontal CP scaling

All four items merged and, as proof:

- `docker-compose.prod.yml` supports `CONTROL_PLANE_REPLICAS=3` behind an HTTP load balancer.
- An integration test spins up two CP replicas + one worker, schedules 50 agent jobs split across both replicas, and asserts every job runs exactly once.
- Killing one replica mid-run doesn't strand any job.
- Dashboard SSE stays connected and updates flow regardless of which replica the client landed on.

---

## Work-tracking integrations

### Jira adapter

**Problem.** Teams using Jira want: (a) trigger a pipeline from a Jira ticket, (b) have agents update ticket status as phases complete, (c) link artifacts back to the ticket.

**Proposal.** `IWorkTrackingProvider` port. `JiraProvider` adapter using the Jira REST API + a webhook listener. Wire into pipeline events (`pipeline_started`, `phase_completed`, `pipeline_completed`) to drive ticket status transitions.

**Touches.** New port in core, Jira adapter in platform, pipeline event hooks, config (Jira base URL + API token).

### GitHub Issues adapter

**Problem.** Same as Jira — GitHub Issues is the other popular target, and a natural fit for repos already on GitHub.

**Proposal.** `GitHubIssuesProvider` adapter for the same port. Trigger pipelines from issue labels or comment commands (e.g., `/agentforge run`); post artifact links + approval gate URLs back to the issue.

**Touches.** Adapter in platform, webhook route, GitHub App installation flow (preferred over PAT for scaling and audit).

### GitHub PR trigger + artifact store

**Problem.** Teams want to (a) run a pipeline on every PR, (b) post artifact links as PR comments, (c) optionally auto-create PRs from pipeline output (e.g., a doc-update agent).

**Proposal.** Three pieces: a webhook listener that triggers pipelines on PR open/update, an `IArtifactStore` adapter that writes outputs to a dedicated branch, and a PR comment bot with a consistent format.

**Touches.** GitHub App, webhook route, new `IArtifactStore` port + GitHub implementation, comment templating.

---

## Cloud worker deployments

### AWS ECS worker

**Problem.** Compose-based distributed deployment works for self-managed infrastructure. Teams on AWS want a first-class ECS deployment — no Compose files on their EC2 hosts.

**Proposal.** Terraform module + ECS task definition + service template. Workers auto-scale based on pending-job queue depth. Graceful shutdown on `SIGTERM` (finish in-flight run, deregister from control plane, exit). Health check endpoint for ECS target group.

**Touches.** New `infra/aws-ecs/` directory, Terraform files, health endpoint on workers, shutdown handler, README deployment guide.

### GCP Cloud Run worker

**Problem.** Same story for GCP users. Cloud Run is attractive for cost (scale to zero) but needs a different worker model.

**Proposal.** Two options documented side-by-side: (1) Cloud Run service with a long-polling worker that exits when the queue drains — a new instance starts when the control plane has work. (2) Cloud Run Jobs for one-shot agent runs, triggered per-job by the control plane over HTTP. Terraform for both.

**Touches.** New `infra/gcp-cloud-run/` directory, Terraform, Cloud Run-specific entrypoint shim, README.

---

## Other deferred work

New entries land here as they surface mid-release. Keep the structure — **Problem**, **Proposal**, **Touches** — so each item is ready to become a GitHub issue with minimal editing.

(None yet.)

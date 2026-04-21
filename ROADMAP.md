# AgentForge Roadmap

This file tracks larger pieces of work that are intentionally deferred past the
current release. Each item is written as an issue-ready brief — problem,
proposed approach, and the surface area it would touch — so a contributor can
pick it up without a fresh round of archaeology.

Short-term maintenance, bug fixes, and small features are tracked as GitHub
issues, not here. This file is for work that changes architecture.

---

## Horizontal scaling of the control plane

**Context.** As of v0.2.0 the execution plane scales horizontally — many worker
hosts, one control plane. The control plane itself is a singleton: its
pending-job queue, scheduler active-run counts, and event bus are all
in-process state. Running two control-plane replicas today split-brains
(lost dispatches to whichever replica a worker polls, halved SSE updates,
racing reconcilers).

The four items below are the concrete path from "singleton control plane" to
"N-replica control plane behind a load balancer." They should land together
before we advertise horizontal CP scaling as a supported deployment — each one
in isolation is useful on its own, but the split-brain failure mode is only
eliminated once all four are in place.

### 1. Durable, claim-based job queue

**Problem.** `pendingRunQueues: Map<string, AgentJob[]>` in
`packages/core/src/dashboard/server.ts` is per-process. A worker polling
replica-A sees jobs that only replica-A scheduled; jobs scheduled by
replica-B for the same worker are invisible.

**Proposal.** Add an `agent_jobs` table with columns `(id, run_id, node_name,
payload, claimed_by, claimed_at, expires_at, status)`. Replace the in-memory
map with a store port (`IJobQueue`) whose Postgres adapter issues:

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

SQLite adapter can use a simpler `UPDATE ... WHERE claimed_by IS NULL` since
only one writer contends. Worker polling endpoint switches from reading the
map to calling the store.

**Touches.** `packages/core/src/domain/ports/` (new port),
`packages/core/src/state/store.ts`, `packages/platform/src/state/pg-store.ts`,
`packages/core/src/state/schema.ts` (+ pg-schema), the polling HTTP handler,
and tests.

### 2. Distributed event bus (Postgres LISTEN/NOTIFY or Redis)

**Problem.** `InMemoryEventBus` is the only implementation. SSE clients
connected to replica-A never see events emitted by replica-B, so live
dashboard updates are unreliable the moment a second CP replica exists.

**Proposal.** Keep `IEventBus` as-is; add a Postgres-LISTEN adapter first
(zero extra infra when Postgres is already in play). `NOTIFY channel,
json_payload` on emit; a single LISTEN loop per replica forwards to local
subscribers. Add a Redis adapter later for deployments that prefer it.

**Touches.** `packages/platform/src/adapters/events/pg-listen-event-bus.ts`
(new), DI wiring in `platform-cli.ts`, config env var
(`AGENTFORGE_EVENT_BUS=postgres|redis|in-memory`, default `in-memory`).

### 3. Leader-elected singleton loops

**Problem.** `PipelineRecoveryService` runs on startup and the reconciler
runs on a timer. With two replicas, both do this — racing on the same zombie
pipelines, potentially making conflicting edits.

**Proposal.** Wrap recovery + reconciliation in a leader election. Postgres
path: `pg_try_advisory_lock(<bigint>)` per loop; if acquired, run; otherwise
skip this tick. Release on process exit. Second replica becomes leader
automatically when the first dies.

**Touches.** New utility `acquireAdvisoryLock` in platform; call sites in
`PipelineRecoveryService` and the reconciliation tick; tests that simulate
two processes contending.

### 4. Stateless scheduler — read active-run counts from DB

**Problem.** `LocalAgentScheduler.activeRuns: Map<string, number>` is
per-process. Two replicas disagree on node load, both may dispatch to a node
that's already at `maxConcurrentRuns`.

**Proposal.** Drop the in-memory counter. Query
`SELECT COUNT(*) FROM agent_runs WHERE node_name = $1 AND status IN ('running','scheduled')`
at schedule time. With (1) landed this is cheap (claim-based queue already
maintains accurate counts via a partial index).

**Touches.** `packages/core/src/control-plane/scheduler.ts`, its tests, and
a small index migration on `agent_runs(node_name, status)`.

### Definition of done for horizontal CP scaling

All four items merged and, as proof:

- `docker-compose.prod.yml` supports `CONTROL_PLANE_REPLICAS=3` behind an
  HTTP load balancer.
- An integration test spins up two CP replicas + one worker, schedules 50
  agent jobs split across both replicas, and asserts every job runs exactly
  once.
- Killing one replica mid-run doesn't strand any job.
- Dashboard SSE stays connected and updates flow regardless of which replica
  the client landed on.

---

## Other deferred work

Add new entries below as they arise. Keep the structure: **Problem**,
**Proposal**, **Touches** — so each item is ready to become a GitHub issue
with minimal editing.

(None yet.)

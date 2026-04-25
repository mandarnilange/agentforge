/**
 * Runtime DefinitionStore source for agent / pipeline lookups.
 *
 * AgentForge originally read agent and pipeline YAML straight from
 * `<.agentforge>/agents/<id>.agent.yaml` etc. — fine for a single-process
 * CLI where the filesystem IS the source of truth.
 *
 * In platform mode (PG state store, dashboard, multi-process), `apply`
 * persists definitions to a database and the runtime needs to read from
 * THAT store, not the filesystem. This module is the indirection point:
 *
 *   - At boot, platform-cli calls `setRuntimeDefinitionStore(store)`
 *     after hydrating the in-memory cache from PG (or wiring the SQLite
 *     definition store directly).
 *   - Execution paths (registry, runner, pipeline-controller, run-pipeline,
 *     gate) call `getRuntimeDefinitionStore()` first; if it's set, look up
 *     the definition from there. If unset (bare `agentforge-core` CLI use),
 *     fall back to the filesystem read so existing behaviour is preserved.
 */

import type { DefinitionStore } from "../definitions/store.js";

let active: DefinitionStore | null = null;

export function setRuntimeDefinitionStore(store: DefinitionStore | null): void {
	active = store;
}

export function getRuntimeDefinitionStore(): DefinitionStore | null {
	return active;
}

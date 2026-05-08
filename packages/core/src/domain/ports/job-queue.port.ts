/**
 * IJobQueue — pluggable dispatch queue for agent jobs across control-plane
 * replicas (P45-T4).
 *
 * The single-process default is the in-memory adapter (zero new infra).
 * The Postgres adapter (P45-T4) uses `SELECT ... FOR UPDATE SKIP LOCKED`
 * so multiple control-plane replicas can claim jobs without lost dispatches
 * or duplicate work.
 *
 * Lifecycle:
 *   1. Control plane calls enqueue(job, nodeName) when scheduler picks a node.
 *   2. Worker polls claim(nodeName, { limit, ttlMs }); receives 0..N jobs.
 *   3. On result POST control plane calls complete(runId) (or fail).
 *   4. A periodic reclaimStale(maxAgeMs) sweeps abandoned claims back to
 *      pending so a different worker can pick them up.
 */

import type { AgentJob } from "./agent-executor.port.js";

export interface ClaimOptions {
	/** Maximum number of jobs to claim in this call. Default 1. */
	limit?: number;
	/**
	 * Claim TTL — how long the worker is trusted to hold the job before a
	 * sweep can reclaim it. Default 5 minutes.
	 */
	ttlMs?: number;
}

export interface IJobQueue {
	/** Push a job onto the queue for `nodeName` to pick up. */
	enqueue(job: AgentJob, nodeName: string): Promise<void>;

	/**
	 * Atomically claim up to `limit` jobs for the named worker. Idempotent
	 * for repeat callers — already-claimed jobs are skipped, never returned
	 * twice.
	 */
	claim(nodeName: string, opts?: ClaimOptions): Promise<AgentJob[]>;

	/** Mark a claimed job complete and remove it from the queue. */
	complete(runId: string): Promise<void>;

	/**
	 * Release claims older than `maxAgeMs` so a different worker can retry.
	 * Returns the count of reclaimed jobs.
	 */
	reclaimStale(maxAgeMs: number): Promise<number>;

	/** Best-effort introspection — number of pending+claimed jobs for `nodeName`. */
	depth(nodeName: string): Promise<number>;
}

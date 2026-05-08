/**
 * InMemoryJobQueue — single-process IJobQueue implementation (P45-T4).
 *
 * Mirrors the contract the PostgresJobQueue must honour so the same wiring
 * works with a swap of adapter via `AGENTFORGE_JOB_QUEUE=postgres|memory`.
 * Not safe across processes — for multi-replica control planes use the
 * Postgres adapter.
 */

import type { AgentJob } from "../../domain/ports/agent-executor.port.js";
import type {
	ClaimOptions,
	IJobQueue,
} from "../../domain/ports/job-queue.port.js";

interface QueueEntry {
	job: AgentJob;
	nodeName: string;
	claimedBy?: string;
	claimedAt?: number;
	ttlMs?: number;
}

export interface InMemoryJobQueueOptions {
	now?: () => number;
}

export class InMemoryJobQueue implements IJobQueue {
	private readonly entries = new Map<string, QueueEntry>();
	private now: () => number;

	constructor(opts: InMemoryJobQueueOptions = {}) {
		this.now = opts.now ?? (() => Date.now());
	}

	/** Test-only — override the clock without leaking the field publicly. */
	_setNow(t: number): void {
		this.now = () => t;
	}

	enqueue(job: AgentJob, nodeName: string): Promise<void> {
		// Match Postgres' `ON CONFLICT DO NOTHING`: a duplicate enqueue keeps
		// the original entry (and any in-flight claim metadata) instead of
		// silently overwriting it.
		if (!this.entries.has(job.runId)) {
			this.entries.set(job.runId, { job, nodeName });
		}
		return Promise.resolve();
	}

	claim(nodeName: string, opts: ClaimOptions = {}): Promise<AgentJob[]> {
		const limit = opts.limit ?? 1;
		const ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
		const now = this.now();
		const claimed: AgentJob[] = [];
		// Iterate insertion order — Map preserves it. Pick up to `limit`
		// pending entries for this node and atomically mark them claimed.
		for (const entry of this.entries.values()) {
			if (claimed.length >= limit) break;
			if (entry.nodeName !== nodeName) continue;
			if (entry.claimedBy !== undefined) continue;
			entry.claimedBy = nodeName;
			entry.claimedAt = now;
			entry.ttlMs = ttlMs;
			claimed.push(entry.job);
		}
		return Promise.resolve(claimed);
	}

	complete(runId: string): Promise<void> {
		this.entries.delete(runId);
		return Promise.resolve();
	}

	reclaimStale(maxAgeMs: number): Promise<number> {
		const now = this.now();
		let count = 0;
		for (const entry of this.entries.values()) {
			if (entry.claimedBy === undefined || entry.claimedAt === undefined) {
				continue;
			}
			// Per-job TTL wins when set — claim() records the worker's
			// declared trust horizon, and that's the right age for *this*
			// job. The maxAgeMs argument is the global fallback for jobs
			// claimed before per-job TTLs were tracked.
			const age = now - entry.claimedAt;
			const threshold = entry.ttlMs ?? maxAgeMs;
			if (age >= threshold) {
				entry.claimedBy = undefined;
				entry.claimedAt = undefined;
				entry.ttlMs = undefined;
				count++;
			}
		}
		return Promise.resolve(count);
	}

	depth(nodeName: string): Promise<number> {
		let count = 0;
		for (const entry of this.entries.values()) {
			if (entry.nodeName === nodeName) count++;
		}
		return Promise.resolve(count);
	}
}

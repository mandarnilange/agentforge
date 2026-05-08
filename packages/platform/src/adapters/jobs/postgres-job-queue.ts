/**
 * PostgresJobQueue — multi-replica IJobQueue (P45-T4).
 *
 * Uses `SELECT ... FOR UPDATE SKIP LOCKED` so any number of control-plane
 * replicas can call `claim()` concurrently without lost dispatches or
 * duplicate work. Migration `003-job-queue.sql` provisions the table.
 */

import type { AgentJob } from "@mandarnilange/agentforge-core/domain/ports/agent-executor.port.js";
import type {
	ClaimOptions,
	IJobQueue,
} from "@mandarnilange/agentforge-core/domain/ports/job-queue.port.js";
import pg from "pg";

export class PostgresJobQueue implements IJobQueue {
	private readonly pool: pg.Pool;

	constructor(connectionString: string) {
		this.pool = new pg.Pool({ connectionString });
	}

	async enqueue(job: AgentJob, nodeName: string): Promise<void> {
		await this.pool.query(
			`INSERT INTO agent_jobs (run_id, node_name, payload, enqueued_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (run_id) DO NOTHING`,
			[job.runId, nodeName, JSON.stringify(job)],
		);
	}

	async claim(nodeName: string, opts: ClaimOptions = {}): Promise<AgentJob[]> {
		const limit = opts.limit ?? 1;
		const ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
		// Single statement: pick eligible rows with FOR UPDATE SKIP LOCKED
		// (so a concurrent replica can't grab the same row), then UPDATE
		// to mark them claimed and RETURN the payload. CTE keeps it atomic
		// inside one query — no transaction round-trip needed.
		const { rows } = await this.pool.query(
			`WITH eligible AS (
         SELECT run_id FROM agent_jobs
         WHERE node_name = $1 AND claimed_by IS NULL
         ORDER BY enqueued_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE agent_jobs SET
         claimed_by = $1,
         claimed_at = now(),
         claim_ttl_ms = $3
       WHERE run_id IN (SELECT run_id FROM eligible)
       RETURNING run_id, payload`,
			[nodeName, limit, ttlMs],
		);
		// Resilient parse: a single corrupted payload (DB drift, manual
		// edit) shouldn't poison the whole claim — drop the bad row and
		// log so the operator can investigate.
		const parsed: AgentJob[] = [];
		for (const r of rows) {
			try {
				parsed.push(JSON.parse(r.payload) as AgentJob);
			} catch (err) {
				console.warn(
					`PostgresJobQueue: dropping unparseable payload for run_id=${r.run_id}: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
		return parsed;
	}

	async complete(runId: string): Promise<void> {
		await this.pool.query("DELETE FROM agent_jobs WHERE run_id = $1", [runId]);
	}

	async reclaimStale(maxAgeMs: number): Promise<number> {
		// COALESCE so each row uses its own claim_ttl_ms when set, falling
		// back to maxAgeMs only when the row predates per-job TTL tracking.
		const { rowCount } = await this.pool.query(
			`UPDATE agent_jobs SET
         claimed_by = NULL,
         claimed_at = NULL,
         claim_ttl_ms = NULL
       WHERE claimed_at IS NOT NULL
         AND (EXTRACT(EPOCH FROM (now() - claimed_at)) * 1000)
             >= COALESCE(claim_ttl_ms, $1)`,
			[maxAgeMs],
		);
		return rowCount ?? 0;
	}

	async depth(nodeName: string): Promise<number> {
		const { rows } = await this.pool.query(
			"SELECT count(*)::int AS count FROM agent_jobs WHERE node_name = $1",
			[nodeName],
		);
		return Number(rows[0]?.count ?? 0);
	}

	async close(): Promise<void> {
		await this.pool.end();
	}
}

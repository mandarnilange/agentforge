/**
 * DbActiveRunCounter — multi-replica IActiveRunCounter (P45-T6).
 *
 * Queries `agent_runs` GROUP BY node_name on each call so any number of
 * control-plane replicas see the same load truth. Backed by a partial
 * index (`agent_runs(node_name, status) WHERE status IN ...`) provisioned
 * by migration `004-active-run-index.sql` to keep the query cheap.
 */

import type { IActiveRunCounter } from "@mandarnilange/agentforge-core/domain/ports/active-run-counter.port.js";
import pg from "pg";

const ACTIVE_STATUSES = ["pending", "scheduled", "running"] as const;

export class DbActiveRunCounter implements IActiveRunCounter {
	private readonly pool: pg.Pool;

	constructor(connectionString: string) {
		this.pool = new pg.Pool({ connectionString });
	}

	async count(nodeName: string): Promise<number> {
		// Build the IN clause from ACTIVE_STATUSES so the constant can't drift
		// out of sync with the SQL. status = ANY($2::text[]) is equivalent to
		// IN (...) but takes the array as a single bound parameter.
		const { rows } = await this.pool.query(
			`SELECT count(*)::int AS count
       FROM agent_runs
       WHERE node_name = $1
         AND status = ANY($2::text[])`,
			[nodeName, [...ACTIVE_STATUSES]],
		);
		return Number(rows[0]?.count ?? 0);
	}

	// recordStarted/recordCompleted are intentionally no-ops: createAgentRun
	// already inserts a row with status='pending', and updateAgentRun flips
	// it through scheduled→running→succeeded/failed. The DB is the source of
	// truth — the in-memory map this adapter replaces is gone.
	recordStarted(_nodeName: string): Promise<void> {
		return Promise.resolve();
	}

	recordCompleted(_nodeName: string): Promise<void> {
		return Promise.resolve();
	}

	async close(): Promise<void> {
		await this.pool.end();
	}

	/** Statuses considered "active" for load accounting. Exported for visibility. */
	static readonly ACTIVE_STATUSES: readonly string[] = ACTIVE_STATUSES;
}

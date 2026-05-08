/**
 * PostgresLeaderElector — pg_advisory_lock-based singleton election (P45-T5).
 *
 * Holds a dedicated pg client (not a pool checkout) so the session lives
 * for the lifetime of the leader. When the process exits or the session
 * drops, Postgres auto-releases the lock and another replica's next
 * `pg_try_advisory_lock` call returns true → instant failover.
 *
 * Lock names are hashed into a bigint so callers can use human-readable
 * names ("agentforge-reconciler", "agentforge-scheduler") without picking
 * magic numbers.
 *
 * Pool sizing: each held lock checks out one pg.PoolClient for its session
 * lifetime. Size the underlying Postgres `max_connections` to accommodate
 * (concurrent_lock_count × replica_count) plus headroom for ordinary
 * queries. The default Postgres pool is created here with library defaults;
 * pass a tuned pool via subclass / DI when load profile demands it.
 */

import { createHash } from "node:crypto";
import type { ILeaderElector } from "@mandarnilange/agentforge-core/domain/ports/leader-elector.port.js";
import pg from "pg";

interface LockHandle {
	client: pg.PoolClient;
}

export class PostgresLeaderElector implements ILeaderElector {
	private readonly pool: pg.Pool;
	private readonly held = new Map<string, LockHandle>();

	constructor(connectionString: string) {
		this.pool = new pg.Pool({ connectionString });
	}

	async acquire(lockName: string): Promise<boolean> {
		if (this.held.has(lockName)) return true;
		const lockId = lockNameToBigInt(lockName);
		const client = (await this.pool.connect()) as pg.PoolClient;
		try {
			const { rows } = await client.query(
				"SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock",
				[lockId],
			);
			const acquired = rows[0]?.pg_try_advisory_lock === true;
			if (!acquired) {
				client.release();
				return false;
			}
			this.held.set(lockName, { client });
			return true;
		} catch (err) {
			client.release();
			throw err;
		}
	}

	async release(lockName: string): Promise<void> {
		const handle = this.held.get(lockName);
		if (!handle) return;
		const lockId = lockNameToBigInt(lockName);
		try {
			await handle.client.query(
				"SELECT pg_advisory_unlock($1) AS pg_advisory_unlock",
				[lockId],
			);
		} finally {
			handle.client.release();
			this.held.delete(lockName);
		}
	}

	isLeader(lockName: string): boolean {
		return this.held.has(lockName);
	}

	async close(): Promise<void> {
		// Release all held locks in parallel so shutdown is not gated on the
		// slowest pg_advisory_unlock round-trip. Snapshot the key set first
		// to avoid mutation during iteration.
		await Promise.all([...this.held.keys()].map((name) => this.release(name)));
		await this.pool.end();
	}
}

/**
 * Hash a lock name to a signed 64-bit int. Postgres advisory locks take a
 * bigint; sha256 truncated to 8 bytes is collision-resistant for the small
 * fixed set of agentforge lock names (collision probability ≈ 2^-63 per
 * pair — negligible for the 5-10 lock names we ever expect to declare).
 * Returns a string so the pg driver passes it as a numeric parameter
 * without precision loss.
 */
function lockNameToBigInt(name: string): string {
	const digest = createHash("sha256").update(name).digest();
	// Take 8 bytes, force the high bit to 0 to keep it positive (Postgres
	// bigint range is signed but our values are well within int63).
	const buf = digest.subarray(0, 8);
	buf[0] &= 0x7f;
	return buf.readBigInt64BE(0).toString();
}
